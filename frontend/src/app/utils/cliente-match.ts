import { normalizePiva } from '../validators/italian-validators';

/**
 * Toglie accenti/diacritici e punteggiatura, minuscolo, spazi singoli.
 * Serve a far combaciare "Città Metropolitana" con "citta metropolitana" e
 * "S.r.l." con "SRL" nella ricerca testuale (non nella P.IVA, che ha la sua
 * normalizzazione dedicata in `normalizePiva`).
 */
export function normalizzaTesto(s: string | undefined | null): string {
  return (s ?? '')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[.,'"/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ClienteRicercabile {
  ragioneSociale?: string;
  email?: string;
  codiceFiscale?: string;
  pIva?: string;
}

/**
 * Vero se il cliente corrisponde alla query digitata:
 *  - ricerca "a token" su ragione sociale/email/codice fiscale/indirizzo, con
 *    ordine delle parole libero — "rossi mario" trova anche "Mario Rossi Srl";
 *  - OPPURE match sulla P.IVA normalizzata (tollerante a spazi/punti/trattini).
 */
export function clienteMatch(c: ClienteRicercabile, indirizzo: string, query: string): boolean {
  const q = normalizzaTesto(query);
  if (!q) return true;

  const tokens = q.split(' ').filter(Boolean);
  const hay = normalizzaTesto(`${c.ragioneSociale ?? ''} ${c.email ?? ''} ${c.codiceFiscale ?? ''} ${indirizzo}`);
  const testoOk = tokens.every(t => hay.includes(t));

  const queryPiva = normalizePiva(query);
  const pivaOk = !!queryPiva && normalizePiva(c.pIva ?? '').includes(queryPiva);

  return testoOk || pivaOk;
}
