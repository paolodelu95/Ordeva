// ── Grafica documenti (stampa/PDF) ───────────────────────────────────────────
// Modello ADDITIVO e retrocompatibile: ogni campo nuovo è opzionale e, se assente,
// produce un output IDENTICO a oggi. Persistito come JSON in azienda.template_config
// (nessuna modifica backend/DB). I valori di fallback sono le costanti attuali di
// print.service.ts.
export type DocStile = 'classico' | 'moderno' | 'minimal';

// Tipi documento (1:1 coi metodi pubblici di PrintService; ordine cliente/fornitore separati)
export type DocType =
  | 'fattura' | 'ddt' | 'notaCredito'
  | 'ordineCliente' | 'ordineFornitore'
  | 'preventivo' | 'documentoCommerciale' | 'acquisto';

// Sezioni riordinabili del corpo (header sempre primo e footer sempre ultimo: fuori dall'ordine)
export type SectionKey =
  | 'parti' | 'trasporto' | 'tabella' | 'totali'
  | 'pagamento' | 'riferimenti' | 'note' | 'firme';

// Colonne tabella righe (set standard a 8 colonne)
export type ColumnKey =
  | 'num' | 'codiceDescrizione' | 'quantita' | 'um'
  | 'prezzo' | 'sconto' | 'iva' | 'importo';

export type HexColor = string; // validato /^#[0-9a-fA-F]{6}$/

export interface ColorConfig {
  accent?: HexColor;        // intestazioni, tabella, barre
  text?: HexColor;          // testo principale
  muted?: HexColor;         // testo secondario/etichette
  lightBg?: HexColor;       // sfondi tenui (box parti, head riepilogo IVA)
  rowAlt?: HexColor;        // righe alternate tabella
  headText?: HexColor;      // testo intestazione tabella
  totalBarText?: HexColor;  // testo barra totale
  divider?: HexColor;       // linee divisorie
  noteFill?: HexColor;      // sfondo box note
  noteBorder?: HexColor;    // bordo box note
}

export interface TypographyConfig {
  fontFamily?: 'helvetica' | 'times' | 'courier'; // solo font built-in jsPDF
  fontScale?: number;                              // 0.85–1.20, moltiplicatore dimensioni
  uppercaseSectionTitles?: boolean;                // titoli sezione in MAIUSCOLO
}

export interface LogoConfig {
  show?: boolean;                       // mostra il logo (se presente in azienda)
  align?: 'left' | 'center' | 'right';  // allineamento orizzontale
  size?: 'S' | 'M' | 'L';               // S=30x12, M=44x18 (attuale), L=60x24 mm
}

export interface FooterConfig {
  show?: boolean;
  showRagioneSociale?: boolean;
  showPiva?: boolean;
  showCodFiscale?: boolean;
  showPec?: boolean;
  showSdi?: boolean;
  showPageNumber?: boolean;
  customText?: string;
}

export interface VisibilityConfig {
  showIban?: boolean;        // mostra IBAN nel blocco pagamento
  showRiferimenti?: boolean; // mostra il blocco riferimenti
}

export interface TableColumnConfig {
  key: ColumnKey;
  visible?: boolean;            // num/codiceDescrizione/importo sono sempre forzate visibili
  width?: number | 'auto';      // mm
  align?: 'left' | 'center' | 'right';
  label?: string;               // override intestazione
}

export interface MarginsConfig {
  left?: number; right?: number; // mm (esposti in UI)
  top?: number; bottom?: number; // predisposti, non esposti in v1
}

// Riusabile come override per-tipo-documento (merge shallow dei sotto-oggetti)
export interface DocTemplateOverride {
  stile?: DocStile;
  colors?: ColorConfig;
  typography?: TypographyConfig;
  logo?: LogoConfig;
  footer?: FooterConfig;
  visibility?: VisibilityConfig;
  blocks?: { [key: string]: boolean };
  columns?: TableColumnConfig[];
  sectionsOrder?: SectionKey[];
  tableTheme?: 'striped' | 'grid' | 'plain';
  margins?: MarginsConfig;
}

