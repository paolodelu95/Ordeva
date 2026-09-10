//! Estrazione dei campi di una fattura (o di uno scontrino) dal testo grezzo.
//!
//! Sostituisce il modello Mindee dell'edizione SaaS: il testo arriva dal frontend,
//! che lo ricava dal layer testuale del PDF (pdf.js) o, per scansioni e foto,
//! dall'OCR locale in WASM (tesseract.js). Qui non si va in rete e non serve
//! nessuna chiave: sono euristiche sul formato dei documenti italiani.
//!
//! Precisione attesa: alta sui PDF nativi (il testo è esatto), più bassa sulle
//! scansioni, dove l'OCR confonde cifre e separatori. Per questo l'esito è
//! sempre un *suggerimento* che l'utente rivede prima di confermare.

use serde_json::{json, Value};

/// Forme di data riconosciute: 31/12/2026, 31-12-2026, 31.12.2026, 2026-12-31.
/// Ritorna sempre ISO (yyyy-mm-dd), o None se la data non è plausibile.
pub fn normalizza_data(s: &str) -> Option<String> {
    let cifre: Vec<&str> = s
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .collect();
    if cifre.len() < 3 {
        return None;
    }
    let (a, b, c) = (cifre[0], cifre[1], cifre[2]);
    let (y, m, d) = if a.len() == 4 {
        (a.parse::<i64>().ok()?, b.parse::<i64>().ok()?, c.parse::<i64>().ok()?)
    } else {
        let y = c.parse::<i64>().ok()?;
        // Anno a due cifre: 26 → 2026 (i documenti in gestionale sono recenti).
        let y = if c.len() == 2 { 2000 + y } else { y };
        (y, b.parse::<i64>().ok()?, a.parse::<i64>().ok()?)
    };
    if !(1900..=2999).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// Converte un importo scritto all'italiana (1.234,56) o all'inglese (1,234.56).
/// La regola: l'ULTIMO separatore è quello decimale se seguito da 1-2 cifre.
pub fn parse_importo(s: &str) -> Option<f64> {
    let pulito: String = s
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == ',' || *c == '.' || *c == '-')
        .collect();
    if pulito.is_empty() || !pulito.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let ultimo_sep = pulito.rfind([',', '.']);
    let norm = match ultimo_sep {
        Some(i) => {
            let decimali = pulito.len() - i - 1;
            if decimali >= 1 && decimali <= 2 {
                // separatore decimale: via tutti gli altri, quello resta un punto
                let (int_part, dec_part) = pulito.split_at(i);
                let int_part: String = int_part.chars().filter(|c| c.is_ascii_digit() || *c == '-').collect();
                format!("{int_part}.{}", &dec_part[1..])
            } else {
                // migliaia: tutti i separatori sono rumore
                pulito.chars().filter(|c| c.is_ascii_digit() || *c == '-').collect()
            }
        }
        None => pulito.clone(),
    };
    norm.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Prima P.IVA italiana valida trovata nel testo (11 cifre, con o senza "IT").
/// Se `escludi` è valorizzata (la P.IVA dell'azienda che usa il gestionale), la
/// salta: su una fattura passiva compaiono entrambe, e quella utile è l'altra.
pub fn trova_piva(testo: &str, escludi: Option<&str>) -> String {
    let escludi = escludi.map(|p| solo_cifre(p)).unwrap_or_default();
    let bytes: Vec<char> = testo.chars().collect();
    let mut i = 0usize;
    let mut fallback = String::new();
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i - start == 11 {
                let cand: String = bytes[start..i].iter().collect();
                if valida_piva(&cand) {
                    if !escludi.is_empty() && cand == escludi {
                        continue;
                    }
                    return cand;
                }
                if fallback.is_empty() && (escludi.is_empty() || cand != escludi) {
                    fallback = cand;
                }
            }
        } else {
            i += 1;
        }
    }
    fallback
}

fn solo_cifre(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// Checksum della partita IVA italiana (algoritmo di Luhn nella variante ministeriale).
/// Serve a scartare i numeri a 11 cifre che P.IVA non sono (codici, importi, IBAN spezzati).
pub fn valida_piva(p: &str) -> bool {
    if p.len() != 11 || !p.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    let d: Vec<u32> = p.chars().map(|c| c.to_digit(10).unwrap()).collect();
    let mut somma = 0u32;
    for (i, v) in d.iter().enumerate().take(10) {
        if i % 2 == 0 {
            somma += v;
        } else {
            let x = v * 2;
            somma += if x > 9 { x - 9 } else { x };
        }
    }
    let check = (10 - (somma % 10)) % 10;
    check == d[10]
}

/// Etichette che precedono il numero del documento, in ordine di specificità.
/// Coprono sia le fatture sia i DDT: il numero si cerca allo stesso modo, è
/// solo l'etichetta che cambia da un fornitore all'altro.
const ETICHETTE_NUMERO: [&str; 14] = [
    "fattura n",
    "fattura nr",
    "fattura numero",
    "documento di trasporto n",
    "documento di trasporto nr",
    "d.d.t. n",
    "d.d.t n",
    "ddt n",
    "bolla n",
    "documento n",
    "n. fattura",
    "numero fattura",
    "nr. fattura",
    "invoice n",
];

/// Numero del documento. Cerca prima le etichette esplicite, poi ripiega su una
/// riga che contenga "fattura" e un token con cifre.
pub fn trova_numero(testo: &str) -> String {
    let low = testo.to_lowercase();
    for et in ETICHETTE_NUMERO {
        if let Some(pos) = low.find(et) {
            let resto = &testo[pos + et.len()..];
            if let Some(n) = primo_token_numero(resto) {
                return n;
            }
        }
    }
    for riga in testo.lines() {
        let l = riga.to_lowercase();
        if ["fattura", "ft.", "documento di trasporto", "d.d.t", "ddt", "bolla"]
            .iter()
            .any(|k| l.contains(k))
        {
            if let Some(n) = primo_token_numero(riga) {
                return n;
            }
        }
    }
    String::new()
}

/// Primo token che contiene almeno una cifra, ripulito dalla punteggiatura di
/// contorno. Accetta le forme composte tipiche: 123/A, 2026/FT/0007, 12-B.
fn primo_token_numero(s: &str) -> Option<String> {
    for tok in s.split_whitespace().take(6) {
        let t: String = tok
            .trim_matches(|c: char| !c.is_alphanumeric())
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '/' || *c == '-' || *c == '_')
            .collect();
        if t.is_empty() || t.len() > 24 {
            continue;
        }
        if t.chars().any(|c| c.is_ascii_digit()) {
            // Una data non è un numero documento.
            if normalizza_data(&t).is_some() && t.matches(['/', '-']).count() >= 2 {
                continue;
            }
            let low = t.to_lowercase();
            if low == "n" || low == "nr" || low == "numero" {
                continue;
            }
            return Some(t);
        }
    }
    None
}

