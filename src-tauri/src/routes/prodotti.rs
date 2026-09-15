//! /api/prodotti — parità con routes/prodotti.js (catalogo, varianti, fornitori,
//! rettifiche giacenza, import e import-listino con fuzzy matching).

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::match_prodotti::{score_candidati, soglia_min, ProdInput};
use crate::stock::{adj_giacenza, magazzino_default_id, riallinea_giacenze};
use crate::web::{num, opt_num, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/sotto-soglia", get(sotto_soglia))
        .route("/count", get(count))
        .route("/valore", get(valore))
        .route("/schede", get(schede))
        .route("/import", post(import))
        .route("/import-listino", post(import_listino))
        .route("/import-listino/match", post(import_listino_match))
        .route("/import-listino/abbina", post(import_listino_abbina))
        .route("/rettifica-bulk", post(rettifica_bulk))
        .route("/codici-alias/:aliasId", axum::routing::delete(alias_remove))
        .route("/:id", get(detail).put(update).delete(remove))
        .route("/:id/rettifica", post(rettifica))
        .route("/:id/fornitori", get(fornitori_prodotto))
        .route("/:id/codici-alias", get(codici_alias))
}

// ── GET liste/dettaglio ──────────────────────────────────────────────────────

async fn list(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(Value::Array(query_dto(&conn, "SELECT * FROM prodotti ORDER BY codice", [])?)))
}

async fn sotto_soglia(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(Value::Array(query_dto(
        &conn,
        "SELECT * FROM prodotti WHERE soglia_minima > 0 AND quantita < soglia_minima ORDER BY quantita ASC, codice",
        [],
    )?)))
}

async fn count(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM prodotti", [], |r| r.get(0))?;
    Ok(Json(json!(n)))
}

async fn valore(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let v: Option<f64> =
        conn.query_row("SELECT SUM(prezzo * quantita) FROM prodotti", [], |r| r.get(0))?;
    Ok(Json(num(v.unwrap_or(0.0))))
}

