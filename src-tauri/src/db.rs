//! Gestione connessioni SQLite (parità con utils/tenantDb.js + utils/authDb.js).
//!
//! **Edizione offline: un solo file `ordeva.db`.** Storicamente il modello era
//! multi-tenant (un `auth.db` globale + un file `tenants/<slug>.db` per tenant), retaggio
//! dell'edizione cloud. Offline c'è un solo tenant ("default") e un solo utente ("local"),
//! quindi i dati vivono tutti in un unico file `ordeva.db`: lo aprono DUE connessioni
//! distinte (una per lo schema "auth", una per lo schema "tenant") con mutex separati —
//! così il codice delle route (with_auth / with_tenant) resta identico e non ci sono
//! deadlock. I due schemi non hanno collisioni di nomi tabella. La migrazione dal vecchio
//! formato a due file è in `flatten_to_single_file`.
//! Lo schema è quello canonico estratto dal backend Node (src/schema/*.sql), reso
//! idempotente con IF NOT EXISTS.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Tenant unico in edizione offline.
pub const DEFAULT_TENANT: &str = "default";

/// Nome del file unico che contiene tutti i dati (schema auth + schema tenant).
pub const DB_FILE: &str = "ordeva.db";

const AUTH_SCHEMA: &str = include_str!("schema/auth.sql");
const TENANT_SCHEMA: &str = include_str!("schema/tenant.sql");
/// Dati preset (aliquote IVA, unità, tipi pagamento, conti, causali, crm stage,
/// magazzino e azienda di default) applicati solo su tenant nuovo.
const TENANT_SEED: &str = include_str!("schema/seed.sql");

/// Stato condiviso dell'app: cartella dati + connessioni cache.
#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
    /// Percorso del file di config (`ordeva.json`) per persistere la cartella dati scelta.
    pub config_path: PathBuf,
    auth: Arc<Mutex<Connection>>,
    tenants: Arc<Mutex<HashMap<String, Arc<Mutex<Connection>>>>>,
    /// Chiave AES-256 dei backup, derivata dalla password d'accesso (scrypt) e
    /// tenuta SOLO in memoria (parità con utils/appSession.js). None = bloccata.
    pub backup_key: Arc<Mutex<Option<[u8; 32]>>>,
    /// Sessione rilevata su un ALTRO computer all'avvio (avviso uso Dropbox). None = ok.
    pub other_session: Arc<Mutex<Option<crate::lock::LockInfo>>>,
    /// Password per la cifratura a riposo, tenuta in memoria dopo lo sblocco/abilitazione
    /// per poter ricifrare alla chiusura. None = cifratura non attiva o non sbloccata.
    pub atrest_password: Arc<Mutex<Option<String>>>,
    /// Chiave AES-256 del portachiavi, derivata dalla sua master password (scrypt,
    /// indipendente da `backup_key`) e tenuta SOLO in memoria. None = bloccato.
    pub keychain_key: Arc<Mutex<Option<[u8; 32]>>>,
    /// Istante d'avvio di questa sessione (per il campo started_at del lock).
    started_at: i64,
}

impl AppState {
    /// Inizializza la cartella, apre il file unico `ordeva.db` (schema auth), applica gli
    /// schemi e fa il bootstrap del tenant/utente offline. Idempotente.
    pub fn init(data_dir: PathBuf, config_path: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)
            .with_context(|| format!("creazione cartella dati {:?}", data_dir))?;

        // Lock di sessione: rileva una sessione viva su un altro computer (Dropbox) PRIMA
        // di sovrascrivere il lock con il nostro.
        let other_session = crate::lock::read(&data_dir).filter(crate::lock::is_conflict);
        let started_at = crate::lock::current_time();
        crate::lock::write(&data_dir, &crate::lock::self_info(started_at));

        let auth_conn = open_db(&data_dir.join(DB_FILE))?;
        auth_conn
            .execute_batch(AUTH_SCHEMA)
            .context("init schema auth")?;
        // Auto-migrazione: aggiunge le colonne dello schema mancanti in DB vecchi.
        crate::migrate::add_missing_columns(&auth_conn, AUTH_SCHEMA);

        let state = AppState {
            data_dir,
            config_path,
            auth: Arc::new(Mutex::new(auth_conn)),
            tenants: Arc::new(Mutex::new(HashMap::new())),
            backup_key: Arc::new(Mutex::new(None)),
            other_session: Arc::new(Mutex::new(other_session)),
            atrest_password: Arc::new(Mutex::new(None)),
            keychain_key: Arc::new(Mutex::new(None)),
            started_at,
        };

