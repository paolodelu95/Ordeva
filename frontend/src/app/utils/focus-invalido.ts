/**
 * Porta il fuoco sul primo campo non valido di un form.
 *
 * Premendo "Salva" con un obbligatorio vuoto comparivano solo il bordo rosso e
 * uno snackbar: il fuoco restava sul bottone, quindi chi naviga da tastiera (o
 * usa uno screen reader) non aveva modo di sapere QUALE campo correggere, e su
 * un dialog lungo il campo poteva essere fuori schermo.
 */
export function focusPrimoInvalido(root: HTMLElement | null | undefined): boolean {
  if (!root) return false;
  const el = root.querySelector<HTMLElement>(
    'input.ng-invalid, textarea.ng-invalid, select.ng-invalid, mat-select.ng-invalid',
  );
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // focus() su mat-select va sull'host, che è già focusable.
  setTimeout(() => el.focus({ preventScroll: true }), 60);
  return true;
}
