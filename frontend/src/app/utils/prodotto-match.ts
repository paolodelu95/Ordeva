import { Prodotto } from '../models';

export interface ProdottoMatch {
  /** match esatto su codice / barcode / codice fornitore (case-insensitive), se presente */
  exact: Prodotto | null;
  /** match parziali (la query è contenuta in codice/barcode/codice fornitore/descrizione) */
  matches: Prodotto[];
}

function norm(s: string | number | undefined | null): string {
  return (s ?? '').toString().trim().toLowerCase();
}

/**
 * Risolve una query digitata (un codice intero o parziale) in prodotti, per
 * l'inserimento rapido da tastiera nelle righe documento.
 *  - `exact`: prima corrispondenza esatta su codice / barcode / codice fornitore
 *  - `matches`: tutte le corrispondenze parziali (contiene), utili a filtrare il selettore
 */
export function findProdottoByCodice(prodotti: Prodotto[], query: string): ProdottoMatch {
  const q = norm(query);
  if (!q) return { exact: null, matches: [] };

  const exact = prodotti.find(p =>
    norm(p.codice) === q || norm(p.barcode) === q || norm(p.codiceFornitore) === q
  ) ?? null;

  // Ricerca "a token": la query viene divisa in pezzi (separati da spazi) e un
  // prodotto corrisponde se OGNI pezzo è contenuto nel testo cercabile. Così
  // "12 7" trova "SKB 12V 7,2Ah".
  // I token si cercano SOLO in codice + descrizione (i campi che l'utente legge e digita).
  // Barcode e codice fornitore sono esclusi dal match parziale: sono lunghi e pieni
  // di cifre, quindi pezzi numerici corti ("12", "5") combacerebbero con quasi ogni
  // prodotto (falsi positivi). Restano usati per il match ESATTO (scansione/codice pieno).
  const tokens = q.split(/\s+/).filter(Boolean);
  const matches = prodotti.filter(p => {
    const hay = `${norm(p.codice)} ${norm(p.descrizione)}`;
    return tokens.every(t => hay.includes(t));
  });

  return { exact, matches };
}