        state.bootstrap_offline()?;
        // Materializza subito il tenant default (apre + applica schema tenant).
        let _ = state.tenant_conn(DEFAULT_TENANT)?;
        Ok(state)
    }

    /// Checkpoint WAL (TRUNCATE) su tutte le connessioni: integra il `-wal` nel file
    /// `.db` principale e lo azzera. Così, sotto cloud-sync (Dropbox), si sincronizza un
    /// singolo file consistente invece di `.db` + `-wal` disallineati.
    pub fn flush(&self) {
        if let Ok(c) = self.auth.lock() {
            let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        if let Ok(cache) = self.tenants.lock() {
            for conn in cache.values() {
                if let Ok(c) = conn.lock() {
                    let _ = c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                }
            }
        }
    }

    /// Rilascia il lock di sessione (uscita pulita).
    pub fn release_lock(&self) {
        crate::lock::remove(&self.data_dir);
    }

    /// Chiude tutte le connessioni sul file (auth + tenant), sostituendo la auth con una
    /// in-memory usa-e-getta. Serve a rilasciare `ordeva.db` prima di rimuoverlo quando si
    /// sigilla la cifratura a riposo alla chiusura (su Windows non si cancella un file con
    /// handle aperti).
    pub fn close_all(&self) {
        if let Ok(mut g) = self.auth.lock() {
            if let Ok(c) = Connection::open_in_memory() {
                *g = c;
            }
        }
        if let Ok(mut cache) = self.tenants.lock() {
            cache.clear();
        }
    }

    /// Avvia il thread di heartbeat: aggiorna `ordeva.lock` ogni 30s finché l'app vive.
    pub fn spawn_heartbeat(&self) {
        let data_dir = self.data_dir.clone();
        let started_at = self.started_at;
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            crate::lock::write(&data_dir, &crate::lock::self_info(started_at));
        });
    }

    /// Sposta i dati nella nuova cartella (es. dentro Dropbox) e persiste la scelta in
    /// config. Fa prima un checkpoint per copiare uno stato consistente. NON applica il
    /// cambio in-place: serve un riavvio dell'app (gestito dal frontend).
    pub fn set_data_dir(&self, new_dir: &Path) -> Result<()> {
        if new_dir == self.data_dir {
            return Ok(());
        }
        if new_dir.starts_with(&self.data_dir) {
            anyhow::bail!("la nuova cartella non può essere dentro quella attuale");
        }
        self.flush();
        crate::config::copy_dir_all(&self.data_dir, new_dir)
            .with_context(|| format!("copia dati in {:?}", new_dir))?;
        crate::config::write_readme(new_dir);
        crate::config::save_data_dir(&self.config_path, Some(new_dir))?;
        Ok(())
    }

    /// Ri-applica il bootstrap offline (tenant/utente/moduli) dopo un ripristino, così
    /// anche i backup vecchi (che contenevano solo le tabelle del tenant) tornano usabili
    /// con i moduli abilitati. Idempotente (INSERT OR IGNORE + seed).
    pub fn ensure_offline_bootstrap(&self) {
        if let Err(e) = self.bootstrap_offline() {
            tracing::warn!("re-bootstrap offline dopo restore: {e:#}");
        }
    }

    /// Chiude le connessioni sul file unico (auth + tenant default), esegue `f` — che
    /// sovrascrive fisicamente `ordeva.db` (ripristino) — e RIAPRE la connessione auth.
    /// Necessario perché, con un solo file, sovrascriverlo mentre una connessione SQLite
    /// è aperta corromperebbe il database. Tiene il lock auth per tutta l'operazione.
    pub fn with_dbs_closed<R>(&self, f: impl FnOnce() -> Result<R>) -> Result<R> {
        let mut guard = self.auth.lock().unwrap();
        // Rilascia il file: sostituisce temporaneamente la connessione reale con una
        // in-memory, così il vecchio handle su ordeva.db viene chiuso.
        *guard = Connection::open_in_memory().context("conn temporanea in-memory")?;
        // Anche il tenant default deve essere chiuso prima di toccare il file.
        self.tenants.lock().unwrap().remove(DEFAULT_TENANT);

        let res = f();

        // Riapre comunque la connessione auth sul file (anche se f è fallita).
        let conn = open_db(&self.data_dir.join(DB_FILE))?;
        conn.execute_batch(AUTH_SCHEMA).ok();
        crate::migrate::add_missing_columns(&conn, AUTH_SCHEMA);
        *guard = conn;
        res
    }

    /// Crea (se assenti) il tenant "default" e l'utente "local" OWNER, come fa
    /// il bootstrap di server.js in OFFLINE_MODE.
    fn bootstrap_offline(&self) -> Result<()> {
        let auth = self.auth.lock().unwrap();
        auth.execute(
            "INSERT OR IGNORE INTO tenants (slug, nome, attivo, stato, piano) \
             VALUES (?1, 'Default', 1, 'attiva', 'pro')",
            [DEFAULT_TENANT],
        )?;
        auth.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, nome, ruolo, tenant_slug, attivo) \
             VALUES ('local', 'offline', 'Utente locale', 'OWNER', ?1, 1)",
            [DEFAULT_TENANT],
        )?;
        // Catalogo moduli + righe tenant_moduli per il tenant default (come seedModuli +
        // ensureTenantModuli del bootstrap Node).
        crate::moduli::seed_catalog(&auth)?;
        crate::moduli::ensure_tenant_moduli(&auth, DEFAULT_TENANT)?;
        Ok(())
    }

    /// Esegue una closure con la connessione "auth" (stesso file `ordeva.db`).
    pub fn with_auth<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.auth.lock().unwrap();
        f(&conn)
    }

    /// Percorso del file DB di un tenant. In offline il tenant "default" è il file unico
    /// `ordeva.db` (lo stesso aperto dalla connessione auth); eventuali altri tenant
    /// resterebbero su `tenants/<slug>.db` (non usati offline).
    pub fn tenant_db_path(&self, slug: &str) -> PathBuf {
        if slug == DEFAULT_TENANT {
            self.data_dir.join(DB_FILE)
        } else {
            self.data_dir.join("tenants").join(format!("{slug}.db"))
        }
    }

    /// Rimuove dalla cache la connessione del tenant (la chiude se è l'ultimo
    /// riferimento). Serve prima di sovrascrivere il file in un ripristino.
    pub fn evict_tenant(&self, slug: &str) {
        self.tenants.lock().unwrap().remove(slug);
    }

    /// Restituisce la connessione (cache) per un tenant, aprendola e applicando
    /// lo schema al primo accesso. Valida lo slug come fa openTenantDb().
    pub fn tenant_conn(&self, slug: &str) -> Result<Arc<Mutex<Connection>>> {
        if !valid_slug(slug) {
            anyhow::bail!("slug tenant non valido: {slug}");
        }
        let mut cache = self.tenants.lock().unwrap();
        if let Some(conn) = cache.get(slug) {
            return Ok(conn.clone());
        }
        let path = self.tenant_db_path(slug);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = open_db(&path)?;
        conn.execute_batch(TENANT_SCHEMA)
            .with_context(|| format!("init schema tenant {slug}"))?;
        // Auto-migrazione: aggiunge le colonne dello schema mancanti in DB vecchi.
        crate::migrate::add_missing_columns(&conn, TENANT_SCHEMA);
        // Amplia il CHECK su "canale" per includere SHOPIFY: un DB creato prima di
        // questa versione ha già le tre tabelle con il vecchio vincolo (EBAY/AMAZON
        // soli), e ADD COLUMN non può modificare un CHECK — serve ricreare la tabella.
        crate::migrate::amplia_check_canale(
            &conn, "marketplace_config", "SHOPIFY",
            "CREATE TABLE marketplace_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canale TEXT NOT NULL CHECK(canale IN ('EBAY','AMAZON','SHOPIFY')) UNIQUE,
                access_token TEXT DEFAULT '',
                refresh_token TEXT DEFAULT '',
                token_scade_il TEXT,
                account_label TEXT DEFAULT '',
                attivo INTEGER DEFAULT 1,
                ultima_sync TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );",
            &[],
        );
        crate::migrate::amplia_check_canale(
            &conn, "marketplace_mapping", "SHOPIFY",
            "CREATE TABLE marketplace_mapping (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                canale TEXT NOT NULL CHECK(canale IN ('EBAY','AMAZON','SHOPIFY')),
                sku TEXT NOT NULL,
                sku_norm TEXT NOT NULL,
                prodotto_id INTEGER NOT NULL REFERENCES prodotti(id) ON DELETE CASCADE,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(canale, sku_norm)
            );",
            &["CREATE INDEX IF NOT EXISTS idx_marketplace_mapping_lookup ON marketplace_mapping(canale, sku_norm);"],
        );
        crate::migrate::amplia_check_canale(
            &conn, "vendite_banco", "SHOPIFY",
            "CREATE TABLE vendite_banco (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                numero            TEXT NOT NULL,
                data              TEXT NOT NULL,
                cliente_nome      TEXT DEFAULT '',
                metodo_pagamento  TEXT DEFAULT 'CONTANTI',
                note              TEXT DEFAULT '',
                stato             TEXT DEFAULT 'EMESSA',
                canale             TEXT DEFAULT 'BANCO' CHECK(canale IN ('BANCO','EBAY','AMAZON','SHOPIFY')),
                riferimento_esterno TEXT
            );",
            &["CREATE UNIQUE INDEX IF NOT EXISTS idx_vendite_banco_numero ON vendite_banco(numero);"],
        );
        // Seed solo su DB fresco (azienda vuota), come il bootstrap di server.js.
        let already_seeded: i64 =
            conn.query_row("SELECT COUNT(*) FROM azienda", [], |r| r.get(0))?;
        if already_seeded == 0 {
            conn.execute_batch(TENANT_SEED)
                .with_context(|| format!("seed tenant {slug}"))?;
        }
        let conn = Arc::new(Mutex::new(conn));
        cache.insert(slug.to_string(), conn.clone());
        Ok(conn)
    }

    /// Esegue una closure con la connessione del tenant indicato.
    pub fn with_tenant<T>(
        &self,
        slug: &str,
        f: impl FnOnce(&Connection) -> Result<T>,
    ) -> Result<T> {
        let conn = self.tenant_conn(slug)?;
        let conn = conn.lock().unwrap();
        f(&conn)
    }
}