async fn schede(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let ids: Vec<i64> = q
        .get("ids")
        .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
        .unwrap_or_default();
    if ids.is_empty() {
        return Ok(Json(json!([])));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!("SELECT id, codice, descrizione, peso, dimensioni, immagine FROM prodotti WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    use rusqlite::types::ToSql;
    let p: Vec<&dyn ToSql> = ids.iter().map(|i| i as &dyn ToSql).collect();
    let rows = stmt
        .query_map(p.as_slice(), |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "codice": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "descrizione": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "peso": opt_num(r.get::<_, Option<f64>>(3)?),
                "dimensioni": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "immagine": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let row = conn
        .query_row("SELECT * FROM prodotti WHERE id=?1", [id], |r| {
            Ok(to_dto(&conn, r, true))
        })
        .optional()?;
    row.map(Json)
        .ok_or_else(|| ApiError::not_found("Prodotto non trovato"))
}

async fn fornitori_prodotto(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT pf.id, pf.fornitore_id, pf.codice_fornitore, pf.prezzo_acquisto, pf.predefinito, \
                f.ragione_sociale AS fornitore_nome \
         FROM prodotto_fornitori pf LEFT JOIN fornitori f ON f.id = pf.fornitore_id \
         WHERE pf.prodotto_id = ?1 ORDER BY pf.predefinito DESC, f.ragione_sociale",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "fornitoreId": r.get::<_, Option<i64>>(1)?,
                "fornitoreNome": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                "codiceFornitore": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "prezzoAcquisto": opt_num(r.get::<_, Option<f64>>(3)?),
                "predefinito": r.get::<_, Option<i64>>(4)? == Some(1),
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn codici_alias(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT a.id, a.codice, a.fornitore_id, a.created_at, f.ragione_sociale AS fornitore_nome \
         FROM fornitore_codice_alias a LEFT JOIN fornitori f ON f.id = a.fornitore_id \
         WHERE a.prodotto_id = ?1 ORDER BY f.ragione_sociale, a.codice",
    )?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "codice": r.get::<_, Option<String>>(1)?,
                "fornitoreId": r.get::<_, Option<i64>>(2)?,
                "fornitoreNome": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                "createdAt": r.get::<_, Option<String>>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

// ── create/update/delete ─────────────────────────────────────────────────────

async fn create(State(state): State<AppState>, Json(p): Json<Value>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let codice = codice_valido(&conn, &p, None)?;
    conn.execute(
        "INSERT INTO prodotti \
         (categoria, descrizione, prezzo, prezzo_acquisto, quantita, soglia_minima, unita_misura, codice, codice_fornitore, iva, barcode, ha_varianti, fornitore_id_preferito, riordino_quantita, peso, dimensioni, immagine) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![
            raw_opt(&p, "categoria"),
            raw_opt(&p, "descrizione"),
            num_opt(&p, "prezzo"),
            num_opt(&p, "prezzoAcquisto"),
            num_or0(&p, "quantita"),
            num_or0(&p, "sogliaMinima"),
            raw_opt(&p, "unitaMisura"),
            &codice,
            str_def(&p, "codiceFornitore"),
            num_opt(&p, "iva"),
            str_def(&p, "barcode"),
            flag(&p, "haVarianti"),
            opt_id(&p, "fornitoreIdPreferito"),
            num_or0(&p, "riordinoQuantita"),
            num_opt(&p, "peso"),
            str_def(&p, "dimensioni"),
            str_def(&p, "immagine"),
        ],
    )?;
    let id = conn.last_insert_rowid();
    if flag(&p, "haVarianti") == 1 {
        if let Some(v) = p.get("varianti").and_then(Value::as_array) {
            if !v.is_empty() {
                save_varianti(&conn, id, v)?;
                sync_quantita(&conn, id)?;
            }
        }
    }
    if let Some(forn) = p.get("fornitori") {
        save_fornitori(&conn, id, forn)?;
    }
    riallinea_giacenze(&conn, id)?;
    Ok(Json(json!({ "id": id })))
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(p): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let codice = codice_valido(&conn, &p, Some(id))?;
    conn.execute(
        "UPDATE prodotti SET categoria=?1, descrizione=?2, prezzo=?3, prezzo_acquisto=?4, \
         quantita=?5, soglia_minima=?6, unita_misura=?7, codice=?8, codice_fornitore=?9, iva=?10, barcode=?11, ha_varianti=?12, \
         fornitore_id_preferito=?13, riordino_quantita=?14, peso=?15, dimensioni=?16 WHERE id=?17",
        params![
            raw_opt(&p, "categoria"),
            raw_opt(&p, "descrizione"),
            num_opt(&p, "prezzo"),
            num_opt(&p, "prezzoAcquisto"),
            num_or0(&p, "quantita"),
            num_or0(&p, "sogliaMinima"),
            raw_opt(&p, "unitaMisura"),
            &codice,
            str_def(&p, "codiceFornitore"),
            num_opt(&p, "iva"),
            str_def(&p, "barcode"),
            flag(&p, "haVarianti"),
            opt_id(&p, "fornitoreIdPreferito"),
            num_or0(&p, "riordinoQuantita"),
            num_opt(&p, "peso"),
            str_def(&p, "dimensioni"),
            id,
        ],
    )?;
    // L'immagine si aggiorna solo se inclusa nel body (anche "").
    if p.get("immagine").is_some() {
        conn.execute(
            "UPDATE prodotti SET immagine=?1 WHERE id=?2",
            params![str_def(&p, "immagine"), id],
        )?;
    }
    if flag(&p, "haVarianti") == 1 {
        conn.execute("DELETE FROM prodotto_varianti WHERE prodotto_id=?1", [id])?;
        if let Some(v) = p.get("varianti").and_then(Value::as_array).filter(|v| !v.is_empty()) {
            save_varianti(&conn, id, v)?;
        }
        sync_quantita(&conn, id)?;
    } else {
        conn.execute("DELETE FROM prodotto_varianti WHERE prodotto_id=?1", [id])?;
    }
    if let Some(forn) = p.get("fornitori") {
        save_fornitori(&conn, id, forn)?;
    }
    riallinea_giacenze(&conn, id)?;
    Ok(Json(json!({ "success": true })))
}

async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    for t in [
        "ddt_righe", "fatture_righe", "note_credito_righe", "ordini_righe", "preventivi_righe",
        "acquisti_righe", "vendite_banco_righe", "arrivi_merce_righe",
    ] {
        conn.execute(&format!("UPDATE {t} SET prodotto_id=NULL WHERE prodotto_id=?1"), [id])?;
    }
    conn.execute("DELETE FROM prodotti WHERE id=?1", [id])?;
    Ok(Json(json!({ "success": true })))
}

async fn alias_remove(
    State(state): State<AppState>,
    Path(alias_id): Path<i64>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute("DELETE FROM fornitore_codice_alias WHERE id=?1", [alias_id])?;
    Ok(Json(json!({ "success": true })))
}

// ── rettifiche ───────────────────────────────────────────────────────────────

async fn rettifica(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mag = b.get("magazzinoId").and_then(Value::as_i64);
    let nuova = b.get("quantita").and_then(Value::as_f64);
    let note = b.get("note").and_then(Value::as_str).unwrap_or("");
    let delta = applica_rettifica(&conn, id, nuova, note, None, mag)?;
    Ok(Json(json!({ "success": true, "delta": num(delta) })))
}

async fn rettifica_bulk(
    State(state): State<AppState>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let items = match b.get("items").and_then(Value::as_array) {
        Some(it) if !it.is_empty() => it.clone(),
        _ => return Err(ApiError::bad_request("Nessun articolo da rettificare")),
    };
    if items.len() > 1000 {
        return Err(ApiError::bad_request("Troppi articoli (max 1000)"));
    }
    let note_full = b.get("note").and_then(Value::as_str).unwrap_or("Inventario");
    let note: String = note_full.chars().take(500).collect();
    let body_mag = b.get("magazzinoId").and_then(Value::as_i64);

    let arc = tenant_conn(&state)?;
    let mut conn = arc.lock().unwrap();
    let tx = conn.transaction().map_err(ApiError::from)?;
    let mut movimenti = 0i64;
    for it in &items {
        let pid = it.get("prodottoId").and_then(Value::as_i64).unwrap_or(0);
        let nuova = it.get("quantita").and_then(Value::as_f64);
        let var = it.get("varianteId").and_then(Value::as_i64);
        let mag = it.get("magazzinoId").and_then(Value::as_i64).or(body_mag);
        let delta = applica_rettifica(&tx, pid, nuova, &note, var, mag)?;
        if delta != 0.0 {
            movimenti += 1;
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "success": true, "applied": items.len(), "movimenti": movimenti })))
}

