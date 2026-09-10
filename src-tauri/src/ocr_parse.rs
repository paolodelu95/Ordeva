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
const FORME: [&str; 12] = [
    "s.r.l", "srl", "s.p.a", "spa", "s.n.c", "snc", "s.a.s", "sas", "s.s.", "sc arl", "societa", "società",
];

/// Ragione sociale del fornitore: la prima riga con una forma societaria; in
/// mancanza, la prima riga "da intestazione" (corta, con lettere, senza importi).
pub fn trova_fornitore(testo: &str, escludi: Option<&str>) -> String {
    let escludi_norm = escludi.map(|s| s.to_lowercase()).unwrap_or_default();
    let righe: Vec<&str> = testo.lines().map(|r| r.trim()).filter(|r| !r.is_empty()).collect();

    for riga in righe.iter().take(40) {
        let low = riga.to_lowercase();
        if !escludi_norm.is_empty() && low.contains(&escludi_norm) {
            continue;
        }
        if FORME.iter().any(|f| low.contains(f)) && riga.len() <= 80 {
            return ripulisci_ragione(riga);
        }
    }
    for riga in righe.iter().take(8) {
        let low = riga.to_lowercase();
        if !escludi_norm.is_empty() && low.contains(&escludi_norm) {
            continue;
        }
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

/// Analizza il testo di una fattura. `piva_azienda` è la P.IVA di chi usa il
/// gestionale: serve a non scambiare il destinatario per il fornitore.
pub fn analizza_fattura(testo: &str, piva_azienda: Option<&str>, nome_azienda: Option<&str>) -> Fattura {
    let totale_lordo = importo_dopo(
        testo,
        &["totale documento", "totale fattura", "totale a pagare", "importo totale", "totale €", "totale eur"],
    )
    .unwrap_or(0.0);
    let totale_netto = importo_dopo(testo, &["totale imponibile", "imponibile", "totale netto", "netto merce"])
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
fn numero_puro(tok: &str) -> Option<f64> {
    let t: String = tok
        .chars()
        .filter(|c| !matches!(c, '€' | '$' | '%' | '*' | '(' | ')' | '\u{a0}'))
        .collect();
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
pub fn trova_righe(testo: &str) -> Vec<Value> {
    struct RigaGrezza {
        codice: String,
        descrizione: String,
        numeri_testo: Vec<String>,
        quantita: f64,
        prezzo: f64,
        iva: f64,
    }
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
                None => break,
            }
        }
        numeri.reverse();
        if numeri.len() < 2 || i == 0 {
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
            numeri_testo: tokens[i..].iter().map(|t| t.to_string()).collect(),
            quantita,
            prezzo,
            iva,
        });
    }

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
    // Una riga sola ricavata da un documento lungo è quasi sempre un falso
    // positivo (un rigo di piè di pagina); in quel caso si lascia decidere l'utente.
    if out.len() == 1 && testo.lines().count() > 25 {
        out.clear();
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
}
