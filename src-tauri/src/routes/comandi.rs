//! /api/comandi — parità con routes/comandi.js: barra comandi "intelligente",
//! parser deterministico IT che restituisce una RISPOSTA (lettura dai dati) o una
//! BOZZA di documento/anagrafica. Non scrive mai nulla.

use axum::{extract::State, routing::post, Json, Router};
use fancy_regex::Regex;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::db::AppState;
use crate::error::ApiResult;
use crate::web::tenant_conn;

pub fn routes() -> Router<AppState> {
    Router::new().route("/", post(comandi))
}

const MESI: [(&str, i64); 24] = [
    ("gennaio", 1), ("febbraio", 2), ("marzo", 3), ("aprile", 4), ("maggio", 5), ("giugno", 6),
    ("luglio", 7), ("agosto", 8), ("settembre", 9), ("ottobre", 10), ("novembre", 11), ("dicembre", 12),
    ("gen", 1), ("feb", 2), ("mar", 3), ("apr", 4), ("mag", 5), ("giu", 6),
    ("lug", 7), ("ago", 8), ("set", 9), ("sett", 9), ("ott", 10), ("nov", 11),
];
// NB: 'dic' è 24° voce; lo gestiamo a parte per non sforare l'array (Node ha anche dic=12).
const MESE_DIC: (&str, i64) = ("dic", 12);
const NOMI_MESE: [&str; 13] = [
    "", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

fn norm(s: &str) -> String {
    s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn it_number(v: f64) -> String {
    let neg = v < 0.0;
    let cents = (v.abs() * 100.0).round() as i64;
    let int_part = cents / 100;
    let frac = cents % 100;
    // raggruppa le migliaia con '.'
    let digits = int_part.to_string();
    let mut grouped = String::new();
    let bytes = digits.as_bytes();
    let len = bytes.len();
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(*b as char);
    }
    format!("{}{},{:02}", if neg { "-" } else { "" }, grouped, frac)
}

fn eur(n: f64) -> String {
    let r = (n * 100.0).round() / 100.0;
    format!("€ {}", it_number(r))
}

/// is_match con (?i) implicito gestito dal chiamante che passa il pattern.
fn rmatch(pat: &str, text: &str) -> bool {
    Regex::new(pat).map(|re| re.is_match(text).unwrap_or(false)).unwrap_or(false)
}

/// Primo gruppo catturato (trimmed) del pattern, se match.
fn rcap1(pat: &str, text: &str) -> Option<String> {
    let re = Regex::new(pat).ok()?;
    let caps = re.captures(text).ok()??;
    caps.get(1).map(|m| m.as_str().trim().to_string())
}

// ── date ────────────────────────────────────────────────────────────────────

fn pad2(n: i64) -> String {
    format!("{n:02}")
}
fn last_day(y: i64, m: i64) -> i64 {
    crate::web::days_in_month(y, m)
}
/// getDay() JS (0=domenica) dalla data odierna UTC.
fn js_weekday(days: i64) -> i64 {
    ((days % 7) + 4).rem_euclid(7)
}

struct Periodo {
    da: String,
    a: String,
    label: String,
}

fn parse_periodo(q: &str) -> Periodo {
    let today = crate::web::today_days();
    let (ty, tm, _td) = crate::web::parse_ymd(&crate::web::oggi()).unwrap_or((1970, 1, 1));
    let ymd = |days: i64| crate::web::iso_of_days(days);

    if rmatch(r"\boggi\b", q) {
        let d = ymd(today);
        return Periodo { da: d.clone(), a: d, label: "oggi".into() };
    }
    if rmatch(r"\bieri\b", q) {
        let d = ymd(today - 1);
        return Periodo { da: d.clone(), a: d, label: "ieri".into() };
    }
    if rmatch(r"\b(questa settimana|settimana)\b", q) {
        let dow = (js_weekday(today) + 6).rem_euclid(7); // 0 = lunedì
        let mon = today - dow;
        let sun = mon + 6;
        return Periodo { da: ymd(mon), a: ymd(sun), label: "questa settimana".into() };
    }

    let mut anno = ty;
    if let Some(y) = rcap1(r"\b(20\d{2})\b", q) {
        anno = y.parse().unwrap_or(ty);
    } else if rmatch(r"\b(anno scorso|scorso anno|l['’]anno scorso)\b", q) {
        anno -= 1;
    }

    let mut mese: Option<i64> = None;
    for (k, v) in MESI.iter().chain(std::iter::once(&MESE_DIC)) {
        if rmatch(&format!(r"\b{k}\b"), q) {
            mese = Some(*v);
            break;
        }
    }
    if mese.is_none() && rmatch(r"\b(mese scorso|scorso mese)\b", q) {
        // primo del mese precedente rispetto a oggi
        let (py, pm) = if tm == 1 { (ty - 1, 12) } else { (ty, tm - 1) };
        anno = py;
        mese = Some(pm);
    }
    if mese.is_none() && rmatch(r"\b(questo mese|mese corrente)\b", q) {
        mese = Some(tm);
    }

    if let Some(m) = mese {
        return Periodo {
            da: format!("{anno}-{}-01", pad2(m)),
            a: format!("{anno}-{}-{}", pad2(m), pad2(last_day(anno, m))),
            label: format!("{} {anno}", NOMI_MESE[m as usize]),
        };
    }
    Periodo { da: format!("{anno}-01-01"), a: format!("{anno}-12-31"), label: format!("{anno}") }
}

// ── letture ─────────────────────────────────────────────────────────────────

fn fatturato(c: &Connection, q: &str) -> Value {
    let p = parse_periodo(q);
    let (imp, tot): (f64, f64) = c
        .query_row(
            "SELECT COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)),0),
                    COALESCE(SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)),0)
             FROM fatture f JOIN fatture_righe fr ON fr.fattura_id=f.id
             WHERE f.stato!='ANNULLATA' AND f.data_emissione BETWEEN ? AND ?",
            params![p.da, p.a],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0.0, 0.0));
    json!({
        "tipo": "risposta", "icona": "payments",
        "titolo": format!("Fatturato {}: {}", p.label, eur(tot)),
        "dettaglio": format!("Imponibile {} · clicca per i report", eur(imp)),
        "route": "/report",
    })
}