/// Applica una rettifica (NON apre transazione: componibile dal chiamante).
fn applica_rettifica(
    conn: &Connection,
    prodotto_id: i64,
    nuova: Option<f64>,
    note: &str,
    variante_id: Option<i64>,
    magazzino_id: Option<i64>,
) -> ApiResult<f64> {
    let nuova = nuova.ok_or_else(|| ApiError::bad_request("Quantità non valida"))?;
    let prod: Option<String> = conn
        .query_row("SELECT codice FROM prodotti WHERE id=?1", [prodotto_id], |r| {
            r.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten()
        .map(Some)
        .unwrap_or(None);
    // distinzione "prodotto non trovato" vs codice NULL
    let exists: bool = conn
        .query_row("SELECT 1 FROM prodotti WHERE id=?1", [prodotto_id], |_| Ok(()))
        .optional()?
        .is_some();
    if !exists {
        return Err(ApiError::not_found("Prodotto non trovato"));
    }
    let codice = prod.unwrap_or_default();
    let note_str: String = note.chars().take(500).collect();
    let data = oggi();
    let mag = magazzino_id.or(magazzino_default_id(conn)?);

    if let Some(vid) = variante_id {
        let v = conn
            .query_row(
                "SELECT COALESCE(quantita,0), taglia, colore FROM prodotto_varianti WHERE id=?1 AND prodotto_id=?2",
                params![vid, prodotto_id],
                |r| {
                    Ok((
                        r.get::<_, f64>(0)?,
                        r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    ))
                },
            )
            .optional()?;
        let (cur, taglia, colore) = v.ok_or_else(|| ApiError::not_found("Variante non trovata"))?;
        let delta = nuova - cur;
        if delta != 0.0 {
            conn.execute("UPDATE prodotto_varianti SET quantita=?1 WHERE id=?2", params![nuova, vid])?;
            conn.execute(
                "INSERT INTO movimenti_magazzino \
                 (data, prodotto_id, prodotto_codice, tipo, quantita, causale, note, variante_id, variante_taglia, variante_colore, magazzino_id) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    data, prodotto_id, codice,
                    if delta > 0.0 { "CARICO" } else { "SCARICO" }, delta.abs(),
                    "RETTIFICA", note_str, vid, taglia, colore, mag
                ],
            )?;
            adj_giacenza(conn, prodotto_id, Some(vid), mag, "", "", delta)?;
            sync_quantita(conn, prodotto_id)?;
        }
        return Ok(delta);
    }

    let cur: f64 = conn
        .query_row("SELECT COALESCE(quantita,0) FROM prodotti WHERE id=?1", [prodotto_id], |r| r.get(0))
        .optional()?
        .unwrap_or(0.0);
    let delta = nuova - cur;
    if delta != 0.0 {
        conn.execute("UPDATE prodotti SET quantita=?1 WHERE id=?2", params![nuova, prodotto_id])?;
        conn.execute(
            "INSERT INTO movimenti_magazzino \
             (data, prodotto_id, prodotto_codice, tipo, quantita, causale, note, magazzino_id) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                data, prodotto_id, codice,
                if delta > 0.0 { "CARICO" } else { "SCARICO" }, delta.abs(),
                "RETTIFICA", note_str, mag
            ],
        )?;
        adj_giacenza(conn, prodotto_id, None, mag, "", "", delta)?;
    }
    Ok(delta)
}

// ── import prodotti (CSV merge) ──────────────────────────────────────────────

