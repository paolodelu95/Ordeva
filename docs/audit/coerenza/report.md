# Audit di coerenza delle schermate

Generato da `scripts/coerenza-audit.mjs` il 2026-09-18 21:52 — 38 rotte, desktop 1280/1440/1920, chiaro e scuro, dati pieni e vuoti.

## Standard e deviazioni

| Elemento | Standard (più usato) | Adesione | Schermate che deviano |
|---|---|---|---|
| Intestazione: usa .page-header | `true` | 38/38 | — |
| Titolo: classe .page-title | `true` | 38/38 | — |
| Titolo: dimensione/peso | `"19px/700"` | 38/38 | — |
| Titolo: posizione nel contenuto (sx,alto) | `"20,16"` | 37/38 | /agenda `"20,21"` |
| Azione primaria: altezza/raggio/font | `"38px r8px 14px"` | 24/24 | — |
| Contenuto in .card | `true` | 35/38 | /portachiavi `false`, /lavagna `false`, /aiuto `false` |
| Raggio card | `"12px"` | 31/35 | /riconciliazione `"10px"`, /reports `"10px"`, /ocr-fatture `"16px"`, /agenda `"10px"` |
| Tabella: Material | `true` | 17/25 | /agenti `false`, /vendita-banco `false`, /listini `false`, /storico `false`, /compliance `false`, /marketplace `false` … (+2) |
| Tabella: intestazione colonne (font/peso/maiusc.) | `"11px/600/MAIUSC"` | 18/25 | /agenti `"11px/700/MAIUSC"`, /listini `"12px/700/MAIUSC"`, /storico `"11px/700/MAIUSC"`, /compliance `"11px/700/MAIUSC"`, /marketplace `"11px/700/MAIUSC"`, /autofatture `"11px/700/MAIUSC"` … (+1) |
| Tabella: altezza intestazione | `48` | 14/25 | /prodotti `53`, /agenti `31`, /arrivi-merce `53`, /vendita-banco `31`, /listini `28`, /fatture-ricorrenti `53` … (+5) |
| Tabella: altezza riga | `46` | 10/24 | /dashboard `44`, /prodotti `53`, /agenti `49`, /pagamenti `57`, /magazzino `44`, /arrivi-merce `53` … (+8) |
| Tabella: font celle | `13` | 22/24 | /storico `12`, /autofatture `13.5` |
| Campi: aspetto Material | `"outline"` | 27/27 | — |
| Font: famiglia unica | `"Inter"` | 36/38 | /sdi-passive `"Inter+monospace"`, /aiuto `"Inter+SF Mono"` |
| Liste: stato vuoto dedicato | `true` | 20/25 | /agenti `false`, /arrivi-merce `false`, /vendita-banco `false`, /compliance `false`, /marketplace `false` |
| Dialog: schema intestazione | `"dialog-hero"` | 12/18 | /pagamenti `"mat-dialog-title"`, /magazzino `"mat-dialog-title"`, /arrivi-merce `"mat-dialog-title"`, /listini `"mat-dialog-title"`, /agenda `"mat-dialog-title"`, /rubrica `"mat-dialog-title"` |
| Dialog: titolo font/peso | `"14px/700"` | 12/18 | /pagamenti `"24px/700"`, /magazzino `"24px/700"`, /arrivi-merce `"24px/700"`, /listini `"24px/700"`, /agenda `"24px/700"`, /rubrica `"24px/700"` |
| Dialog: azioni allineate | `"flex-end"` | 18/18 | — |
| Dialog: bottone principale per ultimo | `true` | 17/18 | /arrivi-merce `false` |
| Dialog: raggio | `"16px"` | 18/18 | — |

## Bottoni: combinazioni per variante

Una variante coerente ha **una** combinazione (due al massimo: normale e compatta).

- **pieno** — 1 combinazioni: `38px r8px 14px/600` (33 schermate)
- **contorno** — 2 combinazioni: `38px r8px 14px/600` (23 schermate) · `38px r8px 13px/600` (1 schermate)
- **testo** — 2 combinazioni: `30px r6px 12px/600` (1 schermate) · `32px r9999px 14px/500` (1 schermate)
- **icona** — 1 combinazioni: `32px r9999px 24px/400` (28 schermate)
- **toggle** — 1 combinazioni: `40px r0px 14px/500` (2 schermate)
- **custom** — 10 combinazioni: `20px r0px 11px/600 MAIUSC` (16 schermate) · `14px r0px 11px/700 MAIUSC` (4 schermate) · `40px r0px 11px/600 MAIUSC` (2 schermate) · `32px r0px 13.3px/400` (2 schermate) · `38px r10px 16px/400` (1 schermate) · `80px r8px 12px/700` (1 schermate) · `32px r9px 14px/600` (1 schermate) · `32px r9px 14px/400` (1 schermate)

