/**
 * Dati finti per la GALLERIA SCHERMATE (harness di anteprima).
 *
 * NON fa parte dell'app di produzione: viene compilato solo dalla configurazione
 * `preview` (vedi angular.json). Serve a rispondere a tutte le chiamate `/api/…`
 * senza backend, così ogni schermata è ispezionabile su qualsiasi macchina.
 *
 * Tre stati, scelti dalla galleria (§3 di docs/UI-UX-QUALITY-WORKFLOW.md):
 *   empty       → tutte le collezioni vuote        (per vedere gli empty state)
 *   full        → ~200 righe con casi limite       (per vedere overflow e lentezze)
 *   error       → dati pieni, ma OGNI scrittura fallisce  (per vedere se l'app lo dice)
 *   error-load  → ogni lettura fallisce            (per vedere la gestione del fetch fallito)
 *
 * I dati sono DETERMINISTICI (PRNG con seed fisso): gli screenshot prima/dopo sono
 * confrontabili perché due esecuzioni producono esattamente le stesse righe.
 */

export type PreviewState = 'empty' | 'full' | 'error' | 'error-load';

/** Quante righe genera lo stato `full`: abbastanza da rendere evidenti i problemi di scroll. */
const N = 200;

// ── PRNG deterministico (mulberry32) ─────────────────────────────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Vocabolario realistico (italiano, settore edile/commerciale) ─────────────
const FORME = ['S.r.l.', 'S.p.A.', 'S.n.c.', 'S.a.s.', '& C.', ''];
const COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Ferrari', 'Esposito', 'Russo', 'Romano', 'Colombo',
  'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini'];
const SETTORI = ['Costruzioni', 'Impianti', 'Servizi', 'Logistica', 'Forniture', 'Edilizia',
  'Termoidraulica', 'Automazioni', 'Arredamenti', 'Manutenzioni'];
const CITTA: [string, string, string][] = [
  ['Milano', 'MI', '20100'], ['Torino', 'TO', '10100'], ['Roma', 'RM', '00100'],
  ['Napoli', 'NA', '80100'], ['Firenze', 'FI', '50100'], ['Bologna', 'BO', '40100'],
  ['Venezia', 'VE', '30100'], ['Bari', 'BA', '70100'], ['Palermo', 'PA', '90100'],
  ['Genova', 'GE', '16100'], ['Verona', 'VR', '37100'], ['Padova', 'PD', '35100'],
];
const MATERIALI = ['Cemento Portland 25kg', 'Mattone forato 8x25x25', 'Rete elettrosaldata 2x3',
  'Trave lamellare abete', 'Pannello isolante EPS 6cm', 'Guaina bituminosa 4mm',
  'Tubo multistrato Ø20', 'Cavo unipolare 2,5mmq', 'Piastrella gres 60x60',
  'Malta cementizia premiscelata', 'Profilo alluminio 40x40', 'Vite autofilettante 4,5x60'];
const SERVIZI = ['Manodopera posa in opera', 'Trasporto e scarico', 'Noleggio ponteggio',
  'Progettazione esecutiva', 'Direzione lavori', 'Smaltimento macerie'];
const CATEGORIE = ['Materiali', 'Servizi', 'Utensili', 'Elettrico', 'Idraulico', 'Ferramenta'];
const UM = ['pz', 'kg', 'm', 'mq', 'h', 'lt'];

/**
 * Casi limite iniettati nelle prime righe di ogni collezione: è lì che si rompono
 * i layout. Sono deliberati — non toglierli "per pulizia".
 */
const NOME_LUNGHISSIMO =
  'Consorzio Nazionale Cooperative Costruzioni e Grandi Opere Infrastrutturali del Mezzogiorno Società Consortile per Azioni';
const IMPORTO_ENORME = 1234567.89;

