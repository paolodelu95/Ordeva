//! Generazione XML FatturaPA (TD01 fattura immediata / TD24 fattura differita /
//! TD04 nota di credito).
//! Parità BYTE-PER-BYTE con routes/fatturaXml.js buildFatturaPA: ordine elementi,
//! indentazione e formattazione numeri devono combaciare (XML diverso = scarto SDI).

use rusqlite::{Connection, OptionalExtension};

use crate::fiscale::{calcola_totali_fiscali, fisc_from_row, Fisc};

// ── helpers ──────────────────────────────────────────────────────────────────

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn fmt2(n: f64) -> String {
    format!("{:.2}", n)
}

fn fmt_date(s: &str) -> String {
    s.chars().take(10).collect()
}

fn sanitize_progressivo(s: &str) -> String {
    let v: String = s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(10).collect();
    if v.is_empty() {
        "1".into()
    } else {
        v
    }
}

fn clean_piva(s: &str) -> String {
    let s = s.strip_prefix("IT").or_else(|| s.strip_prefix("it")).unwrap_or(s);
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn pad_cap(s: &str) -> String {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    let padded = if digits.len() < 5 {
        format!("{:0>5}", digits)
    } else {
        digits
    };
    let out: String = padded.chars().take(5).collect();
    if out.is_empty() {
        "00000".into()
    } else {
        out
    }
}

/// Nome nazione (campo libero "Stato" in anagrafica cliente) → codice ISO
/// 3166-1 alpha-2 per IdPaese/Nazione nell'XML. None = stringa non vuota ma
/// non riconosciuta: i chiamanti in xml.rs ricadono su IT (comportamento
/// storico), ma fattura_xml.rs::validate usa questo None per avvisare che lo
/// stato scritto in anagrafica non è tra quelli riconosciuti, cosi' un nome
/// scritto male (o un paese non ancora in elenco) non genera silenziosamente
/// un IdPaese sbagliato senza che nessuno se ne accorga.
pub(crate) fn country_code_opt(nome: &str) -> Option<&'static str> {
    let n = nome.trim().to_lowercase();
    let code = match n.as_str() {
        "" | "italia" => "IT",
        "germania" => "DE", "francia" => "FR", "spagna" => "ES",
        "regno unito" | "inghilterra" | "gran bretagna" => "GB",
        "stati uniti" | "stati uniti d'america" | "usa" => "US",
        "svizzera" => "CH", "austria" => "AT", "belgio" => "BE",
        "paesi bassi" | "olanda" => "NL", "portogallo" => "PT", "grecia" => "GR",
        "polonia" => "PL", "repubblica ceca" | "cechia" => "CZ", "romania" => "RO",
        "bulgaria" => "BG", "ungheria" => "HU", "slovacchia" => "SK", "slovenia" => "SI",
        "croazia" => "HR", "danimarca" => "DK", "svezia" => "SE", "finlandia" => "FI",
        "irlanda" => "IE", "lussemburgo" => "LU", "malta" => "MT", "cipro" => "CY",
        "estonia" => "EE", "lettonia" => "LV", "lituania" => "LT", "norvegia" => "NO",
        "san marino" => "SM", "citta' del vaticano" | "città del vaticano" | "vaticano" => "VA",
        "monaco" => "MC", "liechtenstein" => "LI", "andorra" => "AD", "islanda" => "IS",
        "cina" => "CN", "giappone" => "JP", "canada" => "CA", "brasile" => "BR",
        "australia" => "AU", "nuova zelanda" => "NZ", "india" => "IN", "russia" => "RU",
        "turchia" => "TR", "emirati arabi uniti" => "AE", "arabia saudita" => "SA",
        "corea del sud" => "KR", "messico" => "MX", "argentina" => "AR", "cile" => "CL",
        "colombia" => "CO", "peru" | "perù" => "PE", "venezuela" => "VE", "ecuador" => "EC",
        "sudafrica" => "ZA", "israele" => "IL", "ucraina" => "UA", "serbia" => "RS",
        "albania" => "AL", "bosnia ed erzegovina" => "BA", "macedonia del nord" => "MK",
        "montenegro" => "ME", "hong kong" => "HK", "singapore" => "SG",
        "egitto" => "EG", "marocco" => "MA", "tunisia" => "TN", "algeria" => "DZ",
        "nigeria" => "NG", "kenya" => "KE", "thailandia" => "TH", "vietnam" => "VN",
        "indonesia" => "ID", "malaysia" => "MY", "filippine" => "PH", "pakistan" => "PK",
        "taiwan" => "TW",
        _ => return None,
    };
    Some(code)
}

/// Come `country_code_opt`, ma con fallback IT per il caso non riconosciuto:
/// usato nella generazione XML, dove serve comunque un valore.

/// La sigla è un codice paese ISO che conosciamo? Serve a distinguere una
/// partita IVA estera ("ESB83357863") da una parola qualsiasi.
pub(crate) fn country_code_opt_da_sigla(sigla: &str) -> Option<&'static str> {
    const SIGLE: [&str; 60] = [
        "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU",
        "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "GB", "CH",
        "NO", "IS", "LI", "SM", "VA", "MC", "AD", "US", "CA", "CN", "JP", "KR", "IN", "AU", "NZ",
        "BR", "AR", "MX", "CL", "CO", "PE", "ZA", "IL", "TR", "RU", "UA", "RS", "AE", "SA", "SG",
    ];
    SIGLE.iter().find(|s| **s == sigla).copied()
}

fn country_code(nome: &str) -> &'static str {
    country_code_opt(nome).unwrap_or("IT")
}

/// FPA12 = 6 char → PA; FPR12 = 7 char → privato/B2B.
fn detect_formato(sdi: &str) -> (&'static str, String) {
    let v: String = sdi.trim().to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    match v.len() {
        6 => ("FPA12", v),
        7 => ("FPR12", v),
        _ => ("FPR12", "0000000".into()),
    }
}

fn map_modalita(nome: &str) -> &'static str {
    let n = nome.to_lowercase();
    if n.contains("contant") || n.contains("cass") {
        "MP01"
    } else if n.contains("assegno circ") {
        "MP03"
    } else if n.contains("assegno") {
        "MP02"
    } else if n.contains("riba") {
        "MP12"
    } else if n.contains("rid") || n.contains("sdd") || n.contains("domicil") {
        "MP19"
    } else if n.contains("pos") || n.contains("carta") || n.contains("bancomat") || n.contains("satispay") || n.contains("paypal") {
        "MP08"
    } else if n.contains("anticipato") {
        "MP05"
    } else {
        "MP05"
    }
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn calc_scadenza(data_emissione: &str, giorni: i64, fine_mese: bool) -> String {
    let head: String = data_emissione.chars().take(10).collect();
    let parts: Vec<&str> = head.split('-').collect();
    let parsed = if parts.len() == 3 {
        match (parts[0].parse::<i64>(), parts[1].parse::<i64>(), parts[2].parse::<i64>()) {
            (Ok(y), Ok(m), Ok(d)) if (1..=12).contains(&m) && (1..=31).contains(&d) => Some((y, m, d)),
            _ => None,
        }
    } else {
        None
    };
    let (y, m, d) = match parsed {
        Some(t) => t,
        None => return fmt_date(data_emissione),
    };
    let days = days_from_civil(y, m, d) + giorni;
    let (y2, m2, _) = civil_from_days(days);
    if fine_mese {
        let first_next = days_from_civil(if m2 == 12 { y2 + 1 } else { y2 }, if m2 == 12 { 1 } else { m2 + 1 }, 1);
        let (y3, m3, d3) = civil_from_days(first_next - 1);
        format!("{y3:04}-{m3:02}-{d3:02}")
    } else {
        let (yy, mm, dd) = civil_from_days(days);
        let _ = (y2, m2);
        format!("{yy:04}-{mm:02}-{dd:02}")
    }
}

fn causale_blocks(note: &str) -> String {
    if note.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = note.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let chunk: String = chars[i..(i + 200).min(chars.len())].iter().collect();
        out.push_str(&format!("\n        <Causale>{}</Causale>", esc(&chunk)));
        i += 200;
    }
    out
}