**Bottoni fuori da Material** (stile fatto a mano): 3 schermate — /fatture-elettroniche (9), /vendita-banco (5), /impostazioni (14)

## Tipografia e icone

- Dimensioni di testo in uso: 13px×3030, 12px×1303, 14px×830, 24px×500, 11px×411, 16px×366, 18px×222, 20px×52, 11.5px×51, 19px×38, 15px×30, 26px×27, 13.5px×18, 10px×17, 12.5px×15, 10.5px×5, 22px×3, 18.7px×2, 44px×2, 17px×1, 56px×1, 36px×1
- Dimensioni icone in uso: 24px×498, 14px×299, 18px×214, 16px×50, 20px×41, 12px×25, 26px×5, 22px×3, 44px×2, 11px×1, 56px×1, 36px×1

## Colori fuori dai token

Colori calcolati che non corrispondono a nessuna variabile di `:root` (per tema).

| Tema, proprietà, colore | Occorrenze | Schermate | Esempio |
|---|---|---|---|
| chiaro testo rgb(21, 128, 61) | 28 | 5 | `.alert-chip` |
| scuro testo rgb(21, 128, 61) | 28 | 5 | `.alert-chip` |
| scuro testo rgb(100, 116, 139) | 19 | 5 | `.righe-empty` |
| chiaro sfondo rgb(220, 38, 38) | 6 | 4 | `.cashflow-accent` |
| scuro sfondo rgb(220, 38, 38) | 6 | 4 | `.cashflow-accent` |
| chiaro sfondo rgb(219, 234, 254) | 34 | 3 | `span` |
| chiaro sfondo rgb(22, 163, 74) | 5 | 3 | `.cashflow-accent` |
| scuro sfondo rgb(219, 234, 254) | 34 | 3 | `span` |
| scuro sfondo rgb(22, 163, 74) | 5 | 3 | `.cashflow-accent` |
| chiaro testo rgb(29, 78, 216) | 14 | 2 | `.kpi-value` |
| scuro testo rgb(185, 28, 28) | 10 | 2 | `.ritardo` |
| scuro sfondo rgb(254, 226, 226) | 8 | 2 | `.chip` |
| chiaro testo rgb(148, 163, 184) | 8 | 2 | `.nav-group-title` |
| chiaro sfondo rgb(220, 252, 231) | 24 | 2 | `.freq-chip` |
| scuro sfondo rgb(220, 252, 231) | 24 | 2 | `.freq-chip` |
| chiaro bordo rgba(239, 68, 68, 0.2) | 1 | 1 | `.alert-chip` |
| chiaro sfondo rgba(34, 197, 94, 0.12) | 1 | 1 | `.alert-chip` |
| chiaro bordo rgba(34, 197, 94, 0.2) | 1 | 1 | `.alert-chip` |
| chiaro bordo rgba(245, 158, 11, 0.2) | 2 | 1 | `.alert-chip` |
| chiaro sfondo rgba(139, 92, 246, 0.12) | 1 | 1 | `.alert-chip` |
| chiaro bordo rgba(139, 92, 246, 0.2) | 1 | 1 | `.alert-chip` |
| chiaro bordo rgba(14, 165, 233, 0.2) | 2 | 1 | `.alert-chip` |
| chiaro testo rgb(30, 64, 175) | 1 | 1 | `span` |
| chiaro sfondo rgba(239, 68, 68, 0.04) | 85 | 1 | `.mat-mdc-row` |
| scuro bordo rgba(239, 68, 68, 0.2) | 1 | 1 | `.alert-chip` |
| scuro sfondo rgba(34, 197, 94, 0.12) | 1 | 1 | `.alert-chip` |
| scuro bordo rgba(34, 197, 94, 0.2) | 1 | 1 | `.alert-chip` |
| scuro bordo rgba(245, 158, 11, 0.2) | 2 | 1 | `.alert-chip` |
| scuro testo rgb(109, 40, 217) | 2 | 1 | `.alert-chip` |
| scuro sfondo rgba(139, 92, 246, 0.12) | 1 | 1 | `.alert-chip` |
| scuro bordo rgba(139, 92, 246, 0.2) | 1 | 1 | `.alert-chip` |
| scuro bordo rgba(14, 165, 233, 0.2) | 2 | 1 | `.alert-chip` |
| scuro testo rgb(30, 64, 175) | 1 | 1 | `span` |
| scuro sfondo rgba(239, 68, 68, 0.04) | 30 | 1 | `.mat-mdc-row` |
| chiaro sfondo rgb(239, 68, 68) | 1 | 1 | `span` |
| scuro sfondo rgb(239, 68, 68) | 1 | 1 | `span` |
| chiaro sfondo rgb(14, 116, 144) | 1 | 1 | `span` |
| scuro sfondo rgb(14, 116, 144) | 1 | 1 | `span` |
| chiaro sfondo rgb(217, 119, 6) | 1 | 1 | `.kpi-accent` |
| scuro sfondo rgb(217, 119, 6) | 1 | 1 | `.kpi-accent` |

