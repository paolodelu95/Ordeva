//! Auto-migrazione idempotente delle colonne.
//!
//! `CREATE TABLE IF NOT EXISTS` crea le tabelle mancanti ma NON aggiunge le
//! colonne mancanti a tabelle già esistenti: un DB creato da una versione
//! precedente, dopo un aggiornamento che ha aggiunto colonne allo schema, non le
//! riceve → le query che le usano falliscono (lista che "non si apre"). Finora si
//! risolveva solo cancellando i dati.
//!
//! Qui derivo le colonne attese DALLO SCHEMA SQL (la stessa sorgente usata per
//! creare le tabelle) e aggiungo con `ALTER TABLE … ADD COLUMN` quelle assenti.
//! È self-healing: basta modificare i file .sql, nessuna lista di migrazioni da
//! mantenere. Ogni ALTER è best-effort (warn su errore, mai panico): `ALTER ADD
//! COLUMN` è non distruttivo, quindi al massimo una colonna non viene migrata.

use std::collections::HashSet;

use rusqlite::Connection;

/// Aggiunge alle tabelle esistenti le colonne presenti nello schema ma assenti
/// nel DB. Idempotente: le colonne già presenti vengono saltate.
pub fn add_missing_columns(conn: &Connection, schema_sql: &str) {
    for (table, columns) in parse_schema_columns(schema_sql) {
        let existing = match existing_columns(conn, &table) {
            Ok(set) => set,
            Err(_) => continue,
        };
        // Tabella non ancora creata (0 colonne): la crea CREATE TABLE, niente da migrare.
        if existing.is_empty() {
            continue;
        }
        for (name, definition) in columns {
            if existing.contains(&name.to_ascii_lowercase()) {
                continue;
            }
            let sql = format!("ALTER TABLE \"{table}\" ADD COLUMN {definition}");
            if let Err(e) = conn.execute(&sql, []) {
                tracing::warn!("auto-migrazione colonna {table}.{name} non applicata: {e}");
            } else {
                tracing::info!("auto-migrazione: aggiunta colonna {table}.{name}");
            }
        }
    }
}

/// Amplia un vincolo CHECK esistente ricreando la tabella: SQLite non supporta
/// `ALTER TABLE` per modificare un CHECK, solo `ADD COLUMN` (vedi doc di modulo).
/// Idempotente e sicura sui dati: legge il testo del CREATE TABLE già salvato in
/// `sqlite_master` e non fa nulla se contiene già `valore_atteso` (già migrata)
/// o se la tabella non esiste ancora (la creerà già giusta il normale `CREATE
/// TABLE IF NOT EXISTS` dello schema). Altrimenti rinomina→ricrea→ricopia→elimina
/// in un'unica transazione (rollback automatico su qualunque errore).
///
/// `create_sql_nuovo` è il CREATE TABLE completo con lo schema aggiornato
/// (stesse colonne, nello stesso ordine — la copia usa `SELECT *`);
/// `indici_sql` sono gli eventuali `CREATE INDEX` da rifare dopo (la
/// rinomina→creazione perde gli indici della tabella precedente).
///
/// `PRAGMA foreign_keys` va spento PRIMA di aprire la transazione (SQLite lo
/// ignora silenziosamente se cambiato a transazione già aperta): serve per le
/// tabelle referenziate da una FOREIGN KEY di un'altra tabella (es.
/// `vendite_banco`, referenziata da `vendite_banco_righe`), così la
/// rinomina/ricreazione non intacca le righe figlie già esistenti.
pub fn amplia_check_canale(conn: &Connection, tabella: &str, valore_atteso: &str, create_sql_nuovo: &str, indici_sql: &[&str]) {
    let sql_attuale: Option<String> = conn
        .query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1", [tabella], |r| r.get(0))
        .ok()
        .flatten();
    let Some(sql_attuale) = sql_attuale else { return };
    if sql_attuale.contains(valore_atteso) {
        return;
    }

    let _ = conn.execute_batch("PRAGMA foreign_keys = OFF;");
    let esito = (|| -> rusqlite::Result<()> {
        let tx = conn.unchecked_transaction()?;
        let tmp = format!("{tabella}__old_migrazione");
        tx.execute(&format!("ALTER TABLE \"{tabella}\" RENAME TO \"{tmp}\""), [])?;
        tx.execute_batch(create_sql_nuovo)?;
        tx.execute(&format!("INSERT INTO \"{tabella}\" SELECT * FROM \"{tmp}\""), [])?;
        tx.execute(&format!("DROP TABLE \"{tmp}\""), [])?;
        for idx_sql in indici_sql {
            tx.execute_batch(idx_sql)?;
        }
        tx.commit()
    })();
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");

    match esito {
        Ok(()) => tracing::info!("auto-migrazione: ampliato vincolo CHECK di {tabella} (ora include {valore_atteso})"),
        Err(e) => tracing::warn!("auto-migrazione CHECK {tabella} non applicata: {e}"),
    }
}

