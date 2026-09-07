import { RigaDocumento } from '../models';

/**
 * Totale di una riga documento: qta × prezzo × (1 − sconto%) × (1 + IVA%).
 * Se `showNetto` è true l'IVA viene esclusa (si mostra l'imponibile).
 *
 * Logica condivisa da fatture, DDT, ordini, preventivi, note di credito e
 * acquisti: prima era duplicata identica in ognuno di questi componenti.
 */
export function docRigaTotale(riga: RigaDocumento, showNetto: boolean): number {
  const netto = riga.quantita * riga.prezzo * (1 - (riga.sconto ?? 0) / 100);
  return showNetto ? netto : netto * (1 + riga.iva / 100);
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
  const raw = showNetto ? value : value / (1 + iva / 100);
  if (decimali == null) {
    return Math.max(0, showNetto ? raw : +raw.toFixed(6));
  }
  const f = 10 ** decimali;
  return Math.max(0, Math.round(raw * f) / f);
}