// Root salvato in azienda.template_config (JSON).
export interface TemplateConfig extends DocTemplateOverride {
  schemaVersion?: number;
  stile: DocStile;            // RESTA OBBLIGATORIO (retrocompat: default {stile:'classico'})
  accentColor?: string;       // LEGACY: se colors.accent assente, usato come fallback. Mai rimuovere.
  format?: 'a4';
  orientation?: 'p';
  perDoc?: { [k in DocType]?: DocTemplateOverride };
}

export interface NotificheConfig {
  avvisoInsolutiDdt?: boolean;
  avvisoInsolutiFattura?: boolean;
}

export interface Azienda {
  id?: number;
  ragioneSociale: string;
  indirizzo?: string;
  cap?: string;
  citta?: string;
  provincia?: string;
  stato?: string;
  pIva?: string;
  codFiscale?: string;
  email?: string;
  telefono?: string;
  pec?: string;
  sdi?: string;
  banca?: string;
  iban?: string;
  logo?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;
  emailCorpoDocumento?: string;
  emailMode?: 'SMTP' | 'MAILTO' | 'WEBMAIL_GMAIL' | 'WEBMAIL_OUTLOOK';
  sdiApiUrl?: string;
  sdiApiKey?: string;
  /** Provider per invio/ricezione e-fatture SDI: Fatture in Cloud, Aruba o intermediario generico. */
  sdiProvider?: 'FIC' | 'ARUBA' | 'GENERICO';
  riordinoAutomatico?: boolean;
  multiUtenteAttivo?: boolean;
  numerazioneAnnuale?: boolean;
  numeroPrefissi?: { [key: string]: string };
  templateConfig?: TemplateConfig;
  notificheConfig?: NotificheConfig;
  /**
   * Quando true, i documenti già salvati si aprono in modalità readonly
   * (lucchetto chiuso). Per modificarli serve cliccare il lucchetto.
   * Default: true.
   */
  lockDocumentiDefault?: boolean;
  // Regime fiscale (RF01..RF19; RF19 = forfettario) + default fiscali precompilati
  regimeFiscale?: string;
  ritenutaAliquotaDefault?: number;
  ritenutaCausaleDefault?: string;
  ritenutaTipoDefault?: string;
  cassaTipoDefault?: string;
  cassaAliquotaDefault?: number;
  cassaIvaDefault?: number;
  /** Cifre decimali per il prezzo unitario su documenti/catalogo (2 o 3). Default 2. */
  decimaliPrezzo?: number;
}

/** Configurazione e stato del backup giornaliero (edizione offline). */
export interface BackupConfig {
  dir: string;
  enabled: boolean;
  encrypt: boolean;
  alertDays: number;
  alertDisabled: boolean;
  /** Elimina i backup più vecchi di N giorni (0 = conservali tutti). */
  retentionDays: number;
  lastAt: string | null;
  alertDismissedAt: string | null;
  daysSinceLast: number | null;
  alertDue: boolean;
  passwordSet: boolean;
  keyReady: boolean;
}

export interface Prodotto {
  id?: number;
  nome: string;
  categoria: string;
  descrizione?: string;
  prezzo: number;
  prezzoAcquisto?: number;
  quantita?: number;
  sogliaMinima?: number | null;   // null/0 = nessun avviso di scorta (es. su ordinazione)
  unitaMisura?: string;
  codice?: string;
  codiceFornitore?: string;
  iva: number;
  barcode?: string;
  haVarianti?: boolean;
  varianti?: ProdottoVariante[];
  fornitoreIdPreferito?: number | null;
  riordinoQuantita?: number;
  fornitori?: ProdottoFornitore[];
  /** Peso unitario in kg (usato per il peso lordo dei documenti di trasporto). */
  peso?: number | null;
  /** Dimensioni in testo libero, es. "120×80×40 cm". */
  dimensioni?: string;
  /** Immagine (data URL) — presente solo nel GET singolo, mai nella lista. */
  immagine?: string;
  /** Flag leggero nella lista: il prodotto ha un'immagine salvata. */
  haImmagine?: boolean;
}

export interface ProdottoFornitore {
  id?: number;
  fornitoreId: number | null;
  fornitoreNome?: string;
  codiceFornitore?: string;
  prezzoAcquisto?: number | null;
  predefinito?: boolean;
}

