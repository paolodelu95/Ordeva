//! Catalogo moduli e gestione tenant_moduli — parità con utils/authDb.js
//! (MODULI_CATALOGO, seedModuli, ensureTenantModuli, listTenantModuli, setTenantModulo).

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

/// Moduli nascosti dalle liste UI (vedi MODULI_NASCOSTI di authDb.js).
pub const NASCOSTI: [&str; 2] = ["crm", "timesheet"];

/// Definizione di un modulo del catalogo.
pub struct ModuloDef {
    pub slug: &'static str,
    pub nome: &'static str,
    pub descrizione: &'static str,
    pub categoria: &'static str,
    pub icona: &'static str,
    pub core: i64,
    pub default_attivo: i64,
    pub ordine: i64,
}

/// Catalogo moduli (estratto verbatim da MODULI_CATALOGO).
pub const CATALOGO: [ModuloDef; 12] = [
    ModuloDef { slug: "anagrafica", nome: "Anagrafica", descrizione: "Clienti, fornitori, prodotti", categoria: "Core", icona: "contacts", core: 1, default_attivo: 1, ordine: 1 },
    ModuloDef { slug: "vendite", nome: "Vendite", descrizione: "Preventivi, ordini, documenti di trasporto, fatture, note credito", categoria: "Core", icona: "point_of_sale", core: 1, default_attivo: 1, ordine: 2 },
    ModuloDef { slug: "acquisti", nome: "Acquisti", descrizione: "Acquisti e arrivi merce", categoria: "Core", icona: "shopping_bag", core: 1, default_attivo: 1, ordine: 3 },
    ModuloDef { slug: "magazzino", nome: "Magazzino", descrizione: "Movimenti e giacenze", categoria: "Core", icona: "warehouse", core: 1, default_attivo: 1, ordine: 4 },
    ModuloDef { slug: "contabilita", nome: "Contabilità", descrizione: "Pagamenti, scadenzario, prima nota", categoria: "Core", icona: "account_balance", core: 1, default_attivo: 1, ordine: 5 },
    ModuloDef { slug: "fatture_ricorrenti", nome: "Fatturazione ricorrente", descrizione: "Fatture periodiche automatiche", categoria: "Vendite", icona: "autorenew", core: 0, default_attivo: 1, ordine: 10 },
    ModuloDef { slug: "vendita_banco", nome: "Vendita al banco", descrizione: "Cassa veloce per negozi", categoria: "Vendite", icona: "point_of_sale", core: 0, default_attivo: 0, ordine: 11 },
    ModuloDef { slug: "riconciliazione", nome: "Riconciliazione bancaria", descrizione: "Import OFX/CSV + match scadenze", categoria: "Contabilità", icona: "account_balance", core: 0, default_attivo: 1, ordine: 20 },
    ModuloDef { slug: "compliance", nome: "Compliance fiscale", descrizione: "LIPE, esterometro, export commercialista", categoria: "Contabilità", icona: "verified", core: 0, default_attivo: 1, ordine: 21 },
    ModuloDef { slug: "crm", nome: "CRM", descrizione: "Pipeline opportunità + attività", categoria: "Operativo", icona: "group_work", core: 0, default_attivo: 0, ordine: 30 },
    ModuloDef { slug: "timesheet", nome: "Timesheet", descrizione: "Progetti e ore lavorate", categoria: "Operativo", icona: "schedule", core: 0, default_attivo: 0, ordine: 31 },
    ModuloDef { slug: "agenda", nome: "Agenda", descrizione: "Appuntamenti, todo list, vista calendario + ICS export", categoria: "Operativo", icona: "event_note", core: 0, default_attivo: 1, ordine: 33 },
];

fn is_nascosto(slug: &str) -> bool {
    NASCOSTI.contains(&slug)
}

