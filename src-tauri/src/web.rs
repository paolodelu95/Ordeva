//! Helper trasversali per le route: lettura lasca dei campi dal body JSON
//! (parità con la leniency di req.body in Express) e accesso al DB del tenant.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::db::{AppState, DEFAULT_TENANT};
use crate::error::{ApiError, ApiResult};

/// Stringa trimmata da `body[key]` ("" se assente/non stringa) — come `x?.trim()`.
pub fn str_field(body: &Value, key: &str) -> String {
    body.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Stringa trimmata con default se vuota — come `x?.trim() || default`.
pub fn str_or(body: &Value, key: &str, default: &str) -> String {
    let s = str_field(body, key);
    if s.is_empty() {
        default.to_string()
    } else {
        s
    }
}

/// `Some(stringa)` se non vuota, altrimenti `None` — come `x || null` per le TEXT nullable.
pub fn opt_str(body: &Value, key: &str) -> Option<String> {
    let s = str_field(body, key);
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Bool da `body[key]` (default false) — come `Boolean(x)` / `x ? 1 : 0`.
pub fn bool_field(body: &Value, key: &str) -> bool {
    match body.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|v| v != 0.0).unwrap_or(false),
        _ => false,
    }
}

/// Riga di documento rimasta in bianco: nessun prodotto, nessun codice, nessuna
/// descrizione (per una riga-nota vale il solo testo). Va scartata prima di
/// salvarla — una riga vuota non resta ferma dov'è: viene stampata, apre
/// un'aliquota a zero nel registro IVA e viaggia fino allo SdI come una linea
/// "Prodotto/Servizio" da 1 pezzo a 0 €.
///
/// Il presidio è lato server perché l'interfaccia non è l'unico modo di scrivere
/// documenti: import, ricorrenti e conversioni passano di qui senza toccarla.
pub fn riga_vuota(r: &Value) -> bool {
    let testo = |k: &str| r.get(k).and_then(Value::as_str).map(str::trim).unwrap_or("");
    if r.get("tipo").and_then(Value::as_str) == Some("NOTA") {
        return testo("descrizione").is_empty();
    }
    // `prodottoId: 0` significa "nessun prodotto", non il prodotto numero zero:
    // è la forma che arriva da una riga mai compilata.
    let senza_prodotto = opt_i64(r, "prodottoId").filter(|&v| v != 0).is_none();
    senza_prodotto && testo("codiceProdotto").is_empty() && testo("descrizione").is_empty()
}

/// Flag 0/1 per SQL, ma `None` quando la chiave manca nel body: serve agli UPDATE
/// che devono lasciare la colonna com'è se il chiamante non la manda (salvataggi
/// parziali, import, sincronizzazione del gemello anagrafico).
pub fn flag_opt(body: &Value, key: &str) -> Option<i64> {
    match body.get(key) {
        Some(Value::Bool(b)) => Some(i64::from(*b)),
        Some(Value::Number(n)) => Some(i64::from(n.as_f64().unwrap_or(0.0) != 0.0)),
        _ => None,
    }
}

/// Bool che vale true salvo valore esplicitamente false — come `x !== false`.
pub fn bool_or_true(body: &Value, key: &str) -> bool {
    !matches!(body.get(key), Some(Value::Bool(false)))
}

/// Verità JS (`x ? 1 : 0`) su un valore opzionale: false/0/""/null/assente → false.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
        _ => false,
    }
}

/// Numero da `body[key]` (default `d`).
pub fn num_or(body: &Value, key: &str, d: f64) -> f64 {
    body.get(key).and_then(Value::as_f64).unwrap_or(d)
}

/// Intero opzionale da `body[key]` (None se assente/null) — come `x ?? null`.
pub fn opt_i64(body: &Value, key: &str) -> Option<i64> {
    body.get(key).and_then(Value::as_i64)
}

