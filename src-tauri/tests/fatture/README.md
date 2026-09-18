# Corpus di fatture

Ogni file `.json` di questa cartella è un documento congelato con i valori che
deve dare. Il test `xml::corpus::corpus_fatture` (`cargo test corpus`) lo
ricarica in un archivio vuoto, genera l'XML con le vere funzioni dell'app e
controlla:

1. che passi lo schema XSD ufficiale FatturaPA (`src-tauri/xsd/`, con `xmllint`);
2. che tipo documento, totali, riepiloghi IVA, ritenuta, cassa e bollo siano
   quelli attesi.

Se una modifica cambia anche solo un centesimo su un caso, il test lo dice.

## Casi sintetici e casi reali

- `NN-*.json` (`"origine": "sintetico"`): scritti a mano, uno per ogni
  situazione (differita da DDT, esente con bollo, forfettario, PA, estero, …).
  I totali attesi sono calcolati a mano.
- `reale-*.json` (`"origine": "reale"`): fatture vere, anonimizzate. Valgono
  di più, perché i valori attesi vengono da un altro programma.

## Aggiungere un caso reale

```sh
python3 scripts/esporta-caso-fattura.py <percorso>/ordeva.db 2026/123
python3 scripts/esporta-caso-fattura.py <percorso>/ordeva.db NC-2026/4 --nota
```

`ordeva.db` è l'archivio in chiaro (quello dell'app aperta) o un backup `.db`
non cifrato. Lo script scrive `reale-<numero>.json` e sostituisce tutto ciò che
identifica qualcuno: nomi, P.IVA, codici fiscali, indirizzi, contatti, codici
SDI, descrizioni delle righe e note. Il repository è pubblico.

Poi, a mano:

1. **Compila `atteso`** copiando i valori dalla stessa fattura emessa dal
   gestionale aziendale, o dall'XML che lo SDI ha accettato. Non da Ordeva:
   altrimenti il test confronta Ordeva con se stesso. `tipo_documento` e
   `totale` sono obbligatori.
2. **Scrivi `descrizione`**: che cosa ha di particolare questo documento.
3. **Rileggi il file** prima del commit.
4. `cargo test corpus`. Se non torna, hai trovato una differenza tra Ordeva e
   il gestionale: prima di aggiustare il caso, capisci chi dei due ha ragione.

Scegli documenti diversi tra loro, non 30 fatture uguali: più aliquote, sconti,
righe a IVA 0% con nature diverse, DDT di mesi diversi, note di credito, clienti
PA ed esteri, ritenuta e cassa, bollo, importi con arrotondamenti al centesimo.

## Formato

```jsonc
{
  "descrizione": "…",
  "origine": "sintetico" | "reale",
  // Righe da inserire, tabella per tabella, con i nomi delle colonne del database.
  "tabelle": { "azienda": [{…}], "clienti": [{…}], "fatture": [{…}], "fatture_righe": [{…}], … },
  // Documento da generare: "fattura", "nota_credito" o "autofattura".
  "documento": { "tipo": "fattura", "id": 1 },
  "atteso": {
    "tipo_documento": "TD24",       // obbligatorio
    "totale": 164.70,               // ImportoTotaleDocumento, obbligatorio
    "netto_a_pagare": 164.70,       // ImportoPagamento
    "ritenuta": 200, "cassa": 40, "bollo": 2,
    "riepilogo": [                  // i DatiRiepilogo, nell'ordine dell'XML
      { "aliquota": 22, "natura": null, "imponibile": 135, "imposta": 29.70, "esigibilita": "I" }
    ],
    "contiene": ["<NumeroDDT>D-101</NumeroDDT>"],   // frammenti che devono esserci
    "non_contiene": ["…"],                          // …e che non devono esserci
    "errore": "…"                   // in alternativa: la generazione deve fermarsi con questo messaggio
  }
}
```

Le chiavi di `atteso` diverse da `tipo_documento` e `totale` si controllano
solo se presenti.
