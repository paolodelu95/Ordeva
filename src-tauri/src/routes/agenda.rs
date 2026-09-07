//! /api/agenda — parità con routes/agenda.js: appuntamenti, todo, calendario
//! aggregato (scadenze fatture/acquisti, CRM, ricorrenti, todo) ed export ICS.
//! In offline l'utente è OWNER (NON tenant-admin) e l'unico membro dei gruppi:
//! la visibilità si riduce alle proprie righe, ma la logica è replicata fedelmente.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::types::Value as SV;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::auth::CurrentUser;
use crate::db::AppState;
use crate::error::{ApiError, ApiResult};
use crate::web::{self, tenant_conn};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/appuntamenti", get(list_app).post(create_app))
        .route("/appuntamenti/:id", axum::routing::put(update_app).delete(delete_app))
        .route("/todo", get(list_todo).post(create_todo))
        .route("/todo/:id", axum::routing::put(update_todo).delete(delete_todo))
        .route("/calendario", get(get_calendario))
        .route("/imminenti", get(imminenti))
        .route("/promemoria", get(promemoria))
        .route("/export.ics", get(export_ics))
        .route("/feed-url", get(feed_url))
        .route("/feed.ics", get(feed_ics))
}

fn is_tenant_admin(u: &CurrentUser) -> bool {
    u.ruolo == "SUPERADMIN" || u.ruolo == "ADMIN"
}

/// ID dei colleghi di gruppo (incluso self), come getGroupMatesIds().
fn group_mates_ids(state: &AppState, user_id: i64) -> Vec<i64> {
    let mut ids = vec![user_id];
    let _ = state.with_auth(|c| {
        let mut stmt = c.prepare(
            "SELECT DISTINCT ug2.user_id FROM user_gruppi ug1
             JOIN user_gruppi ug2 ON ug1.gruppo_id = ug2.gruppo_id
             WHERE ug1.user_id = ?",
        )?;
        let rows: Vec<i64> = stmt.query_map([user_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        for id in rows {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        Ok(())
    });
    ids
}

/// Filtro di visibilità appuntamenti (sql, params i64) — come visibilityFilter().
fn visibility_filter(state: &AppState, user: &CurrentUser, table: &str) -> (String, Vec<i64>) {
    if is_tenant_admin(user) {
        return ("1=1".into(), vec![]);
    }
    let me = user.id;
    let mates = group_mates_ids(state, me);
    let ph = vec!["?"; mates.len()].join(",");
    let mut params = vec![me];
    params.extend(mates);
    (
        format!("({table}.user_id = ? OR ({table}.condiviso = 1 AND {table}.user_id IN ({ph})))"),
        params,
    )
}

fn fmt_iso(s: &str) -> String {
    if s.len() == 10 {
        format!("{s}T00:00:00")
    } else {
        s.to_string()
    }
}

// ── Appuntamenti ────────────────────────────────────────────────────────────

fn app_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "titolo": r.get::<_, Option<String>>("titolo")?,
        "descrizione": r.get::<_, Option<String>>("descrizione")?,
        "inizio": r.get::<_, Option<String>>("inizio")?,
        "fine": r.get::<_, Option<String>>("fine")?,
        "tuttoGiorno": r.get::<_, Option<i64>>("tutto_giorno")? == Some(1),
        "luogo": r.get::<_, Option<String>>("luogo")?,
        "clienteId": r.get::<_, Option<i64>>("cliente_id")?,
        "clienteNome": r.get::<_, Option<String>>("cliente_nome")?.unwrap_or_default(),
        "fornitoreId": r.get::<_, Option<i64>>("fornitore_id")?,
        "fornitoreNome": r.get::<_, Option<String>>("fornitore_nome")?.unwrap_or_default(),
        "colore": r.get::<_, Option<String>>("colore")?,
        "promemoria": r.get::<_, Option<i64>>("promemoria_min")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "userId": r.get::<_, Option<i64>>("user_id")?,
        "autoreUsername": "",
        "autoreNome": "",
        "condiviso": r.get::<_, Option<i64>>("condiviso")? == Some(1),
        "createdAt": r.get::<_, Option<String>>("created_at")?,
    }))
}

/// Arricchisce le righe con autore (username/nome da auth.db).
fn enrich_autori(state: &AppState, rows: &mut [Value]) {
    let _ = state.with_auth(|c| {
        for r in rows.iter_mut() {
            let uid = r.get("userId").and_then(Value::as_i64);
            if let Some(uid) = uid {
                if let Ok((u, n)) = c.query_row(
                    "SELECT username, nome FROM users WHERE id=?",
                    [uid],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<String>>(1)?)),
                ) {
                    let obj = r.as_object_mut().unwrap();
                    obj.insert("autoreUsername".into(), json!(u.unwrap_or_default()));
                    obj.insert("autoreNome".into(), json!(n.unwrap_or_default()));
                }
            }
        }
        Ok(())
    });
}