/// Natura SDI dell'aliquota `codice_iva` (aliquote_iva.natura), se impostata.
/// Nessun ripiego: una riga a IVA 0% senza Natura non si "indovina" (prima
/// finiva come N4 esente, che per un'esportazione o un reverse charge è un
/// errore nella dichiarazione IVA), si ferma la generazione e lo si dice.
fn natura_da_codice(conn: &Connection, codice_iva: &str) -> Option<String> {
    let codice = codice_iva.trim();
    if codice.is_empty() {
        return None;
    }
    conn.query_row("SELECT natura FROM aliquote_iva WHERE codice=?1", [codice], |r| r.get::<_, Option<String>>(0))
        .optional()
        .ok()
        .flatten()
        .flatten()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
}

/// Scelta del TipoDocumento di una fattura. `scelto` è quello messo a mano
/// (TD01/TD24, vuoto = automatico). In automatico è differita (TD24) quando
/// almeno un DDT ha data anteriore a quella della fattura: la merce è partita
/// prima, la fattura arriva dopo (art. 21 c. 4 lett. a DPR 633/72). Un DDT
/// dello stesso giorno accompagna una fattura immediata.
pub(crate) fn tipo_documento_fattura(scelto: &str, data_fattura: &str, date_ddt: &[String]) -> &'static str {
    match scelto {
        "TD01" => return "TD01",
        "TD24" => return "TD24",
        _ => {}
    }
    let df = fmt_date(data_fattura);
    if date_ddt.iter().map(|d| fmt_date(d)).any(|d| !d.is_empty() && d < df) {
        "TD24"
    } else {
        "TD01"
    }
}

/// Quello che serve a capire (e a controllare) il tipo di una fattura: la
/// scelta manuale, il tipo che ne risulta e i DDT a cui si riferisce.
pub(crate) struct TipoFattura {
    pub scelto: String,
    pub effettivo: &'static str,
    /// (numero, data) di ogni DDT: collegati alla fattura e scritti a mano nei riferimenti.
    pub ddt: Vec<(String, String)>,
}

pub(crate) fn tipo_fattura(conn: &Connection, fattura_id: i64) -> anyhow::Result<TipoFattura> {
    let (scelto, data): (String, String) = conn.query_row(
        "SELECT tipo_documento, data_emissione FROM fatture WHERE id=?1",
        [fattura_id],
        |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, Option<String>>(1)?.unwrap_or_default())),
    )?;
    let ddt: Vec<(String, String)> = load_riferimenti(conn, fattura_id)?
        .into_iter()
        .filter(|r| r.tipo == "DDT")
        .map(|r| (r.numero, r.data))
        .collect();
    let date: Vec<String> = ddt.iter().map(|d| d.1.clone()).collect();
    Ok(TipoFattura { effettivo: tipo_documento_fattura(&scelto, &data, &date), scelto, ddt })
}

fn resolve_esigibilita(is_split: bool, codice_iva: &str) -> &'static str {
    if is_split || codice_iva.ends_with("sp") {
        "S"
    } else {
        "I"
    }
}

// ── struct di supporto ───────────────────────────────────────────────────────

struct Riga {
    tipo: String,
    descrizione: Option<String>,
    quantita: Option<f64>,
    prezzo: Option<f64>,
    sconto: Option<f64>,
    iva: Option<f64>,
    codice_iva: String,
    unita_misura: Option<String>,
}

struct Riferimento {
    tipo: String,
    numero: String,
    data: String,
    cig: String,
    cup: String,
    commessa: String,
}

// ── builder ──────────────────────────────────────────────────────────────────

/// Documento non pronto per la fattura elettronica: manca qualcosa che deve
/// mettere l'utente. È distinto da un guasto interno perché il messaggio va
/// mostrato così com'è — altrimenti chi preme "Scarica XML" legge solo
/// "Errore interno" e non sa cosa sistemare.
#[derive(Debug)]
pub struct DocumentoIncompleto(pub String);

impl std::fmt::Display for DocumentoIncompleto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for DocumentoIncompleto {}

/// `bail!` per i controlli sul contenuto del documento.
macro_rules! incompleto {
    ($($arg:tt)*) => {
        return Err(anyhow::Error::new($crate::xml::DocumentoIncompleto(format!($($arg)*))))
    };
}