async fn import(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let records = body.as_array().cloned().unwrap_or_default();
    let (mut created, mut updated, mut skipped) = (0i64, 0i64, 0i64);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    for p in &records {
        // Il codice identifica il prodotto: una riga senza non è importabile.
        let codice = imp_str(p, "codice");
        if codice.is_empty() {
            skipped += 1;
            continue;
        }
        let categoria = imp_str(p, "categoria");
        let descrizione = imp_str(p, "descrizione");
        let codice_fornitore = imp_str(p, "codiceFornitore");
        let barcode = imp_str(p, "barcode");
        let unita = {
            let u = imp_str(p, "unitaMisura");
            if u.is_empty() { "pz".to_string() } else { u }
        };
        let prezzo = imp_num(p, "prezzo");
        let prezzo_acquisto = {
            let v = imp_num(p, "prezzoAcquisto");
            if v == 0.0 { None } else { Some(v) }
        };
        let iva = {
            let v = imp_num(p, "iva");
            if v == 0.0 { 22.0 } else { v }
        };
        let quantita = imp_int(p, "quantita");
        let soglia = imp_int(p, "sogliaMinima");

        if !categoria.is_empty() {
            conn.execute("INSERT OR IGNORE INTO categorie_prodotto (nome) VALUES (?1)", [&categoria])?;
        }

        let existing: Option<i64> = {
            let mut e = conn
                .query_row("SELECT id FROM prodotti WHERE codice = ?1 COLLATE NOCASE AND codice != ''", [&codice], |r| r.get(0))
                .optional()?;
            if e.is_none() && !barcode.is_empty() {
                e = conn
                    .query_row("SELECT id FROM prodotti WHERE barcode=?1 AND barcode!=''", [&barcode], |r| r.get(0))
                    .optional()?;
            }
            e
        };

        match existing {
            Some(id) => {
                use rusqlite::types::Value as SqlValue;
                let mut sets = Vec::new();
                let mut binds: Vec<SqlValue> = Vec::new();
                let mut patch_str = |col: &str, src: &str, sets: &mut Vec<String>, binds: &mut Vec<SqlValue>| -> rusqlite::Result<()> {
                    if src.is_empty() {
                        return Ok(());
                    }
                    let cur: Option<String> = conn
                        .query_row(&format!("SELECT {col} FROM prodotti WHERE id=?1"), [id], |r| r.get::<_, Option<String>>(0))?;
                    if cur.map(|s| s.is_empty()).unwrap_or(true) {
                        sets.push(format!("{col}=?"));
                        binds.push(SqlValue::Text(src.to_string()));
                    }
                    Ok(())
                };
                patch_str("categoria", &categoria, &mut sets, &mut binds)?;
                patch_str("descrizione", &descrizione, &mut sets, &mut binds)?;
                patch_str("codice", &codice, &mut sets, &mut binds)?;
                patch_str("codice_fornitore", &codice_fornitore, &mut sets, &mut binds)?;
                patch_str("barcode", &barcode, &mut sets, &mut binds)?;
                // prezzo: !existing.prezzo && prezzo
                if prezzo != 0.0 {
                    let cur: Option<f64> = conn.query_row("SELECT prezzo FROM prodotti WHERE id=?1", [id], |r| r.get(0))?;
                    if cur.unwrap_or(0.0) == 0.0 {
                        sets.push("prezzo=?".into());
                        binds.push(SqlValue::Real(prezzo));
                    }
                }
                if let Some(pa) = prezzo_acquisto {
                    let cur: Option<f64> = conn.query_row("SELECT prezzo_acquisto FROM prodotti WHERE id=?1", [id], |r| r.get(0))?;
                    if cur.unwrap_or(0.0) == 0.0 {
                        sets.push("prezzo_acquisto=?".into());
                        binds.push(SqlValue::Real(pa));
                    }
                }
                patch_str("unita_misura", &unita, &mut sets, &mut binds)?;
                if sets.is_empty() {
                    skipped += 1;
                } else {
                    use rusqlite::types::ToSql;
                    let sql = format!("UPDATE prodotti SET {} WHERE id=?", sets.join(", "));
                    let mut pp: Vec<&dyn ToSql> = binds.iter().map(|v| v as &dyn ToSql).collect();
                    pp.push(&id);
                    conn.execute(&sql, pp.as_slice())?;
                    updated += 1;
                }
            }
            None => {
                conn.execute(
                    "INSERT INTO prodotti (categoria,descrizione,prezzo,prezzo_acquisto,quantita,soglia_minima,unita_misura,codice,codice_fornitore,iva,barcode,ha_varianti,fornitore_id_preferito,riordino_quantita) \
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,NULL,0)",
                    params![categoria, descrizione, prezzo, prezzo_acquisto, quantita, soglia, unita, codice, codice_fornitore, iva, barcode],
                )?;
                created += 1;
            }
        }
    }
    Ok(Json(json!({ "created": created, "updated": updated, "skipped": skipped })))
}

// ── import-listino ───────────────────────────────────────────────────────────

async fn import_listino(State(state): State<AppState>, Json(b): Json<Value>) -> ApiResult<Json<Value>> {
    let fornitore_id = b.get("fornitoreId").and_then(Value::as_i64);
    let righe = b.get("righe").and_then(Value::as_array).cloned();
    let (fid, righe) = match (fornitore_id, righe) {
        (Some(f), Some(r)) => (f, r),
        _ => return Err(ApiError::bad_request("Dati mancanti (fornitore o righe).")),
    };
    let ivato = matches!(b.get("ivato"), Some(Value::Bool(true)));
    let anteprima = matches!(b.get("anteprima"), Some(Value::Bool(true)));

    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();

    let result = if anteprima {
        run_import_listino(&guard, fid, &righe, ivato, true)?
    } else {
        let tx = guard.transaction().map_err(ApiError::from)?;
        let r = run_import_listino(&tx, fid, &righe, ivato, false)?;
        tx.commit().map_err(ApiError::from)?;
        r
    };
    Ok(Json(result))
}