/// Migrazione "prodotto senza nome": in catalogo l'articolo è ora identificato
/// dal `codice` (obbligatorio) più la `descrizione`, e la vecchia colonna
/// `prodotti.nome` sparisce. Prima di eliminarla ne travasa il contenuto dove
/// servirebbe — nel `codice` se vuoto (era l'unico identificativo del prodotto)
/// e nella `descrizione` se vuota — così nessun dato scritto dall'utente si perde.
///
/// Rinomina anche lo snapshot storico `movimenti_magazzino.prodotto_nome` in
/// `prodotto_codice`. Va eseguita PRIMA di `add_missing_columns`: altrimenti
/// quella aggiungerebbe una `prodotto_codice` vuota accanto alla vecchia colonna,
/// e i movimenti dei prodotti nel frattempo eliminati resterebbero senza etichetta.
///
/// Idempotente e best-effort come il resto del modulo: su errore logga un warn e
/// lascia il DB utilizzabile (al massimo con una colonna in più).
pub fn prodotti_senza_nome(conn: &Connection) {
    if let Ok(cols) = existing_columns(conn, "movimenti_magazzino") {
        if cols.contains("prodotto_nome") && !cols.contains("prodotto_codice") {
            match conn.execute("ALTER TABLE movimenti_magazzino RENAME COLUMN prodotto_nome TO prodotto_codice", []) {
                Ok(_) => tracing::info!("auto-migrazione: movimenti_magazzino.prodotto_nome → prodotto_codice"),
                Err(e) => tracing::warn!("auto-migrazione movimenti_magazzino.prodotto_codice non applicata: {e}"),
            }
        }
    }

    let Ok(cols) = existing_columns(conn, "prodotti") else { return };
    if !cols.contains("nome") {
        return;
    }
    // Il travaso deve riuscire per intero: se fallisce tengo la colonna (e i dati).
    let travaso = conn.execute_batch(
        "UPDATE prodotti SET codice = TRIM(nome) \
          WHERE TRIM(COALESCE(codice,'')) = '' AND TRIM(COALESCE(nome,'')) <> '';
         UPDATE prodotti SET descrizione = TRIM(nome) \
          WHERE TRIM(COALESCE(descrizione,'')) = '' AND TRIM(COALESCE(nome,'')) <> '' \
            AND TRIM(nome) <> TRIM(COALESCE(codice,''));",
    );
    if let Err(e) = travaso {
        tracing::warn!("auto-migrazione prodotti.nome: travaso non riuscito, colonna mantenuta: {e}");
        return;
    }
    match conn.execute("ALTER TABLE prodotti DROP COLUMN nome", []) {
        Ok(_) => tracing::info!("auto-migrazione: rimossa colonna prodotti.nome (travasata in codice/descrizione)"),
        Err(e) => tracing::warn!("auto-migrazione: prodotti.nome non eliminata: {e}"),
    }
}