async fn list_app(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let anno = web::anno();
    let da = q.get("dataDa").cloned().unwrap_or_else(|| format!("{anno}-01-01T00:00:00"));
    let a = q.get("dataA").cloned().unwrap_or_else(|| format!("{anno}-12-31T23:59:59"));
    let vista = q.get("vista").map(String::as_str).unwrap_or("auto");

    let (vsql, vparams) = if vista == "mia" {
        ("app.user_id = ?".to_string(), vec![user.id])
    } else if vista == "tutte" && is_tenant_admin(&user) {
        ("1=1".to_string(), vec![])
    } else if vista == "gruppo" {
        let mates = group_mates_ids(&state, user.id);
        let ph = vec!["?"; mates.len()].join(",");
        (format!("app.user_id IN ({ph})"), mates)
    } else {
        visibility_filter(&state, &user, "app")
    };

    let mut binds: Vec<SV> = vec![SV::Text(da), SV::Text(a)];
    binds.extend(vparams.into_iter().map(SV::Integer));
    let mut rows = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let sql = format!(
            "SELECT app.*, c.ragione_sociale AS cliente_nome, f.ragione_sociale AS fornitore_nome
             FROM appuntamenti app
             LEFT JOIN clienti c ON c.id=app.cliente_id
             LEFT JOIN fornitori f ON f.id=app.fornitore_id
             WHERE app.inizio BETWEEN ? AND ? AND {vsql}
             ORDER BY app.inizio"
        );
        let mut stmt = conn.prepare(&sql)?;
        let v: Vec<Value> = stmt
            .query_map(rusqlite::params_from_iter(binds.iter()), app_dto)?
            .collect::<Result<_, _>>()?;
        v
    };
    enrich_autori(&state, &mut rows);
    Ok(Json(Value::Array(rows)))
}

