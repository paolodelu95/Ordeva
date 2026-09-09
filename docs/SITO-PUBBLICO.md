# Sito pubblico ordeva.it

Sito statico minimo che serve a tre cose:

1. **Pagine legali pubbliche** (`/privacy`, `/termini`) richieste da eBay, Amazon e
   Google per approvare le rispettive integrazioni.
2. **Pagine di ritorno OAuth** (`/oauth/amazon`, `/oauth/ebay`) che rimbalzano
   dentro l'app desktop via deep link `ordevaauth://`.
3. Una **landing** essenziale con link al download.

Sorgente: cartella [`site/`](../site) del repo. Nessun build step: sono file HTML/CSS
statici, si pubblicano così come sono.

---

## 1. Compilare i segnaposto

Cerca `[DA COMPILARE:` in `site/` e sostituisci ovunque con i dati reali del
**titolare persona fisica**:

| Segnaposto | Valore |
|---|---|
| `[DA COMPILARE: Nome e Cognome]` | il tuo nome completo |
| `[DA COMPILARE: data]` (codice fiscale) | il tuo codice fiscale |
| `[DA COMPILARE: città]` / indirizzo | comune (indirizzo completo se disponibile) |
| `[DA COMPILARE: email]` | email di contatto pubblica (es. `info@ordeva.it`) |
| `[DA COMPILARE: PEC]` | la tua PEC (o rimuovi la riga se non ne hai una) |
| `[DA COMPILARE: data]` (in `<p class="meta">`) | data di pubblicazione, es. `9 settembre 2026` |

```
grep -rn "DA COMPILARE" site/
```

> I testi di `privacy.html` e `termini.html` sono **bozze coerenti con come funziona
> davvero Ordeva** (app offline, dati solo sul dispositivo, integrazioni facoltative).
> Sono adatti alla revisione di eBay/Amazon, ma una lettura da parte di un legale
> resta consigliata prima di operare a regime.

---

## 2. Pubblicare su Cloudflare Pages

### 2a. Account + progetto

1. Crea un account su <https://dash.cloudflare.com> (gratis).
2. **Workers & Pages → Create → Pages → Connect to Git.**
3. Autorizza GitHub e scegli il repo `paolodelu95/Ordeva`.
4. Configurazione build:
   - **Production branch:** `offline-electron` (o il branch che usi per le release)
   - **Framework preset:** `None`
   - **Build command:** *(vuoto)*
   - **Build output directory:** `site`
5. **Save and Deploy.** Ottieni un URL tipo `ordeva-xyz.pages.dev` — verifica che
   `/privacy`, `/termini`, `/oauth/amazon` rispondano.

Da qui in poi ogni push sul branch ripubblica il sito automaticamente.

### 2b. Dominio ordeva.it

Cloudflare gestisce meglio il dominio se ne diventa anche il DNS.

1. **Cloudflare dashboard → Add a site → `ordeva.it`** → piano Free.
2. Cloudflare importa i record DNS esistenti: **controlla che ci siano tutti**
   (soprattutto MX / eventuali record email e la PEC — non perderli).
3. Cloudflare ti dà **2 nameserver** (es. `xxx.ns.cloudflare.com`).
4. Vai dal **registrar dove hai comprato `ordeva.it`** e sostituisci i nameserver
   attuali con quelli di Cloudflare. La propagazione richiede da minuti a ~24 h.
5. Quando il dominio risulta *Active* su Cloudflare:
   **Workers & Pages → il tuo progetto → Custom domains → Set up a custom domain**
   → aggiungi `ordeva.it` **e** `www.ordeva.it`. Cloudflare crea i record e il
   certificato HTTPS da solo.

### 2c. (Opzionale) se NON vuoi spostare il DNS su Cloudflare

Puoi tenere il DNS dove sta e puntare solo il sito:

- record `CNAME` `ordeva.it` → `<progetto>.pages.dev` (se il registrar supporta
  CNAME sull'apex; altrimenti usa i record `A`/`AAAA` che Cloudflare indica nella
  schermata Custom domains).
- In questo caso il certificato lo emette comunque Cloudflare Pages.

---

## 3. URL finali da usare nei form di eBay / Amazon / Google

| Serve per | URL |
|---|---|
| Privacy policy | `https://ordeva.it/privacy` |
| Termini e condizioni | `https://ordeva.it/termini` |
| Redirect OAuth Amazon (SP-API) | `https://ordeva.it/oauth/amazon` |
| Redirect OAuth eBay (Auth Accepted URL del RuName) | `https://ordeva.it/oauth/ebay` |
| Sito / homepage dell'app | `https://ordeva.it` |

> **eBay:** oggi il collegamento è in Sandbox. Se e quando l'"Auth Accepted URL" del
> RuName va impostato a un URL https, usa `https://ordeva.it/oauth/ebay`. Poi serve
> un piccolo aggiornamento nel frontend (vedi sotto).

---

## 4. Lavoro lato codice collegato (lo faccio io)

`frontend/src/app/components/marketplace/marketplace-canali.ts` →
`handleOauthCallback()` oggi gestisce **solo eBay** e legge solo `?code=`.
Va generalizzato per instradare in base all'host del deep link:

- `ordevaauth://amazon?spapi_oauth_code=…&selling_partner_id=…&state=…` → `POST /api/marketplace/amazon/exchange-code`
- `ordevaauth://ebay?code=…` → `POST /api/marketplace/ebay/exchange-code`

Vedi [`AMAZON-SP-API.md`](./AMAZON-SP-API.md) per il resto.