fn insoluti(c: &Connection, q: &str) -> Value {
    let mut cliente_id: Option<i64> = None;
    let mut cliente_nome = String::new();
    if let Some(m) = rcap1(r"(?i)\b(?:di|da|del|dello|della|cliente)\s+([a-zàèéìòù][\w àèéìòù'’.&-]*?)\s*$", q) {
        if let Ok((id, nome)) = c.query_row(
            "SELECT id, ragione_sociale FROM clienti WHERE LOWER(ragione_sociale) LIKE ? ORDER BY length(ragione_sociale) LIMIT 1",
            params![format!("%{}%", norm(&m))],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
        ) {
            cliente_id = Some(id);
            cliente_nome = nome;
        }
    }
    let (sql, bind): (String, Vec<rusqlite::types::Value>) = if let Some(cid) = cliente_id {
        (
            "SELECT COALESCE((SELECT SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)) FROM fatture_righe fr WHERE fr.fattura_id=f.id),0) AS totale
             FROM fatture f WHERE f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA') AND f.cliente_id=?".into(),
            vec![rusqlite::types::Value::Integer(cid)],
        )
    } else {
        (
            "SELECT COALESCE((SELECT SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)) FROM fatture_righe fr WHERE fr.fattura_id=f.id),0) AS totale
             FROM fatture f WHERE f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA')".into(),
            vec![],
        )
    };
    let mut stmt = c.prepare(&sql).unwrap();
    let tots: Vec<f64> = stmt
        .query_map(rusqlite::params_from_iter(bind.iter()), |r| r.get::<_, Option<f64>>(0).map(|x| x.unwrap_or(0.0)))
        .map(|m| m.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    let n = tots.len();
    let tot: f64 = tots.iter().sum();
    json!({
        "tipo": "risposta", "icona": "request_quote",
        "titolo": if !cliente_nome.is_empty() { format!("Insoluti di {}: {}", cliente_nome, eur(tot)) } else { format!("Insoluti clienti: {}", eur(tot)) },
        "dettaglio": format!("{} fattur{} da incassare · apri scadenzario", n, if n == 1 { "a" } else { "e" }),
        "route": "/scadenzario",
    })
}

fn sotto_scorta(c: &Connection) -> Value {
    let mut stmt = c
        .prepare("SELECT codice FROM prodotti WHERE soglia_minima>0 AND quantita<soglia_minima ORDER BY quantita ASC, codice")
        .unwrap();
    let codici: Vec<String> = stmt
        .query_map([], |r| r.get::<_, Option<String>>(0).map(|x| x.unwrap_or_default()))
        .map(|m| m.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    let n = codici.len();
    let primi = codici.iter().take(3).cloned().collect::<Vec<_>>().join(", ");
    json!({
        "tipo": "risposta", "icona": "inventory_2",
        "titolo": format!("Prodotti sotto scorta: {}", n),
        "dettaglio": if n > 0 { format!("{}{} · apri magazzino", primi, if n > 3 { "…" } else { "" }) } else { "Tutto in regola".to_string() },
        "route": "/magazzino",
    })
}

fn giacenza(c: &Connection, cercato: &str) -> Value {
    let p = c.query_row(
        "SELECT codice, quantita, unita_misura FROM prodotti \
         WHERE LOWER(codice) LIKE ?1 OR LOWER(descrizione) LIKE ?1 ORDER BY length(codice) LIMIT 1",
        params![format!("%{}%", norm(cercato))],
        |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get::<_, Option<f64>>(1)?.unwrap_or(0.0), r.get::<_, Option<String>>(2)?)),
    );
    match p {
        Ok((codice, q, um)) => json!({
            "tipo": "risposta", "icona": "inventory",
            "titolo": format!("{}: {} {} a magazzino", codice, crate::web::fmt_num(q), um.filter(|s| !s.is_empty()).unwrap_or_else(|| "pz".into())),
            "route": "/magazzino",
        }),
        Err(_) => json!({ "tipo": "nessuno" }),
    }
}

