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

/** Riga di documento, per quanto serve al controllo scorta. */
interface RigaScorta {
  tipo?: string;
  prodottoId?: number | null;
  quantita?: number;
  scaricaMagazzino?: boolean;
}

/** Quantità per prodotto che le righe tolgono dal magazzino (solo quelle col flag scarico). */
export function quantitaScaricate(righe: RigaScorta[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of righe) {
    if (r.tipo === 'NOTA' || !r.prodottoId || !r.scaricaMagazzino) continue;
    m.set(r.prodottoId, (m.get(r.prodottoId) ?? 0) + (r.quantita || 0));
  }
  return m;
}

export type AvvisoScorta = 'insufficiente' | 'sottoSoglia';

/**
 * Cosa lascia in magazzino un documento che scarica `uscita` da `disponibile`:
 * meno di zero, meno della soglia minima o nessun problema (`null`).
 * "Sotto soglia" come nella pagina Prodotti: solo con una soglia > 0.
 */
export function avvisoScorta(disponibile: number, uscita: number, sogliaMinima?: number | null): AvvisoScorta | null {
  const residuo = disponibile - uscita;
  if (residuo < 0) return 'insufficiente';
  const soglia = sogliaMinima ?? 0;
  return soglia > 0 && residuo < soglia ? 'sottoSoglia' : null;
}