async fn create_app(State(state): State<AppState>, Json(a): Json<Value>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let titolo = a.get("titolo").and_then(Value::as_str).unwrap_or("");
    let inizio = a.get("inizio").and_then(Value::as_str).unwrap_or("");
    if titolo.is_empty() || inizio.is_empty() {
        return Err(ApiError::Status(StatusCode::BAD_REQUEST, "titolo e inizio obbligatori".into()));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO appuntamenti
         (titolo, descrizione, inizio, fine, tutto_giorno, luogo, cliente_id, fornitore_id, colore, promemoria_min, stato, user_id, condiviso)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rusqlite::params![
            titolo,
            a.get("descrizione").and_then(Value::as_str).unwrap_or(""),
            inizio,
            a.get("fine").and_then(Value::as_str),
            if web::bool_field(&a, "tuttoGiorno") { 1 } else { 0 },
            a.get("luogo").and_then(Value::as_str).unwrap_or(""),
            a.get("clienteId").and_then(Value::as_i64),
            a.get("fornitoreId").and_then(Value::as_i64),
            a.get("colore").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("#3b82f6"),
            a.get("promemoria").and_then(Value::as_i64),
            a.get("stato").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("PIANIFICATO"),
            user.id,
            if web::bool_field(&a, "condiviso") { 1 } else { 0 },
        ],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn update_app(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(a): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cur = conn
        .query_row(
            "SELECT titolo, descrizione, inizio, fine, tutto_giorno, luogo, cliente_id, fornitore_id, colore, promemoria_min, stato, condiviso, user_id FROM appuntamenti WHERE id=?",
            [id],
            |r| {
                Ok(json!({
                    "titolo": r.get::<_, Option<String>>(0)?,
                    "descrizione": r.get::<_, Option<String>>(1)?,
                    "inizio": r.get::<_, Option<String>>(2)?,
                    "fine": r.get::<_, Option<String>>(3)?,
                    "tutto_giorno": r.get::<_, Option<i64>>(4)?,
                    "luogo": r.get::<_, Option<String>>(5)?,
                    "cliente_id": r.get::<_, Option<i64>>(6)?,
                    "fornitore_id": r.get::<_, Option<i64>>(7)?,
                    "colore": r.get::<_, Option<String>>(8)?,
                    "promemoria_min": r.get::<_, Option<i64>>(9)?,
                    "stato": r.get::<_, Option<String>>(10)?,
                    "condiviso": r.get::<_, Option<i64>>(11)?,
                    "user_id": r.get::<_, Option<i64>>(12)?,
                }))
            },
        )
        .ok();
    let cur = match cur {
        Some(c) => c,
        None => return Err(ApiError::Status(StatusCode::NOT_FOUND, "Non trovato".into())),
    };
    let cur_uid = cur.get("user_id").and_then(Value::as_i64);
    if !is_tenant_admin(&user) && cur_uid.is_some() && cur_uid != Some(user.id) {
        return Err(ApiError::Status(StatusCode::FORBIDDEN, "Non sei il proprietario di questo appuntamento".into()));
    }
    // Coalescenze ?? / !== undefined.
    let s_or = |k: &str, ck: &str| -> Option<String> {
        a.get(k).and_then(Value::as_str).map(String::from).or_else(|| cur.get(ck).and_then(Value::as_str).map(String::from))
    };
    let tutto_giorno = if a.get("tuttoGiorno").is_some() {
        if web::bool_field(&a, "tuttoGiorno") { 1 } else { 0 }
    } else {
        cur.get("tutto_giorno").and_then(Value::as_i64).unwrap_or(0)
    };
    let cliente_id = if a.get("clienteId").is_some() { a.get("clienteId").and_then(Value::as_i64) } else { cur.get("cliente_id").and_then(Value::as_i64) };
    let fornitore_id = if a.get("fornitoreId").is_some() { a.get("fornitoreId").and_then(Value::as_i64) } else { cur.get("fornitore_id").and_then(Value::as_i64) };
    let promemoria = if a.get("promemoria").is_some() { a.get("promemoria").and_then(Value::as_i64) } else { cur.get("promemoria_min").and_then(Value::as_i64) };
    let condiviso = if a.get("condiviso").is_some() {
        if web::bool_field(&a, "condiviso") { 1 } else { 0 }
    } else {
        cur.get("condiviso").and_then(Value::as_i64).unwrap_or(0)
    };
    let fine = if a.get("fine").is_some() { a.get("fine").and_then(Value::as_str).map(String::from) } else { cur.get("fine").and_then(Value::as_str).map(String::from) };

    conn.execute(
        "UPDATE appuntamenti SET titolo=?, descrizione=?, inizio=?, fine=?, tutto_giorno=?, luogo=?,
         cliente_id=?, fornitore_id=?, colore=?, promemoria_min=?, stato=?, condiviso=?, updated_at=datetime('now') WHERE id=?",
        rusqlite::params![
            s_or("titolo", "titolo"),
            s_or("descrizione", "descrizione"),
            s_or("inizio", "inizio"),
            fine,
            tutto_giorno,
            s_or("luogo", "luogo"),
            cliente_id,
            fornitore_id,
            s_or("colore", "colore"),
            promemoria,
            s_or("stato", "stato"),
            condiviso,
            id,
        ],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn delete_app(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cur: Option<(Option<i64>, Option<String>)> = conn
        .query_row("SELECT user_id, google_event_id FROM appuntamenti WHERE id=?", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    if let Some((uid, _)) = cur {
        if !is_tenant_admin(&user) && uid.is_some() && uid != Some(user.id) {
            return Err(ApiError::Status(StatusCode::FORBIDDEN, "Non sei il proprietario di questo appuntamento".into()));
        }
    }
    // Se l'appuntamento era collegato a Google, ricorda l'id in una "lapide": la
    // riga sta per sparire, ma la prossima sync deve ancora poter cancellare
    // l'evento lato Google (vedi routes/google_sync.rs).
    if let Some((_, Some(event_id))) = &cur {
        conn.execute(
            "INSERT INTO google_calendar_tombstone (google_event_id) VALUES (?1) ON CONFLICT(google_event_id) DO NOTHING",
            rusqlite::params![event_id],
        )?;
    }
    conn.execute("DELETE FROM appuntamenti WHERE id=?", [id])?;
    Ok(Json(json!({ "success": true })))
}

// ── Todo ────────────────────────────────────────────────────────────────────

fn todo_dto(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>("id")?,
        "titolo": r.get::<_, Option<String>>("titolo")?,
        "descrizione": r.get::<_, Option<String>>("descrizione")?,
        "scadenza": r.get::<_, Option<String>>("scadenza")?,
        "priorita": r.get::<_, Option<String>>("priorita")?,
        "stato": r.get::<_, Option<String>>("stato")?,
        "categoria": r.get::<_, Option<String>>("categoria")?,
        "completataAt": r.get::<_, Option<String>>("completata_at")?,
        "createdAt": r.get::<_, Option<String>>("created_at")?,
    }))
}

async fn list_todo(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut binds: Vec<SV> = vec![SV::Integer(user.id)];
    let mut where_extra = String::new();
    if let Some(stato) = q.get("stato") {
        where_extra = " AND stato=?".into();
        binds.push(SV::Text(stato.clone()));
    }
    let sql = format!(
        "SELECT * FROM todo WHERE user_id = ?{where_extra}
         ORDER BY CASE stato WHEN 'FATTA' THEN 1 ELSE 0 END,
                  CASE WHEN scadenza IS NULL THEN 1 ELSE 0 END,
                  scadenza, id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(binds.iter()), todo_dto)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(Value::Array(rows)))
}

async fn create_todo(State(state): State<AppState>, Json(t): Json<Value>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let titolo = t.get("titolo").and_then(Value::as_str).unwrap_or("");
    if titolo.is_empty() {
        return Err(ApiError::Status(StatusCode::BAD_REQUEST, "titolo obbligatorio".into()));
    }
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    conn.execute(
        "INSERT INTO todo (titolo, descrizione, scadenza, priorita, categoria, stato, user_id) VALUES (?,?,?,?,?,?,?)",
        rusqlite::params![
            titolo,
            t.get("descrizione").and_then(Value::as_str).unwrap_or(""),
            t.get("scadenza").and_then(Value::as_str),
            t.get("priorita").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("MEDIA"),
            t.get("categoria").and_then(Value::as_str).unwrap_or(""),
            t.get("stato").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("DA_FARE"),
            user.id,
        ],
    )?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

async fn update_todo(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(t): Json<Value>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cur = conn
        .query_row(
            "SELECT titolo, descrizione, scadenza, priorita, categoria, stato, completata_at, user_id FROM todo WHERE id=?",
            [id],
            |r| {
                Ok(json!({
                    "titolo": r.get::<_, Option<String>>(0)?,
                    "descrizione": r.get::<_, Option<String>>(1)?,
                    "scadenza": r.get::<_, Option<String>>(2)?,
                    "priorita": r.get::<_, Option<String>>(3)?,
                    "categoria": r.get::<_, Option<String>>(4)?,
                    "stato": r.get::<_, Option<String>>(5)?,
                    "completata_at": r.get::<_, Option<String>>(6)?,
                    "user_id": r.get::<_, Option<i64>>(7)?,
                }))
            },
        )
        .ok();
    let cur = match cur {
        Some(c) => c,
        None => return Err(ApiError::Status(StatusCode::NOT_FOUND, "Non trovata".into())),
    };
    let cur_uid = cur.get("user_id").and_then(Value::as_i64);
    if cur_uid.is_some() && cur_uid != Some(user.id) && !is_tenant_admin(&user) {
        return Err(ApiError::Status(StatusCode::FORBIDDEN, "Non sei il proprietario di questa todo".into()));
    }
    let new_stato = t.get("stato").and_then(Value::as_str);
    let cur_stato = cur.get("stato").and_then(Value::as_str);
    let completa_ora = new_stato == Some("FATTA") && cur_stato != Some("FATTA");
    let reset = matches!(new_stato, Some(s) if s != "FATTA") && cur_stato == Some("FATTA");
    let completata_at = if completa_ora {
        Some(now_iso_ms())
    } else if reset {
        None
    } else {
        cur.get("completata_at").and_then(Value::as_str).map(String::from)
    };
    let s_or = |k: &str, ck: &str| -> Option<String> {
        t.get(k).and_then(Value::as_str).map(String::from).or_else(|| cur.get(ck).and_then(Value::as_str).map(String::from))
    };
    let scadenza = if t.get("scadenza").is_some() { t.get("scadenza").and_then(Value::as_str).map(String::from) } else { cur.get("scadenza").and_then(Value::as_str).map(String::from) };

    conn.execute(
        "UPDATE todo SET titolo=?, descrizione=?, scadenza=?, priorita=?, categoria=?, stato=?, completata_at=?, updated_at=datetime('now') WHERE id=?",
        rusqlite::params![
            s_or("titolo", "titolo"),
            s_or("descrizione", "descrizione"),
            scadenza,
            s_or("priorita", "priorita"),
            s_or("categoria", "categoria"),
            s_or("stato", "stato"),
            completata_at,
            id,
        ],
    )?;
    Ok(Json(json!({ "success": true })))
}

async fn delete_todo(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let cur: Option<(Option<i64>, Option<String>)> = conn
        .query_row("SELECT user_id, google_task_id FROM todo WHERE id=?", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    if let Some((uid, _)) = cur {
        if uid.is_some() && uid != Some(user.id) && !is_tenant_admin(&user) {
            return Err(ApiError::Status(StatusCode::FORBIDDEN, "Non sei il proprietario di questa todo".into()));
        }
    }
    if let Some((_, Some(task_id))) = &cur {
        conn.execute(
            "INSERT INTO google_tasks_tombstone (google_task_id) VALUES (?1) ON CONFLICT(google_task_id) DO NOTHING",
            rusqlite::params![task_id],
        )?;
    }
    conn.execute("DELETE FROM todo WHERE id=?", [id])?;
    Ok(Json(json!({ "success": true })))
}

// ── Calendario aggregato ────────────────────────────────────────────────────

fn calendario(
    conn: &Connection,
    data_da: &str,
    data_a: &str,
    vis_app: &(String, Vec<i64>),
    vis_todo: &(String, Vec<i64>),
) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();

    // 1) Appuntamenti
    {
        let mut binds: Vec<SV> = vec![SV::Text(data_da.into()), SV::Text(data_a.into())];
        binds.extend(vis_app.1.iter().map(|x| SV::Integer(*x)));
        let sql = format!(
            "SELECT app.*, c.ragione_sociale c_nome, f.ragione_sociale f_nome
             FROM appuntamenti app
             LEFT JOIN clienti c ON c.id=app.cliente_id
             LEFT JOIN fornitori f ON f.id=app.fornitore_id
             WHERE app.inizio BETWEEN ? AND ? AND app.stato!='ANNULLATO' AND {}",
            vis_app.0
        );
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt
                .query_map(rusqlite::params_from_iter(binds.iter()), |r| {
                    let cn: Option<String> = r.get("c_nome")?;
                    let fn_: Option<String> = r.get("f_nome")?;
                    Ok(json!({
                        "id": format!("app-{}", r.get::<_, i64>("id")?),
                        "source": "APPUNTAMENTO", "sourceId": r.get::<_, i64>("id")?,
                        "titolo": r.get::<_, Option<String>>("titolo")?,
                        "inizio": r.get::<_, Option<String>>("inizio")?,
                        "fine": r.get::<_, Option<String>>("fine")?,
                        "tuttoGiorno": r.get::<_, Option<i64>>("tutto_giorno")? == Some(1),
                        "luogo": r.get::<_, Option<String>>("luogo")?.unwrap_or_default(),
                        "controparte": cn.filter(|s| !s.is_empty()).or(fn_).unwrap_or_default(),
                        "descrizione": r.get::<_, Option<String>>("descrizione")?.unwrap_or_default(),
                        "colore": r.get::<_, Option<String>>("colore")?.filter(|s| !s.is_empty()).unwrap_or_else(|| "#3b82f6".into()),
                        "stato": r.get::<_, Option<String>>("stato")?,
                        "userId": r.get::<_, Option<i64>>("user_id")?,
                        "condiviso": r.get::<_, Option<i64>>("condiviso")? == Some(1),
                        "route": "/agenda",
                    }))
                })
                .and_then(|m| m.collect::<Result<Vec<_>, _>>())
            {
                out.extend(rows);
            }
        }
    }

    // 2) Scadenze fatture
    {
        let sql = "SELECT f.id, f.numero, c.ragione_sociale c_nome,
               date(f.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza,
               (SELECT COALESCE(SUM(quantita*prezzo*(1-COALESCE(sconto,0)/100)*(1+iva/100)),0) FROM fatture_righe WHERE fattura_id=f.id)
                 - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE fattura_id=f.id),0) AS residuo
             FROM fatture f
             LEFT JOIN clienti c ON c.id=f.cliente_id
             LEFT JOIN tipi_pagamento tp ON tp.id=f.tipo_pagamento_id
             WHERE f.stato='EMESSA'";
        push_scadenze(conn, sql, data_da, data_a, "fat", "SCADENZA_FATTURA", "Incasso fattura", "#16a34a", &mut out);
    }
    // 3) Scadenze acquisti
    {
        let sql = "SELECT a.id, a.numero, fo.ragione_sociale c_nome,
               date(a.data_emissione, '+' || COALESCE(tp.giorni_scadenza, 30) || ' days') AS scadenza,
               (SELECT COALESCE(SUM(quantita*prezzo*(1-COALESCE(sconto,0)/100)*(1+iva/100)),0) FROM acquisti_righe WHERE acquisto_id=a.id)
                 - COALESCE((SELECT SUM(importo) FROM pagamenti WHERE acquisto_id=a.id),0) AS residuo
             FROM acquisti a
             LEFT JOIN fornitori fo ON fo.id=a.fornitore_id
             LEFT JOIN tipi_pagamento tp ON tp.id=a.tipo_pagamento_id
             WHERE a.stato NOT IN ('PAGATA','ANNULLATA','PAGATO','ANNULLATO')";
        push_scadenze(conn, sql, data_da, data_a, "acq", "SCADENZA_ACQUISTO", "Pagamento acquisto", "#dc2626", &mut out);
    }

    // 4) Attività CRM (tollerante se la tabella non c'è)
    if let Ok(mut stmt) = conn.prepare(
        "SELECT a.id, a.tipo, a.titolo, a.descrizione, a.data_pianificata, o.titolo AS opp_titolo
         FROM crm_attivita a LEFT JOIN crm_opportunita o ON o.id=a.opportunita_id
         WHERE a.data_pianificata IS NOT NULL AND a.data_pianificata BETWEEN ? AND ? AND a.completata=0",
    ) {
        if let Ok(rows) = stmt
            .query_map(rusqlite::params![data_da, data_a], |r| {
                Ok(json!({
                    "id": format!("crm-{}", r.get::<_, i64>(0)?), "source": "CRM", "sourceId": r.get::<_, i64>(0)?,
                    "titolo": format!("[{}] {}", r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get::<_, Option<String>>(2)?.unwrap_or_default()),
                    "inizio": r.get::<_, Option<String>>(4)?, "fine": Value::Null, "tuttoGiorno": false,
                    "controparte": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    "descrizione": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    "colore": "#8b5cf6", "route": "/crm",
                }))
            })
            .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        {
            out.extend(rows);
        }
    }

    // 5) Fatture ricorrenti dovute
    if let Ok(mut stmt) = conn.prepare(
        "SELECT fr.id, fr.descrizione, fr.frequenza, fr.prossima_emissione, c.ragione_sociale c_nome
         FROM fatture_ricorrenti fr LEFT JOIN clienti c ON c.id=fr.cliente_id
         WHERE fr.attiva=1 AND fr.prossima_emissione BETWEEN ? AND ?",
    ) {
        if let Ok(rows) = stmt
            .query_map(rusqlite::params![data_da, data_a], |r| {
                Ok(json!({
                    "id": format!("ric-{}", r.get::<_, i64>(0)?), "source": "RICORRENTE", "sourceId": r.get::<_, i64>(0)?,
                    "titolo": format!("Fattura ricorrente: {}", r.get::<_, Option<String>>(1)?.unwrap_or_default()),
                    "inizio": fmt_iso(&r.get::<_, Option<String>>(3)?.unwrap_or_default()), "fine": Value::Null, "tuttoGiorno": true,
                    "controparte": r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    "descrizione": format!("Frequenza: {}", r.get::<_, Option<String>>(2)?.unwrap_or_default()),
                    "colore": "#f59e0b", "route": "/fatture-ricorrenti",
                }))
            })
            .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        {
            out.extend(rows);
        }
    }

    // 6) Todo con scadenza
    {
        let sql = format!(
            "SELECT * FROM todo WHERE scadenza IS NOT NULL AND stato!='FATTA' AND {}",
            vis_todo.0
        );
        let binds: Vec<SV> = vis_todo.1.iter().map(|x| SV::Integer(*x)).collect();
        if let Ok(mut stmt) = conn.prepare(&sql) {
            if let Ok(rows) = stmt
                .query_map(rusqlite::params_from_iter(binds.iter()), |r| {
                    let pri: Option<String> = r.get("priorita")?;
                    let colore = match pri.as_deref() {
                        Some("ALTA") => "#dc2626",
                        Some("MEDIA") => "#f59e0b",
                        Some("BASSA") => "#94a3b8",
                        _ => "#94a3b8",
                    };
                    Ok((
                        fmt_iso(&r.get::<_, Option<String>>("scadenza")?.unwrap_or_default()),
                        json!({
                            "id": format!("todo-{}", r.get::<_, i64>("id")?), "source": "TODO", "sourceId": r.get::<_, i64>("id")?,
                            "titolo": format!("📋 {}", r.get::<_, Option<String>>("titolo")?.unwrap_or_default()),
                            "fine": Value::Null, "tuttoGiorno": false,
                            "controparte": r.get::<_, Option<String>>("categoria")?.unwrap_or_default(),
                            "descrizione": r.get::<_, Option<String>>("descrizione")?.unwrap_or_default(),
                            "colore": colore, "route": "/agenda",
                        }),
                    ))
                })
                .and_then(|m| m.collect::<Result<Vec<_>, _>>())
            {
                for (dt, mut v) in rows {
                    if dt.as_str() < data_da || dt.as_str() > data_a {
                        continue;
                    }
                    v.as_object_mut().unwrap().insert("inizio".into(), json!(dt));
                    out.push(v);
                }
            }
        }
    }

    out.sort_by(|a, b| {
        let ai = a.get("inizio").and_then(Value::as_str).unwrap_or("");
        let bi = b.get("inizio").and_then(Value::as_str).unwrap_or("");
        ai.cmp(bi)
    });
    out
}

