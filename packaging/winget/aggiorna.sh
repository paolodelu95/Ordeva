#!/usr/bin/env bash
# Allinea i manifest winget a una release già pubblicata: scarica gli installer,
# ne calcola gli SHA256 e riscrive versione, URL, hash e data.
#
# USO
#   packaging/winget/aggiorna.sh 1.2.90
#
# Poi si apre il PR su microsoft/winget-pkgs: vedi packaging/winget/README.md.
set -euo pipefail

VERSIONE="${1:-}"
if [ -z "$VERSIONE" ]; then
  echo "Uso: $0 <versione>   (es. $0 1.2.90)" >&2
  exit 1
fi

cd "$(dirname "$0")"
REPO=paolodelu95/Ordeva
BASE="https://github.com/$REPO/releases/download/v$VERSIONE"
EXE="Ordeva_${VERSIONE}_x64-setup.exe"
MSI="Ordeva_${VERSIONE}_x64_en-US.msi"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "Scarico gli installer della v${VERSIONE}…"
gh release download "v$VERSIONE" --repo "$REPO" --dir "$TMP" --pattern "$EXE" --pattern "$MSI"

hash_di() { shasum -a 256 "$1" | awk '{print toupper($1)}'; }
SHA_EXE=$(hash_di "$TMP/$EXE")
SHA_MSI=$(hash_di "$TMP/$MSI")
OGGI=$(date +%Y-%m-%d)

# Versione e URL in tutti i manifest.
for f in Ordeva.Ordeva.yaml Ordeva.Ordeva.installer.yaml Ordeva.Ordeva.locale.*.yaml; do
  perl -0pi -e "s/^PackageVersion: .*/PackageVersion: $VERSIONE/m" "$f"
  perl -0pi -e "s|releases/tag/v[0-9]+\.[0-9]+\.[0-9]+|releases/tag/v$VERSIONE|g" "$f"
done

# Installer: URL, hash e data di pubblicazione.
perl -0pi -e "s|InstallerUrl: .*x64-setup\.exe|InstallerUrl: $BASE/$EXE|" Ordeva.Ordeva.installer.yaml
perl -0pi -e "s|InstallerUrl: .*x64_en-US\.msi|InstallerUrl: $BASE/$MSI|" Ordeva.Ordeva.installer.yaml
perl -0pi -e "s/InstallerSha256: [0-9A-F]{64}(?=\n    UpgradeBehavior)/InstallerSha256: $SHA_EXE/" Ordeva.Ordeva.installer.yaml
perl -0pi -e "s/ReleaseDate: '.*'/ReleaseDate: '$OGGI'/" Ordeva.Ordeva.installer.yaml

# Il secondo hash (MSI) è quello che segue l'URL dell'MSI: si sostituisce a parte
# perché la regex sopra prende solo il primo blocco.
python3 - "$SHA_EXE" "$SHA_MSI" <<'PY'
import re, sys
sha_exe, sha_msi = sys.argv[1], sys.argv[2]
p = 'Ordeva.Ordeva.installer.yaml'
s = open(p).read()
hash_trovati = re.findall(r'InstallerSha256: [0-9A-F]{64}', s)
for vecchio, nuovo in zip(hash_trovati, [sha_exe, sha_msi]):
    s = s.replace(vecchio, f'InstallerSha256: {nuovo}', 1)
open(p, 'w').write(s)
PY

echo
echo "Manifest aggiornati alla v$VERSIONE:"
echo "  $EXE  $SHA_EXE"
echo "  $MSI  $SHA_MSI"
echo
echo "Controlla il diff, poi apri il PR (vedi README.md)."
