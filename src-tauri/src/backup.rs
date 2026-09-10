//! Backup cifrato dell'edizione offline — parità con utils/backup.js,
//! utils/backupConfig.js e utils/appSession.js.
//!
//! Cifratura: scrypt(password, salt, N=16384,r=8,p=1)=key32 + AES-256-GCM.
//! Formato file V2 (cross-PC): "ORDEVA2\0"(8) | salt(16) | iv(12) | tag(16) | dati.
//! V1 (legacy): "ORDEVA1\0"(8) | iv(12) | tag(16) | dati (ripristino solo stesso PC).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};

use crate::db::{AppState, DEFAULT_TENANT};
use crate::web;

const MAGIC_V2: &[u8; 8] = b"ORDEVA2\0";
const MAGIC_V1: &[u8; 8] = b"ORDEVA1\0";
const MAX_BACKUPS: usize = 14;
const EXT_MAX: usize = 30;
/// Snapshot (cronologia versioni) tenuti: copie a punti nel tempo, ripristinabili.
const SNAPSHOT_MAX: usize = 30;
/// Intervallo minimo tra snapshot automatici (secondi): 6 ore.
const SNAPSHOT_DUE_SECS: u64 = 6 * 3600;

// ── Config (azienda.backup_config) ──────────────────────────────────────────

/// DEFAULTS del config backup (come backupConfig.js).
fn defaults() -> Value {
    json!({
        "dir": "",
        "enabled": false,
        "encrypt": false,
        "alertDays": 3,
        "alertDisabled": false,
        // Conservazione: elimina i backup esterni più vecchi di N giorni (0 = mai).
        "retentionDays": 0,
        "lastAt": Value::Null,
        "lastVerifyAt": Value::Null,
        "lastVerifyOk": Value::Null,
        "lastVerifyProblem": "",
        "alertDismissedAt": Value::Null,
        "encSalt": Value::Null,
    })
}

/// Legge il config (DEFAULTS sovrascritti da quanto salvato in azienda.backup_config).
pub fn read_config(state: &AppState) -> Result<Value> {
    let stored: Option<String> = state.with_tenant(DEFAULT_TENANT, |c| {
        Ok(c.query_row("SELECT backup_config FROM azienda WHERE id=1", [], |r| r.get(0))
            .ok()
            .flatten())
    })?;
    let mut cfg = defaults();
    if let Some(s) = stored {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&s) {
            let obj = cfg.as_object_mut().unwrap();
            for (k, v) in map {
                obj.insert(k, v);
            }
        }
    }
    Ok(cfg)
}

/// Scrive un patch sul config (merge su read()) e ritorna il merged.
pub fn write_config(state: &AppState, patch: Value) -> Result<Value> {
    let mut merged = read_config(state)?;
    if let Value::Object(p) = patch {
        let obj = merged.as_object_mut().unwrap();
        for (k, v) in p {
            obj.insert(k, v);
        }
    }
    let s = serde_json::to_string(&merged)?;
    state.with_tenant(DEFAULT_TENANT, |c| {
        c.execute("UPDATE azienda SET backup_config=?1 WHERE id=1", [s.as_str()])?;
        Ok(())
    })?;
    Ok(merged)
}

