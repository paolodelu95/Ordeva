# Workflow — Qualità UI, UX e caccia ai bug (passaggio completo su ogni schermata)

> **Obiettivo:** alzare in modo netto la qualità percepita e reale dell'interfaccia —
> **senza cambiare cosa fa l'app**. Ogni schermata, ogni dialog, ogni stato vuoto viene
> guardato con gli occhi, valutato con una griglia fissa e sistemato con modifiche piccole
> e verificabili.

> **Perimetro: solo desktop** (dal 18/09/2026). Ordeva gira su PC: si verifica a 1280, 1440
> e 1920 px. Le misure e le correzioni a 375/768 px citate più sotto sono storia: non si
> rifanno e non si verificano più. La **coerenza tra schermate** ha un workflow suo,
> per pattern invece che per schermata: [`UI-COERENZA-WORKFLOW.md`](UI-COERENZA-WORKFLOW.md).

Complementare a [`UX-SIMPLIFICATION-WORKFLOW.md`](UX-SIMPLIFICATION-WORKFLOW.md), che si
occupa del **carico cognitivo** (semplificare). Questo documento si occupa di **qualità
d'esecuzione**: difetti visivi, incoerenze, stati non gestiti e bug piccoli ma fastidiosi.
I due si eseguono insieme: stessa schermata, un solo passaggio, tre lenti.

---

## 0. La regola che viene prima di tutte: non rompere niente

"Migliorare la UI senza compromettere le funzionalità" non è un auspicio: è un **contratto
operativo** con quattro vincoli non negoziabili.

1. **Un commit non mescola mai grafica e logica.**
   `style(schermata):` tocca solo template/SCSS/etichette. `fix(schermata):` tocca la logica.
   Se durante un passaggio grafico trovi un bug funzionale, **annotalo nella scheda e fallo
   in un commit separato**. Mai insieme.
2. **Inventario del comportamento prima di toccare.**
   Per ogni schermata, prima di modificarla, si scrive nella scheda l'elenco di *cosa fa*:
   azioni, filtri, scorciatoie, side-effect (stampa, export, invio, movimento magazzino).
   È la checklist con cui si verifica dopo. Nessun inventario → nessuna modifica.
3. **Nessuna rinomina di campo, chiave, endpoint o payload.**
   Cambiare l'**etichetta** mostrata è permesso e incoraggiato; cambiare la **proprietà**
   sottostante no. I dati sono di un gestionale fiscale: un rename silenzioso è un danno reale.
4. **Verifica visiva obbligatoria: chiaro + scuro, a 1280 e 1440 px.**
   Una modifica non è finita finché non è stata vista nei tre stati. Molti difetti attuali
   esistono proprio perché una sola combinazione è stata guardata.

**Rollback facile:** una schermata = un commit isolato = `git revert` indolore. È il motivo
per cui i commit restano piccoli anche quando la voglia è di fare tutto insieme.

---

## 1. Le tre lenti

Ogni schermata viene guardata tre volte di fila, in quest'ordine. L'ordine conta: un bug
funzionale rende inutile qualsiasi giudizio estetico.

### Lente 1 — BUG (cosa è rotto)
Difetti oggettivi: qualcosa non funziona, non risponde, mente all'utente o fallisce in
silenzio. Sempre prioritari.

### Lente 2 — UI (cosa è brutto o incoerente)
Allineamenti, spaziature, colori fuori token, densità, tipografia, icone, overflow,
comportamento in dark mode e su schermo stretto.

### Lente 3 — UX (cosa è faticoso)
Numero di clic, ordine dei campi, default mancanti, feedback assente, gergo non spiegato.
Qui si applica anche la rubrica a 10 punti dell'altro workflow.

---

## 2. Fotografia attuale (misurata sul codice, non a sensazione)

Ogni riga è verificabile con un `grep` rieseguibile. Sono anche le **metriche di
avanzamento**: si rimisurano a ogni onda chiusa.

