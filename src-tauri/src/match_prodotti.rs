//! Matching fuzzy testuale listino fornitore ↔ prodotti (parità con utils/matchProdotti.js).
//! Nessuna dipendenza dal DB: pure funzioni di scoring.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::web::opt_num;

const STOPWORDS: &[&str] = &[
    "di", "da", "de", "del", "della", "dei", "degli", "delle", "con", "per", "il", "lo", "la",
    "le", "gli", "un", "uno", "una", "e", "ed", "a", "al", "allo", "alla", "in", "su", "o", "od",
    "the", "of", "and", "cf", "conf", "confezione", "art", "articolo", "cod", "codice", "pz",
    "pezzi", "pezzo",
];

/// Soglie di confidenza.
const SOGLIA_MIN: f64 = 0.40;
const SOGLIA_MEDIA: f64 = 0.50;
const SOGLIA_ALTA: f64 = 0.68;

fn unit_canon(u: &str) -> Option<&'static str> {
    Some(match u {
        "pollici" | "pollice" | "inch" | "in" => "in",
        "gr" | "grammi" | "grammo" | "g" => "g",
        "kg" | "kilogrammi" | "chilogrammi" | "kilogrammo" => "kg",
        "mg" => "mg",
        "cm" | "centimetri" | "centimetro" => "cm",
        "mm" | "millimetri" | "millimetro" => "mm",
        "mt" | "metri" | "metro" => "m",
        "ml" | "millilitri" => "ml",
        "cl" => "cl",
        "lt" | "litri" | "litro" => "l",
        "w" | "watt" => "w",
        "v" | "volt" => "v",
        "gb" => "gb",
        "tb" => "tb",
        "mb" => "mb",
        _ => return None,
    })
}

/// Prodotto di input per il matching (costruito dal chiamante dai dati DB).
pub struct ProdInput {
    pub id: i64,
    pub categoria: String,
    pub codice: String,
    pub descrizione: String,
    pub prezzo_acquisto: Option<f64>,
    pub quantita: Option<f64>,
}

struct Tok {
    words: Vec<String>,
    meas: HashSet<String>,
    nums: HashSet<String>,
}

struct Prepped<'a> {
    p: &'a ProdInput,
    words: Vec<String>,
    meas: HashSet<String>,
    nums: HashSet<String>,
    cat_words: Vec<String>,
}

fn strip_accents(s: &str) -> String {
    s.nfd()
        .filter(|c| !('\u{0300}'..='\u{036f}').contains(c))
        .collect()
}

fn strip_trailing_zeros(t: &str) -> String {
    // .replace(/\.0+$/, '') — rimuove un ".0", ".00"... finale.
    if let Some(dot) = t.find('.') {
        let frac = &t[dot + 1..];
        if !frac.is_empty() && frac.bytes().all(|b| b == b'0') {
            return t[..dot].to_string();
        }
    }
    t.to_string()
}

fn is_num(t: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d+(?:\.\d+)?$").unwrap())
        .is_match(t)
}