/// Garantisce un salt persistente (hex). Lo crea se assente.
pub fn ensure_salt(state: &AppState) -> Result<String> {
    let cfg = read_config(state)?;
    if let Some(s) = cfg.get("encSalt").and_then(Value::as_str) {
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    let mut raw = [0u8; 16];
    getrandom::getrandom(&mut raw).map_err(|e| anyhow!(e.to_string()))?;
    let salt = hex_encode(&raw);
    write_config(state, json!({ "encSalt": salt }))?;
    Ok(salt)
}

// ── Chiave di sessione (in memoria) ─────────────────────────────────────────

/// Deriva e memorizza la chiave AES-256 dalla password + salt (hex). Vuoti → None.
pub fn set_key_from_password(state: &AppState, password: &str, salt_hex: &str) {
    let mut slot = state.backup_key.lock().unwrap();
    if password.is_empty() || salt_hex.is_empty() {
        *slot = None;
        return;
    }
    match derive_key(password, salt_hex) {
        Ok(k) => *slot = Some(k),
        Err(_) => *slot = None,
    }
}

pub fn get_key(state: &AppState) -> Option<[u8; 32]> {
    *state.backup_key.lock().unwrap()
}

pub fn clear_key(state: &AppState) {
    *state.backup_key.lock().unwrap() = None;
}

/// scrypt(password, salt) → 32 byte (parità con crypto.scryptSync default).
fn derive_key(password: &str, salt_hex: &str) -> Result<[u8; 32]> {
    let salt = hex_decode(salt_hex).ok_or_else(|| anyhow!("salt non valido"))?;
    derive_key_raw(password, &salt)
}

/// scrypt(password, salt) → chiave AES-256. Riusata anche da `keychain.rs` per derivare la
/// chiave di sessione del portachiavi dalla sua master password (indipendente da questa).
pub(crate) fn derive_key_raw(password: &str, salt: &[u8]) -> Result<[u8; 32]> {
    // Node scryptSync default: N=16384 (log_n=14), r=8, p=1.
    let params = scrypt::Params::new(14, 8, 1, 32).map_err(|e| anyhow!(e.to_string()))?;
    let mut out = [0u8; 32];
    scrypt::scrypt(password.as_bytes(), salt, &params, &mut out)
        .map_err(|e| anyhow!(e.to_string()))?;
    Ok(out)
}

// ── Cifratura AES-256-GCM ───────────────────────────────────────────────────

pub fn is_encrypted(buf: &[u8]) -> bool {
    buf.len() >= 8 && (&buf[0..8] == MAGIC_V2 || &buf[0..8] == MAGIC_V1)
}

/// Cifra un buffer con una password (formato ORDEVA2, salt casuale nell'header).
/// Usato per la cifratura del database a riposo (ordeva.db.enc).
pub fn encrypt_with_password(plain: &[u8], password: &str) -> Result<Vec<u8>> {
    let mut salt = [0u8; 16];
    getrandom::getrandom(&mut salt).map_err(|e| anyhow!(e.to_string()))?;
    let key = derive_key_raw(password, &salt)?;
    encrypt_buffer(plain, &key, &salt)
}

/// Decifra un buffer ORDEVA2 con la sola password (salt incorporato). Errore se la
/// password è sbagliata (il tag GCM non torna): è anche la verifica della password.
pub fn decrypt_with_password(data: &[u8], password: &str) -> Result<Vec<u8>> {
    decrypt_buffer(data, None, Some(password))
}

/// Cifra con una chiave GIÀ derivata (niente scrypt qui). `salt` è incorporato
/// nell'header solo per uniformità di formato: in modalità chiave nota (vedi
/// `decrypt_buffer` con `key: Some(..)`) non viene riletto in decifratura.
pub(crate) fn encrypt_buffer(buf: &[u8], key: &[u8; 32], salt: &[u8]) -> Result<Vec<u8>> {
    let mut iv = [0u8; 12];
    getrandom::getrandom(&mut iv).map_err(|e| anyhow!(e.to_string()))?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut data = buf.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(Nonce::from_slice(&iv), b"", &mut data)
        .map_err(|_| anyhow!("cifratura fallita"))?;
    let mut out = Vec::with_capacity(8 + salt.len() + 12 + 16 + data.len());
    out.extend_from_slice(MAGIC_V2);
    out.extend_from_slice(salt);
    out.extend_from_slice(&iv);
    out.extend_from_slice(&tag);
    out.extend_from_slice(&data);
    Ok(out)
}

/// Decifra. Con `password` ricava la chiave dal salt incorporato (V2, cross-PC).
pub(crate) fn decrypt_buffer(buf: &[u8], key: Option<[u8; 32]>, password: Option<&str>) -> Result<Vec<u8>> {
    let v2 = buf.len() >= 8 && &buf[0..8] == MAGIC_V2;
    let v1 = buf.len() >= 8 && &buf[0..8] == MAGIC_V1;
    if !v2 && !v1 {
        bail!("File non cifrato o formato non riconosciuto");
    }
    let mut p = 8usize;
    let mut k = key;
    if v2 {
        let salt = &buf[p..p + 16];
        p += 16;
        if let Some(pw) = password {
            k = Some(derive_key_raw(pw, salt)?);
        }
    } else if password.is_some() && key.is_none() {
        bail!("Backup in formato precedente: ripristinabile solo sullo stesso PC che lo ha creato.");
    }
    let k = k.ok_or_else(|| anyhow!("Password mancante per decifrare il backup"))?;
    let iv = &buf[p..p + 12];
    p += 12;
    let tag = &buf[p..p + 16];
    p += 16;
    let data = &buf[p..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&k));
    let mut out = data.to_vec();
    cipher
        .decrypt_in_place_detached(
            Nonce::from_slice(iv),
            b"",
            &mut out,
            aes_gcm::Tag::from_slice(tag),
        )
        .map_err(|_| anyhow!("decifratura fallita"))?;
    Ok(out)
}