fn debiti_fornitori(c: &Connection) -> Value {
    let mut stmt = c
        .prepare(
            "SELECT COALESCE((SELECT SUM(ar.quantita*ar.prezzo*(1-COALESCE(ar.sconto,0)/100)*(1+ar.iva/100)) FROM acquisti_righe ar WHERE ar.acquisto_id=a.id),0) AS totale
             FROM acquisti a WHERE a.stato NOT IN ('PAGATO','PAGATA','ANNULLATO','ANNULLATA')",
        )
        .unwrap();
    let tots: Vec<f64> = stmt
        .query_map([], |r| r.get::<_, Option<f64>>(0).map(|x| x.unwrap_or(0.0)))
        .map(|m| m.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    let n = tots.len();
    let tot: f64 = tots.iter().sum();
    json!({
        "tipo": "risposta", "icona": "payments",
        "titolo": format!("Da pagare ai fornitori: {}", eur(tot)),
        "dettaglio": format!("{} document{} da saldare · apri scadenzario", n, if n == 1 { "o" } else { "i" }),
        "route": "/scadenzario",
    })
}

fn scaduti(c: &Connection) -> Value {
    let (n, tot): (i64, f64) = c
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(t.totale),0) FROM (
               SELECT date(f.data_emissione,'+'||COALESCE(tp.giorni_scadenza,30)||' days') AS ds,
                      COALESCE((SELECT SUM(fr.quantita*fr.prezzo*(1-COALESCE(fr.sconto,0)/100)*(1+fr.iva/100)) FROM fatture_righe fr WHERE fr.fattura_id=f.id),0) AS totale
               FROM fatture f LEFT JOIN tipi_pagamento tp ON f.tipo_pagamento_id=tp.id
               WHERE f.stato NOT IN ('PAGATA','ANNULLATA','STORNATA')
             ) t WHERE t.ds < date('now')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, 0.0));
    json!({
        "tipo": "risposta", "icona": "event_busy",
        "titolo": format!("Fatture scadute: {} ({})", n, eur(tot)),
        "dettaglio": if n > 0 { "già oltre la scadenza · apri scadenzario".to_string() } else { "nessuna scaduta, bene così".to_string() },
        "route": "/scadenzario",
    })
}