export interface ProdottoVariante {
  id?: number;
  prodottoId?: number;
  taglia: string;
  colore: string;
  quantita: number;
  barcode: string;
}

// ── Import listino: abbinamento codice fornitore -> prodotto ──────────────────
/** Riga del listino non abbinata a un codice fornitore esistente. */
export interface ListinoRigaNonTrovata {
  codice: string;
  prezzo?: any;
  descrizione?: string;
  marca?: string;
}

/** Candidato proposto per una riga non abbinata. `score` e interno (non mostrato). */
export interface ListinoCandidato {
  prodottoId: number;
  nome: string;
  codice: string;
  categoria: string;
  prezzoAcquistoAttuale: number | null;
  quantita: number | null;
  score: number;
  fascia: 'alta' | 'media' | 'bassa';
  perche: string;
  giaAssociatoAFornitore?: boolean;
}

/** Risultato del match per una riga: la riga di listino + i candidati ordinati. */
export interface ListinoMatchRisultato {
  codice: string;
  descrizione: string;
  prezzo?: any;
  candidati: ListinoCandidato[];
}

/** Variazione di prezzo d'acquisto rilevata durante un import listino. */
export interface VariazionePrezzo {
  codice: string;
  prodottoNome: string;
  prezzoVecchio: number | null;
  prezzoNuovo: number;
  deltaPct: number | null;
}

/** Codice fornitore memorizzato per un prodotto (memoria degli import listino). */
export interface CodiceAlias {
  id: number;
  codice: string;
  fornitoreId: number;
  fornitoreNome: string;
  createdAt?: string;
}

export interface ClienteIndirizzo {
  id?: number;
  clienteId?: number;
  nome: string;
  via?: string;
  cap?: string;
  citta?: string;
  provincia?: string;
  stato?: string;
}

export interface Cliente {
  id?: number;
  ragioneSociale: string;
  email?: string;
  telefono?: string;
  cellulare?: string;
  via?: string;
  cap?: string;
  citta?: string;
  provincia?: string;
  stato?: string;
  codiceFiscale?: string;
  pIva?: string;
  sdi?: string;
  pec?: string;
  tipoPagamentoId?: number | null;
  listinoId?: number | null;
  tipoSoggetto?: string;
  cig?: string;
  cup?: string;
  aliquotaIvaId?: number | null;
  ultimoAcquisto?: string | null;
  fatturatoAnno?: number;
  fattureInsolute?: number;
  /** È anche fornitore: crea/collega un'anagrafica fornitore gemella. */
  ancheFornitore?: boolean;
  fornitoreCollegatoId?: number | null;
  /** Agente assegnato e percentuale provvigione (override sul default dell'agente). */
  agenteId?: number | null;
  provvigione?: number | null;
}

export interface Agente {
  id?: number;
  nome: string;
  email?: string;
  telefono?: string;
  /** Base di calcolo provvigione scelta per questo agente. */
  baseProvvigione?: 'IMPONIBILE' | 'INCASSATO' | 'MARGINE';
  provvigioneDefault?: number;
  attivo?: boolean;
}

/** Colonna descrittiva personalizzata di un listino (es. Dimensioni, Peso, Q.tà pallet). */
export interface ListinoColonna {
  key: string;
  label: string;
}

/** Chiavi delle colonne standard di un listino. */
export type ListinoColonnaStdKey = 'num' | 'codice' | 'prodotto' | 'dimensioni' | 'peso' | 'prezzoBase' | 'sconto' | 'prezzo';

export const LISTINO_STD_KEYS: ListinoColonnaStdKey[] = ['num', 'codice', 'prodotto', 'dimensioni', 'peso', 'prezzoBase', 'sconto', 'prezzo'];

/** Colonne standard nascoste di default (si attivano da "Colonne"): dati logistici. */
export const LISTINO_STD_HIDDEN_DEFAULT: ListinoColonnaStdKey[] = ['dimensioni', 'peso'];

/** Configurazione legacy di una colonna standard (mantenuta per compat di lettura). */
export interface ListinoColonnaStd {
  key: ListinoColonnaStdKey;
  label: string;
  visibile: boolean;
}

export type ListinoAlign = 'left' | 'center' | 'right';

