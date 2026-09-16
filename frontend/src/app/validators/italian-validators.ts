import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function normalizePiva(raw: string): string {
  let v = (raw ?? '').replace(/[\s.\-/]/g, '').toUpperCase();
  if (v.startsWith('IT')) v = v.slice(2);
  return v;
}

/**
 * Cifra di controllo della partita IVA italiana (Luhn, variante ministeriale).
 * Stesso algoritmo del backend (`src-tauri/src/ocr_parse.rs::valida_piva`).
 *
 * Senza questo controllo bastava che fossero 11 cifre: una P.IVA con un refuso
 * passava la validazione, finiva in anagrafica e poi nella fattura elettronica,
 * dove è lo SdI a scartarla — cioè esattamente l'errore che la validazione
 * dovrebbe intercettare prima.
 */
export function pivaChecksumValido(v: string): boolean {
  if (!/^\d{11}$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let n = +v[i];
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somma += n;
  }
  return somma % 10 === 0;
}

export function pIvaValidator(control: AbstractControl): ValidationErrors | null {
  const v = normalizePiva(control.value ?? '');
  if (!v) return null;
  if (!/^\d{11}$/.test(v)) return { pIva: true };
  return pivaChecksumValido(v) ? null : { pIva: true, pIvaChecksum: true };
}

/** Tabelle ufficiali del carattere di controllo del codice fiscale. */
const CF_DISPARI: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
function cfValorePari(c: string): number {
  return c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
}

/**
 * Carattere di controllo del codice fiscale a 16 caratteri.
 * Funziona anche sui codici "omocodici" (cifre sostituite da lettere): le
 * tabelle coprono già lettere e cifre in ogni posizione.
 */
export function cfChecksumValido(v: string): boolean {
  if (!/^[A-Z0-9]{15}[A-Z]$/.test(v)) return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = v[i];
    // Posizioni dispari/pari sono 1-based: l'indice 0 è la prima, dispari.
    somma += i % 2 === 0 ? CF_DISPARI[c] : cfValorePari(c);
  }
  return String.fromCharCode(65 + (somma % 26)) === v[15];
}

export function codiceFiscaleValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value ?? '').replace(/\s/g, '').toUpperCase();
  if (!v) return null;
  // Persone giuridiche: il CF coincide con la partita IVA (11 cifre).
  if (/^\d{11}$/.test(v)) {
    return pivaChecksumValido(v) ? null : { codiceFiscale: true, codiceFiscaleChecksum: true };
  }
  if (!/^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(v)) return { codiceFiscale: true };
  return cfChecksumValido(v) ? null : { codiceFiscale: true, codiceFiscaleChecksum: true };
}

export function telefonoValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value ?? '').trim();
  if (!v) return null;
  return /^[0-9\s\+\-\(\)\/\.]{4,20}$/.test(v) ? null : { telefono: true };
}

export function capValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value ?? '').trim();
  if (!v) return null;
  return /^\d{5}$/.test(v) ? null : { cap: true };
}

/**
 * Resto modulo 97 dell'IBAN (ISO 13616). Prima si controllava solo la forma:
 * un IBAN con una cifra sbagliata veniva accettato e il bonifico partiva — o
 * meglio non partiva — con le coordinate storte.
 */
export function ibanChecksumValido(v: string): boolean {
  const riordinato = v.slice(4) + v.slice(0, 4);
  let resto = 0;
  for (const ch of riordinato) {
    const val = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of val) resto = (resto * 10 + (+d)) % 97;
  }
  return resto === 1;
}

export function ibanValidator(control: AbstractControl): ValidationErrors | null {
  const v: string = (control.value ?? '').replace(/\s/g, '').toUpperCase();
  if (!v) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(v)) return { iban: true };
  if (v.startsWith('IT') && v.length !== 27) return { iban: true };
  return ibanChecksumValido(v) ? null : { iban: true, ibanChecksum: true };
}

export function quantitaPositivaValidator(control: AbstractControl): ValidationErrors | null {
  const v = Number(control.value);
  if (control.value === null || control.value === '') return null;
  return v > 0 ? null : { quantitaPositiva: true };
}

export function prezzoNonNegativoValidator(control: AbstractControl): ValidationErrors | null {
  const v = Number(control.value);
  if (control.value === null || control.value === '') return null;
  return v >= 0 ? null : { prezzoNonNegativo: true };
}

export function scontoValidator(control: AbstractControl): ValidationErrors | null {
  const v = Number(control.value);
  if (control.value === null || control.value === '') return null;
  if (v < 0) return { scontoNegativo: true };
  if (v > 100) return { scontoMassimo: true };
  return null;
}

export function percentualeValidator(control: AbstractControl): ValidationErrors | null {
  const v = Number(control.value);
  if (control.value === null || control.value === '') return null;
  if (v < 0 || v > 100) return { percentuale: true };
  return null;
}

export function giornoMeseValidator(control: AbstractControl): ValidationErrors | null {
  const v = Number(control.value);
  if (control.value === null || control.value === '') return null;
  return v >= 1 && v <= 28 ? null : { giornoMese: true };
}

export function minValueValidator(min: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = Number(control.value);
    if (control.value === null || control.value === '') return null;
    return v >= min ? null : { minValue: { min, actual: v } };
  };
}

export function maxValueValidator(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = Number(control.value);
    if (control.value === null || control.value === '') return null;
    return v <= max ? null : { maxValue: { max, actual: v } };
  };
}