/// Apre una connessione SQLite con le stesse PRAGMA del backend Node.
fn open_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)
        .with_context(|| format!("apertura db {:?}", path))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = NORMAL;",
    )?;
    Ok(conn)
}

/// Migrazione dal vecchio formato a due file (`auth.db` + `tenants/default.db`) al file
/// unico `ordeva.db`. Idempotente: se `ordeva.db` esiste già non fa nulla; se non c'è nulla
/// da migrare (installazione pulita) non fa nulla. I vecchi file, a migrazione riuscita,
/// vengono SPOSTATI in `vecchio-formato/` (non cancellati) per sicurezza.
pub fn flatten_to_single_file(data_dir: &Path) -> Result<()> {
    let target = data_dir.join(DB_FILE);
    let old_auth = data_dir.join("auth.db");
    let old_tenant = data_dir.join("tenants").join(format!("{DEFAULT_TENANT}.db"));

    // Già appiattito (o nessun vecchio file) → niente da fare.
    if target.exists() {
        return Ok(());
    }
    if !old_auth.exists() && !old_tenant.exists() {
        return Ok(());
    }

    tracing::info!("migrazione a file unico {:?}", target);

    let result = (|| -> Result<()> {
        // 1) Base: copia consistente del DB tenant (dati + schema) → ordeva.db.
        //    VACUUM INTO richiede che il file di destinazione non esista (già verificato).
        if old_tenant.exists() {
            let src = open_db(&old_tenant)?;
            let dest_str = target.to_string_lossy().replace('\'', "''");
            src.execute_batch(&format!("VACUUM INTO '{dest_str}'"))
                .context("VACUUM INTO ordeva.db dal tenant")?;
        }

        // 2) Apre ordeva.db, applica entrambi gli schemi (crea le tabelle auth, e quelle
        //    tenant se il file è stato creato vuoto).
        let conn = Connection::open(&target).with_context(|| format!("apertura {:?}", target))?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;")?;
        conn.execute_batch(TENANT_SCHEMA).ok();
        conn.execute_batch(AUTH_SCHEMA).context("schema auth in ordeva.db")?;

        // 3) Copia i dati delle tabelle auth dal vecchio auth.db.
        if old_auth.exists() {
            let auth_str = old_auth.to_string_lossy().replace('\'', "''");
            conn.execute_batch(&format!("ATTACH DATABASE '{auth_str}' AS oldauth"))?;
            let tables: Vec<String> = {
                let mut stmt = conn.prepare(
                    "SELECT name FROM oldauth.sqlite_master WHERE type='table' \
                     AND name NOT LIKE 'sqlite_%'",
                )?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                rows.collect::<rusqlite::Result<_>>()?
            };
            for t in &tables {
                // Copia solo se la tabella esiste anche in destinazione (schema auth).
                let exists: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name=?1",
                    [t],
                    |r| r.get(0),
                )?;
                if exists == 0 {
                    continue;
                }
                conn.execute_batch(&format!(
                    "INSERT OR IGNORE INTO main.\"{t}\" SELECT * FROM oldauth.\"{t}\""
                ))
                .with_context(|| format!("copia tabella auth {t}"))?;
            }
            conn.execute_batch("DETACH DATABASE oldauth")?;
        }

        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        // Sanity check: il file si apre e le tabelle chiave ci sono.
        let _: i64 = conn.query_row("SELECT COUNT(*) FROM tenants", [], |r| r.get(0))?;
        let _: i64 = conn.query_row("SELECT COUNT(*) FROM azienda", [], |r| r.get(0))?;
        Ok(())
    })();

    if let Err(e) = result {
        // Migrazione fallita: rimuove il file parziale e propaga (meglio un errore visibile
        // che ripartire su un DB vuoto perdendo l'accesso ai dati nel vecchio formato).
        let _ = std::fs::remove_file(&target);
        for ext in ["-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{}", target.to_string_lossy(), ext));
        }
        return Err(e).context("migrazione a file unico fallita (vecchi file intatti)");
    }

    // Successo: sposta i vecchi file in vecchio-formato/ (non cancella).
    let backup_dir = data_dir.join("vecchio-formato");
    if std::fs::create_dir_all(&backup_dir).is_ok() {
        for name in ["auth.db", "auth.db-wal", "auth.db-shm"] {
            let from = data_dir.join(name);
            if from.exists() {
                let _ = std::fs::rename(&from, backup_dir.join(name));
            }
        }
        let old_tenants_dir = data_dir.join("tenants");
        if old_tenants_dir.is_dir() {
            let _ = std::fs::rename(&old_tenants_dir, backup_dir.join("tenants"));
        }
    }
    tracing::info!("migrazione a file unico completata");
    Ok(())
}