/// Genera l'XML. `is_nota` → TD04 da note_credito; altrimenti TD01/TD24 da fatture.
pub fn build_fattura_pa(conn: &Connection, id: i64, is_nota: bool) -> anyhow::Result<String> {
    // azienda
    let az = conn
        .query_row("SELECT * FROM azienda WHERE id=1", [], |r| {
            let s = |k: &str| r.get::<_, Option<String>>(k).ok().flatten().unwrap_or_default();
            Ok(AzData {
                ragione_sociale: s("ragione_sociale"),
                p_iva: s("p_iva"),
                cod_fiscale: s("cod_fiscale"),
                indirizzo: s("indirizzo"),
                cap: s("cap"),
                citta: s("citta"),
                provincia: s("provincia"),
                regime_fiscale: s("regime_fiscale"),
                pec: s("pec"),
                email: s("email"),
            })
        })
        .optional()?
        .unwrap_or_default();

    // documento
    let (doc, fisc, mut riferimenti) = if is_nota {
        let d = conn
            .query_row(
                "SELECT n.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, c.provincia as c_provincia, \
                        c.stato as c_stato, c.p_iva as c_piva, c.codice_fiscale as c_cf, c.sdi as c_sdi, c.pec as c_pec, \
                        c.tipo_soggetto as c_tipo_soggetto, c.cig as c_cig, c.cup as c_cup, \
                        f.numero as coll_numero, f.data_emissione as coll_data \
                 FROM note_credito n LEFT JOIN clienti c ON n.cliente_id = c.id LEFT JOIN fatture f ON n.fattura_id = f.id WHERE n.id=?1",
                [id],
                |r| Ok((load_doc(r, false), fisc_from_row(r))),
            )
            .optional()?;
        let (doc, fisc) = d.ok_or_else(|| anyhow::anyhow!("Nota di credito non trovata"))?;
        let rifs = if !doc.coll_numero.is_empty() {
            vec![Riferimento { tipo: "FATTURA_COLLEGATA".into(), numero: doc.coll_numero.clone(), data: doc.coll_data.clone(), cig: String::new(), cup: String::new(), commessa: String::new() }]
        } else {
            vec![]
        };
        (doc, fisc, rifs)
    } else {
        let d = conn
            .query_row(
                "SELECT f.*, c.ragione_sociale as c_nome, c.via as c_via, c.cap as c_cap, c.citta as c_citta, c.provincia as c_provincia, \
                        c.stato as c_stato, c.p_iva as c_piva, c.codice_fiscale as c_cf, c.sdi as c_sdi, c.pec as c_pec, \
                        c.tipo_soggetto as c_tipo_soggetto, c.cig as c_cig, c.cup as c_cup, \
                        tp.nome as tp_nome, tp.giorni_scadenza as tp_giorni, tp.fine_mese as tp_fine_mese, tp.immediato as tp_immediato \
                 FROM fatture f LEFT JOIN clienti c ON f.cliente_id = c.id LEFT JOIN tipi_pagamento tp ON f.tipo_pagamento_id = tp.id WHERE f.id=?1",
                [id],
                |r| Ok((load_doc(r, true), fisc_from_row(r))),
            )
            .optional()?;
        let (doc, fisc) = d.ok_or_else(|| anyhow::anyhow!("Fattura non trovata"))?;
        (doc, fisc, load_riferimenti(conn, id)?)
    };

    // righe
    let righe = load_righe(conn, id, is_nota)?;

    let is_pa = doc.c_tipo_soggetto == "PA" || detect_formato(&doc.c_sdi).0 == "FPA12";
    // Semantica `row.cig || row.c_cig || ''` poi .trim(): primo NON vuoto (grezzo), poi trim.
    let cig = first_truthy_trim(&[doc.doc_cig.as_str(), doc.c_cig.as_str()]);
    let cup = first_truthy_trim(&[doc.doc_cup.as_str(), doc.c_cup.as_str()]);
    colloca_cig_cup(&mut riferimenti, &cig, &cup)?;

    // Natura di ogni riga: obbligatoria con IVA 0%, assente altrimenti. Una
    // riga da 0 € a IVA 0% senza Natura è solo testo (es. "Riferimento fattura
    // n. …" delle note di credito salvate prima che diventasse una riga NOTA):
    // non ha niente da tassare, quindi resta fuori dall'XML invece di fermarlo.
    let mut nature: Vec<Option<String>> = Vec::with_capacity(righe.len());
    let mut descrittive: Vec<bool> = Vec::with_capacity(righe.len());
    for (i, r) in righe.iter().enumerate() {
        let aliq = r.iva.unwrap_or(22.0);
        if r.tipo == "NOTA" || aliq > 0.0 {
            nature.push(None);
            descrittive.push(r.tipo == "NOTA");
            continue;
        }
        let natura = natura_da_codice(conn, &r.codice_iva);
        let importo_zero = r.quantita.unwrap_or(1.0) * r.prezzo.unwrap_or(0.0) == 0.0;
        descrittive.push(natura.is_none() && importo_zero);
        match natura {
            Some(n) => nature.push(Some(n)),
            None if importo_zero => nature.push(None),
            None => incompleto!(
                "La riga {} ha IVA 0% ma nessuna Natura: scegli l'aliquota giusta (esente, non imponibile, reverse charge…) o imposta la Natura in Anagrafiche → Aliquote IVA",
                i + 1
            ),
        }
    }

    // IVA breakdown (ordine di inserimento preservato)
    let mut iva_map: Vec<IvaEntry> = Vec::new();
    for ((r, natura), &descrittiva) in righe.iter().zip(&nature).zip(&descrittive) {
        if descrittiva {
            continue;
        }
        let aliq = r.iva.unwrap_or(22.0);
        let natura = natura.clone();
        let esig = resolve_esigibilita(is_pa && aliq > 0.0, &r.codice_iva);
        let key = format!("{}|{}|{}", js_num(aliq), natura.clone().unwrap_or_default(), esig);
        let base = r.quantita.unwrap_or(1.0) * r.prezzo.unwrap_or(0.0) * (1.0 - r.sconto.unwrap_or(0.0) / 100.0);
        upsert_iva(&mut iva_map, key, aliq, natura, esig, base, base * aliq / 100.0);
    }

    // calcoli fiscali
    let righe4: Vec<(f64, f64, f64, f64)> = righe
        .iter()
        .map(|r| (r.quantita.unwrap_or(0.0), r.prezzo.unwrap_or(0.0), r.sconto.unwrap_or(0.0), r.iva.unwrap_or(0.0)))
        .collect();
    let tot = calcola_totali_fiscali(&righe4, &fisc);

    // Il contributo cassa non ha un'aliquota propria da cui leggere la Natura:
    // a IVA 0% segue quella delle righe a 0% (es. forfettario: tutto N2.2).
    // Se le righe non ne hanno una sola, non si sceglie a caso.
    let cassa_natura = if tot.cassa_importo > 0.0 && fisc.cassa_iva <= 0.0 {
        let mut distinte: Vec<&String> = nature.iter().flatten().collect();
        distinte.sort();
        distinte.dedup();
        match distinte.as_slice() {
            [n] => Some((*n).clone()),
            [] => incompleto!("Il contributo cassa previdenziale è a IVA 0% ma nessuna riga indica una Natura da applicargli: imposta l'IVA del contributo o usa un'aliquota con Natura sulle righe"),
            _ => incompleto!("Il contributo cassa previdenziale è a IVA 0% e le righe hanno Nature diverse: non è possibile stabilire quale applicare al contributo"),
        }
    } else {
        None
    };
    if tot.cassa_importo > 0.0 {
        let aliq = fisc.cassa_iva;
        let natura = cassa_natura.clone();
        let esig = resolve_esigibilita(is_pa && aliq > 0.0, "");
        let key = format!("{}|{}|{}", js_num(aliq), natura.clone().unwrap_or_default(), esig);
        upsert_iva(&mut iva_map, key, aliq, natura, esig, tot.cassa_importo, tot.iva_cassa);
    }

    let totale = tot.totale;

    // blocchi fiscali
    let ritenuta_block = if tot.ritenuta_importo > 0.0 {
        format!(
            "\n        <DatiRitenuta>\n          <TipoRitenuta>{}</TipoRitenuta>\n          <ImportoRitenuta>{}</ImportoRitenuta>\n          <AliquotaRitenuta>{}</AliquotaRitenuta>\n          <CausalePagamento>{}</CausalePagamento>\n        </DatiRitenuta>",
            esc(or(&fisc.ritenuta_tipo, "RT02")),
            fmt2(tot.ritenuta_importo),
            fmt2(fisc.ritenuta_aliquota),
            esc(or(&fisc.ritenuta_causale, "A")),
        )
    } else {
        String::new()
    };
    let bollo_block = if tot.bollo_importo > 0.0 {
        format!("\n        <DatiBollo>\n          <BolloVirtuale>SI</BolloVirtuale>\n          <ImportoBollo>{}</ImportoBollo>\n        </DatiBollo>", fmt2(tot.bollo_importo))
    } else {
        String::new()
    };
    let cassa_block = if tot.cassa_importo > 0.0 {
        let nat = cassa_natura.as_ref().map(|n| format!("\n          <Natura>{}</Natura>", esc(n))).unwrap_or_default();
        format!(
            "\n        <DatiCassaPrevidenziale>\n          <TipoCassa>{}</TipoCassa>\n          <AlCassa>{}</AlCassa>\n          <ImportoContributoCassa>{}</ImportoContributoCassa>\n          <ImponibileCassa>{}</ImponibileCassa>\n          <AliquotaIVA>{}</AliquotaIVA>{}\n        </DatiCassaPrevidenziale>",
            esc(or(&fisc.cassa_tipo, "TC22")),
            fmt2(fisc.cassa_aliquota),
            fmt2(tot.cassa_importo),
            fmt2(tot.imponibile),
            fmt2(fisc.cassa_iva),
            nat,
        )
    } else {
        String::new()
    };
    let fiscali_block = format!("{ritenuta_block}{bollo_block}{cassa_block}");

    let p_iva_az = clean_piva(if az.p_iva.is_empty() { "00000000000" } else { &az.p_iva });
    let c_paese = country_code(&doc.c_stato);
    let (formato, mut cod_dest) = detect_formato(&doc.c_sdi);
    // Cliente estero senza codice SDI: convenzione "XXXXXXX" (non "0000000",
    // riservato al caso domestico "consegna via PEC/sconosciuto").
    if cod_dest == "0000000" && c_paese != "IT" {
        cod_dest = "XXXXXXX".to_string();
    }
    let has_pec = cod_dest == "0000000" && !doc.c_pec.is_empty();
    let progressivo = sanitize_progressivo(&doc.numero);
    let scadenza = calc_scadenza(&doc.data_emissione, doc.tp_giorni, doc.tp_fine_mese != 0);
    let tipo_doc = if is_nota {
        "TD04"
    } else {
        let date_ddt: Vec<String> = riferimenti.iter().filter(|r| r.tipo == "DDT").map(|r| r.data.clone()).collect();
        tipo_documento_fattura(&doc.tipo_documento, &doc.data_emissione, &date_ddt)
    };

    let cf_az_block = if !az.cod_fiscale.is_empty() && az.cod_fiscale != az.p_iva {
        format!("\n        <CodiceFiscale>{}</CodiceFiscale>", esc(&az.cod_fiscale))
    } else {
        String::new()
    };
    let prov_az_block = if !az.provincia.is_empty() {
        format!("\n        <Provincia>{}</Provincia>", esc(&prov2(&az.provincia)))
    } else {
        String::new()
    };
    let contatti_az_block = if !az.pec.is_empty() || !az.email.is_empty() {
        let mail = if !az.pec.is_empty() { &az.pec } else { &az.email };
        format!("\n      <Contatti><Email>{}</Email></Contatti>", esc(mail))
    } else {
        String::new()
    };

    let piva_client_block = if !doc.c_piva.is_empty() {
        format!("\n        <IdFiscaleIVA><IdPaese>{}</IdPaese><IdCodice>{}</IdCodice></IdFiscaleIVA>", c_paese, esc(&clean_piva(&doc.c_piva)))
    } else {
        String::new()
    };
    let cf_client_block = if !doc.c_cf.is_empty() {
        format!("\n        <CodiceFiscale>{}</CodiceFiscale>", esc(&doc.c_cf))
    } else {
        String::new()
    };
    let prov_client_block = if !doc.c_provincia.is_empty() {
        format!("\n        <Provincia>{}</Provincia>", esc(&prov2(&doc.c_provincia)))
    } else {
        String::new()
    };


    // DettaglioLinee
    let mut linea_num = 0;
    let mut linee: Vec<String> = Vec::new();
    for ((r, natura), &descrittiva) in righe.iter().zip(&nature).zip(&descrittive) {
        if descrittiva {
            continue;
        }
        // Una riga senza descrizione non si "aggiusta" con un'etichetta
        // inventata: finirebbe all'Agenzia delle Entrate come una linea
        // "Prodotto/Servizio" da 0 €. Meglio fermarsi e dire quale riga
        // sistemare, prima che il documento parta.
        if r.descrizione.as_deref().map(str::trim).unwrap_or("").is_empty() {
            incompleto!(
                "La riga {} non ha descrizione: completala prima di generare la fattura elettronica",
                linea_num + 1
            );
        }
        linea_num += 1;
        let q = r.quantita.unwrap_or(1.0);
        let pu = r.prezzo.unwrap_or(0.0);
        let sc = r.sconto.unwrap_or(0.0);
        let aliq = r.iva.unwrap_or(22.0);
        let imp = q * pu * (1.0 - sc / 100.0);
        let um_block = match &r.unita_misura {
            Some(u) if !u.is_empty() => format!("\n        <UnitaMisura>{}</UnitaMisura>", esc(u)),
            _ => String::new(),
        };
        let sconto_block = if sc > 0.0 {
            format!("\n        <ScontoMaggiorazione><Tipo>SC</Tipo><Percentuale>{}</Percentuale></ScontoMaggiorazione>", fmt2(sc))
        } else {
            String::new()
        };
        let natura_block = natura.as_ref().map(|n| format!("\n        <Natura>{}</Natura>", esc(n))).unwrap_or_default();
        let descr = r.descrizione.clone().unwrap_or_default();
        linee.push(format!(
            "      <DettaglioLinee>\n        <NumeroLinea>{linea_num}</NumeroLinea>\n        <Descrizione>{}</Descrizione>\n        <Quantita>{}</Quantita>{um_block}\n        <PrezzoUnitario>{}</PrezzoUnitario>{sconto_block}\n        <PrezzoTotale>{}</PrezzoTotale>\n        <AliquotaIVA>{}</AliquotaIVA>{natura_block}\n      </DettaglioLinee>",
            esc(&descr), fmt2(q), fmt2(pu), fmt2(imp), fmt2(aliq),
        ));
    }
    if linee.is_empty() {
        incompleto!("Il documento non ha righe da fatturare: servono almeno una riga con importo o un'aliquota con Natura");
    }
    let dettaglio_linee = linee.join("\n");

    // DatiRiepilogo
    let riepilogo: Vec<String> = iva_map
        .iter()
        .map(|v| {
            let natura_block = v.natura.as_ref().map(|n| format!("\n        <Natura>{}</Natura>", esc(n))).unwrap_or_default();
            format!(
                "      <DatiRiepilogo>\n        <AliquotaIVA>{}</AliquotaIVA>{natura_block}\n        <ImponibileImporto>{}</ImponibileImporto>\n        <Imposta>{}</Imposta>\n        <EsigibilitaIVA>{}</EsigibilitaIVA>\n      </DatiRiepilogo>",
                fmt2(v.aliq), fmt2(v.imp), fmt2(v.iva), v.esig,
            )
        })
        .collect();
    let dati_riepilogo = riepilogo.join("\n");

    // DatiPagamento
    let pagamento_block = if doc.tipo_pagamento_id.is_some() {
        let cond_pag = if doc.tp_immediato != 0 { "TP01" } else { "TP02" };
        format!(
            "\n    <DatiPagamento>\n      <CondizioniPagamento>{cond_pag}</CondizioniPagamento>\n      <DettaglioPagamento>\n        <ModalitaPagamento>{}</ModalitaPagamento>\n        <DataScadenzaPagamento>{scadenza}</DataScadenzaPagamento>\n        <ImportoPagamento>{}</ImportoPagamento>\n      </DettaglioPagamento>\n    </DatiPagamento>",
            map_modalita(&doc.tp_nome),
            fmt2(tot.netto_a_pagare),
        )
    } else {
        String::new()
    };

    let pec_block = if has_pec { format!("\n      <PECDestinatario>{}</PECDestinatario>", esc(&doc.c_pec)) } else { String::new() };

    // riferimenti PA
    let rif_xml = build_riferimenti_xml(&riferimenti);

    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="{formato}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>{piva_az_esc}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>{prog_esc}</ProgressivoInvio>
      <FormatoTrasmissione>{formato}</FormatoTrasmissione>
      <CodiceDestinatario>{cod_dest}</CodiceDestinatario>{pec_block}
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>{piva_az_esc}</IdCodice>
        </IdFiscaleIVA>{cf_az_block}
        <Anagrafica>
          <Denominazione>{az_nome}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>{az_regime}</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>{az_indirizzo}</Indirizzo>
        <CAP>{az_cap}</CAP>
        <Comune>{az_citta}</Comune>{prov_az_block}
        <Nazione>IT</Nazione>
      </Sede>{contatti_az_block}
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>{piva_client_block}{cf_client_block}
        <Anagrafica>
          <Denominazione>{c_nome}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>{c_via}</Indirizzo>
        <CAP>{c_cap}</CAP>
        <Comune>{c_citta}</Comune>{prov_client_block}
        <Nazione>{c_paese}</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>{tipo_doc}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>{data_emissione}</Data>
        <Numero>{numero_esc}</Numero>{fiscali_block}
        <ImportoTotaleDocumento>{totale}</ImportoTotaleDocumento>{causale}
      </DatiGeneraliDocumento>{rif_xml}
    </DatiGenerali>
    <DatiBeniServizi>
{dettaglio_linee}
{dati_riepilogo}
    </DatiBeniServizi>{pagamento_block}
  </FatturaElettronicaBody>
</p:FatturaElettronica>
"#,
        piva_az_esc = esc(&p_iva_az),
        prog_esc = esc(&progressivo),
        az_nome = esc(or(&az.ragione_sociale, "Azienda")),
        az_regime = esc(or(&az.regime_fiscale, "RF01")),
        az_indirizzo = esc(or(&az.indirizzo, "Via non specificata")),
        az_cap = pad_cap(&az.cap),
        az_citta = esc(or(&az.citta, "Comune")),
        c_nome = esc(or(&doc.c_nome, "Cliente")),
        c_via = esc(or(&doc.c_via, "Via non specificata")),
        c_cap = pad_cap(&doc.c_cap),
        c_citta = esc(or(&doc.c_citta, "Comune")),
        data_emissione = fmt_date(&doc.data_emissione),
        numero_esc = esc(&doc.numero),
        totale = fmt2(totale),
        causale = causale_blocks(&doc.note),
    ))
}