fn conteggio(c: &Connection, q: &str) -> Value {
    let (tabella, label, route, icona) = if rmatch(r"\bfornitor", q) {
        ("fornitori", "fornitori", "/fornitori", "local_shipping")
    } else if rmatch(r"\bclient", q) {
        ("clienti", "clienti", "/clienti", "group")
    } else if rmatch(r"\b(prodott|articol)", q) {
        ("prodotti", "prodotti", "/prodotti", "inventory_2")
    } else if rmatch(r"\b(fattur)", q) {
        ("fatture", "fatture", "/fatture", "receipt_long")
    } else if rmatch(r"\b(preventiv)", q) {
        ("preventivi", "preventivi", "/preventivi", "description")
    } else {
        return json!({ "tipo": "nessuno" });
    };
    let n: i64 = c.query_row(&format!("SELECT COUNT(*) FROM {tabella}"), [], |r| r.get(0)).unwrap_or(0);
    json!({ "tipo": "risposta", "icona": icona, "titolo": format!("Hai {} {}", n, label), "dettaglio": format!("apri {}", label), "route": route })
}

// ── bozze ───────────────────────────────────────────────────────────────────

fn match_cliente(c: &Connection, nome: &str) -> Option<(i64, String)> {
    if nome.is_empty() {
        return None;
    }
    c.query_row(
        "SELECT id, ragione_sociale FROM clienti WHERE LOWER(ragione_sociale) LIKE ? ORDER BY length(ragione_sociale) LIMIT 1",
        params![format!("%{}%", norm(nome))],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default())),
    )
    .ok()
}

struct Prod {
    id: i64,
    descrizione: String,
    prezzo: f64,
    iva: Option<f64>,
    unita_misura: String,
    codice: String,
}

fn match_prodotto(c: &Connection, cercato: &str) -> Option<Prod> {
    let n = norm(cercato);
    if n.is_empty() {
        return None;
    }
    let like = format!("%{}%", n);
    c.query_row(
        "SELECT id, descrizione, prezzo, iva, unita_misura, codice FROM prodotti
         WHERE LOWER(codice)=? OR LOWER(descrizione)=? OR LOWER(descrizione) LIKE ?
         ORDER BY (LOWER(codice)=?) DESC, (LOWER(descrizione)=?) DESC, length(codice) ASC LIMIT 1",
        params![n, n, like, n, n],
        |r| {
            Ok(Prod {
                id: r.get(0)?,
                descrizione: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                prezzo: r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                iva: r.get::<_, Option<f64>>(3)?,
                unita_misura: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                codice: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            })
        },
    )
    .ok()
}

fn riga_prodotto(p: &Prod, qta: f64) -> Value {
    json!({
        "prodottoId": p.id,
        "codiceProdotto": if p.codice.is_empty() { String::new() } else { p.codice.clone() },
        "descrizione": if p.descrizione.is_empty() { p.codice.clone() } else { p.descrizione.clone() },
        "quantita": crate::web::num(qta),
        "prezzo": crate::web::num(p.prezzo),
        "iva": crate::web::num(p.iva.unwrap_or(22.0)),
        "unitaMisura": if p.unita_misura.is_empty() { "pz".to_string() } else { p.unita_misura.clone() },
        "sconto": 0,
        "tipo": "PRODOTTO",
    })
}

