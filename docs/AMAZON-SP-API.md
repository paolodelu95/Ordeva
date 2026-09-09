# Integrazione Amazon (Selling Partner API) — checklist

Obiettivo: importare in Ordeva gli **ordini conclusi** di Amazon (sola lettura),
per scaricare il magazzino e alimentare le statistiche di vendita — esattamente
come già avviene per eBay.

Modello scelto: **app OAuth pubblica**. Ordeva si registra una volta come app SP-API;
ogni venditore la collega con un click + consenso nel proprio Seller Central.
È l'unico modo per avere l'esperienza "un click" per l'utente finale.

> ⚠️ La console Amazon (nomi delle voci, ordine dei passaggi) cambia spesso. I nomi
> qui sotto sono indicativi: la sostanza — profilo sviluppatore → app in draft →
> test sandbox → richiesta pubblicazione → go live — resta.

---

## Stato attuale nel codice

Già pronto (generico per canale): schema DB (`canale='AMAZON'`), tabella
`marketplace_config` / `marketplace_mapping`, endpoint `/configs`, `/abbina`,
`/toggle`, `/disconnetti`, report **Vendite → Marketplace**, statistiche, i18n.

Da fare (lato codice, lo faccio io — vedi §6): client SP-API, route
`/marketplace/amazon/*`, card "Connetti Amazon" al posto di quella "in attesa",
gestione del deep-link `ordevaauth://amazon`, flag `AMAZON_SANDBOX`.

Oggi `list_configs` risponde `"amazonDisponibile": false` e la UI mostra
`marketplace.amazonAttesa`.

---

## Fase 0 — Prerequisiti (da verificare subito)

- [ ] **Account Amazon idoneo.** La registrazione al programma sviluppatori SP-API
      passa da Seller Central e in genere richiede un **account Vendo Professionale**
      in regola. Se non vendi su Amazon, verifica la disponibilità del percorso
      "solution provider / developer-only" per la tua zona: è il primo ostacolo
      possibile.
- [ ] **Dati per il profilo sviluppatore.** Amazon chiede informazioni di tipo
      aziendale (ragione sociale, sede, referente). Operando come **persona fisica**
      dovrai inserire i tuoi dati anagrafici: preparati a possibili richieste di
      chiarimento da parte di Amazon.
- [ ] **Sito pubblico online** con `https://ordeva.it/privacy` e
      `https://ordeva.it/termini` raggiungibili → vedi [`SITO-PUBBLICO.md`](./SITO-PUBBLICO.md).
- [ ] **Pagina di redirect** `https://ordeva.it/oauth/amazon` online (già nel repo,
      in `site/`).

---

## Fase 1 — Registrazione come sviluppatore

1. Seller Central → **Apps & Services → Develop Apps** (Developer Central).
2. Se non sei ancora sviluppatore: **compila il profilo sviluppatore**. Sezioni tipiche:
   - dati dell'organizzazione / referente;
   - **questionario sulla sicurezza dei dati (Data Protection)**: descrivi che Ordeva
     è un'app desktop, i dati restano sul dispositivo dell'utente, i token sono
     salvati solo in locale e cifrati a riposo dove possibile, nessun server centrale
     riceve dati dei venditori;
   - dichiara che **non tratterai dati personali (PII)** degli acquirenti.
3. Invia e **attendi l'approvazione** del profilo (giorni → settimane).

---

## Fase 2 — Creazione dell'app (draft)

Developer Central → **Add new app client**.

- **App name:** `Ordeva`
- **API type:** SP-API
- **Roles (scopes):** seleziona **solo `Orders`**.
  NON selezionare ruoli con PII ("Direct-to-Consumer Shipping", "Tax Invoicing",
  "Amazon Fulfillment" con dati acquirente, ecc.): tengono la review molto più pesante
  e non ci servono.
- **OAuth**
  - **Login URI:** `https://ordeva.it`
  - **Redirect URI:** `https://ordeva.it/oauth/amazon`
- Salva. Ottieni:
  - **App ID** (serve per costruire l'URL di consenso)
  - **LWA client ID** e **LWA client secret** (le credenziali che mi servono)

L'app nasce in **draft**: puoi autorizzarla sul **tuo** account venditore e usarla
in **sandbox**. Basta per sviluppare e testare tutto.

---

## Fase 3 — Sviluppo e test in Sandbox (lato codice)

Nessun blocco lato Amazon: si può fare mentre le review sono pendenti.

Dettagli tecnici in §7. Test end-to-end con:
- `AMAZON_SANDBOX=1` → host `https://sandbox.sellingpartnerapi-eu.amazon.com`
- auto-autorizzazione dell'app draft sul tuo account
- risposte sandbox statiche per `getOrders` / `getOrderItems`

Al termine: connessione, import ordini, mapping SKU→prodotto e "abbina" funzionanti
come per eBay.

---

## Fase 4 — Richiesta di pubblicazione (autorizzazione di venditori terzi)

Per far collegare l'app a venditori diversi dal tuo account, l'app va **pubblicata**
(listata sull'Amazon Selling Partner Appstore oppure "unlisted"/non listata ma
condivisibile via link di autorizzazione).

- [ ] Developer Central → l'app → **Submit for review / Publish**.
- [ ] Compila la scheda: descrizione, categoria, sito, **privacy** (`/privacy`),
      **termini** (`/termini`), screenshot, marketplace supportati (Italia + eventuali
      altri EU).
- [ ] Ripassa la **Data Protection Policy**: senza PII e senza server centrale la
      posizione è semplice, ma preparati a domande.
- [ ] Invia e attendi l'esito (settimane; Amazon può chiedere revisioni o rifiutare
      app a basso volume — mettere in conto qualche giro).