/// Data del documento: preferisce quella accanto a un'etichetta ("data fattura",
/// "del"), altrimenti la prima data plausibile del testo.
pub fn trova_data(testo: &str) -> String {
    let low = testo.to_lowercase();
    for et in ["data fattura", "data documento", "data emissione", "data:", " del "] {
        if let Some(pos) = low.find(et) {
            if let Some(d) = prima_data(&testo[pos + et.len()..]) {
                return d;
            }
        }
    }
    prima_data(testo).unwrap_or_default()
}

fn prima_data(s: &str) -> Option<String> {
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len()
                && (chars[i].is_ascii_digit() || chars[i] == '/' || chars[i] == '-' || chars[i] == '.')
            {
                i += 1;
            }
            let tok: String = chars[start..i].iter().collect();
            if tok.matches(['/', '-', '.']).count() == 2 {
                if let Some(d) = normalizza_data(&tok) {
                    return Some(d);
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Forme societarie: la riga che ne contiene una è quasi sempre la ragione sociale.
const FORME: [&str; 41] = [
    // italiane
    "s.r.l", "srl", "s.p.a", "spa", "s.n.c", "snc", "s.a.s", "sas", "s.s.", "sc arl", "societa", "società",
    // estere: senza queste, su una fattura estera la ragione sociale del
    // fornitore non si trovava e al suo posto finiva una riga qualsiasi
    // dell'intestazione (su una fattura spagnola: "Spain IT").
    "gmbh", "ag", "kg", "ohg", "ug", "ltd", "limited", "plc", "llp", "inc", "llc", "corp",
    "s.l.u", "s.l.", "sl", "s.a.u", "b.v", "bv", "n.v", "nv", "a/s", "aps", "ab", "oy", "sarl",
    "s.a.s.u", "sasu", "sp. z o.o", "s.r.o",
];


/// Partita IVA di un soggetto ESTERO: due lettere di paese (diverso da IT)
/// seguite dal codice. Su una fattura estera `trova_piva` non serve — cerca
/// solo numeri italiani a 11 cifre — e l'unico che trova è quello del
/// destinatario, cioè dell'azienda che sta leggendo la fattura: il fornitore
/// verrebbe cercato in anagrafica con la partita IVA sbagliata.
pub fn trova_piva_estera(testo: &str) -> String {
    for riga in testo.lines().take(60) {
        for tok in riga.split(|c: char| !c.is_ascii_alphanumeric()) {
            if tok.len() < 8 || tok.len() > 14 {
                continue;
            }
            let up = tok.to_uppercase();
            let (paese, resto) = up.split_at(2);
            if !paese.chars().all(|c| c.is_ascii_uppercase()) || paese == "IT" {
                continue;
            }
            // Deve essere un paese vero e il resto deve contenere soprattutto cifre.
            if crate::xml::country_code_opt_da_sigla(paese).is_none() {
                continue;
            }
            let cifre = resto.chars().filter(|c| c.is_ascii_digit()).count();
            if cifre >= 6 && resto.chars().all(|c| c.is_ascii_alphanumeric()) {
                return up;
            }
        }
    }
    String::new()
}

/// La riga contiene una forma societaria come parola a sé? Cercarla come
/// semplice sottostringa farebbe scattare "sl" dentro "Oslo" o "ag" dentro
/// "Pagamento".
fn contiene_forma(low: &str) -> bool {
    let parole: Vec<&str> = low
        .split(|c: char| c.is_whitespace() || c == ',' || c == ';')
        .map(|p| p.trim_matches(|c: char| c == '(' || c == ')' || c == ':'))
        .filter(|p| !p.is_empty())
        .collect();
    FORME.iter().any(|f| {
        if f.contains(' ') || f.contains('.') {
            // Forme con punti o spazi ("s.r.l", "sp. z o.o"): il confronto per
            // parole le spezzerebbe, quindi qui vale la sottostringa.
            low.contains(f)
        } else {
            parole.iter().any(|p| p.trim_end_matches('.') == *f)
        }
    })
}

/// Ragione sociale del fornitore: la prima riga con una forma societaria; in
/// mancanza, la prima riga "da intestazione" (corta, con lettere, senza importi).
pub fn trova_fornitore(testo: &str, escludi: Option<&str>) -> String {
    let escludi_norm = escludi.map(|s| s.to_lowercase()).unwrap_or_default();
    let righe: Vec<&str> = testo.lines().map(|r| r.trim()).filter(|r| !r.is_empty()).collect();

    // Emittente e cliente sono spesso affiancati e finiscono sulla stessa riga,
    // separati da un tabulatore. Il confronto va fatto CELLA PER CELLA: filtrare
    // l'intera riga perché contiene il nome del destinatario scarterebbe anche
    // la colonna del fornitore, che è lì accanto.
    let celle_utili = |riga: &str| -> Vec<String> {
        riga.split('\t')
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .filter(|c| escludi_norm.is_empty() || !c.to_lowercase().contains(&escludi_norm))
            .collect()
    };

    for riga in righe.iter().take(40) {
        for cella in celle_utili(riga) {
            if cella.len() <= 80 && contiene_forma(&cella.to_lowercase()) {
                return ripulisci_ragione(&cella);
            }
        }
    }
    for riga in righe.iter().take(8) {
        let Some(riga) = celle_utili(riga).into_iter().next() else { continue };
        let riga = &riga;
        let low = riga.to_lowercase();
        let ha_lettere = riga.chars().filter(|c| c.is_alphabetic()).count() >= 4;
        let poche_cifre = riga.chars().filter(|c| c.is_ascii_digit()).count() <= 3;
        let non_etichetta = !low.starts_with("fattura") && !low.starts_with("documento") && !low.contains("p.iva");
        if ha_lettere && poche_cifre && non_etichetta && riga.len() <= 60 {
            return ripulisci_ragione(riga);
        }
    }
    String::new()
}

fn ripulisci_ragione(s: &str) -> String {
    s.trim_matches(|c: char| !c.is_alphanumeric())
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Importo che segue una delle etichette, cercando sulla stessa riga e — se lì
/// non c'è nulla — sulla successiva (i PDF spesso spezzano etichetta e valore).
fn importo_dopo(testo: &str, etichette: &[&str]) -> Option<f64> {
    let righe: Vec<&str> = testo.lines().collect();
    for et in etichette {
        for (i, riga) in righe.iter().enumerate() {
            let low = riga.to_lowercase();
            let Some(pos) = low.find(et) else { continue };
            if let Some(v) = ultimo_importo(&riga[pos + et.len()..]) {
                return Some(v);
            }
            if let Some(next) = righe.get(i + 1) {
                if let Some(v) = ultimo_importo(next) {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// Ultimo importo della riga: nelle tabelle il totale sta a destra.
fn ultimo_importo(s: &str) -> Option<f64> {
    let mut trovato = None;
    for tok in s.split_whitespace() {
        let t = tok.trim_matches(|c: char| !c.is_ascii_digit() && c != ',' && c != '.' && c != '-');
        if t.chars().any(|c| c.is_ascii_digit()) {
            if let Some(v) = parse_importo(t) {
                trovato = Some(v);
            }
        }
    }
    trovato
}

/// Tipo di documento riconosciuto: da un fornitore arrivano fatture, ma anche
/// DDT (documenti di trasporto), che vanno a finire in posti diversi — la
/// fattura in contabilità, il DDT in magazzino come arrivo merce.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TipoDocumento {
    Fattura,
    Ddt,
}

impl TipoDocumento {
    pub fn come_stringa(self) -> &'static str {
        match self {
            TipoDocumento::Fattura => "FATTURA",
            TipoDocumento::Ddt => "DDT",
        }
    }
}

/// Riferimento a un DDT citato dentro un altro documento (tipicamente la
/// fattura che salda una o più consegne già avvenute).
#[derive(Clone, Debug, PartialEq)]
pub struct RiferimentoDdt {
    pub numero: String,
    pub data: String,
}

/// Che documento è. Il DDT si dichiara quasi sempre nell'intestazione; la
/// fattura pure. In caso di dubbio si assume fattura, che è il caso frequente,
/// e l'utente può correggere.
pub fn riconosci_tipo(testo: &str) -> TipoDocumento {
    let low = testo.to_lowercase();
    let primi = low.lines().take(25).collect::<Vec<_>>().join(" ");
    const SEGNI_DDT: [&str; 7] = [
        "documento di trasporto",
        "d.d.t",
        "ddt",
        "bolla di accompagnamento",
        "bolla di consegna",
        "packing list",
        "delivery note",
    ];
    const SEGNI_FATTURA: [&str; 4] = ["fattura", "invoice", "nota di credito", "autofattura"];

    let pos_ddt = SEGNI_DDT.iter().filter_map(|k| primi.find(k)).min();
    let pos_fattura = SEGNI_FATTURA.iter().filter_map(|k| primi.find(k)).min();
    match (pos_ddt, pos_fattura) {
        // Vince chi compare per primo: in una fattura che cita un DDT la parola
        // "fattura" sta in testa, il riferimento al DDT più sotto.
        (Some(d), Some(f)) => {
            if d < f {
                TipoDocumento::Ddt
            } else {
                TipoDocumento::Fattura
            }
        }
        (Some(_), None) => TipoDocumento::Ddt,
        _ => TipoDocumento::Fattura,
    }
}

/// DDT citati in una fattura: "DDT n. 123 del 01/09/2026", "Vs. bolla 45",
/// "rif. d.d.t. 7". Il numero è il primo token con cifre dopo l'etichetta, la
/// data la prima data che segue sulla stessa riga (se c'è).
pub fn trova_riferimenti_ddt(testo: &str) -> Vec<RiferimentoDdt> {
    const ETICHETTE: [&str; 8] = [
        "documento di trasporto",
        "d.d.t.",
        "d.d.t",
        "ddt",
        "bolla di consegna",
        "bolla n",
        "bolla",
        "delivery note",
    ];
    let mut out: Vec<RiferimentoDdt> = Vec::new();
    for riga in testo.lines() {
        let low = riga.to_lowercase();
        let Some(pos) = ETICHETTE.iter().filter_map(|e| low.find(e).map(|p| (p, e.len()))).min() else {
            continue;
        };
        let resto = &riga[(pos.0 + pos.1).min(riga.len())..];
        let Some(numero) = primo_token_numero(resto) else { continue };
        // Un numero che è in realtà una data non è il numero del documento.
        if numero.matches(['/', '-']).count() >= 2 && normalizza_data(&numero).is_some() {
            continue;
        }
        let data = prima_data(resto).unwrap_or_default();
        let rif = RiferimentoDdt { numero, data };
        if !out.contains(&rif) {
            out.push(rif);
        }
    }
    out
}

/// Campi di una fattura passiva ricavati dal testo.
pub struct Fattura {
    pub fornitore: String,
    pub p_iva_fornitore: String,
    pub data_doc: String,
    pub numero: String,
    pub totale_lordo: f64,
    pub totale_netto: f64,
    pub totale_iva: f64,
    pub righe: Vec<Value>,
}

/// Importo di una riga la cui etichetta è ESATTAMENTE una di quelle date, una
/// volta tolti gli importi. Serve per le righe di totale scritte in modo secco
/// ("Totale    1.024,73 €"): cercare la parola "totale" come sottostringa
/// prenderebbe anche "Totale imponibile" o "Totale imposte", che sono altro.
fn importo_riga_etichettata(testo: &str, etichette: &[&str]) -> Option<f64> {
    for riga in testo.lines() {
        let Some(importo) = ultimo_importo(riga) else { continue };
        let resto: String = riga
            .split_whitespace()
            .filter(|t| numero_puro(t).is_none() && !token_di_servizio(t))
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let resto = resto.trim().trim_end_matches(':').trim();
        if etichette.contains(&resto) {
            return Some(importo);
        }
    }
    None
}

/// Analizza il testo di una fattura. `piva_azienda` è la P.IVA di chi usa il
/// gestionale: serve a non scambiare il destinatario per il fornitore.
pub fn analizza_fattura(testo: &str, piva_azienda: Option<&str>, nome_azienda: Option<&str>) -> Fattura {
    let totale_lordo = importo_dopo(
        testo,
        &["totale documento", "totale fattura", "totale a pagare", "importo totale", "totale \u{20ac}", "totale eur"],
    )
    // Le fatture estere chiudono con un secco "Totale" / "Total" / "Gesamtbetrag":
    // senza questo ripiego il totale restava a zero e non c'era niente con cui
    // confrontare le righe lette.
    .or_else(|| {
        importo_riga_etichettata(
            testo,
            &["totale", "total", "totale complessivo", "gesamtbetrag", "total amount", "amount due",
              "total due", "importe total", "montant total", "totaal"],
        )
    })
    .unwrap_or(0.0);
    let totale_netto = importo_dopo(testo, &["totale imponibile", "imponibile", "totale netto", "netto merce"])
        .or_else(|| {
            importo_riga_etichettata(
                testo,
                &["totale (imp escl.)", "subtotal", "nettobetrag", "net amount", "total excl. vat",
                  "base imponible", "total ht"],
            )
        })
        .unwrap_or(0.0);
    let totale_iva = importo_dopo(testo, &["totale iva", "imposta", "iva "]).unwrap_or_else(|| {
        if totale_lordo > 0.0 && totale_netto > 0.0 {
            ((totale_lordo - totale_netto) * 100.0).round() / 100.0
        } else {
            0.0
        }
    });

    // Se manca uno dei due totali ma c'è l'altro, si ricava dal terzo dato noto.
    let (totale_lordo, totale_netto) = match (totale_lordo, totale_netto) {
        (l, n) if l > 0.0 && n <= 0.0 && totale_iva > 0.0 => (l, ((l - totale_iva) * 100.0).round() / 100.0),
        (l, n) if l <= 0.0 && n > 0.0 && totale_iva > 0.0 => (((n + totale_iva) * 100.0).round() / 100.0, n),
        (l, n) => (l, n),
    };

    Fattura {
        fornitore: trova_fornitore(testo, nome_azienda),
        p_iva_fornitore: trova_piva(testo, piva_azienda),
        data_doc: trova_data(testo),
        numero: trova_numero(testo),
        totale_lordo,
        totale_netto,
        totale_iva,
        righe: trova_righe(testo),
    }
}

/// Valore di un token che rappresenta SOLO un numero (ammessi €, %, spazi
/// unificatori e la punteggiatura di contorno). Se contiene lettere → None.

/// Codici e simboli di valuta che i fornitori esteri scrivono accanto a ogni
/// importo ("200,00 EUR", "$45.00"). Non sono numeri, ma nemmeno la fine della
/// parte numerica della riga: vanno saltati, non presi per un muro.
const VALUTE: [&str; 20] = [
    "eur", "usd", "gbp", "chf", "sek", "dkk", "nok", "pln", "czk", "huf", "ron", "bgn", "jpy",
    "cny", "cad", "aud", "kr", "zl", "lei", "lev",
];

/// Unità di misura che stanno fra la quantità e il prezzo ("50 pcs 12.00").
/// Senza saltarle la lettura si ferma lì e la quantità va persa.
const UNITA: [&str; 26] = [
    "pz", "pcs", "pc", "stk", "st", "ea", "each", "unit", "units", "nr", "no", "num", "h", "hr",
    "hrs", "std", "kg", "g", "lt", "l", "m", "mt", "cm", "mm", "box", "set",
];

/// Un token che non porta valore ma nemmeno interrompe la coda numerica.
fn token_di_servizio(tok: &str) -> bool {
    let t: String = tok
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    if t.is_empty() {
        // Solo punteggiatura o un simbolo di valuta isolato.
        return tok.chars().all(|c| !c.is_alphanumeric());
    }
    VALUTE.contains(&t.as_str()) || UNITA.contains(&t.as_str())
}

fn numero_puro(tok: &str) -> Option<f64> {
    let t: String = tok
        .chars()
        .filter(|c| !matches!(c, '\u{20ac}' | '$' | '\u{a3}' | '\u{a5}' | '%' | '*' | '(' | ')' | '\u{a0}'))
        .collect();
    // "200,00EUR" senza spazio: il codice valuta si stacca e resta l'importo.
    let t = {
        let low = t.to_lowercase();
        let mut netto = t.as_str();
        for v in VALUTE {
            if v.len() >= 3 && low.len() > v.len() {
                if low.ends_with(v) {
                    netto = &t[..t.len() - v.len()];
                    break;
                }
                if low.starts_with(v) {
                    netto = &t[v.len()..];
                    break;
                }
            }
        }
        netto.to_string()
    };
    let t = t.trim();
    if t.is_empty() || t.chars().any(|c| c.is_alphabetic()) {
        return None;
    }
    if !t.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    parse_importo(t)
}

/// Dai numeri in coda a una riga ricava (quantità, prezzo unitario, aliquota).
///
/// I gestionali stampano le colonne in ordini diversi; l'ancora affidabile è
/// che quantità × prezzo dia il totale di riga. Si prova quell'uguaglianza sulle
/// combinazioni plausibili e, se nessuna torna, si ripiega sulla convenzione
/// più diffusa: [quantità, prezzo, (iva), totale].
fn interpreta_numeri(numeri: &[f64]) -> Option<(f64, f64, f64)> {
    const ALIQUOTE: [f64; 5] = [0.0, 4.0, 5.0, 10.0, 22.0];
    // L'aliquota si cerca a partire dal fondo, saltando l'ultima colonna (che è
    // il totale) e la prima (che è la quantità). Senza quest'ultima esclusione
    // una quantità di 10 pezzi verrebbe letta come "IVA 10%", e da lì in poi
    // tutta la riga slitterebbe di una colonna. Serve anche che le colonne
    // siano almeno quattro: con tre (quantità, prezzo, totale) l'IVA non c'è.
    let iva = if numeri.len() >= 4 {
        numeri[1..numeri.len() - 1]
            .iter()
            .rev()
            .copied()
            .find(|v| v.fract() == 0.0 && ALIQUOTE.contains(v) && *v != 0.0)
            .unwrap_or(22.0)
    } else {
        22.0
    };

    let resto: Vec<f64> = {
        let mut visto = false;
        numeri
            .iter()
            .copied()
            .filter(|v| {
                if !visto && *v == iva && numeri.len() > 2 {
                    visto = true;
                    return false;
                }
                true
            })
            .collect()
    };

    let quasi = |a: f64, b: f64| (a - b).abs() <= (b.abs() * 0.02).max(0.02);

    // Con un totale in coda: cerca la coppia (q, p) che lo produce.
    if resto.len() >= 3 {
        let totale = *resto.last()?;
        for qi in 0..resto.len() - 1 {
            for pi in 0..resto.len() - 1 {
                if qi == pi {
                    continue;
                }
                let (q, p) = (resto[qi], resto[pi]);
                if q > 0.0 && p > 0.0 && quasi(q * p, totale) {
                    return Some((q, p, iva));
                }
            }
        }
    }
    if resto.len() == 2 {
        let (a, b) = (resto[0], resto[1]);
        // [quantità, prezzo] se il primo è un conteggio intero, altrimenti
        // [prezzo, totale] (una riga senza colonna quantità).
        if a > 0.0 && a.fract() == 0.0 && a < 10000.0 && b > 0.0 {
            return Some((a, b, iva));
        }
        if b > 0.0 && a > 0.0 && quasi(a, b) {
            return Some((1.0, a, iva));
        }
        if a > 0.0 {
            return Some((1.0, a, iva));
        }
    }
    // Un valore soltanto: è il totale della riga, quantità 1. Capita sulle
    // fatture di servizi, dove la tabella è "descrizione + importo".
    if resto.len() == 1 {
        return resto[0].gt(&0.0).then(|| (1.0, resto[0], iva));
    }
    // Ripiego: prima colonna = quantità, seconda = prezzo.
    let q = resto.first().copied().filter(|q| *q > 0.0 && *q < 100000.0).unwrap_or(1.0);
    let p = resto.get(1).copied().filter(|p| *p > 0.0)?;
    Some((q, p, iva))
}

/// Divide la testa della riga in (codice, descrizione). Il codice è il primo
/// token se ha l'aria di un codice articolo: corto, senza spazi e con cifre e
/// lettere insieme, oppure tutto cifre ma lungo (un EAN). Una parola normale
/// come "Toner" resta invece parte della descrizione.
fn separa_codice(testa: &str) -> (String, String) {
    let mut parti = testa.split_whitespace();
    let Some(primo) = parti.next() else { return (String::new(), testa.to_string()) };
    let resto: Vec<&str> = parti.collect();
    if resto.is_empty() {
        return (String::new(), testa.to_string());
    }
    let pulito = primo.trim_matches(|c: char| !c.is_alphanumeric());
    let cifre = pulito.chars().filter(|c| c.is_ascii_digit()).count();
    let lettere = pulito.chars().filter(|c| c.is_alphabetic()).count();
    let sembra_codice = pulito.len() >= 3
        && pulito.len() <= 20
        && ((cifre > 0 && lettere > 0) || (lettere == 0 && cifre >= 6));
    if sembra_codice {
        (pulito.to_string(), resto.join(" "))
    } else {
        (String::new(), testa.to_string())
    }
}

/// Righe di dettaglio. Il testo grezzo perde la struttura della tabella, quindi
/// si riconoscono solo le righe con una forma inequivocabile: una descrizione
/// seguita da almeno due numeri, di cui l'ultimo con i decimali (il prezzo).
/// Quando il documento non è abbastanza regolare si preferisce non indovinare:
/// meglio nessuna riga che righe sbagliate da correggere a mano una per una.
/// Parole che denunciano una riga di riepilogo, di pagamento o di piè di pagina.
/// Servono a non scambiare un totale (o il numero di pagina) per una voce della
/// fattura quando si legge con il criterio più permissivo.
const SOMMARIO: [&str; 26] = [
    "totale", "total", "subtotal", "saldo", "importo", "amount", "betrag", "summe", "sum",
    "netto", "brutto", "imponibile", "iban", "bic", "swift", "bank", "page", "pagina", "seite",
    "reference", "riferimento", "terms", "due", "invoice", "rechnung", "fattura",
];

/// L'importo ha i centesimi ("10.000,00", "5,000.00")? È il segno più semplice
/// che un numero isolato sia davvero un importo e non un riferimento.
fn ha_centesimi(tok: &str) -> bool {
    let cifre: Vec<char> = tok.chars().filter(|c| c.is_ascii_digit() || *c == ',' || *c == '.').collect();
    let n = cifre.len();
    n >= 4
        && cifre[n - 3..].iter().next().is_some_and(|c| *c == ',' || *c == '.')
        && cifre[n - 2..].iter().all(|c| c.is_ascii_digit())
        && cifre[..n - 3].iter().any(|c| c.is_ascii_digit())
}

pub fn trova_righe(testo: &str) -> Vec<Value> {
    struct RigaGrezza {
        codice: String,
        descrizione: String,
        numeri_testo: Vec<String>,
        quantita: f64,
        prezzo: f64,
        iva: f64,
    }
    // `minimo` è quanti valori numerici deve avere la riga per essere presa in
    // considerazione: due nel giro normale, uno solo nel ripasso (vedi sotto).
    let scandisci = |minimo: usize| {
    let mut grezze: Vec<RigaGrezza> = Vec::new();
    for riga in testo.lines() {
        let riga = riga.trim();
        if riga.len() < 8 || riga.len() > 200 {
            continue;
        }
        let low = riga.to_lowercase();
        if ["totale", "imponibile", "iva", "pagamento", "iban", "scadenza", "p.iva", "cod. fisc"]
            .iter()
            .any(|k| low.starts_with(k))
        {
            continue;
        }
        if minimo < 2 && SOMMARIO.iter().any(|k| low.contains(k)) {
            continue;
        }
        let tokens: Vec<&str> = riga.split_whitespace().collect();
        if tokens.len() < 3 {
            continue;
        }
        // Coda numerica della riga: i valori della tabella. Un token che contiene
        // lettere NON è un numero, altrimenti i codici articolo in coda alla
        // descrizione ("Toner HP 26A") verrebbero letti come quantità.
        let mut numeri: Vec<f64> = Vec::new();
        let mut i = tokens.len();
        while i > 0 {
            match numero_puro(tokens[i - 1]) {
                Some(v) => {
                    numeri.push(v);
                    i -= 1;
                }
                // Valuta o unità di misura in mezzo agli importi: si scavalca,
                // purché resti almeno un token per la descrizione. Senza questo
                // una riga tedesca ("10 20,00 EUR 200,00 EUR") non veniva letta
                // affatto, e "50 pcs 12.00 600.00" perdeva la quantità.
                None if i > 1 && token_di_servizio(tokens[i - 1]) => i -= 1,
                None => break,
            }
        }
        numeri.reverse();
        if numeri.len() < minimo || i == 0 {
            continue;
        }
        // Nel ripasso a un solo valore serve una prova in più che sia un importo
        // e non un numero di pagina o un riferimento: deve avere i centesimi.
        if minimo < 2 && !tokens[i..].iter().any(|t| ha_centesimi(t)) {
            continue;
        }
        let testa = tokens[..i].join(" ");
        if testa.chars().filter(|c| c.is_alphabetic()).count() < 3 {
            continue;
        }
        let Some((quantita, prezzo, iva)) = interpreta_numeri(&numeri) else {
            continue;
        };
        // Codice articolo del fornitore: quando c'è, apre la riga ed è fatto di
        // lettere e cifre insieme (ART-1234, 7A55B). Separarlo dalla descrizione
        // serve a ritrovare lo stesso articolo nei documenti successivi.
        let (codice, descrizione) = separa_codice(&testa);
        // Celle così come sono state lette: sono queste che l'utente può
        // riassegnare quando il fornitore mette le colonne in un altro ordine.
        grezze.push(RigaGrezza {
            codice,
            descrizione,
            numeri_testo: tokens[i..]
                .iter()
                .filter(|t| numero_puro(t).is_some())
                .map(|t| t.to_string())
                .collect(),
            quantita,
            prezzo,
            iva,
        });
    }
    grezze
    };

    // Primo giro con il criterio prudente. Se non esce niente si ripassa il
    // documento accettando anche le righe con il solo importo: sulle fatture
    // estere di servizi la tabella è spesso "descrizione + totale", senza
    // quantità né prezzo unitario, e prima di questo ripasso non si leggeva
    // proprio nulla.
    let grezze = {
        let normale = scandisci(2);
        if normale.is_empty() { scandisci(1) } else { normale }
    };

    // Le colonne devono stare nello stesso posto in tutte le righe, altrimenti
    // assegnare un ruolo "alla terza colonna" sposta i valori sulle righe che
    // hanno una colonna in meno (per esempio quelle senza codice articolo).
    // La parte numerica si allinea a DESTRA: l'ultima colonna è il totale.
    let max_numeri = grezze.iter().map(|g| g.numeri_testo.len()).max().unwrap_or(0);
    let mut out: Vec<Value> = Vec::new();
    for g in &grezze {
        let mut celle: Vec<String> = vec![g.codice.clone(), g.descrizione.clone()];
        for _ in 0..(max_numeri - g.numeri_testo.len()) {
            celle.push(String::new());
        }
        celle.extend(g.numeri_testo.iter().cloned());

        let mut ruoli: Vec<&str> = vec!["codice", "descrizione"];
        for _ in 0..(max_numeri - g.numeri_testo.len()) {
            ruoli.push("ignora");
        }
        for (k, t) in g.numeri_testo.iter().enumerate() {
            let valore = numero_puro(t);
            let ruolo = match valore {
                Some(v) if (v - g.iva).abs() < f64::EPSILON && g.numeri_testo.len() > 2 => "iva",
                Some(v) if (v - g.quantita).abs() < f64::EPSILON && k == 0 => "quantita",
                Some(v) if (v - g.prezzo).abs() < f64::EPSILON => "prezzo",
                Some(_) if k + 1 == g.numeri_testo.len() => "totale",
                _ => "ignora",
            };
            ruoli.push(ruolo);
        }

        out.push(json!({
            "descrizione": g.descrizione,
            "codice": g.codice,
            "quantita": g.quantita,
            "prezzo": g.prezzo,
            "iva": g.iva,
            "celle": celle,
            "ruoli": ruoli,
        }));
    }
    // Una riga sola ricavata da un documento lungo può essere un falso positivo
    // (un rigo di piè di pagina o di riepilogo). Ma può anche essere l'unica voce
    // della fattura — sui servizi esteri è il caso normale — e buttarla via
    // significava non leggere niente. Si scarta solo se il testo la denuncia
    // come totale o dato di pagamento.
    if out.len() == 1 && testo.lines().count() > 25 {
        let descr = out[0]["descrizione"].as_str().unwrap_or("").to_lowercase();
        if SOMMARIO.iter().any(|k| descr.contains(k)) {
            out.clear();
        }
    }
    out
}

/// Campi di uno scontrino: bastano data, importo e negozio per la prima nota.
pub struct Scontrino {
    pub data: String,
    pub importo: f64,
    pub negozio: String,
}

pub fn analizza_scontrino(testo: &str) -> Scontrino {
    let importo = importo_dopo(testo, &["totale complessivo", "totale euro", "totale eur", "totale", "importo"])
        .or_else(|| {
            // Nessuna etichetta riconosciuta: si prende l'importo più alto,
            // che su uno scontrino è quasi sempre il totale.
            testo
                .split_whitespace()
                .filter_map(parse_importo_tok)
                .fold(None, |acc: Option<f64>, v| Some(acc.map_or(v, |a| a.max(v))))
        })
        .unwrap_or(0.0);
    Scontrino {
        data: trova_data(testo),
        importo,
        negozio: trova_fornitore(testo, None),
    }
}

fn parse_importo_tok(tok: &str) -> Option<f64> {
    let t = tok.trim_matches(|c: char| !c.is_ascii_digit() && c != ',' && c != '.');
    if !t.contains([',', '.']) {
        return None; // solo importi con decimali: evita di scambiare un codice per un totale
    }
    parse_importo(t).filter(|v| *v > 0.0 && *v < 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn importi_italiani_e_inglesi() {
        assert_eq!(parse_importo("1.234,56"), Some(1234.56));
        assert_eq!(parse_importo("1,234.56"), Some(1234.56));
        assert_eq!(parse_importo("€ 45,00"), Some(45.0));
        assert_eq!(parse_importo("1.234"), Some(1234.0));
        assert_eq!(parse_importo("12"), Some(12.0));
        assert_eq!(parse_importo("abc"), None);
    }

    #[test]
    fn date_nei_formati_correnti() {
        assert_eq!(normalizza_data("31/12/2026").as_deref(), Some("2026-12-31"));
        assert_eq!(normalizza_data("2026-01-05").as_deref(), Some("2026-01-05"));
        assert_eq!(normalizza_data("05.03.26").as_deref(), Some("2026-03-05"));
        assert_eq!(normalizza_data("99/99/2026"), None);
    }

    #[test]
    fn piva_valida_e_scartata() {
        // P.IVA reale valida (checksum corretto).
        assert!(valida_piva("00743110157"));
        assert!(!valida_piva("12345678901"));
        assert!(!valida_piva("0074311015"));
    }

    #[test]
    fn piva_del_fornitore_non_quella_dell_azienda() {
        let testo = "ACME S.r.l.\nP.IVA IT00743110157\nSpett.le Cliente\nP. IVA 00950501007";
        assert_eq!(trova_piva(testo, Some("00950501007")), "00743110157");
    }

    /// Il testo di questo test NON è inventato: è esattamente quello che pdf.js
    /// restituisce da una fattura PDF, ricomposto a righe dal servizio frontend
    /// (verificato generando la fattura con jsPDF e rileggendola).
    #[test]
    fn fattura_tipica() {
        let testo = "\
ACME FORNITURE S.R.L.
Via Roma 12 - 20100 Milano
P.IVA 00743110157

Fattura n. 2026/145 del 03/09/2026

Spett.le Studio Rossi
P.IVA 00950501007

Descrizione                 Q.ta   Prezzo    IVA    Totale
Toner nero HP 26A            2     78,50     22     157,00
Risma carta A4 80gr         10      3,90     22      39,00

Totale imponibile                                   196,00
Totale IVA                                           43,12
Totale documento                                    239,12
";
        let f = analizza_fattura(testo, Some("00950501007"), Some("Studio Rossi"));
        assert_eq!(f.p_iva_fornitore, "00743110157");
        assert_eq!(f.numero, "2026/145");
        assert_eq!(f.data_doc, "2026-09-03");
        assert_eq!(f.totale_netto, 196.00);
        assert_eq!(f.totale_lordo, 239.12);
        assert!(f.fornitore.to_uppercase().starts_with("ACME"));
        assert_eq!(f.righe.len(), 2);
        assert_eq!(f.righe[0]["descrizione"], "Toner nero HP 26A");
        assert_eq!(f.righe[0]["quantita"], 2.0);
        assert_eq!(f.righe[0]["prezzo"], 78.5);
        assert_eq!(f.righe[0]["iva"], 22.0);
    }

    #[test]
    fn totale_iva_dedotto_quando_manca() {
        let testo = "Fattura n. 7 del 01/02/2026\nImponibile 100,00\nTotale documento 122,00\n";
        let f = analizza_fattura(testo, None, None);
        assert_eq!(f.totale_netto, 100.0);
        assert_eq!(f.totale_lordo, 122.0);
        assert_eq!(f.totale_iva, 22.0);
    }

#[test]
    fn distingue_ddt_da_fattura() {
        let ddt = "TRASPORTI SUD S.R.L.\nDOCUMENTO DI TRASPORTO n. 445 del 02/09/2026\nCausale: vendita\n";
        assert_eq!(riconosci_tipo(ddt), TipoDocumento::Ddt);
        let fat = "ACME S.R.L.\nFattura n. 12 del 03/09/2026\nRif. DDT 445 del 02/09/2026\n";
        // La fattura cita un DDT ma resta una fattura: conta chi viene prima.
        assert_eq!(riconosci_tipo(fat), TipoDocumento::Fattura);
    }

    #[test]
    fn trova_i_ddt_citati_in_fattura() {
        let testo = "Fattura n. 12 del 30/09/2026\n\
                     Rif. Vs. DDT n. 445 del 02/09/2026\n\
                     Rif. DDT n. 461 del 15/09/2026\n\
                     Totale documento 1.220,00\n";
        let rif = trova_riferimenti_ddt(testo);
        assert_eq!(rif.len(), 2, "attesi due riferimenti, trovati {rif:?}");
        assert_eq!(rif[0], RiferimentoDdt { numero: "445".into(), data: "2026-09-02".into() });
        assert_eq!(rif[1].numero, "461");
    }

    #[test]
    fn ddt_senza_prezzi_conserva_quantita_e_codice() {
        // Un DDT tipico: codice articolo, descrizione, quantità. Nessun prezzo.
        let testo = "\
FORNITURE NORD S.P.A.
DOCUMENTO DI TRASPORTO n. 445 del 02/09/2026
P.IVA 00743110157

Codice      Descrizione                Q.tà   U.M.
ART-1234    Toner nero HP 26A          2      PZ
7788990011  Risma carta A4 80gr        10     PZ
";
        assert_eq!(riconosci_tipo(testo), TipoDocumento::Ddt);
        let f = analizza_fattura(testo, None, None);
        assert_eq!(f.numero, "445");
        assert_eq!(f.data_doc, "2026-09-02");
        // Senza prezzi le righe non sono ricostruibili: meglio nessuna riga
        // inventata — le quantità le completa l'utente o la mappatura colonne.
        assert!(f.righe.len() <= 2);
    }

    #[test]
    fn separa_il_codice_articolo_dalla_descrizione() {
        let testo = "ART-1234 Toner nero HP 26A 2 78,50 22 157,00\n";
        let righe = trova_righe(testo);
        assert_eq!(righe.len(), 1);
        assert_eq!(righe[0]["codice"], "ART-1234");
        assert_eq!(righe[0]["descrizione"], "Toner nero HP 26A");
        // Le celle riportano i valori letti, nell'ordine in cui stanno sulla riga.
        let celle = righe[0]["celle"].as_array().unwrap();
        assert_eq!(celle[0], "ART-1234");
        assert_eq!(celle[1], "Toner nero HP 26A");
        assert_eq!(celle[2], "2");
    }

    /// Le colonne devono restare nello stesso posto anche quando una riga ha il
    /// codice articolo e un'altra no: è ciò che permette di assegnare un ruolo
    /// "alla terza colonna" e vederlo valere per tutte le righe.
    #[test]
    fn le_colonne_sono_allineate_tra_righe_diverse() {
        let testo = "\
ART-1234 Toner nero HP 26A 2 78,50 22 157,00
Risma carta A4 80gr 10 3,90 22 39,00
";
        let righe = trova_righe(testo);
        assert_eq!(righe.len(), 2);
        let celle0 = righe[0]["celle"].as_array().unwrap();
        let celle1 = righe[1]["celle"].as_array().unwrap();
        assert_eq!(celle0.len(), celle1.len(), "le righe devono avere lo stesso numero di colonne");
        // Colonna 0 = codice (vuota dove manca), colonna 1 = descrizione.
        assert_eq!(celle0[0], "ART-1234");
        assert_eq!(celle1[0], "");
        assert_eq!(celle1[1], "Risma carta A4 80gr");
        // I valori restano quelli giusti: la seconda riga non slitta.
        assert_eq!(righe[1]["quantita"], 10.0);
        assert_eq!(righe[1]["prezzo"], 3.9);
        // L'ultima colonna è il totale in entrambe le righe.
        assert_eq!(celle0.last().unwrap(), "157,00");
        assert_eq!(celle1.last().unwrap(), "39,00");
    }

    #[test]
    fn una_parola_normale_non_e_un_codice() {
        let righe = trova_righe("Toner nero HP 26A 2 78,50 22 157,00\n");
        assert_eq!(righe[0]["codice"], "");
        assert_eq!(righe[0]["descrizione"], "Toner nero HP 26A");
    }

    #[test]
    fn scontrino_minimo() {
        let testo = "SUPERMERCATO CENTRALE SNC\nVia Verdi 3\n12/03/2026\nPANE 1,20\nLATTE 2,40\nTOTALE 3,60\n";
        let s = analizza_scontrino(testo);
        assert_eq!(s.data, "2026-03-12");
        assert_eq!(s.importo, 3.60);
        assert!(s.negozio.to_uppercase().contains("SUPERMERCATO"));
    }

    #[test]
    fn testo_illeggibile_non_inventa_righe() {
        let testo = "??? ?? ??\nxxx\n";
        let f = analizza_fattura(testo, None, None);
        assert!(f.righe.is_empty());
        assert_eq!(f.totale_lordo, 0.0);
    }
/// Le fatture estere sono scritte in un altro modo, e ciascuna di queste
    /// differenze faceva leggere ZERO righe (o righe sbagliate) prima del 1.3.6.
    #[test]
    fn legge_le_righe_delle_fatture_estere() {
        // Germania: il codice valuta è ripetuto accanto a ogni importo.
        let de = trova_righe("\
Rechnung Nr. R-778
Pos  Artikel            Menge  Einzelpreis  Gesamt
1    Batterie 12V 60Ah     10     20,00 EUR   200,00 EUR
2    Ladegeraet 24V         5     35,50 EUR   177,50 EUR");
        assert_eq!(de.len(), 2, "il codice valuta in coda fermava la lettura");
        assert_eq!(de[0]["quantita"], 10.0);
        assert_eq!(de[0]["prezzo"], 20.0);
        assert_eq!(de[1]["prezzo"], 35.5);

        // L'unità di misura sta fra quantità e prezzo: senza saltarla la
        // quantità andava persa e il prezzo diventava il totale di riga.
        let um = trova_righe("\
Invoice HK-0042
Item          Qty        Unit      Price     Total
Charger 24V    50        pcs       12.00     600.00
Cable 2m      100        pcs        1.50     150.00");
        assert_eq!(um.len(), 2);
        assert_eq!(um[0]["quantita"], 50.0);
        assert_eq!(um[0]["prezzo"], 12.0);

        // Servizi: descrizione e importo, senza quantità né prezzo unitario.
        // È la forma normale delle fatture estere di servizi, ed era quella che
        // non si leggeva affatto.
        let servizi = trova_righe("\
Nordic Software AB
INVOICE INV-2291
Invoice date 2026-09-01
Due date 2026-10-01
Customer: La Mia Azienda Srl
Via Roma 1
37100 Verona
Italy
VAT IT01234567890

Item                                    Amount
Annual platform licence               10000.00

Subtotal                              10000.00
VAT 0% reverse charge                      0.00
Total SEK                             10000.00
Payment terms 30 days
Bankgiro 123-4567
IBAN SE1234567890
Thank you for your business
This invoice is subject to Swedish law
Please pay by the due date
Reference: order 8891
Page 1 of 1");
        assert_eq!(servizi.len(), 1, "voce unica: {servizi:?}");
        assert_eq!(servizi[0]["descrizione"], "Annual platform licence");
        assert_eq!(servizi[0]["quantita"], 1.0);
        assert_eq!(servizi[0]["prezzo"], 10000.0);
    }

    /// Il ripasso permissivo non deve trasformare totali, IBAN e numeri di
    /// pagina in voci della fattura: entra solo se il giro normale è a vuoto,
    /// e scarta le righe che si annunciano come riepilogo.
    #[test]
    fn il_ripasso_permissivo_non_prende_i_totali() {
        let righe = trova_righe("\
Fornitore Srl
Fattura 2026/145
Descrizione                              Importo
Subtotal                                 1000,00
Totale documento                         1220,00
IBAN IT60X0542811101000000123456
Pagina 1 di 1
Bank transfer 30 days");
        assert!(righe.is_empty(), "ha preso righe di riepilogo: {righe:?}");
    }

    /// Le fatture italiane con la tabella completa devono continuare a leggersi
    /// esattamente come prima: il ripasso non deve nemmeno partire.
    #[test]
    fn le_fatture_italiane_restano_invariate() {
        let righe = trova_righe("\
ACME Forniture S.r.l.
Fattura 2026/145
Cod.      Descrizione            Q.tà   Prezzo   IVA   Totale
ART-1234  Toner nero HP 26A         2    78,50    22   157,00
          Risma carta A4 80gr      10     3,90    22    39,00");
        assert_eq!(righe.len(), 2);
        assert_eq!(righe[0]["codice"], "ART-1234");
        assert_eq!(righe[0]["quantita"], 2.0);
        assert_eq!(righe[0]["prezzo"], 78.5);
        assert_eq!(righe[0]["iva"], 22.0);
        assert_eq!(righe[1]["quantita"], 10.0);
        assert_eq!(righe[1]["prezzo"], 3.9);
    }

    /// Intestazione a due colonne (emittente a sinistra, cliente a destra): il
    /// tabulatore segna il confine, e il fornitore è la colonna di sinistra.
    /// Senza tagliare lì usciva "AUCTANE S.L.U CCTECH", i due nomi appiccicati.
    #[test]
    fn non_confonde_il_fornitore_col_destinatario_nelle_due_colonne() {
        let testo = "FATTURA\nES26AFC00034453\nEmittente\tCliente\n\
                     AUCTANE S.L.U\tCCTECH\nESB83357863\tIT10117100015\n\
                     Paseo Imperial 14\tVia Don Domenico Gaude 107\nSpain\tIT";
        assert_eq!(trova_fornitore(testo, None), "AUCTANE S.L.U");
        // Anche escludendo il nome della propria azienda: il filtro va applicato
        // alla singola colonna, non alla riga, altrimenti sparisce pure il
        // fornitore che le sta accanto.
        assert_eq!(trova_fornitore(testo, Some("CCTECH")), "AUCTANE S.L.U");
    }

    /// Le forme societarie estere devono valere quanto quelle italiane, ma solo
    /// come parola intera: "sl" dentro "Oslo" non è una società.
    #[test]
    fn riconosce_le_forme_societarie_estere() {
        assert_eq!(trova_fornitore("Bauer GmbH\nHauptstr. 5", None), "Bauer GmbH");
        assert_eq!(trova_fornitore("Nordic Software AB\nStockholm", None), "Nordic Software AB");
        assert_eq!(trova_fornitore("Pacific Trading Ltd\nHong Kong", None), "Pacific Trading Ltd");
        // "Oslo" non deve far scattare la forma "sl": vince il ripiego, che
        // prende comunque la prima riga d'intestazione.
        assert_eq!(trova_fornitore("Fjord Import\nOslo Norway", None), "Fjord Import");
    }

    /// Su una fattura estera l'unica partita IVA italiana è quella di CHI RICEVE:
    /// il fornitore va cercato con la sua, estera.
    #[test]
    fn trova_la_partita_iva_estera_non_quella_del_destinatario() {
        let testo = "AUCTANE S.L.U\tCCTECH\nESB83357863\tIT10117100015";
        assert_eq!(trova_piva_estera(testo), "ESB83357863");
        assert_eq!(trova_piva_estera("Bauer GmbH\nUSt-IdNr. DE123456789"), "DE123456789");
        // Nessun soggetto estero: nessuna invenzione.
        assert_eq!(trova_piva_estera("ACME Srl\nP.IVA 00743110157"), "");
    }

    /// Il totale scritto secco ("Totale   1.024,73 €") non veniva letto, e senza
    /// di esso non c'era niente con cui confrontare le righe copiate.
    #[test]
    fn legge_il_totale_anche_con_l_etichetta_nuda() {
        let f = analizza_fattura(
            "FATTURA\nES26AFC00034453\n30-06-2026\n\
             Totale (imp escl.)\t1.024,73 \u{20ac}\nTotale imposte 0%\t0,00 \u{20ac}\nTotale\t1.024,73 \u{20ac}",
            None,
            None,
        );
        assert_eq!(f.totale_lordo, 1024.73);
        assert_eq!(f.totale_netto, 1024.73, "il netto è la riga (imp escl.)");
    }

    /// Fattura di un corriere: una riga per spedizione, con il riferimento in
    /// testa, la data in mezzo e un solo importo col simbolo di valuta in coda.
    /// Righe così vanno lette tutte, altrimenti il totale non torna — ed è
    /// esattamente quello che succedeva su una fattura vera di 200 spedizioni.
    #[test]
    fn legge_le_righe_a_una_sola_cifra_di_un_corriere() {
        let mut testo = String::from(
            "FATTURA\n30-06-2026\nES26AFC00034453\nEmittente Cliente\n\
             Numero Fattura Data di Emissione Valuta\nES26AFC00034453 30-06-2026 EUR\n\
             Riferimento Prodotto Data Prezzo Base\n",
        );
        for n in 0..40 {
            testo.push_str(&format!(
                "IT2026PRO000379{n:04} brt - Express Punto di Deposito S2H 16-06-2026 5,06 \u{20ac}\n"
            ));
        }
        testo.push_str(
            "Servizi non soggetti all'IVA spagnola. Meccanismo di inversione contabile.\n\
             Totale (imp escl.) 202,40 \u{20ac}\nTotale imposte 0% 0,00 \u{20ac}\nTotale 202,40 \u{20ac}\n1/2\n",
        );

        let righe = trova_righe(&testo);
        assert_eq!(righe.len(), 40, "righe perse per strada");
        let somma: f64 = righe
            .iter()
            .map(|r| r["quantita"].as_f64().unwrap() * r["prezzo"].as_f64().unwrap())
            .sum();
        assert!((somma - 202.40).abs() < 0.01, "la somma non torna col totale: {somma}");
        // Il riferimento della spedizione è un codice, non parte della descrizione.
        assert_eq!(righe[0]["codice"], "IT2026PRO0003790000");
        assert_eq!(righe[0]["quantita"], 1.0);
        assert_eq!(righe[0]["prezzo"], 5.06);
        // Le tre righe dei totali non devono entrare fra le voci.
        assert!(!righe.iter().any(|r| r["descrizione"].as_str().unwrap_or("").to_lowercase().contains("totale")));
    }


}
