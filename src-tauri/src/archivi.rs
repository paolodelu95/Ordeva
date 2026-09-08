//! Multi-archivio.
//!
//! Un "archivio" è un database di lavoro indipendente: clienti, prodotti, documenti…
//! di un'attività. Più archivi convivono, ciascuno protetto (cifrato a riposo) da una
//! password propria, e si scelgono all'avvio.
//!
//! **Modello:** ogni archivio è una cartella autonoma sotto `<data_dir>/archivi/<slug>/`,
//! con dentro lo stesso identico contenuto di una cartella dati a archivio singolo
//! (`ordeva.db`/`ordeva.db.enc`, `backups/`, allegati, `ordeva.lock`). L'archivio "attivo"
//! è semplicemente quello la cui cartella viene usata come data_dir dall'app: così TUTTA
//! la macchina esistente (db.rs, atrest.rs, backup.rs) funziona per-archivio senza modifiche.
//!
//! Un `index.json` nella cartella `archivi/` tiene l'elenco (slug, nome, cifrato) e qual è
//! l'archivio corrente.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::config::copy_dir_all;
use crate::db::DB_FILE;

pub const ARCHIVI_DIR: &str = "archivi";
const INDEX_FILE: &str = "index.json";

/// Voce dell'elenco archivi (serializzata in index.json e verso il frontend).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Archivio {
    pub slug: String,
    pub nome: String,
    /// True se l'archivio è protetto da password (cifrato a riposo: esiste il `.enc`).
    #[serde(default)]
    pub cifrato: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    #[serde(default)]
    archivi: Vec<Archivio>,
    #[serde(default)]
    corrente: Option<String>,
}

/// Cartella che contiene tutti gli archivi: `<data_dir>/archivi`.
pub fn archivi_root(data_dir: &Path) -> PathBuf {
    data_dir.join(ARCHIVI_DIR)
}

/// Cartella di un singolo archivio: `<data_dir>/archivi/<slug>`.
pub fn archivio_dir(data_dir: &Path, slug: &str) -> PathBuf {
    archivi_root(data_dir).join(slug)
}

fn index_path(data_dir: &Path) -> PathBuf {
    archivi_root(data_dir).join(INDEX_FILE)
}

