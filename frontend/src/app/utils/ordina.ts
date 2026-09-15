import type { Sort } from '@angular/material/sort';

/**
 * Ordinamento per le tabelle che non passano da un MatTableDataSource: liste già
 * filtrate o paginate a mano, e tabelle HTML semplici. Il `matSort` del template
 * emette lo stato con `(matSortChange)` e qui lo si applica ai dati, così le
 * frecce e il comportamento sono gli stessi di tutte le altre liste.
 *
 * I valori vuoti finiscono sempre in fondo, in entrambe le direzioni: sono le
 * righe su cui non c'è niente da confrontare. I testi si confrontano in modo
 * "naturale" (RO-9 prima di RO-10) e senza badare a maiuscole e accenti.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function ordinaPer<T>(
  righe: readonly T[],
  sort: Sort | null | undefined,
  valore: (riga: T, colonna: string) => unknown = (r, c) => (r as any)[c],
): T[] {
  if (!sort?.active || !sort.direction) return righe as T[];
  const segno = sort.direction === 'asc' ? 1 : -1;
  const colonna = sort.active;
  return [...righe].sort((a, b) => {
    const x = valore(a, colonna);
    const y = valore(b, colonna);
    const xVuoto = vuoto(x);
    const yVuoto = vuoto(y);
    if (xVuoto || yVuoto) return xVuoto === yVuoto ? 0 : xVuoto ? 1 : -1;
    return segno * confronta(x, y);
  });
}

function vuoto(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function confronta(x: unknown, y: unknown): number {
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  return collator.compare(String(x), String(y));
}