/// Rende univoco `prodotti.codice` e lo protegge con un indice UNIQUE. Il codice
/// è l'unico identificativo dell'articolo: due prodotti con lo stesso codice si
/// confonderebbero in ogni ricerca, riga di documento e import listino.
///
/// Prima di poter creare l'indice va sistemato quello che c'è: un DB che arriva
/// dalla versione col "nome" può avere codici vuoti (articoli senza né nome né
/// codice) e codici ripetuti (due articoli omonimi diventati lo stesso codice nel
/// travaso). Ai vuoti assegno `ART-<id>`, ai ripetuti aggiungo `-2`, `-3`… tenendo
/// intatto il più vecchio: nessuna riga viene persa e i collegamenti per id
/// (documenti, giacenze, movimenti) restano validi.
///
/// L'indice vive qui e non in `tenant.sql` per una ragione di ordine: lo schema
/// viene eseguito per primo e in blocco, e un `CREATE UNIQUE INDEX` su una
/// tabella con duplicati farebbe fallire l'apertura dell'archivio.
///
/// Idempotente: alla seconda passata non trova né vuoti né duplicati e l'indice
/// c'è già. Best-effort: se qualcosa non va resta il controllo lato API.
pub fn prodotti_codice_unico(conn: &Connection) {
    let Ok(cols) = existing_columns(conn, "prodotti") else { return };
    if !cols.contains("codice") {
        return;
    }

    match conn.execute("UPDATE prodotti SET codice = 'ART-' || id WHERE TRIM(COALESCE(codice, '')) = ''", []) {
        Ok(n) if n > 0 => tracing::info!("auto-migrazione: assegnato un codice a {n} prodotti che ne erano privi"),
        Ok(_) => {}
        Err(e) => {
            tracing::warn!("auto-migrazione codice prodotto: riempimento dei vuoti non riuscito: {e}");
            return;
        }
    }

    // Doppioni = righe che ripetono un codice già usato da una riga più vecchia:
    // quella vince, le altre si rinumerano una per una (il codice libero va
    // ricalcolato a ogni giro, perché quello appena assegnato occupa il posto).
    let leggi_duplicati = || -> rusqlite::Result<Vec<(i64, String)>> {
        let mut stmt = conn.prepare(
            "SELECT p.id, p.codice FROM prodotti p \
             WHERE EXISTS (SELECT 1 FROM prodotti q \
                           WHERE q.id < p.id AND TRIM(q.codice) = TRIM(p.codice) COLLATE NOCASE) \
             ORDER BY p.id",
        )?;
        let righe = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default()))
        })?;
        righe.collect()
    };
    let duplicati = match leggi_duplicati() {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("auto-migrazione codice prodotto: lettura dei duplicati non riuscita: {e}");
            return;
        }
    };
    for (id, codice) in &duplicati {
        let nuovo = crate::web::codice_prodotto_libero(conn, codice);
        if let Err(e) = conn.execute("UPDATE prodotti SET codice = ?1 WHERE id = ?2", rusqlite::params![nuovo, id]) {
            tracing::warn!("auto-migrazione codice prodotto: '{codice}' (id {id}) non rinumerato: {e}");
            return;
        }
        tracing::info!("auto-migrazione: codice duplicato '{codice}' (id {id}) rinominato in '{nuovo}'");
    }

    if let Err(e) = conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_prodotti_codice ON prodotti(codice COLLATE NOCASE);",
    ) {
        tracing::warn!("auto-migrazione: indice UNIQUE su prodotti.codice non creato: {e}");
    }
}

/// Colonne attualmente presenti nella tabella (minuscolo). Set vuoto se la
/// tabella non esiste (PRAGMA table_info non dà errore, ritorna 0 righe).
fn existing_columns(conn: &Connection, table: &str) -> rusqlite::Result<HashSet<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(1))?; // colonna 1 = name
    let mut set = HashSet::new();
    for r in rows {
        set.insert(r?.to_ascii_lowercase());
    }
    Ok(set)
}

/// Estrae da uno schema SQL la lista (tabella, [(nome_colonna, definizione)]).
/// Salta i vincoli a livello di tabella (PRIMARY/FOREIGN KEY, UNIQUE, CHECK…).
fn parse_schema_columns(sql: &str) -> Vec<(String, Vec<(String, String)>)> {
    let cleaned = strip_line_comments(sql);
    let lower = cleaned.to_ascii_lowercase();
    let bytes = cleaned.as_bytes();
    let mut out = Vec::new();
    let mut from = 0usize;

    while let Some(rel) = lower[from..].find("create table") {
        let start = from + rel;
        let after = start + "create table".len();
        // Prima parentesi aperta = inizio corpo; il nome è l'ultimo token prima.
        let Some(paren_rel) = cleaned[after..].find('(') else { break };
        let header = &cleaned[after..after + paren_rel];
        let name = header
            .split_whitespace()
            .last()
            .unwrap_or("")
            .trim_matches(|c| c == '"' || c == '`')
            .to_string();

        // Scansione del corpo bilanciando le parentesi e ignorando le stringhe.
        let body_start = after + paren_rel + 1;
        let mut depth = 1i32;
        let mut quote: Option<u8> = None;
        let mut i = body_start;
        while i < bytes.len() && depth > 0 {
            let c = bytes[i];
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                }
            } else {
                match c {
                    b'\'' | b'"' => quote = Some(c),
                    b'(' => depth += 1,
                    b')' => depth -= 1,
                    _ => {}
                }
            }
            i += 1;
        }
        let body = &cleaned[body_start..i.saturating_sub(1)];

        let mut cols = Vec::new();
        for item in split_top_level(body) {
            if let Some(col) = column_from_item(&item) {
                cols.push(col);
            }
        }
        if !name.is_empty() && !cols.is_empty() {
            out.push((name, cols));
        }
        from = i;
    }
    out
}

