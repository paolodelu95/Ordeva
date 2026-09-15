//! /api/scadenze-fiscali — calendario delle scadenze fiscali italiane (offline).
//!
//! Le scadenze standard (IVA, LIPE, ritenute, imposte, dichiarazioni) sono GENERATE
//! automaticamente per l'anno richiesto in base a due impostazioni d'azienda
//! (periodicità IVA mensile/trimestrale, sostituto d'imposta). L'utente può segnarle
//! "fatto", aggiungere note/importo e creare scadenze manuali. Le generate hanno una
//! `chiave` naturale: rigenerarle è idempotente (INSERT OR IGNORE) e non sovrascrive lo
//! stato impostato dall'utente.
//!
//! Le date sono quelle ordinarie; eventuali proroghe ufficiali non sono considerate.

use axum::{
    extract::{Path, Query, State},
    routing::{get, put},
    Json, Router,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::db::AppState;
use crate::error::ApiResult;
use crate::web::{anno, str_field, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/config", put(set_config))
        .route("/:id", put(update).delete(remove))
}

const MESI: [&str; 12] = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
    "settembre", "ottobre", "novembre", "dicembre",
];

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

/// Mese/anno precedenti a `m` (1..=12) dell'anno `y` (per "IVA/ritenute del mese prima").
fn mese_prec(m: i64, y: i64) -> (&'static str, i64) {
    if m == 1 {
        (MESI[11], y - 1)
    } else {
        (MESI[(m - 2) as usize], y)
    }
}

/// Legge la configurazione fiscale dall'azienda.
fn leggi_config(conn: &Connection) -> (String, bool) {
    conn.query_row(
        "SELECT COALESCE(iva_periodicita,'trimestrale'), COALESCE(sostituto_imposta,0) FROM azienda WHERE id=1",
        [],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)),
    )
    .unwrap_or_else(|_| ("trimestrale".to_string(), false))
}

/// Genera (idempotente) le scadenze standard dell'anno `y` secondo la configurazione.
fn genera(conn: &Connection, y: i64, periodicita: &str, sostituto: bool) -> rusqlite::Result<()> {
    // (chiave, data, titolo, categoria)
    let mut voci: Vec<(String, String, String, &str)> = Vec::new();

    // ── IVA ──────────────────────────────────────────────────────────────────
    if periodicita == "mensile" {
        for m in 1..=12 {
            let (nome, py) = mese_prec(m, y);
            voci.push((
                format!("iva-mens-{y}-{m:02}"),
                format!("{y}-{m:02}-16"),
                format!("Versamento IVA {nome} {py}"),
                "IVA",
            ));
        }
    } else {
        voci.push((format!("iva-trim-{y}-1"), format!("{y}-05-16"), "Versamento IVA 1° trimestre".into(), "IVA"));
        voci.push((format!("iva-trim-{y}-2"), format!("{y}-08-16"), "Versamento IVA 2° trimestre".into(), "IVA"));
        voci.push((format!("iva-trim-{y}-3"), format!("{y}-11-16"), "Versamento IVA 3° trimestre".into(), "IVA"));
        voci.push((format!("iva-trim-{y}-4"), format!("{y}-03-16"), "Versamento IVA saldo (4° trim. anno prec.)".into(), "IVA"));
    }

    // ── LIPE (comunicazione liquidazioni periodiche IVA) ───────────────────────
    let feb_fine = if is_leap(y) { 29 } else { 28 };
    voci.push((format!("lipe-{y}-4"), format!("{y}-02-{feb_fine}"), "Comunicazione LIPE 4° trim. (anno prec.)".into(), "LIPE"));
    voci.push((format!("lipe-{y}-1"), format!("{y}-05-31"), "Comunicazione LIPE 1° trimestre".into(), "LIPE"));
    voci.push((format!("lipe-{y}-2"), format!("{y}-09-30"), "Comunicazione LIPE 2° trimestre".into(), "LIPE"));
    voci.push((format!("lipe-{y}-3"), format!("{y}-11-30"), "Comunicazione LIPE 3° trimestre".into(), "LIPE"));

    // ── Dichiarazioni ──────────────────────────────────────────────────────────
    voci.push((format!("cu-{y}"), format!("{y}-03-16"), "Certificazione Unica (CU)".into(), "Dichiarazioni"));
    voci.push((format!("iva-annuale-{y}"), format!("{y}-04-30"), "Dichiarazione IVA annuale".into(), "Dichiarazioni"));

    // ── Ritenute (solo se sostituto d'imposta) ─────────────────────────────────
    if sostituto {
        for m in 1..=12 {
            let (nome, py) = mese_prec(m, y);
            voci.push((
                format!("rit-{y}-{m:02}"),
                format!("{y}-{m:02}-16"),
                format!("Versamento ritenute {nome} {py}"),
                "Ritenute",
            ));
        }
    }

    // ── Imposte sui redditi ─────────────────────────────────────────────────────
    voci.push((format!("imposte-saldo-{y}"), format!("{y}-06-30"), "Saldo e 1° acconto imposte".into(), "Imposte"));
    voci.push((format!("imposte-acconto2-{y}"), format!("{y}-11-30"), "2° acconto imposte".into(), "Imposte"));

    for (chiave, data, titolo, cat) in voci {
        conn.execute(
            "INSERT OR IGNORE INTO scadenze_fiscali (chiave, data, titolo, categoria, auto) \
             VALUES (?1, ?2, ?3, ?4, 1)",
            params![chiave, data, titolo, cat],
        )?;
    }
    Ok(())
}