fn load_index(data_dir: &Path) -> Index {
    std::fs::read_to_string(index_path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_index(data_dir: &Path, idx: &Index) -> Result<()> {
    let p = index_path(data_dir);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(idx)?;
    std::fs::write(&p, json).with_context(|| format!("scrittura {:?}", p))?;
    Ok(())
}

/// File con l'hash (bcrypt) della password di accesso all'archivio. Modello "blocco
/// d'accesso": il DB di lavoro resta IN CHIARO (niente cifra-e-cancella che gli antivirus
/// scambiano per ransomware); la password serve a sbloccare l'archivio in apertura e a
/// cifrare i backup. Sta in un file a parte così si verifica prima di aprire il DB.
fn pwd_path(dir: &Path) -> PathBuf {
    dir.join("ordeva.pwd")
}

/// True se l'archivio è protetto da password: c'è il file hash `ordeva.pwd` oppure (vecchio
/// modello, fino alla migrazione al primo sblocco) il file cifrato `.enc`.
fn is_cifrato(dir: &Path) -> bool {
    pwd_path(dir).exists() || dir.join(format!("{DB_FILE}.enc")).is_file()
}

/// True se l'archivio ha una password (nuovo modello: file `ordeva.pwd`).
pub fn has_pwd(dir: &Path) -> bool {
    pwd_path(dir).exists()
}

/// Imposta la password di accesso dell'archivio (salva l'hash bcrypt).
pub fn set_pwd(dir: &Path, password: &str) -> Result<()> {
    let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).context("hash password")?;
    std::fs::write(pwd_path(dir), hash).with_context(|| format!("scrittura {:?}", pwd_path(dir)))?;
    Ok(())
}

/// Rimuove la password di accesso dell'archivio (best-effort).
pub fn remove_pwd(dir: &Path) {
    let _ = std::fs::remove_file(pwd_path(dir));
}

/// Verifica la password di accesso contro l'hash salvato.
pub fn verify_pwd(dir: &Path, password: &str) -> bool {
    match std::fs::read_to_string(pwd_path(dir)) {
        Ok(h) => bcrypt::verify(password, h.trim()).unwrap_or(false),
        Err(_) => false,
    }
}

/// Ricalcola il flag `cifrato` di ogni archivio dal contenuto su disco e salva l'indice.
/// Da chiamare dopo operazioni che cambiano lo stato di cifratura.
pub fn risincronizza_cifrati(data_dir: &Path) -> Result<()> {
    let mut idx = load_index(data_dir);
    for a in &mut idx.archivi {
        a.cifrato = is_cifrato(&archivio_dir(data_dir, &a.slug));
    }
    save_index(data_dir, &idx)
}

/// Slug ASCII unico a partire da un nome libero.
pub fn slugify(nome: &str, esistenti: &[String]) -> String {
    let mut base = String::new();
    let mut prev_dash = false;
    for c in nome.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            base.push(c);
            prev_dash = false;
        } else if !prev_dash {
            base.push('-');
            prev_dash = true;
        }
    }
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() { "archivio".to_string() } else { base };
    // Windows non permette cartelle con questi nomi (dispositivi riservati), a
    // prescindere dall'estensione: creare la cartella dell'archivio fallirebbe in
    // silenzio più avanti. Li disambiguiamo qui, alla fonte.
    const RISERVATI_WINDOWS: &[&str] = &[
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    let base = if RISERVATI_WINDOWS.contains(&base.as_str()) {
        format!("{base}-archivio")
    } else {
        base
    };
    let mut slug = base.clone();
    let mut n = 2;
    while esistenti.iter().any(|s| s == &slug) {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

/// Elenco archivi.
pub fn list(data_dir: &Path) -> Vec<Archivio> {
    load_index(data_dir).archivi
}

/// Slug dell'archivio corrente (se impostato e ancora esistente).
pub fn corrente(data_dir: &Path) -> Option<String> {
    let idx = load_index(data_dir);
    let cur = idx.corrente?;
    if idx.archivi.iter().any(|a| a.slug == cur) {
        Some(cur)
    } else {
        None
    }
}

/// Imposta l'archivio corrente.
pub fn set_corrente(data_dir: &Path, slug: &str) -> Result<()> {
    let mut idx = load_index(data_dir);
    if !idx.archivi.iter().any(|a| a.slug == slug) {
        bail!("Archivio inesistente: {slug}");
    }
    idx.corrente = Some(slug.to_string());
    save_index(data_dir, &idx)
}

/// Dati di un archivio per slug.
pub fn get(data_dir: &Path, slug: &str) -> Option<Archivio> {
    load_index(data_dir).archivi.into_iter().find(|a| a.slug == slug)
}

fn slugs(idx: &Index) -> Vec<String> {
    idx.archivi.iter().map(|a| a.slug.clone()).collect()
}

/// Crea un nuovo archivio VUOTO (lo schema del DB viene creato al primo avvio dall'app).
/// Ritorna la voce creata.
pub fn crea(data_dir: &Path, nome: &str) -> Result<Archivio> {
    let mut idx = load_index(data_dir);
    let slug = slugify(nome, &slugs(&idx));
    let dir = archivio_dir(data_dir, &slug);
    std::fs::create_dir_all(&dir).with_context(|| format!("creazione cartella {:?}", dir))?;
    let a = Archivio { slug, nome: nome.trim().to_string(), cifrato: false };
    idx.archivi.push(a.clone());
    save_index(data_dir, &idx)?;
    Ok(a)
}

/// Duplica un archivio (copia DB in chiaro o cifrato + backup). Se l'originale è cifrato,
/// la copia resta cifrata con la STESSA password.
pub fn duplica(data_dir: &Path, slug: &str, nuovo_nome: &str) -> Result<Archivio> {
    let mut idx = load_index(data_dir);
    if !idx.archivi.iter().any(|a| a.slug == slug) {
        bail!("Archivio inesistente: {slug}");
    }
    let nuovo_slug = slugify(nuovo_nome, &slugs(&idx));
    let src = archivio_dir(data_dir, slug);
    let dst = archivio_dir(data_dir, &nuovo_slug);
    copy_dir_all(&src, &dst).with_context(|| format!("duplica {:?} -> {:?}", src, dst))?;
    // La copia è una sessione nuova: niente lock ereditato.
    let _ = std::fs::remove_file(dst.join("ordeva.lock"));
    let a = Archivio {
        slug: nuovo_slug,
        nome: nuovo_nome.trim().to_string(),
        cifrato: is_cifrato(&dst),
    };
    idx.archivi.push(a.clone());
    save_index(data_dir, &idx)?;
    Ok(a)
}

/// Elimina un archivio (cartella + voce). Non si può eliminare l'archivio corrente.
pub fn elimina(data_dir: &Path, slug: &str) -> Result<()> {
    let mut idx = load_index(data_dir);
    if idx.corrente.as_deref() == Some(slug) {
        bail!("Non puoi eliminare l'archivio attualmente in uso");
    }
    let dir = archivio_dir(data_dir, slug);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).with_context(|| format!("rimozione {:?}", dir))?;
    }
    idx.archivi.retain(|a| a.slug != slug);
    save_index(data_dir, &idx)
}

