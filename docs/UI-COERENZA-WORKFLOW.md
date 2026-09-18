# Workflow — Uniformare tutte le schermate (desktop)

> **Obiettivo:** che ogni schermata di Ordeva sembri fatta dalla stessa mano. Stesso
> scheletro, stessi elementi negli stessi posti, stessi colori con lo stesso significato,
> in chiaro e in scuro. Poi che siano belle da guardare e comode da usare.
>
> **Perimetro:** solo desktop. Ordeva gira su PC: finestra minima **1280 px**, riferimento
> **1440 px**, verifica anche a **1920 px**. Mobile e tablet sono fuori perimetro.

Complementare a [`UI-UX-QUALITY-WORKFLOW.md`](UI-UX-QUALITY-WORKFLOW.md), che lavora **per
schermata** (bug, stati, usabilità). Questo documento lavora **per pattern**: un elemento
alla volta (l'intestazione, i filtri, le tabelle…), portato allo standard **su tutte le
schermate insieme**. È l'unico modo di ottenere coerenza. Sistemando una schermata alla
volta, ognuna diventa bella a modo suo.

Valgono le regole di §0 dell'altro documento: nessun cambio di comportamento, nessuna
rinomina di campi o chiavi, commit `style(…)` separati dai `fix(…)`, verifica in chiaro
e in scuro.

---

## 1. Gli strumenti

| Strumento | Cosa fa | Quando |
|---|---|---|
| **Galleria** (`npm start -- --configuration preview --port 4300`) | ogni schermata senza backend, dati finti deterministici, 4 stati dei dati | per guardare e per lavorare |
| **`scripts/coerenza-audit.mjs`** | apre tutte le rotte a 1280/1440/1920, in chiaro e in scuro, con dati pieni e vuoti, e apre i dialog "Nuovo…". Misura sul DOM intestazione, bottoni, tabelle, campi, card, tipografia, colori fuori token, contrasto, bersagli piccoli e overflow. Per ogni elemento ricava lo **standard** (il valore più usato) ed elenca chi devia | prima e dopo ogni passo |
| `docs/audit/coerenza/report.md` | il risultato dell'audit, versionato: il diff tra due commit mostra cosa è migliorato | a ogni passo |
| `docs/audit/coerenza/screenshot/`, `provini/` | screenshot di ogni schermata e fogli 2×2 per passarle in rassegna (non versionati) | revisione a occhio |
| `scripts/preview-smoke.mjs` | ogni rotta monta, senza errori | dopo ogni passo |
| `scripts/ui-guard.sh` | regole binarie (niente popup nativi, …), in CI | sempre |

```bash
cd scripts
BASE=http://localhost:4300 node coerenza-audit.mjs          # tutto (~6 min)
BASE=http://localhost:4300 ROTTE=fatture,agenti node coerenza-audit.mjs   # solo alcune
```

> **Il DOM propone, lo screenshot dispone.** Le misure trovano i candidati, ma ogni
> deviazione va confermata guardando la schermata. Esempio: il primo giro segnalava
> contrasto 1,2:1 nello Scadenzario, ma era la misura a confondersi con lo sfondo
> semitrasparente delle righe. A video il testo si leggeva benissimo.

---

## 2. Il catalogo dei pattern (lo standard)

Ogni pattern ha una regola, i mattoni da usare e il campo dell'audit che lo misura. Dove non
c'è una decisione di gusto, lo standard è quello **già usato dalla maggioranza delle
schermate**: uniformare verso la maggioranza tocca meno file e lascia l'app riconoscibile.
Le voci marcate **(da decidere)** sono scelte di design: la raccomandazione è indicata,
ma finché non è confermata non si applicano.

### P1 — Scheletro della pagina
- `.page` › `.page-header` › contenuto in una o più `.card`.
- Pagine operative **a tutta larghezza**. Le pagine "di focus" (primo avvio di un modulo,
  zona di trascinamento file, guida) possono centrare il **contenuto**, ma l'intestazione
  resta quella standard, in alto a sinistra.
- Distanza del titolo dal bordo del contenuto: **uguale ovunque** (oggi 20×24 px nella
  maggioranza). Navigando tra le voci del menu il titolo non deve "saltare".
- *Audit:* `Intestazione: usa .page-header`, `Titolo: posizione`, `Contenuto in .card`.

### P2 — Intestazione
- Titolo con `.page-title`, in **maiuscolo solo all'iniziale** ("Note di credito", non
  "Note di Credito").