/// Tipi di riferimento resi come DatiDocumentiCorrelatiType, gli unici blocchi
/// in cui lo schema FatturaPA ammette CodiceCIG e CodiceCUP.
const RIF_CON_CIG: [&str; 5] = ["ORDINE_ACQUISTO", "CONTRATTO", "CONVENZIONE", "RICEZIONE", "FATTURA_COLLEGATA"];

/// CIG e CUP del documento (o dell'anagrafica cliente) vanno nell'ordine, nel
/// contratto o nella fattura collegata a cui si riferiscono: lo schema non li
/// ammette in DatiGeneraliDocumento, dove finivano prima, e lo SDI scartava
/// ogni fattura PA che li portava. Se un riferimento li ha già, restano i suoi;
/// altrimenti si scrivono nel primo che può ospitarli. Senza nessun riferimento
/// non c'è un numero d'ordine da inventare: ci si ferma e lo si dice.
fn colloca_cig_cup(riferimenti: &mut [Riferimento], cig: &str, cup: &str) -> anyhow::Result<()> {
    for (codice, e_cig) in [(cig, true), (cup, false)] {
        if codice.is_empty() {
            continue;
        }
        let campo = |r: &Riferimento| if e_cig { r.cig.trim().is_empty() } else { r.cup.trim().is_empty() };
        let adatti = || riferimenti.iter().filter(|r| RIF_CON_CIG.contains(&r.tipo.as_str()));
        if adatti().any(|r| !campo(r)) {
            continue;
        }
        match riferimenti.iter_mut().find(|r| RIF_CON_CIG.contains(&r.tipo.as_str())) {
            Some(r) if e_cig => r.cig = codice.to_string(),
            Some(r) => r.cup = codice.to_string(),
            None => incompleto!(
                "Il {} {} va indicato insieme all'ordine d'acquisto, al contratto o alla convenzione a cui si riferisce: aggiungilo nella scheda Riferimenti del documento",
                if e_cig { "CIG" } else { "CUP" },
                codice
            ),
        }
    }
    Ok(())
}