/** Config colonne unificata: standard e personalizzate in un unico ordine,
 *  tutte rinominabili, nascondibili e riordinabili liberamente,
 *  con stile testo opzionale applicato all'intera colonna. */
export interface ListinoColonnaCfg {
  key: string;
  label: string;
  visibile: boolean;
  tipo: 'std' | 'extra';
  bold?: boolean;
  italic?: boolean;
  /** Allineamento; assente = automatico (numeri a destra, testo a sinistra). */
  align?: ListinoAlign;
}

/** Stile di una singola cella: grassetto, corsivo, barrato, allineamento. */
export interface ListinoCellaStile {
  b?: boolean;
  i?: boolean;
  s?: boolean;
  al?: ListinoAlign;
}

export const LISTINO_COLONNE_DEFAULT_LABELS: Record<ListinoColonnaStdKey, string> = {
  num: '#', codice: 'Codice', prodotto: 'Prodotto',
  dimensioni: 'Dimensioni', peso: 'Peso',
  prezzoBase: 'Prezzo base', sconto: 'Sconto %', prezzo: 'Prezzo',
};

/** Posizione di default delle standard (le extra legacy si inseriscono dopo "prodotto"). */
const ORDINE_STD_DEFAULT: ListinoColonnaStdKey[] = ['num', 'codice', 'prodotto', 'dimensioni', 'peso', 'prezzoBase', 'sconto', 'prezzo'];

/**
 * Config colonne effettiva di un listino: usa colonneConfig se presente
 * (integrando eventuali standard mancanti in coda alla loro zona di default),
 * altrimenti la costruisce dai campi legacy colonneStandard + colonneExtra.
 */
export function mergeColonneCfg(l?: Pick<Listino, 'colonneConfig' | 'colonneStandard' | 'colonneExtra'>): ListinoColonnaCfg[] {
  const stdCfg = (key: ListinoColonnaStdKey): ListinoColonnaCfg => {
    const legacy = l?.colonneStandard?.find(c => c.key === key);
    return {
      key,
      label: (legacy?.label || '').trim() || LISTINO_COLONNE_DEFAULT_LABELS[key],
      visibile: legacy ? legacy.visibile !== false : !LISTINO_STD_HIDDEN_DEFAULT.includes(key),
      tipo: 'std',
    };
  };

  if (l?.colonneConfig?.length) {
    const out: ListinoColonnaCfg[] = l.colonneConfig.map(c => ({
      key: c.key,
      label: (c.label || '').trim() || (LISTINO_COLONNE_DEFAULT_LABELS[c.key as ListinoColonnaStdKey] ?? c.key),
      visibile: c.visibile !== false,
      tipo: LISTINO_STD_KEYS.includes(c.key as ListinoColonnaStdKey) ? 'std' : 'extra',
      ...(c.bold ? { bold: true } : {}),
      ...(c.italic ? { italic: true } : {}),
      ...(c.align ? { align: c.align } : {}),
    }));
    // Standard mancanti (config salvata da versioni precedenti): aggiunte nascoste? No:
    // vanno mostrate con il loro default, nell'ordine canonico, per non perdere colonne.
    for (const key of ORDINE_STD_DEFAULT) {
      if (!out.some(c => c.key === key)) out.push(stdCfg(key));
    }
    return out;
  }

  // Fallback legacy: standard nell'ordine storico, extra dopo "prodotto".
  const out: ListinoColonnaCfg[] = [];
  for (const key of ['num', 'codice', 'prodotto', 'dimensioni', 'peso'] as ListinoColonnaStdKey[]) out.push(stdCfg(key));
  for (const c of l?.colonneExtra || []) out.push({ key: c.key, label: c.label, visibile: true, tipo: 'extra' });
  for (const key of ['prezzoBase', 'sconto', 'prezzo'] as ListinoColonnaStdKey[]) out.push(stdCfg(key));
  return out;
}

/** Tema di stampa del listino: palette per testata, intestazioni tabella e righe. */
export interface ListinoTema {
  key: string;
  label: string;
  /** Colore del titolo LISTINO, divisori e nomi sezione. */
  accent: [number, number, number];
  /** Sfondo dell'intestazione tabella. */
  headFill: [number, number, number];
  /** Testo dell'intestazione tabella. */
  headText: [number, number, number];
  /** Sfondo delle righe alternate. */
  rowAlt: [number, number, number];
  tableTheme: 'striped' | 'grid' | 'plain';
}