function iso(daysAgo: number): string {
  const d = new Date(2026, 8, 4);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ── Generatori per collezione ────────────────────────────────────────────────

function genClienti(): any[] {
  const r = makeRng(101);
  return Array.from({ length: N }, (_, i) => {
    const [citta, prov, cap] = pick(r, CITTA);
    const nome = i === 0
      ? NOME_LUNGHISSIMO
      : `${pick(r, COGNOMI)} ${pick(r, SETTORI)} ${pick(r, FORME)}`.trim();
    return {
      id: i + 1,
      ragioneSociale: nome,
      // riga 2: anagrafica minima (solo i campi obbligatori) — verifica i fallback "—"
      ...(i === 1 ? {} : {
        email: `info@${pick(r, COGNOMI).toLowerCase()}.it`,
        telefono: `0${2 + Math.floor(r() * 8)} ${1000000 + Math.floor(r() * 8999999)}`,
        via: `Via ${pick(r, COGNOMI)} ${1 + Math.floor(r() * 180)}`,
        cap, citta, provincia: prov,
        codiceFiscale: `RSS${pick(r, COGNOMI).slice(0, 3).toUpperCase()}80A01F205X`,
        pec: `pec@${pick(r, COGNOMI).toLowerCase()}.legalmail.it`,
        sdi: r() > 0.4 ? 'M5UXCR1' : '0000000',
      }),
      pIva: String(10000000000 + Math.floor(r() * 89999999999)).slice(0, 11),
      stato: 'IT',
      tipoPagamentoId: 1 + Math.floor(r() * 2),
      aliquotaIvaId: 1,
      listinoId: r() > 0.7 ? 1 : null,
      ultimoAcquisto: r() > 0.2 ? iso(Math.floor(r() * 400)) : null,
      fatturatoAnno: i === 2 ? IMPORTO_ENORME : round2(r() * 90000),
      fattureInsolute: r() > 0.75 ? 1 + Math.floor(r() * 4) : 0,
      ancheFornitore: r() > 0.9,
      agenteId: r() > 0.6 ? 1 : null,
      provvigione: null,
    };
  });
}

function genFornitori(): any[] {
  const r = makeRng(202);
  return Array.from({ length: N }, (_, i) => {
    const [citta, prov, cap] = pick(r, CITTA);
    return {
      id: i + 1,
      ragioneSociale: i === 0 ? NOME_LUNGHISSIMO : `${pick(r, SETTORI)} ${pick(r, COGNOMI)} ${pick(r, FORME)}`.trim(),
      email: `ordini@${pick(r, COGNOMI).toLowerCase()}.it`,
      telefono: `0${2 + Math.floor(r() * 8)} ${1000000 + Math.floor(r() * 8999999)}`,
      via: `Via ${pick(r, SETTORI)} ${1 + Math.floor(r() * 90)}`,
      cap, citta, provincia: prov,
      pIva: String(10000000000 + Math.floor(r() * 89999999999)).slice(0, 11),
      stato: 'IT',
      tipoPagamentoId: 1 + Math.floor(r() * 2),
    };
  });
}

function genProdotti(): any[] {
  const r = makeRng(303);
  return Array.from({ length: N }, (_, i) => {
    const servizio = r() > 0.78;
    const nome = i === 0
      ? 'Pannello sandwich coibentato in lamiera preverniciata con anima in poliuretano espanso — spessore 100 mm, lunghezza su misura'
      : servizio ? pick(r, SERVIZI) : pick(r, MATERIALI);
    // Il prezzo fuori scala sta oltre la finestra da cui `righe()` pesca i prodotti:
    // serve a stressare la colonna prezzo della lista, non a gonfiare ogni documento.
    const prezzo = i === 150 ? IMPORTO_ENORME : round2(0.4 + r() * 240);
    const giacenza = servizio ? 0 : Math.floor(r() * 4000);
    const soglia = servizio ? null : Math.floor(r() * 120);
    return {
      id: i + 1,
      nome,
      categoria: servizio ? 'Servizi' : pick(r, CATEGORIE),
      descrizione: r() > 0.6 ? 'Conforme alle norme UNI EN vigenti. Fornitura su bancale.' : '',
      codice: `${servizio ? 'SRV' : 'MAT'}-${String(i + 1).padStart(4, '0')}`,
      prezzo,
      prezzoAcquisto: round2(prezzo * 0.68),
      quantita: giacenza,
      sogliaMinima: soglia,
      // riga 3: sotto soglia, per far comparire l'avviso di scorta
      ...(i === 2 ? { quantita: 2, sogliaMinima: 50 } : {}),
      unitaMisura: servizio ? 'h' : pick(r, UM),
      iva: pick(r, [22, 22, 22, 10, 4]),
      barcode: servizio ? '' : String(8000000000000 + i),
      haVarianti: r() > 0.88,
      haImmagine: r() > 0.7,
      peso: servizio ? null : round2(r() * 25),
    };
  });
}

function righe(r: () => number, prodotti: any[]): any[] {
  const n = 1 + Math.floor(r() * 5);
  const out: any[] = Array.from({ length: n }, () => {
    const p = pick(r, prodotti.slice(0, 40));
    const q = 1 + Math.floor(r() * 40);
    return {
      prodottoId: p.id, codiceProdotto: p.codice, prodottoNome: p.nome, descrizione: p.nome,
      quantita: q, unitaMisura: p.unitaMisura, prezzo: p.prezzo,
      sconto: r() > 0.75 ? 5 * (1 + Math.floor(r() * 3)) : 0,
      iva: p.iva, tipo: 'PRODOTTO', scaricaMagazzino: true,
    };
  });
  if (r() > 0.7) out.push({ descrizione: 'Consegna prevista entro 10 giorni lavorativi dalla conferma.', tipo: 'NOTA', quantita: 0, prezzo: 0, sconto: 0, iva: 0 });
  return out;
}

function totali(rs: any[]): { imponibile: number; totale: number } {
  const imponibile = round2(rs.reduce((s, g) => s + g.quantita * g.prezzo * (1 - (g.sconto || 0) / 100), 0));
  const iva = round2(rs.reduce((s, g) => s + g.quantita * g.prezzo * (1 - (g.sconto || 0) / 100) * (g.iva || 0) / 100, 0));
  return { imponibile, totale: round2(imponibile + iva) };
}

/** Fabbrica generica per i documenti (fatture, ddt, ordini, preventivi, note di credito, acquisti). */
function genDocumenti(seed: number, opts: {
  prefissoNumero: string; stati: string[]; controparte: 'cliente' | 'fornitore'; campoData: string; extra?: (r: () => number, i: number) => any;
}): any[] {
  const r = makeRng(seed);
  const prodotti = genProdotti();
  const clienti = opts.controparte === 'cliente' ? genClienti() : genFornitori();
  return Array.from({ length: N }, (_, i) => {
    const rs = righe(r, prodotti);
    const t = totali(rs);
    const c = clienti[Math.floor(r() * 40)];
    const idKey = opts.controparte === 'cliente' ? 'clienteId' : 'fornitoreId';
    const nomeKey = opts.controparte === 'cliente' ? 'clienteNome' : 'fornitoreNome';
    return {
      id: i + 1,
      numero: `${opts.prefissoNumero}${String(N - i).padStart(4, '0')}`,
      [opts.campoData]: iso(Math.floor(i * 1.7)),
      [idKey]: c.id,
      [nomeKey]: c.ragioneSociale,
      controparteNome: c.ragioneSociale,
      stato: pick(r, opts.stati),
      note: r() > 0.8 ? 'Merce resa franco cantiere. Garanzia 24 mesi.' : '',
      imponibile: i === 1 ? IMPORTO_ENORME : t.imponibile,
      totale: i === 1 ? round2(IMPORTO_ENORME * 1.22) : t.totale,
      tipoPagamentoId: 1 + Math.floor(r() * 2),
      righe: rs,
      ...(opts.extra ? opts.extra(r, i) : {}),
    };
  });
}

// ── Cache: ogni collezione viene generata una sola volta per sessione ────────
const cache = new Map<string, any[]>();
function coll(name: string, gen: () => any[]): any[] {
  if (!cache.has(name)) cache.set(name, gen());
  return cache.get(name)!;
}

const COLLEZIONI: Record<string, () => any[]> = {
  clienti: () => coll('clienti', genClienti),
  fornitori: () => coll('fornitori', genFornitori),
  prodotti: () => coll('prodotti', genProdotti),
  fatture: () => coll('fatture', () => genDocumenti(401, {
    prefissoNumero: '2026/', stati: ['EMESSA', 'EMESSA', 'PAGATA', 'BOZZA', 'ANNULLATA'],
    controparte: 'cliente', campoData: 'dataEmissione',
    extra: (r) => ({ statoSdi: r() > 0.6 ? 'INVIATA' : undefined, ddtIds: [] }),
  })),
  ddt: () => coll('ddt', () => genDocumenti(402, {
    prefissoNumero: 'DDT/', stati: ['EMESSO', 'CONSEGNATO'], controparte: 'cliente', campoData: 'dataEmissione',
    extra: (r, i) => ({
      tipo: 'CLIENTE', fatturaId: r() > 0.5 ? i + 1 : null, fatturaNumero: r() > 0.5 ? `2026/${i}` : null,
      causaleTrasporto: 'Vendita', aspettoBeni: 'Bancali', porto: 'Franco', numeroColli: 1 + Math.floor(r() * 12),
      pesoLordo: round2(r() * 900), vettore: r() > 0.6 ? 'Trasporti Veloci S.r.l.' : '',
    }),
  })),
  // `ordini` è una collezione sola: la schermata "Ordini fornitore" filtra per
  // `tipo === 'FORNITORE'` sullo stesso endpoint, quindi le fixture devono contenerli
  // entrambi — altrimenti quella schermata sembrerebbe vuota per colpa dei dati finti.
  ordini: () => coll('ordini', () => [
    ...genDocumenti(403, {
      prefissoNumero: 'ORD/', stati: ['APERTO', 'EVASO', 'ANNULLATO'], controparte: 'cliente', campoData: 'dataOrdine',
      extra: () => ({ tipo: 'CLIENTE' }),
    }),
    ...genDocumenti(404, {
      prefissoNumero: 'OF/', stati: ['APERTO', 'EVASO'], controparte: 'fornitore', campoData: 'dataOrdine',
      extra: () => ({ tipo: 'FORNITORE' }),
    }).map((o) => ({ ...o, id: o.id + 1000 })),
  ]),
  preventivi: () => coll('preventivi', () => genDocumenti(405, {
    prefissoNumero: 'PRV/', stati: ['EMESSO', 'ACCETTATO', 'RIFIUTATO', 'SCADUTO'],
    controparte: 'cliente', campoData: 'dataEmissione', extra: () => ({ validita: 30, stampaImmagini: true }),
  })),
  'note-credito': () => coll('note-credito', () => genDocumenti(406, {
    prefissoNumero: 'NC/', stati: ['EMESSA', 'STORNATA'], controparte: 'cliente', campoData: 'dataEmissione',
    extra: (r, i) => ({ fatturaId: i + 1, fatturaNumero: `2026/${String(N - i).padStart(4, '0')}` }),
  })),
  acquisti: () => coll('acquisti', () => genDocumenti(407, {
    prefissoNumero: 'ACQ/', stati: ['RICEVUTA', 'PAGATA', 'EMESSA'], controparte: 'fornitore', campoData: 'dataEmissione',
  })),
  'fatture-ricorrenti': () => coll('ricorrenti', () => {
    const r = makeRng(408); const cl = genClienti();
    return Array.from({ length: 24 }, (_, i) => ({
      id: i + 1, descrizione: `Canone assistenza ${pick(r, SETTORI).toLowerCase()}`,
      clienteId: cl[i].id, clienteNome: cl[i].ragioneSociale,
      frequenza: pick(r, ['MENSILE', 'TRIMESTRALE', 'ANNUALE']),
      giornoEmissione: 1 + Math.floor(r() * 27), prossimaEmissione: iso(-Math.floor(r() * 60)),
      attiva: r() > 0.25, totale: round2(80 + r() * 900), righe: righe(r, genProdotti()),
    }));
  }),
  'arrivi-merce': () => coll('arrivi', () => {
    const r = makeRng(409); const f = genFornitori();
    return Array.from({ length: 60 }, (_, i) => ({
      id: i + 1, numero: `AM/${String(60 - i).padStart(4, '0')}`, data: iso(i * 2),
      fornitoreId: f[i].id, fornitoreNome: f[i].ragioneSociale,
      stato: pick(r, ['APERTO', 'CONFERMATO']), righe: righe(r, genProdotti()),
    }));
  }),
  'vendite-banco': () => coll('vendite-banco', () => {
    const r = makeRng(410);
    return Array.from({ length: 80 }, (_, i) => {
      const rs = righe(r, genProdotti()); const t = totali(rs);
      return { id: i + 1, numero: String(80 - i), data: iso(Math.floor(i / 3)), ...t, metodo: pick(r, ['CONTANTI', 'CARTA', 'BANCOMAT']), righe: rs };
    });
  }),
  pagamenti: () => coll('pagamenti', () => {
    const r = makeRng(411); const cl = genClienti();
    return Array.from({ length: N }, (_, i) => ({
      id: i + 1, fatturaId: i + 1, fatturaNumero: `2026/${String(N - i).padStart(4, '0')}`,
      clienteNome: cl[Math.floor(r() * 40)].ragioneSociale,
      dataPagamento: iso(Math.floor(i * 1.3)), importo: round2(80 + r() * 4000),
      metodo: pick(r, ['BONIFICO', 'CONTANTI', 'CARTA', 'RIBA']), tipo: 'ENTRATA',
      conto: pick(r, ['BANCA', 'CASSA']), tipoPagamentoNome: 'Bonifico 30 gg',
    }));
  }),
  'movimenti-magazzino': () => coll('movimenti', () => {
    const r = makeRng(412); const p = genProdotti();
    return Array.from({ length: N }, (_, i) => {
      const pr = p[Math.floor(r() * 60)];
      return {
        id: i + 1, data: iso(Math.floor(i / 2)), prodottoId: pr.id, prodottoNome: pr.nome,
        codiceProdotto: pr.codice, tipo: pick(r, ['CARICO', 'SCARICO', 'RETTIFICA']),
        quantita: 1 + Math.floor(r() * 120), causale: pick(r, ['Vendita', 'Acquisto', 'Inventario', 'Reso']),
        giacenzaDopo: Math.floor(r() * 3000),
      };
    });
  }),
  listini: () => coll('listini', () => {
    const r = makeRng(413);
    return Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, nome: `Listino ${pick(r, ['Rivenditori', 'Privati', 'Cantieri', 'Estero', 'Promo'])} ${2020 + i}`,
      attivo: r() > 0.2, scontoDefault: Math.floor(r() * 20), dataInizio: iso(300 - i * 20), dataFine: null,
    }));
  }),
  agenti: () => coll('agenti', () => {
    const r = makeRng(414);
    return Array.from({ length: 8 }, (_, i) => ({
      id: i + 1, nome: `${pick(r, COGNOMI)} ${pick(r, ['Marco', 'Luca', 'Anna', 'Giulia', 'Paolo'])}`,
      email: `agente${i + 1}@ordeva.it`, telefono: `33${i} 1234567`,
      provvigioneDefault: 3 + Math.floor(r() * 8), attivo: r() > 0.15,
    }));
  }),
  utenti: () => coll('utenti', () => ([
    { id: 1, nome: 'Utente locale', email: 'locale@ordeva.app', ruolo: 'ADMIN', attivo: true },
  ])),
  magazzini: () => coll('magazzini', () => ([
    { id: 1, nome: 'Magazzino centrale', codice: 'MC', principale: true },
    { id: 2, nome: 'Deposito cantiere', codice: 'DC', principale: false },
  ])),
  'categorie-prodotto': () => CATEGORIE.map((c, i) => ({ id: i + 1, nome: c })),
  'unita-misura': () => UM.map((u, i) => ({ id: i + 1, simbolo: u, descrizione: u })),
  'aliquote-iva': () => ([
    { id: 1, valore: 22, codice: '', descrizione: 'Aliquota ordinaria', attiva: true },
    { id: 2, valore: 10, codice: '', descrizione: 'Aliquota ridotta', attiva: true },
    { id: 3, valore: 4, codice: '', descrizione: 'Aliquota minima', attiva: true },
    { id: 4, valore: 0, codice: 'N4', descrizione: 'Esente art. 10', attiva: true },
  ]),
  'tipi-pagamento': () => ([
    { id: 1, nome: 'Bonifico 30 gg', conto: 'BANCA', immediato: false, giorniScadenza: 30, fineMese: false, attivo: true },
    { id: 2, nome: 'Rimessa diretta', conto: 'CASSA', immediato: true, giorniScadenza: 0, fineMese: false, attivo: true },
    { id: 3, nome: 'RiBa 60 gg f.m.', conto: 'BANCA', immediato: false, giorniScadenza: 60, fineMese: true, attivo: true },
  ]),
  causali: () => ([{ id: 1, descrizione: 'Vendita' }, { id: 2, descrizione: 'Conto visione' }, { id: 3, descrizione: 'Reso' }]),
  'note-rapide': () => ([{ id: 1, testo: 'Merce resa franco cantiere' }, { id: 2, testo: 'Garanzia 24 mesi' }]),
  lavagna: () => coll('lavagna', () => ([
    { id: 1, testo: 'Richiamare Rossi per il preventivo del capannone', colore: 'giallo', x: 40, y: 40 },
    { id: 2, testo: 'Ordinare cemento: scorta sotto soglia', colore: 'rosa', x: 260, y: 90 },
  ])),
  'audit/recent': () => {
    const tipi: { entityType: string; azioni: { action: string; payload: any }[] }[] = [
      { entityType: 'fattura', azioni: [
        { action: 'CREATE', payload: { numero: '2026/0198', stato: 'BOZZA' } },
        { action: 'UPDATE', payload: { numero: '2026/0198', before: { stato: 'BOZZA' }, after: { stato: 'EMESSA' } } },
      ] },
      { entityType: 'cliente', azioni: [
        { action: 'CREATE', payload: { numero: 'Bianchi Impianti S.r.l.' } },
        { action: 'UPDATE', payload: { before: { telefono: '02 1234567' }, after: { telefono: '02 6782542' } } },
      ] },
      { entityType: 'prodotto', azioni: [
        { action: 'UPDATE', payload: { before: { prezzo: 12.5 }, after: { prezzo: 13.9 } } },
        { action: 'DELETE', payload: { numero: 'MAT-0099' } },
      ] },
      { entityType: 'ordine', azioni: [{ action: 'CREATE', payload: { numero: 'RO-42', stato: 'INVIATO' } }] },
    ];
    const rows: any[] = [];
    let id = 1;
    for (let i = 0; i < 40; i++) {
      const g = tipi[i % tipi.length];
      const az = g.azioni[i % g.azioni.length];
      const d = new Date(2026, 8, 4 - Math.floor(i / 2), 9 + (i % 8), (i * 7) % 60);
      rows.push({
        id: id++, entityType: g.entityType, entityId: 100 + i, action: az.action,
        payload: az.payload, createdAt: d.toISOString().slice(0, 19).replace('T', ' '),
      });
    }
    return rows;
  },
};