// ── Backup / restore ────────────────────────────────────────────────────────

/// Timestamp UTC "YYYY-MM-DDTHH-MM-SS" (toISOString con [:.] → '-', slice 0..19).
fn ts_now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let iso = web::iso_of_days(days); // YYYY-MM-DD
    format!("{iso}T{h:02}-{mi:02}-{s:02}")
}

/// Esegue una copia consistente (VACUUM INTO) del DB tenant nel file `dest`.
fn vacuum_into(state: &AppState, dest: &Path) -> Result<()> {
    let dest_str = dest.to_string_lossy().replace('\'', "''");
    state.with_tenant(DEFAULT_TENANT, |c| {
        c.execute_batch(&format!("VACUUM INTO '{dest_str}'"))?;
        Ok(())
    })
}

/// Backup interno di sicurezza in data_dir/backups/<slug> (parità con runBackup).
fn run_internal_backup(state: &AppState) -> Result<()> {
    let dir = state.data_dir.join("backups").join(DEFAULT_TENANT);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("gestionale-{}.db", ts_now()));
    vacuum_into(state, &dest)?;
    prune(&dir, "gestionale-", MAX_BACKUPS, false);
    Ok(())
}

// ── Snapshot / cronologia versioni ───────────────────────────────────────────
// Copie consistenti dell'intero ordeva.db a punti nel tempo, dentro
// data_dir/snapshots, da cui si può "tornare indietro". Sono locali (a differenza dei
// backup esterni, che vanno in una cartella scelta dall'utente / cloud).

/// Cartella degli snapshot.
pub fn snapshot_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("snapshots")
}

/// Nome snapshot valido: `snap-<timestamp>.db` (niente separatori di percorso).
fn is_snapshot_name(f: &str) -> bool {
    f.starts_with("snap-")
        && f.ends_with(".db")
        && !f.contains('/')
        && !f.contains('\\')
        && !f.contains("..")
}

/// Crea uno snapshot ora. Ritorna il nome del file creato.
pub fn create_snapshot(state: &AppState) -> Result<String> {
    let dir = snapshot_dir(state);
    std::fs::create_dir_all(&dir)?;
    let name = format!("snap-{}.db", ts_now());
    vacuum_into(state, &dir.join(&name))?;
    prune(&dir, "snap-", SNAPSHOT_MAX, false);
    Ok(name)
}

/// Elenco snapshot (più recenti prima) con nome, dimensione e data.
pub fn list_snapshots(state: &AppState) -> Vec<Value> {
    let dir = snapshot_dir(state);
    let mut items: Vec<(String, u64, std::time::SystemTime)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_snapshot_name(&name) {
                continue;
            }
            if let Ok(md) = e.metadata() {
                items.push((name, md.len(), md.modified().unwrap_or(UNIX_EPOCH)));
            }
        }
    }
    items.sort_by(|a, b| b.2.cmp(&a.2));
    items
        .into_iter()
        .map(|(name, size, mtime)| json!({ "name": name, "size": size, "mtime": iso_utc(mtime) }))
        .collect()
}

/// Ripristina uno snapshot dato il nome (validato). Riusa il percorso di restore completo
/// (backup di sicurezza dell'attuale + sostituzione file + reseed).
pub fn restore_snapshot(state: &AppState, name: &str) -> Result<()> {
    if !is_snapshot_name(name) {
        bail!("Nome snapshot non valido");
    }
    let path = snapshot_dir(state).join(name);
    if !path.exists() {
        bail!("Snapshot non trovato");
    }
    restore_backup(state, &path.to_string_lossy(), None, None)
}