fn parse_righe(c: &Connection, testo: &str) -> Vec<Value> {
    let mut righe = Vec::new();
    let re = match Regex::new(r"(?i)(\d+(?:[.,]\d+)?)\s*(?:x\s*)?([a-zàèéìòùç][a-zàèéìòùç0-9 '’\-]*?)(?=\s*[,;]|\s+e\s|\s+\d|\s*$)") {
        Ok(r) => r,
        Err(_) => return righe,
    };
    for cap in re.captures_iter(testo).flatten() {
        let qta = cap
            .get(1)
            .and_then(|m| m.as_str().replace(',', ".").parse::<f64>().ok())
            .filter(|x| *x != 0.0)
            .unwrap_or(1.0);
        let nome_raw = cap.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        if nome_raw.is_empty() {
            continue;
        }
        match match_prodotto(c, &nome_raw) {
            Some(p) => righe.push(riga_prodotto(&p, qta)),
            None => righe.push(json!({
                "prodottoId": Value::Null, "descrizione": nome_raw, "quantita": crate::web::num(qta),
                "prezzo": 0, "iva": 22, "unitaMisura": "pz", "sconto": 0, "tipo": "PRODOTTO",
            })),
        }
    }
    righe
}

fn bozza_documento(c: &Connection, target: &str, q_in: &str) -> Value {
    let nome_doc = match target {
        "fattura" => "fattura",
        "preventivo" => "preventivo",
        _ => "documento di trasporto",
    };
    // "una/uno/un" → "1"
    let q = Regex::new(r"(?i)\b(una|uno|un)\b").unwrap().replace_all(q_in, "1").to_string();

    let mut cliente_id: Option<i64> = None;
    let mut cliente_nome = String::new();
    let re_cli = Regex::new(r"(?i)\b(?:a|ad|al|alla|allo|ai|agli|per|cliente)\s+([a-zàèéìòù][\w àèéìòù'’.&-]*?)(?=\s+\S*\d|,|$)").unwrap();
    let mut mc_full = String::new();
    if let Ok(Some(cap)) = re_cli.captures(&q) {
        mc_full = cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
        let raw = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let nome_cli = Regex::new(r"(?i)^(?:cliente|il|lo|la|i|gli|le)\s+").unwrap().replace(raw, "").trim().to_string();
        if let Some((id, nome)) = match_cliente(c, &nome_cli) {
            cliente_id = Some(id);
            cliente_nome = nome;
        } else if !nome_cli.is_empty() {
            cliente_nome = nome_cli;
        }
    }

    // Righe dal testo senza la parte cliente e senza le parole chiave.
    let mut resto = q.clone();
    if !mc_full.is_empty() {
        resto = resto.replacen(&mc_full, " ", 1);
    }
    resto = Regex::new(r"(?i)\b(fattura|fatturare|preventivo|preventivare|ddt|bolla|trasporto|offerta)\b").unwrap().replace_all(&resto, " ").to_string();
    resto = Regex::new(r"(?i)\b(crea|creare|nuov[oa]|fai|fammi|genera|emetti|registra)\b").unwrap().replace_all(&resto, " ").to_string();
    let mut righe = parse_righe(c, &resto);
    if righe.is_empty() {
        let tok = {
            let t = Regex::new(r"(?i)[^a-zàèéìòùç0-9 '’\-]").unwrap().replace_all(&resto, " ").to_string();
            t.split_whitespace().collect::<Vec<_>>().join(" ")
        };
        if tok.chars().count() >= 2 && !rmatch(r"(?i)^(a|ad|al|per|il|lo|la|i|gli|le)$", &tok) {
            if let Some(p) = match_prodotto(c, &tok) {
                righe = vec![riga_prodotto(&p, 1.0)];
            }
        }
    }

    let trovato = cliente_id.is_some();
    let n = righe.len();
    let dettaglio = if n > 0 {
        let suffix = if trovato {
            String::new()
        } else if !cliente_nome.is_empty() {
            format!(" · cliente \"{}\" da confermare", cliente_nome)
        } else {
            String::new()
        };
        format!("{} rig{} precompilat{}{}", n, if n == 1 { "a" } else { "he" }, if n == 1 { "a" } else { "e" }, suffix)
    } else if trovato {
        "cliente impostato · aggiungi le righe".to_string()
    } else {
        "apri una nuova bozza".to_string()
    };

    let nuovo = if target == "preventivo" || target == "ddt" { "Nuovo" } else { "Nuova" };
    json!({
        "tipo": "bozza", "target": target,
        "icona": if target == "fattura" { "receipt_long" } else if target == "preventivo" { "description" } else { "local_shipping" },
        "titolo": format!("{} {}{}", nuovo, nome_doc, if !cliente_nome.is_empty() { format!(" per {}", cliente_nome) } else { String::new() }),
        "dettaglio": dettaglio,
        "dati": { "clienteId": cliente_id, "clienteNome": cliente_nome, "righe": righe },
    })
}