/// Periodo di liquidazione a cui una scadenza IVA si riferisce, dedotto dalla
/// sua chiave. Il versamento del 16 marzo salda il quarto trimestre dell'anno
/// PRIMA: senza questo la scadenza mostrerebbe l'importo sbagliato.
fn periodo_iva(chiave: &str) -> Option<(String, String, String, String)> {
    let parti: Vec<&str> = chiave.split('-').collect();
    match parti.as_slice() {
        // iva-mens-2026-03 → liquidazione di febbraio 2026, codice tributo 6002
        ["iva", "mens", anno, mese] => {
            let y: i64 = anno.parse().ok()?;
            let m: i64 = mese.parse().ok()?;
            let (ly, lm) = if m == 1 { (y - 1, 12) } else { (y, m - 1) };
            let ultimo = ultimo_giorno(ly, lm);
            Some((
                format!("{ly:04}-{lm:02}-01"),
                format!("{ly:04}-{lm:02}-{ultimo:02}"),
                format!("60{lm:02}"),
                format!("{} {}", MESI[(lm - 1) as usize], ly),
            ))
        }
        // iva-trim-2026-1 → primo trimestre 2026, codice tributo 6031
        ["iva", "trim", anno, n] => {
            let y: i64 = anno.parse().ok()?;
            let n: i64 = n.parse().ok()?;
            // Il quarto trimestre si versa a marzo dell'anno successivo.
            let (ly, q) = if n == 4 { (y - 1, 4) } else { (y, n) };
            let primo = (q - 1) * 3 + 1;
            let ultimo_mese = primo + 2;
            let ultimo = ultimo_giorno(ly, ultimo_mese);
            Some((
                format!("{ly:04}-{primo:02}-01"),
                format!("{ly:04}-{ultimo_mese:02}-{ultimo:02}"),
                format!("603{q}"),
                format!("{q}\u{b0} trimestre {ly}"),
            ))
        }
        _ => None,
    }
}

/// Giorni fra due date ISO (AAAA-MM-GG). Serve solo per dire "sei in ritardo di
/// N giorni", non per calcoli fiscali.
fn giorni_tra(dal: &str, al: &str) -> i64 {
    let g = |s: &str| -> Option<i64> {
        let mut p = s.split('-');
        let y: i64 = p.next()?.parse().ok()?;
        let m: i64 = p.next()?.parse().ok()?;
        let d: i64 = p.next()?.parse().ok()?;
        // Giorni civili (algoritmo di Howard Hinnant), come in web.rs.
        let y2 = if m <= 2 { y - 1 } else { y };
        let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
        let yoe = y2 - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Some(era * 146097 + doe - 719468)
    };
    match (g(dal), g(al)) {
        (Some(a), Some(b)) => b - a,
        _ => 0,
    }
}

fn ultimo_giorno(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => if is_leap(y) { 29 } else { 28 },
    }
}

/// Saldo IVA del periodo, calcolato dai documenti registrati.
fn saldo_iva(conn: &Connection, dal: &str, al: &str) -> rusqlite::Result<(f64, f64)> {
    let vend = crate::routes::stats::iva_per_aliquota(conn, true, dal, al)?;
    let acq = crate::routes::stats::iva_per_aliquota(conn, false, dal, al)?;
    let debito: f64 = vend.iter().map(|(_, _, i)| i).sum();
    let credito: f64 = acq.iter().map(|(_, _, i)| i).sum();
    Ok((
        (debito * 100.0).round() / 100.0,
        (credito * 100.0).round() / 100.0,
    ))
}