/** Temi di default ('' = segue la grafica documenti). */
export const LISTINI_TEMI: ListinoTema[] = [
  { key: 'ordeva',    label: 'Teal',        accent: [17, 118, 155],  headFill: [17, 118, 155],  headText: [255, 255, 255], rowAlt: [235, 246, 249], tableTheme: 'striped' },
  { key: 'blu',       label: 'Blu notte',   accent: [30, 58, 138],   headFill: [30, 58, 138],   headText: [255, 255, 255], rowAlt: [239, 246, 255], tableTheme: 'striped' },
  { key: 'verde',     label: 'Verde bosco', accent: [21, 128, 61],   headFill: [21, 128, 61],   headText: [255, 255, 255], rowAlt: [240, 253, 244], tableTheme: 'striped' },
  { key: 'bordeaux',  label: 'Bordeaux',    accent: [136, 19, 55],   headFill: [136, 19, 55],   headText: [255, 255, 255], rowAlt: [255, 241, 242], tableTheme: 'striped' },
  { key: 'antracite', label: 'Antracite',   accent: [31, 41, 55],    headFill: [31, 41, 55],    headText: [255, 255, 255], rowAlt: [243, 244, 246], tableTheme: 'striped' },
  { key: 'sabbia',    label: 'Sabbia',      accent: [180, 83, 9],    headFill: [254, 243, 199], headText: [120, 53, 15],   rowAlt: [255, 251, 235], tableTheme: 'striped' },
  { key: 'carta',     label: 'Carta',       accent: [100, 116, 139], headFill: [248, 250, 252], headText: [51, 65, 85],    rowAlt: [255, 255, 255], tableTheme: 'plain' },
];

/** Sezione del listino: riga-divisore (es. categoria) nella sequenza delle righe. */
export interface ListinoSezione {
  id?: number;
  listinoId?: number;
  nome: string;
  ordine?: number;
}

export interface Listino {
  id?: number;
  nome: string;
  descrizione?: string;
  scontoDefault?: number;
  attivo?: boolean;
  /** Legacy (lettura): definizioni colonne personalizzate. */
  colonneExtra?: ListinoColonna[];
  /** Legacy (lettura): override colonne standard. */
  colonneStandard?: ListinoColonnaStd[];
  /** Config colonne unificata (fonte di verità, vedi mergeColonneCfg). */
  colonneConfig?: ListinoColonnaCfg[];
  /** Stampa PDF su due tabelle affiancate (due prodotti per riga). */
  stampaDueColonne?: boolean;
  /** Righe verticali che separano le colonne (editor + stampa PDF). */
  griglia?: boolean;
  /** Tema di stampa (key di LISTINI_TEMI, '' = grafica documenti). */
  tema?: string;
  prezziCount?: number;
  createdAt?: string;
}

export interface ListinoPrezzo {
  id?: number;
  listinoId: number;
  prodottoId: number;
  prezzo?: number | null;
  sconto?: number | null;
  ordine?: number;
  /** Valori delle colonne personalizzate, indicizzati per ListinoColonna.key. */
  datiExtra?: Record<string, string>;
  /** Stili per cella, indicizzati per chiave colonna (standard o extra). */
  stili?: Record<string, ListinoCellaStile>;
  prodottoNome?: string;
  prodottoCodice?: string;
  prodottoPrezzoBase?: number;
  prodottoIva?: number;
  prodottoUm?: string;
  prodottoCategoria?: string;
  prodottoDescrizione?: string;
  prodottoPeso?: number | null;
  prodottoDimensioni?: string;
}

export interface PrezzoRisolto {
  prezzo: number;
  sconto: number;
  iva: number;
  sorgente: 'BASE' | 'LISTINO_OVERRIDE' | 'LISTINO_SCONTO';
  listinoId?: number;
  listinoNome?: string;
}