## Usabilità

| Schermata | Contrasto basso (chiaro / scuro) | Bersagli < 24px | Testo < 12px | Testo tagliato | Overflow 1280 | Stato vuoto | Importi non a destra |
|---|---|---|---|---|---|---|---|
| /dashboard | 11 / 4 | 0 | 30 | 0 | — | sì | — |
| /prodotti | 1 / 1 | 4 | 8 | 0 | — | sì | — |
| /clienti | 0 / 0 | 4 | 4 | 0 | — | sì | — |
| /fornitori | 0 / 0 | 4 | 4 | 0 | — | sì | — |
| /agenti | 0 / 0 | 4 | 6 | 0 | — | **no** | — |
| /ddt | 0 / 0 | 5 | 7 | 0 | — | sì | — |
| /fatture | 0 / 0 | 5 | 8 | 0 | — | sì | — |
| /fatture-elettroniche | 2 / 0 | 0 | 26 | 0 | — | **no** | — |
| /note-credito | 0 / 0 | 5 | 5 | 0 | — | sì | — |
| /ordini | 0 / 0 | 5 | 5 | 0 | — | sì | — |
| /preventivi | 0 / 0 | 5 | 5 | 0 | — | sì | — |
| /acquisti | 0 / 0 | 6 | 6 | 0 | — | sì | — |
| /ordini-fornitore | 0 / 0 | 6 | 6 | 0 | — | sì | — |
| /pagamenti | 11 / 0 | 8 | 38 | 0 | — | sì | 105 |
| /scadenzario | 94 / 0 | 7 | 7 | 0 | — | sì | — |
| /scadenze-fiscali | 0 / 8 | 0 | 12 | 0 | — | **no** | — |
| /magazzino | 25 / 1 | 3 | 58 | 0 | — | sì | — |
| /arrivi-merce | 0 / 0 | 5 | 6 | 0 | — | **no** | — |
| /vendita-banco | 0 / 2 | 0 | 9 | 0 | — | **no** | — |
| /report | 2 / 0 | 0 | 0 | 0 | — | **no** | — |
| /impostazioni | 5 / 7 | 0 | 4 | 0 | — | **no** | — |
| /archivi | 1 / 0 | 0 | 2 | 0 | — | **no** | — |
| /listini | 0 / 0 | 0 | 0 | 0 | — | sì | — |
| /prima-nota | 1 / 0 | 3 | 6 | 0 | — | sì | — |
| /fatture-ricorrenti | 0 / 0 | 4 | 5 | 0 | — | sì | — |
| /storico | 20 / 20 | 4 | 45 | 0 | — | sì | — |
| /compliance | 0 / 0 | 0 | 6 | 0 | — | **no** | — |
| /riconciliazione | 0 / 0 | 0 | 0 | 0 | — | **no** | — |
| /reports | 0 / 0 | 0 | 0 | 0 | — | **no** | — |
| /marketplace | 12 / 0 | 0 | 28 | 0 | — | **no** | — |
| /sdi-passive | 0 / 0 | 0 | 62 | 0 | — | **no** | — |
| /autofatture | 3 / 0 | 7 | 17 | 0 | — | sì | — |
| /ocr-fatture | 0 / 1 | 0 | 0 | 0 | — | **no** | — |
| /agenda | 0 / 8 | 0 | 21 | 0 | — | **no** | — |
| /portachiavi | 0 / 0 | 0 | 0 | 0 | — | **no** | — |
| /rubrica | 1 / 0 | 4 | 28 | 1 | — | sì | — |
| /lavagna | 0 / 0 | 0 | 0 | 0 | — | **no** | — |
| /aiuto | 0 / 0 | 0 | 10 | 0 | — | **no** | — |

