# Distribuzione sugli store

Ordeva si scarica dalle [Releases](https://github.com/paolodelu95/Ordeva/releases/latest),
ma chi cerca un gestionale non passa da GitHub: passa dal gestore di pacchetti del
proprio sistema. Qui stanno i file per pubblicarla lì.

| Canale | File | Sforzo | Stato |
|---|---|---|---|
| **winget** (Windows) | [`winget/`](winget) | un PR per release | manifest pronti e validati, PR mai aperto |
| **Snap** (Linux) | [`../snap/snapcraft.yaml`](../snap/snapcraft.yaml) | build + upload | scritto, **mai compilato** |

Windows è il sistema dei destinatari reali di Ordeva — piccole imprese italiane —
quindi winget è il canale che rende di più a parità di lavoro.

---

## Una cosa da sapere prima di pubblicare

Le credenziali OAuth dell'applicazione (Google, eBay, Amazon) sono compilate dentro
l'eseguibile a tempo di build, prese dai secret del repository. Chi scarica un
binario ufficiale può quindi estrarle: è inevitabile per un'app desktop senza
server, e Google lo mette in conto per le credenziali "Desktop app" (infatti lì
c'è PKCE), ma **eBay non usa PKCE**, quindi quel secret va considerato pubblico.

Sugli store il problema non si pone: **Snap e Flathub compilano dai sorgenti**,
senza i secret. Le integrazioni che li richiedono si presentano come "non
configurate" e tutto il resto funziona — per un'app che si presenta come offline è
la versione più coerente. È una scelta, non una dimenticanza: sta scritta nella
descrizione dello snap.

---

## winget

I quattro manifest in [`winget/`](winget) sono validati contro gli schemi ufficiali
`1.6.0` (version, installer, defaultLocale, locale). Contengono due installer per la
stessa versione: `.exe` NSIS per utente (quello che winget sceglie di default) e
`.msi` per macchina, per chi distribuisce su più postazioni.

### A ogni release

```bash
packaging/winget/aggiorna.sh 1.2.90     # scarica gli installer, ricalcola gli SHA256
git diff packaging/winget                # controlla
```

### Aprire il PR

I manifest vanno in `microsoft/winget-pkgs`, sotto
`manifests/o/Ordeva/Ordeva/<versione>/`:

```bash
gh repo fork microsoft/winget-pkgs --clone --remote
cd winget-pkgs
mkdir -p manifests/o/Ordeva/Ordeva/1.2.90
cp /percorso/Ordeva/packaging/winget/Ordeva.Ordeva*.yaml manifests/o/Ordeva/Ordeva/1.2.90/
git checkout -b ordeva-1.2.90
git add manifests/o/Ordeva/Ordeva/1.2.90
git commit -m "New version: Ordeva.Ordeva version 1.2.90"
git push -u origin ordeva-1.2.90
gh pr create --repo microsoft/winget-pkgs --fill
```

Da Windows conviene invece `wingetcreate update Ordeva.Ordeva --version 1.2.90 --urls <url-exe> <url-msi> --submit`,
che fa tutto da solo. La pipeline di Microsoft esegue controlli automatici
(installazione reale in sandbox, antivirus): la prima volta la revisione richiede
qualche giorno, gli aggiornamenti successivi passano quasi sempre da soli.

Dopo la pubblicazione: `winget install Ordeva.Ordeva`.

---

## Snap

> **Non è mai stato compilato.** Lo `snapcraft.yaml` è scritto sulla base della
> struttura del progetto, ma serve una macchina Linux (o `multipass`) per provarlo:
> `snapcraft` non gira su macOS. Prima di pubblicare va fatto girare almeno una
> volta e vanno verificati i punti elencati sotto.

```bash
snapcraft                 # compila (dalla root del repo)
sudo snap install --dangerous ./ordeva_1.2.90_amd64.snap
snap run ordeva
```

Pubblicazione:

```bash
snapcraft login
snapcraft register ordeva          # una volta sola, se il nome è libero
snapcraft upload --release=stable ordeva_1.2.90_amd64.snap
```

### Da verificare alla prima compilazione

- **Dove finiscono i dati.** Con il confinamento `strict`, `$HOME` diventa
  `~/snap/ordeva/current`: gli archivi non stanno più in `~/.config/Ordeva`. Va
  bene, ma chi migra da un `.deb` non ritrova i suoi file da solo — serve una nota
  nelle istruzioni di installazione.
- **La WebView.** `webkit2gtk-4.1` dentro uno snap richiede che i processi
  ausiliari siano raggiungibili: se la finestra resta bianca, il sospetto è
  `WEBKIT_EXEC_PATH`.
- **Il percorso del binario.** La part `ordeva` rinomina `ordeva-desktop` in
  `usr/bin/ordeva`; se il plugin rust cambia dove installa, `command:` va corretto.
- **L'updater.** Dentro lo snap il binario è di sola lettura, quindi l'updater
  interno è disattivato: lo fa `GET /api/sistema/aggiornamenti`, che riconosce le
  variabili `SNAP` e `FLATPAK_ID` (e `ORDEVA_DISABLE_UPDATER` per gli altri
  impacchettamenti). Verifica che in Impostazioni non compaia più la proposta di
  aggiornamento.

---

## Altri canali, non ancora fatti

- **Homebrew Cask** (macOS): un PR con URL e SHA del `.dmg`, sforzo minimo.
- **Flathub**: il canale Linux che dà più credibilità, ma la build dev'essere
  **offline** — servono `flatpak-cargo-generator` per le dipendenze Rust,
  `flatpak-node-generator` per npm e un file AppStream con gli screenshot.
  L'app ID sarebbe `it.ordeva.Ordeva` (il dominio è già del progetto).
- **AUR**: un PKGBUILD, pochi utenti ma costo quasi nullo.