#[allow(clippy::too_many_arguments)]
fn push_scadenze(
    conn: &Connection,
    sql: &str,
    data_da: &str,
    data_a: &str,
    prefix: &str,
    source: &str,
    titolo_prefix: &str,
    colore: &str,
    out: &mut Vec<Value>,
) {
    if let Ok(mut stmt) = conn.prepare(sql) {
        if let Ok(rows) = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>("id")?,
                    r.get::<_, Option<String>>("numero")?.unwrap_or_default(),
                    r.get::<_, Option<String>>("c_nome")?.unwrap_or_default(),
                    r.get::<_, Option<String>>("scadenza")?.unwrap_or_default(),
                    r.get::<_, f64>("residuo")?,
                ))
            })
            .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        {
            for (id, numero, cnome, scad, residuo) in rows {
                if residuo <= 0.01 {
                    continue;
                }
                let dt = fmt_iso(&scad);
                if dt.as_str() < data_da || dt.as_str() > data_a {
                    continue;
                }
                out.push(json!({
                    "id": format!("{prefix}-{id}"), "source": source, "sourceId": id,
                    "titolo": format!("{titolo_prefix} {numero}"),
                    "inizio": dt, "fine": Value::Null, "tuttoGiorno": true,
                    "controparte": cnome,
                    "descrizione": format!("Residuo: € {:.2}", residuo),
                    "colore": colore, "route": "/scadenzario",
                }));
            }
        }
    }
}

