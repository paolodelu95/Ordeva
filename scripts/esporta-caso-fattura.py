#!/usr/bin/env python3
"""Congela una fattura (o nota di credito) vera come caso del corpus di test.

    python3 scripts/esporta-caso-fattura.py <ordeva.db> <numero> [--nota] [--nome NOME]

Legge il documento dall'archivio (ordeva.db in chiaro: quello dell'app aperta,
o un backup .db non cifrato) e scrive src-tauri/tests/fatture/reale-<nome>.json
con tutte le righe di database che servono a rigenerarne l'XML.

Il repository è PUBBLICO: tutto ciò che identifica qualcuno viene sostituito
(ragioni sociali, P.IVA, codici fiscali, indirizzi, email/PEC, codici SDI,
descrizioni delle righe, note). Restano com'erano importi, quantità, aliquote,
nature, sconti, date, numeri di documento, dati fiscali: è quello che il test
deve controllare. Rileggi comunque il file prima del commit.

I valori attesi ("atteso") restano da compilare A MANO, copiandoli dalla fattura
emessa dal gestionale aziendale o dall'XML accettato dallo SDI: se li calcolasse
Ordeva, il test confermerebbe Ordeva con se stesso.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent.parent / "src-tauri" / "tests" / "fatture"


def righe(c, sql, *args):
    cur = c.execute(sql, args)
    nomi = [d[0] for d in cur.description]
    return [dict(zip(nomi, r)) for r in cur.fetchall()]


def piva_finta(n):
    return f"{n:011d}"


# Solo le colonne che la generazione XML legge. Whitelist e non blacklist:
# azienda contiene anche hash della password, SMTP, chiavi API e configurazioni,
# e una colonna aggiunta domani non deve finire in un repository pubblico.
COLONNE = {
    "azienda": {"id", "ragione_sociale", "indirizzo", "p_iva", "cod_fiscale", "email", "cap", "citta",
                "provincia", "stato", "pec", "regime_fiscale"},
    "clienti": {"id", "ragione_sociale", "via", "cap", "citta", "provincia", "stato", "codice_fiscale", "p_iva",
                "sdi", "pec", "tipo_soggetto", "cig", "cup", "estero"},
}


def solo_colonne(tabella, r):
    return {k: v for k, v in r.items() if k in COLONNE[tabella]}


def anonimizza_soggetto(r, etichetta, n, pa=False):
    """Sostituisce i dati che identificano azienda/cliente/fornitore, tenendo
    le caratteristiche che cambiano l'XML (estero o no, PA o no, SDI sì/no)."""
    estero = (r.get("stato") or "").strip().lower() not in ("", "italia")
    for k in ("ragione_sociale",):
        if k in r:
            r[k] = f"{etichetta} {n}"
    for k in ("p_iva",):
        if r.get(k):
            r[k] = f"{800000000 + n}" if estero else piva_finta(10000000000 + n)[-11:]
    for k in ("cod_fiscale", "codice_fiscale"):
        if r.get(k):
            # Persona fisica (16 caratteri) o società (11 cifre, di solito = P.IVA).
            r[k] = "RSSMRA80A01L781X" if len(r[k].strip()) == 16 else (r.get("p_iva") or piva_finta(n))
    for k, v in (("via", "Via Esempio 1"), ("indirizzo", "Via Esempio 1"),
                 ("email", f"{etichetta.lower()}{n}@example.com"), ("pec", f"{etichetta.lower()}{n}@pec.example.com")):
        if r.get(k):
            r[k] = v
    # Sede: resta solo lo stato (decide IT/estero nell'XML), il resto è neutro.
    if "cap" in r:
        r["cap"], r["citta"], r["provincia"] = ("10115", "Citta estera", "") if estero else ("00100", "Roma", "RM")
    if r.get("sdi"):
        r["sdi"] = "UFABCD" if (pa or len(r["sdi"].strip()) == 6) else ("0000000" if r["sdi"].strip() == "0000000" else "ABC1234")
    for k in ("cig", "cup"):
        if r.get(k):
            r[k] = "1234567890" if k == "cig" else "B12C34000000001"
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db")
    ap.add_argument("numero")
    ap.add_argument("--nota", action="store_true", help="il numero è di una nota di credito")
    ap.add_argument("--nome", help="nome del file (default: numero del documento)")
    a = ap.parse_args()

    c = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    tab_doc, tab_righe, fk = ("note_credito", "note_credito_righe", "nota_credito_id") if a.nota else ("fatture", "fatture_righe", "fattura_id")
    doc = righe(c, f"SELECT * FROM {tab_doc} WHERE numero=?", a.numero)
    if not doc:
        sys.exit(f"{tab_doc}: nessun documento con numero {a.numero!r}")
    doc = doc[0]
    did = doc["id"]
    tabelle = {tab_doc: [doc], tab_righe: righe(c, f"SELECT * FROM {tab_righe} WHERE {fk}=? ORDER BY id", did)}

    az = righe(c, "SELECT * FROM azienda WHERE id=1")
    tabelle["azienda"] = [anonimizza_soggetto(solo_colonne("azienda", az[0]), "Azienda", 1)] if az else []
    if doc.get("cliente_id"):
        cli = righe(c, "SELECT * FROM clienti WHERE id=?", doc["cliente_id"])
        tabelle["clienti"] = [anonimizza_soggetto(solo_colonne("clienti", r), "Cliente", 1, pa=(r.get("tipo_soggetto") == "PA")) for r in cli]
    if doc.get("tipo_pagamento_id"):
        tabelle["tipi_pagamento"] = righe(c, "SELECT * FROM tipi_pagamento WHERE id=?", doc["tipo_pagamento_id"])

    codici = sorted({r.get("codice_iva") for r in tabelle[tab_righe] if r.get("codice_iva")})
    if codici:
        tabelle["aliquote_iva"] = righe(c, f"SELECT * FROM aliquote_iva WHERE codice IN ({','.join('?' * len(codici))})", *codici)

    if a.nota:
        if doc.get("fattura_id"):
            tabelle["fatture"] = righe(c, "SELECT id, numero, data_emissione, cliente_id, stato FROM fatture WHERE id=?", doc["fattura_id"])
    else:
        tabelle["fatture_riferimenti"] = righe(c, "SELECT * FROM fatture_riferimenti WHERE fattura_id=?", did)
        tabelle["fatture_ddt"] = righe(c, "SELECT * FROM fatture_ddt WHERE fattura_id=?", did)
        ids = [r["ddt_id"] for r in tabelle["fatture_ddt"]]
        if ids:
            tabelle["ddt"] = righe(c, f"SELECT id, numero, data_emissione, cliente_id FROM ddt WHERE id IN ({','.join('?' * len(ids))})", *ids)

    # Testi liberi: possono contenere nomi, indirizzi, riferimenti a persone.
    for i, r in enumerate(tabelle[tab_righe], 1):
        if r.get("descrizione"):
            r["descrizione"] = f"Nota {i}" if r.get("tipo") == "NOTA" else f"Articolo {i}"
        for k in ("codice_prodotto", "variante_taglia", "variante_colore"):
            if r.get(k):
                r[k] = ""
        r["prodotto_id"] = None
    if doc.get("note"):
        doc["note"] = "Note del documento"
    for k in ("id_trasmissione_sdi",):
        if doc.get(k):
            doc[k] = ""
    tabelle = {k: v for k, v in tabelle.items() if v}

    caso = {
        "descrizione": "DA COMPILARE: che cosa ha di particolare questo documento",
        "origine": "reale",
        "tabelle": tabelle,
        "documento": {"tipo": "nota_credito" if a.nota else "fattura", "id": did},
        "atteso": {
            "tipo_documento": None,
            "totale": None,
            "netto_a_pagare": None,
            "riepilogo": [{"aliquota": None, "natura": None, "imponibile": None, "imposta": None}],
        },
    }
    nome = a.nome or "".join(ch if ch.isalnum() else "-" for ch in a.numero)
    out = CARTELLA / f"reale-{nome}.json"
    out.write_text(json.dumps(caso, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"scritto {out}\nora compila \"atteso\" dalla fattura vera e rileggi il file prima del commit")


if __name__ == "__main__":
    main()