fn riga_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "data": r.get::<_, String>(1)?,
        "titolo": r.get::<_, String>(2)?,
        "categoria": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
        "importo": r.get::<_, Option<f64>>(4)?,
        "note": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
        "stato": r.get::<_, Option<String>>(6)?.unwrap_or_else(|| "pendente".into()),
        "auto": r.get::<_, Option<i64>>(7)? == Some(1),
        "chiave": r.get::<_, Option<String>>(8).ok().flatten().unwrap_or_default(),
    }))
}

/// GET /api/scadenze-fiscali?anno=YYYY — genera (se serve) e restituisce le scadenze
/// dell'anno, ordinate per data, più la configurazione corrente.
async fn list(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let y: i64 = q.get("anno").and_then(|s| s.parse().ok()).unwrap_or_else(anno);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let (periodicita, sostituto) = leggi_config(&conn);
    genera(&conn, y, &periodicita, sostituto)?;

    let mut stmt = conn.prepare(
        "SELECT id, data, titolo, categoria, importo, note, stato, auto, chiave \
         FROM scadenze_fiscali WHERE substr(data,1,4)=?1 ORDER BY data, id",
    )?;
    let mut scadenze = stmt
        .query_map(params![y.to_string()], riga_dto)?
        .collect::<Result<Vec<_>, _>>()?;

    // Alle scadenze IVA si attacca quanto c'è da versare, preso dalla stessa
    // liquidazione che si vede in Compliance: sapere QUANDO senza sapere QUANTO
    // costringeva comunque a rifare il conto a mano.
    let oggi = crate::web::oggi();
    for sc in scadenze.iter_mut() {
        let chiave = sc["chiave"].as_str().unwrap_or("").to_string();
        let Some((dal, al, codice, etichetta)) = periodo_iva(&chiave) else { continue };
        let (debito, credito) = saldo_iva(&conn, &dal, &al)?;
        let saldo = ((debito - credito) * 100.0).round() / 100.0;
        // I trimestrali per opzione versano l'1% di interessi, tranne sul saldo
        // annuale (quarto trimestre), che ne è esente.
        let interessi = if periodicita != "mensile" && !chiave.ends_with("-4") && saldo > 0.0 {
            (saldo * 0.01 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let fatto = sc["stato"].as_str().unwrap_or("") == "fatto";
        let scaduta = !fatto && sc["data"].as_str().unwrap_or("") < oggi.as_str() && saldo > 0.0;
        sc["iva"] = json!({
            "periodo": etichetta,
            "dal": dal, "al": al,
            "codiceTributo": codice,
            "debito": debito, "credito": credito,
            "saldo": saldo,
            "interessi": interessi,
            "daVersare": ((saldo + interessi) * 100.0).round() / 100.0,
            // A credito non si versa nulla: l'importo si riporta al periodo dopo.
            "aCredito": saldo < 0.0,
            "scaduta": scaduta,
            "giorniRitardo": if scaduta { giorni_tra(sc["data"].as_str().unwrap_or(""), &oggi) } else { 0 },
        });
    }

    Ok(Json(json!({
        "anno": y,
        "config": { "ivaPeriodicita": periodicita, "sostitutoImposta": sostituto },
        "scadenze": scadenze,
    })))
}

/// POST /api/scadenze-fiscali — scadenza manuale.
async fn create(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let data = str_field(&body, "data");
    let titolo = str_field(&body, "titolo");
    if data.is_empty() || titolo.is_empty() {
        return Err(crate::error::ApiError::bad_request("Data e titolo obbligatori"));
    }
    let categoria = {
        let c = str_field(&body, "categoria");
        if c.is_empty() { "Altro".to_string() } else { c }
    };
    let importo = body.get("importo").and_then(Value::as_f64);
    let note = str_field(&body, "note");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO scadenze_fiscali (data, titolo, categoria, importo, note, auto) \
         VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![data, titolo, categoria, importo, note],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

/// PUT /api/scadenze-fiscali/:id — aggiorna campi/stato (es. segnare "fatto").
async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    // Stato (pendente|fatto) sempre aggiornabile; gli altri campi solo se forniti.
    if let Some(stato) = body.get("stato").and_then(Value::as_str) {
        let stato = if stato == "fatto" { "fatto" } else { "pendente" };
        conn.execute("UPDATE scadenze_fiscali SET stato=?1 WHERE id=?2", params![stato, id])?;
    }
    if body.get("note").is_some() {
        conn.execute("UPDATE scadenze_fiscali SET note=?1 WHERE id=?2", params![str_field(&body, "note"), id])?;
    }
    if body.get("importo").is_some() {
        conn.execute("UPDATE scadenze_fiscali SET importo=?1 WHERE id=?2", params![body.get("importo").and_then(Value::as_f64), id])?;
    }
    // Titolo/data/categoria modificabili (utile per le scadenze manuali).
    if let Some(t) = body.get("titolo").and_then(Value::as_str) {
        if !t.is_empty() {
            conn.execute("UPDATE scadenze_fiscali SET titolo=?1 WHERE id=?2", params![t, id])?;
        }
    }
    if let Some(d) = body.get("data").and_then(Value::as_str) {
        if !d.is_empty() {
            conn.execute("UPDATE scadenze_fiscali SET data=?1 WHERE id=?2", params![d, id])?;
        }
    }
    if let Some(c) = body.get("categoria").and_then(Value::as_str) {
        if !c.is_empty() {
            conn.execute("UPDATE scadenze_fiscali SET categoria=?1 WHERE id=?2", params![c, id])?;
        }
    }
    Ok(Json(json!({ "success": true })))
}

/// DELETE /api/scadenze-fiscali/:id — elimina (le scadenze auto verrebbero rigenerate al
/// prossimo caricamento: per "toglierle" conviene segnarle "fatto").
async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM scadenze_fiscali WHERE id=?1", params![id])?;
    Ok(Json(json!({ "success": true })))
}

/// PUT /api/scadenze-fiscali/config — periodicità IVA + sostituto d'imposta, poi rigenera.
async fn set_config(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let periodicita = {
        let p = str_field(&body, "ivaPeriodicita");
        if p == "mensile" { "mensile".to_string() } else { "trimestrale".to_string() }
    };
    let sostituto = crate::web::bool_field(&body, "sostitutoImposta");
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "UPDATE azienda SET iva_periodicita=?1, sostituto_imposta=?2 WHERE id=1",
        params![periodicita, sostituto as i64],
    )?;
    genera(&conn, anno(), &periodicita, sostituto)?;
    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE scadenze_fiscali (id INTEGER PRIMARY KEY AUTOINCREMENT, \
             chiave TEXT UNIQUE, data TEXT NOT NULL, titolo TEXT NOT NULL, \
             categoria TEXT, importo REAL, note TEXT DEFAULT '', \
             stato TEXT DEFAULT 'pendente', auto INTEGER DEFAULT 0);",
        )
        .unwrap();
        c
    }

    fn count(c: &Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM scadenze_fiscali", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn genera_trimestrale_idempotente() {
        let c = conn();
        // trimestrale, no sostituto: IVA 4 + LIPE 4 + Dichiarazioni 2 + Imposte 2 = 12.
        genera(&c, 2026, "trimestrale", false).unwrap();
        assert_eq!(count(&c), 12);
        // Rigenerare non duplica.
        genera(&c, 2026, "trimestrale", false).unwrap();
        assert_eq!(count(&c), 12);
    }

    #[test]
    fn genera_mensile_con_ritenute() {
        let c = conn();
        // mensile + sostituto: IVA 12 + LIPE 4 + Dichiarazioni 2 + Ritenute 12 + Imposte 2 = 32.
        genera(&c, 2026, "mensile", true).unwrap();
        assert_eq!(count(&c), 32);
        // IVA di dicembre dell'anno prima è la scadenza del 16 gennaio.
        let t: String = c
            .query_row("SELECT titolo FROM scadenze_fiscali WHERE chiave='iva-mens-2026-01'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(t, "Versamento IVA dicembre 2025");
    }

    #[test]
    fn lipe_quarto_trim_gestisce_anno_bisestile() {
        let b = conn();
        genera(&b, 2024, "trimestrale", false).unwrap(); // 2024 bisestile
        let d: String = b.query_row("SELECT data FROM scadenze_fiscali WHERE chiave='lipe-2024-4'", [], |r| r.get(0)).unwrap();
        assert_eq!(d, "2024-02-29");
        let n = conn();
        genera(&n, 2026, "trimestrale", false).unwrap(); // 2026 non bisestile
        let d2: String = n.query_row("SELECT data FROM scadenze_fiscali WHERE chiave='lipe-2026-4'", [], |r| r.get(0)).unwrap();
        assert_eq!(d2, "2026-02-28");
    }
}