fn build_vis_filters(state: &AppState, user: &CurrentUser, vista: &str) -> ((String, Vec<i64>), (String, Vec<i64>)) {
    let vis_todo = ("user_id = ?".to_string(), vec![user.id]);
    let vis_app = if vista == "mia" {
        ("app.user_id = ?".to_string(), vec![user.id])
    } else if vista == "tutte" && is_tenant_admin(user) {
        ("1=1".to_string(), vec![])
    } else if vista == "gruppo" {
        let mates = group_mates_ids(state, user.id);
        let ph = vec!["?"; mates.len()].join(",");
        (format!("app.user_id IN ({ph})"), mates)
    } else {
        visibility_filter(state, user, "app")
    };
    (vis_app, vis_todo)
}

async fn get_calendario(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let (y, m, _) = web::parse_ymd(&web::oggi()).unwrap_or((web::anno(), 1, 1));
    let last = web::days_in_month(y, m);
    let da = q.get("dataDa").cloned().unwrap_or_else(|| format!("{y:04}-{m:02}-01T00:00:00"));
    let a = q.get("dataA").cloned().unwrap_or_else(|| format!("{y:04}-{m:02}-{last:02}T23:59:59"));
    let vista = q.get("vista").map(String::as_str).unwrap_or("auto");
    let (va, vt) = build_vis_filters(&state, &user, vista);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(Value::Array(calendario(&conn, &da, &a, &va, &vt))))
}