/// Crea uno snapshot automatico se l'ultimo è più vecchio di SNAPSHOT_DUE_SECS (o non
/// ce ne sono). Best-effort: non propaga errori. Chiamato all'avvio e dallo scheduler.
pub fn run_snapshot_if_due(state: &AppState) {
    let dir = snapshot_dir(state);
    let newest = std::fs::read_dir(&dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| is_snapshot_name(&e.file_name().to_string_lossy()))
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .max();
    let due = match newest {
        Some(t) => t
            .elapsed()
            .map(|d| d.as_secs() >= SNAPSHOT_DUE_SECS)
            .unwrap_or(true),
        None => true,
    };
    if due {
        if let Err(e) = create_snapshot(state) {
            tracing::warn!("snapshot automatico non riuscito: {e:#}");
        }
    }
}

/// Crea un backup nella cartella `dir`, cifrato se richiesto. Ritorna (file, encrypted).
pub fn run_external_backup(
    state: &AppState,
    dir: &str,
    encrypt: bool,
    key: Option<[u8; 32]>,
    salt_hex: &str,
) -> Result<(PathBuf, bool)> {
    if dir.is_empty() {
        bail!("Cartella di backup non impostata");
    }
    if encrypt && (key.is_none() || salt_hex.is_empty()) {
        bail!("Cifratura richiesta ma password d'accesso non sbloccata");
    }
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir)?;
    let src = state.tenant_db_path(DEFAULT_TENANT);
    if !src.exists() {
        bail!("Database non trovato");
    }
    let tmp = std::env::temp_dir().join(format!("ordeva-bk-{}.db", nanos()));
    vacuum_into(state, &tmp)?;

    let ts = ts_now();
    let (dest, encrypted) = if encrypt && key.is_some() {
        let dest = dir.join(format!("ordeva-{ts}.db.enc"));
        let salt = hex_decode(salt_hex).ok_or_else(|| anyhow!("salt non valido"))?;
        let plain = std::fs::read(&tmp)?;
        std::fs::write(&dest, encrypt_buffer(&plain, &key.unwrap(), &salt)?)?;
        (dest, true)
    } else {
        let dest = dir.join(format!("ordeva-{ts}.db"));
        std::fs::copy(&tmp, &dest)?;
        (dest, false)
    };
    let _ = std::fs::remove_file(&tmp);
    prune(&dir, "ordeva-", EXT_MAX, true);
    Ok((dest, encrypted))
}