// ── caricamento documento/righe ──────────────────────────────────────────────

#[derive(Default)]
struct AzData {
    ragione_sociale: String,
    p_iva: String,
    cod_fiscale: String,
    indirizzo: String,
    cap: String,
    citta: String,
    provincia: String,
    regime_fiscale: String,
    pec: String,
    email: String,
}

struct DocData {
    numero: String,
    data_emissione: String,
    note: String,
    doc_cig: String,
    doc_cup: String,
    c_nome: String,
    c_via: String,
    c_cap: String,
    c_citta: String,
    c_provincia: String,
    c_stato: String,
    c_piva: String,
    c_cf: String,
    c_sdi: String,
    c_pec: String,
    c_tipo_soggetto: String,
    c_cig: String,
    c_cup: String,
    tp_nome: String,
    tp_giorni: i64,
    tp_fine_mese: i64,
    tp_immediato: i64,
    tipo_pagamento_id: Option<i64>,
    coll_numero: String,
    coll_data: String,
    tipo_documento: String,
}

fn load_doc(r: &rusqlite::Row, is_fattura: bool) -> DocData {
    let s = |k: &str| r.get::<_, Option<String>>(k).ok().flatten().unwrap_or_default();
    let i = |k: &str| r.get::<_, Option<i64>>(k).ok().flatten();
    DocData {
        numero: s("numero"),
        data_emissione: s("data_emissione"),
        note: s("note"),
        doc_cig: if is_fattura { s("cig") } else { String::new() },
        doc_cup: if is_fattura { s("cup") } else { String::new() },
        c_nome: s("c_nome"),
        c_via: s("c_via"),
        c_cap: s("c_cap"),
        c_citta: s("c_citta"),
        c_provincia: s("c_provincia"),
        c_stato: s("c_stato"),
        c_piva: s("c_piva"),
        c_cf: s("c_cf"),
        c_sdi: s("c_sdi"),
        c_pec: s("c_pec"),
        c_tipo_soggetto: s("c_tipo_soggetto"),
        c_cig: s("c_cig"),
        c_cup: s("c_cup"),
        tp_nome: s("tp_nome"),
        tp_giorni: i("tp_giorni").unwrap_or(0),
        tp_fine_mese: i("tp_fine_mese").unwrap_or(0),
        tp_immediato: i("tp_immediato").unwrap_or(0),
        tipo_pagamento_id: if is_fattura { i("tipo_pagamento_id") } else { None },
        coll_numero: s("coll_numero"),
        coll_data: s("coll_data"),
        tipo_documento: if is_fattura { s("tipo_documento") } else { String::new() },
    }
}