async fn imminenti(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let giorni = q.get("giorni").and_then(|s| s.parse::<i64>().ok()).unwrap_or(7).clamp(1, 60);
    let da = format!("{}T00:00:00", web::oggi());
    let a = format!("{}T00:00:00", web::iso_of_days(web::today_days() + giorni));
    let vista = q.get("vista").map(String::as_str).unwrap_or("auto");
    let (va, vt) = build_vis_filters(&state, &user, vista);
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    let mut eventi = calendario(&conn, &da, &a, &va, &vt);
    eventi.truncate(30);
    Ok(Json(json!({ "da": da, "a": a, "eventi": eventi })))
}

async fn promemoria(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let user = CurrentUser::local();
    let da = iso_offset_secs(-2 * 3600);
    let a = iso_offset_secs(30 * 3600);
    let (vsql, vparams) = visibility_filter(&state, &user, "app");
    let mut binds: Vec<SV> = vec![SV::Text(da), SV::Text(a)];
    binds.extend(vparams.into_iter().map(SV::Integer));
    let mut rows = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        let sql = format!(
            "SELECT app.*, c.ragione_sociale AS cliente_nome, f.ragione_sociale AS fornitore_nome
             FROM appuntamenti app
             LEFT JOIN clienti c ON c.id=app.cliente_id
             LEFT JOIN fornitori f ON f.id=app.fornitore_id
             WHERE app.promemoria_min IS NOT NULL AND app.stato = 'PIANIFICATO'
               AND app.inizio BETWEEN ? AND ? AND {vsql}
             ORDER BY app.inizio"
        );
        let mut stmt = conn.prepare(&sql)?;
        let v: Vec<Value> = stmt
            .query_map(rusqlite::params_from_iter(binds.iter()), app_dto)?
            .collect::<Result<_, _>>()?;
        v
    };
    enrich_autori(&state, &mut rows);
    Ok(Json(Value::Array(rows)))
}