- Descrizione facoltativa in `.page-sub`, **sotto** il titolo, una riga. Le spiegazioni
  lunghe vanno in un aiuto contestuale, non in un paragrafo fisso sopra la lista.
- Azioni in `.header-actions`: **una sola** azione piena (`mat-flat-button color=primary`),
  le altre a contorno (`mat-stroked-button`).
- **Ordine delle azioni (da decidere):** raccomandato *azione piena per prima, a sinistra
  del gruppo*, come nelle 12 schermate più usate (Fatture, Clienti, Prodotti…).
- "Aggiorna": sempre `mat-icon-button` con `refresh` e tooltip, ultimo del gruppo.
- *Audit:* `Titolo: classe .page-title`, `Azione primaria`.

### P3 — Filtri e ricerca **(da decidere)**
Raccomandato lo schema delle liste documento (10 schermate):
- filtri a tendina (Anno, Mese, Cliente, Stato…) in una `.filter-bar` **sopra** la card;
- filtri rapidi a chip o bottoni a interruttore nella stessa barra, a destra;
- ricerca testuale **dentro** la card, in alto a sinistra, sopra la tabella.

### P4 — Tabelle
- Sempre `mat-table` a **tutta larghezza** della card (oggi 8 tabelle su 25 sono HTML
  semplice, alcune si fermano a metà).
- Intestazioni colonna 11 px / 600 / maiuscolo. Altezza riga unica (standard 46 px).
- **Importi allineati a destra** con cifre tabulari. Date nel formato `dd/MM/yyyy`.
- Una colonna non va a capo per mancanza di spazio se accanto ce n'è una con spazio in
  avanzo: larghezze minime alle colonne corte (metodo, conto, documento).
- *Audit:* tutte le voci `Tabella:`, colonna "Importi non a destra".

### P5 — Azioni di riga
- Menu **⋮** (`mat-icon-button` + `mat-menu`) in ultima colonna, con nome accessibile che
  dice la riga ("Azioni per Rossi S.r.l.").
- Al massimo **una** azione rapida visibile accanto al ⋮ quando è l'operazione della
  schermata (es. "segna pagato" nello Scadenzario), come `mat-icon-button` con tooltip.
  Mai bottoni pieni ripetuti su ogni riga.
- Niente matita e cestino affiancati su ogni riga.

### P6 — Stati e colori con significato
- Stati come pillola (stessa classe ovunque): colore di sfondo tenue più testo del colore
  semantico (`--success-soft`/`--success-on`, …).
- **Colore = significato, uguale ovunque:** entrate e ricavi verdi, uscite e costi rossi,
  scaduto rosso, in scadenza ambra. Mai il verde per un'uscita.
- Solo token (`var(--…)`): niente esadecimali, niente palette arcobaleno.
- *Audit:* sezione "Colori fuori dai token", per tema.

### P7 — Riquadri KPI
- Un solo componente o classe (`.kpi-grid` › `.kpi-card`): etichetta piccola maiuscola,
  valore grande, **stesso allineamento** in tutta la fila, colore del valore solo se ha un
  significato (P6).
- Oggi convivono tre stili: Dashboard (icona colorata), Scadenzario (barra colorata sopra),
  Pagamenti (semplice, con allineamenti diversi nella stessa fila).

### P8 — Dialog
- Intestazione **hero** (`.dialog-hero`: icona, titolo, sottotitolo), già usata da 12
  dialog su 18.
- Sezioni del modulo con titolo e icona, come in "Nuovo cliente".
- Azioni in basso a destra: `Annulla` (testo), poi **una** azione piena, ultima. Azioni
  secondarie ("Salva e stampa") a contorno, prima di quella piena.
- *Audit:* `Dialog: schema intestazione`, `bottone principale per ultimo`.

### P9 — Stati vuoti, caricamento, errore
- Lista vuota → `app-empty-state` con cosa fare ("Nessuna fattura. Crea la prima").
- Caricamento → `app-loading-skeleton`.
- Pagina che parte vuota (es. Report tabellari) → spiega cosa scegliere, non uno spazio bianco.

### P10 — Tipografia, icone, bottoni
- Font Inter; monospace solo per codici (IBAN, XML, chiavi).
- Scala di testo corta: 11 (etichette maiuscole), 12, 13 (corpo tabelle), 14 (corpo),
  16, 19/24 (titoli). Niente 11,5 / 12,5 / 13,5 px.
- Icone 16 / 18 / 20 / 24 px.
- Una combinazione di altezza e raggio per variante di bottone (più una compatta).