fn load_righe(conn: &Connection, id: i64, is_nota: bool) -> rusqlite::Result<Vec<Riga>> {
    let (table, fk) = if is_nota { ("note_credito_righe", "nota_credito_id") } else { ("fatture_righe", "fattura_id") };
    let sql = format!("SELECT tipo, descrizione, quantita, prezzo, sconto, iva, codice_iva, unita_misura FROM {table} WHERE {fk}=?1 ORDER BY id");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(Riga {
                tipo: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                descrizione: r.get::<_, Option<String>>(1)?,
                quantita: r.get::<_, Option<f64>>(2)?,
                prezzo: r.get::<_, Option<f64>>(3)?,
                sconto: r.get::<_, Option<f64>>(4)?,
                iva: r.get::<_, Option<f64>>(5)?,
                codice_iva: r.get::<_, Option<String>>(6)?.unwrap_or_default(),
                unita_misura: r.get::<_, Option<String>>(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Riferimenti della fattura: quelli scritti a mano nella scheda Riferimenti
/// più i DDT collegati (fattura creata da DDT o DDT agganciati nel dialog), che
/// altrimenti non arriverebbero mai nel blocco DatiDDT dell'XML. Un DDT già
/// scritto a mano con lo stesso numero non viene ripetuto.
fn load_riferimenti(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<Riferimento>> {
    let mut rows = load_riferimenti_manuali(conn, fattura_id)?;
    let mut stmt = conn.prepare(
        "SELECT d.numero, d.data_emissione FROM fatture_ddt fd JOIN ddt d ON d.id = fd.ddt_id \
         WHERE fd.fattura_id=?1 ORDER BY d.data_emissione, d.id",
    )?;
    let collegati = stmt
        .query_map([fattura_id], |r| {
            Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, Option<String>>(1)?.unwrap_or_default()))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (numero, data) in collegati {
        if numero.trim().is_empty() || rows.iter().any(|r| r.tipo == "DDT" && r.numero.trim() == numero.trim()) {
            continue;
        }
        rows.push(Riferimento { tipo: "DDT".into(), numero, data, cig: String::new(), cup: String::new(), commessa: String::new() });
    }
    Ok(rows)
}

fn load_riferimenti_manuali(conn: &Connection, fattura_id: i64) -> rusqlite::Result<Vec<Riferimento>> {
    let mut stmt = conn.prepare("SELECT tipo, numero, data, cig, cup, commessa FROM fatture_riferimenti WHERE fattura_id=?1 ORDER BY ordine, id")?;
    let rows = stmt
        .query_map([fattura_id], |r| {
            Ok(Riferimento {
                tipo: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                numero: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                data: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                cig: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                cup: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                commessa: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Posizione del blocco in DatiGenerali: lo schema FatturaPA è una sequence,
/// quindi un DatiDDT prima di un DatiOrdineAcquisto viene scartato dallo SDI
/// anche se l'utente li ha inseriti in quell'ordine.
fn ordine_riferimento(tipo: &str) -> u8 {
    match tipo {
        "CONTRATTO" => 1,
        "CONVENZIONE" => 2,
        "RICEZIONE" => 3,
        "FATTURA_COLLEGATA" => 4,
        "DDT" => 6,
        _ => 0, // ORDINE_ACQUISTO e sconosciuti (resi come DatiOrdineAcquisto)
    }
}

fn build_riferimenti_xml(riferimenti: &[Riferimento]) -> String {
    if riferimenti.is_empty() {
        return String::new();
    }
    let mut ordinati: Vec<&Riferimento> = riferimenti.iter().collect();
    ordinati.sort_by_key(|r| ordine_riferimento(&r.tipo));
    let blocks: Vec<String> = ordinati
        .into_iter()
        .map(|r| {
            let tag = match r.tipo.as_str() {
                "ORDINE_ACQUISTO" => "DatiOrdineAcquisto",
                "CONTRATTO" => "DatiContratto",
                "CONVENZIONE" => "DatiConvenzione",
                "RICEZIONE" => "DatiRicezione",
                "FATTURA_COLLEGATA" => "DatiFattureCollegate",
                "DDT" => "DatiDDT",
                _ => "DatiOrdineAcquisto",
            };
            if r.tipo == "DDT" {
                let data_block = if !r.data.is_empty() { format!("\n      <DataDDT>{}</DataDDT>", fmt_date(&r.data)) } else { String::new() };
                format!("    <DatiDDT>\n      <NumeroDDT>{}</NumeroDDT>{data_block}\n    </DatiDDT>", esc(&r.numero))
            } else {
                let data_block = if !r.data.is_empty() { format!("\n      <Data>{}</Data>", fmt_date(&r.data)) } else { String::new() };
                let commessa_block = if !r.commessa.is_empty() { format!("\n      <CodiceCommessaConvenzione>{}</CodiceCommessaConvenzione>", esc(&r.commessa)) } else { String::new() };
                let cup_block = if !r.cup.is_empty() { format!("\n      <CodiceCUP>{}</CodiceCUP>", esc(&r.cup)) } else { String::new() };
                let cig_block = if !r.cig.is_empty() { format!("\n      <CodiceCIG>{}</CodiceCIG>", esc(&r.cig)) } else { String::new() };
                format!("    <{tag}>\n      <IdDocumento>{}</IdDocumento>{data_block}{commessa_block}{cup_block}{cig_block}\n    </{tag}>", esc(&r.numero))
            }
        })
        .collect();
    format!("\n{}", blocks.join("\n"))
}

// ── micro-helpers ────────────────────────────────────────────────────────────

struct IvaEntry {
    key: String,
    aliq: f64,
    natura: Option<String>,
    esig: &'static str,
    imp: f64,
    iva: f64,
}

fn upsert_iva(map: &mut Vec<IvaEntry>, key: String, aliq: f64, natura: Option<String>, esig: &'static str, imp: f64, iva: f64) {
    if let Some(e) = map.iter_mut().find(|e| e.key == key) {
        e.imp += imp;
        e.iva += iva;
    } else {
        map.push(IvaEntry { key, aliq, natura, esig, imp, iva });
    }
}

/// Formattazione di un numero come template literal JS (intero se senza decimali).
fn js_num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        // JS usa la rappresentazione più corta; per le aliquote (1-2 decimali) basta questo.
        let s = format!("{v}");
        s
    }
}

fn or<'a>(s: &'a str, default: &'a str) -> &'a str {
    if s.is_empty() {
        default
    } else {
        s
    }
}

fn prov2(s: &str) -> String {
    s.chars().take(2).collect::<String>().to_uppercase()
}

fn first_truthy_trim(opts: &[&str]) -> String {
    for o in opts {
        if !o.is_empty() {
            return o.trim().to_string();
        }
    }
    String::new()
}

// ── Autofattura per acquisti dall'estero (TD17 / TD18 / TD19) ────────────────
//
// È il documento con cui l'acquirente italiano assolve l'IVA su un acquisto da
// un fornitore estero. Rispetto a una fattura normale tutto è capovolto:
//
//  - CedentePrestatore  = il FORNITORE ESTERO (con la sua partita IVA e nazione)
//  - CessionarioCommittente = la PROPRIA AZIENDA
//  - DatiFattureCollegate riporta numero e data della fattura estera ricevuta
//  - TipoDocumento è TD17 (servizi), TD18 (beni UE) o TD19 (beni già in Italia)
//  - la Data è quella di ricezione (fornitori UE) o di effettuazione (extra-UE)
//
// L'IVA applicata è quella italiana: l'imponibile della fattura estera con
// l'aliquota che sarebbe dovuta in Italia. Il documento va poi annotato sia nel
// registro delle vendite sia in quello degli acquisti.

/// Dati del fornitore estero, così come vanno nel blocco CedentePrestatore.
struct FornitoreEstero {
    denominazione: String,
    p_iva: String,
    paese: String,
    indirizzo: String,
    cap: String,
    citta: String,
    provincia: String,
}

/// Genera l'XML di un'autofattura. `id` è quello della tabella `autofatture`.
pub fn build_autofattura_pa(conn: &Connection, id: i64) -> anyhow::Result<String> {
    let az = conn
        .query_row("SELECT * FROM azienda WHERE id=1", [], |r| {
            let s = |k: &str| r.get::<_, Option<String>>(k).ok().flatten().unwrap_or_default();
            Ok(AzData {
                ragione_sociale: s("ragione_sociale"),
                p_iva: s("p_iva"),
                cod_fiscale: s("cod_fiscale"),
                indirizzo: s("indirizzo"),
                cap: s("cap"),
                citta: s("citta"),
                provincia: s("provincia"),
                regime_fiscale: s("regime_fiscale"),
                pec: s("pec"),
                email: s("email"),
            })
        })
        .optional()?
        .unwrap_or_default();

    let (numero, data, tipo_doc, fe_numero, fe_data, note, fornitore_id) = conn.query_row(
        "SELECT numero, data, tipo_documento, fattura_estera_numero, fattura_estera_data, note, fornitore_id \
         FROM autofatture WHERE id=?1",
        [id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "TD17".into()),
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                r.get::<_, Option<i64>>(6)?,
            ))
        },
    )?;

    let forn = fornitore_id
        .and_then(|fid| {
            conn.query_row(
                "SELECT ragione_sociale, p_iva, stato, via, cap, citta, provincia FROM fornitori WHERE id=?1",
                [fid],
                |r| {
                    let s = |i: usize| r.get::<_, Option<String>>(i).unwrap_or_default().unwrap_or_default();
                    Ok(FornitoreEstero {
                        denominazione: s(0),
                        p_iva: s(1),
                        paese: s(2),
                        indirizzo: s(3),
                        cap: s(4),
                        citta: s(5),
                        provincia: s(6),
                    })
                },
            )
            .optional()
            .ok()
            .flatten()
        })
        .ok_or_else(|| anyhow::anyhow!("Autofattura senza fornitore: serve il fornitore estero"))?;

    // La nazione del fornitore decide anche l'IdPaese della sua partita IVA.
    let paese = country_code_opt(&forn.paese).ok_or_else(|| {
        anyhow::anyhow!("Nazione del fornitore non riconosciuta: \"{}\"", forn.paese.trim())
    })?;
    if paese == "IT" {
        incompleto!("Il fornitore risulta italiano: l'autofattura per acquisti esteri richiede un fornitore estero");
    }

    let mut righe_xml = String::new();
    let mut riepilogo: std::collections::BTreeMap<String, (f64, f64)> = std::collections::BTreeMap::new();
    let mut totale = 0.0f64;
    let mut stmt = conn.prepare(
        "SELECT descrizione, quantita, unita_misura, prezzo, iva FROM autofatture_righe WHERE autofattura_id=?1 ORDER BY id",
    )?;
    let righe = stmt.query_map([id], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?.unwrap_or_default(),
            r.get::<_, Option<f64>>(1)?.unwrap_or(1.0),
            r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
            r.get::<_, Option<f64>>(4)?.unwrap_or(22.0),
        ))
    })?;

    for (i, riga) in righe.enumerate() {
        let (descr, qta, um, prezzo, aliq) = riga?;
        let imponibile = (qta * prezzo * 100.0).round() / 100.0;
        totale += imponibile + (imponibile * aliq / 100.0);
        let um_block = if um.trim().is_empty() {
            String::new()
        } else {
            format!("\n        <UnitaMisura>{}</UnitaMisura>", esc(um.trim()))
        };
        righe_xml.push_str(&format!(
            "\n      <DettaglioLinee>\n        <NumeroLinea>{}</NumeroLinea>\n        <Descrizione>{}</Descrizione>\n        <Quantita>{:.2}</Quantita>{}\n        <PrezzoUnitario>{}</PrezzoUnitario>\n        <PrezzoTotale>{}</PrezzoTotale>\n        <AliquotaIVA>{}</AliquotaIVA>\n      </DettaglioLinee>",
            i + 1,
            esc(&descr),
            qta,
            um_block,
            fmt2(prezzo),
            fmt2(imponibile),
            fmt2(aliq),
        ));
        let e = riepilogo.entry(fmt2(aliq)).or_insert((0.0, 0.0));
        e.0 += imponibile;
        e.1 += imponibile * aliq / 100.0;
    }
    if righe_xml.is_empty() {
        incompleto!("L'autofattura non ha righe");
    }

    let riepilogo_xml: String = riepilogo
        .iter()
        .map(|(aliq, (imp, imposta))| {
            format!(
                "\n      <DatiRiepilogo>\n        <AliquotaIVA>{}</AliquotaIVA>\n        <ImponibileImporto>{}</ImponibileImporto>\n        <Imposta>{}</Imposta>\n        <EsigibilitaIVA>I</EsigibilitaIVA>\n      </DatiRiepilogo>",
                aliq,
                fmt2((imp * 100.0).round() / 100.0),
                fmt2((imposta * 100.0).round() / 100.0),
            )
        })
        .collect();

    // Estremi della fattura estera: obbligatori per queste autofatture.
    let collegate = if fe_numero.trim().is_empty() {
        String::new()
    } else {
        let data_block = if fe_data.trim().is_empty() {
            String::new()
        } else {
            format!("\n        <Data>{}</Data>", fmt_date(&fe_data))
        };
        format!(
            "\n      <DatiFattureCollegate>\n        <IdDocumento>{}</IdDocumento>{}\n      </DatiFattureCollegate>",
            esc(fe_numero.trim()),
            data_block
        )
    };

    let prog = sanitize_progressivo(&numero);
    let piva_az = esc(&clean_piva(&az.p_iva));
    let cf_az_block = if az.cod_fiscale.trim().is_empty() {
        String::new()
    } else {
        format!("\n        <CodiceFiscale>{}</CodiceFiscale>", esc(az.cod_fiscale.trim()))
    };
    // La partita IVA estera può mancare (privati o soggetti senza VAT): in quel
    // caso si usa il codice convenzionale previsto dalle specifiche.
    let piva_forn = {
        let p = clean_piva(&forn.p_iva);
        if p.is_empty() { "OO99999999999".to_string() } else { p }
    };
    let prov_forn = if forn.provincia.trim().len() == 2 {
        format!("\n        <Provincia>{}</Provincia>", esc(forn.provincia.trim()))
    } else {
        String::new()
    };
    let prov_az = if az.provincia.trim().len() == 2 {
        format!("\n        <Provincia>{}</Provincia>", esc(az.provincia.trim()))
    } else {
        String::new()
    };
    let causale = causale_blocks(&note);

    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>{piva_az}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>{prog}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>{paese}</IdPaese>
          <IdCodice>{piva_forn}</IdCodice>
        </IdFiscaleIVA>
        <Anagrafica>
          <Denominazione>{forn_nome}</Denominazione>
        </Anagrafica>
        <RegimeFiscale>RF18</RegimeFiscale>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>{forn_indirizzo}</Indirizzo>
        <CAP>{forn_cap}</CAP>
        <Comune>{forn_citta}</Comune>{prov_forn}
        <Nazione>{paese}</Nazione>
      </Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>{piva_az}</IdCodice>
        </IdFiscaleIVA>{cf_az_block}
        <Anagrafica>
          <Denominazione>{az_nome}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>{az_indirizzo}</Indirizzo>
        <CAP>{az_cap}</CAP>
        <Comune>{az_citta}</Comune>{prov_az}
        <Nazione>IT</Nazione>
      </Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>{tipo_doc}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>{data}</Data>
        <Numero>{numero_esc}</Numero>
        <ImportoTotaleDocumento>{totale}</ImportoTotaleDocumento>{causale}
      </DatiGeneraliDocumento>{collegate}
    </DatiGenerali>
    <DatiBeniServizi>{righe_xml}{riepilogo_xml}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
"#,
        piva_az = piva_az,
        prog = esc(&prog),
        paese = paese,
        piva_forn = esc(&piva_forn),
        forn_nome = esc(&forn.denominazione),
        forn_indirizzo = esc(if forn.indirizzo.trim().is_empty() { "-" } else { forn.indirizzo.trim() }),
        forn_cap = esc(&pad_cap(&forn.cap)),
        forn_citta = esc(if forn.citta.trim().is_empty() { "-" } else { forn.citta.trim() }),
        prov_forn = prov_forn,
        cf_az_block = cf_az_block,
        az_nome = esc(&az.ragione_sociale),
        az_indirizzo = esc(if az.indirizzo.trim().is_empty() { "-" } else { az.indirizzo.trim() }),
        az_cap = esc(&pad_cap(&az.cap)),
        az_citta = esc(if az.citta.trim().is_empty() { "-" } else { az.citta.trim() }),
        prov_az = prov_az,
        tipo_doc = esc(&tipo_doc),
        data = fmt_date(&data),
        numero_esc = esc(&numero),
        totale = fmt2((totale * 100.0).round() / 100.0),
        causale = causale,
        collegate = collegate,
        righe_xml = righe_xml,
        riepilogo_xml = riepilogo_xml,
    ))
}

