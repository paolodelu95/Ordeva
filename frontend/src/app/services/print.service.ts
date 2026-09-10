import { Component, Inject, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, firstValueFrom } from 'rxjs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DataService } from './data.service';
import { I18nService } from './i18n.service';
import { Azienda, TemplateConfig, DocType, SectionKey, ColumnKey, TableColumnConfig, Listino, ListinoPrezzo, ListinoSezione, ListinoColonnaStdKey, LISTINI_TEMI, mergeColonneCfg } from '../models';
import { SAMPLE_AZIENDA, SAMPLE_FATTURA } from './print-sample-data';

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid #e2e8f0">
      <span style="font-size:16px;font-weight:700;color:#1a1a2e">{{ data.filename }}</span>
      <button mat-icon-button type="button" mat-dialog-close><mat-icon>close</mat-icon></button>
    </div>
    <div style="height:76vh">
      <iframe [src]="safeUrl" style="width:100%;height:100%;border:none" [title]="i18n.t('stampa.anteprima.titolo')"></iframe>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #e2e8f0">
      <button mat-button type="button" mat-dialog-close>{{ i18n.t('stampa.anteprima.chiudi') }}</button>
      <button mat-flat-button type="button" (click)="save()">
        <mat-icon>download</mat-icon> {{ i18n.t('stampa.anteprima.salvaPdf') }}
      </button>
    </div>
  `
})
export class PdfPreviewDialogComponent {
  safeUrl: SafeResourceUrl;
  i18n = inject(I18nService);
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { pdf: jsPDF; filename: string },
    sanitizer: DomSanitizer
  ) {
    this.safeUrl = sanitizer.bypassSecurityTrustResourceUrl(data.pdf.output('bloburl') as unknown as string);
  }
  save() { this.data.pdf.save(this.data.filename); }
}

type RGB = [number, number, number];

// Costanti di default (= valori storici, garantiscono output identico senza config)
const PR: RGB = [79, 70, 229];
const DK: RGB = [26, 26, 46];
const GR: RGB = [100, 116, 139];
const LG: RGB = [240, 242, 248];
const ROW_ALT: RGB = [248, 250, 252];
const DIVIDER: RGB = [220, 225, 230];
const NOTE_FILL: RGB = [255, 251, 235];
const NOTE_BORDER: RGB = [253, 230, 138];
const SLATE: RGB = [51, 65, 85];          // barra totale in stile minimal
const WM: RGB = [218, 222, 232];          // watermark titolo (minimal)
const MIN_DIV: RGB = [200, 205, 215];     // divider header minimal
const SEC_LINE: RGB = [200, 205, 240];    // linea sottotitolo sezione
const SIGN_LINE: RGB = [150, 160, 170];   // linee firma

const PW = 210;
const DEFAULT_ML = 14;

const LOGO_SIZES: Record<'S' | 'M' | 'L', { w: number; h: number }> = {
  S: { w: 30, h: 12 }, M: { w: 44, h: 18 }, L: { w: 60, h: 24 },
};

// Il numero riga ('num') è disattivabile da Impostazioni → Stampa → Colonne.
const FORCED_COLUMNS = new Set<ColumnKey>(['codiceDescrizione', 'importo']);

interface ResolvedColumn { key: ColumnKey; label: string; width: number | 'auto'; align: 'left' | 'center' | 'right'; visible: boolean; }

/** Miniatura prodotto per la stampa: data-URL + dimensioni naturali (px). */
interface RigaImg { data: string; w: number; h: number; }


const DEFAULT_ORDER: Record<DocType, SectionKey[]> = {
  fattura: ['parti', 'tabella', 'totali', 'pagamento', 'riferimenti', 'note'],
  ddt: ['parti', 'trasporto', 'tabella', 'totali', 'note', 'firme'],
  notaCredito: ['parti', 'tabella', 'totali', 'note'],
  ordineCliente: ['parti', 'tabella', 'totali', 'note'],
  ordineFornitore: ['parti', 'tabella', 'note'],
  preventivo: ['parti', 'tabella', 'totali', 'note'],
  documentoCommerciale: ['parti', 'tabella', 'totali', 'note'],
  acquisto: ['parti', 'tabella', 'totali', 'pagamento', 'note'],
};

interface ResolvedTemplateConfig {
  stile: 'classico' | 'moderno' | 'minimal';
  colorsAccentExplicit: boolean;
  colors: {
    accent: RGB; text: RGB; muted: RGB; lightBg: RGB; rowAlt: RGB;
    headText: RGB; totalBarText: RGB; divider: RGB; noteFill: RGB; noteBorder: RGB;
  };
  fontFamily: 'helvetica' | 'times' | 'courier';
  fontScale: number;
  uppercaseSectionTitles: boolean;
  logo: { show: boolean; align: 'left' | 'center' | 'right'; size: 'S' | 'M' | 'L' };
  footer: {
    show: boolean; showRagioneSociale: boolean; showPiva: boolean; showCodFiscale: boolean;
    showPec: boolean; showSdi: boolean; showPageNumber: boolean; customText: string;
  };
  visibility: { showIban: boolean; showRiferimenti: boolean };
  blocks: { [key: string]: boolean };
  columns: ResolvedColumn[];
  sectionsOrder?: SectionKey[];
  tableTheme: 'striped' | 'grid' | 'plain';
  margins: { left: number; right: number };
}

const isHex = (s?: string): s is string => !!s && /^#[0-9a-fA-F]{6}$/.test(s);
const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const colorOr = (hex: string | undefined, fallback: RGB): RGB => (isHex(hex) ? hexToRgb(hex) : fallback);

@Injectable({ providedIn: 'root' })
export class PrintService {
  // inject() prima del campo `resolved`: il suo initializer chiama normalizeConfig()
  // → defaultColumns() → this.i18n, che con un parametro di costruttore non sarebbe
  // ancora assegnato quando gli initializer dei campi vengono eseguiti.
  private i18n = inject(I18nService);
  private resolved: ResolvedTemplateConfig = this.normalizeConfig({ stile: 'classico' }, 'fattura');

  constructor(private ds: DataService, private dialog: MatDialog) {}

  /** Etichette di default delle colonne tabella, tradotte nella lingua UI corrente. */
  private defaultColumns(): ResolvedColumn[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { key: 'num', label: t('stampa.col.num'), width: 8, align: 'center', visible: true },
      { key: 'codiceDescrizione', label: t('stampa.col.codiceDescrizione'), width: 'auto', align: 'left', visible: true },
      { key: 'quantita', label: t('stampa.col.quantita'), width: 14, align: 'right', visible: true },
      { key: 'um', label: t('stampa.col.um'), width: 12, align: 'left', visible: true },
      { key: 'prezzo', label: t('stampa.col.prezzo'), width: 22, align: 'right', visible: true },
      { key: 'sconto', label: t('stampa.col.sconto'), width: 14, align: 'right', visible: true },
      { key: 'iva', label: t('stampa.col.iva'), width: 14, align: 'right', visible: true },
      { key: 'importo', label: t('stampa.col.importo'), width: 24, align: 'right', visible: true },
    ];
  }

  // ── Config resolution ───────────────────────────────────────────────────────

  private getTemplateConfig(az: Azienda): TemplateConfig {
    return az.templateConfig ?? { stile: 'classico' };
  }

  /** Risolve config (con eventuale override per-tipo) in tutti-i-campi-valorizzati. Assenza ⇒ output odierno. */
  private normalizeConfig(raw: TemplateConfig | undefined | null, docType: DocType): ResolvedTemplateConfig {
    const base: TemplateConfig = raw ?? { stile: 'classico' };
    const ov = base.perDoc?.[docType];
    // merge shallow: i sotto-oggetti dell'override rimpiazzano in blocco quelli base
    const stile = ov?.stile ?? base.stile ?? 'classico';
    const colors = ov?.colors ?? base.colors;
    const typography = ov?.typography ?? base.typography;
    const logo = ov?.logo ?? base.logo;
    const footer = ov?.footer ?? base.footer;
    const visibility = ov?.visibility ?? base.visibility;
    const blocks = ov?.blocks ?? base.blocks ?? {};
    const columns = ov?.columns ?? base.columns;
    const sectionsOrder = ov?.sectionsOrder ?? base.sectionsOrder;
    const tableTheme = ov?.tableTheme ?? base.tableTheme ?? 'striped';
    const margins = ov?.margins ?? base.margins;

    // accent: colors.accent (nuovo) > accentColor (legacy) > PR. "Explicit" solo se via colors.accent.
    const colorsAccentExplicit = isHex(colors?.accent);
    const accent = colorsAccentExplicit ? hexToRgb(colors!.accent!) : colorOr(base.accentColor, PR);

    const scale = typeof typography?.fontScale === 'number'
      ? Math.min(1.2, Math.max(0.85, typography.fontScale)) : 1;

    return {
      stile,
      colorsAccentExplicit,
      colors: {
        accent,
        text: colorOr(colors?.text, DK),
        muted: colorOr(colors?.muted, GR),
        lightBg: colorOr(colors?.lightBg, LG),
        rowAlt: colorOr(colors?.rowAlt, ROW_ALT),
        headText: colorOr(colors?.headText, [255, 255, 255]),
        totalBarText: colorOr(colors?.totalBarText, [255, 255, 255]),
        divider: colorOr(colors?.divider, DIVIDER),
        noteFill: colorOr(colors?.noteFill, NOTE_FILL),
        noteBorder: colorOr(colors?.noteBorder, NOTE_BORDER),
      },
      fontFamily: typography?.fontFamily ?? 'helvetica',
      fontScale: scale,
      uppercaseSectionTitles: typography?.uppercaseSectionTitles !== false,
      logo: {
        show: logo?.show !== false,
        align: logo?.align ?? 'left',
        size: logo?.size ?? 'M',
      },
      footer: {
        show: footer?.show !== false,
        showRagioneSociale: footer?.showRagioneSociale !== false,
        showPiva: footer?.showPiva !== false,
        showCodFiscale: footer?.showCodFiscale !== false,
        showPec: footer?.showPec !== false,
        showSdi: footer?.showSdi !== false,
        showPageNumber: footer?.showPageNumber !== false,
        customText: footer?.customText ?? '',
      },
      visibility: {
        showIban: visibility?.showIban !== false,
        showRiferimenti: visibility?.showRiferimenti !== false,
      },
      blocks,
      columns: this.resolveColumns(columns),
      sectionsOrder,
      tableTheme,
      margins: {
        left: typeof margins?.left === 'number' ? margins.left : DEFAULT_ML,
        right: typeof margins?.right === 'number' ? margins.right : DEFAULT_ML,
      },
    };
  }

  private resolveColumns(cfg?: TableColumnConfig[]): ResolvedColumn[] {
    const defaults = this.defaultColumns();
    if (!cfg || !cfg.length) return defaults.map(c => ({ ...c }));
    const byKey = new Map(defaults.map(c => [c.key, c]));
    const out: ResolvedColumn[] = [];
    const seen = new Set<ColumnKey>();
    for (const c of cfg) {
      const d = byKey.get(c.key);
      if (!d || seen.has(c.key)) continue;
      seen.add(c.key);
      out.push({
        key: c.key,
        label: c.label ?? d.label,
        width: c.width ?? d.width,
        align: c.align ?? d.align,
        visible: c.visible !== false,
      });
    }
    for (const d of defaults) if (!seen.has(d.key)) out.push({ ...d });
    for (const c of out) if (FORCED_COLUMNS.has(c.key)) c.visible = true;
    return out;
  }

  // margini risolti
  private get ML(): number { return this.resolved.margins.left; }
  private get CW(): number { return PW - this.resolved.margins.left - this.resolved.margins.right; }

  /** Imposta font family + dimensione scalata (sostituisce setFontSize+setFont). */
  private F(doc: jsPDF, pt: number, style: 'normal' | 'bold' | 'italic' = 'normal') {
    doc.setFontSize(pt * this.resolved.fontScale);
    doc.setFont(this.resolved.fontFamily, style);
  }

  // ── Preview / build entry points ────────────────────────────────────────────

  private showPreview(pdf: jsPDF, filename: string) {
    this.dialog.open(PdfPreviewDialogComponent, {
      data: { pdf, filename },
      width: '900px',
      maxWidth: '98vw',
      height: '92vh',
      panelClass: 'pdf-preview-panel',
    });
  }

  /** Anteprima live dell'editor: rende una fattura di esempio con la config passata. */
  async buildSampleBlobUrl(cfg: TemplateConfig, az?: Partial<Azienda>): Promise<string> {
    const azienda = { ...SAMPLE_AZIENDA, ...(az || {}) } as Azienda;
    const pdf = await this.buildFattura(SAMPLE_FATTURA, azienda, cfg);
    return pdf.output('bloburl') as unknown as string;
  }

  private async logoFor(az: Azienda): Promise<{ src: string; fmt: string; w: number; h: number } | null> {
    if (!this.resolved.logo.show) return null;
    return this.resolveLogoInfo(az.logo, this.resolved.logo.size);
  }

  // ── Public print methods (firme invariate: i consumer chiamano printXxx(id)) ─

  printFattura(id: number) {
    forkJoin({ doc: this.ds.getFatturaPrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildFattura(doc, az);
      this.showPreview(pdf, `Fattura_${doc.numero}.pdf`);
    });
  }

  /**
   * Stampa un DDT. `conPrezzi` ribalta per una volta l'impostazione dell'azienda
   * (`templateConfig.ddtPrezzi`) senza cambiarla: serve per il DDT occasionale
   * che va spedito non valorizzato, o viceversa.
   */
  printDdt(id: number, conPrezzi?: boolean) {
    forkJoin({ doc: this.ds.getDdtPrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildDdt(doc, az, conPrezzi ?? (az.templateConfig?.ddtPrezzi !== false));
      this.showPreview(pdf, `DDT_${doc.numero}.pdf`);
    });
  }

  printNotaCredito(id: number) {
    forkJoin({ doc: this.ds.getNotaCreditoPrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildNotaCredito(doc, az);
      this.showPreview(pdf, `NotaCredito_${doc.numero}.pdf`);
    });
  }

  printOrdine(id: number) {
    forkJoin({ doc: this.ds.getOrdinePrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildOrdine(doc, az);
      this.showPreview(pdf, `Ordine_${doc.numero}.pdf`);
    });
  }

  // `override` consente al dialog di anteprimare opzioni non ancora salvate
  // (es. il toggle "mostra immagini") senza dover prima salvare il preventivo.
  printPreventivo(id: number, override?: Record<string, any>) {
    forkJoin({ doc: this.ds.getPreventivoePrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildPreventivo({ ...doc, ...(override || {}) }, az);
      this.showPreview(pdf, `Preventivo_${doc.numero}.pdf`);
    });
  }

  printDocumentale(id: number) {
    forkJoin({ doc: this.ds.getVenditaBancoPrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildDocumentale(doc, az);
      this.showPreview(pdf, `DocumentoCommerciale_${doc.numero}.pdf`);
    });
  }

  printAcquisto(id: number) {
    forkJoin({ doc: this.ds.getAcquistoPrint(id), az: this.ds.getAzienda() }).subscribe(async ({ doc, az }) => {
      const pdf = await this.buildAcquisto(doc, az);
      this.showPreview(pdf, `Acquisto_${doc.numero}.pdf`);
    });
  }

  /** Stampa un listino prezzi formattato (tema/colori della grafica documenti). */
  printListino(listino: Listino, prezzi: ListinoPrezzo[], sezioni: ListinoSezione[] = []) {
    this.ds.getAzienda().subscribe(async az => {
      const pdf = await this.buildListino(listino, prezzi, sezioni, az);
      const nomeFile = (listino.nome || 'listino').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'listino';
      this.showPreview(pdf, `Listino_${nomeFile}.pdf`);
    });
  }

  // ── Builders (rendono il PDF senza aprire il dialog) ─────────────────────────

  private async buildFattura(doc: any, az: Azienda, cfg?: TemplateConfig): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(cfg ?? this.getTemplateConfig(az), 'fattura');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.fattura'), '', doc.numero, doc.dataEmissione, logo);
    y = this.runSections(pdf, y, 'fattura', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.venditore'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: this.i18n.t('stampa.parte.cliente'), name: doc.cliente?.ragioneSociale || '—', lines: this.contactLines(doc.cliente) }),
      tabella: (yy) => this.table(pdf, yy, doc.righe || []),
      totali: (yy) => this.totals(pdf, yy, doc),
      pagamento: (yy) => this.payment(pdf, yy, doc, az),
      riferimenti: (yy) => (this.resolved.visibility.showRiferimenti && doc.riferimenti?.length) ? this.riferimentiBox(pdf, yy, doc.riferimenti) : yy,
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildDdt(doc: any, az: Azienda, conPrezzi = true): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'ddt');
    if (!conPrezzi) {
      // DDT non valorizzato: via le colonne che parlano di soldi. Restano
      // codice, descrizione, quantità e unità di misura, che è quello che serve
      // a chi riceve per controllare la merce.
      const soldi = ['prezzo', 'sconto', 'iva', 'importo'];
      this.resolved = {
        ...this.resolved,
        columns: this.resolved.columns.map(c => (soldi.includes(c.key) ? { ...c, visible: false } : c)),
      };
    }
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const isReso = doc.tipo === 'FORNITORE';
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.ddt'), isReso ? this.i18n.t('stampa.tipo.ddtResoSottotitolo') : this.i18n.t('stampa.tipo.ddtSottotitolo'), doc.numero, doc.dataEmissione, logo);
    y = this.runSections(pdf, y, 'ddt', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.mittente'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: isReso ? this.i18n.t('stampa.parte.destinatarioFornitore') : this.i18n.t('stampa.parte.destinatario'), name: doc.cliente?.ragioneSociale || '—', lines: this.ddtDestLines(doc) }),
      trasporto: (yy) => this.trasporto(pdf, yy, doc),
      tabella: (yy) => this.table(pdf, yy, doc.righe || []),
      // Senza prezzi non ha senso stampare i totali: sarebbero l'unico importo
      // rimasto sul foglio.
      totali: (yy) => (conPrezzi ? this.totals(pdf, yy, doc) : yy),
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
      firme: (yy) => this.signatures(pdf, yy),
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildNotaCredito(doc: any, az: Azienda): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'notaCredito');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.notaCredito'), doc.fatturaNumeroColl ? `${this.i18n.t('stampa.tipo.notaCreditoRif')} ${doc.fatturaNumeroColl}` : '', doc.numero, doc.dataEmissione, logo);
    y = this.runSections(pdf, y, 'notaCredito', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.emittente'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: this.i18n.t('stampa.parte.cliente'), name: doc.cliente?.ragioneSociale || '—', lines: this.contactLines(doc.cliente) }),
      tabella: (yy) => this.table(pdf, yy, doc.righe || []),
      totali: (yy) => this.totals(pdf, yy, doc),
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildOrdine(doc: any, az: Azienda): Promise<jsPDF> {
    const isCliente = doc.tipo === 'CLIENTE';
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), isCliente ? 'ordineCliente' : 'ordineFornitore');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.ordine'), isCliente ? this.i18n.t('stampa.tipo.ordineCliente') : this.i18n.t('stampa.tipo.ordineFornitore'), doc.numero, doc.dataOrdine, logo);
    y = this.runSections(pdf, y, isCliente ? 'ordineCliente' : 'ordineFornitore', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: isCliente ? this.i18n.t('stampa.parte.venditore') : this.i18n.t('stampa.parte.acquirente'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: isCliente ? this.i18n.t('stampa.parte.cliente') : this.i18n.t('stampa.parte.fornitore'), name: (isCliente ? doc.cliente?.ragioneSociale : doc.fornitore?.ragioneSociale) || '—', lines: this.contactLines(isCliente ? doc.cliente : doc.fornitore) }),
      tabella: (yy) => isCliente ? this.table(pdf, yy, doc.righe || []) : this.tableOrdineFornitore(pdf, yy, doc.righe || []),
      totali: (yy) => isCliente ? this.totals(pdf, yy, doc) : yy,
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildPreventivo(doc: any, az: Azienda): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'preventivo');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    // Miniature dei prodotti accanto al codice. Controllo per-documento (toggle nel
    // dialog preventivo), con il blocco globale di Impostazioni → Stampa come
    // interruttore generale. Mostra le immagini solo se entrambi attivi.
    const immagini = (doc.stampaImmagini !== false && this.blockVisible('immaginiPreventivo'))
      ? await this.loadRigheImmagini(doc.righe || [])
      : undefined;
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.preventivo'), `${this.i18n.t('stampa.tipo.validita')}: ${doc.validita || 30} ${this.i18n.t('stampa.tipo.giorni')}`, doc.numero, doc.dataEmissione, logo);
    y = this.runSections(pdf, y, 'preventivo', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.emittente'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: this.i18n.t('stampa.parte.cliente'), name: doc.cliente?.ragioneSociale || '—', lines: this.contactLines(doc.cliente) }),
      tabella: (yy) => this.table(pdf, yy, doc.righe || [], immagini),
      totali: (yy) => this.totals(pdf, yy, doc),
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildDocumentale(doc: any, az: Azienda): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'documentoCommerciale');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.documentoCommerciale'), `${this.i18n.t('stampa.tipo.pagamento')}: ${doc.metodoPagamento || 'CONTANTI'}`, doc.numero, doc.data, logo);
    y = this.runSections(pdf, y, 'documentoCommerciale', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.venditore'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: this.i18n.t('stampa.parte.cliente'), name: doc.clienteNome || this.i18n.t('stampa.parte.clienteAlBanco'), lines: [] }),
      tabella: (yy) => this.table(pdf, yy, doc.righe || []),
      totali: (yy) => this.totals(pdf, yy, doc),
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildAcquisto(doc: any, az: Azienda): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'acquisto');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    let y = this.doHdr(pdf, az, this.i18n.t('stampa.tipo.acquisto'), '', doc.numero, doc.dataEmissione, logo);
    y = this.runSections(pdf, y, 'acquisto', {
      parti: (yy) => this.doParties(pdf, yy,
        { lbl: this.i18n.t('stampa.parte.acquirente'), name: az.ragioneSociale || '', lines: this.azLines(az) },
        { lbl: this.i18n.t('stampa.parte.fornitore'), name: doc.fornitore?.ragioneSociale || '—', lines: this.contactLines(doc.fornitore) }),
      tabella: (yy) => this.table(pdf, yy, doc.righe || []),
      totali: (yy) => this.totals(pdf, yy, doc),
      pagamento: (yy) => this.payment(pdf, yy, doc, az),
      note: (yy) => doc.note ? this.noteBox(pdf, yy, doc.note) : yy,
    });
    this.footer(pdf, az);
    return pdf;
  }

  private async buildListino(listino: Listino, prezzi: ListinoPrezzo[], sezioni: ListinoSezione[], az: Azienda): Promise<jsPDF> {
    this.resolved = this.normalizeConfig(this.getTemplateConfig(az), 'fattura');
    const logo = await this.logoFor(az);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const C = this.resolved.colors;
    const fs = this.resolved.fontScale;
    const oggi = new Date().toISOString().slice(0, 10);

    // Tema del listino: palette dedicata per testata, intestazioni e righe;
    // assente = si seguono i colori della grafica documenti.
    const tema = LISTINI_TEMI.find(t => t.key === (listino.tema || '')) || null;
    const accent: RGB | undefined = tema?.accent;
    const headFill: RGB = tema ? tema.headFill : this.tableHeadFill();
    const headText: RGB = tema ? tema.headText : this.tableHeadText();
    const rowAlt: RGB = tema ? tema.rowAlt : C.rowAlt;

    let y = this.hdrListino(pdf, az, listino.nome || '', oggi, logo, accent);

    if (listino.descrizione) {
      this.F(pdf, 9, 'normal'); pdf.setTextColor(...C.muted);
      const lines = pdf.splitTextToSize(listino.descrizione, this.CW);
      pdf.text(lines, this.ML, y + 2);
      y += lines.length * 4.2 + 5;
    }

    // Colonne guidate dalla config unificata del listino (standard + extra in un
    // unico ordine, tutte rinominabili/nascondibili). Layout opzionale affiancato.
    const due = !!listino.stampaDueColonne;
    const cfg = mergeColonneCfg(listino).filter(c => c.visibile);

    interface ColDef { label: string; width: number | 'auto'; halign?: 'center' | 'right'; val: (p: ListinoPrezzo, n: number) => string | number; }
    const defs: ColDef[] = cfg.map(c => {
      if (c.tipo === 'extra') {
        return { label: c.label, width: 'auto' as const, val: (p: ListinoPrezzo) => p.datiExtra?.[c.key] ?? '' };
      }
      switch (c.key as ListinoColonnaStdKey) {
        case 'num': return { label: c.label, width: due ? 7 : 9, halign: 'center' as const, val: (_p: ListinoPrezzo, n: number) => n };
        case 'codice': return { label: c.label, width: due ? 16 : 24, val: (p: ListinoPrezzo) => p.prodottoCodice || '—' };
        case 'dimensioni': return { label: c.label, width: due ? 18 : 26, val: (p: ListinoPrezzo) => p.prodottoDimensioni || '—' };
        case 'peso': return { label: c.label, width: due ? 12 : 16, halign: 'right' as const, val: (p: ListinoPrezzo) => p.prodottoPeso != null ? `${p.prodottoPeso} kg` : '—' };
        case 'prezzoBase': return { label: c.label, width: due ? 16 : 20, halign: 'right' as const, val: (p: ListinoPrezzo) => this.fe(p.prodottoPrezzoBase || 0) };
        case 'sconto': return {
          label: c.label, width: due ? 11 : 14, halign: 'right' as const,
          val: (p: ListinoPrezzo) => {
            const s = p.prezzo != null ? 0 : (p.sconto != null ? p.sconto : (listino.scontoDefault || 0));
            return s > 0 ? `${s}%` : '—';
          },
        };
        case 'prezzo': return { label: c.label, width: due ? 18 : 24, halign: 'right' as const, val: (p: ListinoPrezzo) => this.fe(this.prezzoListino(p, listino)) };
        default: return { label: c.label, width: 'auto' as const, val: (p: ListinoPrezzo) => p.prodottoNome || '' }; // 'prodotto'
      }
    });

    // Sequenza mista prodotti + sezioni (stesso ordinamento dell'editor)
    type RigaMista = { tipo: 'sezione' | 'prezzo'; nome?: string; p?: ListinoPrezzo; ordine: number; id: number };
    const merged: RigaMista[] = [
      ...(sezioni || []).map(s => ({ tipo: 'sezione' as const, nome: s.nome, ordine: s.ordine || 0, id: s.id || 0 })),
      ...prezzi.map(p => ({ tipo: 'prezzo' as const, p, ordine: p.ordine || 0, id: p.id || 0 })),
    ].sort((a, b) => (a.ordine - b.ordine)
      || (a.tipo !== b.tipo ? (a.tipo === 'sezione' ? -1 : 1) : a.id - b.id));

    const half = defs.length; // indice della colonna distanziatrice nel layout affiancato
    const totalCols = due ? defs.length * 2 + 1 : defs.length;
    const sezRow = (nome: string) => [{
      content: nome,
      colSpan: totalCols,
      styles: {
        fontStyle: 'bold' as const,
        fillColor: tema ? tema.rowAlt : C.lightBg,
        textColor: tema ? tema.accent : C.text,
        fontSize: (due ? 8.5 : 9.5) * fs,
      },
    }];
    // Stili: la colonna definisce grassetto/corsivo/allineamento di base,
    // la singola cella può aggiungere i propri (incluso il barrato, disegnato
    // in didDrawCell perché jsPDF non ha un line-through nativo).
    const fontStyleOf = (b?: boolean, i?: boolean): 'normal' | 'bold' | 'italic' | 'bolditalic' =>
      b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : 'normal';
    const cellOf = (p: ListinoPrezzo, n: number, idx: number) => {
      const d = defs[idx];
      const col = cfg[idx];
      const v = d.val(p, n);
      const st = p.stili?.[col.key];
      if (!st) return v;
      const styles: any = {};
      const fsty = fontStyleOf(st.b || col.bold, st.i || col.italic);
      if (fsty !== 'normal') styles.fontStyle = fsty;
      if (st.al) styles.halign = st.al;
      return { content: v, styles, _strike: !!st.s };
    };
    const rowOf = (p: ListinoPrezzo, n: number) => defs.map((_d, idx) => cellOf(p, n, idx));
    const vuota = () => defs.map(() => '');

    let head: (string | number)[];
    const body: any[][] = [];
    let n = 0;
    if (due) {
      // Due tabelle affiancate = colonne raddoppiate in un'unica autoTable, con
      // colonna vuota in mezzo da separatore. I prodotti vengono appaiati DENTRO
      // ogni sezione; le righe sezione attraversano tutta la pagina.
      head = [...defs.map(d => d.label), '', ...defs.map(d => d.label)];
      let buf: any[][] = [];
      const flush = () => {
        for (let i = 0; i < buf.length; i += 2) {
          body.push([...buf[i], '', ...(buf[i + 1] || vuota())]);
        }
        buf = [];
      };
      for (const r of merged) {
        if (r.tipo === 'sezione') { flush(); body.push(sezRow(r.nome!)); }
        else { n++; buf.push(rowOf(r.p!, n)); }
      }
      flush();
    } else {
      head = defs.map(d => d.label);
      for (const r of merged) {
        if (r.tipo === 'sezione') body.push(sezRow(r.nome!));
        else { n++; body.push(rowOf(r.p!, n)); }
      }
    }

    const columnStyles: any = {};
    // Allineamento intestazioni: columnStyles.halign vale solo per il corpo,
    // quindi le testate vengono allineate a parte (in didParseCell).
    const headAligns: Record<number, 'left' | 'center' | 'right'> = {};
    defs.forEach((d, i) => {
      const col = cfg[i];
      const halign = col.align || d.halign;
      const fsty = fontStyleOf(col.bold, col.italic);
      const style = {
        cellWidth: d.width,
        ...(halign ? { halign } : {}),
        ...(fsty !== 'normal' ? { fontStyle: fsty } : {}),
      };
      columnStyles[i] = style;
      if (halign) headAligns[i] = halign;
      if (due) {
        columnStyles[i + half + 1] = { ...style };
        if (halign) headAligns[i + half + 1] = halign;
      }
    });
    if (due) columnStyles[half] = { cellWidth: 4 };

    autoTable(pdf, {
      startY: y,
      head: [head],
      body,
      // Il toggle "Griglia" del listino forza i bordi colonna; altrimenti vale
      // il tema del listino, e in sua assenza la grafica documenti.
      theme: listino.griglia ? 'grid' : (tema?.tableTheme ?? this.resolved.tableTheme),
      styles: { font: this.resolved.fontFamily },
      headStyles: { fillColor: headFill, textColor: headText, fontStyle: 'bold', fontSize: (due ? 8 : 9) * fs },
      bodyStyles: { fontSize: (due ? 8 : 9) * fs, textColor: C.text },
      alternateRowStyles: { fillColor: rowAlt },
      columnStyles,
      margin: { left: this.ML, right: this.ML },
      didParseCell: (data) => {
        if (due && data.column.index === half) {
          data.cell.styles.fillColor = [255, 255, 255];
          data.cell.styles.lineWidth = 0;
        }
        if (data.section === 'head' && headAligns[data.column.index]) {
          data.cell.styles.halign = headAligns[data.column.index];
        }
      },
      // Barrato: disegnato a mano sopra il testo delle celle marcate _strike
      didDrawCell: (data: any) => {
        const raw = data.cell?.raw;
        if (data.section !== 'body' || !raw || typeof raw !== 'object' || !raw._strike) return;
        const cell = data.cell;
        const txt = Array.isArray(cell.text) ? (cell.text[0] || '') : String(cell.text ?? '');
        if (!txt) return;
        const d2 = data.doc;
        d2.setFont(this.resolved.fontFamily, cell.styles.fontStyle || 'normal');
        d2.setFontSize(cell.styles.fontSize);
        const padL = cell.padding('left');
        const padR = cell.padding('right');
        const tw = Math.min(d2.getTextWidth(txt), cell.width - padL - padR);
        let x = cell.x + padL;
        if (cell.styles.halign === 'center') x = cell.x + (cell.width - tw) / 2;
        else if (cell.styles.halign === 'right') x = cell.x + cell.width - padR - tw;
        const yMid = cell.y + cell.height / 2;
        d2.setDrawColor(...C.text);
        d2.setLineWidth(0.3);
        d2.line(x, yMid, x + tw, yMid);
      },
    });
    y = (pdf as any).lastAutoTable.finalY + 5;

    this.F(pdf, 8, 'italic'); pdf.setTextColor(...C.muted);
    pdf.text(this.i18n.t('stampa.listino.notaPrezzi'), this.ML, y);

    this.footer(pdf, az);
    return pdf;
  }

  /** Prezzo finale di una riga di listino: override manuale, altrimenti base scontata. */
  private prezzoListino(p: ListinoPrezzo, l: Listino): number {
    if (p.prezzo != null) return p.prezzo;
    const base = p.prodottoPrezzoBase || 0;
    const sconto = p.sconto != null ? p.sconto : (l.scontoDefault || 0);
    return Math.round(base * (1 - sconto / 100) * 100) / 100;
  }

  /** Header del listino: senza "N./Del", adattato ai tre stili della grafica
   *  documenti; accentOverride = colore del tema scelto per il listino. */
  private hdrListino(doc: jsPDF, az: Azienda, titolo: string, dataStr: string, logo: any, accentOverride?: RGB): number {
    const C = this.resolved.colors;

    if (this.resolved.stile === 'moderno') {
      const ac = accentOverride ?? this.ac();
      const bandH = 36;
      doc.setFillColor(...ac);
      doc.rect(0, 0, PW, bandH, 'F');
      const a = this.hdrAnchors(logo, 5);
      if (logo) {
        try { doc.addImage(logo.src, logo.fmt, a.logoX, (bandH - logo.h) / 2, logo.w, logo.h); } catch (_) {}
      }
      this.F(doc, 12, 'bold'); doc.setTextColor(255, 255, 255);
      doc.text(az.ragioneSociale || '', a.textX, 13, { align: a.textAlign });
      this.F(doc, 7.5, 'normal'); doc.setTextColor(215, 220, 255);
      let iy = 19;
      for (const line of this.azInfoLines(az).slice(0, 2)) { doc.text(line, a.textX, iy, { align: a.textAlign }); iy += 4.2; }
      this.F(doc, 20, 'bold'); doc.setTextColor(255, 255, 255);
      doc.text(this.i18n.t('stampa.tipo.listino'), a.titleX, 13, { align: a.titleAlign });
      this.F(doc, 10, 'bold');
      doc.text(titolo, a.titleX, 20, { align: a.titleAlign });
      this.F(doc, 8, 'normal'); doc.setTextColor(215, 220, 255);
      doc.text(`${this.i18n.t('stampa.aggiornatoAl')} ${this.fd(dataStr)}`, a.titleX, 25, { align: a.titleAlign });
      return bandH + 6;
    }

    const minimal = this.resolved.stile === 'minimal';
    const topY = this.ML;
    const a = this.hdrAnchors(logo, minimal ? 5 : 4);
    if (logo) {
      try { doc.addImage(logo.src, logo.fmt, a.logoX, topY, logo.w, logo.h); } catch (_) {}
    }
    const baseY = (a.stacked && logo) ? topY + logo.h + 3 : topY;

    this.F(doc, minimal ? 10 : 13, 'bold'); doc.setTextColor(...C.text);
    doc.text(az.ragioneSociale || '', a.textX, baseY + (minimal ? 6 : 7), { align: a.textAlign });

    const infoLines = this.azInfoLines(az, !minimal);
    this.F(doc, minimal ? 7.5 : 8, 'normal'); doc.setTextColor(...C.muted);
    let iy = baseY + (minimal ? 11 : 12);
    for (const line of infoLines) { doc.text(line, a.textX, iy, { align: a.textAlign }); iy += 4; }

    if (minimal) { this.F(doc, 30, 'bold'); doc.setTextColor(...WM); }
    else { this.F(doc, 22, 'bold'); doc.setTextColor(...(accentOverride ?? this.ac())); }
    doc.text(this.i18n.t('stampa.tipo.listino'), a.titleX, baseY + (minimal ? 17 : 8), { align: a.titleAlign });

    this.F(doc, 10, 'bold'); doc.setTextColor(...C.text);
    doc.text(titolo, a.titleX, baseY + (minimal ? 24 : 15), { align: a.titleAlign });
    this.F(doc, 9, 'normal'); doc.setTextColor(...C.muted);
    doc.text(`${this.i18n.t('stampa.aggiornatoAl')} ${this.fd(dataStr)}`, a.titleX, baseY + (minimal ? 29 : 20), { align: a.titleAlign });

    const yy = Math.max(iy, baseY + (minimal ? 30 : 28)) + 2;
    if (minimal) { doc.setDrawColor(...MIN_DIV); doc.setLineWidth(0.25); }
    else { doc.setDrawColor(...(accentOverride ?? this.ac())); doc.setLineWidth(0.7); }
    doc.line(this.ML, yy, PW - this.ML, yy);
    return yy + (minimal ? 5 : 6);
  }

  // ── Section dispatcher ───────────────────────────────────────────────────────

  private effectiveOrder(docType: DocType): SectionKey[] {
    const def = DEFAULT_ORDER[docType];
    const custom = this.resolved.sectionsOrder;
    if (!custom || !custom.length) return def;
    // Permuta SOLO le sezioni riordinate dall'utente, lasciando quelle specifiche
    // del documento (es. trasporto/firme nel DDT) nei loro slot di default.
    const movable = custom.filter(k => def.includes(k));
    if (!movable.length) return def;
    const movableSet = new Set(movable);
    let mi = 0;
    return def.map(k => (movableSet.has(k) ? movable[mi++] : k));
  }

  private runSections(pdf: jsPDF, y: number, docType: DocType, renderers: Partial<Record<SectionKey, (y: number) => number>>): number {
    for (const k of this.effectiveOrder(docType)) {
      const fn = renderers[k];
      if (!fn) continue;
      if (!this.blockVisible(k)) continue; // riferimenti non è un block ⇒ sempre true (gate nel renderer)
      y = fn(y);
    }
    return y;
  }

  // ── Theme getters ────────────────────────────────────────────────────────────

  private ac(): RGB { return this.resolved.colors.accent; }

  private blockVisible(block: string): boolean {
    return this.resolved.blocks[block] !== false;
  }

  // Usa l'accent per intestazioni/barre se NON minimal, oppure se in minimal è stato scelto un accent esplicito.
  private get useAccentChrome(): boolean {
    return this.resolved.stile !== 'minimal' || this.resolved.colorsAccentExplicit;
  }

  private tableHeadFill(): RGB { return this.useAccentChrome ? this.resolved.colors.accent : this.resolved.colors.lightBg; }
  private tableHeadText(): RGB { return this.useAccentChrome ? this.resolved.colors.headText : this.resolved.colors.text; }
  private totalBarColor(): RGB { return this.useAccentChrome ? this.resolved.colors.accent : SLATE; }
  private secTitleColor(): RGB { return this.useAccentChrome ? this.resolved.colors.accent : this.resolved.colors.muted; }

  // ── Header dispatch ────────────────────────────────────────────────────────

  private doHdr(doc: jsPDF, az: Azienda, type: string, subtitle: string, numero: string, data: string, logo: any): number {
    if (this.resolved.stile === 'moderno') return this.hdrModerno(doc, az, type, subtitle, numero, data, logo);
    if (this.resolved.stile === 'minimal') return this.hdrMinimal(doc, az, type, subtitle, numero, data, logo);
    return this.hdrClassico(doc, az, type, subtitle, numero, data, logo);
  }

  private doParties(doc: jsPDF, y: number, left: { lbl: string; name: string; lines: string[] }, right: { lbl: string; name: string; lines: string[] }): number {
    if (this.resolved.stile === 'moderno') return this.partiesModerno(doc, y, left, right);
    if (this.resolved.stile === 'minimal') return this.partiesMinimal(doc, y, left, right);
    return this.partiesClassico(doc, y, left, right);
  }

  /**
   * Posizioni di header in base all'allineamento del logo, così che nulla si
   * sovrapponga: il blocco titolo va sul lato OPPOSTO al logo (mirror sinistra/destra);
   * 'center' impila il logo su una riga propria e mette il contenuto sotto (stacked).
   * Con logo a sinistra (default) i valori riproducono il layout storico.
   */
  private hdrAnchors(logo: any, gap: number): {
    logoX: number; textX: number; textAlign: 'left' | 'right';
    titleX: number; titleAlign: 'left' | 'right'; stacked: boolean;
  } {
    const align = logo ? this.resolved.logo.align : 'left';
    const lw = logo ? logo.w : 0;
    if (align === 'right' && logo) {
      return { logoX: PW - this.ML - lw, textX: PW - this.ML - lw - gap, textAlign: 'right', titleX: this.ML, titleAlign: 'left', stacked: false };
    }
    if (align === 'center' && logo) {
      return { logoX: (PW - lw) / 2, textX: this.ML, textAlign: 'left', titleX: PW - this.ML, titleAlign: 'right', stacked: true };
    }
    return { logoX: this.ML, textX: this.ML + (lw ? lw + gap : 0), textAlign: 'left', titleX: PW - this.ML, titleAlign: 'right', stacked: false };
  }

  // ── Classico header / parties ──────────────────────────────────────────────

  private hdrClassico(doc: jsPDF, az: Azienda, type: string, subtitle: string, numero: string, data: string, logo: any): number {
    const C = this.resolved.colors;
    const topY = this.ML;
    const a = this.hdrAnchors(logo, 4);

    if (logo) {
      try { doc.addImage(logo.src, logo.fmt, a.logoX, topY, logo.w, logo.h); } catch (_) {}
    }
    const baseY = (a.stacked && logo) ? topY + logo.h + 3 : topY;

    this.F(doc, 13, 'bold'); doc.setTextColor(...C.text);
    doc.text(az.ragioneSociale || '', a.textX, baseY + 7, { align: a.textAlign });

    const infoLines = this.azInfoLines(az, true);
    this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
    let iy = baseY + 12;
    for (const line of infoLines) { doc.text(line, a.textX, iy, { align: a.textAlign }); iy += 4; }

    const ac = this.ac();
    this.F(doc, 22, 'bold'); doc.setTextColor(...ac);
    doc.text(type, a.titleX, baseY + 8, { align: a.titleAlign });

    if (subtitle) {
      this.F(doc, 9, 'normal'); doc.setTextColor(...C.muted);
      doc.text(subtitle, a.titleX, baseY + 14, { align: a.titleAlign });
    }

    const metaY = subtitle ? 20 : 15;
    this.F(doc, 10, 'normal'); doc.setTextColor(...C.text);
    doc.text(`${this.i18n.t('stampa.numero')} ${numero}`, a.titleX, baseY + metaY, { align: a.titleAlign });
    doc.text(`${this.i18n.t('stampa.del')} ${this.fd(data)}`, a.titleX, baseY + metaY + 5, { align: a.titleAlign });

    const yy = Math.max(iy, baseY + 28) + 2;
    doc.setDrawColor(...ac); doc.setLineWidth(0.7);
    doc.line(this.ML, yy, PW - this.ML, yy);
    return yy + 6;
  }

  private partiesClassico(doc: jsPDF, y: number, left: { lbl: string; name: string; lines: string[] }, right: { lbl: string; name: string; lines: string[] }): number {
    const C = this.resolved.colors;
    const bw = (this.CW / 2) - 3;
    const bh = Math.max(24 + left.lines.length * 4.2, 24 + right.lines.length * 4.2, 26);
    doc.setFillColor(...C.lightBg);
    doc.roundedRect(this.ML, y, bw, bh, 2, 2, 'F');
    doc.roundedRect(this.ML + bw + 6, y, bw, bh, 2, 2, 'F');

    const ac = this.ac();
    const draw = (x: number, p: { lbl: string; name: string; lines: string[] }) => {
      this.F(doc, 7.5, 'bold'); doc.setTextColor(...ac);
      doc.text(p.lbl, x + 4, y + 6);
      this.F(doc, 10, 'bold'); doc.setTextColor(...C.text);
      doc.text(p.name, x + 4, y + 12);
      this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
      let ly = y + 17;
      for (const line of p.lines) { if (line) { doc.text(line, x + 4, ly); ly += 4.2; } }
    };

    draw(this.ML, left);
    draw(this.ML + bw + 6, right);
    return y + bh + 6;
  }

  // ── Moderno header / parties ───────────────────────────────────────────────

  private hdrModerno(doc: jsPDF, az: Azienda, type: string, subtitle: string, numero: string, data: string, logo: any): number {
    const ac = this.ac();
    const bandH = 36;

    doc.setFillColor(...ac);
    doc.rect(0, 0, PW, bandH, 'F');

    const a = this.hdrAnchors(logo, 5);
    if (logo) {
      try {
        const logoY = (bandH - logo.h) / 2;
        doc.addImage(logo.src, logo.fmt, a.logoX, logoY, logo.w, logo.h);
      } catch (_) {}
    }

    this.F(doc, 12, 'bold'); doc.setTextColor(255, 255, 255);
    doc.text(az.ragioneSociale || '', a.textX, 13, { align: a.textAlign });

    const infoLines = this.azInfoLines(az);
    this.F(doc, 7.5, 'normal'); doc.setTextColor(215, 220, 255);
    let iy = 19;
    for (const line of infoLines.slice(0, 2)) { doc.text(line, a.textX, iy, { align: a.textAlign }); iy += 4.2; }

    this.F(doc, 20, 'bold'); doc.setTextColor(255, 255, 255);
    doc.text(type, a.titleX, 13, { align: a.titleAlign });

    if (subtitle) {
      this.F(doc, 8, 'normal'); doc.setTextColor(215, 220, 255);
      doc.text(subtitle, a.titleX, 19, { align: a.titleAlign });
    }

    const metaBase = subtitle ? 24 : 20;
    this.F(doc, 9, 'normal'); doc.setTextColor(255, 255, 255);
    doc.text(`${this.i18n.t('stampa.numero')} ${numero}`, a.titleX, metaBase, { align: a.titleAlign });
    doc.text(`${this.i18n.t('stampa.del')} ${this.fd(data)}`, a.titleX, metaBase + 5, { align: a.titleAlign });
    return bandH + 6;
  }

  private partiesModerno(doc: jsPDF, y: number, left: { lbl: string; name: string; lines: string[] }, right: { lbl: string; name: string; lines: string[] }): number {
    const C = this.resolved.colors;
    const ac = this.ac();
    const bw = (this.CW / 2) - 3;
    const bh = Math.max(20 + left.lines.length * 4.2, 20 + right.lines.length * 4.2, 24);

    const draw = (x: number, p: { lbl: string; name: string; lines: string[] }) => {
      doc.setDrawColor(...ac); doc.setLineWidth(1.5);
      doc.line(x, y, x + bw, y);

      this.F(doc, 7.5, 'bold'); doc.setTextColor(...ac);
      doc.text(p.lbl, x + 2, y + 7);
      this.F(doc, 10, 'bold'); doc.setTextColor(...C.text);
      doc.text(p.name, x + 2, y + 13);
      this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
      let ly = y + 18;
      for (const line of p.lines) { if (line) { doc.text(line, x + 2, ly); ly += 4.2; } }
    };

    draw(this.ML, left);
    draw(this.ML + bw + 6, right);
    return y + bh + 6;
  }

  // ── Minimal header / parties ───────────────────────────────────────────────

  private hdrMinimal(doc: jsPDF, az: Azienda, type: string, subtitle: string, numero: string, data: string, logo: any): number {
    const C = this.resolved.colors;
    const topY = this.ML;
    const a = this.hdrAnchors(logo, 5);

    if (logo) {
      try { doc.addImage(logo.src, logo.fmt, a.logoX, topY, logo.w, logo.h); } catch (_) {}
    }
    const baseY = (a.stacked && logo) ? topY + logo.h + 3 : topY;

    this.F(doc, 10, 'bold'); doc.setTextColor(...C.text);
    doc.text(az.ragioneSociale || '', a.textX, baseY + 6, { align: a.textAlign });

    const infoLines = this.azInfoLines(az);
    this.F(doc, 7.5, 'normal'); doc.setTextColor(...C.muted);
    let iy = baseY + 11;
    for (const line of infoLines) { doc.text(line, a.textX, iy, { align: a.textAlign }); iy += 4; }

    // Large watermark-style doc type (lato opposto al logo)
    this.F(doc, 30, 'bold'); doc.setTextColor(...WM);
    doc.text(type, a.titleX, baseY + 17, { align: a.titleAlign });

    if (subtitle) {
      this.F(doc, 8.5, 'normal'); doc.setTextColor(...C.muted);
      doc.text(subtitle, a.titleX, baseY + 23, { align: a.titleAlign });
    }
    const metaY = subtitle ? 28 : 23;
    this.F(doc, 9, 'normal'); doc.setTextColor(...C.text);
    doc.text(`${this.i18n.t('stampa.numero')} ${numero}`, a.titleX, baseY + metaY, { align: a.titleAlign });
    doc.text(`${this.i18n.t('stampa.del')} ${this.fd(data)}`, a.titleX, baseY + metaY + 5, { align: a.titleAlign });

    const yy = Math.max(iy, baseY + 30) + 2;
    doc.setDrawColor(...MIN_DIV); doc.setLineWidth(0.25);
    doc.line(this.ML, yy, PW - this.ML, yy);
    return yy + 5;
  }

  private partiesMinimal(doc: jsPDF, y: number, left: { lbl: string; name: string; lines: string[] }, right: { lbl: string; name: string; lines: string[] }): number {
    const C = this.resolved.colors;
    const bw = (this.CW / 2) - 3;
    const bh = Math.max(20 + left.lines.length * 4.2, 20 + right.lines.length * 4.2, 24);

    const draw = (x: number, p: { lbl: string; name: string; lines: string[] }) => {
      this.F(doc, 7, 'bold'); doc.setTextColor(...C.muted);
      doc.text(p.lbl, x, y + 5);
      this.F(doc, 10, 'bold'); doc.setTextColor(...C.text);
      doc.text(p.name, x, y + 11);
      this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
      let ly = y + 16;
      for (const line of p.lines) { if (line) { doc.text(line, x, ly); ly += 4.2; } }
    };

    draw(this.ML, left);
    draw(this.ML + bw + 6, right);
    return y + bh + 6;
  }

  // ── Logo ───────────────────────────────────────────────────────────────────

  private async resolveLogoInfo(logo: string | undefined, size: 'S' | 'M' | 'L'): Promise<{ src: string; fmt: string; w: number; h: number } | null> {
    if (!logo) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const { w: maxW, h: maxH } = LOGO_SIZES[size] || LOGO_SIZES.M;
        const ratio = img.naturalWidth / img.naturalHeight;
        let w = maxW, h = maxW / ratio;
        if (h > maxH) { h = maxH; w = maxH * ratio; }
        const fmt = logo.startsWith('data:image/png') ? 'PNG'
          : logo.startsWith('data:image/gif') ? 'GIF' : 'JPEG';
        resolve({ src: logo, fmt, w, h });
      };
      img.onerror = () => resolve(null);
      img.src = logo;
    });
  }

  // ── Table (data-driven columns) ──────────────────────────────────────────────

  private cellValue(key: ColumnKey, r: any, rowNum: number): any {
    const imp = (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
    const descText = r.codiceProdotto ? `[${r.codiceProdotto}]  ${r.descrizione || ''}` : (r.descrizione || '');
    switch (key) {
      case 'num': return rowNum;
      case 'codiceDescrizione': return descText;
      case 'quantita': return r.quantita ?? '';
      case 'um': return r.unitaMisura || '';
      case 'prezzo': return r.prezzo ? this.fe(r.prezzo) : '—';
      case 'sconto': return r.sconto ? r.sconto + '%' : '—';
      case 'iva': return r.iva + '%';
      case 'importo': return imp ? this.fe(imp) : '—';
    }
  }

  private table(doc: jsPDF, y: number, righe: any[], immagini?: Map<number, RigaImg>): number {
    const C = this.resolved.colors;
    const fs = this.resolved.fontScale;
    const cols = this.resolved.columns.filter(c => c.visible);
    // Colonna miniatura accanto al codice, solo se almeno una riga ha un'immagine.
    const showImg = !!immagini && righe.some(r => r.tipo !== 'NOTA' && r.prodottoId && immagini.get(r.prodottoId));
    const imgColW = 16, imgH = 13;
    const rowImg: (RigaImg | null)[] = [];
    let rowNum = 0;
    const body = righe.map(r => {
      if (r.tipo === 'NOTA') {
        rowImg.push(null);
        return [{ content: r.descrizione || '', colSpan: cols.length + (showImg ? 1 : 0), styles: { fontStyle: 'italic', textColor: C.muted } }];
      }
      rowNum++;
      const img = showImg && r.prodottoId ? (immagini!.get(r.prodottoId) || null) : null;
      rowImg.push(img);
      const cells: any[] = cols.map(c => this.cellValue(c.key, r, rowNum));
      return showImg ? [{ content: '', styles: img ? { minCellHeight: imgH + 3 } : {} }, ...cells] : cells;
    });
    const off = showImg ? 1 : 0;
    const columnStyles: any = {};
    if (showImg) columnStyles[0] = { cellWidth: imgColW, halign: 'center', valign: 'middle' };
    cols.forEach((c, i) => {
      columnStyles[i + off] = { cellWidth: c.width, ...(c.align !== 'left' ? { halign: c.align } : {}) };
    });
    autoTable(doc, {
      startY: y,
      head: [[...(showImg ? [''] : []), ...cols.map(c => c.label)]],
      body,
      theme: this.resolved.tableTheme,
      styles: { font: this.resolved.fontFamily },
      headStyles: { fillColor: this.tableHeadFill(), textColor: this.tableHeadText(), fontStyle: 'bold', fontSize: 9 * fs },
      bodyStyles: { fontSize: 9 * fs, textColor: C.text },
      alternateRowStyles: { fillColor: C.rowAlt },
      columnStyles,
      margin: { left: this.ML, right: this.ML },
      didDrawCell: showImg ? (data: any) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        const img = rowImg[data.row.index];
        if (!img) return;
        const cell = data.cell, pad = 1.5;
        const boxW = cell.width - pad * 2, boxH = cell.height - pad * 2;
        const k = Math.min(boxW / img.w, boxH / img.h);
        const iw = img.w * k, ih = img.h * k;
        const fmt = img.data.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        try { doc.addImage(img.data, fmt, cell.x + (cell.width - iw) / 2, cell.y + (cell.height - ih) / 2, iw, ih); } catch { /* immagine illeggibile */ }
      } : undefined,
    });
    return (doc as any).lastAutoTable.finalY + 4;
  }

  private tableOrdineFornitore(doc: jsPDF, y: number, righe: any[]): number {
    const C = this.resolved.colors;
    const fs = this.resolved.fontScale;
    let rowNum = 0;
    const body = righe.map(r => {
      if (r.tipo === 'NOTA') {
        return [{ content: r.descrizione || '', colSpan: 5, styles: { fontStyle: 'italic', textColor: C.muted } }];
      }
      rowNum++;
      return [rowNum, r.codiceFornitore || '—', r.descrizione || '', r.quantita ?? '', r.unitaMisura || ''];
    });
    autoTable(doc, {
      startY: y,
      head: [[this.i18n.t('stampa.col.num'), this.i18n.t('stampa.col.vostroCodice'), this.i18n.t('stampa.col.descrizione'), this.i18n.t('stampa.col.quantita'), this.i18n.t('stampa.col.um')]],
      body,
      theme: this.resolved.tableTheme,
      styles: { font: this.resolved.fontFamily },
      headStyles: { fillColor: this.tableHeadFill(), textColor: this.tableHeadText(), fontStyle: 'bold', fontSize: 9 * fs },
      bodyStyles: { fontSize: 9 * fs, textColor: C.text },
      alternateRowStyles: { fillColor: C.rowAlt },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 35 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 14, halign: 'right' },
        4: { cellWidth: 16 },
      },
      margin: { left: this.ML, right: this.ML },
    });
    return (doc as any).lastAutoTable.finalY + 4;
  }

  private totals(doc: jsPDF, y: number, docData: any): number {
    const C = this.resolved.colors;
    const fs = this.resolved.fontScale;
    const righe = docData?.righe || [];
    const ivaMap = new Map<number, { imp: number; iva: number }>();
    let imponibile = 0, ivaRighe = 0;
    for (const r of righe) {
      if (r.tipo === 'NOTA') continue;
      const imp = (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
      const ivaAmt = imp * ((r.iva || 0) / 100);
      imponibile += imp; ivaRighe += ivaAmt;
      const ex = ivaMap.get(r.iva) || { imp: 0, iva: 0 };
      ivaMap.set(r.iva, { imp: ex.imp + imp, iva: ex.iva + ivaAmt });
    }

    // ── Dati fiscali (ritenuta / cassa / bollo): 0 sui documenti che non li hanno
    const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
    const cassaAliq = Number(docData?.cassaAliquota) || 0;
    const cassaImporto = cassaAliq ? r2(imponibile * cassaAliq / 100) : 0;
    const ivaCassa = cassaImporto ? r2(cassaImporto * (Number(docData?.cassaIva) || 0) / 100) : 0;
    const ivaTotal = r2(ivaRighe + ivaCassa);
    const ritAliq = Number(docData?.ritenutaAliquota) || 0;
    const ritenuta = ritAliq ? r2(imponibile * ritAliq / 100) : 0;
    const bollo = docData?.bollo ? 2 : 0;
    const totaleDoc = r2(imponibile + cassaImporto + ivaTotal + bollo);
    const netto = r2(totaleDoc - ritenuta);

    if (ivaMap.size > 1) {
      autoTable(doc, {
        startY: y,
        head: [[this.i18n.t('stampa.totali.aliquota'), this.i18n.t('stampa.totali.imponibile'), this.i18n.t('stampa.col.iva')]],
        body: [...ivaMap.entries()].map(([a, v]) => [`${a}%`, this.fe(v.imp), this.fe(v.iva)]),
        theme: 'plain',
        styles: { font: this.resolved.fontFamily },
        headStyles: { fillColor: C.lightBg, textColor: C.text, fontStyle: 'bold', fontSize: 8 * fs },
        bodyStyles: { fontSize: 8 * fs },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        tableWidth: 80, margin: { left: PW - this.ML - 80 },
      });
      y = (doc as any).lastAutoTable.finalY + 3;
    }

    const tx = PW - this.ML - 70;
    const rows: [string, string][] = [[this.i18n.t('stampa.totali.imponibile'), this.fe(imponibile)]];
    if (cassaImporto > 0) rows.push([this.i18n.t('stampa.totali.contributoCassa'), this.fe(cassaImporto)]);
    rows.push([this.i18n.t('stampa.col.iva'), this.fe(ivaTotal)]);
    if (bollo > 0) rows.push([this.i18n.t('stampa.totali.bollo'), this.fe(bollo)]);
    if (ritenuta > 0) {
      rows.push([this.i18n.t('stampa.totali.totaleDocumento'), this.fe(totaleDoc)]);
      rows.push([this.i18n.t('stampa.totali.ritenuta'), '-' + this.fe(ritenuta)]);
    }
    for (const [lbl, val] of rows) {
      this.F(doc, 9, 'normal'); doc.setTextColor(...C.muted); doc.text(lbl, tx, y);
      doc.setTextColor(...C.text); doc.text(val, PW - this.ML, y, { align: 'right' });
      doc.setDrawColor(...C.divider); doc.setLineWidth(0.2);
      doc.line(tx, y + 1, PW - this.ML, y + 1);
      y += 6;
    }

    doc.setFillColor(...this.totalBarColor());
    doc.rect(tx - 2, y - 3, PW - this.ML - tx + 2, 8, 'F');
    this.F(doc, 11, 'bold'); doc.setTextColor(...C.totalBarText);
    doc.text(ritenuta > 0 ? this.i18n.t('stampa.totali.nettoAPagare') : this.i18n.t('stampa.totali.totale'), tx, y + 2);
    doc.text(this.fe(ritenuta > 0 ? netto : totaleDoc), PW - this.ML, y + 2, { align: 'right' });
    return y + 12;
  }

  private payment(doc: jsPDF, y: number, docData: any, az: Azienda): number {
    const C = this.resolved.colors;
    const fs = this.resolved.fontScale;
    y = this.secTitle(doc, y, this.i18n.t('stampa.pagamento.titolo'));
    this.F(doc, 9, 'normal'); doc.setTextColor(...C.text);
    if (docData.tipoPagamentoNome) { doc.text(`${this.i18n.t('stampa.label.modalita')}: ${docData.tipoPagamentoNome}`, this.ML, y); y += 5; }
    if (this.resolved.visibility.showIban && az.iban) { doc.text(`${this.i18n.t('stampa.label.iban')}: ${az.iban}${az.banca ? ` — ${az.banca}` : ''}`, this.ML, y); y += 5; }

    const pags = docData.pagamenti || [];
    if (pags.length) {
      y += 2; y = this.secTitle(doc, y, this.i18n.t('stampa.pagamento.registrati'));
      autoTable(doc, {
        startY: y,
        head: [[this.i18n.t('stampa.label.data'), this.i18n.t('stampa.label.metodo'), this.i18n.t('stampa.col.importo'), this.i18n.t('stampa.note.titolo')]],
        body: pags.map((p: any) => [this.fd(p.dataPagamento), p.metodo || '—', this.fe(p.importo), p.note || '']),
        theme: 'plain',
        styles: { font: this.resolved.fontFamily },
        headStyles: { fillColor: C.lightBg, textColor: C.text, fontStyle: 'bold', fontSize: 8 * fs },
        bodyStyles: { fontSize: 8 * fs },
        columnStyles: { 2: { halign: 'right' } },
        margin: { left: this.ML, right: this.ML },
      });
      y = (doc as any).lastAutoTable.finalY + 3;
    }
    return y;
  }

  private trasporto(doc: jsPDF, y: number, ddt: any): number {
    const C = this.resolved.colors;
    y = this.secTitle(doc, y, this.i18n.t('stampa.trasporto.titolo'));
    const dest = ddt.destinazioneDiversa || [ddt.cliente?.via, [ddt.cliente?.cap, ddt.cliente?.citta].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const fields: [string, string][] = [
      [this.i18n.t('stampa.trasporto.causale'), ddt.causaleTrasporto], [this.i18n.t('stampa.trasporto.aspettoBeni'), ddt.aspettoBeni],
      [this.i18n.t('stampa.trasporto.porto'), ddt.porto], [this.i18n.t('stampa.trasporto.numeroColli'), ddt.numeroColli ? String(ddt.numeroColli) : ''],
      [this.i18n.t('stampa.trasporto.pesoLordo'), ddt.pesoLordo ? ddt.pesoLordo + ' kg' : ''],
      [this.i18n.t('stampa.trasporto.incaricato'), ddt.incaricatoTrasporto], [this.i18n.t('stampa.trasporto.vettore'), ddt.vettore || ''],
      [this.i18n.t('stampa.trasporto.dataOraInizio'), ddt.dataOraInizioTrasporto ? this.fd(ddt.dataOraInizioTrasporto.substring(0, 10)) + (ddt.dataOraInizioTrasporto.length > 10 ? ' ' + ddt.dataOraInizioTrasporto.substring(11, 16) : '') : ''],
      [this.i18n.t('stampa.trasporto.destinazione'), dest || ''],
    ].filter(([, v]) => v) as [string, string][];

    const hw = this.CW / 2;
    let col = 0, ry = y;
    for (const [lbl, val] of fields) {
      const x = this.ML + col * (hw + 3);
      this.F(doc, 8.5, 'normal'); doc.setTextColor(...C.muted); doc.text(lbl + ':', x, ry);
      this.F(doc, 8.5, 'bold'); doc.setTextColor(...C.text); doc.text(val, x + 36, ry);
      col++; if (col === 2) { col = 0; ry += 5.5; }
    }
    if (col === 1) ry += 5.5;
    if (ddt.noteTrasporto) {
      this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
      doc.text(`${this.i18n.t('stampa.note.titolo')}: ${ddt.noteTrasporto}`, this.ML, ry); ry += 5;
    }
    return ry + 3;
  }

  private signatures(doc: jsPDF, y: number): number {
    const C = this.resolved.colors;
    if (y > 250) { doc.addPage(); y = this.ML; }
    y += 12;
    const sw = (this.CW - 12) / 3;
    for (let i = 0; i < 3; i++) {
      const x = this.ML + i * (sw + 6);
      doc.setDrawColor(...SIGN_LINE); doc.setLineWidth(0.3);
      doc.line(x, y, x + sw, y);
      this.F(doc, 8, 'normal'); doc.setTextColor(...C.muted);
      doc.text([this.i18n.t('stampa.firma.mittente'), this.i18n.t('stampa.firma.vettore'), this.i18n.t('stampa.firma.destinatario')][i], x + sw / 2, y + 4.5, { align: 'center' });
    }
    return y + 10;
  }

  private riferimentiBox(doc: jsPDF, y: number, refs: any[]): number {
    const C = this.resolved.colors;
    const LABEL: Record<string, string> = {
      'ORDINE_ACQUISTO': this.i18n.t('stampa.riferimenti.ordineAcquisto'), 'CONTRATTO': this.i18n.t('stampa.riferimenti.contratto'),
      'CONVENZIONE': this.i18n.t('stampa.riferimenti.convenzione'), 'RICEZIONE': this.i18n.t('stampa.riferimenti.ricezione'),
      'FATTURA_COLLEGATA': this.i18n.t('stampa.riferimenti.fatturaCollegata'), 'DDT': this.i18n.t('stampa.riferimenti.ddt'),
    };
    y = this.secTitle(doc, y, this.i18n.t('stampa.riferimenti.titolo'));
    this.F(doc, 8.5, 'normal'); doc.setTextColor(...C.text);
    for (const r of refs) {
      const parts: string[] = [(LABEL[r.tipo] || r.tipo) + ` ${this.i18n.t('stampa.riferimenti.numeroAbbr')} ` + r.numero];
      if (r.data) parts.push(`${this.i18n.t('stampa.riferimenti.del')} ` + String(r.data).substring(0, 10).split('-').reverse().join('/'));
      if (r.cig) parts.push(`${this.i18n.t('stampa.riferimenti.cig')}: ` + r.cig);
      if (r.cup) parts.push(`${this.i18n.t('stampa.riferimenti.cup')}: ` + r.cup);
      if (r.commessa) parts.push(`${this.i18n.t('stampa.riferimenti.commessa')}: ` + r.commessa);
      const lines = doc.splitTextToSize('• ' + parts.join(' — '), this.CW - 4) as string[];
      doc.text(lines, this.ML, y);
      y += lines.length * 5 + 1;
    }
    return y + 4;
  }

  private noteBox(doc: jsPDF, y: number, note: string): number {
    const C = this.resolved.colors;
    y = this.secTitle(doc, y, this.i18n.t('stampa.note.titolo'));
    const lines = doc.splitTextToSize(note, this.CW - 8) as string[];
    const bh = lines.length * 5 + 6;
    doc.setFillColor(...C.noteFill); doc.setDrawColor(...C.noteBorder); doc.setLineWidth(0.3);
    doc.rect(this.ML, y - 2, this.CW, bh, 'FD');
    this.F(doc, 8.5, 'normal'); doc.setTextColor(...C.text);
    doc.text(lines, this.ML + 4, y + 3);
    return y + bh + 4;
  }

  private secTitle(doc: jsPDF, y: number, title: string): number {
    const label = this.resolved.uppercaseSectionTitles ? title.toUpperCase() : title;
    this.F(doc, 9, 'bold'); doc.setTextColor(...this.secTitleColor());
    doc.text(label, this.ML, y);
    const tw = doc.getTextWidth(label);
    doc.setDrawColor(...SEC_LINE); doc.setLineWidth(0.2);
    doc.line(this.ML + tw + 2, y - 1, PW - this.ML, y - 1);
    return y + 5;
  }

  /** Carica le miniature dei prodotti delle righe (una sola chiamata), mappate
   *  per prodottoId con le dimensioni naturali per non deformarle in stampa. */
  private async loadRigheImmagini(righe: any[]): Promise<Map<number, RigaImg>> {
    const map = new Map<number, RigaImg>();
    const ids = [...new Set((righe || [])
      .filter(r => r.tipo !== 'NOTA' && r.prodottoId)
      .map(r => r.prodottoId as number))];
    if (!ids.length) return map;
    let schede: { id: number; immagine: string }[];
    try {
      schede = await firstValueFrom(this.ds.getProdottoSchede(ids));
    } catch { return map; }
    const withImg = (schede || []).filter(s => s.immagine);
    const dims = await Promise.all(withImg.map(s => this.imageSize(s.immagine)));
    withImg.forEach((s, i) => {
      const d = dims[i];
      if (d) map.set(s.id, { data: s.immagine, w: d.w, h: d.h });
    });
    return map;
  }

  /** Dimensioni naturali di un'immagine data-URL (null se non caricabile). */
  private imageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width || 1, h: img.height || 1 });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  private footer(doc: jsPDF, az: Azienda) {
    if (this.resolved.footer.show === false || !this.blockVisible('footer')) return;
    const C = this.resolved.colors;
    const f = this.resolved.footer;
    const parts = [
      f.showRagioneSociale ? az.ragioneSociale : '',
      f.showPiva && az.pIva ? `${this.i18n.t('stampa.label.piva')} ${az.pIva}` : '',
      f.showCodFiscale && az.codFiscale ? `${this.i18n.t('stampa.label.cf')} ${az.codFiscale}` : '',
      f.showPec && az.pec ? `${this.i18n.t('stampa.label.pec')}: ${az.pec}` : '',
      f.showSdi && az.sdi ? `${this.i18n.t('stampa.label.sdi')}: ${az.sdi}` : '',
      f.customText || '',
    ].filter(Boolean).join('  —  ');
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(...C.divider); doc.setLineWidth(0.2); doc.line(this.ML, 285, PW - this.ML, 285);
      this.F(doc, 7.5, 'normal'); doc.setTextColor(...C.muted);
      doc.text(parts, PW / 2, 290, { align: 'center' });
      if (f.showPageNumber) doc.text(`${i} / ${n}`, PW - this.ML, 290, { align: 'right' });
    }
  }

  // ── Data helpers ───────────────────────────────────────────────────────────

  private azInfoLines(az: Azienda, withTel = false): string[] {
    const out: string[] = [];
    const addr = [az.indirizzo, [az.cap, az.citta, az.provincia ? `(${az.provincia})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (addr) out.push(addr);
    if (az.pIva) out.push(`${this.i18n.t('stampa.label.piva')}: ${az.pIva}`);
    if (az.email) out.push(az.email);
    if (withTel && az.telefono) out.push(`${this.i18n.t('stampa.label.tel')}: ${az.telefono}`);
    return out;
  }

  private azLines(az: Azienda): string[] {
    return [
      [az.indirizzo, [az.cap, az.citta, az.provincia ? `(${az.provincia})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      az.pIva ? `${this.i18n.t('stampa.label.piva')}: ${az.pIva}` : '',
      az.iban ? `${this.i18n.t('stampa.label.iban')}: ${az.iban}` : '',
    ].filter(Boolean) as string[];
  }

  private contactLines(c: any): string[] {
    if (!c) return [];
    return [
      [c.via, [c.cap, c.citta, c.provincia ? `(${c.provincia})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      c.pIva ? `${this.i18n.t('stampa.label.piva')}: ${c.pIva}` : '',
      c.codFiscale ? `${this.i18n.t('stampa.label.cf')}: ${c.codFiscale}` : '',
      c.email || '',
      c.telefono ? `${this.i18n.t('stampa.label.tel')}: ${c.telefono}` : '',
    ].filter(Boolean) as string[];
  }

  private ddtDestLines(ddt: any): string[] {
    if (ddt.destinazioneDiversa) return [ddt.destinazioneDiversa, ddt.cliente?.pIva ? `${this.i18n.t('stampa.label.piva')}: ${ddt.cliente.pIva}` : ''].filter(Boolean) as string[];
    return this.contactLines(ddt.cliente);
  }

  private fd(s: string): string {
    if (!s) return '—';
    const p = (s || '').substring(0, 10).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
  }

  /** Locale per la formattazione numeri/valuta secondo la lingua UI corrente
   *  (la valuta resta sempre EUR, cambiano solo i separatori migliaia/decimali). */
  private localeFor(lang: string | null): string {
    switch (lang) {
      case 'en': return 'en-GB';
      case 'fr': return 'fr-FR';
      case 'de': return 'de-DE';
      case 'es': return 'es-ES';
      default: return 'it-IT';
    }
  }

  private fe(n: number): string {
    return new Intl.NumberFormat(this.localeFor(this.i18n.lang()), { style: 'currency', currency: 'EUR' }).format(n ?? 0);
  }
}