fn run_import_listino(
    conn: &Connection,
    fid: i64,
    righe: &[Value],
    ivato: bool,
    anteprima: bool,
) -> ApiResult<Value> {
    let mut aggiornati = 0i64;
    let mut non_trovati: Vec<Value> = Vec::new();
    let mut aggiornamenti: Vec<Value> = Vec::new();

    let meta = |r: &Value, codice: &str| -> Value {
        json!({
            "codice": codice,
            "prezzo": r.get("prezzo").cloned().unwrap_or_else(|| Value::String(String::new())),
            "descrizione": r.get("descrizione").and_then(Value::as_str).unwrap_or("").trim(),
        })
    };

    for r in righe {
        let codice = r.get("codice").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let prezzo_raw = parse_price(r.get("prezzo"));
        if codice.is_empty() {
            continue;
        }
        let prezzo_raw = match prezzo_raw {
            Some(p) => p,
            None => {
                non_trovati.push(meta(r, &codice));
                continue;
            }
        };

        // risolvi prodotto: match esatto su prodotto_fornitori, poi alias
        let mut prodotto_id: Option<i64> = None;
        let mut pf_id: Option<i64> = None;
        let mut pf_old: Option<f64> = None;
        let mut iva = 0.0;
        let mut prodotto_codice = String::new();

        if let Some((pfid, pid, old, pf_iva, pf_codice)) = conn
            .query_row(
                "SELECT pf.id, pf.prodotto_id, pf.prezzo_acquisto, p.iva, p.codice \
                 FROM prodotto_fornitori pf JOIN prodotti p ON p.id = pf.prodotto_id \
                 WHERE pf.fornitore_id = ?1 AND pf.codice_fornitore != '' \
                   AND LOWER(TRIM(pf.codice_fornitore)) = LOWER(TRIM(?2))",
                params![fid, codice],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<f64>>(2)?,
                        row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    ))
                },
            )
            .optional()?
        {
            prodotto_id = Some(pid);
            pf_id = Some(pfid);
            pf_old = old;
            iva = pf_iva;
            prodotto_codice = pf_codice;
        } else if let Some(pid) = conn
            .query_row(
                "SELECT prodotto_id FROM fornitore_codice_alias WHERE fornitore_id=?1 AND codice_norm=?2",
                params![fid, codice.to_lowercase()],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
        {
            prodotto_id = Some(pid);
            if let Some((i, n)) = conn
                .query_row("SELECT iva, codice FROM prodotti WHERE id=?1", [pid], |row| {
                    Ok((row.get::<_, Option<f64>>(0)?.unwrap_or(0.0), row.get::<_, Option<String>>(1)?.unwrap_or_default()))
                })
                .optional()?
            {
                iva = i;
                prodotto_codice = n;
            }
            if let Some((id, old)) = conn
                .query_row(
                    "SELECT id, prezzo_acquisto FROM prodotto_fornitori WHERE prodotto_id=?1 AND fornitore_id=?2",
                    params![pid, fid],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<f64>>(1)?)),
                )
                .optional()?
            {
                pf_id = Some(id);
                pf_old = old;
            }
        }

        let prodotto_id = match prodotto_id {
            Some(p) => p,
            None => {
                non_trovati.push(meta(r, &codice));
                continue;
            }
        };

        let netto = if ivato {
            round4(prezzo_raw / (1.0 + iva / 100.0))
        } else {
            round4(prezzo_raw)
        };
        let old = pf_old;
        aggiornamenti.push(json!({
            "codice": codice,
            "prodottoCodice": prodotto_codice,
            "prezzoVecchio": opt_num(old),
            "prezzoNuovo": num(netto),
            "deltaPct": calc_delta(old, netto),
        }));
        aggiornati += 1;

        if !anteprima {
            if let Some(pfid) = pf_id {
                conn.execute("UPDATE prodotto_fornitori SET prezzo_acquisto=?1 WHERE id=?2", params![netto, pfid])?;
            } else {
                let is_first = conn
                    .query_row("SELECT 1 FROM prodotto_fornitori WHERE prodotto_id=?1 LIMIT 1", [prodotto_id], |_| Ok(()))
                    .optional()?
                    .is_none();
                conn.execute(
                    "INSERT INTO prodotto_fornitori (prodotto_id, fornitore_id, codice_fornitore, prezzo_acquisto, predefinito) VALUES (?1,?2,?3,?4,?5)",
                    params![prodotto_id, fid, codice, netto, is_first as i64],
                )?;
            }
            conn.execute(
                "UPDATE prodotti SET prezzo_acquisto=?1 WHERE id=?2 AND fornitore_id_preferito=?3",
                params![netto, prodotto_id, fid],
            )?;
        }
    }

    Ok(json!({
        "anteprima": anteprima,
        "aggiornati": aggiornati,
        "aggiornamenti": aggiornamenti,
        "nonTrovati": non_trovati,
    }))
}

async fn import_listino_match(
    State(state): State<AppState>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let fornitore_id = b.get("fornitoreId").and_then(Value::as_i64);
    let righe = b.get("righe").and_then(Value::as_array).cloned();
    let (fid, righe) = match (fornitore_id, righe) {
        (Some(f), Some(r)) => (f, r),
        _ => return Err(ApiError::bad_request("Dati mancanti (fornitore o righe).")),
    };
    let limit = b.get("limit").and_then(Value::as_u64).map(|v| v as usize).unwrap_or(5);
    let min_score = b.get("minScore").and_then(Value::as_f64).unwrap_or_else(soglia_min);

    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let prodotti = load_prod_inputs(&conn)?;
    let gia: HashSet<i64> = {
        let mut stmt = conn.prepare("SELECT prodotto_id FROM prodotto_fornitori WHERE fornitore_id=?1")?;
        let v = stmt
            .query_map([fid], |r| r.get::<_, i64>(0))?
            .collect::<Result<Vec<i64>, _>>()?;
        v.into_iter().collect()
    };

    let mut risultati = score_candidati(&righe, &prodotti, limit, min_score);
    for ris in &mut risultati {
        if let Some(cands) = ris.get_mut("candidati").and_then(Value::as_array_mut) {
            for c in cands {
                let pid = c.get("prodottoId").and_then(Value::as_i64).unwrap_or(0);
                c["giaAssociatoAFornitore"] = json!(gia.contains(&pid));
            }
        }
    }
    Ok(Json(json!({ "risultati": risultati })))
}