/// seedModuli: INSERT del catalogo (o UPDATE se già presente). Idempotente.
pub fn seed_catalog(conn: &Connection) -> rusqlite::Result<()> {
    for m in &CATALOGO {
        let exists: Option<String> = conn
            .query_row("SELECT slug FROM moduli WHERE slug=?", [m.slug], |r| r.get(0))
            .optional()?;
        if exists.is_some() {
            conn.execute(
                "UPDATE moduli SET nome=?, descrizione=?, categoria=?, icona=?, core=?, default_attivo=?, ordine=? WHERE slug=?",
                params![m.nome, m.descrizione, m.categoria, m.icona, m.core, m.default_attivo, m.ordine, m.slug],
            )?;
        } else {
            conn.execute(
                "INSERT INTO moduli (slug, nome, descrizione, categoria, icona, core, default_attivo, ordine) VALUES (?,?,?,?,?,?,?,?)",
                params![m.slug, m.nome, m.descrizione, m.categoria, m.icona, m.core, m.default_attivo, m.ordine],
            )?;
        }
    }
    Ok(())
}

/// ensureTenantModuli: garantisce una riga tenant_moduli per ogni modulo del catalogo.
pub fn ensure_tenant_moduli(conn: &Connection, tenant: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT slug, core, default_attivo FROM moduli")?;
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (slug, core, default_attivo) in rows {
        let attivo = if core == 1 { 1 } else { default_attivo };
        conn.execute(
            "INSERT OR IGNORE INTO tenant_moduli (tenant_slug, modulo_slug, attivo) VALUES (?,?,?)",
            params![tenant, slug, attivo],
        )?;
    }
    Ok(())
}

/// listTenantModuli: lista moduli del tenant con stato attivo/disattivo (filtrati i nascosti).
pub fn list_tenant_moduli(conn: &Connection, tenant: &str) -> rusqlite::Result<Vec<Value>> {
    ensure_tenant_moduli(conn, tenant)?;
    let mut stmt = conn.prepare(
        "SELECT m.slug, m.nome, m.descrizione, m.categoria, m.icona, m.core, m.default_attivo,
                m.ordine, tm.attivo, tm.updated_at
         FROM moduli m
         LEFT JOIN tenant_moduli tm ON tm.modulo_slug=m.slug AND tm.tenant_slug=?
         ORDER BY m.ordine, m.nome",
    )?;
    let rows = stmt
        .query_map(params![tenant], |r| {
            let slug: String = r.get(0)?;
            let core: i64 = r.get(5)?;
            let attivo: Option<i64> = r.get(8)?;
            Ok((
                slug.clone(),
                json!({
                    "slug": slug,
                    "nome": r.get::<_, String>(1)?,
                    "descrizione": r.get::<_, Option<String>>(2)?,
                    "categoria": r.get::<_, Option<String>>(3)?,
                    "icona": r.get::<_, Option<String>>(4)?,
                    "core": core == 1,
                    "defaultAttivo": r.get::<_, i64>(6)? == 1,
                    "attivo": core == 1 || attivo == Some(1),
                    "updatedAt": r.get::<_, Option<String>>(9)?,
                }),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|(slug, _)| !is_nascosto(slug))
        .map(|(_, v)| v)
        .collect())
}

/// setTenantModulo: attiva/disattiva un modulo. Err(msg) come throw new Error(...) di Node.
pub fn set_tenant_modulo(
    conn: &Connection,
    tenant: &str,
    slug: &str,
    attivo: bool,
) -> Result<Option<Value>, String> {
    let core: Option<i64> = conn
        .query_row("SELECT core FROM moduli WHERE slug=?", [slug], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let core = match core {
        Some(c) => c,
        None => return Err("Modulo inesistente".into()),
    };
    if core == 1 && !attivo {
        return Err("Modulo core: non disattivabile".into());
    }
    ensure_tenant_moduli(conn, tenant).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tenant_moduli SET attivo=?, updated_at=datetime('now') WHERE tenant_slug=? AND modulo_slug=?",
        params![if attivo { 1 } else { 0 }, tenant, slug],
    )
    .map_err(|e| e.to_string())?;
    let list = list_tenant_moduli(conn, tenant).map_err(|e| e.to_string())?;
    Ok(list.into_iter().find(|m| m.get("slug").and_then(Value::as_str) == Some(slug)))
}