// ── Statistiche e aggregati ──────────────────────────────────────────────────
function mesiAnno(seed: number, base: number): any[] {
  const r = makeRng(seed);
  return Array.from({ length: 12 }, (_, i) => ({
    mese: `2026-${String(i + 1).padStart(2, '0')}`,
    anno: 2026, numeroMese: i + 1,
    totale: round2(base * (0.6 + r() * 0.9)),
    imponibile: round2(base * 0.82 * (0.6 + r() * 0.9)),
    count: 5 + Math.floor(r() * 40),
  }));
}

const AGGREGATI: Record<string, () => any> = {
  'stats/vendite-mensili': () => mesiAnno(501, 42000),
  'stats/acquisti-mensili': () => mesiAnno(502, 26000),
  'stats/cashflow': () => ({ daIncassare: 42800.6, daPagare: 18900.3 }),
  'stats/cashflow-3060-90': () => ({
    saldoOggi: 32400.8,
    bucket30: { in: 18400.5, out: 9200.25, saldo: 41601.05 },
    bucket60: { in: 12800.4, out: 15300.6, saldo: 39100.85 },
    bucket90: { in: 9600.2, out: 11200.35, saldo: 37500.7 },
  }),
  'scadenze-fiscali': () => ({
    anno: 2026,
    config: { ivaPeriodicita: 'trimestrale', sostitutoImposta: false },
    scadenze: [
      { id: 1, descrizione: 'Liquidazione IVA mensile', data: iso(-12), importo: 3420.5, pagata: false, tipo: 'IVA' },
      { id: 2, descrizione: 'Ritenute d\'acconto F24', data: iso(-26), importo: 890.2, pagata: false, tipo: 'F24' },
      { id: 3, descrizione: 'Acconto IRES', data: iso(18), importo: 5600, pagata: true, tipo: 'IMPOSTE' },
    ],
  }),
  'stats/iva-trimestre': () => ({
    ivaDebito: 24900.8, ivaCredito: 15200.1, debito: true, saldo: 9700.7,
    venditePerAliquota: [
      { aliquota: 22, imponibile: 98400.5, iva: 21648.11 },
      { aliquota: 10, imponibile: 12520.9, iva: 1252.09 },
      { aliquota: 4, imponibile: 3000, iva: 120 },
    ],
    acquistiPerAliquota: [
      { aliquota: 22, imponibile: 61200.4, iva: 13464.09 },
      { aliquota: 10, imponibile: 17360.1, iva: 1736.01 },
    ],
    periodo: { from: iso(-90), to: iso(0) },
  }),
  'agenda/imminenti': () => ({
    da: iso(0), a: iso(7),
    eventi: [
      { id: 1, titolo: 'Sopralluogo cantiere via Verdi', inizio: iso(-1) + 'T09:30', tuttoGiorno: false, source: 'APPUNTAMENTO' },
      { id: 2, titolo: 'Scadenza fattura 2026/0180', inizio: iso(-3), tuttoGiorno: true, source: 'SCADENZA_FATTURA' },
    ],
  }),
  'stats/cashflow-forecast': () => {
    const r = makeRng(504);
    let cumulativo = 0;
    const items = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(2026, 0, 1 + i);
      const inn = round2(r() < 0.35 ? 800 + r() * 4000 : 0);
      const out = round2(r() < 0.3 ? 400 + r() * 2500 : 0);
      cumulativo = round2(cumulativo + inn - out);
      return { date: d.toISOString().slice(0, 10), in: inn, out, cumulativo };
    });
    const totEntrate = round2(items.reduce((s, i) => s + i.in, 0));
    const totUscite = round2(items.reduce((s, i) => s + i.out, 0));
    return { items, saldoFinale: cumulativo, totEntrate, totUscite };
  },
  'stats/kpi-anno': () => ({
    fatturato: 486320.44, fatturatoPrec: 421900.1, acquisti: 298110.9, costi: 298110.9,
    margine: 188209.54, insoluti: 24310.8, clientiAttivi: 87, documenti: 642,
  }),
  'stats/top-prodotti': () => genProdotti().slice(0, 10).map((p, i) => ({
    prodottoId: p.id, nome: p.nome, codice: p.codice, quantita: 400 - i * 31, totale: round2(9000 - i * 640),
  })),
  'stats/top-clienti': () => genClienti().slice(0, 10).map((c, i) => ({
    clienteId: c.id, ragioneSociale: c.ragioneSociale, totale: round2(48000 - i * 3700), documenti: 40 - i * 3,
  })),
  'prodotti/count': () => N,
  'clienti/count': () => N,
  'ordini/count-aperti': () => 14,
  'prodotti/valore': () => 184320.55,
  'prodotti/sotto-soglia': () => genProdotti().filter((p) => p.sogliaMinima && p.quantita < p.sogliaMinima).slice(0, 12),
  'ddt/non-fatturati': () => COLLEZIONI['ddt']().filter((d: any) => !d.fatturaId).slice(0, 25),
  'prezzi-recenti': () => [],
  'riordino/proposte': () => genProdotti().slice(0, 8).map((p) => ({
    prodottoId: p.id, nome: p.nome, codice: p.codice, giacenza: p.quantita,
    sogliaMinima: p.sogliaMinima, daOrdinare: 100, fornitoreNome: 'Edil Forniture S.p.A.',
  })),
  'pagamenti/scadenzario': () => scadenzario(),
  scadenzario: () => scadenzarioFull(),
  'agenda/appuntamenti': () => ([
    { id: 1, titolo: 'Sopralluogo cantiere via Verdi', inizio: iso(1) + 'T09:30', fine: iso(1) + 'T11:00', tuttoGiorno: false, stato: 'PIANIFICATO' },
    { id: 2, titolo: 'Consegna materiale Bianchi', inizio: iso(-4) + 'T14:00', fine: iso(-4) + 'T15:00', tuttoGiorno: false, stato: 'PIANIFICATO' },
    { id: 3, titolo: 'Riunione fornitori', inizio: iso(-6) + 'T11:00', fine: iso(-6) + 'T12:00', tuttoGiorno: false, stato: 'PIANIFICATO' },
    { id: 4, titolo: 'Preventivo Rossi Costruzioni', inizio: iso(-18) + 'T16:00', fine: iso(-18) + 'T17:00', tuttoGiorno: false, stato: 'PIANIFICATO' },
    { id: 5, titolo: 'Collaudo impianto ACME', inizio: iso(-11) + 'T15:30', fine: iso(-11) + 'T17:00', tuttoGiorno: false, stato: 'COMPLETATO' },
  ]),
  // Eventi del calendario mensile: unione di appuntamenti, scadenze incasso/pagamento
  // e ricorrenze. Colori allineati alla legenda della vista Calendario.
  'agenda/calendario': () => ([
    { id: 'app-1', source: 'APPUNTAMENTO', sourceId: 1, titolo: 'Sopralluogo cantiere via Verdi', inizio: iso(1) + 'T09:30', fine: iso(1) + 'T11:00', colore: '#3b82f6', stato: 'PIANIFICATO' },
    { id: 'app-2', source: 'APPUNTAMENTO', sourceId: 2, titolo: 'Consegna materiale Bianchi', inizio: iso(-4) + 'T14:00', colore: '#3b82f6', stato: 'PIANIFICATO' },
    { id: 'app-3', source: 'APPUNTAMENTO', sourceId: 3, titolo: 'Riunione fornitori', inizio: iso(-6) + 'T11:00', colore: '#3b82f6', stato: 'PIANIFICATO' },
    { id: 'app-4', source: 'APPUNTAMENTO', sourceId: 4, titolo: 'Preventivo Rossi Costruzioni', inizio: iso(-18) + 'T16:00', colore: '#3b82f6', stato: 'PIANIFICATO' },
    { id: 'fat-188', source: 'SCADENZA_FATTURA', sourceId: 188, titolo: 'Incasso fattura 2026/0188', inizio: iso(-1), tuttoGiorno: true, colore: '#16a34a', route: '/fatture' },
    { id: 'fat-192', source: 'SCADENZA_FATTURA', sourceId: 192, titolo: 'Incasso fattura 2026/0192', inizio: iso(-11), tuttoGiorno: true, colore: '#16a34a', route: '/fatture' },
    { id: 'acq-71', source: 'SCADENZA_ACQUISTO', sourceId: 71, titolo: 'Pagamento F24', inizio: iso(2), tuttoGiorno: true, colore: '#dc2626', route: '/scadenzario' },
    { id: 'acq-84', source: 'SCADENZA_ACQUISTO', sourceId: 84, titolo: 'Pagamento Edil Forniture S.p.A.', inizio: iso(-14), tuttoGiorno: true, colore: '#dc2626', route: '/scadenzario' },
    { id: 'ric-3', source: 'RICORRENTE', sourceId: 3, titolo: 'Canone noleggio muletto', inizio: iso(-8), tuttoGiorno: true, colore: '#f59e0b', route: '/fatture-ricorrenti' },
    { id: 'ric-7', source: 'RICORRENTE', sourceId: 7, titolo: 'Rata leasing furgone', inizio: iso(-21), tuttoGiorno: true, colore: '#f59e0b', route: '/fatture-ricorrenti' },
  ]),
  'agenda/todo': () => ([
    { id: 1, testo: 'Inviare preventivo a Rossi Costruzioni', stato: 'DA_FARE', scadenza: iso(-2) },
    { id: 2, testo: 'Verificare giacenza cemento', stato: 'FATTA', scadenza: null },
  ]),
  'marketplace/configs': () => ({
    canali: [
      { canale: 'EBAY', connesso: true, accountLabel: 'negozio-demo', attivo: true, ultimaSync: iso(-1) + 'T08:15:00' },
      { canale: 'SHOPIFY', connesso: false, accountLabel: null, attivo: false, ultimaSync: null },
      { canale: 'AMAZON', connesso: true, accountLabel: 'A1B2C3DEMO', attivo: true, ultimaSync: iso(0) + 'T07:40:00' },
    ],
    amazonDisponibile: true,
  }),
  'marketplace/statistiche': () => {
    const r = makeRng(430); const canali = ['EBAY', 'AMAZON', 'SHOPIFY'];
    return Array.from({ length: 24 }, (_, i) => ({
      data: iso(Math.floor(i / 3) * 2), canale: canali[i % 3],
      numeroVendite: 1 + Math.floor(r() * 9), totale: round2(120 + r() * 1800),
    }));
  },
  'magazzini/giacenze': () => genProdotti().slice(0, 60).map((p) => ({
    prodottoId: p.id, nome: p.nome, codice: p.codice, magazzinoId: 1, magazzinoNome: 'Magazzino centrale',
    quantita: p.quantita, sogliaMinima: p.sogliaMinima, unitaMisura: p.unitaMisura, valore: round2((p.prezzoAcquisto || 0) * (p.quantita || 0)),
  })),
  'magazzini/scadenze': () => genProdotti().slice(0, 10).map((p, i) => ({
    prodottoId: p.id, nome: p.nome, codice: p.codice, lotto: `L-2026-${100 + i}`,
    scadenza: iso(-15 + i * 9), quantita: 10 + i * 3, magazzinoNome: 'Magazzino centrale',
  })),
  'stats/margini': () => {
    const conMargine = (base: any, ricavo: number, costo: number) => {
      ricavo = round2(ricavo); costo = round2(costo);
      const margine = round2(ricavo - costo);
      return { ...base, ricavo, costo, margine, marginePct: ricavo > 0 ? round2((margine / ricavo) * 100) : null };
    };
    const prodotti = genProdotti().slice(0, 15).map((p) => conMargine(
      { id: p.id, nome: p.nome, categoria: p.categoria || '—', quantita: 40 },
      (p.prezzo || 0) * 40, (p.prezzoAcquisto || 0) * 40,
    ));
    const clienti = genClienti().slice(0, 10).map((c, i) => conMargine(
      { id: c.id, nome: c.ragioneSociale }, 48000 - i * 3700, (48000 - i * 3700) * 0.63,
    ));
    const totRicavo = prodotti.reduce((s, p) => s + p.ricavo, 0);
    const totCosto = prodotti.reduce((s, p) => s + p.costo, 0);
    return { anno: 2026, prodotti, clienti, totali: conMargine({}, totRicavo, totCosto) };
  },
  'stats/bi': () => {
    const anno = 2026, annoPrec = 2025;
    const rFat = makeRng(507), rAcq = makeRng(508);
    const fatturaMensile: any[] = [];
    const acquistiMensili: any[] = [];
    for (const y of [annoPrec, anno]) {
      for (let m = 1; m <= 12; m++) {
        const mese = `${y}-${String(m).padStart(2, '0')}`;
        const fatturato = round2(30000 + rFat() * 25000);
        fatturaMensile.push({ mese, fatturato, imponibile: round2(fatturato / 1.22) });
        acquistiMensili.push({ mese, costi: round2(18000 + rAcq() * 15000) });
      }
    }
    const totFatturato = fatturaMensile.filter(r => r.mese.startsWith(String(anno))).reduce((s, r) => s + r.fatturato, 0);
    let cum = 0;
    const abcClienti = genClienti().slice(0, 8).map((c, i) => {
      const fatturato = round2(totFatturato * 0.28 * Math.pow(0.62, i));
      cum += fatturato;
      const pctCumulativa = round2(Math.min(100, (cum / totFatturato) * 100));
      return {
        nome: c.ragioneSociale, fatturato, numFatture: 12 - i,
        pct: round2((fatturato / totFatturato) * 100), pctCumulativa,
        classe: pctCumulativa <= 80 ? 'A' : pctCumulativa <= 95 ? 'B' : 'C',
      };
    });
    const categorie = ['Ferramenta', 'Elettrico', 'Idraulico', 'Edilizia'].map((categoria, i) => ({
      categoria, imponibile: round2(80000 - i * 15000), quantita: 900 - i * 180,
    }));
    const prodottiMargini = genProdotti().slice(0, 10).map((p, i) => {
      const ricavi = round2(9000 - i * 640);
      const costiStimati = round2(ricavi * 0.6);
      return {
        nome: p.nome, ricavi, costiStimati, margine: round2(ricavi - costiStimati),
        marginePerc: round2((1 - costiStimati / ricavi) * 100), qtaVenduta: 400 - i * 31,
      };
    });
    const stagionalita = Array.from({ length: 12 }, (_, i) => ({
      mese_num: String(i + 1).padStart(2, '0'), media: round2(35000 + Math.sin(i / 1.8) * 12000),
    }));
    return {
      anno: String(anno), annoPrec: String(annoPrec),
      fatturaMensile, acquistiMensili, abcClienti, categorie,
      dsoMedio: 34.5,
      incassoStats: { emesso: round2(totFatturato), incassato: round2(totFatturato * 0.87), tassoIncasso: 87 },
      prodottiMargini, stagionalita,
    };
  },
  // Validazione XML prima dell'invio SDI. Di default passa con un avviso: il caso
  // "non inviabile" si prova mettendo `ok: false` qui, oppure dallo stato "Letture KO".
  'fattura-xml': () => ({ ok: true, errors: [], warnings: ['Il codice destinatario del cliente è generico (0000000): la fattura sarà recapitata via PEC.'] }),
  'agenda/promemoria': () => ([{ id: 1, testo: 'Rinnovo polizza assicurativa', data: iso(-9) }]),
  'notifications/badges': () => ({ scadenze: 3, insoluti: 25, riordini: 4, sdi: 0 }),
  me: () => ({ id: 1, nome: 'Utente locale', email: 'locale@ordeva.app', ruolo: 'ADMIN' }),
  'agenti/provvigioni': () => COLLEZIONI['agenti']().map((a: any) => ({
    agenteId: a.id, agenteNome: a.nome, fatturato: round2(20000 + a.id * 7300),
    provvigione: round2((20000 + a.id * 7300) * a.provvigioneDefault / 100), documenti: 12 + a.id,
  })),
  azienda: () => ({
    id: 1, ragioneSociale: 'La Mia Azienda S.r.l.', indirizzo: 'Via dell\'Industria 42',
    cap: '20090', citta: 'Assago', provincia: 'MI', stato: 'IT',
    pIva: '02233445566', codFiscale: '02233445566', email: 'info@lamiaazienda.it',
    telefono: '02 1234567', pec: 'lamiaazienda@legalmail.it', sdi: 'M5UXCR1',
    banca: 'Banca Popolare', iban: 'IT60X0542811101000000123456',
    regimeFiscale: 'RF01', emailMode: 'MAILTO', riordinoAutomatico: false,
  }),
  'setup/status': () => ({ aziendaConfigurata: true, hasDati: true }),
  'setup/password/status': () => ({ enabled: false }),
  'sistema/lock': () => ({ locked: false }),
  'sistema/cifratura': () => ({ attiva: false }),
  'sistema/percorsi': () => ({
    dataDir: 'C:\\Users\\demo\\Documents\\Ordeva', configPath: 'C:\\Users\\demo\\Documents\\Ordeva\\config.json',
    files: [{ nome: 'ordeva.db', esiste: true, bytes: 8452096 }],
  }),
  'backup/config': () => ({ attivo: true, cartella: 'C:\\Users\\demo\\Dropbox\\Ordeva', frequenza: 'GIORNALIERA', ultimoBackup: iso(1), cifrato: true }),
  'backup/list': () => ({ files: Array.from({ length: 7 }, (_, i) => ({ name: `ordeva-2026-09-0${i + 1}.db.enc`, encrypted: true, size: 8400000 + i * 1000, mtime: iso(i) })) }),
  archivi: () => ({ archivi: [{ slug: 'principale', nome: 'Archivio principale', cifrato: false }, { slug: 'prova', nome: 'Prova 2025', cifrato: true }], corrente: 'principale' }),
  moduli: () => [],
  'sdi-passive/providers': () => ([{ id: 'FIC', nome: 'Fatture in Cloud' }, { id: 'ARUBA', nome: 'Aruba' }]),
  'sdi-passive/ricevute': () => COLLEZIONI['acquisti']().slice(0, 30),
  'admin/stats': () => ({ tenants: 3, utenti: 7, documenti: 642 }),
  reports: () => [],
  search: () => [],
};