/// Rinomina un archivio (solo etichetta; lo slug/cartella restano).
pub fn rinomina(data_dir: &Path, slug: &str, nuovo_nome: &str) -> Result<()> {
    let mut idx = load_index(data_dir);
    let a = idx
        .archivi
        .iter_mut()
        .find(|a| a.slug == slug)
        .context("Archivio inesistente")?;
    a.nome = nuovo_nome.trim().to_string();
    save_index(data_dir, &idx)
}

/// Importa un file di archivio (`.db` in chiaro o `.db.enc` cifrato) come nuovo archivio.
pub fn importa(data_dir: &Path, file: &Path, nome: &str) -> Result<Archivio> {
    if !file.is_file() {
        bail!("File non trovato");
    }
    let bytes = std::fs::read(file).with_context(|| format!("lettura {:?}", file))?;
    let cifrato = crate::backup::is_encrypted(&bytes);
    let mut idx = load_index(data_dir);
    let slug = slugify(nome, &slugs(&idx));
    let dir = archivio_dir(data_dir, &slug);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(if cifrato { format!("{DB_FILE}.enc") } else { DB_FILE.to_string() });
    std::fs::write(&dest, &bytes).with_context(|| format!("scrittura {:?}", dest))?;
    let a = Archivio { slug, nome: nome.trim().to_string(), cifrato };
    idx.archivi.push(a.clone());
    save_index(data_dir, &idx)?;
    Ok(a)
}

/// Percorso del file da esportare per un archivio: il `.enc` se cifrato (esce così com'è,
/// serve la password per riaprirlo), altrimenti il `.db` in chiaro.
pub fn file_da_esportare(data_dir: &Path, slug: &str) -> Result<PathBuf> {
    let dir = archivio_dir(data_dir, slug);
    let enc = dir.join(format!("{DB_FILE}.enc"));
    let plain = dir.join(DB_FILE);
    if enc.is_file() {
        Ok(enc)
    } else if plain.is_file() {
        Ok(plain)
    } else {
        bail!("L'archivio non ha ancora dati da esportare")
    }
}

/// Esporta (copia) il file dell'archivio nella destinazione scelta.
pub fn esporta(data_dir: &Path, slug: &str, dest: &Path) -> Result<()> {
    let src = file_da_esportare(data_dir, slug)?;
    std::fs::copy(&src, dest).with_context(|| format!("export {:?} -> {:?}", src, dest))?;
    Ok(())
}

/// Sposta un file se esiste (rename; fallback copia+rimozione tra volumi diversi).
fn sposta(from: &Path, to: &Path) {
    if !from.is_file() {
        return;
    }
    if std::fs::rename(from, to).is_err() && std::fs::copy(from, to).is_ok() {
        let _ = std::fs::remove_file(from);
    }
}