### Dettaglio contrasto (primi casi)

- /dashboard: chiaro 4.5:1 "12/12", chiaro 4.5:1 "Fattura", chiaro 4.5:1 "Fattura", chiaro 4.5:1 "Fattura", chiaro 4.5:1 "Fattura" … (+10)
- /prodotti: chiaro 3.8:1 "2", scuro 3.8:1 "2"
- /fatture-elettroniche: chiaro 4.5:1 "schedule", chiaro 4.5:1 "0"
- /pagamenti: chiaro 4.5:1 "214,37 €", chiaro 4.5:1 "4.542,13 €", chiaro 4.5:1 "299,76 €", chiaro 4.5:1 "1.936,30 €", chiaro 4.5:1 "519,50 €" … (+6)
- /scadenzario: chiaro 1.2:1 "2026/0167", chiaro 3.2:1 "13/08/2026", chiaro 1.2:1 "Gallo Termoidraulica S.p.A.", chiaro 3.8:1 "1.802,37 €", chiaro 1.2:1 "Scaduta" … (+89)
- /scadenze-fiscali: scuro 3.2:1 "account_balance", scuro 3.7:1 "scaduta", scuro 3.2:1 "account_balance", scuro 2.7:1 "warning_amber", scuro 2.7:1 "In ritardo di 118 giorni: il v" … (+3)
- /magazzino: chiaro 1.5:1 "—", chiaro 1.4:1 "—", chiaro 1.5:1 "—", chiaro 1.4:1 "—", chiaro 1.5:1 "—" … (+21)
- /vendita-banco: scuro 3.5:1 "Nessuna riga — clicca "Aggiung", scuro 3.5:1 "expand_more"
- /report: chiaro 2.5:1 "star", chiaro 2.1:1 "calendar_month"
- /impostazioni: chiaro 2.4:1 "AZIENDA", chiaro 4.5:1 "business", chiaro 2.4:1 "DOCUMENTI", chiaro 2.4:1 "ANAGRAFICHE", chiaro 2.4:1 "SISTEMA" … (+7)
- /archivi: chiaro 4.5:1 "in uso"
- /prima-nota: chiaro 4.5:1 "menu_book"
- /storico: chiaro 4.2:1 "Update", chiaro 4.2:1 "Update", chiaro 4.2:1 "Update", chiaro 4.2:1 "Update", chiaro 4.2:1 "Update" … (+35)
- /marketplace: chiaro 2.6:1 "DATA", chiaro 2.6:1 "CANALE", chiaro 2.6:1 "N. VENDITE", chiaro 2.6:1 "TOTALE", chiaro 4.5:1 "eBay" … (+7)
- /autofatture: chiaro 4.5:1 "TD18", chiaro 4.5:1 "TD17", chiaro 4.5:1 "TD19"
- /ocr-fatture: scuro 3.7:1 "PDF, foto o scansioni · max 20"
- /agenda: scuro 3.4:1 "09:30 Sopralluogo cantiere via", scuro 3:1 "Incasso fattura 2026/0188", scuro 3.4:1 "14:00 Consegna materiale Bianc", scuro 3.4:1 "11:00 Riunione fornitori", scuro 2:1 "Canone noleggio muletto" … (+3)
- /rubrica: chiaro 4.5:1 "Commerciale"

### Dettaglio bersagli piccoli e testo tagliato