| # | Misura | Oggi | Obiettivo |
|---|---|---|---|
| M1 | Componenti / dialog / rotte | 126 / 66 / 51 | — (perimetro) |
| M2 | `alert()` e `prompt()` nativi residui | ~~8 in 4 file~~ → ~~0~~ → **rientrati a 9 in 6 file** (autosalvataggio bozze, post-audit) → **0 ✅, presidiato in CI** | 0 |
| M3 | `.subscribe(() => …)` **senza ramo `error:`** | **63**, di cui almeno 39 su scritture in 19 file — ma **non falliscono più in silenzio ✅** (B.1) | 0 |
| M4 | Copertura aiuto sui campi (`matHint`/FieldHelp su `mat-form-field`) | **54 / 833 ≈ 6%** | ≥ 60% dei campi non ovvi |
| M5 | Bottoni-icona **senza nome accessibile** | ~~169 «senza aria-label»~~ — misura sbagliata, vedi sotto. Reale: **62 su 48 rotte** → **0 ✅** | 0 |
| M6 | Colori esadecimali fuori dai token (SCSS) | **200** → **171** (misurato di nuovo, B.4 non fatta) — **escluso** il conteggio degli `style="color:#…"` inline nei template `.ts`, mai misurato, verosimilmente **>1200** | solo dentro `styles.scss` |
| M7 | Liste con `mat-paginator` | ~~24 / 53~~ → **27 / 53** (B.8: Pagamenti, Movimenti magazzino, Ordini fornitore) | tutte quelle che possono superare ~100 righe |
| M8 | Componenti con indicatore di caricamento | ~~21 / 126~~ → **25 / 126** (B.7: Fatture, Clienti, Prodotti, Dashboard) | tutte le viste che fanno una chiamata |
| M9 | Componenti con `ngOnDestroy` / `takeUntilDestroyed` | **16 / 80** — **verificato uno per uno: zero leak reali** (vedi HANDOFF-UI-UX.md). La misura sottostima chi non ne ha bisogno (subscribe a `FormControl` di proprietà propria, che si esaurisce da sola) | — (misura non azionabile così com'è) |
| M10 | Stati vuoti con `app-empty-state` | ~~21 file~~ → **22 file** (B.8/B16: Movimenti magazzino) | tutti |
| M11 | Test automatici / lint | ~~0 / 0~~ → **1** (`scripts/preview-smoke.mjs`: tutte le rotte × 4 stati dati) | almeno uno smoke test di render per schermata |
| M12 | Schermate ispezionabili senza backend Rust | ~~9 su ~50~~ → **49 su 49 ✅** (Fase A fatta) → **47 su 47** dopo la rimozione di CRM/Timesheet (dead code, non rotte reali) | 100% |

### Cosa dicono davvero questi numeri

- **M3 è il problema più grave dell'app.** Almeno 39 punti in cui l'utente clicca "Elimina"
  o "Salva", il server risponde errore, e **non succede niente**: nessun messaggio, nessun
  ripristino. (39 è un minimo prudenziale: conta solo le `subscribe` scritte su una riga;
  quelle multi-riga vanno verificate a mano.) L'interceptor HTTP (`frontend/src/app/interceptors/auth.interceptor.ts`)
  gestisce 401/402/rete ma **non mostra alcun errore generico**, quindi l'errore muore lì.
  È un bug invisibile che moltiplica la sfiducia: l'utente crede di aver salvato.
- **M2 è una regressione.** La Fase 0 dell'altro workflow dichiara "43 → 0 ✅", ma
  `alert()`/`prompt()` nativi sono rientrati in `acquisti/acquisto-registra-dialog.ts` (3),
  `acquisti/acquisto-magazzino-dialog.ts` (1), `fatture/fatture.ts` (2),
  `super-admin/super-admin.ts` (2). Serve un presidio, non solo una bonifica.
- **M5 era gonfiata, e la galleria lo ha dimostrato.** Il `grep` contava i
  `mat-icon-button` privi di `aria-label` e ne trovava 169 — ma `title` fornisce
  anch'esso un nome accessibile, e l'app lo usa quasi ovunque. Misurando il **DOM vero**
  su tutte le rotte, i bottoni davvero senza nome erano **62**, concentrati in cinque
  punti: il selettore colonne condiviso, i kebab di riga di Clienti, Fornitori e SDI
  ricevute, il bottone "Aggiorna" di due schermate SDI e le frecce del mese in Agenda.
  Lezione da tenere: **il `grep` propone, la schermata dispone** — le metriche statiche
  vanno confermate a video prima di dimensionare un intervento.
- **M12 era il collo di bottiglia del "guarda ogni schermata" — ora è risolto.** L'harness
  copriva 8 dialog documento più Vendita al banco; tutto il resto si vedeva solo compilando
  il backend Rust, che sulla macchina di sviluppo non c'è (vedi `HANDOFF.md`). Con la
  galleria (§3) **tutte e 49 le rotte sono ispezionabili senza backend**, in quattro stati
  dei dati e a quattro larghezze. Istruzioni: [`frontend/src/preview/README.md`](../frontend/src/preview/README.md).

### Bug e incoerenze già identificati (backlog di partenza)

| ID | Dove | Difetto | Lente |
|---|---|---|---|
| B1 | ≥39 punti in 19 file | Salvataggi e cancellazioni falliscono in silenzio (nessun ramo `error:`) | BUG |
| B2 | `app.ts:147`, `home-app.ts:312` | "Nuova fattura", "Nuovo cliente", "Nuovo preventivo" **non aprono niente**: navigano alla lista. L'etichetta promette un'azione, l'app fa un cambio pagina. Manca del tutto il deep-link "nuovo" (esiste solo `openId`, e solo per Clienti/Fornitori/Prodotti) | BUG/UX |
| B3 | 4 file (M2) | Popup di sistema fuori tema, bottoni "OK/Annulla" generici | UI/UX |
| B4 | `home-app.ts:329` e seguenti | ~20 gradienti esadecimali cablati sulle card moduli: palette arcobaleno non tematizzata, ignora il dark mode | UI |
| B5 | 29 liste senza paginator (M7) | Su archivi reali la pagina rende migliaia di righe: rallentamenti e scroll infinito | BUG/UI |
| B6 | 105 componenti senza indicatore di caricamento (M8) | Schermata vuota durante il fetch, indistinguibile da "nessun dato" | UX |
| B7 | 5 punti, 62 bottoni (M5) | Bottoni-icona senza nome accessibile: illeggibili da screen reader. I 25 kebab identici per riga, poi, non dicevano nemmeno *quale* riga | UI/a11y |
| B8 | 27 `toFixed(2)` + 7 `toLocaleString` contro 192 `currency` | Formattazione importi non uniforme: separatori e simbolo divergono tra schermate | UI |
| B9 | 16 `slice(0,10)`/`split('T')` contro 79 `date` | Stesse date rese in formati diversi | UI |
| B10 ✅ | `app.routes.ts` vs `app.ts:973-974` | `/crm` e `/timesheet` sono rotte vive ma tolte dal menu (righe commentate): raggiungibili solo per URL e non manutenute. **Rimossi** (componenti, rotte, voci di `ModuliService` e della galleria) | BUG |
| B11 | 64 componenti senza cleanup (M9) | Timer e sottoscrizioni sopravvivono all'uscita dalla schermata | BUG |

### Trovati guardando le schermate (primo giro con la galleria)

Difetti che nessun `grep` avrebbe potuto mostrare. Verificati misurando il DOM reale,
non a occhio.

| ID | Dove | Difetto | Lente |
|---|---|---|---|
| **B12** | Fatture, Preventivi, Ordini, DDT, Note di credito, Acquisti — **a 375 px** | Nel layout a schede su mobile la cella della **casella di selezione** (`position:absolute`, sfondo opaco, bordo destro a 88 px) copre l'inizio del **numero documento**, che parte a 48 px: si perdono ~40 px di testo. "2026/0200" si legge **"/0200"**. Colpisce l'identificatore principale di ogni documento, su tutte e sei le liste, in chiaro e in scuro | BUG/UI |
| **B13** | `app.routes.ts` | **Nessuna rotta jolly `**`**: un indirizzo sconosciuto non dà una pagina "non trovata" ma il guscio dell'app con l'area contenuti **vuota**, senza spiegazione né via d'uscita | BUG |
| ~~B14~~ | `components/login/` (676 righe) | **Falso positivo, verificato**: il componente Login non ha una rotta perché non ne ha bisogno — è montato condizionalmente in `app.html` (`<app-login (loggedIn)="onLogin()" />`), è l'autenticazione reale, non codice morto. Non toccato | — |
| **B15** | Pagamenti, Movimenti magazzino, Ordini fornitore | Con dati realistici rendono **rispettivamente 280, 200 e 200 righe in una volta**, senza paginatore. Misurato: Fatture/Clienti/Prodotti/Preventivi/Scadenzario/Arrivi merce ne mostrano 25 con paginatore | BUG/UI |
| **B16** | Movimenti magazzino | **Nessuno stato vuoto**: a database vuoto resta una tabella con le sole intestazioni. Le altre 11 liste controllate hanno `app-empty-state` | UX |
| **B17** | 12 file, dal compilatore | Avvisi del template mai indirizzati: `??` e `?.` inutili su valori non nullable (`fatture`, `ddt`, `ordini`, `preventivi`, `note-credito`, `agenti`, `doc-info-dialog`, `welcome-offline`) e una `NG8011` in `allegati.html` dove **l'icona non finisce nello slot del bottone** | UI |

> Le tabelle **non sono l'elenco completo**: sono ciò che emerge dal codice e dal primo
> giro di ricognizione. Il resto si trova schermata per schermata, col ciclo §5.

---

## 3. Fase A — Rendere visibile ogni schermata ✅ FATTA

Senza questo passo, "guardare ogni schermata" restava un'intenzione: 40 schermate su 49
si potevano vedere solo compilando il backend Rust.

**Cosa c'è ora** — `npm start -- --configuration preview --port 4300`, poi
<http://localhost:4300>. Dettagli in [`frontend/src/preview/README.md`](../frontend/src/preview/README.md).

- **A1 — Galleria ✅.** Elenco di tutte le rotte a sinistra, **l'app vera** dentro un
  iframe al centro. L'iframe non è un dettaglio: le media query rispondono alla sua
  larghezza, quindi l'anteprima a 375 px è mobile per davvero. Le chiamate `/api/…` sono
  intercettate a livello **HTTP** (non mockando i servizi), così `DataService`, `ApiService`
  e le chiamate diverse funzionano tutte con un solo punto di controllo — e
  `authInterceptor` resta esercitato. **Zero modifiche ai componenti di produzione.**
- **A2 — Quattro stati dei dati ✅.** *Pieni* (~200 righe, deterministiche, con casi limite
  deliberati: ragione sociale lunghissima, anagrafica ai minimi termini, prezzo fuori
  scala, totale a sette cifre) · *Vuoti* · **Scritture KO** (ogni salvataggio risponde 500:
  è il test diretto di B1 — se la schermata non dice niente, ha il difetto) · *Letture KO*.
  Più un ritardo regolabile (0 / 200 ms / 1,5 s) per rendere osservabili i caricamenti.
- **A3 — Matrice di viste ✅.** Chiaro/scuro × 1440 / 1280 / 768 / 375 px dai selettori in
  alto. Screenshot da archiviare in `docs/audit/screenshot/<schermata>/`.

**Verifica fatta:** tutte e 49 le rotte montano il proprio componente, **zero errori** in
console. Gli endpoint non ancora modellati non rompono niente (si degradano a lista vuota)
e si elencano con `window.__fixtureMancanti`.

> **Resta da fare in A:** le schermate di primo avvio (`welcome-offline`) e il selettore
> archivi vivono fuori dal router Angular — vanno aggiunte alla galleria quando si arriva
> all'Onda 6.

---

## 4. Fase B — Bonifiche globali (una modifica, decine di schermate sistemate)

Da fare **prima** del giro schermata-per-schermata: eliminano intere classi di difetti e
riducono il rumore negli audit successivi.

| # | Bonifica | Risolve | Rischio |
|---|---|---|---|
| **B.1 ✅** | **Errori HTTP non gestiti resi visibili** — `services/global-error-handler.ts`. Fatta **nell'`ErrorHandler`, non nell'interceptor**: un interceptor non sa se qualcuno gestirà l'errore, quindi parlerebbe anche dove la schermata mostra già un messaggio suo. All'`ErrorHandler` arrivano per definizione solo gli errori che **nessuno** ha gestito (RxJS li rilancia solo in assenza di callback `error:`), quindi si copre il caso mancante **senza toccare i 39 punti e senza doppioni** | B1 | Basso: aggiunge un ramo, non ne cambia nessuno |
| **B.2 ✅** | **Popup di sistema a zero** — chiusa la falla **due volte**: prima `confirm.alert()`/`askTyping()` per `alert()`/`prompt()` mancanti, poi (post-audit) 9 punti in 6 file introdotti dall'autosalvataggio bozze (`window.confirm` per la ripresa bozza, `window.prompt` per password/nome kit — serviva un `ConfirmService.prompt()` che non esisteva). **Ora presidiato in CI** (`scripts/ui-guard.sh`), non solo bonificato | B2, B3 | Nullo |
| **B.3 ✅** | **Deep-link "nuovo"**: le azioni rapide (Home + barra comandi) riusano `nuovaBozza`/`prefill` già esistenti invece di introdurre uno stato nuovo | B2 | Basso: nuovo ramo in `ngOnInit`, nessuna anagrafica ne era priva |
| **B.4** | **Pass sui token colore**: 171 esadecimali SCSS + i gradienti della Home + un numero non ancora misurato (verosimilmente >1200) di `style="color:#…"` inline nei template `.ts` | B4 | Basso sul singolo colore, ma **richiede verifica dark mode a vista** e la superficie è enorme — va spezzato in più commit per zona (Home, poi componente per componente) |
| **B.5** | **Formattazione unica**: la maggior parte dei `toFixed`/`toLocaleString` NON sono un semplice swap col pipe — vedi la nota in HANDOFF-UI-UX.md (calcolo vs resa, e pipe non usabili in stringhe TS: serve `inject(CurrencyPipe)`, modello già in `reports.ts:177`) | B8, B9 | Medio: **non toccare i valori inviati al backend**, solo la resa |
| **B.6 ✅** | **Nome accessibile su ogni bottone-icona.** Misurato sul DOM, non col grep: 62 bottoni in 5 punti. I kebab di riga dicono ora *quale* riga ("Azioni per Rossi Costruzioni S.r.l."). Verificato: 0 su tutte e 48 le rotte | B7 | Nullo |
| **B.7 (parziale)** | **Stato di caricamento standard**: `app-loading-skeleton` condiviso, applicato a Fatture/Clienti/Prodotti/Dashboard. Restano Vendita al banco e il resto delle 105 viste originarie (Home aveva già il proprio) | B6 | Basso |
| **B.8 ✅** | **Paginazione sulle liste lunghe**: Pagamenti (280 righe), Movimenti magazzino (200), Ordini fornitore (200) — le due senza `MatTableDataSource` hanno una pagina calcolata via slice con indice riallineato se un filtro riduce il totale. B16 risolto di riflesso (empty-state su Movimenti magazzino, stesso blocco di codice) | B5, B15, B16 | Medio: **verificato** che i filtri restano corretti |
| **B.11 ✅** | **Sovrapposizione casella/numero a 375 px** nelle sei liste documento. Causa: `html.density-compact td.mat-mdc-cell` sta fuori da ogni media query e, a pari specificità ma posizione successiva, batteva le regole del layout a schede. Ora è limitata a `min-width: 768px` | B12 | Basso |
| **B.12 ✅** | **Rotta jolly `**` → Home.** Login/CRM/Timesheet decisi: CRM e Timesheet rimossi (dead code), Login lasciato (è l'auth reale, non dead code) | B13 | Basso |
| **B.9 ✅ (investigato)** | Verificato uno per uno: **zero leak reali**. Tutti i `setInterval` hanno cleanup; nessun polling/retry ricorsivo; le `valueChanges` senza `takeUntil` sono su form di proprietà del componente, si esauriscono da sole. Unico rischio minimo (non un leak): 3 debounce di ricerca non cancellati in `ngOnDestroy` | B11 | — |
| **B.10 ✅** | **Rete di sicurezza**: `scripts/preview-smoke.mjs`, Node+Playwright, tutte le rotte × 4 stati dati. Ha trovato 6 fixture della galleria con forma sbagliata e un crash reale in produzione (Dashboard con le API annuali KO) | tutto | Basso, valore alto — **confermato** |

> Ordine seguito finora: **B.10 → B.1 → B.11 → B.2 → B.6 → B.12 → B.3 → B.9 → B.2(fix) →
> B.7(parziale) → B.8.** Restano **B.5** e **B.4** (le due bonifiche più rischiose, giustamente
> per ultime) prima di poter passare all'Onda 1 schermata per schermata.

---

## 5. Fase C — Il giro schermata per schermata

Per ogni voce del backlog §6, sempre lo stesso ciclo di 7 passi.

1. **INVENTARIO** — elenca cosa fa la schermata (§0.2). È il contratto da non rompere.
2. **OSSERVA** — apri le 6 viste della matrice A3 per i 3 stati A2. Screenshot "prima".
3. **CACCIA AI BUG** — percorri la checklist §5.1, clic per clic. Ogni difetto va nella
   scheda con la gravità: bloccante / fastidioso / cosmetico.
4. **AUDIT UI/UX** — compila la scheda §5.2.
5. **RIPARA** — commit separati per lente: prima `fix:` (bug), poi `style:` (UI), poi
   `feat(ux):`. Modifiche minime, componenti condivisi, zero redesign gratuiti.
6. **VERIFICA** — rileggi l'inventario del passo 1 e riprova **ogni** comportamento
   elencato. Riscatta gli screenshot. Confronta prima/dopo.
7. **REGISTRA** — scheda a "Pronta", metriche §2 rimisurate, backlog spuntato.

### 5.1 Checklist caccia ai bug (per ogni schermata)

**Dati e stati**
- [ ] Lista **vuota**: mostra uno stato vuoto utile, non un'area bianca?
- [ ] Lista **lunga** (200+ righe): resta fluida? c'è paginazione o virtualizzazione?
- [ ] **Errore del server**: compare un messaggio? l'utente capisce cosa fare?
- [ ] **Durante il caricamento**: c'è un segnale? "vuoto" e "sto caricando" si distinguono?
- [ ] Testi lunghi e importi grandi: vanno a capo o rompono il layout?

**Azioni**
- [ ] Ogni bottone fa quello che la sua etichetta promette? (vedi B2)
- [ ] Doppio clic rapido sul salvataggio: crea due record?
- [ ] Il bottone si disabilita durante l'operazione?
- [ ] Ogni azione produce un feedback visibile entro 1 secondo?
- [ ] Le azioni distruttive chiedono conferma, col bottone etichettato ("Elimina fattura")?
- [ ] Le operazioni che falliscono lo dicono? (la trappola M3)

**Form**
- [ ] Campi obbligatori distinguibili dagli opzionali?
- [ ] Errori di validazione vicini al campo e in italiano comprensibile?
- [ ] Chiusura con modifiche non salvate: avvisa?
- [ ] Invio con `Enter`: fa la cosa giusta o ricarica la pagina?
- [ ] `Tab` segue un ordine sensato? Il focus è sempre visibile?

**Navigazione e stato**
- [ ] Filtri e ordinamento sopravvivono all'andata e ritorno da un dettaglio?
- [ ] Il tasto "indietro" del sistema si comporta bene?
- [ ] Aprire la stessa rotta due volte ricarica correttamente?
- [ ] Uscendo, timer e sottoscrizioni si fermano? (B11)

**Resa**
- [ ] **Dark mode**: tutto leggibile, contrasti sufficienti, nessun colore cablato?
- [ ] **1280px** (finestra minima): niente scroll orizzontale della pagina, niente colonne a capo per mancanza di spazio
- [ ] Importi e date nel formato standard dell'app? (B8, B9)
- [ ] Icone coerenti col resto dell'app (stessa cosa = stessa icona)?

### 5.2 Scheda di audit

```
SCHERMATA: ______________________     Rotta: /______     Data: ______

INVENTARIO FUNZIONALE (cosa deve continuare a fare):
  1. ______________________________  4. ______________________________
  2. ______________________________  5. ______________________________
  3. ______________________________  6. ______________________________

BUG TROVATI                                     gravità   commit
  · ______________________________________      [ ]        ______
  · ______________________________________      [ ]        ______

UI (0-3: no / debole / ok / ottimo)
  Allineamento e spaziature      [ ]    Dark mode                  [ ]
  Coerenza colori (token)        [ ]    Finestra 1280px            [ ]
  Tipografia e gerarchia         [ ]    Densità informativa        [ ]
  Icone coerenti                 [ ]    Stati (hover/focus/disab.) [ ]

UX (rubrica a 10 punti di UX-SIMPLIFICATION-WORKFLOW §5)   ___/10

  VERIFICA NON-REGRESSIONE: inventario riprovato punto per punto  [ ] sì
  STATO: [ ] Da fare  [ ] In corso  [ ] Pronta
  IL PROBLEMA PIÙ GRAVE (1 frase): _______________________________
```

> Le schede vivono in `docs/audit/<schermata>.md`, gli screenshot in
> `docs/audit/screenshot/<schermata>/{prima,dopo}-{light,dark}-{1440,1280}.png`.

---

## 6. Backlog — ordine di lavorazione

Ordinato per **frequenza d'uso × costo di un difetto**. Un gestionale sbaglia in modo
costoso: una fattura resa male vale più di una pagina di impostazioni resa male.

### Onda 1 — Quotidiano (il 90% dell'uso)
| # | Schermata | File (righe) | Perché prima | Stato |
|---|---|---|---|---|
| 1 | Home | `home-app` (422) | prima cosa che si vede; B2 e B4 vivono qui | ☐ |
| 2 | Fatture (lista + dialog) | `fatture` (**2014**) | funzione n.1, file più grande, 2 `alert()` | ☐ |
| 3 | Clienti | `clienti` (1066) | base di tutto il resto | ☐ |
| 4 | Prodotti | `prodotti` (1151) | base dei documenti | ☐ |
| 5 | Vendita al banco | `vendita-banco` (624) | flusso veloce, deve essere a prova di errore | ☐ |
| 6 | Dashboard | `dashboard` (431) | letta ogni giorno | ☐ |

### Onda 2 — Ciclo attivo
| # | Schermata | File (righe) | Stato |
|---|---|---|---|
| 7 | Preventivi | `preventivi` (1058) | ☐ |
| 8 | Ordini cliente | `ordini` (1019) | ☐ |
| 9 | DDT | `ddt` (1356) | ☐ |
| 10 | Note di credito | `note-credito` (961) | ☐ |
| 11 | Fatture ricorrenti | `fatture-ricorrenti` (331) | ☐ |
| 12 | Fatture elettroniche (SDI) | `fatture-elettroniche` | ☐ |

### Onda 3 — Acquisti e magazzino
| # | Schermata | File (righe) | Stato |
|---|---|---|---|
| 13 | Acquisti + i suoi 2 dialog | `acquisti` (930) — **3 `alert()` nei dialog** | ☐ |
| 14 | Arrivi merce | `arrivi-merce` (706) | ☐ |
| 15 | Ordini fornitore | `ordini-fornitore` | ☐ |
| 16 | Fornitori | `fornitori` (659) | ☐ |
| 17 | Magazzino / movimenti | `magazzino` (504) | ☐ |
| 18 | OCR fatture | `ocr-fatture` (578) | ☐ |
| 19 | SDI ricevute | `sdi-passive` | ☐ |

### Onda 4 — Contabilità
| # | Schermata | File (righe) | Stato |
|---|---|---|---|
| 20 | Pagamenti | `pagamenti` (429) | ☐ |
| 21 | Scadenzario | `scadenzario` | ☐ |
| 22 | Scadenze fiscali | `scadenze-fiscali` | ☐ |
| 23 | Prima nota | `prima-nota` | ☐ |
| 24 | Riconciliazione bancaria | `riconciliazione` | ☐ |
| 25 | Compliance fiscale | `compliance` | ☐ |
| 26 | Listini | `listini` (952) | ☐ |
| 27 | Agenti e provvigioni | `agenti` | ☐ |

### Onda 5 — Strumenti e sistema
| # | Schermata | File (righe) | Stato |
|---|---|---|---|
| 28 | Impostazioni | `impostazioni` (1379) | ☐ |
| 29 | Agenda | `agenda` (1045) | ☐ |
| 30 | Report (andamento) | `report` | ☐ |
| 31 | Report tabellari | `reports` | ☐ |
| 32 | Archivi | `archivi` | ☐ |
| 33 | Storico | `storico` | ☐ |
| 34 | Lavagna | `lavagna` (334) | ☐ |
| 35 | E-commerce | `ecommerce` | ☐ |
| 36 | Aiuto | `aiuto` (779) | ☐ |

### Onda 6 — Bordi, accesso e amministrazione
| # | Schermata | File (righe) | Stato |
|---|---|---|---|
| 37 | Benvenuto offline (primo avvio) | `shared/welcome-offline` (390) | ☐ |
| 38 | Selettore archivi / sblocco | `src-tauri` `PICKER_HTML` | ☐ |
| 39 | Login · Reset password · Verifica email | `login` (676), `reset-password` (372), `verify-email` | ☐ |
| 40 | Account · Abbonamento · Trial scaduto | `account` (429), `billing`, `trial-expired` | ☐ |
| 41 | FAQ · Legale | `faq` (618), `legal` (588) | ☐ |
| 42 | Admin · Console SaaS | `admin` (537), `super-admin` (595) — **`alert()` + `prompt()`** | ☐ |
| 43 | **Decisione su `/crm` e `/timesheet`** (B10): rimetterle nel menu o rimuovere le rotte | `crm`, `timesheet` | ☐ |

### Trasversale — i 66 dialog
Si auditano **insieme alla schermata che li apre**: un dialog fuori dal suo contesto non si
giudica. I dialog condivisi (`shared/`) hanno una scheda propria perché ricadono ovunque:
`prodotto-picker`, `import-mapping-dialog`, `copia-righe-dialog`, `email-dialog`,
`doc-info-dialog`, `column-picker`, `barcode-scanner-dialog`, `fatture-insolute-dialog`,
`allegati/`, `info-dialog`, `bug-report-dialog`, `shortcuts-dialog`.

**Perimetro totale:** 3 interventi di harness + 10 bonifiche globali + 43 voci di
schermata + 12 dialog condivisi.

---

## 7. Presidio: impedire che i difetti rientrino

Le bonifiche di Fase B si disfano da sole se nulla le protegge — M2 lo dimostra (43 → 0 → 8).
Serve uno script `scripts/ui-guard.sh` che fallisca sulle regole binarie, eseguito prima di
ogni release:

```
✗ alert( / confirm( / prompt( nativi                        → deve essere 0
✗ .subscribe(() => …) su chiamate di scrittura senza error: → deve essere 0
✗ colori esadecimali negli SCSS dei componenti              → deve essere 0
✗ mat-icon-button senza aria-label                          → deve essere 0
```

Da agganciare a `.github/workflows/tauri-release.yml`, che oggi si limita a compilare.

---

## 8. Come procediamo insieme

**Ritmo:** una schermata alla volta, con screenshot prima/dopo, così a ogni passo si vede il
miglioramento concreto e resta il controllo sulle scelte di design. Le bonifiche di Fase B
sono l'eccezione: toccano molti file, quindi vanno presentate come un blocco unico da
approvare prima di partire.

**Stato e prossimi passi:**

1. ~~**A1 + A2 + A3** — galleria schermate con quattro stati dei dati.~~ ✅ **Fatta.**
   Ha ripagato subito: B12 (numero documento coperto su mobile in sei liste), B13, ~~B14~~
   (falso positivo, vedi backlog), B15 e B16 sono usciti al primo giro di ricognizione.
2. ~~**B.1**~~ ✅ · ~~**B.2**~~ ✅ · ~~**B.11**~~ ✅ · ~~**B.12**~~ ✅ · ~~**B.10**~~ ✅ ·
   ~~**B.3**~~ ✅ · ~~**B.9**~~ ✅ (investigato, zero leak) · ~~**B.8**~~ ✅ — ciascuno in un
   commit isolato e verificato con lo smoke test automatico (che B.10 stesso ha introdotto).
   B.2 è stato riaperto e richiuso una seconda volta: l'audit iniziale non aveva contato 9
   popup nativi introdotti dopo, ora presidiati in CI (`scripts/ui-guard.sh`).
3. **B.7** — parziale: fatto su Fatture/Clienti/Prodotti/Dashboard, resta Vendita al banco.
4. **Restano B.5 e B.4** — le due bonifiche più rischiose e a superficie più larga (vedi
   HANDOFF-UI-UX.md per le note su cosa rende B.5 meno banale di come sembrava, e sulla vera
   dimensione di B.4 una volta contati anche i colori inline).
5. **Onda 1** — Home, Fatture, Clienti, Prodotti, Vendita al banco, Dashboard, col ciclo
   §5 e un commit per lente. Non ancora iniziata: quanto fatto finora è la Fase B che la
   precede per design.

**Quando fermarsi e chiedere:** se durante un audit emerge che sistemare un difetto
richiede cambiare un comportamento (non solo l'aspetto), quella modifica **non si fa** —
si documenta nella scheda e si decide insieme. Il vincolo §0 vale sempre.
