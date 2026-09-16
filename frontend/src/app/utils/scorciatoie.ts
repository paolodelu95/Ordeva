/**
 * Tasto modificatore delle scorciatoie, secondo il sistema operativo.
 *
 * Il segnaposto della ricerca era scritto a mano come "(⌘K)" in tutte e cinque
 * le lingue: su Windows e Linux — le uniche piattaforme con aggiornamento
 * automatico — mostrava il simbolo del Mac. Il dialogo delle scorciatoie invece
 * distingueva già le piattaforme: ora la fonte è una sola.
 */

/** True su macOS/iPadOS. `userAgentData` quando c'è, `platform` (deprecato) come ripiego. */
export function isMac(): boolean {
  const uaPlat = (navigator as any).userAgentData?.platform as string | undefined;
  const plat = uaPlat || navigator.platform || '';
  return /mac|iphone|ipad/i.test(plat);
}

/** Etichetta del modificatore da usare come chip a sé: "⌘" oppure "Ctrl". */
export function tastoModificatore(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/** Prefisso da concatenare al tasto: "⌘K" su Mac, "Ctrl+K" altrove. */
export function prefissoModificatore(): string {
  return isMac() ? '⌘' : 'Ctrl+';
}