/// Ripristina un backup (.db o .db.enc), sostituendo il DB del tenant.
pub fn restore_backup(
    state: &AppState,
    file_path: &str,
    key: Option<[u8; 32]>,
    password: Option<&str>,
) -> Result<()> {
    let fp = PathBuf::from(file_path);
    if file_path.is_empty() || !fp.exists() {
        bail!("File di backup non trovato");
    }
    let mut data = std::fs::read(&fp)?;
    if is_encrypted(&data) {
        if key.is_none() && password.is_none() {
            bail!("Backup cifrato: inserisci la password usata per crearlo.");
        }
        data = decrypt_buffer(&data, key, password)
            .map_err(|_| anyhow!("Impossibile decifrare il backup: password errata o file danneggiato."))?;
    }
    if data.len() < 16 || &data[0..16] != b"SQLite format 3\0" {
        bail!("Il file non è un database valido (password errata?)");
    }
    // Backup di sicurezza dell'attuale (best-effort), poi chiude e sovrascrive.
    let _ = run_internal_backup(state);
    let target = state.tenant_db_path(DEFAULT_TENANT);
    // File unico: chiude auth + tenant (entrambi su ordeva.db) PRIMA di sovrascrivere il
    // file, altrimenti SQLite con la connessione aperta corromperebbe il database. La
    // connessione auth viene riaperta automaticamente da with_dbs_closed.
    state.with_dbs_closed(|| {
        std::fs::write(&target, &data)?;
        for ext in ["-wal", "-shm"] {
            let p = PathBuf::from(format!("{}{}", target.to_string_lossy(), ext));
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    })?;
    // I backup vecchi contengono solo le tabelle del tenant: ricrea tenant/utente/moduli
    // (idempotente) e ri-materializza il tenant sul file ripristinato.
    state.ensure_offline_bootstrap();
    let _ = state.tenant_conn(DEFAULT_TENANT);
    Ok(())
}

/// Backup esterno automatico all'avvio se "dovuto" (parità con runExternalBackupIfDue
/// di server.js): abilitato, cartella impostata, ≥1 giorno dall'ultimo, e — se cifrato —
/// con la chiave sbloccata. Best-effort: non propaga errori.
pub fn run_if_due(state: &AppState) {
    let cfg = match read_config(state) {
        Ok(c) => c,
        Err(_) => return,
    };
    let enabled = cfg.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("").to_string();
    if !enabled || dir.is_empty() {
        return;
    }
    let days = match cfg.get("lastAt").and_then(Value::as_str) {
        Some(iso) => days_since_iso(iso),
        None => f64::INFINITY,
    };
    if days < 1.0 {
        return;
    }
    let encrypt = cfg.get("encrypt").and_then(Value::as_bool).unwrap_or(false);
    let key = get_key(state);
    if encrypt && key.is_none() {
        return; // cifratura attiva ma app bloccata: rinviato
    }
    let salt = ensure_salt(state).unwrap_or_default();
    if run_external_backup(state, &dir, encrypt, key, &salt).is_ok() {
        let _ = write_config(state, json!({ "lastAt": iso_now_ms() }));
        let retention = cfg.get("retentionDays").and_then(Value::as_f64).unwrap_or(0.0) as u32;
        prune_external_older_than(&dir, retention);

        // Il backup appena scritto viene riaperto e controllato subito: se non è
        // ripristinabile è ora che bisogna saperlo. L'esito resta nella
        // configurazione, così l'app può avvisare senza rifare la verifica.
        let esito = match verifica_ultimo_backup(state, None) {
            Ok(e) if e.ok => json!({ "lastVerifyAt": iso_now_ms(), "lastVerifyOk": true, "lastVerifyProblem": "" }),
            Ok(e) => {
                tracing::error!("backup automatico non ripristinabile: {}", e.problema);
                json!({ "lastVerifyAt": iso_now_ms(), "lastVerifyOk": false, "lastVerifyProblem": e.problema })
            }
            Err(e) => json!({ "lastVerifyAt": iso_now_ms(), "lastVerifyOk": false, "lastVerifyProblem": e.to_string() }),
        };
        let _ = write_config(state, esito);
    }
}

/// Secondi epoch da una ISO; +∞ non gestito qui (vedi chiamante).
fn days_since_iso(iso: &str) -> f64 {
    let date = match web::days_of(iso) {
        Some(d) => d,
        None => return f64::INFINITY,
    };
    let mut secs = date * 86400;
    if let Some(tpos) = iso.find('T') {
        let parts: Vec<&str> = iso[tpos + 1..].splitn(3, ':').collect();
        let h: i64 = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
        let mi: i64 = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
        let s: i64 = parts.get(2).map(|x| x.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).and_then(|x| x.parse().ok()).unwrap_or(0);
        secs += h * 3600 + mi * 60 + s;
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    (now - secs) as f64 / 86400.0
}

fn iso_now_ms() -> String {
    iso_utc(SystemTime::now())
}

/// Elenco backup nella cartella, ordinati per mtime desc.
pub fn list_external(dir: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let path = Path::new(dir);
    if dir.is_empty() || !path.exists() {
        return out;
    }
    let mut items: Vec<(String, bool, u64, std::time::SystemTime)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(path) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_backup_name(&name) {
                continue;
            }
            if let Ok(md) = e.metadata() {
                let mtime = md.modified().unwrap_or(UNIX_EPOCH);
                items.push((name.clone(), name.ends_with(".db.enc"), md.len(), mtime));
            }
        }
    }
    items.sort_by(|a, b| b.3.cmp(&a.3));
    for (name, enc, size, mtime) in items {
        out.push(json!({
            "name": name,
            "encrypted": enc,
            "size": size,
            "mtime": iso_utc(mtime),
        }));
    }
    out
}

/// Nome backup valido: ^ordeva-.*\.(db|db\.enc)$
fn is_backup_name(f: &str) -> bool {
    f.starts_with("ordeva-") && (f.ends_with(".db") || f.ends_with(".db.enc"))
}

/// Elimina i backup esterni più vecchi di `days` giorni (in base all'mtime). Con
/// `days == 0` non fa nulla. Ritorna quanti file ha rimosso. Indipendente dal limite
/// per numero (`prune`): serve a non intasare la memoria con copie datate.
pub fn prune_external_older_than(dir: &str, days: u32) -> usize {
    if days == 0 || dir.is_empty() {
        return 0;
    }
    let path = Path::new(dir);
    if !path.exists() {
        return 0;
    }
    let cutoff = SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(days as u64 * 86400))
        .unwrap_or(UNIX_EPOCH);
    let mut removed = 0usize;
    if let Ok(rd) = std::fs::read_dir(path) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_backup_name(&name) {
                continue;
            }
            let too_old = e
                .metadata()
                .ok()
                .and_then(|md| md.modified().ok())
                .map(|mtime| mtime < cutoff)
                .unwrap_or(false);
            if too_old && std::fs::remove_file(e.path()).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