fn bozza_cliente(q: &str) -> Value {
    let mut resto = Regex::new(r"(?i)\b(crea|creare|nuov[oa]|aggiungi|registra|inserisci|fai|fammi|genera)\b").unwrap().replace_all(q, " ").to_string();
    resto = Regex::new(r"(?i)\b(cliente|anagrafica)\b").unwrap().replace_all(&resto, " ").to_string();
    let mut p_iva = String::new();
    let re1 = Regex::new(r"(?i)\b(?:p\.?\s*iva|partita iva)\s*:?\s*(\d{8,13})\b").unwrap();
    let cap = re1.captures(&resto).ok().flatten().or_else(|| Regex::new(r"\b(\d{11})\b").unwrap().captures(&resto).ok().flatten());
    if let Some(cap) = cap {
        p_iva = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
        let whole = cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
        resto = resto.replacen(&whole, " ", 1);
    }
    let nome = resto.split_whitespace().collect::<Vec<_>>().join(" ");
    if nome.is_empty() {
        return json!({ "tipo": "nessuno" });
    }
    json!({
        "tipo": "bozza", "target": "cliente", "icona": "person_add",
        "titolo": format!("Nuovo cliente: {}", nome),
        "dettaglio": if !p_iva.is_empty() { format!("P.IVA {} · conferma e salva", p_iva) } else { "conferma e salva".to_string() },
        "dati": { "ragioneSociale": nome, "pIva": p_iva },
    })
}

fn bozza_prodotto(q: &str) -> Value {
    let mut resto = Regex::new(r"(?i)\b(crea|creare|nuov[oa]|aggiungi|registra|inserisci|fai|fammi|genera)\b").unwrap().replace_all(q, " ").to_string();
    resto = Regex::new(r"(?i)\b(prodotto|articolo)\b").unwrap().replace_all(&resto, " ").to_string();
    let mut prezzo: Option<f64> = None;
    let re = Regex::new(r"(?i)\b(?:prezzo|a)\s*:?\s*€?\s*(\d+(?:[.,]\d+)?)").unwrap();
    if let Ok(Some(cap)) = re.captures(&resto) {
        prezzo = cap.get(1).and_then(|m| m.as_str().replace(',', ".").parse::<f64>().ok());
        let whole = cap.get(0).map(|m| m.as_str().to_string()).unwrap_or_default();
        resto = resto.replacen(&whole, " ", 1);
    }
    let codice = resto.split_whitespace().collect::<Vec<_>>().join(" ");
    if codice.is_empty() {
        return json!({ "tipo": "nessuno" });
    }
    json!({
        "tipo": "bozza", "target": "prodotto", "icona": "add_box",
        "titolo": format!("Nuovo prodotto: {}", codice),
        "dettaglio": if let Some(p) = prezzo { format!("Prezzo {} · conferma e salva", eur(p)) } else { "conferma e salva".to_string() },
        "dati": { "codice": codice, "prezzo": crate::web::num(prezzo.unwrap_or(0.0)) },
    })
}