/// Divide il corpo di un CREATE TABLE sulle virgole di livello 0 (fuori da
/// parentesi e da stringhe).
fn split_top_level(body: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut cur = String::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;

    for c in body.chars() {
        if let Some(q) = quote {
            cur.push(c);
            if c == q {
                quote = None;
            }
            continue;
        }
        match c {
            '\'' | '"' => {
                quote = Some(c);
                cur.push(c);
            }
            '(' => {
                depth += 1;
                cur.push(c);
            }
            ')' => {
                depth -= 1;
                cur.push(c);
            }
            ',' if depth == 0 => {
                let t = cur.trim();
                if !t.is_empty() {
                    items.push(t.to_string());
                }
                cur.clear();
            }
            _ => cur.push(c),
        }
    }
    let t = cur.trim();
    if !t.is_empty() {
        items.push(t.to_string());
    }
    items
}

/// Da un elemento del corpo ritorna (nome, definizione) se è una colonna, oppure
/// None se è un vincolo a livello di tabella.
fn column_from_item(item: &str) -> Option<(String, String)> {
    let first = item.split_whitespace().next()?;
    let kw = first.to_ascii_uppercase();
    // Vincoli a livello tabella: non sono colonne.
    if matches!(
        kw.as_str(),
        "PRIMARY" | "FOREIGN" | "UNIQUE" | "CHECK" | "CONSTRAINT" | "KEY"
    ) {
        return None;
    }
    let name = first.trim_matches(|c| c == '"' || c == '`').to_string();
    Some((name, item.to_string()))
}