/// Migrazione one-time dal modello a archivio singolo: se l'indice non esiste ancora ma
/// nel data_dir c'è un DB (`ordeva.db`/`.enc` + `backups/`), lo sposta in `archivi/<slug>/`
/// come primo archivio corrente. Su installazione pulita crea solo un indice vuoto (sarà il
/// selettore a creare il primo archivio). Idempotente.
pub fn migra_da_singolo(data_dir: &Path) -> Result<()> {
    if index_path(data_dir).exists() {
        return Ok(());
    }
    std::fs::create_dir_all(archivi_root(data_dir))?;
    let mut idx = Index::default();
    let plain = data_dir.join(DB_FILE);
    let enc = data_dir.join(format!("{DB_FILE}.enc"));
    if plain.is_file() || enc.is_file() {
        let nome = "Il mio archivio";
        let slug = slugify(nome, &[]);
        let dir = archivio_dir(data_dir, &slug);
        std::fs::create_dir_all(&dir)?;
        sposta(&plain, &dir.join(DB_FILE));
        sposta(&enc, &dir.join(format!("{DB_FILE}.enc")));
        if data_dir.join("backups").is_dir() {
            let _ = std::fs::rename(data_dir.join("backups"), dir.join("backups"));
        }
        let _ = std::fs::remove_file(data_dir.join("ordeva.lock"));
        idx.archivi.push(Archivio {
            slug: slug.clone(),
            nome: nome.to_string(),
            cifrato: is_cifrato(&dir),
        });
        idx.corrente = Some(slug);
    }
    save_index(data_dir, &idx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static SEQ: AtomicU32 = AtomicU32::new(0);
    fn tmp() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let p = std::env::temp_dir().join(format!("ordeva-arch-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn slug_unico_e_ascii() {
        assert_eq!(slugify("Azienda Rossi S.r.l.", &[]), "azienda-rossi-s-r-l");
        assert_eq!(slugify("  ", &[]), "archivio");
        let esist = vec!["mio".to_string(), "mio-2".to_string()];
        assert_eq!(slugify("Mio", &esist), "mio-3");
    }

    /// Su Windows una cartella chiamata "con", "prn", "nul", "com1"... non si può creare
    /// (nome di dispositivo riservato dal sistema): la creazione dell'archivio fallirebbe
    /// in modo silenzioso e fuorviante. Verifichiamo che lo slug li disambigui sempre.
    #[test]
    fn slug_evita_nomi_riservati_windows() {
        assert_eq!(slugify("CON", &[]), "con-archivio");
        assert_eq!(slugify("con", &[]), "con-archivio");
        assert_eq!(slugify("Nul", &[]), "nul-archivio");
        assert_eq!(slugify("COM1", &[]), "com1-archivio");
        assert_eq!(slugify("LPT9", &[]), "lpt9-archivio");
        // Non riservato: passa invariato.
        assert_eq!(slugify("Console", &[]), "console");
    }

    #[test]
    fn crea_lista_corrente() {
        let dir = tmp();
        let a = crea(&dir, "Negozio A").unwrap();
        assert_eq!(a.slug, "negozio-a");
        assert!(archivio_dir(&dir, "negozio-a").is_dir());
        set_corrente(&dir, "negozio-a").unwrap();
        assert_eq!(corrente(&dir).as_deref(), Some("negozio-a"));
        assert_eq!(list(&dir).len(), 1);
    }

    #[test]
    fn migrazione_da_singolo() {
        let dir = tmp();
        // Simula un'installazione a archivio singolo (db + backups nella radice).
        std::fs::write(dir.join(DB_FILE), b"SQLite format 3\0dati").unwrap();
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::write(dir.join("backups").join("b1.db"), b"x").unwrap();

        migra_da_singolo(&dir).unwrap();
        let adir = archivio_dir(&dir, "il-mio-archivio");
        assert!(adir.join(DB_FILE).is_file(), "db spostato nell'archivio");
        assert!(adir.join("backups").join("b1.db").is_file(), "backups spostati");
        assert!(!dir.join(DB_FILE).is_file(), "db rimosso dalla radice (niente copia in chiaro)");
        assert_eq!(corrente(&dir).as_deref(), Some("il-mio-archivio"));

        // Idempotente: una seconda chiamata non duplica nulla.
        migra_da_singolo(&dir).unwrap();
        assert_eq!(list(&dir).len(), 1);
    }

    #[test]
    fn migrazione_installazione_pulita() {
        let dir = tmp();
        // Nessun db: crea solo un indice vuoto (sarà il selettore a creare il primo).
        migra_da_singolo(&dir).unwrap();
        assert!(list(&dir).is_empty());
        assert_eq!(corrente(&dir), None);
    }

    #[test]
    fn elimina_non_corrente() {
        let dir = tmp();
        crea(&dir, "A").unwrap();
        let b = crea(&dir, "B").unwrap();
        set_corrente(&dir, "a").unwrap();
        // l'archivio corrente non si elimina
        assert!(elimina(&dir, "a").is_err());
        // un altro sì
        elimina(&dir, &b.slug).unwrap();
        assert_eq!(list(&dir).len(), 1);
        assert!(!archivio_dir(&dir, &b.slug).exists());
    }
}