export interface Fornitore {
  id?: number;
  ragioneSociale: string;
  email?: string;
  telefono?: string;
  cellulare?: string;
  via?: string;
  cap?: string;
  citta?: string;
  provincia?: string;
  stato?: string;
  pIva?: string;
  sdi?: string;
  pec?: string;
  /** Soggetto estero — usato per esterometro e autofatture TD17/18/19. */
  estero?: boolean;
  /** È anche cliente: crea/collega un'anagrafica cliente gemella. */
  ancheCliente?: boolean;
  clienteCollegatoId?: number | null;
}

export interface RigaDocumento {
  id?: number;
  prodottoId?: number | null;
  prodottoNome?: string;
  codiceProdotto?: string;
  descrizione: string;
  quantita: number;
  unitaMisura?: string;
  prezzo: number;
  sconto?: number;
  iva: number;
  codiceIva?: string;
  varianteId?: number | null;
  varianteTaglia?: string;
  varianteColore?: string;
  tipo?: 'PRODOTTO' | 'NOTA';
  codiceFornitore?: string;
  /** Se true (default per le righe prodotto) la riga scarica il prodotto dal magazzino. */
  scaricaMagazzino?: boolean;
}

export interface NotaRapida {
  id?: number;
  testo: string;
  ordine?: number;
}

export interface ScadenzaFiscale {
  id?: number;
  data: string;            // YYYY-MM-DD
  titolo: string;
  categoria: string;       // IVA | LIPE | Ritenute | Imposte | Dichiarazioni | Altro
  importo?: number | null;
  note?: string;
  stato?: 'pendente' | 'fatto';
  auto?: boolean;          // generata automaticamente
}

export interface PrezzoRecente {
  prezzo: number;
  sconto: number;
  prezzoEffettivo: number;
  quantita: number;
  numero: string;
  dataEmissione: string;
  tipo: string;
}

export interface Ddt {
  id?: number;
  numero: string;
  dataEmissione: string;
  /** 'CLIENTE' (default) o 'FORNITORE' (reso merce a fornitore). */
  tipo?: string;
  clienteId?: number | null;
  clienteNome?: string;
  fornitoreId?: number | null;
  fornitoreNome?: string | null;
  /** Nome controparte (cliente o fornitore) calcolato dal backend per le liste. */
  controparteNome?: string;
  note?: string;
  stato: string;
  totale?: number;
  imponibile?: number;
  righe?: RigaDocumento[];
  fatturaId?: number | null;
  fatturaNumero?: string | null;
  // Dati trasporto
  dataOraInizioTrasporto?: string;
  causaleTrasporto?: string;
  aspettoBeni?: string;
  porto?: string;
  numeroColli?: number | null;
  pesoLordo?: number | null;
  incaricatoTrasporto?: string;
  vettore?: string;
  destinazioneDiversa?: string;
  noteTrasporto?: string;
  destinazioneId?: number | null;
}

export interface FatturaRiferimento {
  id?: number;
  fatturaId?: number;
  tipo: string;
  numero: string;
  data?: string;
  cig?: string;
  cup?: string;
  commessa?: string;
}

export interface Fattura {
  id?: number;
  numero: string;
  dataEmissione: string;
  clienteId?: number | null;
  clienteNome?: string;
  ddtId?: number | null;
  ddtIds?: number[];
  note?: string;
  stato: string;
  totale?: number;
  imponibile?: number;
  agenteId?: number | null;
  provvigione?: number | null;
  tipoPagamentoId?: number | null;
  righe?: RigaDocumento[];
  riferimenti?: FatturaRiferimento[];
  statoSdi?: string;
  dataInvioSdi?: string;
  idTrasmissioneSdi?: string;
  // Dati fiscali (ritenuta d'acconto / cassa previdenziale / bollo)
  ritenutaAliquota?: number;
  ritenutaCausale?: string;
  ritenutaTipo?: string;
  ritenutaSuCassa?: boolean;
  cassaTipo?: string;
  cassaAliquota?: number;
  cassaIva?: number;
  bollo?: boolean;
  cassaImporto?: number;
  iva?: number;
  ritenutaImporto?: number;
  bolloImporto?: number;
  nettoAPagare?: number;
}