/** Shape richiesta dalla pagina Scadenzario (getScadenzarioFull → `ScadenzarioItem`).
 *  Diversa da `scadenzario()`, che serve il vecchio endpoint `pagamenti/scadenzario`. */
function scadenzarioFull(): any[] {
  const r = makeRng(506);
  const cl = genClienti();
  return Array.from({ length: 42 }, (_, i) => {
    const isFattura = r() > 0.42;
    const tipo = isFattura ? 'fattura' : 'acquisto';
    const direzione = isFattura ? 'ENTRATA' : 'USCITA';
    // Scadenze distribuite: ~1/3 scadute, ~1/3 entro 30 giorni, ~1/3 oltre.
    const bucket = r();
    const offset = bucket < 0.34 ? Math.ceil(r() * 40)
                 : bucket < 0.68 ? -Math.ceil(r() * 30)
                 : -(31 + Math.ceil(r() * 60));
    const scaduto = offset > 0;
    const parziale = !scaduto && r() > 0.8;
    return {
      id: i + 1,
      numero: `2026/${String(N - i).padStart(4, '0')}`,
      tipo, direzione,
      dataEmissione: iso(offset + 30),
      dataScadenza: iso(offset),
      totale: round2(180 + r() * 7200),
      stato: parziale ? 'PARZIALE' : scaduto ? 'SCADUTA' : 'EMESSA',
      controparte: cl[Math.floor(r() * 40)].ragioneSociale,
      giorniMancanti: scaduto ? offset : -offset,
      scaduto,
    };
  });
}