#[cfg(test)]
mod test_importi_iva {
    use super::*;

    /// Il periodo di liquidazione non coincide con la data di versamento: il 16
    /// marzo si salda il quarto trimestre dell'anno PRIMA, e il 16 di ogni mese
    /// il mese precedente. Sbagliarlo significa mostrare l'importo di un altro
    /// periodo, cioè il numero sbagliato accanto alla scadenza giusta.
    #[test]
    fn il_periodo_di_liquidazione_e_quello_precedente() {
        let (dal, al, cod, et) = periodo_iva("iva-mens-2026-03").unwrap();
        assert_eq!((dal.as_str(), al.as_str()), ("2026-02-01", "2026-02-28"));
        assert_eq!(cod, "6002");
        assert_eq!(et, "febbraio 2026");

        // Gennaio salda dicembre dell'anno prima.
        let (dal, al, cod, _) = periodo_iva("iva-mens-2026-01").unwrap();
        assert_eq!((dal.as_str(), al.as_str()), ("2025-12-01", "2025-12-31"));
        assert_eq!(cod, "6012");

        // Anno bisestile: febbraio ha 29 giorni.
        let (_, al, _, _) = periodo_iva("iva-mens-2024-03").unwrap();
        assert_eq!(al, "2024-02-29");

        let (dal, al, cod, et) = periodo_iva("iva-trim-2026-1").unwrap();
        assert_eq!((dal.as_str(), al.as_str()), ("2026-01-01", "2026-03-31"));
        assert_eq!(cod, "6031");
        assert!(et.contains("trimestre 2026"));

        // Il quarto trimestre si versa a marzo dell'anno dopo.
        let (dal, al, cod, et) = periodo_iva("iva-trim-2026-4").unwrap();
        assert_eq!((dal.as_str(), al.as_str()), ("2025-10-01", "2025-12-31"));
        assert_eq!(cod, "6034");
        assert!(et.contains("2025"));

        // Le scadenze non IVA non hanno un periodo di liquidazione.
        assert!(periodo_iva("lipe-2026-1").is_none());
        assert!(periodo_iva("imposte-saldo-2026").is_none());
    }

