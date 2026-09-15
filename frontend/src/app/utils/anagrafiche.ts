/**
 * Anagrafiche (clienti/fornitori) selezionabili in un documento.
 *
 * Un'anagrafica con documenti collegati non si può eliminare — romperebbe i
 * documenti che la citano — quindi si "nasconde": resta nel database e nello
 * storico, ma sparisce dalle liste di scelta così non la si prende per sbaglio
 * componendo un documento nuovo.
 *
 * `selezionabili` va applicata alla lista che alimenta l'autocomplete, MAI a
 * quella che alimenta l'elenco della pagina anagrafiche (lì i nascosti devono
 * poter riemergere con l'apposito filtro).
 */

interface Anagrafica {
  id?: number;
  nascosto?: boolean;
}

/**
 * Toglie le anagrafiche nascoste, tenendo però quella già usata dal documento
 * aperto: senza questa eccezione, riaprendo un vecchio documento intestato a
 * un'anagrafica nascosta il campo risulterebbe vuoto e si perderebbe il
 * riferimento al primo salvataggio.
 */
export function selezionabili<T extends Anagrafica>(list: T[], selezionatoId?: number | null): T[] {
  return list.filter(a => !a.nascosto || (selezionatoId != null && a.id === selezionatoId));
}