async fn import_listino_abbina(
    State(state): State<AppState>,
    Json(b): Json<Value>,
) -> ApiResult<Json<Value>> {
    let fornitore_id = b.get("fornitoreId").and_then(Value::as_i64);
    let abbinamenti = b.get("abbinamenti").and_then(Value::as_array).cloned();
    let (fid, abbinamenti) = match (fornitore_id, abbinamenti) {
        (Some(f), Some(a)) => (f, a),
        _ => return Err(ApiError::bad_request("Dati mancanti.")),
    };
    let ivato = matches!(b.get("ivato"), Some(Value::Bool(true)));

    let arc = tenant_conn(&state)?;
    let mut guard = arc.lock().unwrap();
    let tx = guard.transaction().map_err(ApiError::from)?;

    // codici già usati da questo fornitore -> prodotto_id
    let mut usati: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT prodotto_id, codice_fornitore FROM prodotto_fornitori WHERE fornitore_id=?1 AND codice_fornitore!=''")?;
        for row in stmt.query_map([fid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            let (pid, cod) = row?;
            usati.insert(cod.trim().to_lowercase(), pid);
        }
        let mut stmt2 = tx.prepare("SELECT prodotto_id, codice_norm FROM fornitore_codice_alias WHERE fornitore_id=?1")?;
        for row in stmt2.query_map([fid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            let (pid, cod) = row?;
            usati.insert(cod, pid);
        }
    }

    let mut associati = 0i64;
    let mut aggiornati = 0i64;
    let mut saltati: Vec<Value> = Vec::new();

    for a in &abbinamenti {
        let codice = a.get("codice").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let prodotto_id = a.get("prodottoId").and_then(Value::as_i64);
        let prodotto_id = match (codice.is_empty(), prodotto_id) {
            (false, Some(pid)) => pid,
            _ => {
                saltati.push(json!({ "codice": codice, "motivo": "dati incompleti" }));
                continue;
            }
        };
        let prod_iva: Option<f64> = tx
            .query_row("SELECT iva FROM prodotti WHERE id=?1", [prodotto_id], |r| r.get::<_, Option<f64>>(0))
            .optional()?
            .flatten();
        if tx.query_row("SELECT 1 FROM prodotti WHERE id=?1", [prodotto_id], |_| Ok(())).optional()?.is_none() {
            saltati.push(json!({ "codice": codice, "motivo": "prodotto inesistente" }));
            continue;
        }
        let key = codice.to_lowercase();
        if let Some(&existing_pid) = usati.get(&key) {
            if existing_pid != prodotto_id {
                saltati.push(json!({ "codice": codice, "motivo": "codice gia usato su un altro prodotto" }));
                continue;
            }
        }
        let netto: Option<f64> = parse_price(a.get("prezzo")).map(|raw| {
            if ivato {
                round4(raw / (1.0 + prod_iva.unwrap_or(0.0) / 100.0))
            } else {
                round4(raw)
            }
        });

        if let Some(exist_id) = tx
            .query_row(
                "SELECT id FROM prodotto_fornitori WHERE prodotto_id=?1 AND fornitore_id=?2",
                params![prodotto_id, fid],
                |r| r.get::<_, i64>(0),
            )
            .optional()?
        {
            tx.execute(
                "UPDATE prodotto_fornitori \
                 SET codice_fornitore = CASE WHEN codice_fornitore IS NULL OR codice_fornitore='' THEN ?1 ELSE codice_fornitore END, \
                     prezzo_acquisto = COALESCE(?2, prezzo_acquisto) WHERE id=?3",
                params![codice, netto, exist_id],
            )?;
            aggiornati += 1;
        } else {
            let is_first = tx
                .query_row("SELECT 1 FROM prodotto_fornitori WHERE prodotto_id=?1 LIMIT 1", [prodotto_id], |_| Ok(()))
                .optional()?
                .is_none();
            tx.execute(
                "INSERT INTO prodotto_fornitori (prodotto_id, fornitore_id, codice_fornitore, prezzo_acquisto, predefinito) VALUES (?1,?2,?3,?4,?5)",
                params![prodotto_id, fid, codice, netto, is_first as i64],
            )?;
            associati += 1;
        }
        usati.insert(key.clone(), prodotto_id);
        tx.execute(
            "INSERT INTO fornitore_codice_alias (fornitore_id, prodotto_id, codice, codice_norm) VALUES (?1,?2,?3,?4) \
             ON CONFLICT(fornitore_id, codice_norm) DO UPDATE SET prodotto_id=excluded.prodotto_id, codice=excluded.codice",
            params![fid, prodotto_id, codice, key],
        )?;

        // sincronizza i campi legacy dal fornitore predefinito
        if let Some((pref_fid, pref_cod)) = tx
            .query_row(
                "SELECT fornitore_id, codice_fornitore FROM prodotto_fornitori WHERE prodotto_id=?1 ORDER BY predefinito DESC, id LIMIT 1",
                [prodotto_id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
            )
            .optional()?
        {
            tx.execute(
                "UPDATE prodotti SET fornitore_id_preferito=?1, codice_fornitore=?2 WHERE id=?3",
                params![pref_fid, pref_cod, prodotto_id],
            )?;
            if pref_fid == fid {
                if let Some(n) = netto {
                    tx.execute("UPDATE prodotti SET prezzo_acquisto=?1 WHERE id=?2", params![n, prodotto_id])?;
                }
            }
        }
    }
    tx.commit().map_err(ApiError::from)?;
    Ok(Json(json!({ "associati": associati, "aggiornati": aggiornati, "saltati": saltati })))
}

// ── helper privati ───────────────────────────────────────────────────────────

fn query_dto(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(p, |r| Ok(to_dto(conn, r, false)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn to_dto(conn: &Connection, r: &Row, with_immagine: bool) -> Value {
    let g = |k: &str| r.get::<_, Option<String>>(k).ok().flatten();
    let gi = |k: &str| r.get::<_, Option<i64>>(k).ok().flatten();
    let gf = |k: &str| r.get::<_, Option<f64>>(k).ok().flatten();
    let id = r.get::<_, i64>("id").unwrap_or(0);
    let ha_varianti = gi("ha_varianti") == Some(1);
    let immagine = g("immagine").unwrap_or_default();

    let mut dto = json!({
        "id": id,
        "categoria": g("categoria"),
        "descrizione": g("descrizione"),
        "prezzo": opt_num(gf("prezzo")),
        "prezzoAcquisto": opt_num(gf("prezzo_acquisto")),
        "quantita": opt_num(gf("quantita")),
        "sogliaMinima": opt_num(gf("soglia_minima")),
        "unitaMisura": g("unita_misura"),
        "codice": g("codice"),
        "codiceFornitore": g("codice_fornitore").unwrap_or_default(),
        "iva": opt_num(gf("iva")),
        "barcode": g("barcode").unwrap_or_default(),
        "haVarianti": ha_varianti,
        "fornitoreIdPreferito": gi("fornitore_id_preferito").filter(|&v| v != 0),
        "riordinoQuantita": num(gf("riordino_quantita").unwrap_or(0.0)),
        "peso": opt_num(gf("peso")),
        "dimensioni": g("dimensioni").unwrap_or_default(),
        "haImmagine": !immagine.is_empty(),
    });
    if with_immagine {
        dto["immagine"] = Value::String(immagine);
    }
    if ha_varianti {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT id, taglia, colore, quantita, barcode FROM prodotto_varianti WHERE prodotto_id=?1 ORDER BY taglia, colore",
        ) {
            if let Ok(rows) = stmt.query_map([id], |v| {
                Ok(json!({
                    "id": v.get::<_, i64>(0)?,
                    "taglia": v.get::<_, Option<String>>(1)?,
                    "colore": v.get::<_, Option<String>>(2)?,
                    "quantita": opt_num(v.get::<_, Option<f64>>(3)?),
                    "barcode": v.get::<_, Option<String>>(4)?,
                }))
            }) {
                let varianti: Vec<Value> = rows.filter_map(Result::ok).collect();
                dto["varianti"] = Value::Array(varianti);
            }
        }
    }
    dto
}

fn save_varianti(conn: &Connection, prodotto_id: i64, varianti: &[Value]) -> rusqlite::Result<()> {
    for v in varianti {
        conn.execute(
            "INSERT INTO prodotto_varianti (prodotto_id, taglia, colore, quantita, barcode) VALUES (?1,?2,?3,?4,?5)",
            params![
                prodotto_id,
                str_def(v, "taglia"),
                str_def(v, "colore"),
                num_or0(v, "quantita"),
                str_def(v, "barcode"),
            ],
        )?;
    }
    Ok(())
}

fn save_fornitori(conn: &Connection, prodotto_id: i64, fornitori: &Value) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM prodotto_fornitori WHERE prodotto_id=?1", [prodotto_id])?;
    let list: Vec<&Value> = fornitori
        .as_array()
        .map(|a| a.iter().filter(|f| f.get("fornitoreId").and_then(Value::as_i64).is_some()).collect())
        .unwrap_or_default();
    if list.is_empty() {
        conn.execute(
            "UPDATE prodotti SET fornitore_id_preferito=NULL, codice_fornitore='' WHERE id=?1",
            [prodotto_id],
        )?;
        return Ok(());
    }
    let pref_idx = list.iter().position(|f| matches!(f.get("predefinito"), Some(Value::Bool(true)))).unwrap_or(0);
    for (i, f) in list.iter().enumerate() {
        let prezzo = match f.get("prezzoAcquisto") {
            Some(Value::Number(n)) => n.as_f64(),
            _ => None,
        };
        conn.execute(
            "INSERT INTO prodotto_fornitori (prodotto_id, fornitore_id, codice_fornitore, prezzo_acquisto, predefinito) VALUES (?1,?2,?3,?4,?5)",
            params![
                prodotto_id,
                f.get("fornitoreId").and_then(Value::as_i64),
                str_def(f, "codiceFornitore"),
                prezzo,
                (i == pref_idx) as i64,
            ],
        )?;
    }
    let pref = list[pref_idx];
    conn.execute(
        "UPDATE prodotti SET fornitore_id_preferito=?1, codice_fornitore=?2 WHERE id=?3",
        params![
            pref.get("fornitoreId").and_then(Value::as_i64),
            str_def(pref, "codiceFornitore"),
            prodotto_id,
        ],
    )?;
    Ok(())
}

fn sync_quantita(conn: &Connection, prodotto_id: i64) -> rusqlite::Result<()> {
    let tot: f64 = conn.query_row(
        "SELECT COALESCE(SUM(quantita),0) FROM prodotto_varianti WHERE prodotto_id=?1",
        [prodotto_id],
        |r| r.get(0),
    )?;
    conn.execute("UPDATE prodotti SET quantita=?1 WHERE id=?2", params![tot, prodotto_id])?;
    Ok(())
}

fn load_prod_inputs(conn: &Connection) -> rusqlite::Result<Vec<ProdInput>> {
    let mut stmt = conn.prepare(
        "SELECT id, categoria, codice, descrizione, prezzo_acquisto, quantita FROM prodotti",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProdInput {
                id: r.get::<_, i64>(0)?,
                categoria: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                codice: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                descrizione: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                prezzo_acquisto: r.get::<_, Option<f64>>(4)?,
                quantita: r.get::<_, Option<f64>>(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

use crate::web::oggi;

// body helpers
fn flag(b: &Value, k: &str) -> i64 {
    if matches!(b.get(k), Some(Value::Bool(true))) { 1 } else { 0 }
}
fn raw_opt(b: &Value, k: &str) -> Option<String> {
    crate::web::raw_opt(b, k)
}
fn str_def(b: &Value, k: &str) -> String {
    crate::web::str_def(b, k)
}
fn num_opt(b: &Value, k: &str) -> Option<f64> {
    b.get(k).and_then(Value::as_f64)
}
fn num_or0(b: &Value, k: &str) -> f64 {
    b.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn opt_id(b: &Value, k: &str) -> Option<i64> {
    b.get(k).and_then(Value::as_i64).filter(|&v| v != 0)
}

/// Il codice identifica il prodotto (ha preso il posto del vecchio "nome"): senza,
/// nei documenti e nei listini la riga resterebbe anonima; ripetuto, due articoli
/// diversi diventerebbero indistinguibili in ricerca, import listino e scansione.
/// Meglio rifiutare la scrittura che salvare qualcosa che poi non si ritrova.
///
/// `escludi_id` è il prodotto che si sta modificando: il proprio codice può
/// ovviamente tenerselo. Il confronto ignora maiuscole/minuscole, come l'indice
/// UNIQUE che protegge la colonna (vedi `migrate::prodotti_codice_unico`).
fn codice_valido(conn: &Connection, b: &Value, escludi_id: Option<i64>) -> Result<String, ApiError> {
    let codice = str_def(b, "codice").trim().to_string();
    if codice.is_empty() {
        return Err(ApiError::bad_request("Il codice del prodotto è obbligatorio."));
    }
    let gia_usato = conn
        .query_row(
            "SELECT id FROM prodotti WHERE codice = ?1 COLLATE NOCASE AND id <> ?2 LIMIT 1",
            params![&codice, escludi_id.unwrap_or(0)],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    if gia_usato.is_some() {
        return Err(ApiError::conflict(format!(
            "Il codice \"{codice}\" è già usato da un altro prodotto."
        )));
    }
    Ok(codice)
}

// import helpers (String(v??'') / parseFloat / parseInt)
fn imp_str(b: &Value, k: &str) -> String {
    match b.get(k) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(x)) => x.to_string(),
        _ => String::new(),
    }
}
fn imp_num(b: &Value, k: &str) -> f64 {
    match b.get(k) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => parse_float_js(&s.replace(',', ".")).unwrap_or(0.0),
        _ => 0.0,
    }
}
fn imp_int(b: &Value, k: &str) -> i64 {
    match b.get(k) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or_else(|| n.as_f64().map(|f| f as i64).unwrap_or(0)),
        Some(Value::String(s)) => parse_int_js(s).unwrap_or(0),
        _ => 0,
    }
}

/// parseFloat di JS (numero iniziale, ignora il resto).
fn parse_float_js(s: &str) -> Option<f64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[+-]?(?:\d+\.?\d*|\.\d+)").unwrap());
    re.find(s.trim()).and_then(|m| m.as_str().parse().ok())
}
fn parse_int_js(s: &str) -> Option<i64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[+-]?\d+").unwrap());
    re.find(s.trim()).and_then(|m| m.as_str().parse().ok())
}

/// parsing prezzo di import-listino: rimuove i caratteri non numerici, ',' → '.'.
fn parse_price(v: Option<&Value>) -> Option<f64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"[^0-9,.-]").unwrap());
    let s = match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => return n.as_f64(),
        _ => String::new(),
    };
    let cleaned = re.replace_all(&s, "").replace(',', ".");
    parse_float_js(&cleaned)
}

fn round4(x: f64) -> f64 {
    (x * 10000.0).round() / 10000.0
}
fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn calc_delta(old: Option<f64>, nuovo: f64) -> Value {
    match old {
        Some(o) if o > 0.0 => num(round1(((nuovo - o) / o) * 100.0)),
        _ => Value::Null,
    }
}
