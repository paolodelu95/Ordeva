import { RigaDocumento } from '../models';

/**
 * Numero utilizzabile nei conti: `null`, `undefined`, stringhe vuote e NaN
 * diventano 0.
 *
 * Serve perché un solo campo non numerico bastava a propagare NaN in tutta la
 * catena dei totali, e la pipe `currency` su NaN non stampa "0,00 €" ma una
 * stringa VUOTA: l'utente vedeva l'Imponibile e il totale della riga sparire,
 * senza alcun messaggio d'errore.
 */
export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(v as string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Totale di una riga documento: qta × prezzo × (1 − sconto%) × (1 + IVA%).
 * Se `showNetto` è true l'IVA viene esclusa (si mostra l'imponibile).
 *
 * Logica condivisa da fatture, DDT, ordini, preventivi, note di credito e
 * acquisti: prima era duplicata identica in ognuno di questi componenti.
 */
export function docRigaTotale(riga: RigaDocumento, showNetto: boolean): number {
  const netto = num(riga.quantita) * num(riga.prezzo) * (1 - num(riga.sconto) / 100);
  return showNetto ? netto : netto * (1 + num(riga.iva) / 100);
}

/** Imponibile del documento: somma delle righe al netto degli sconti. */
export function imponibileRighe(righe: RigaDocumento[]): number {
  return (righe ?? []).reduce(
    (s, r) => s + num(r.quantita) * num(r.prezzo) * (1 - num(r.sconto) / 100),
    0,
  );
}

/**
 * Converte il valore digitato nel campo prezzo in prezzo unitario NETTO.
 * In modalità "lordo" (showNetto = false) scorpora l'IVA. Mai negativo.
 *
 * `decimali`, se passato, arrotonda il risultato a quel numero di cifre
 * decimali (2 o 3, da Impostazioni → Avanzate). Omesso o `undefined`:
 * comportamento invariato — usato dai documenti fiscali (Fatture, Note di
 * Credito) che restano sempre a 2 decimali indipendentemente dall'impostazione.
 */
export function prezzoNettoDaInput(value: number, iva: number, showNetto: boolean, decimali?: number): number {
  const raw = showNetto ? num(value) : num(value) / (1 + num(iva) / 100);
  if (decimali == null) {
    return Math.max(0, showNetto ? raw : +raw.toFixed(6));
  }
  const f = 10 ** decimali;
  return Math.max(0, Math.round(raw * f) / f);
}

/**
 * Valore da mostrare nel campo prezzo della riga.
 *
 * In modalità netta si stampava `riga.prezzo` grezzo: scorporando un prezzo
 * ivato il netto ha fino a 6 decimali e il campo mostrava "8,196721". In
 * modalità ivata `+(...).toFixed(2)` faceva cadere gli zeri finali ("143,3"
 * invece di "143,30"). Qui il valore è sempre arrotondato ai decimali del
 * documento e con gli zeri finali conservati.
 */
export function prezzoPerInput(riga: RigaDocumento, showNetto: boolean, decimali = 2): string {
  const lordo = num(riga.prezzo) * (1 + num(riga.iva) / 100);
  return (showNetto ? num(riga.prezzo) : lordo).toFixed(decimali);
}