#[cfg(test)]
mod test_autofattura {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema/tenant.sql")).unwrap();
        c.execute(
            "INSERT INTO azienda (id, ragione_sociale, p_iva, cod_fiscale, indirizzo, cap, citta, provincia) \
             VALUES (1,'Rossi Srl','01234567890','01234567890','Via Roma 1','37100','Verona','VR')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO fornitori (id, ragione_sociale, p_iva, stato, via, cap, citta) \
             VALUES (1,'Bauer GmbH','DE123456789','Germania','Hauptstr. 5','80331','Muenchen')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO autofatture (id,numero,data,tipo_documento,fornitore_id,fattura_estera_numero,fattura_estera_data) \
             VALUES (1,'AF-1','2026-09-10','TD18',1,'R-778','2026-09-01')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO autofatture_righe (autofattura_id,descrizione,quantita,unita_misura,prezzo,iva) \
             VALUES (1,'Batterie 12V',10,'PZ',20.0,22)",
            [],
        )
        .unwrap();
        c
    }

    /// Nell'autofattura le parti sono invertite: cedente è il fornitore estero,
    /// cessionario è chi usa il gestionale. Se si sbaglia questo, lo SdI scarta.
    #[test]
    fn il_cedente_e_il_fornitore_estero_e_il_cessionario_l_azienda() {
        let x = build_autofattura_pa(&db(), 1).unwrap();
        let cedente = x.split("<CedentePrestatore>").nth(1).unwrap();
        let cedente = cedente.split("</CedentePrestatore>").next().unwrap();
        assert!(cedente.contains("<Denominazione>Bauer GmbH</Denominazione>"));
        assert!(cedente.contains("<IdPaese>DE</IdPaese>"));
        assert!(cedente.contains("<IdCodice>DE123456789</IdCodice>"));

        let cess = x.split("<CessionarioCommittente>").nth(1).unwrap();
        let cess = cess.split("</CessionarioCommittente>").next().unwrap();
        assert!(cess.contains("<Denominazione>Rossi Srl</Denominazione>"));
        assert!(cess.contains("<IdCodice>01234567890</IdCodice>"));
    }

    /// Tipo documento, estremi della fattura estera e IVA italiana: sono i tre
    /// elementi che distinguono l'autofattura da una fattura qualsiasi.
    #[test]
    fn riporta_tipo_fattura_collegata_e_imposta() {
        let x = build_autofattura_pa(&db(), 1).unwrap();
        assert!(x.contains("<TipoDocumento>TD18</TipoDocumento>"));
        assert!(x.contains("<IdDocumento>R-778</IdDocumento>"));
        assert!(x.contains("<Data>2026-09-01</Data>"));
        assert!(x.contains("<ImponibileImporto>200.00</ImponibileImporto>"));
        assert!(x.contains("<Imposta>44.00</Imposta>"));
        assert!(x.contains("<ImportoTotaleDocumento>244.00</ImportoTotaleDocumento>"));
        assert!(x.contains("<Divisa>EUR</Divisa>"), "gli importi si registrano in euro");
    }

    /// Un fornitore italiano o senza nazione riconoscibile non può stare in
    /// un'autofattura per acquisti esteri: meglio fermarsi qui che allo SdI.
    #[test]
    fn si_rifiuta_di_generare_con_un_fornitore_non_estero() {
        let c = db();
        c.execute("UPDATE fornitori SET stato='Italia' WHERE id=1", []).unwrap();
        assert!(build_autofattura_pa(&c, 1).is_err());
        c.execute("UPDATE fornitori SET stato='Terra di mezzo' WHERE id=1", []).unwrap();
        let e = build_autofattura_pa(&c, 1).unwrap_err().to_string();
        assert!(e.contains("Nazione"), "messaggio poco chiaro: {e}");
    }

    /// Senza partita IVA (fornitori che non ne hanno) si usa il codice
    /// convenzionale, altrimenti il file non sarebbe nemmeno valido.
    #[test]
    fn senza_partita_iva_usa_il_codice_convenzionale() {
        let c = db();
        c.execute("UPDATE fornitori SET p_iva='' WHERE id=1", []).unwrap();
        let x = build_autofattura_pa(&c, 1).unwrap();
        assert!(x.contains("<IdCodice>OO99999999999</IdCodice>"));
    }
}