fn prune(dir: &Path, prefix: &str, keep: usize, ext_pattern: bool) {
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let ok = if ext_pattern { is_backup_name(&name) } else { name.starts_with(prefix) && name.ends_with(".db") };
            if !ok {
                continue;
            }
            if let Ok(md) = e.metadata() {
                files.push((e.path(), md.modified().unwrap_or(UNIX_EPOCH)));
            }
        }
    }
    files.sort_by(|a, b| b.1.cmp(&a.1));
    for (p, _) in files.into_iter().skip(keep) {
        let _ = std::fs::remove_file(p);
    }
}

// ── util ────────────────────────────────────────────────────────────────────

fn nanos() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

fn iso_utc(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let nanos = t.duration_since(UNIX_EPOCH).map(|d| d.subsec_millis()).unwrap_or(0);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let iso = web::iso_of_days(days);
    format!("{iso}T{h:02}:{mi:02}:{s:02}.{nanos:03}Z")
}

fn hex_encode(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: &[u8] = b"SQLite format 3 test-payload-123";
    const SALT_HEX: &str = "00112233445566778899aabbccddeeff";
    const NODE_KEY: &str = "d13f9141ddd7b37e06893d66b545c1df8429c8fc052008655f111f42cff1e652";
    // Blob V2 prodotto da utils/backup.js (Node) con password "segreta" e SALT_HEX.
    const NODE_BLOB: &str = "4f5244455641320000112233445566778899aabbccddeeffdca82688f23ebda00a1cfd1888bc3cd444d0ac7a93ee930c19ba00520e1e474def1f5de82bb7941e3a4b2099536d2c6f4b25f52e47f67cdeddc75be4";

/// Il senso della verifica è accorgersi che un file NON è ripristinabile.
    /// Questi sono i tre modi in cui un backup si rompe davvero: file troncato
    /// a metà scrittura, contenuto non SQLite, database quasi vuoto.
    #[test]
    fn riconosce_un_backup_inservibile() {
        let dir = std::env::temp_dir().join(format!("ordeva-verifica-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Un database sano, con abbastanza tabelle da sembrare un archivio.
        let sano = dir.join("sano.db");
        {
            let c = rusqlite::Connection::open(&sano).unwrap();
            for i in 0..12 {
                c.execute(&format!("CREATE TABLE t{i} (id INTEGER PRIMARY KEY, v TEXT)"), []).unwrap();
            }
        }
        assert!(controlla_db(&sano).is_ok(), "un database integro deve passare");

        // File troncato: i primi byte sono quelli di SQLite, il resto manca.
        let troncato = dir.join("troncato.db");
        let mut dati = std::fs::read(&sano).unwrap();
        dati.truncate(dati.len() / 3);
        std::fs::write(&troncato, &dati).unwrap();
        assert!(controlla_db(&troncato).is_err(), "un file troncato non deve passare");

        // Contenuto che non è affatto un database.
        let spazzatura = dir.join("spazzatura.db");
        std::fs::write(&spazzatura, b"questo non e' un database").unwrap();
        assert!(controlla_db(&spazzatura).is_err(), "un file non-SQLite non deve passare");

        // Database valido ma quasi vuoto: sintomo di un backup interrotto.
        let vuoto = dir.join("vuoto.db");
        {
            let c = rusqlite::Connection::open(&vuoto).unwrap();
            c.execute("CREATE TABLE solo_una (id INTEGER)", []).unwrap();
        }
        assert!(controlla_db(&vuoto).is_err(), "un archivio con una sola tabella non è un backup buono");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scrypt_matches_node() {
        let key = derive_key("segreta", SALT_HEX).unwrap();
        assert_eq!(hex_encode(&key), NODE_KEY, "scrypt key deve combaciare con Node");
    }

    #[test]
    fn decrypts_node_blob_with_password() {
        let blob = hex_decode(NODE_BLOB).unwrap();
        let out = decrypt_buffer(&blob, None, Some("segreta")).unwrap();
        assert_eq!(out, PLAIN, "deve decifrare il blob V2 di Node via password");
    }

    #[test]
    fn rust_blob_roundtrips_and_is_written_for_node() {
        let salt = hex_decode(SALT_HEX).unwrap();
        let key = derive_key("segreta", SALT_HEX).unwrap();
        let blob = encrypt_buffer(PLAIN, &key, &salt).unwrap();
        // header ORDEVA2
        assert_eq!(&blob[0..8], MAGIC_V2);
        // round-trip interno (via chiave e via password)
        assert_eq!(decrypt_buffer(&blob, Some(key), None).unwrap(), PLAIN);
        assert_eq!(decrypt_buffer(&blob, None, Some("segreta")).unwrap(), PLAIN);
        // scrive il blob così Node può verificarne la decifratura (cross-compat).
        let out_path = std::env::temp_dir().join("rust_enc.bin");
        std::fs::write(&out_path, &blob).unwrap();
    }
}

/// Apre il file come database e verifica che sia sano: integrità SQLite e un
/// numero di tabelle plausibile per un archivio Ordeva (un backup interrotto a
/// metà si apre lo stesso, ma è quasi vuoto).
fn controlla_db(percorso: &Path) -> Result<i64> {
    let c = rusqlite::Connection::open(percorso)?;
    let integrita: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrita != "ok" {
        anyhow::bail!("il database è danneggiato ({integrita})");
    }
    let tabelle: i64 =
        c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))?;
    if tabelle < 10 {
        anyhow::bail!("il backup contiene solo {tabelle} tabelle: sembra incompleto");
    }
    Ok(tabelle)
}

/// Esito della verifica di un file di backup.
pub struct EsitoVerifica {
    pub file: String,
    pub ok: bool,
    pub cifrato: bool,
    pub problema: String,
    pub tabelle: i64,
    pub bytes: u64,
}

/// Verifica che l'ultimo backup sia davvero ripristinabile.
///
/// Un backup che nessuno ha mai riaperto è una speranza, non una copia: la
/// password può essere cambiata, il disco può essersi riempito a metà scrittura,
/// la sincronizzazione col cloud può aver caricato un file monco. Qui il file
/// viene aperto per davvero — decifrato se serve, controllato con
/// `PRAGMA integrity_check` e contate le tabelle — così il guaio si scopre
/// adesso e non il giorno in cui serve ripristinare.
pub fn verifica_ultimo_backup(state: &AppState, password: Option<&str>) -> Result<EsitoVerifica> {
    let cfg = read_config(state)?;
    let dir = cfg.get("dir").and_then(Value::as_str).unwrap_or("");
    let files = list_external(dir);
    let Some(primo) = files.first() else {
        anyhow::bail!("Nessun backup da verificare nella cartella impostata");
    };
    let nome = primo.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    let bytes = primo.get("size").and_then(Value::as_u64).unwrap_or(0);
    let cifrato = nome.ends_with(".db.enc");
    let percorso = Path::new(dir).join(&nome);

    let fallito = |problema: String| EsitoVerifica {
        file: nome.clone(),
        ok: false,
        cifrato,
        problema,
        tabelle: 0,
        bytes,
    };

    let dati = match std::fs::read(&percorso) {
        Ok(d) => d,
        Err(e) => return Ok(fallito(format!("il file non si legge: {e}"))),
    };
    if dati.is_empty() {
        return Ok(fallito("il file è vuoto".into()));
    }

    let chiaro = if is_encrypted(&dati) {
        match decrypt_buffer(&dati, get_key(state), password) {
            Ok(d) => d,
            Err(_) => {
                return Ok(fallito(
                    "non si riesce a decifrare: la password del backup non è quella attuale".into(),
                ))
            }
        }
    } else {
        dati
    };

    // Il database si apre da una copia temporanea: verificare il file originale
    // significherebbe rischiare di toccarlo.
    let tmp = std::env::temp_dir().join(format!("ordeva-verifica-{}.db", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, &chiaro) {
        return Ok(fallito(format!("copia di prova non scrivibile: {e}")));
    }
    let esito = controlla_db(&tmp);
    let _ = std::fs::remove_file(&tmp);

    match esito {
        Ok(tabelle) => Ok(EsitoVerifica { file: nome, ok: true, cifrato, problema: String::new(), tabelle, bytes }),
        Err(e) => Ok(fallito(e.to_string())),
    }
}
