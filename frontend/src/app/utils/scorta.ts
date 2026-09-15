/**
 * Distingue gli articoli tenuti a magazzino da quelli che non lo sono.
 *
 * Ordeva non ha un flag "servizio": manodopera, trasporto e prestazioni si
 * inseriscono come prodotti qualsiasi. Il segnale utile è già nei dati — la
 * soglia minima, che il modello descrive come "null/0 = nessun avviso di scorta
 * (es. su ordinazione)" — insieme a una giacenza diversa da zero.
 *
 * Senza questa distinzione una riga di manodopera si comportava come merce:
 * compariva "Giac. 0" in rosso a ogni documento, il venduto scendeva sotto zero
 * e una nota di credito rimetteva "a magazzino" delle ore di lavoro.
 */

interface ArticoloScorta {
  quantita?: number;
  sogliaMinima?: number | null;
}

export function gestitoAScorta(p: ArticoloScorta | null | undefined): boolean {
  if (!p) return false;
  return (p.sogliaMinima ?? 0) > 0 || (p.quantita ?? 0) !== 0;
}
