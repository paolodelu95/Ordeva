/**
 * Locale di Angular/Material scelto all'AVVIO, dalla lingua salvata in
 * localStorage.
 *
 * `LOCALE_ID` e `MAT_DATE_LOCALE` erano fissi su `it`/`it-IT`: con
 * l'interfaccia in inglese, tedesco, spagnolo o francese le pipe `date` e
 * `number`, il datepicker e i nomi di mesi e giorni restavano comunque in
 * italiano. Sono valori di sola lettura per il ciclo di vita dell'app (Angular
 * li inietta alla costruzione), quindi si leggono qui una volta al bootstrap:
 * il cambio lingua da Impostazioni aggiorna subito le stringhe tradotte e il
 * paginatore, mentre i formati seguono dal riavvio successivo.
 */
import { lsGet } from './safe-storage';

export type LinguaUI = 'it' | 'en' | 'fr' | 'de' | 'es';

const VALIDE: LinguaUI[] = ['it', 'en', 'fr', 'de', 'es'];

/** Lingua salvata dall'utente, o italiano finché non ha scelto. */
export function linguaSalvata(): LinguaUI {
  const v = lsGet('ui-lang') || '';
  return (VALIDE as string[]).includes(v) ? (v as LinguaUI) : 'it';
}

/** Locale completo per `MAT_DATE_LOCALE` (datepicker, parsing delle date). */
export function localeMateriale(l: LinguaUI = linguaSalvata()): string {
  return { it: 'it-IT', en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[l];
}