// ── ICS ─────────────────────────────────────────────────────────────────────

fn esc_ics(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\\' | ';' | ',' => {
                out.push('\\');
                out.push(ch);
            }
            '\n' => out.push_str("\\n"),
            _ => out.push(ch),
        }
    }
    out
}

fn to_ics_date(iso: &str, all_day: bool) -> String {
    // rimuove '-' e ':' e la parte ".ddd"
    let mut cleaned = String::with_capacity(iso.len());
    let mut chars = iso.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-' || c == ':' {
            continue;
        }
        if c == '.' {
            while matches!(chars.peek(), Some(d) if d.is_ascii_digit()) {
                chars.next();
            }
            continue;
        }
        cleaned.push(c);
    }
    if all_day {
        return cleaned.chars().take(8).collect();
    }
    if cleaned.len() == 8 {
        format!("{cleaned}T000000")
    } else {
        cleaned
    }
}

fn build_ics(eventi: &[Value], cal_name: &str) -> String {
    let now = ics_now();
    let mut lines: Vec<String> = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//Ordeva//Agenda//IT".into(),
        "METHOD:PUBLISH".into(),
        format!("X-WR-CALNAME:{}", esc_ics(cal_name)),
        "X-WR-TIMEZONE:Europe/Rome".into(),
    ];
    for e in eventi {
        let inizio = e.get("inizio").and_then(Value::as_str).unwrap_or("");
        let is_all_day = e.get("tuttoGiorno").and_then(Value::as_bool).unwrap_or(false) || !inizio.contains('T');
        let dtstart = if is_all_day {
            format!(";VALUE=DATE:{}", to_ics_date(inizio, true))
        } else {
            format!(":{}", to_ics_date(inizio, false))
        };
        let fine = e.get("fine").and_then(Value::as_str);
        let dtend = fine.map(|f| {
            if is_all_day {
                format!(";VALUE=DATE:{}", to_ics_date(f, true))
            } else {
                format!(":{}", to_ics_date(f, false))
            }
        });
        lines.push("BEGIN:VEVENT".into());
        lines.push(format!("UID:{}@invoxa", e.get("id").and_then(Value::as_str).unwrap_or("")));
        lines.push(format!("DTSTAMP:{now}"));
        lines.push(format!("DTSTART{dtstart}"));
        if let Some(de) = dtend {
            lines.push(format!("DTEND{de}"));
        }
        lines.push(format!("SUMMARY:{}", esc_ics(e.get("titolo").and_then(Value::as_str).unwrap_or(""))));
        let luogo = e.get("luogo").and_then(Value::as_str).unwrap_or("");
        if !luogo.is_empty() {
            lines.push(format!("LOCATION:{}", esc_ics(luogo)));
        }
        let descr = e.get("descrizione").and_then(Value::as_str).unwrap_or("");
        let controparte = e.get("controparte").and_then(Value::as_str).unwrap_or("");
        let mut parts: Vec<String> = Vec::new();
        if !descr.is_empty() {
            parts.push(descr.to_string());
        }
        if !controparte.is_empty() {
            parts.push(format!("Controparte: {controparte}"));
        }
        let desc = parts.join("\\n");
        if !desc.is_empty() {
            lines.push(format!("DESCRIPTION:{}", esc_ics(&desc).replace("\\n", "\\n")));
        }
        lines.push(format!("CATEGORIES:{}", e.get("source").and_then(Value::as_str).unwrap_or("")));
        lines.push("END:VEVENT".into());
    }
    lines.push("END:VCALENDAR".into());
    lines.join("\r\n")
}