---

## Fase 5 — Go live

- [ ] App approvata / pubblicata.
- [ ] Nel build di produzione: `AMAZON_SANDBOX` **vuoto/rimosso** → host di produzione
      `https://sellingpartnerapi-eu.amazon.com`.
- [ ] Nell'URL di consenso: rimuovi `version=beta`.
- [ ] Backend: `amazonDisponibile: true`.
- [ ] Release con la card Amazon attiva.
- [ ] Aggiorna la voce guida `aiuto.sez.sincronizzazione.passo3` (oggi dice "in attesa").

---

## 6. Cosa devi darmi

Come secret del repo GitHub (**Settings → Secrets and variables → Actions**), sullo
stesso modello di `EBAY_CLIENT_ID` ecc. — il workflow `tauri-release.yml` li legge già
per eBay/Google, aggiungerò le righe Amazon:

| Secret | Valore |
|---|---|
| `AMAZON_LWA_CLIENT_ID` | LWA client ID dell'app |
| `AMAZON_LWA_CLIENT_SECRET` | LWA client secret dell'app |
| `AMAZON_APP_ID` | App ID (per l'URL di consenso) |
| `AMAZON_SANDBOX` | `1` finché si testa in sandbox, poi vuoto |

Mai nel codice, mai committati: letti a tempo di compilazione via `option_env!()`,
come per eBay.

---

## 7. Riferimenti tecnici

**Niente AWS SigV4 / utente IAM.** Da fine 2023 SP-API richiede solo il token LWA
nell'header `x-amz-access-token`.

**LWA — token endpoint:** `https://api.amazon.com/auth/o2/token`
- scambio code → token: `grant_type=authorization_code`, `code=<spapi_oauth_code>`,
  `redirect_uri=https://ordeva.it/oauth/amazon`, `client_id`, `client_secret`
  → risposta con `refresh_token` (da salvare per-venditore in `marketplace_config`)
  e `access_token` (durata ~1 h).
- rinnovo: `grant_type=refresh_token`, `refresh_token=…`, `client_id`, `client_secret`.

**URL di consenso (app-initiated, app in draft):**
```
https://sellercentral.amazon.it/apps/authorize/consent
  ?application_id=<AMAZON_APP_ID>
  &state=<state-casuale>
  &version=beta          ← solo finché l'app è in draft
```
Redirect di ritorno: `https://ordeva.it/oauth/amazon?spapi_oauth_code=…&state=…&selling_partner_id=…`
(oppure `?error=…&error_description=…` se il venditore rifiuta).

**Host API (regione Europa):**
- produzione: `https://sellingpartnerapi-eu.amazon.com`
- sandbox: `https://sandbox.sellingpartnerapi-eu.amazon.com`

**Marketplace ID:** Italia `APJ6JRA9NG5V4`
(DE `A1PA6795UKMFR9`, FR `A13V1IB3VIYZZH`, ES `A1RKKUPIHCS9HS`, NL `A1805IZSGTT6HS`).

**Endpoint ordini (sola lettura):**
- `GET /orders/v0/orders?MarketplaceIds=APJ6JRA9NG5V4&CreatedAfter=<ISO8601>` — lista
  (usare `LastUpdatedAfter` per i giri successivi; paginazione con `NextToken`).
- `GET /orders/v0/orders/{orderId}/orderItems` — righe (SKU, titolo, quantità, prezzo).

**PII acquirente:** i campi `BuyerInfo` e `ShippingAddress` sono *restricted* e
richiedono un Restricted Data Token + ruolo PII + audit più severo. **Non li
richiediamo.** Come per eBay, la vendita importata usa un'etichetta generica
("Acquirente Amazon") + numero ordine.

**Rate limit** `getOrders`: ~1 richiesta/minuto con burst — più che sufficiente per
un import manuale/periodico.

**Mapping prodotti:** riuso `marketplace_mapping` con `canale='AMAZON'`; le righe con
SKU non riconosciuto finiscono nel dialog "abbina" già esistente.

---

## 8. Ordine consigliato dei lavori

1. **Ora:** pubblica il sito ([`SITO-PUBBLICO.md`](./SITO-PUBBLICO.md)) — serve a eBay e Amazon.
2. **Ora:** io scrivo il client SP-API + UI, targettizzato sandbox (non serve niente da Amazon).
3. **Tu:** avvia la registrazione sviluppatore (Fase 1) — è la coda più lunga.
4. Profilo approvato → crei l'app (Fase 2) → mi passi i secret → test sandbox reale.
5. Funziona in sandbox → richiesta di pubblicazione (Fase 4).
6. Approvata → go live (Fase 5) in una release.