function scadenzario(): any[] {
  const r = makeRng(505);
  const cl = genClienti();
  return Array.from({ length: 80 }, (_, i) => {
    const tot = round2(200 + r() * 6000);
    const pagato = r() > 0.6 ? round2(tot * r()) : 0;
    return {
      id: i + 1, numero: `2026/${String(N - i).padStart(4, '0')}`,
      dataEmissione: iso(60 + i), dataScadenza: iso(30 - i),
      controparte: cl[Math.floor(r() * 40)].ragioneSociale,
      tipoPagamentoNome: 'Bonifico 30 gg', conto: 'BANCA',
      importoTotale: tot, importoPagato: pagato, rimanente: round2(tot - pagato),
      tipoEntry: r() > 0.35 ? 'FATTURA' : 'ACQUISTO',
    };
  });
}

// ── Risoluzione della richiesta ──────────────────────────────────────────────

/** Toglie prefisso `/api/`, query string e slash finale: resta il path logico. */
function normalizza(url: string): string {
  const senzaQuery = url.split('?')[0];
  const i = senzaQuery.indexOf('/api/');
  const p = i >= 0 ? senzaQuery.slice(i + 5) : senzaQuery.replace(/^\/+/, '');
  return p.replace(/\/+$/, '');
}

/** `true` per i path che chiedono un singolo elemento di una collezione nota. */
function dettaglio(path: string): { nome: string; id: number } | null {
  const m = /^([a-z-]+)\/(\d+)$/.exec(path);
  if (!m || !COLLEZIONI[m[1]]) return null;
  return { nome: m[1], id: Number(m[2]) };
}