async fn export_ics(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Response> {
    let da = q.get("dataDa").cloned().unwrap_or_else(|| iso_month_offset(-3));
    let a = q.get("dataA").cloned().unwrap_or_else(|| iso_month_offset(12));
    let eventi = {
        let conn = tenant_conn(&state)?;
        let conn = conn.lock().unwrap();
        calendario(&conn, &da, &a, &("1=1".into(), vec![]), &("1=1".into(), vec![]))
    };
    let ics = build_ics(&eventi, "Ordeva Agenda");
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "text/calendar; charset=utf-8")
        .header(header::CONTENT_DISPOSITION, "attachment; filename=\"ordeva-agenda.ics\"")
        .body(Body::from(ics))
        .unwrap())
}

async fn feed_url(State(_state): State<AppState>) -> ApiResult<Json<Value>> {
    let secret = std::env::var("AUTH_SECRET").unwrap_or_default();
    if secret.is_empty() {
        return Err(ApiError::Status(
            StatusCode::SERVICE_UNAVAILABLE,
            "Feed agenda non disponibile: AUTH_SECRET non configurato sul server".into(),
        ));
    }
    let tenant = CurrentUser::local().tenant;
    let token = feed_token_for(&tenant, &secret);
    // Senza host noto in offline, restituiamo localhost (parità best-effort).
    let https = format!("http://localhost:3000/api/agenda/feed.ics?tenant={tenant}&token={token}");
    let webcal = https.replacen("http:", "webcal:", 1);
    Ok(Json(json!({ "httpsUrl": https, "webcalUrl": webcal, "tenant": tenant })))
}

async fn feed_ics(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let tenant = q.get("tenant").cloned().unwrap_or_default();
    let token = q.get("token").cloned().unwrap_or_default();
    let secret = std::env::var("AUTH_SECRET").unwrap_or_default();
    if secret.is_empty() || !verify_feed_token(&tenant, &token, &secret) {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    // In offline il solo tenant valido è "default".
    if tenant != crate::db::DEFAULT_TENANT {
        return (StatusCode::NOT_FOUND, "Tenant non trovato").into_response();
    }
    let eventi = match tenant_conn(&state) {
        Ok(conn) => {
            let conn = conn.lock().unwrap();
            calendario(&conn, &iso_month_offset(-3), &iso_month_offset(12), &("1=1".into(), vec![]), &("1=1".into(), vec![]))
        }
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Errore").into_response(),
    };
    let ics = build_ics(&eventi, &format!("Ordeva Agenda ({tenant})"));
    Response::builder()
        .header(header::CONTENT_TYPE, "text/calendar; charset=utf-8")
        .header(header::CACHE_CONTROL, "public, max-age=300")
        .body(Body::from(ics))
        .unwrap()
}

fn feed_token_for(tenant: &str, secret: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(format!("ICS_FEED:{tenant}").as_bytes());
    let bytes = mac.finalize().into_bytes();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    hex[..32].to_string()
}

fn verify_feed_token(tenant: &str, token: &str, secret: &str) -> bool {
    if tenant.is_empty() || token.is_empty() {
        return false;
    }
    let expected = feed_token_for(tenant, secret);
    expected.len() == token.len() && expected == token
}

// ── util tempo ──────────────────────────────────────────────────────────────

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64
}

/// "YYYY-MM-DDTHH:MM:SS.mmm" + 'Z' rimosso a slice — qui ISO con ms per completata_at.
fn now_iso_ms() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs() as i64;
    let ms = now.subsec_millis();
    let (date, h, mi, s) = split_dt(secs);
    format!("{date}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

/// "YYYY-MM-DDTHH:MM:SS" a now + offset secondi (per le finestre promemoria).
fn iso_offset_secs(offset: i64) -> String {
    let (date, h, mi, s) = split_dt(now_secs() + offset);
    format!("{date}T{h:02}:{mi:02}:{s:02}")
}

fn split_dt(secs: i64) -> (String, i64, i64, i64) {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    (web::iso_of_days(days), rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Data a now ± mesi, formato "YYYY-MM-DDTHH:MM:SS" (semantica setMonth, UTC).
fn iso_month_offset(months: i64) -> String {
    let (date, h, mi, s) = split_dt(now_secs());
    let (y, m, d) = web::parse_ymd(&date).unwrap_or((1970, 1, 1));
    let idx = (m - 1) + months;
    let ny = y + idx.div_euclid(12);
    let nm = idx.rem_euclid(12) + 1;
    let last = web::days_in_month(ny, nm);
    let nd = d.min(last);
    format!("{ny:04}-{nm:02}-{nd:02}T{h:02}:{mi:02}:{s:02}")
}

fn ics_now() -> String {
    // toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'') → "YYYYMMDDTHHMMSSZ"
    let (date, h, mi, s) = split_dt(now_secs());
    let d = date.replace('-', "");
    format!("{d}T{h:02}{mi:02}{s:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feed_token_matches_node() {
        // Node: HMAC-SHA256('test', 'ICS_FEED:default').hex().slice(0,32)
        assert_eq!(feed_token_for("default", "test"), "c4d206700b54e35c3c7cb490caa245d9");
    }

    #[test]
    fn ics_date_formats() {
        assert_eq!(to_ics_date("2026-06-20T10:00:00", false), "20260620T100000");
        assert_eq!(to_ics_date("2026-06-21", true), "20260621");
        assert_eq!(to_ics_date("2026-06-21", false), "20260621T000000");
    }
}
