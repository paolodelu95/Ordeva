//! Doppio ruolo anagrafica (parità con utils/anagraficaGemello.js).
//! Un cliente può essere "anche fornitore" e viceversa: ogni entità resta nella sua
//! tabella (così le FK dei documenti restano integre) e si tiene in sync un record
//! gemello speculare nell'altra tabella sui campi condivisi.

use rusqlite::types::ToSql;
use rusqlite::{params, Connection, OptionalExtension, Row};

/// Campi presenti in entrambe le tabelle, copiati sul gemello a ogni salvataggio.
const SHARED: [&str; 12] = [
    "ragione_sociale",
    "email",
    "telefono",
    "cellulare",
    "via",
    "cap",
    "citta",
    "provincia",
    "stato",
    "p_iva",
    "sdi",
    "pec",
];

fn valid_piva(p: &str) -> bool {
    p.len() == 11 && p.bytes().all(|b| b.is_ascii_digit())
}

/// Legge i 12 campi condivisi (NULL → "") nell'ordine di SHARED.
fn read_shared(row: &Row) -> rusqlite::Result<Vec<String>> {
    (0..SHARED.len())
        .map(|i| Ok(row.get::<_, Option<String>>(i)?.unwrap_or_default()))
        .collect()
}

fn set_clause() -> String {
    SHARED
        .iter()
        .map(|k| format!("{k}=?"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Allinea il gemello FORNITORE dopo create/update di un CLIENTE.
pub fn applica_da_cliente(conn: &Connection, cliente_id: i64) -> rusqlite::Result<()> {
    let select = format!(
        "SELECT {}, anche_fornitore, fornitore_collegato_id FROM clienti WHERE id=?1",
        SHARED.join(", ")
    );
    let row = conn
        .query_row(&select, [cliente_id], |r| {
            Ok((
                read_shared(r)?,
                r.get::<_, Option<i64>>(12)?.unwrap_or(0),
                r.get::<_, Option<i64>>(13)?,
            ))
        })
        .optional()?;
    let (vals, anche, mut collegato) = match row {
        Some(x) => x,
        None => return Ok(()),
    };

    if anche != 0 {
        let piva = &vals[9];
        // Fornitore già collegato?
        let mut fid: Option<i64> = match collegato {
            Some(id) => conn
                .query_row("SELECT id FROM fornitori WHERE id=?1", [id], |r| r.get(0))
                .optional()?,
            None => None,
        };
        // Altrimenti riusa un fornitore libero con la stessa P.IVA.
        if fid.is_none() && valid_piva(piva) {
            fid = conn
                .query_row(
                    "SELECT id FROM fornitori WHERE (p_iva=?1 OR p_iva=?2) \
                     AND (cliente_collegato_id IS NULL OR cliente_collegato_id=?3) LIMIT 1",
                    params![piva, format!("IT{piva}"), cliente_id],
                    |r| r.get(0),
                )
                .optional()?;
            collegato = fid;
        }
        let _ = collegato;

        let fid = if let Some(fid) = fid {
            let sql = format!(
                "UPDATE fornitori SET {}, anche_cliente=1, cliente_collegato_id=? WHERE id=?",
                set_clause()
            );
            let mut p: Vec<&dyn ToSql> = vals.iter().map(|s| s as &dyn ToSql).collect();
            p.push(&cliente_id);
            p.push(&fid);
            conn.execute(&sql, p.as_slice())?;
            fid
        } else {
            let sql = format!(
                "INSERT INTO fornitori ({}, anche_cliente, cliente_collegato_id) VALUES ({}, 1, ?)",
                SHARED.join(", "),
                vec!["?"; SHARED.len()].join(", ")
            );
            let mut p: Vec<&dyn ToSql> = vals.iter().map(|s| s as &dyn ToSql).collect();
            p.push(&cliente_id);
            conn.execute(&sql, p.as_slice())?;
            conn.last_insert_rowid()
        };
        conn.execute(
            "UPDATE clienti SET fornitore_collegato_id=?1 WHERE id=?2",
            params![fid, cliente_id],
        )?;
    } else if let Some(fid) = collegato {
        conn.execute(
            "UPDATE fornitori SET anche_cliente=0, cliente_collegato_id=NULL WHERE id=?1",
            [fid],
        )?;
        conn.execute(
            "UPDATE clienti SET fornitore_collegato_id=NULL WHERE id=?1",
            [cliente_id],
        )?;
    }
    Ok(())
}

/// Allinea il gemello CLIENTE dopo create/update di un FORNITORE.
pub fn applica_da_fornitore(conn: &Connection, fornitore_id: i64) -> rusqlite::Result<()> {
    let select = format!(
        "SELECT {}, anche_cliente, cliente_collegato_id FROM fornitori WHERE id=?1",
        SHARED.join(", ")
    );
    let row = conn
        .query_row(&select, [fornitore_id], |r| {
            Ok((
                read_shared(r)?,
                r.get::<_, Option<i64>>(12)?.unwrap_or(0),
                r.get::<_, Option<i64>>(13)?,
            ))
        })
        .optional()?;
    let (vals, anche, mut collegato) = match row {
        Some(x) => x,
        None => return Ok(()),
    };

    if anche != 0 {
        let piva = &vals[9];
        let mut cid: Option<i64> = match collegato {
            Some(id) => conn
                .query_row("SELECT id FROM clienti WHERE id=?1", [id], |r| r.get(0))
                .optional()?,
            None => None,
        };
        if cid.is_none() && valid_piva(piva) {
            cid = conn
                .query_row(
                    "SELECT id FROM clienti WHERE (p_iva=?1 OR p_iva=?2) \
                     AND (fornitore_collegato_id IS NULL OR fornitore_collegato_id=?3) LIMIT 1",
                    params![piva, format!("IT{piva}"), fornitore_id],
                    |r| r.get(0),
                )
                .optional()?;
            collegato = cid;
        }
        let _ = collegato;

        let cid = if let Some(cid) = cid {
            let sql = format!(
                "UPDATE clienti SET {}, anche_fornitore=1, fornitore_collegato_id=? WHERE id=?",
                set_clause()
            );
            let mut p: Vec<&dyn ToSql> = vals.iter().map(|s| s as &dyn ToSql).collect();
            p.push(&fornitore_id);
            p.push(&cid);
            conn.execute(&sql, p.as_slice())?;
            cid
        } else {
            let sql = format!(
                "INSERT INTO clienti ({}, anche_fornitore, fornitore_collegato_id) VALUES ({}, 1, ?)",
                SHARED.join(", "),
                vec!["?"; SHARED.len()].join(", ")
            );
            let mut p: Vec<&dyn ToSql> = vals.iter().map(|s| s as &dyn ToSql).collect();
            p.push(&fornitore_id);
            conn.execute(&sql, p.as_slice())?;
            conn.last_insert_rowid()
        };
        conn.execute(
            "UPDATE fornitori SET cliente_collegato_id=?1 WHERE id=?2",
            params![cid, fornitore_id],
        )?;
    } else if let Some(cid) = collegato {
        conn.execute(
            "UPDATE clienti SET anche_fornitore=0, fornitore_collegato_id=NULL WHERE id=?1",
            [cid],
        )?;
        conn.execute(
            "UPDATE fornitori SET cliente_collegato_id=NULL WHERE id=?1",
            [fornitore_id],
        )?;
    }
    Ok(())
}

/// Prima di eliminare un cliente: stacca l'eventuale gemello fornitore.
pub fn scollega_cliente(conn: &Connection, cliente_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE fornitori SET anche_cliente=0, cliente_collegato_id=NULL WHERE cliente_collegato_id=?1",
        [cliente_id],
    )?;
    Ok(())
}

/// Prima di eliminare un fornitore: stacca l'eventuale gemello cliente.
pub fn scollega_fornitore(conn: &Connection, fornitore_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE clienti SET anche_fornitore=0, fornitore_collegato_id=NULL WHERE fornitore_collegato_id=?1",
        [fornitore_id],
    )?;
    Ok(())
}

/// normalizePiva: tiene solo lettere e cifre, uppercase, scarta il prefisso "IT".
/// Toglie anche punteggiatura (. - /) che spesso arriva da copia-incolla, non solo
/// spazi: altrimenti una P.IVA formattata come "12.345.678.901" non veniva mai
/// riconosciuta come gli stessi 11 numeri già salvati puliti.
pub fn normalize_piva(piva: &str) -> String {
    let v: String = piva.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_uppercase();
    v.strip_prefix("IT").map(|s| s.to_string()).unwrap_or(v)
}