- /prodotti: "CODICE" 73×20, "DESCRIZIONE" 485×20, "CATEGORIA" 82×20, "QTÀ" 40×20
- /clienti: "RAGIONE SOCIALE" 527×20, "P. IVA" 156×20, "TELEFONO" 135×20, "CITTÀ" 193×20
- /fornitori: "RAGIONE SOCIALE" 527×20, "P. IVA" 156×20, "TELEFONO" 135×20, "CITTÀ" 193×20
- /agenti: "NOME" 169×14, "CONTATTI" 192×14, "BASE" 119×14, "% DEFAULT" 80×14
- /ddt: "NUMERO" 102×20, "DATA" 119×20, "CLIENTE / FORNITORE" 262×20, "IMPORTO" 150×20, "STATO" 150×20
- /fatture: "NUMERO" 111×20, "DATA" 118×20, "CLIENTE" 282×20, "IMPORTO" 149×20, "STATO" 257×20
- /note-credito: "NUMERO" 124×20, "DATA" 145×20, "CLIENTE" 341×20, "IMPORTO" 182×20, "STATO" 147×20
- /ordini: "NUMERO" 68×20, "DATA" 79×20, "CLIENTE" 602×20, "IMPORTO" 102×20, "STATO" 87×20
- /preventivi: "NUMERO" 67×20, "DATA" 79×20, "CLIENTE" 602×20, "IMPORTO" 102×20, "STATO" 88×20
- /acquisti: "NUMERO" 108×20, "DATA" 123×20, "FORNITORE" 271×20, "PAGAMENTO" 135×20, "IMPORTO" 155×20 … (+1)
- /ordini-fornitore: "NUMERO" 107×20, "DATA" 125×20, "FORNITORE" 275×20, "STATO" 112×20, "FATTURA RICEVUTA" 194×20 … (+1)
- /pagamenti: "DATA" 79×20, "IMPORTO" 72×20, "CLIENTE / FORNITORE" 496×20, "NUMERO" 75×20, "EMISSIONE" 79×20 … (+3)
- /scadenzario: "TIPO" 124×20, "NUMERO" 98×20, "DATA SCADENZA" 144×20, "CONTROPARTE" 253×20, "IMPORTO" 96×20 … (+2)
- /magazzino: "DATA" 117×20, "PRODOTTO" 117×20, "QUANTITÀ" 112×20
- /arrivi-merce: "NUMERO" 67×20, "DATA" 79×20, "FORNITORE" 572×20, "VALORE" 61×20, "STATO" 101×20
- /prima-nota: "DATA" 158×20, "CAUSALE" 219×20, "IMPORTO" 218×20
- /fatture-ricorrenti: "CLIENTE" 555×20, "DESCRIZIONE" 171×20, "FREQUENZA" 88×20, "ATTIVA" 58×20
- /storico: "QUANDO" 94×14, "ENTITÀ" 58×14, "ID" 30×14, "AZIONE" 60×14
- /autofatture: "NUMERO" 99×14, "DATA" 77×14, "TIPO DOCUMENTO" 120×14, "FORNITORE ESTERO" 159×14, "FATTURA ESTERA" 115×14 … (+2)
- /rubrica: "NOME" 196×14, "REPARTO" 112×14, "TELEFONO" 79×14, "COLLEGATO A" 571×14, tagliato "people"

## Dialog "Nuovo…"

| Schermata | Larghezza | Titolo | Azioni | Etichette |
|---|---|---|---|---|
| /prodotti | 900px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /clienti | 860px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /fornitori | 860px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /ddt | 1296px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva e stampa · Salva |
| /fatture | 1296px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva e stampa · Salva |
| /note-credito | 1296px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /ordini | 1296px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /preventivi | 1296px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /acquisti | 1200px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /ordini-fornitore | 1200px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /pagamenti | 720px | mat-dialog-title 24px/700 | flex-end, primario ultimo | Annulla · Salva |
| /magazzino | 440px | mat-dialog-title 24px/700 | flex-end, primario ultimo | Annulla · Salva rettifica |
| /arrivi-merce | 1100px | mat-dialog-title 24px/700 | flex-end, primario **non ultimo** | Annulla · Salva in attesa · Conferma ricezione |
| /listini | 480px | mat-dialog-title 24px/700 | flex-end, primario ultimo | Annulla · Crea e apri editor |
| /prima-nota | 640px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /fatture-ricorrenti | 960px | dialog-hero 14px/700 | flex-end, primario ultimo | Annulla · Salva |
| /agenda | 640px | mat-dialog-title 24px/700 | flex-end, primario ultimo | Annulla · Salva |
| /rubrica | 610px | mat-dialog-title 24px/700 | flex-end, primario ultimo | Annulla · Salva |
