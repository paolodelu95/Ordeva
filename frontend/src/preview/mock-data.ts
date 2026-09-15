/**
 * Mock di DataService per l'HARNESS DI ANTEPRIMA (screenshot dei dialog documento).
 * NON usato in produzione: serve solo a `main.preview.ts` per aprire i dialog reali
 * con dati di esempio coerenti, senza backend né login.
 *
 * Implementato come Proxy: ogni metodo non esplicitamente sovrascritto ritorna of([])
 * (mai "method missing" → nessun TypeError che impedirebbe il render).
 */
import { of } from 'rxjs';

export const EXAMPLE = {
  clienti: [
    { id: 1, ragioneSociale: 'Rossi Costruzioni S.r.l.', pIva: '01234567890', codiceFiscale: 'RSSMRC80A01F205X', via: 'Via Roma 12', cap: '20100', citta: 'Milano', provincia: 'MI', sdi: 'M5UXCR1', tipoPagamentoId: 1, aliquotaIvaId: 1, fattureInsolute: 0 },
    { id: 2, ragioneSociale: 'Bianchi Impianti S.p.A.', pIva: '09876543210', via: 'Corso Italia 88', cap: '10100', citta: 'Torino', provincia: 'TO', sdi: '0000000', tipoPagamentoId: 2, aliquotaIvaId: 1, fattureInsolute: 2 },
    { id: 3, ragioneSociale: 'Verdi Servizi S.n.c.', pIva: '05551112223', via: 'Piazza Garibaldi 3', cap: '50100', citta: 'Firenze', provincia: 'FI', sdi: 'ABCDEFG', tipoPagamentoId: 1, aliquotaIvaId: 1, fattureInsolute: 0 },
  ],
  fornitori: [
    { id: 1, ragioneSociale: 'Edil Forniture S.p.A.', pIva: '03334445556', via: 'Via dei Cantieri 7', cap: '20100', citta: 'Milano', provincia: 'MI', tipoPagamentoId: 1 },
    { id: 2, ragioneSociale: 'Ferramenta Centrale S.r.l.', pIva: '07778889990', citta: 'Bologna', provincia: 'BO', tipoPagamentoId: 2 },
  ],
  prodotti: [
    { id: 1, codice: 'MAT-001', descrizione: 'Cemento Portland 25kg', prezzo: 8.5, prezzoAcquisto: 6.2, iva: 22, unitaMisura: 'pz', giacenza: 320 },
    { id: 2, codice: 'MAT-002', descrizione: 'Mattone forato 8x25x25', prezzo: 0.65, prezzoAcquisto: 0.4, iva: 22, unitaMisura: 'pz', giacenza: 5400 },
    { id: 3, codice: 'SRV-001', descrizione: 'Manodopera posa in opera', prezzo: 35, prezzoAcquisto: 0, iva: 22, unitaMisura: 'h', giacenza: 0 },
  ],
  unitaMisura: [
    { id: 1, simbolo: 'pz', descrizione: 'Pezzi' },
    { id: 2, simbolo: 'h', descrizione: 'Ore' },
    { id: 3, simbolo: 'kg', descrizione: 'Chilogrammi' },
    { id: 4, simbolo: 'm', descrizione: 'Metri' },
  ],
  aliquoteIva: [
    { id: 1, valore: 22, codice: '', descrizione: 'Aliquota ordinaria', attiva: true },
    { id: 2, valore: 10, codice: '', descrizione: 'Aliquota ridotta', attiva: true },
    { id: 3, valore: 0, codice: 'N4', descrizione: 'Esente art. 10', attiva: true },
  ],
  tipiPagamento: [
    { id: 1, nome: 'Bonifico 30 gg', conto: 'BANCA', immediato: false, giorniScadenza: 30, fineMese: false, attivo: true },
    { id: 2, nome: 'Rimessa diretta', conto: 'CASSA', immediato: true, giorniScadenza: 0, fineMese: false, attivo: true },
  ],
  causali: [
    { id: 1, descrizione: 'Vendita' },
    { id: 2, descrizione: 'Conto visione' },
  ],
  noteRapide: [
    { id: 1, testo: 'Merce resa franco cantiere' },
    { id: 2, testo: 'Garanzia 24 mesi' },
  ],
  ddt: [
    { id: 1, numero: '12', dataEmissione: '2026-05-20', clienteId: 1, clienteNome: 'Rossi Costruzioni S.r.l.', fatturaId: null },
  ],
  fatture: [
    { id: 5, numero: '2026/0030', dataEmissione: '2026-05-12', clienteId: 1, clienteNome: 'Rossi Costruzioni S.r.l.', totale: 1220, imponibile: 1000, stato: 'EMESSA' },
  ],
  indirizzi: [
    { id: 1, nome: 'Cantiere via Verdi', via: 'Via Verdi 5', cap: '20121', citta: 'Milano', provincia: 'MI' },
  ],
  suggeriti: [
    { id: 2, descrizione: 'Mattone forato 8x25x25', codice: 'MAT-002', prezzo: 0.65, iva: 22, unitaMisura: 'pz', occorrenze: 7, quantitaTotale: 12000, ultimaVendita: '2026-04-30' },
  ],
};

const overrides: Record<string, (...a: any[]) => any> = {
  getClienti: () => of(EXAMPLE.clienti),
  getFornitori: () => of(EXAMPLE.fornitori),
  getProdotti: () => of(EXAMPLE.prodotti),
  getUnitaMisura: () => of(EXAMPLE.unitaMisura),
  getAliquoteIva: () => of(EXAMPLE.aliquoteIva),
  getTipiPagamento: () => of(EXAMPLE.tipiPagamento),
  getCausali: () => of(EXAMPLE.causali),
  getNoteRapide: () => of(EXAMPLE.noteRapide),
  getDdt: () => of(EXAMPLE.ddt),
  getDdtNonFatturati: () => of(EXAMPLE.ddt),
  getFatture: () => of(EXAMPLE.fatture),
  getClienteIndirizzi: () => of(EXAMPLE.indirizzi),
  getTopProdottiCliente: () => of(EXAMPLE.suggeriti),
  getPrezziRecenti: () => of([]),
  getPagamenti: () => of([]),
  getModuli: () => of([]),
  getAzienda: () => of({ ragioneSociale: 'La Mia Azienda S.r.l.', regimeFiscale: 'RF01' }),
  getNextNumero: () => of({ numero: 42 }),
  resolvePrezzoCliente: () => of({ prezzo: 0, sconto: 0, iva: 22 }),
};

export function createMockDataService(): any {
  return new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        if (prop in overrides) return overrides[prop];
        return (..._args: any[]) => of([]);
      },
    },
  );
}