/// Stessa regex di openTenantDb(): /^[a-z0-9][a-z0-9_-]{0,63}$/i
fn valid_slug(slug: &str) -> bool {
    let bytes = slug.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return false;
    }
    let is_alnum = |c: u8| c.is_ascii_alphanumeric();
    if !is_alnum(bytes[0]) {
        return false;
    }
    bytes
        .iter()
        .all(|&c| is_alnum(c) || c == b'_' || c == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);

    /// Il seed usa INSERT posizionali: se qualcuno aggiunge una colonna allo
    /// schema del tenant e dimentica il seed, l'archivio NUOVO non si apre più
    /// (il seed gira solo su DB fresco, quindi il difetto non si vede
    /// aggiornando un'installazione esistente — solo alla prima installazione).
    /// Questo test lo fa fallire subito, con un messaggio che dice cosa fare.
    #[test]
    fn seed_applicabile_su_schema_corrente() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(TENANT_SCHEMA).expect("schema tenant valido");
        conn.execute_batch(TENANT_SEED).expect(
            "seed non applicabile: hai aggiunto una colonna in schema/tenant.sql \
             senza aggiungere il valore corrispondente in schema/seed.sql",
        );
    }

    /// Cartella temporanea unica per ogni test (niente Date/random).
    fn tmp_dir() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("ordeva-test-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn cfg_path(dir: &Path) -> PathBuf {
        dir.join("ordeva.json")
    }

    /// Crea un vecchio layout a due file con dati noti: tenants/default.db (con un cliente)
    /// e auth.db (con un utente extra oltre a quello di bootstrap).
    fn make_legacy_two_files(dir: &Path) {
        std::fs::create_dir_all(dir.join("tenants")).unwrap();
        // tenant: schema + seed + un cliente
        let t = Connection::open(dir.join("tenants").join("default.db")).unwrap();
        t.execute_batch(TENANT_SCHEMA).unwrap();
        t.execute_batch(TENANT_SEED).unwrap();
        t.execute(
            "INSERT INTO clienti (ragione_sociale) VALUES ('Cliente Storico')",
            [],
        )
        .unwrap();
        drop(t);
        // auth: schema + tenant 'default' + utente extra
        let a = Connection::open(dir.join("auth.db")).unwrap();
        a.execute_batch(AUTH_SCHEMA).unwrap();
        a.execute(
            "INSERT INTO tenants (slug, nome, attivo, stato, piano) VALUES ('default','Default',1,'attiva','pro')",
            [],
        )
        .unwrap();
        a.execute(
            "INSERT INTO users (username, password_hash, nome, ruolo, tenant_slug, attivo) \
             VALUES ('mario','x','Mario',  'ADMIN','default',1)",
            [],
        )
        .unwrap();
        drop(a);
    }

    #[test]
    fn flatten_porta_dati_tenant_e_auth_in_un_solo_file() {
        let dir = tmp_dir();
        make_legacy_two_files(&dir);

        flatten_to_single_file(&dir).unwrap();

        // Un solo file dati, vecchi file spostati.
        assert!(dir.join(DB_FILE).is_file(), "ordeva.db creato");
        assert!(!dir.join("auth.db").exists(), "vecchio auth.db spostato");
        assert!(
            dir.join("vecchio-formato").join("auth.db").is_file(),
            "auth.db conservato in vecchio-formato"
        );

        // L'app si apre sul file unico e vede ENTRAMBI i domini.
        let st = AppState::init(dir.clone(), cfg_path(&dir)).unwrap();
        let clienti: i64 = st
            .with_tenant(DEFAULT_TENANT, |c| {
                Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Cliente Storico'", [], |r| r.get(0))?)
            })
            .unwrap();
        assert_eq!(clienti, 1, "dato tenant migrato");
        let mario: i64 = st
            .with_auth(|c| Ok(c.query_row("SELECT COUNT(*) FROM users WHERE username='mario'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(mario, 1, "dato auth migrato");
        // bootstrap idempotente: esiste anche l'utente 'local'.
        let local: i64 = st
            .with_auth(|c| Ok(c.query_row("SELECT COUNT(*) FROM users WHERE username='local'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(local, 1);
    }

    #[test]
    fn flatten_idempotente_e_noop_su_installazione_pulita() {
        // Installazione pulita: nessun vecchio file → nessun ordeva.db creato qui.
        let dir = tmp_dir();
        flatten_to_single_file(&dir).unwrap();
        assert!(!dir.join(DB_FILE).exists());

        // Con ordeva.db già presente, non tocca nulla anche se ci fossero vecchi file.
        let dir2 = tmp_dir();
        make_legacy_two_files(&dir2);
        flatten_to_single_file(&dir2).unwrap();
        let size1 = std::fs::metadata(dir2.join(DB_FILE)).unwrap().len();
        // Seconda chiamata: no-op (ordeva.db esiste già).
        flatten_to_single_file(&dir2).unwrap();
        let size2 = std::fs::metadata(dir2.join(DB_FILE)).unwrap().len();
        assert_eq!(size1, size2);
    }

    #[test]
    fn scrittura_su_auth_e_tenant_persiste_nello_stesso_file() {
        let dir = tmp_dir();
        {
            let st = AppState::init(dir.clone(), cfg_path(&dir)).unwrap();
            st.with_tenant(DEFAULT_TENANT, |c| {
                c.execute("INSERT INTO clienti (ragione_sociale) VALUES ('Acme')", [])?;
                Ok(())
            })
            .unwrap();
            st.with_auth(|c| {
                c.execute(
                    "INSERT INTO users (username, password_hash, nome, ruolo, tenant_slug, attivo) \
                     VALUES ('extra','x','Extra','ADMIN','default',1)",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
            st.flush();
        }
        // Riapertura pulita: entrambe le scritture sono durature sul file unico.
        let st2 = AppState::init(dir.clone(), cfg_path(&dir)).unwrap();
        let acme: i64 = st2
            .with_tenant(DEFAULT_TENANT, |c| Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Acme'", [], |r| r.get(0))?))
            .unwrap();
        let extra: i64 = st2
            .with_auth(|c| Ok(c.query_row("SELECT COUNT(*) FROM users WHERE username='extra'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(acme, 1);
        assert_eq!(extra, 1);
        assert!(dir.join(DB_FILE).is_file());
        assert!(!dir.join("tenants").exists(), "niente cartella tenants/");
    }

    #[test]
    fn restore_di_backup_vecchio_formato_riseeda_auth() {
        let dir = tmp_dir();
        let st = AppState::init(dir.clone(), cfg_path(&dir)).unwrap();

        // Backup in VECCHIO formato: file con solo le tabelle tenant (niente auth).
        let bk = tmp_dir().join("vecchio-backup.db");
        let b = Connection::open(&bk).unwrap();
        b.execute_batch(TENANT_SCHEMA).unwrap();
        b.execute_batch(TENANT_SEED).unwrap();
        b.execute("INSERT INTO clienti (ragione_sociale) VALUES ('Da Backup')", []).unwrap();
        drop(b);

        crate::backup::restore_backup(&st, bk.to_str().unwrap(), None, None).unwrap();

        // Il dato del backup c'è...
        let cliente: i64 = st
            .with_tenant(DEFAULT_TENANT, |c| Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Da Backup'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(cliente, 1);
        // ...e auth è stato riseedato (utente local + catalogo moduli non vuoto),
        // così i moduli restano abilitati anche ripristinando un backup vecchio.
        let local: i64 = st
            .with_auth(|c| Ok(c.query_row("SELECT COUNT(*) FROM users WHERE username='local'", [], |r| r.get(0))?))
            .unwrap();
        let moduli: i64 = st
            .with_auth(|c| Ok(c.query_row("SELECT COUNT(*) FROM moduli", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(local, 1, "utente local riseedato");
        assert!(moduli > 0, "catalogo moduli riseedato");
    }

    #[test]
    fn snapshot_crea_elenca_e_ripristina() {
        let dir = tmp_dir();
        let st = AppState::init(dir.clone(), cfg_path(&dir)).unwrap();

        // Stato iniziale.
        st.with_tenant(DEFAULT_TENANT, |c| {
            c.execute("INSERT INTO clienti (ragione_sociale) VALUES ('Prima')", [])?;
            Ok(())
        })
        .unwrap();

        // Snapshot del punto attuale.
        let name = crate::backup::create_snapshot(&st).unwrap();
        let list = crate::backup::list_snapshots(&st);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["name"].as_str().unwrap(), name);

        // Modifiche dopo lo snapshot.
        st.with_tenant(DEFAULT_TENANT, |c| {
            c.execute("INSERT INTO clienti (ragione_sociale) VALUES ('Dopo')", [])?;
            c.execute("DELETE FROM clienti WHERE ragione_sociale='Prima'", [])?;
            Ok(())
        })
        .unwrap();

        // Ripristino → torna allo stato dello snapshot.
        crate::backup::restore_snapshot(&st, &name).unwrap();
        let prima: i64 = st
            .with_tenant(DEFAULT_TENANT, |c| Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Prima'", [], |r| r.get(0))?))
            .unwrap();
        let dopo: i64 = st
            .with_tenant(DEFAULT_TENANT, |c| Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Dopo'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(prima, 1, "lo snapshot ha ripristinato 'Prima'");
        assert_eq!(dopo, 0, "le modifiche dopo lo snapshot sono annullate");
    }

    #[test]
    fn cifratura_a_riposo_ciclo_completo() {
        let dir = tmp_dir();
        let cfg = cfg_path(&dir);
        // Sessione 1: crea dato, chiudi, sigilla (cifra + rimuovi chiaro).
        {
            let st = AppState::init(dir.clone(), cfg.clone()).unwrap();
            st.with_tenant(DEFAULT_TENANT, |c| {
                c.execute("INSERT INTO clienti (ragione_sociale) VALUES ('Segreto')", [])?;
                Ok(())
            })
            .unwrap();
            st.flush();
            st.close_all();
        }
        crate::atrest::seal_on_close(&dir, "pw").unwrap();
        assert!(crate::atrest::is_locked(&dir), "dopo la chiusura il DB è bloccato");
        assert!(!dir.join(DB_FILE).exists(), "nessun file in chiaro a riposo");

        // Password sbagliata non apre.
        assert!(crate::atrest::unlock(&dir, "errata").is_err());

        // Sessione 2: sblocca e riapri → i dati ci sono.
        crate::atrest::unlock(&dir, "pw").unwrap();
        let st2 = AppState::init(dir.clone(), cfg).unwrap();
        let n: i64 = st2
            .with_tenant(DEFAULT_TENANT, |c| Ok(c.query_row("SELECT COUNT(*) FROM clienti WHERE ragione_sociale='Segreto'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(n, 1, "i dati sopravvivono al ciclo cifra/sblocca");
    }
}