/// Rimuove i commenti di riga `-- …` (rispettando le stringhe) per non confondere
/// il parsing. I commenti a blocco non sono usati negli schemi.
fn strip_line_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    for line in sql.lines() {
        let bytes = line.as_bytes();
        let mut quote: Option<u8> = None;
        let mut cut = line.len();
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i];
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                }
            } else {
                match c {
                    b'\'' | b'"' => quote = Some(c),
                    b'-' if i + 1 < bytes.len() && bytes[i + 1] == b'-' => {
                        cut = i;
                        break;
                    }
                    _ => {}
                }
            }
            i += 1;
        }
        out.push_str(&line[..cut]);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le colonne nuove finiscono in coda alla riga "piatta" del CREATE TABLE
    /// (`…, provvigione REAL, nascosto INTEGER DEFAULT 0);`): è la forma che
    /// prende lo schema quando una colonna viene aggiunta, ed è quella che deve
    /// arrivare agli archivi già esistenti — altrimenti le liste smettono di
    /// aprirsi dopo l'aggiornamento.
    #[test]
    fn migra_le_colonne_aggiunte_in_coda_allo_schema_reale() {
        let conn = Connection::open_in_memory().unwrap();
        // Archivio "vecchio": clienti e fornitori senza `nascosto`, righe nota
        // di credito senza `scarica_magazzino`.
        conn.execute_batch(
            "CREATE TABLE clienti (id INTEGER PRIMARY KEY, ragione_sociale TEXT NOT NULL);
             CREATE TABLE fornitori (id INTEGER PRIMARY KEY, ragione_sociale TEXT NOT NULL);
             CREATE TABLE note_credito_righe (id INTEGER PRIMARY KEY, nota_credito_id INTEGER NOT NULL);",
        )
        .unwrap();
        add_missing_columns(&conn, include_str!("schema/tenant.sql"));
        for (tabella, colonna) in [
            ("clienti", "nascosto"),
            ("fornitori", "nascosto"),
            ("note_credito_righe", "scarica_magazzino"),
        ] {
            assert!(
                existing_columns(&conn, tabella).unwrap().contains(colonna),
                "{tabella}.{colonna} non migrata"
            );
        }
    }

    #[test]
    fn aggiunge_colonne_mancanti_anche_con_references_e_salta_vincoli() {
        let conn = Connection::open_in_memory().unwrap();
        // Tabelle "vecchie": clienti senza le colonne aggiunte in seguito.
        conn.execute_batch(
            "CREATE TABLE listini (id INTEGER PRIMARY KEY);
             CREATE TABLE clienti (id INTEGER PRIMARY KEY, ragione_sociale TEXT NOT NULL);",
        )
        .unwrap();

        // Schema "nuovo": colonne aggiuntive (una con REFERENCES) + un vincolo a
        // livello tabella che NON deve essere trattato come colonna.
        let schema = r#"
            CREATE TABLE IF NOT EXISTS clienti (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ragione_sociale TEXT NOT NULL,
              email TEXT DEFAULT '', sdi TEXT DEFAULT "", note TEXT DEFAULT 'a, b (c)',
              listino_id INTEGER REFERENCES listini(id),
              FOREIGN KEY (listino_id) REFERENCES listini(id)
            );
        "#;

        add_missing_columns(&conn, schema);
        let cols = existing_columns(&conn, "clienti").unwrap();
        assert!(cols.contains("email"));
        assert!(cols.contains("sdi"));
        assert!(cols.contains("note"));
        assert!(cols.contains("listino_id"));
        // Il vincolo FOREIGN KEY non è una colonna chiamata "foreign".
        assert!(!cols.contains("foreign"));
    }

    #[test]
    fn idempotente_e_ignora_tabella_inesistente() {
        let conn = Connection::open_in_memory().unwrap();
        let schema = "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, a TEXT DEFAULT '');";

        // Tabella non ancora creata: nessun crash, nessuna aggiunta.
        add_missing_columns(&conn, schema);
        assert!(existing_columns(&conn, "t").unwrap().is_empty());

        // Creata senza "a": due passaggi consecutivi non devono dare errore.
        conn.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY);").unwrap();
        add_missing_columns(&conn, schema);
        add_missing_columns(&conn, schema);
        assert!(existing_columns(&conn, "t").unwrap().contains("a"));
    }

    #[test]
    fn amplia_check_canale_ricrea_tabella_preservando_dati_e_fk() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // Schema "vecchio": vendite_banco senza SHOPIFY nel CHECK, più una
        // tabella figlia con FOREIGN KEY su di essa (come vendite_banco_righe).
        conn.execute_batch(
            "CREATE TABLE vendite_banco (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                numero TEXT NOT NULL,
                canale TEXT DEFAULT 'BANCO' CHECK(canale IN ('BANCO','EBAY','AMAZON'))
             );
             CREATE UNIQUE INDEX idx_vendite_banco_numero ON vendite_banco(numero);
             CREATE TABLE vendite_banco_righe (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vendita_id INTEGER NOT NULL,
                FOREIGN KEY (vendita_id) REFERENCES vendite_banco(id) ON DELETE CASCADE
             );
             INSERT INTO vendite_banco (id, numero, canale) VALUES (1, 'V-0001', 'EBAY');
             INSERT INTO vendite_banco_righe (id, vendita_id) VALUES (1, 1);",
        )
        .unwrap();

        let nuovo = "CREATE TABLE vendite_banco (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero TEXT NOT NULL,
            canale TEXT DEFAULT 'BANCO' CHECK(canale IN ('BANCO','EBAY','AMAZON','SHOPIFY'))
        );";
        amplia_check_canale(&conn, "vendite_banco", "SHOPIFY", nuovo, &["CREATE UNIQUE INDEX idx_vendite_banco_numero ON vendite_banco(numero);"]);

        // Il nuovo vincolo accetta SHOPIFY.
        conn.execute("INSERT INTO vendite_banco (id, numero, canale) VALUES (2, 'V-0002', 'SHOPIFY')", []).unwrap();
        // La riga vecchia è ancora lì, invariata.
        let numero: String = conn.query_row("SELECT numero FROM vendite_banco WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(numero, "V-0001");
        // La riga figlia (FK) non è stata toccata/cascata dalla ricreazione.
        let righe_figlie: i64 = conn.query_row("SELECT COUNT(*) FROM vendite_banco_righe", [], |r| r.get(0)).unwrap();
        assert_eq!(righe_figlie, 1);
        // L'indice UNIQUE è stato ricreato: un numero duplicato deve fallire.
        assert!(conn.execute("INSERT INTO vendite_banco (numero, canale) VALUES ('V-0001', 'BANCO')", []).is_err());
        // Idempotente: una seconda chiamata non fa nulla (il CHECK contiene già SHOPIFY).
        amplia_check_canale(&conn, "vendite_banco", "SHOPIFY", nuovo, &["CREATE UNIQUE INDEX idx_vendite_banco_numero ON vendite_banco(numero);"]);
    }

    #[test]
    fn estrae_colonne_dallo_schema_tenant_reale() {
        let schema = include_str!("schema/tenant.sql");
        let tables = parse_schema_columns(schema);
        let clienti = tables.iter().find(|(t, _)| t == "clienti").expect("tabella clienti");
        let names: Vec<&str> = clienti.1.iter().map(|(n, _)| n.as_str()).collect();
        // Colonne base + aggiunte in seguito devono comparire tutte.
        assert!(names.contains(&"ragione_sociale"));
        assert!(names.contains(&"sdi"));
        assert!(names.contains(&"pec"));
        assert!(names.contains(&"listino_id"));
        // Nessun vincolo a livello tabella scambiato per colonna.
        assert!(!names.iter().any(|n| n.eq_ignore_ascii_case("foreign")));
    }

    #[test]
    fn prodotti_senza_nome_travasa_e_rimuove_la_colonna() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE prodotti (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               nome TEXT NOT NULL,
               descrizione TEXT DEFAULT '',
               codice TEXT DEFAULT ''
             );
             CREATE TABLE movimenti_magazzino (id INTEGER PRIMARY KEY, prodotto_nome TEXT DEFAULT '');
             -- senza codice: il nome diventa il codice, la descrizione resta vuota
             INSERT INTO prodotti (id, nome, descrizione, codice) VALUES (1, 'Vite M6', '', '');
             -- con codice: il nome finisce nella descrizione vuota
             INSERT INTO prodotti (id, nome, descrizione, codice) VALUES (2, 'Dado M6', '', 'DAD-6');
             -- descrizione già scritta: non va sovrascritta
             INSERT INTO prodotti (id, nome, descrizione, codice) VALUES (3, 'Rondella', 'Rondella zincata', 'RON-1');
             INSERT INTO movimenti_magazzino (id, prodotto_nome) VALUES (1, 'Vite M6');",
        )
        .unwrap();

        prodotti_senza_nome(&conn);

        assert!(!existing_columns(&conn, "prodotti").unwrap().contains("nome"));
        let leggi = |id: i64| -> (String, String) {
            conn.query_row("SELECT codice, descrizione FROM prodotti WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
        };
        assert_eq!(leggi(1), ("Vite M6".to_string(), String::new()));
        assert_eq!(leggi(2), ("DAD-6".to_string(), "Dado M6".to_string()));
        assert_eq!(leggi(3), ("RON-1".to_string(), "Rondella zincata".to_string()));

        // Lo snapshot storico è rinominato conservando i valori.
        let snapshot: String = conn
            .query_row("SELECT prodotto_codice FROM movimenti_magazzino WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(snapshot, "Vite M6");

        // Idempotente: una seconda passata non fa nulla e non esplode.
        prodotti_senza_nome(&conn);
        assert_eq!(leggi(2), ("DAD-6".to_string(), "Dado M6".to_string()));
    }

    #[test]
    fn prodotti_codice_unico_ripulisce_vuoti_e_doppioni() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE prodotti (id INTEGER PRIMARY KEY AUTOINCREMENT, codice TEXT DEFAULT '');
             INSERT INTO prodotti (id, codice) VALUES (1, 'VITE-M6');
             INSERT INTO prodotti (id, codice) VALUES (2, 'VITE-M6');   -- doppione esatto
             INSERT INTO prodotti (id, codice) VALUES (3, 'vite-m6');   -- doppione di maiuscole
             INSERT INTO prodotti (id, codice) VALUES (4, 'VITE-M6-2'); -- il suffisso -2 è già preso
             INSERT INTO prodotti (id, codice) VALUES (5, '   ');       -- senza codice",
        )
        .unwrap();

        prodotti_codice_unico(&conn);

        let codice = |id: i64| -> String {
            conn.query_row("SELECT codice FROM prodotti WHERE id=?1", [id], |r| r.get(0)).unwrap()
        };
        // Il più vecchio si tiene il codice, gli altri scalano saltando i posti occupati.
        assert_eq!(codice(1), "VITE-M6");
        assert_eq!(codice(4), "VITE-M6-2");
        assert_eq!(codice(2), "VITE-M6-3");
        assert_eq!(codice(3), "vite-m6-4"); // conserva le sue maiuscole/minuscole
        assert_eq!(codice(5), "ART-5");

        // L'indice UNIQUE è in piedi: un codice ripetuto (anche solo di maiuscole) non entra.
        assert!(conn.execute("INSERT INTO prodotti (codice) VALUES ('vite-m6')", []).is_err());

        // Idempotente: senza duplicati non tocca nulla.
        prodotti_codice_unico(&conn);
        assert_eq!(codice(2), "VITE-M6-3");
    }
}