fn tokenize(raw: &str) -> Tok {
    static RE_QUOTE: OnceLock<Regex> = OnceLock::new();
    static RE_DEC: OnceLock<Regex> = OnceLock::new();
    static RE_NUMALPHA: OnceLock<Regex> = OnceLock::new();
    static RE_CLEAN: OnceLock<Regex> = OnceLock::new();
    static RE_A: OnceLock<Regex> = OnceLock::new();
    let re_quote = RE_QUOTE.get_or_init(|| Regex::new(r#"(\d)\s*(?:''|"|”|″)"#).unwrap());
    let re_dec = RE_DEC.get_or_init(|| Regex::new(r"(\d),(\d)").unwrap());
    let re_numalpha = RE_NUMALPHA.get_or_init(|| Regex::new(r"(\d)([a-z])").unwrap());
    let re_clean = RE_CLEAN.get_or_init(|| Regex::new(r"[^a-z0-9. ]+").unwrap());
    let re_a = RE_A.get_or_init(|| Regex::new(r"^a\d$").unwrap());

    let mut s = strip_accents(&raw.to_lowercase());
    s = re_quote.replace_all(&s, "$1 pollici ").into_owned();
    s = re_dec.replace_all(&s, "$1.$2").into_owned();
    s = re_numalpha.replace_all(&s, "$1 $2").into_owned();
    s = re_clean.replace_all(&s, " ").into_owned();

    let raws: Vec<&str> = s.split_whitespace().collect();
    let mut words = Vec::new();
    let mut meas = HashSet::new();
    let mut nums = HashSet::new();

    let mut i = 0;
    while i < raws.len() {
        let t = raws[i];
        if t == "." || t.is_empty() {
            i += 1;
            continue;
        }
        if is_num(t) {
            if let Some(canon) = raws.get(i + 1).and_then(|u| unit_canon(u)) {
                let num = strip_trailing_zeros(t);
                meas.insert(format!("{num}{canon}"));
                nums.insert(num);
                i += 2; // consuma l'unità
                continue;
            }
        }
        if re_a.is_match(t) {
            meas.insert(t.to_string());
            i += 1;
            continue;
        }
        if STOPWORDS.contains(&t) {
            i += 1;
            continue;
        }
        if t.chars().count() < 2 && !is_num(t) {
            i += 1;
            continue;
        }
        if is_num(t) {
            nums.insert(strip_trailing_zeros(t));
        }
        words.push(t.to_string());
        i += 1;
    }
    Tok { words, meas, nums }
}

fn levenshtein(a: &[u8], b: &[u8]) -> usize {
    if a == b {
        return 0;
    }
    let (m, n) = (a.len(), b.len());
    if m == 0 {
        return n;
    }
    if n == 0 {
        return m;
    }
    let mut prev: Vec<usize> = (0..=n).collect();
    for i in 1..=m {
        let mut cur = vec![i; n + 1];
        for j in 1..=n {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = cur;
    }
    prev[n]
}

fn token_match(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let (la, lb) = (a.chars().count(), b.chars().count());
    if la >= 4 && lb >= 4 && (la as i64 - lb as i64).abs() <= 1 {
        return levenshtein(a.as_bytes(), b.as_bytes()) <= 1;
    }
    false
}

fn matched_count(a: &[String], b: &[String]) -> usize {
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    let mut used = vec![false; b.len()];
    let mut m = 0;
    for x in a {
        for (j, y) in b.iter().enumerate() {
            if !used[j] && token_match(x, y) {
                used[j] = true;
                m += 1;
                break;
            }
        }
    }
    m
}

fn dice_set(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let inter = a.iter().filter(|x| b.contains(*x)).count();
    (2.0 * inter as f64) / (a.len() + b.len()) as f64
}

fn shared_words(a: &[String], b: &[String]) -> Vec<String> {
    let mut used = vec![false; b.len()];
    let mut out = Vec::new();
    for x in a {
        for (j, y) in b.iter().enumerate() {
            if !used[j] && token_match(x, y) {
                used[j] = true;
                out.push(x.clone());
                break;
            }
        }
    }
    out
}

fn fascia(score: f64) -> &'static str {
    if score >= SOGLIA_ALTA {
        "alta"
    } else if score >= SOGLIA_MEDIA {
        "media"
    } else {
        "bassa"
    }
}

fn prep_prodotto(p: &ProdInput) -> Prepped<'_> {
    let txt = tokenize(&format!("{} {}", p.codice, p.descrizione));
    let cat = tokenize(&p.categoria);
    Prepped {
        p,
        words: txt.words,
        meas: txt.meas,
        nums: txt.nums,
        cat_words: cat.words,
    }
}

fn score(riga: &Tok, prod: &Prepped) -> f64 {
    let (la, lp) = (&riga.words, &prod.words);
    let m = matched_count(la, lp);
    let dice = if la.len() + lp.len() > 0 {
        (2.0 * m as f64) / (la.len() + lp.len()) as f64
    } else {
        0.0
    };
    let overlap = if la.len().min(lp.len()) > 0 {
        m as f64 / la.len().min(lp.len()) as f64
    } else {
        0.0
    };
    let word_score = 0.5 * dice + 0.5 * overlap;

    let has_meas = !riga.meas.is_empty()
        || !prod.meas.is_empty()
        || !riga.nums.is_empty()
        || !prod.nums.is_empty();
    let strong_dice = dice_set(&riga.meas, &prod.meas);
    let num_dice = dice_set(&riga.nums, &prod.nums);
    let meas_score = if has_meas {
        strong_dice.max(0.6 * num_dice)
    } else {
        0.0
    };

    let cat_score = if prod
        .cat_words
        .iter()
        .any(|c| la.iter().any(|a| token_match(a, c)))
    {
        1.0
    } else {
        0.0
    };

    let (w_word, w_meas, w_cat) = if has_meas {
        (0.50, 0.35, 0.15)
    } else {
        (0.85, 0.0, 0.15)
    };
    w_word * word_score + w_meas * meas_score + w_cat * cat_score
}

fn perche(riga: &Tok, prod: &Prepped) -> String {
    let mut parts = shared_words(&riga.words, &prod.words);
    for x in &riga.meas {
        if prod.meas.contains(x) {
            parts.push(x.clone());
        }
    }
    if parts.is_empty() {
        "—".to_string()
    } else {
        parts.into_iter().take(6).collect::<Vec<_>>().join(", ")
    }
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Calcola i candidati per ogni riga di listino non abbinata.
pub fn score_candidati(
    righe: &[Value],
    prodotti: &[ProdInput],
    limit: usize,
    min_score: f64,
) -> Vec<Value> {
    let prepped: Vec<Prepped> = prodotti.iter().map(prep_prodotto).collect();

    righe
        .iter()
        .map(|r| {
            let codice = r.get("codice").and_then(Value::as_str).unwrap_or("").to_string();
            let descrizione = r
                .get("descrizione")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let prezzo = r.get("prezzo").cloned().unwrap_or_else(|| Value::String(String::new()));
            let marca = r.get("marca").and_then(Value::as_str).unwrap_or("");
            let testo = format!("{} {}", descrizione, marca);
            let testo = testo.trim();

            let mut out = json!({
                "codice": codice,
                "descrizione": descrizione,
                "prezzo": prezzo,
                "candidati": [],
            });
            if testo.is_empty() {
                return out;
            }
            let riga_tok = tokenize(testo);
            if riga_tok.words.is_empty() && riga_tok.meas.is_empty() {
                return out;
            }

            let mut scored: Vec<(f64, &Prepped)> = Vec::new();
            for p in &prepped {
                let s = score(&riga_tok, p);
                if s >= min_score {
                    scored.push((s, p));
                }
            }
            scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            let candidati: Vec<Value> = scored
                .into_iter()
                .take(limit)
                .map(|(s, p)| {
                    json!({
                        "prodottoId": p.p.id,
                        "codice": p.p.codice,
                        "categoria": p.p.categoria,
                        "prezzoAcquistoAttuale": opt_num(p.p.prezzo_acquisto),
                        "quantita": opt_num(p.p.quantita),
                        "score": round3(s),
                        "fascia": fascia(s),
                        "perche": perche(&riga_tok, p),
                    })
                })
                .collect();
            out["candidati"] = Value::Array(candidati);
            out
        })
        .collect()
}

/// Soglia minima di default (per la route).
pub fn soglia_min() -> f64 {
    SOGLIA_MIN
}