export interface NotaCredito {
  id?: number;
  numero: string;
  dataEmissione: string;
  clienteId?: number | null;
  clienteNome?: string;
  fatturaId?: number | null;
  note?: string;
  stato: string;
  statoSdi?: string;
  totale?: number;
  imponibile?: number;
  righe?: RigaDocumento[];
  // Dati fiscali (ritenuta d'acconto / cassa previdenziale / bollo)
  ritenutaAliquota?: number;
  ritenutaCausale?: string;
  ritenutaTipo?: string;
  cassaTipo?: string;
  cassaAliquota?: number;
  cassaIva?: number;
  bollo?: boolean;
  cassaImporto?: number;
  iva?: number;
  ritenutaImporto?: number;
  bolloImporto?: number;
  nettoAPagare?: number;
}

export interface Magazzino {
  id?: number;
  codice?: string;
  nome: string;
  indirizzo?: string;
  predefinito?: boolean;
  attivo?: boolean;
}

export interface Giacenza {
  id?: number;
  prodottoId: number;
  prodottoNome?: string;
  prodottoCodice?: string;
  unitaMisura?: string;
  varianteId?: number | null;
  varianteTaglia?: string;
  varianteColore?: string;
  magazzinoId: number;
  magazzinoNome?: string;
  lotto?: string;
  scadenza?: string;
  quantita: number;
}

export interface ScadenzaLotto {
  prodottoId: number;
  prodottoNome: string;
  unitaMisura?: string;
  magazzinoId: number;
  magazzinoNome: string;
  lotto?: string;
  scadenza: string;
  quantita: number;
}

export interface Ordine {
  id?: number;
  numero: string;
  dataOrdine: string;
  clienteId?: number | null;
  clienteNome?: string;
  fornitoreId?: number | null;
  fornitoreNome?: string;
  acquistoId?: number | null;
  acquistoNumero?: string | null;
  tipo: string;
  stato: string;
  note?: string;
  totale?: number;
  imponibile?: number;
  righe?: RigaDocumento[];
}

export interface Preventivo {
  id?: number;
  numero: string;
  dataEmissione: string;
  clienteId?: number | null;
  clienteNome?: string;
  validita: number;
  stato: string;
  note?: string;
  totale?: number;
  imponibile?: number;
  righe?: RigaDocumento[];
  /** Mostra le miniature dei prodotti nella stampa PDF (default true). */
  stampaImmagini?: boolean;
}

export interface TipoPagamento {
  id?: number;
  nome: string;
  conto: string;
  giorniScadenza: number;
  fineMese: boolean;
  immediato: boolean;
  attivo: boolean;
}

export interface Acquisto {
  id?: number;
  numero: string;
  dataEmissione: string;
  fornitoreId?: number | null;
  fornitoreNome?: string;
  tipoPagamentoId?: number | null;
  tipoPagamentoNome?: string;
  note?: string;
  stato: string;
  totale?: number;
  imponibile?: number;
  righe?: RigaDocumento[];
}

export interface CategoriaProdotto {
  id?: number;
  nome: string;
  aliquotaIvaId?: number | null;
}

export interface UnitaMisura {
  id?: number;
  nome: string;
  simbolo: string;
}

export interface AliquotaIva {
  id?: number;
  nome: string;
  valore: number;
  codice?: string;
  categoria?: string;
  descrizione?: string;
  natura?: string | null;
  note?: string;
  predefinito?: boolean;
  attiva: boolean;
}

export interface Pagamento {
  id?: number;
  fatturaId?: number | null;
  fatturaNumero?: string;
  acquistoId?: number | null;
  acquistoNumero?: string;
  venditaBancoId?: number | null;
  venditaBancoNumero?: string;
  clienteNome?: string;
  fornitoreNome?: string;
  dataPagamento: string;
  importo: number;
  metodo?: string;
  note?: string;
  tipo?: string;
  conto?: string;
  causale?: string;
  tipoPagamentoId?: number | null;
  tipoPagamentoNome?: string;
  /** Non saldato -> compare come voce aperta nello scadenzario. Default true. */
  saldato?: boolean;
}

export interface CausalePagamento {
  id?: number;
  nome: string;
  ordine?: number;
  attivo?: boolean;
}