    #[test]
    fn conta_i_giorni_di_ritardo() {
        assert_eq!(giorni_tra("2026-03-16", "2026-03-20"), 4);
        assert_eq!(giorni_tra("2026-02-28", "2026-03-01"), 1);
        assert_eq!(giorni_tra("2024-02-28", "2024-03-01"), 2, "2024 è bisestile");
        assert_eq!(giorni_tra("2025-12-31", "2026-01-01"), 1);
    }

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../schema/tenant.sql")).unwrap();
        c.execute("INSERT INTO clienti (id, ragione_sociale) VALUES (900,'Studio Rossi')", []).unwrap();
        c.execute("INSERT INTO fornitori (id, ragione_sociale) VALUES (900,'ACME')", []).unwrap();
        c
    }

    /// L'importo accanto alla scadenza è quello della liquidazione del periodo:
    /// IVA sulle vendite meno IVA sugli acquisti dello stesso trimestre.
    #[test]
    fn il_saldo_del_periodo_esce_dai_documenti() {
        let c = db();
        c.execute("INSERT INTO fatture (id,numero,data_emissione,cliente_id,stato) VALUES (1,'1','2026-02-10',900,'EMESSA')", []).unwrap();
        c.execute("INSERT INTO fatture_righe (fattura_id,descrizione,quantita,prezzo,iva) VALUES (1,'x',1,1000,22)", []).unwrap();
        c.execute("INSERT INTO acquisti (id,numero,data_emissione,fornitore_id) VALUES (1,'a','2026-02-20',900)", []).unwrap();
        c.execute("INSERT INTO acquisti_righe (acquisto_id,descrizione,quantita,prezzo,iva) VALUES (1,'y',1,500,22)", []).unwrap();
        // Fuori periodo: non deve entrarci.
        c.execute("INSERT INTO fatture (id,numero,data_emissione,cliente_id,stato) VALUES (2,'2','2026-04-01',900,'EMESSA')", []).unwrap();
        c.execute("INSERT INTO fatture_righe (fattura_id,descrizione,quantita,prezzo,iva) VALUES (2,'z',1,9999,22)", []).unwrap();

        let (dal, al, _, _) = periodo_iva("iva-trim-2026-1").unwrap();
        let (debito, credito) = saldo_iva(&c, &dal, &al).unwrap();
        assert!((debito - 220.0).abs() < 0.01, "debito {debito}");
        assert!((credito - 110.0).abs() < 0.01, "credito {credito}");
    }
}