### P11 — Tema scuro
- Ogni superficie da token: nessun bianco o giallo cablato (vedi Agenda).
- Contrasto ≥ 4,5:1 per il testo, anche sul bottone principale e sui testi rossi e ambra.

---

## 3. Fotografia di partenza (18 settembre 2026)

Misurata con `coerenza-audit.mjs` su 42 rotte (38 nel perimetro) e confermata guardando
gli screenshot. Il dettaglio completo è in [`audit/coerenza/report.md`](audit/coerenza/report.md).

**Cosa è già coerente.** Le sei liste documento (Fatture, DDT, Note di credito, Ordini,
Preventivi, Acquisti) sono quasi identiche tra loro, ed è il modello da cui partire.
Font unico, campi Material tutti "outline", raggio dei dialog uniforme, azioni dei dialog
sempre in basso a destra.

**Cosa non lo è.**

| ID | Pattern | Difetto | Dove | Gravità |
|---|---|---|---|---|
| C1 | P11 | Celle del calendario **bianche e gialle** in tema scuro (giorni fuori mese, oggi) | Agenda | alta |
| C2 | P11 | Bottone principale in tema scuro: testo bianco su verde acqua, **contrasto 3,1:1** | tutte le liste | alta |
| C3 | P11 | Testo rosso scuro su fondo scuro poco leggibile: banner "fatture da sistemare", motivi di scarto SDI, date scadute | Fatture elettroniche, SDI ricevute, Scadenzario | alta |
| C4 | P6 | Importi in **uscita verdi** come le entrate | Scadenzario | alta |
| C5 | P3 | Filtri in 4 schemi diversi (tendine fuori dalla card, campi riquadrati dentro, bottoni a interruttore nell'intestazione, tab) | Fatture elettroniche, SDI ricevute, Rubrica, Pagamenti, Scadenzario, Magazzino… | media |
| C6 | P5 | Azioni di riga: matita e cestino invece di ⋮; un bottone pieno "Registra" ripetuto su ogni riga | Agenti, Rubrica, SDI ricevute | media |
| C7 | P7 | Tre stili di riquadri KPI; in Pagamenti gli importi cambiano allineamento nella stessa fila | Dashboard, Scadenzario, Pagamenti, Report, Compliance, Prima nota | media |
| C8 | P8 | Due schemi di dialog: hero (12) e titolo Material semplice (6) | Pagamenti, Magazzino, Arrivi merce, Listini, Agenda, Rubrica | media |
| C9 | P8 | **Due** bottoni pieni nello stesso dialog | Arrivi merce ("Salva in attesa", "Conferma ricezione") | media |
| C10 | P1 | Layout a colonna stretta centrata con molto spazio vuoto | Scadenze fiscali, Marketplace | media |
| C11 | P4 | Tabelle che non riempiono la card | Agenti, Storico, Marketplace | media |
| C12 | P4 | Colonne che vanno a capo per mancanza di spazio ("Bonifico 30 / gg", "Fatt. / 2026/0200"); 105 importi non allineati a destra | Pagamenti | media |
| C13 | P1 | Titolo a distanze diverse dal bordo (16, 21, 24, 26, 29 px): la pagina "salta" | 19 schermate su 38 | bassa |
| C14 | P2 | Ordine delle azioni nell'intestazione invertito (azione piena ultima invece che prima) | Listini, Prima nota, SDI ricevute, Magazzino, Autofatture | bassa |
| C15 | P2 | Maiuscole nei titoli ("Note di Credito", "Arrivi Merce", "Fatturazione Ricorrente") | 3 schermate | bassa |
| C16 | P2 | "Aggiorna" a volte icona, a volte bottone con testo | Storico, Report vs Scadenzario, Fatture elettroniche | bassa |
| C17 | P2 | Descrizione della pagina in 4 posizioni diverse (sotto, a destra, paragrafo lungo, assente) | Listini, Archivi, Report tabellari, Autofatture, Marketplace | bassa |
| C18 | P6 | Dashboard: chip di avviso e icone KPI in sei colori diversi, senza significato | Dashboard | bassa |
| C19 | P9 | Report tabellari parte da una pagina bianca con una sola tendina | Report tabellari | bassa |
| C20 | P4 | Contatti grigio chiaro su bianco, contrasto 2,6:1 | Agenti | media |
| C21 | P10 | 25 dimensioni di testo e 13 di icone in uso | ovunque | bassa |
| C22 | — | Le date nei campi nativi appaiono `mm/dd/yyyy` nell'anteprima (Chromium in inglese): **da verificare nell'app vera** su Windows e macOS | Vendita al banco, Magazzino, SDI ricevute, dialog Pagamento | da verificare |
| C23 | — | Pagine del vecchio sito SaaS (FAQ con prezzi e "14 giorni di prova", Termini, Privacy e Cookie con segnaposto `[DA COMPILARE]`) raggiungibili per indirizzo | /faq, /termini, /privacy, /cookie | decisione: rimuovere dall'edizione desktop |

---

## 4. Il ciclo, un pattern alla volta

Per ogni pattern del catalogo, in quest'ordine:

1. **Misura.** `coerenza-audit.mjs` e lettura della riga del pattern nel report: chi
   devia e di quanto.
2. **Guarda.** Apri i provini (`docs/audit/coerenza/provini/`) delle schermate che
   deviano, in chiaro e in scuro. Scarta i falsi positivi e annota quelli veri.
3. **Mattone condiviso.** Se lo standard non ha già una classe globale o un componente
   (es. P7 KPI), crealo **prima**, in `styles.scss` o `components/shared/`. Uniformare
   copiando CSS in ogni schermata rende coerente oggi e incoerente domani.
4. **Applica** a tutte le schermate che deviano. Un commit `style(<pattern>): …` per
   pattern, o per gruppo di schermate se il diff è grande.
5. **Verifica.**
   - l'audit ridà adesione piena sul pattern, oppure spiega perché no (eccezione motivata);
   - provini "dopo" a confronto con "prima", in chiaro **e** in scuro;
   - `preview-smoke.mjs` verde in tutti gli stati;
   - le funzioni della schermata sono invariate (inventario §0.2 dell'altro documento).
6. **Registra.** `report.md` aggiornato nel commit; qui la voce C… spuntata.

### Ordine consigliato

| Onda | Pattern | Perché prima |
|---|---|---|
| 1 | **P11 + P6**: C1, C2, C3, C4, C20 | difetti che si vedono subito e fanno sembrare l'app rotta; pochi file |
| 2 | **P1 + P2**: C13, C14, C15, C16, C17 | l'intestazione è la prima cosa che si vede in ogni schermata: uniformarla dà subito l'impressione di un'app sola |
| 3 | **P3**: C5 | il pattern più visibile dopo l'intestazione (serve la decisione) |
| 4 | **P4 + P5**: C6, C11, C12 | tabelle e azioni di riga: dove si passa il tempo |
| 5 | **P7**: C7, C18 | serve un componente KPI unico |
| 6 | **P8**: C8, C9 | sei dialog da portare allo schema hero |
| 7 | **P1 layout, P9, P10**: C10, C19, C21 | rifiniture |

### Oltre le misure: la revisione a occhio

L'audit dice se due schermate sono uguali, non se sono belle. Alla fine di ogni onda si
passano i provini di **tutte** le schermate chiedendosi:

- **Gerarchia:** in un secondo si capisce qual è la cosa principale della pagina e qual è
  l'azione da fare?
- **Densità:** né troppo vuota (colonne strette in mezzo al bianco) né affollata (dieci
  colori, venti bottoni)?
- **Allineamenti:** i bordi sinistri di titolo, filtri, card e tabella cadono sulla stessa
  linea?
- **Colore:** ogni colore significa qualcosa? Tolto il colore, si capisce lo stesso?
- **Scuro:** la stessa pagina in scuro è altrettanto leggibile, senza macchie chiare?
- **1280 px:** tutto sta nella finestra più piccola, senza tagli e senza colonne a capo?

---

## 5. Presidio

Uniformare non basta: senza un presidio ogni schermata nuova riparte da zero.

- **Ogni schermata nuova** nasce copiando lo scheletro di Fatture (lista) o di "Nuovo
  cliente" (dialog), non da zero.
- Prima di ogni release: `coerenza-audit.mjs` e confronto di `report.md` con la versione
  precedente. **Un'adesione che scende è una regressione.**
- Quando un pattern arriva al 100%, la sua regola passa in `ui-guard.sh` se è verificabile
  sul codice (es. "nessun `mat-dialog-title` fuori da `.dialog-hero`", "nessun esadecimale
  negli SCSS dei componenti").

---

## 6. Decisioni aperte

1. **P2 — ordine delle azioni nell'intestazione.** Raccomandato: azione piena per prima.
2. **P3 — schema dei filtri.** Raccomandato: tendine sopra la card, ricerca dentro.
3. **C23 — pagine del vecchio sito SaaS nell'app desktop.** Raccomandato: rimuovere le rotte
   dall'edizione offline.
4. **C22 — formato data nei campi nativi.** Da verificare sull'app installata prima di decidere.
