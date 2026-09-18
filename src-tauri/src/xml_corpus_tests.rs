//! Corpus di fatture: ogni file in `tests/fatture/*.json` è un documento
//! congelato con i valori che deve dare. Per ciascuno si ricrea l'archivio, si
//! genera l'XML con le vere funzioni dell'app e si controlla che:
//!
//!  1. passi lo schema XSD ufficiale FatturaPA (`xsd/`, via `xmllint`);
//!  2. tipo documento, totali, riepiloghi IVA, ritenuta, cassa e bollo siano
//!     quelli attesi — per i casi reali, quelli della fattura vera.
//!
//! Formato dei casi e come aggiungerne: `tests/fatture/README.md`.

use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::{types::Value as SqlValue, Connection};
use serde_json::Value;

use super::{build_autofattura_pa, build_fattura_pa};

fn cartella_casi() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fatture")
}

fn cartella_xsd() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("xsd")
}

/// Ricrea l'archivio del caso: schema vero, poi le righe di ogni tabella così
/// come sono nel file (le colonne sono quelle del database).
fn archivio(caso: &Value) -> Result<Connection, String> {
    let c = Connection::open_in_memory().map_err(|e| e.to_string())?;
    c.execute_batch(include_str!("schema/tenant.sql")).map_err(|e| e.to_string())?;
    // Le tabelle arrivano in ordine alfabetico, non di dipendenza.
    c.execute_batch("PRAGMA foreign_keys = OFF;").map_err(|e| e.to_string())?;
    let tabelle = caso.get("tabelle").and_then(Value::as_object).ok_or("manca \"tabelle\"")?;
    for (tabella, righe) in tabelle {
        for riga in righe.as_array().ok_or(format!("{tabella}: serve un elenco di righe"))? {
            let campi = riga.as_object().ok_or(format!("{tabella}: ogni riga è un oggetto"))?;
            let colonne: Vec<String> = campi.keys().map(|k| format!("\"{k}\"")).collect();
            let segnaposto: Vec<String> = (1..=campi.len()).map(|i| format!("?{i}")).collect();
            let valori: Vec<SqlValue> = campi
                .values()
                .map(|v| match v {
                    Value::Null => SqlValue::Null,
                    Value::Bool(b) => SqlValue::Integer(*b as i64),
                    Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap())),
                    Value::String(s) => SqlValue::Text(s.clone()),
                    altro => SqlValue::Text(altro.to_string()),
                })
                .collect();
            let sql = format!("INSERT OR REPLACE INTO \"{tabella}\" ({}) VALUES ({})", colonne.join(","), segnaposto.join(","));
            c.execute(&sql, rusqlite::params_from_iter(valori)).map_err(|e| format!("{tabella}: {e}"))?;
        }
    }
    Ok(c)
}

fn genera(c: &Connection, caso: &Value) -> Result<anyhow::Result<String>, String> {
    let doc = caso.get("documento").ok_or("manca \"documento\"")?;
    let id = doc.get("id").and_then(Value::as_i64).ok_or("documento.id mancante")?;
    Ok(match doc.get("tipo").and_then(Value::as_str) {
        Some("fattura") => build_fattura_pa(c, id, false),
        Some("nota_credito") => build_fattura_pa(c, id, true),
        Some("autofattura") => build_autofattura_pa(c, id),
        altro => return Err(format!("documento.tipo sconosciuto: {altro:?}")),
    })
}

/// Contenuto del primo `<tag>` dentro `xml`.
fn tag<'a>(xml: &'a str, nome: &str) -> Option<&'a str> {
    let apri = format!("<{nome}>");
    let i = xml.find(&apri)? + apri.len();
    let j = xml[i..].find(&format!("</{nome}>"))? + i;
    Some(&xml[i..j])
}

fn numero(xml: &str, nome: &str) -> Option<f64> {
    tag(xml, nome).and_then(|s| s.trim().parse().ok())
}

fn uguali(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.005
}