/// Stringa grezza NON trimmata (`a.campo`): Some se stringa presente, altrimenti None
/// (assente/null → bind NULL, come `undefined` in better-sqlite3).
pub fn raw_opt(body: &Value, key: &str) -> Option<String> {
    match body.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// `a.campo || ''` senza trim: stringa presente o "".
pub fn str_def(body: &Value, key: &str) -> String {
    body.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Serializza un REAL come fa better-sqlite3 + JSON.stringify: intero se senza
/// parte frazionaria (4.0 → 4), altrimenti float (4.5 → 4.5). Serve per la parità
/// byte dei numeri (prezzi, quantità, aliquote, importi) col backend Node.
pub fn num(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 9.007e15 {
        json!(v as i64)
    } else {
        json!(v)
    }
}

/// Come [`num`] ma per REAL nullable (None → JSON null).
pub fn opt_num(v: Option<f64>) -> Value {
    match v {
        Some(x) => num(x),
        None => Value::Null,
    }
}

/// Data odierna UTC in formato YYYY-MM-DD (come `new Date().toISOString().slice(0,10)`).
pub fn oggi() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (y, m, d) = civil_from_days(secs / 86400);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Data odierna UTC + `days` giorni, formato YYYY-MM-DD.
pub fn oggi_plus(days: i64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (y, m, d) = civil_from_days(secs / 86400 + days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Anno corrente (UTC). Parità sufficiente con `new Date().getFullYear()` salvo
/// l'istante a cavallo di capodanno con fuso non-UTC.
pub fn anno() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    civil_from_days(secs / 86400).0
}

/// Formatta un numero come JS (`5.0` → "5", `5.5` → "5.5"), per i messaggi.
pub fn fmt_num(x: f64) -> String {
    if x.fract() == 0.0 {
        (x as i64).to_string()
    } else {
        x.to_string()
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

/// Parsa i primi 10 char "YYYY-MM-DD" in (y,m,d). None se non valido.
pub fn parse_ymd(s: &str) -> Option<(i64, i64, i64)> {
    let head: String = s.chars().take(10).collect();
    let p: Vec<&str> = head.split('-').collect();
    if p.len() != 3 {
        return None;
    }
    match (p[0].parse(), p[1].parse(), p[2].parse()) {
        (Ok(y), Ok(m), Ok(d)) => Some((y, m, d)),
        _ => None,
    }
}

/// Numero di giorni-epoch della data YYYY-MM-DD (None se non valida).
pub fn days_of(date: &str) -> Option<i64> {
    parse_ymd(date).map(|(y, m, d)| days_from_civil(y, m, d))
}

/// Ultimo giorno del mese (y, m) [m 1-indexed].
pub fn days_in_month(y: i64, m: i64) -> i64 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    days_from_civil(ny, nm, 1) - days_from_civil(y, m, 1)
}

/// giorni-epoch → "YYYY-MM-DD".
pub fn iso_of_days(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Giorni-epoch di oggi (UTC).
pub fn today_days() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64 / 86400
}

/// calcolaDataScadenza: data + giorni; se fine_mese → ultimo giorno del mese
/// (con la semantica di overflow JS Date.setMonth). None se data vuota.
pub fn data_scadenza(data: &str, giorni: i64, fine_mese: bool) -> Option<String> {
    let (y, m, d) = parse_ymd(data)?;
    let days = days_from_civil(y, m, d) + giorni;
    let (y2, m2, d2) = civil_from_days(days);
    if !fine_mese {
        return Some(format!("{y2:04}-{m2:02}-{d2:02}"));
    }
    // setMonth(m2+1) mantenendo il giorno d2 (con overflow JS), poi setDate(0).
    let (ny, nm) = if m2 == 12 { (y2 + 1, 1) } else { (y2, m2 + 1) };
    let landed = days_from_civil(ny, nm, 1) + (d2 - 1);
    let (y3, m3, _) = civil_from_days(landed);
    let last = days_from_civil(y3, m3, 1) - 1;
    let (y4, m4, d4) = civil_from_days(last);
    Some(format!("{y4:04}-{m4:02}-{d4:02}"))
}

/// Conversione giorni-epoch → data civile (algoritmo di Howard Hinnant).
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

/// Connessione del tenant corrente. In offline è sempre "default" (auth bypassata).
pub fn tenant_conn(state: &AppState) -> ApiResult<Arc<Mutex<Connection>>> {
    state.tenant_conn(DEFAULT_TENANT).map_err(ApiError::from)
}

/// Primo codice prodotto libero partendo da `base`: `base` stesso se nessuno lo
/// usa, altrimenti `radice-2`, `radice-3`… dove la radice è `base` senza un
/// eventuale `-N` finale — così duplicando "ART-2" si ottiene "ART-3" e non
/// "ART-2-2". Il confronto ignora maiuscole/minuscole, come l'indice UNIQUE su
/// `prodotti.codice`; su base vuota parte da "ART", perché un codice ci vuole.
pub fn codice_prodotto_libero(conn: &Connection, base: &str) -> String {
    use rusqlite::OptionalExtension;
    let base = base.trim();
    let occupato = |c: &str| -> bool {
        conn.query_row("SELECT 1 FROM prodotti WHERE codice = ?1 COLLATE NOCASE LIMIT 1", [c], |_| Ok(()))
            .optional()
            .unwrap_or(None)
            .is_some()
    };
    if !base.is_empty() && !occupato(base) {
        return base.to_string();
    }
    let radice = match base.rsplit_once('-') {
        Some((testa, coda)) if !testa.is_empty() && !coda.is_empty() && coda.chars().all(|c| c.is_ascii_digit()) => testa,
        _ => base,
    };
    let radice = if radice.is_empty() { "ART" } else { radice };
    // Il tetto è solo una rete di sicurezza: con 9999 omonimi c'è altro che non va.
    for n in 2..10_000 {
        let candidato = format!("{radice}-{n}");
        if !occupato(&candidato) {
            return candidato;
        }
    }
    let prossimo_id: i64 = conn
        .query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM prodotti", [], |r| r.get(0))
        .unwrap_or(0);
    format!("{radice}-ID{prossimo_id}")
}

#[cfg(test)]
mod test_riga_vuota {
    use super::*;
    use serde_json::json;

    /// Il caso reale: un clic di troppo su "Aggiungi riga" lasciava una riga in
    /// bianco che veniva salvata, stampata e trasmessa allo SdI.
    #[test]
    fn una_riga_senza_niente_e_vuota() {
        assert!(riga_vuota(&json!({ "quantita": 1, "prezzo": 0 })));
        assert!(riga_vuota(&json!({ "descrizione": "   ", "codiceProdotto": "" })));
        assert!(riga_vuota(&json!({})));
    }

    #[test]
    fn basta_un_solo_riferimento_perche_la_riga_valga() {
        assert!(!riga_vuota(&json!({ "prodottoId": 7 })));
        assert!(!riga_vuota(&json!({ "codiceProdotto": "VIT-4X40" })));
        assert!(!riga_vuota(&json!({ "descrizione": "Trasporto" })));
    }

    /// `prodottoId: 0` è "nessun prodotto", non il prodotto numero zero.
    #[test]
    fn il_prodotto_zero_non_conta() {
        assert!(riga_vuota(&json!({ "prodottoId": 0 })));
    }

    /// Una riga-nota vale per il suo testo: senza testo non serve a niente.
    #[test]
    fn la_nota_vale_solo_col_testo() {
        assert!(riga_vuota(&json!({ "tipo": "NOTA", "descrizione": "" })));
        assert!(!riga_vuota(&json!({ "tipo": "NOTA", "descrizione": "Consegna entro 5 gg" })));
        // una nota non ha prodotto: non deve salvarsi solo perché ne ha uno
        assert!(riga_vuota(&json!({ "tipo": "NOTA", "prodottoId": 7, "descrizione": " " })));
    }
}