#[cfg(test)]
mod test_tipo_e_natura {
    use super::*;

    /// Fattura del 30/09 a un cliente, con una riga al 22%; due aliquote a 0%,
    /// una con Natura (E10 → N4) e una senza (X0).
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("schema/tenant.sql")).unwrap();
        c.execute("INSERT INTO clienti (id, ragione_sociale) VALUES (1,'Ferramenta Bianchi')", []).unwrap();
        c.execute("INSERT INTO aliquote_iva (nome, valore, codice, natura) VALUES ('Esente art. 10',0,'E10','N4')", []).unwrap();
        c.execute("INSERT INTO aliquote_iva (nome, valore, codice, natura) VALUES ('Senza natura',0,'X0',NULL)", []).unwrap();
        c.execute("INSERT INTO fatture (id, numero, data_emissione, cliente_id, stato) VALUES (1,'2026/7','2026-09-30',1,'EMESSA')", []).unwrap();
        c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva) VALUES (1,'Viti',10,2,22)", []).unwrap();
        c
    }

    fn ddt(c: &Connection, id: i64, numero: &str, data: &str) {
        c.execute("INSERT INTO ddt (id, numero, data_emissione, cliente_id) VALUES (?1,?2,?3,1)", rusqlite::params![id, numero, data]).unwrap();
        c.execute("INSERT INTO fatture_ddt (fattura_id, ddt_id) VALUES (1,?1)", [id]).unwrap();
    }

    fn tipo(xml: &str) -> &str {
        let i = xml.find("<TipoDocumento>").unwrap() + "<TipoDocumento>".len();
        &xml[i..i + 4]
    }

    #[test]
    fn senza_ddt_e_immediata() {
        let c = db();
        assert_eq!(tipo(&build_fattura_pa(&c, 1, false).unwrap()), "TD01");
    }

    #[test]
    fn ddt_del_mese_rendono_la_fattura_differita_e_finiscono_in_dati_ddt() {
        let c = db();
        ddt(&c, 1, "D12", "2026-09-03");
        ddt(&c, 2, "D19", "2026-09-17");
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert_eq!(tipo(&xml), "TD24");
        assert!(xml.contains("<NumeroDDT>D12</NumeroDDT>\n      <DataDDT>2026-09-03</DataDDT>"));
        assert!(xml.contains("<NumeroDDT>D19</NumeroDDT>"));
    }

    #[test]
    fn ddt_dello_stesso_giorno_accompagna_una_immediata() {
        let c = db();
        ddt(&c, 1, "D30", "2026-09-30");
        assert_eq!(tipo(&build_fattura_pa(&c, 1, false).unwrap()), "TD01");
    }

    #[test]
    fn la_scelta_manuale_vince_sull_automatico() {
        let c = db();
        ddt(&c, 1, "D12", "2026-09-03");
        c.execute("UPDATE fatture SET tipo_documento='TD01' WHERE id=1", []).unwrap();
        assert_eq!(tipo(&build_fattura_pa(&c, 1, false).unwrap()), "TD01");
        c.execute("DELETE FROM fatture_ddt", []).unwrap();
        c.execute("UPDATE fatture SET tipo_documento='TD24' WHERE id=1", []).unwrap();
        assert_eq!(tipo(&build_fattura_pa(&c, 1, false).unwrap()), "TD24");
    }

    #[test]
    fn ddt_scritto_a_mano_e_collegato_non_si_ripete() {
        let c = db();
        ddt(&c, 1, "D12", "2026-09-03");
        c.execute("INSERT INTO fatture_riferimenti (fattura_id, tipo, numero, data, ordine) VALUES (1,'DDT','D12','2026-09-03',0)", []).unwrap();
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert_eq!(xml.matches("<NumeroDDT>D12</NumeroDDT>").count(), 1);
    }

    #[test]
    fn riferimenti_in_ordine_di_schema() {
        let c = db();
        c.execute("INSERT INTO fatture_riferimenti (fattura_id, tipo, numero, data, ordine) VALUES (1,'DDT','D1','2026-09-01',0)", []).unwrap();
        c.execute("INSERT INTO fatture_riferimenti (fattura_id, tipo, numero, data, ordine) VALUES (1,'ORDINE_ACQUISTO','OA9','',1)", []).unwrap();
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert!(xml.find("<DatiOrdineAcquisto>").unwrap() < xml.find("<DatiDDT>").unwrap());
    }

    #[test]
    fn iva_zero_con_natura_la_riporta() {
        let c = db();
        c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva, codice_iva) VALUES (1,'Corso',1,100,0,'E10')", []).unwrap();
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert!(xml.contains("<Natura>N4</Natura>"));
    }

    #[test]
    fn iva_zero_senza_natura_si_ferma_invece_di_indovinare() {
        let c = db();
        for codice in ["", "X0", "INESISTENTE"] {
            c.execute("DELETE FROM fatture_righe WHERE iva=0", []).unwrap();
            c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva, codice_iva) VALUES (1,'Export',1,100,0,?1)", [codice]).unwrap();
            let err = build_fattura_pa(&c, 1, false).unwrap_err();
            assert!(err.downcast_ref::<DocumentoIncompleto>().is_some(), "codice {codice:?}: {err}");
            assert!(err.to_string().contains("riga 2"), "{err}");
        }
    }

    #[test]
    fn riga_da_zero_euro_senza_natura_resta_fuori() {
        let c = db();
        c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva) VALUES (1,'Riferimento fattura n. 3',0,0,0)", []).unwrap();
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert!(!xml.contains("Riferimento fattura"));
        assert_eq!(xml.matches("<DettaglioLinee>").count(), 1);
    }

    #[test]
    fn le_righe_nota_non_chiedono_natura() {
        let c = db();
        c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva, tipo) VALUES (1,'Rif. DDT D12',0,0,0,'NOTA')", []).unwrap();
        assert!(build_fattura_pa(&c, 1, false).is_ok());
    }

    #[test]
    fn nota_di_credito_legge_la_natura_della_propria_riga() {
        let c = db();
        c.execute("INSERT INTO note_credito (id, numero, data_emissione, cliente_id) VALUES (1,'NC1','2026-09-30',1)", []).unwrap();
        c.execute("INSERT INTO note_credito_righe (nota_credito_id, descrizione, quantita, prezzo, iva, codice_iva) VALUES (1,'Reso corso',1,100,0,'E10')", []).unwrap();
        let xml = build_fattura_pa(&c, 1, true).unwrap();
        assert!(xml.contains("<TipoDocumento>TD04</TipoDocumento>"));
        assert!(xml.contains("<Natura>N4</Natura>"));
    }

    #[test]
    fn cassa_a_iva_zero_prende_la_natura_unica_delle_righe() {
        let c = db();
        c.execute("DELETE FROM fatture_righe", []).unwrap();
        c.execute("INSERT INTO fatture_righe (fattura_id, descrizione, quantita, prezzo, iva, codice_iva) VALUES (1,'Consulenza',1,1000,0,'E10')", []).unwrap();
        c.execute("UPDATE fatture SET cassa_tipo='TC22', cassa_aliquota=4, cassa_iva=0 WHERE id=1", []).unwrap();
        let xml = build_fattura_pa(&c, 1, false).unwrap();
        assert!(xml.contains("<AliquotaIVA>0.00</AliquotaIVA>\n          <Natura>N4</Natura>\n        </DatiCassaPrevidenziale>"));
        // Cassa a 0% su sole righe imponibili: nessuna Natura da cui partire.
        c.execute("UPDATE fatture_righe SET iva=22, codice_iva=''", []).unwrap();
        assert!(build_fattura_pa(&c, 1, false).is_err());
    }
}

#[cfg(test)]
#[path = "xml_corpus_tests.rs"]
mod corpus;