/// Confronta l'XML con `atteso`; ritorna le differenze trovate.
fn confronta(xml: &str, atteso: &Value) -> Vec<String> {
    let mut diff = Vec::new();
    let num = |k: &str| atteso.get(k).and_then(Value::as_f64);

    if let Some(t) = atteso.get("tipo_documento").and_then(Value::as_str) {
        let v = tag(xml, "TipoDocumento").unwrap_or("");
        if v != t {
            diff.push(format!("TipoDocumento {v}, atteso {t}"));
        }
    }
    for (chiave, elemento) in [
        ("totale", "ImportoTotaleDocumento"),
        ("netto_a_pagare", "ImportoPagamento"),
        ("ritenuta", "ImportoRitenuta"),
        ("cassa", "ImportoContributoCassa"),
        ("bollo", "ImportoBollo"),
    ] {
        if let Some(a) = num(chiave) {
            match numero(xml, elemento) {
                Some(v) if uguali(v, a) => {}
                v => diff.push(format!("{elemento} {v:?}, atteso {a:.2}")),
            }
        }
    }
    if let Some(attesi) = atteso.get("riepilogo").and_then(Value::as_array) {
        let blocchi: Vec<&str> = xml.split("<DatiRiepilogo>").skip(1).map(|b| b.split("</DatiRiepilogo>").next().unwrap_or("")).collect();
        if blocchi.len() != attesi.len() {
            diff.push(format!("{} blocchi DatiRiepilogo, attesi {}", blocchi.len(), attesi.len()));
        }
        for (i, (b, a)) in blocchi.iter().zip(attesi).enumerate() {
            let n = i + 1;
            for (chiave, elemento) in [("aliquota", "AliquotaIVA"), ("imponibile", "ImponibileImporto"), ("imposta", "Imposta")] {
                let atteso = a.get(chiave).and_then(Value::as_f64).unwrap_or(0.0);
                match numero(b, elemento) {
                    Some(v) if uguali(v, atteso) => {}
                    v => diff.push(format!("riepilogo {n}: {elemento} {v:?}, atteso {atteso:.2}")),
                }
            }
            let natura = a.get("natura").and_then(Value::as_str);
            if tag(b, "Natura") != natura {
                diff.push(format!("riepilogo {n}: Natura {:?}, attesa {natura:?}", tag(b, "Natura")));
            }
            if let Some(e) = a.get("esigibilita").and_then(Value::as_str) {
                if tag(b, "EsigibilitaIVA") != Some(e) {
                    diff.push(format!("riepilogo {n}: EsigibilitaIVA {:?}, attesa {e}", tag(b, "EsigibilitaIVA")));
                }
            }
        }
    }
    for s in atteso.get("contiene").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        if !xml.contains(s) {
            diff.push(format!("manca {s}"));
        }
    }
    for s in atteso.get("non_contiene").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        if xml.contains(s) {
            diff.push(format!("non doveva esserci {s}"));
        }
    }
    diff
}

/// `xmllint` c'è su macOS e Linux (libxml2-utils). Senza, in locale la
/// validazione XSD si salta con un avviso; in CI (`CI` impostata) è un errore,
/// così lo schema non smette di essere controllato senza che nessuno se ne accorga.
fn xmllint_disponibile() -> bool {
    let ok = Command::new("xmllint").arg("--version").output().map(|o| o.status.success()).unwrap_or(false);
    if !ok {
        assert!(std::env::var_os("CI").is_none(), "xmllint non trovato: in CI la validazione XSD è obbligatoria");
        eprintln!("ATTENZIONE: xmllint non trovato, validazione XSD saltata");
    }
    ok
}

/// Valida contro lo schema ufficiale: uno solo per PA (FPA12) e privati (FPR12),
/// vedi `xsd/README.md`.
fn valida_xsd(xml: &str, nome: &str) -> Result<(), String> {
    let file = std::env::temp_dir().join(format!("ordeva-xsd-{}-{nome}.xml", std::process::id()));
    std::fs::write(&file, xml).map_err(|e| e.to_string())?;
    let out = Command::new("xmllint")
        .args(["--noout", "--nonet", "--schema"])
        .arg(cartella_xsd().join("FatturaPA.xsd"))
        .arg(&file)
        .output()
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&file);
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).lines().filter(|l| !l.ends_with("fails to validate")).collect::<Vec<_>>().join("\n    "))
    }
}

#[test]
fn corpus_fatture() {
    let mut casi: Vec<PathBuf> = std::fs::read_dir(cartella_casi())
        .expect("cartella tests/fatture")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    casi.sort();
    assert!(!casi.is_empty(), "nessun caso in tests/fatture");
    let xsd = xmllint_disponibile();

    let mut fallimenti: Vec<String> = Vec::new();
    for percorso in &casi {
        let nome = percorso.file_stem().unwrap().to_string_lossy().to_string();
        let caso: Value = match std::fs::read_to_string(percorso).map_err(|e| e.to_string()).and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string())) {
            Ok(v) => v,
            Err(e) => {
                fallimenti.push(format!("{nome}: file illeggibile: {e}"));
                continue;
            }
        };
        let atteso = caso.get("atteso").cloned().unwrap_or(Value::Null);
        let risultato = archivio(&caso).and_then(|c| genera(&c, &caso));
        let problemi: Vec<String> = match (risultato, atteso.get("errore").and_then(Value::as_str)) {
            (Err(e), _) => vec![format!("caso non caricabile: {e}")],
            (Ok(Err(e)), Some(msg)) if e.to_string().contains(msg) => vec![],
            (Ok(Err(e)), _) => vec![format!("generazione fallita: {e}")],
            (Ok(Ok(_)), Some(msg)) => vec![format!("doveva fermarsi con \"{msg}\", invece ha generato l'XML")],
            (Ok(Ok(xml)), None) => {
                let mut p = confronta(&xml, &atteso);
                // Un caso senza valori attesi controllerebbe solo lo schema:
                // falsa sicurezza. Tipo e totale vanno sempre dichiarati.
                for chiave in ["tipo_documento", "totale"] {
                    if atteso.get(chiave).is_none_or(Value::is_null) {
                        p.push(format!("atteso.{chiave} mancante: copialo dalla fattura vera"));
                    }
                }
                if xsd {
                    if let Err(e) = valida_xsd(&xml, &nome) {
                        p.push(format!("schema XSD:\n    {e}"));
                    }
                }
                p
            }
        };
        if !problemi.is_empty() {
            fallimenti.push(format!("{nome}:\n  - {}", problemi.join("\n  - ")));
        }
    }
    assert!(fallimenti.is_empty(), "{} casi su {} non tornano:\n\n{}", fallimenti.len(), casi.len(), fallimenti.join("\n\n"));
}
