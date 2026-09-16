/**
 * Date in formato `yyyy-MM-dd` **in ora locale**.
 *
 * `new Date().toISOString().slice(0, 10)` restituisce la data UTC: in Italia
 * (UTC+1/+2) la mezzanotte locale è ancora il giorno prima in UTC, quindi
 * quella forma sbaglia di un giorno ogni volta che l'ora locale è avanti su
 * UTC — tutta la notte per i documenti (un DDT delle 00:30 nasceva datato
 * ieri) e **sempre** per le date costruite a mezzanotte, come le celle del
 * calendario dell'agenda.
 *
 * Qui la data si formatta dai getter locali, che è ciò che l'utente vede e ciò
 * che il backend si aspetta: `data_emissione`, `scadenza`, `data` sono tutte
 * date civili italiane, non istanti UTC.
 */

/** `yyyy-MM-dd` della data passata, in ora locale. */
export function isoLocale(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `yyyy-MM-dd` di oggi, in ora locale. */
export function isoOggi(): string {
  return isoLocale(new Date());
}

/** `yyyy-MM-ddTHH:mm` di adesso, in ora locale (campi `datetime-local`). */
export function isoOraLocale(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${isoLocale(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