export interface PropostaRiordino {
  prodottoId: number;
  nome: string;
  codice: string;
  quantita: number;
  sogliaMinima: number;
  quantitaSuggerita: number;
  prezzoAcquisto: number;
  iva: number;
  unitaMisura: string;
  fornitoreId: number | null;
  fornitoreNome: string | null;
  // stato UI (non dal backend)
  selected?: boolean;
}

export interface VenditaBanco {
  id?: number;
  numero: string;
  data: string;
  clienteNome?: string;
  metodoPagamento: string;
  note?: string;
  stato?: string;
  totale?: number;
  righe?: RigaDocumento[];
  pagamenti?: { metodo: string; importo: number }[];
}

export interface MovimentoMagazzino {
  id: number;
  data: string;
  prodottoId: number;
  prodottoNome: string;
  tipo: 'CARICO' | 'SCARICO';
  quantita: number;
  causale: string;
  documentoTipo: string;
  documentoId?: number;
  documentoNumero: string;
  clienteId?: number;
  clienteNome?: string;
  fornitoreId?: number;
  fornitoreNome?: string;
  note?: string;
  varianteTaglia?: string;
  varianteColore?: string;
}

export interface GiacenzaStorica {
  id: number;
  nome: string;
  categoria: string;
  unitaMisura?: string;
  sogliaMinima?: number;
  quantita: number;
}

export interface RigaArrivoMerce {
  id?: number;
  prodottoId?: number | null;
  prodottoNome?: string;
  varianteId?: number | null;
  descrizione: string;
  codiceFornitore?: string;
  quantita: number;
  unitaMisura?: string;
  prezzoAcquisto?: number;
  varianteTaglia?: string;
  varianteColore?: string;
  lotto?: string;
  scadenza?: string;
  magazzinoId?: number | null;
}

export interface ArrivoMerce {
  id?: number;
  numero: string;
  data: string;
  fornitoreId?: number | null;
  fornitoreNome?: string;
  acquistoId?: number | null;
  numeroDocumentoFornitore?: string;
  note?: string;
  stato: string;
  totale?: number;
  righe?: RigaArrivoMerce[];
  magazzinoId?: number | null;
}

export interface ScadenzarioEntry {
  id: number;
  numero: string;
  dataEmissione: string;
  dataScadenza?: string;
  controparte: string;
  tipoPagamentoNome?: string;
  conto?: string;
  importoTotale: number;
  importoPagato: number;
  rimanente: number;
  tipoEntry: 'FATTURA' | 'ACQUISTO' | 'PAGAMENTO_MANUALE';
  /** Solo per tipoEntry === 'PAGAMENTO_MANUALE': verso del pagamento. */
  tipo?: 'ENTRATA' | 'USCITA';
}

export interface Utente {
  id?: number;
  username: string;
  password?: string;
  nome?: string;
  email?: string;
  ruolo: 'SUPERADMIN' | 'ADMIN' | 'COMMERCIALE' | 'MAGAZZINIERE' | 'CONTABILE' | 'OPERATORE';
  tenant?: string;
  attivo?: boolean;
}

export interface Tenant {
  slug: string;
  nome: string;
  attivo: boolean;
  created_at?: string;
}

export interface Gruppo {
  id: number;
  nome: string;
  descrizione?: string;
  num_membri?: number;
  membri?: { id: number; username: string; nome: string; email: string; ruolo: string; attivo: number }[];
  created_at?: string;
}

export interface ModuloDto {
  slug: string;
  nome: string;
  descrizione: string;
  categoria: string;
  icona: string;
  core: boolean;
  defaultAttivo: boolean;
  attivo: boolean;
  updatedAt?: string;
}

export interface StatsVenditeMensili {
  mese: string;
  imponibile: number;
  totale: number;
}

export interface StatsAcquistiMensili {
  mese: string;
  imponibile: number;
}

export interface StatsTopProdotto {
  nome: string;
  fatturato: number;
  quantitaVenduta: number;
}

export interface StatsTopCliente {
  nome: string;
  fatturato: number;
}

export interface StatsCashflow {
  daIncassare: number;
  daPagare: number;
}

export interface StatsKpiAnno {
  fatturato: number;
  costi: number;
  margine: number;
}

export interface Sollecito {
  id: number;
  documentoTipo: string;
  documentoId: number;
  emailDestinatario: string;
  dataInvio: string;
  esito: string;
}