fn interpreta(c: &Connection, q_raw: &str) -> Value {
    let q = norm(q_raw);
    if q.chars().count() < 3 {
        return json!({ "tipo": "nessuno" });
    }

    if rmatch(r"(?i)\b(fatturat|incass|venduto|vendite|ricav|giro d['’ ]?affari|guadagn|entrate)", &q) {
        return fatturato(c, &q);
    }
    if rmatch(r"(?i)\bdebit[oi]\b", &q) || (rmatch(r"(?i)\bda pagare\b", &q) && !rmatch(r"(?i)\bclient", &q)) {
        return debiti_fornitori(c);
    }
    if rmatch(r"(?i)\bscadut[ei]\b", &q) {
        return scaduti(c);
    }
    if rmatch(r"(?i)\b(insolut|da incassare|da riscuotere|crediti|chi.*(deve|pagat)|non.*pagat)", &q) {
        return insoluti(c, &q);
    }
    if rmatch(r"(?i)\b(sotto scorta|sotto soglia|scorte|da riordinare|esaurit|in esaurimento)\b", &q) {
        return sotto_scorta(c);
    }
    if rmatch(r"(?i)\bquant[ie]\b", &q) && rmatch(r"(?i)\b(client|fornitor|prodott|articol|fattur|preventiv)", &q) && !rmatch(r"(?i)\bfatturat", &q) {
        let r = conteggio(c, &q);
        if r.get("tipo").and_then(Value::as_str) != Some("nessuno") {
            return r;
        }
    }
    if let Some(g) = rcap1(r"(?i)\b(?:giacenza|quante|quanti|scorta di|disponibilit[aà])\s+(?:di\s+)?([a-zàèéìòù][\w àèéìòù'’-]*?)(?:\s+(?:ho|in magazzino|disponibili|rimast[ei]))?\s*$", &q) {
        return giacenza(c, &g);
    }

    let is_fatt = rmatch(r"(?i)\bfattur", &q);
    let is_prev = rmatch(r"(?i)\bpreventiv|\boffert", &q);
    let is_ddt = rmatch(r"(?i)\bddt|bolla|trasporto", &q);
    if is_fatt || is_prev || is_ddt {
        let target = if is_prev { "preventivo" } else if is_ddt { "ddt" } else { "fattura" };
        return bozza_documento(c, target, &q);
    }

    let verbo = rmatch(r"(?i)\b(crea|creare|nuov[oa]|aggiungi|registra|inserisci|fai|fammi|genera)\b", &q);
    if verbo && rmatch(r"(?i)\b(cliente|anagrafica)\b", &q) {
        return bozza_cliente(&q);
    }
    if verbo && rmatch(r"(?i)\b(prodotto|articolo)\b", &q) {
        return bozza_prodotto(&q);
    }

    json!({ "tipo": "nessuno" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eur_it_format() {
        assert_eq!(eur(0.0), "€ 0,00");
        assert_eq!(eur(19.9), "€ 19,90");
        assert_eq!(eur(250.0), "€ 250,00");
        assert_eq!(eur(1234.5), "€ 1.234,50");
        assert_eq!(eur(1234567.89), "€ 1.234.567,89");
        assert_eq!(eur(-12.5), "€ -12,50");
    }

    #[test]
    fn norm_collapses() {
        assert_eq!(norm("  Crea   Fattura  "), "crea fattura");
    }
}

async fn comandi(State(state): State<AppState>, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let q: String = body
        .get("q")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(200)
        .collect();
    let conn = tenant_conn(&state)?;
    let conn = conn.lock().unwrap();
    Ok(Json(interpreta(&conn, &q)))
}