/**
 * Risposta finta per una richiesta. Ritorna sempre qualcosa: una schermata non
 * deve mai fallire per un endpoint che non abbiamo ancora modellato — se manca,
 * si degrada a lista vuota / oggetto vuoto, che è renderizzabile.
 */
export function risolvi(method: string, url: string, body: any, state: PreviewState): any {
  const path = normalizza(url);
  const vuoto = state === 'empty';

  // Scritture: eco del payload con un id, così le liste ottimistiche funzionano.
  if (method !== 'GET') {
    if (path.endsWith('/print') || path.includes('xml')) return { ok: true };
    // Lettura documenti: l'eco generico non basta, la schermata si aspetta i
    // campi riconosciuti. Qui si finge un documento letto bene.
    if (path === 'ocr/fattura/testo') {
      return {
        ok: true,
        affidabilita: 1,
        suggerito: {
          fornitore: 'ACME Forniture S.r.l.',
          pIvaFornitore: '00743110157',
          dataDoc: iso(3),
          numero: '2026/145',
          totaleLordo: 239.12,
          totaleNetto: 196,
          totaleIva: 43.12,
          righe: [
            { descrizione: 'Toner nero HP 26A', quantita: 2, prezzo: 78.5, iva: 22 },
            { descrizione: 'Risma carta A4 80gr', quantita: 10, prezzo: 3.9, iva: 22 },
          ],
        },
      };
    }
    if (path === 'ocr/scontrino/testo') {
      return { ok: true, suggerito: { data: iso(1), importo: 24.9, negozio: 'Cartoleria Centrale', categoria: '', causale: '' } };
    }
    if (path === 'ocr/fattura/analizza-righe') {
      const righe = Array.isArray(body?.righe) ? body.righe : [];
      return {
        fornitoreId: vuoto ? null : 1,
        fornitoreNome: vuoto ? '' : 'ACME Forniture S.r.l.',
        duplicato: null,
        righe: righe.map((r: any) => ({ descrizione: r?.descrizione ?? '', candidati: [] })),
      };
    }
    return { success: true, ok: true, id: Math.floor(Math.random() * 9000) + 1000, ...(body && typeof body === 'object' ? body : {}) };
  }

  // Numerazione automatica dei documenti
  if (path.startsWith('next-number')) return { numero: vuoto ? 1 : N + 1 };

  // Dettaglio di un elemento
  const det = dettaglio(path);
  if (det) {
    const lista = COLLEZIONI[det.nome]();
    return lista.find((x: any) => x.id === det.id) ?? lista[0] ?? {};
  }

  // Sotto-risorse note del dettaglio (indirizzi, varianti, prezzi, …)
  if (/^clienti\/\d+\/indirizzi$/.test(path)) {
    return vuoto ? [] : [{ id: 1, nome: 'Cantiere via Verdi', via: 'Via Verdi 5', cap: '20121', citta: 'Milano', provincia: 'MI' }];
  }
  if (/^clienti\/\d+\/fatture-insolute$/.test(path)) {
    return vuoto ? [] : COLLEZIONI['fatture']().slice(0, 3);
  }
  if (/^clienti\/\d+\/top-prodotti$/.test(path)) {
    return vuoto ? [] : genProdotti().slice(0, 5).map((p) => ({ ...p, occorrenze: 7, quantitaTotale: 1200, ultimaVendita: iso(30) }));
  }
  if (/^prodotti\/\d+\/(fornitori|codici-alias)$/.test(path) || /^prodotto-varianti\//.test(path)) return [];

  // Aggregati e singoletti
  const agg = Object.keys(AGGREGATI).find((k) => path === k || path.startsWith(k + '?') || path.startsWith(k + '/'));
  if (agg) {
    const v = AGGREGATI[agg]();
    if (!vuoto) return v;
    return Array.isArray(v) ? [] : svuota(v);
  }

  // Collezioni
  const c = COLLEZIONI[path];
  if (c) return vuoto ? [] : c();

  // Sconosciuto: qualcosa di renderizzabile, mai un errore. Il path viene però
  // annotato: `window.__fixtureMancanti` elenca gli endpoint ancora senza dati
  // finti, cioè le schermate che l'audit vedrebbe più vuote del vero.
  segnalaMancante(path);
  return path.includes('count') || path.includes('status') || path.includes('config') ? {} : [];
}

/** Endpoint serviti dal fallback generico: da colmare man mano che si auditano le schermate. */
export const fixtureMancanti = new Set<string>();
function segnalaMancante(path: string) {
  fixtureMancanti.add(path);
  try { (window as any).__fixtureMancanti = [...fixtureMancanti].sort(); } catch { /* non in browser */ }
}

/** Azzera i numeri di un aggregato mantenendone la forma (stato "empty"). */
function svuota(v: any): any {
  if (v === null || typeof v !== 'object') return typeof v === 'number' ? 0 : v;
  const out: any = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) out[k] = svuota(v[k]);
  return out;
}
