import { inject, Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { RIGHE_STYLES } from '../shared/righe-styles';
import { ConfirmService } from '../shared/confirm-dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { VenditaBanco, Prodotto, ProdottoVariante, RigaDocumento, AliquotaIva, UnitaMisura, Cliente } from '../../models';
import { normalizePiva } from '../../validators/italian-validators';
import { DocInfoDialogComponent, DocInfoData } from '../shared/doc-info-dialog';
import { BarcodeScannerDialogComponent } from '../shared/barcode-scanner-dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { I18nService } from '../../services/i18n.service';
import { CostiService } from '../../services/costi.service';
import { TPipe } from '../../pipes/t.pipe';

interface RigaVendita extends RigaDocumento {
  varianteId?: number | null;
  varianteTaglia?: string;
  varianteColore?: string;
  haVarianti?: boolean;
}

interface MetodoPagamento {
  valore: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-vendita-banco',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTabsModule, MatSnackBarModule, MatAutocompleteModule,
    MatProgressSpinnerModule, MatMenuModule, MatDialogModule, MatTooltipModule, TPipe,
  ],
  templateUrl: './vendita-banco.html',
  styles: [RIGHE_STYLES + `
    /* Metodi pagamento — griglia responsive a larghezza fluida */
    .metodi-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--sp-2); margin-bottom: var(--sp-2);
    }
    .metodo-btn {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--sp-1); min-height: 80px; border: 2px solid var(--border);
      border-radius: var(--radius-md); background: var(--bg-surface); cursor: pointer; transition: all .15s;
      font-size: 12px; font-weight: 700; color: var(--text-secondary); padding: var(--sp-2) var(--sp-1);
    }
    .metodo-btn mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .metodo-btn:hover { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
    .metodo-btn.selected { border-color: var(--primary); background: var(--primary); color: var(--primary-on); }
    .metodo-btn.selected mat-icon { color: var(--primary-on); }
    .metodi-foot { display: flex; justify-content: flex-end; }

    /* Calcolatrice resto */
    .resto-banconote { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
    .banconota-btn { position: relative; border: 2px solid var(--primary-soft-hover); background: var(--bg-surface); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-4); font-size: 14px; font-weight: 700; color: var(--primary-active); cursor: pointer; transition: all .15s; }
    .banconota-btn:hover { background: var(--primary-soft-hover); border-color: var(--primary); }
    .banconota-btn.banconota-selected { background: var(--primary); color: var(--primary-on); border-color: var(--primary); }
    .banconota-count { position: absolute; top: -7px; right: -7px; background: var(--warning); color: var(--primary-on); border-radius: 99px; font-size: 10px; font-weight: 800; min-width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; padding: 0 3px; line-height: 1; }
    .resto-clear-btn { border: none; background: none; cursor: pointer; color: var(--text-tertiary); padding: 0 var(--sp-2); display: flex; align-items: center; transition: color .15s; }
    .resto-clear-btn:hover { color: var(--danger-on); }
    .resto-clear-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .resto-input-row { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
    .resto-label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; }
    .resto-input-wrap { display: flex; align-items: center; border: 2px solid var(--primary-soft-hover); border-radius: var(--radius-sm); background: var(--bg-surface); overflow: hidden; }
    .resto-currency { padding: 0 var(--sp-2); font-weight: 700; color: var(--primary); font-size: 15px; }
    .resto-input { border: none; outline: none; padding: var(--sp-2) var(--sp-3) var(--sp-2) 0; font-size: 15px; font-weight: 700; width: 100px; background: transparent; color: var(--text-primary); }
    .resto-risultato { display: flex; align-items: center; gap: var(--sp-1); font-size: 15px; padding: var(--sp-2) var(--sp-4); border-radius: var(--radius-sm); font-weight: 600; }
    .resto-ok { background: var(--success-soft); color: var(--success-on); }
    .resto-err { background: var(--danger-soft); color: var(--danger-on); }
    .resto-risultato mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .resto-grid { display: flex; align-items: center; gap: var(--sp-6); flex-wrap: wrap; }

    /* Pagamento misto */
    .pm-row { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); }
    .pm-select { border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); font-size: 13px; font-weight: 600; outline: none; background: var(--bg-surface); color: var(--text-primary); flex: 1; min-width: 0; }
    .pm-select:focus { border-color: var(--primary); }
    .pm-currency { font-weight: 700; color: var(--primary); font-size: 15px; padding: 0 2px; }
    .pm-input { border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); font-size: 14px; outline: none; background: var(--bg-surface); color: var(--text-primary); width: 110px; text-align: right; }
    .pm-input:focus { border-color: var(--primary); }
    .pm-foot { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
    .pm-summary { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: var(--sp-1); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); }
    .pm-ok { background: var(--success-soft); color: var(--success-on); }
    .pm-err { background: var(--danger-soft); color: var(--danger-on); }
    .pm-warn { background: var(--warning-soft); color: var(--warning-on); }
    .pm-summary mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pm-back { display: flex; justify-content: flex-end; }
    @media (max-width: 600px) {
      .pm-input { width: 80px; }
    }

    /* Sezione fattura */
    .fattura-toggle-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); background: var(--bg-surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; user-select: none; }
    .fattura-toggle-row mat-icon { font-size: 22px; width: 22px; height: 22px; color: var(--primary); }
    .fattura-toggle-label { font-size: 14px; font-weight: 700; color: var(--text-primary); flex: 1; }
    .fattura-toggle-sub { font-size: 12px; color: var(--text-tertiary); }
    .fattura-toggle-row .toggle-chevron { color: var(--text-muted); }
    .piva-row { display: flex; gap: var(--sp-2); align-items: center; }
    .piva-input { flex: 1; min-width: 0; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 9px 12px; font-size: 14px; outline: none; background: var(--bg-surface); color: var(--text-primary); text-transform: uppercase; }
    .piva-input:focus { border-color: var(--primary); }
    .cliente-trovato { display: flex; align-items: center; gap: var(--sp-3); background: var(--success-soft); border: 1px solid var(--success-on); border-radius: var(--radius-md); padding: var(--sp-3) var(--sp-4); }
    .cliente-trovato mat-icon { color: var(--success-on); }
    .cliente-trovato-nome { font-weight: 700; color: var(--success-on); flex: 1; }
    .cliente-trovato-piva { font-size: 12px; color: var(--text-tertiary); }
    .cliente-hint { font-size: 12px; color: var(--text-tertiary); }
    .cliente-grid { display: grid; gap: var(--sp-3); grid-template-columns: 2fr 1fr; }
    .cliente-grid-addr { display: grid; gap: var(--sp-3); grid-template-columns: 2fr 1fr 1fr 1fr; }
    @media (max-width: 600px) { .cliente-grid, .cliente-grid-addr { grid-template-columns: 1fr; } }
    .opt-field { display: flex; flex-direction: column; gap: 4px; }
    .opt-field label { font-size: 12px; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .5px; }
    .opt-field input { border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 9px 12px; font-size: 14px; outline: none; background: var(--bg-surface); color: var(--text-primary); }
    .opt-field input:focus { border-color: var(--primary); }
    .opt-field input[readonly] { background: var(--bg-surface-2); color: var(--text-tertiary); }
    .opt-field input.upper { text-transform: uppercase; }

    /* Helper riga/autocomplete */
    .opt-meta { font-size: 11px; color: var(--text-muted); }
    .opt-name { font-weight: 600; }
    .opt-variant { font-size: 10px; color: var(--brand-purple, #6d28d9); margin-left: 4px; }
    .variante-label { font-size: 12px; color: var(--brand-purple, #6d28d9); }
    .variante-empty { color: var(--text-muted); }
    .righe-empty { text-align: center; padding: var(--sp-5); color: var(--text-muted); font-size: 13px; }
    .fattura-toggle-text { flex: 1; min-width: 0; }
    .cliente-trovato-body { flex: 1; min-width: 0; }

    /* Azioni + storico */
    .actions-bar { display: flex; justify-content: flex-end; gap: var(--sp-2); }
    mat-table { width: 100%; }
    th.mat-header-cell { font-weight: 700; font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; background: var(--bg-surface-2); }
    td.mat-cell { font-size: 13px; }

    @media (max-width: 767.98px) {
      .actions-bar { flex-direction: column-reverse; align-items: stretch; }
      .actions-bar button { width: 100%; }
      .resto-grid { gap: var(--sp-3); }
    }
  `]
})
export class VenditaBancoComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  /** Costi d'acquisto, per fermare uno sconto che va in perdita. */
  readonly costi = inject(CostiService);
  private confirm = inject(ConfirmService);

  today = new Date().toISOString().substring(0, 10);
  vendita: VenditaBanco = { numero: '', data: this.today, metodoPagamento: 'CONTANTI' };
  righe: RigaVendita[] = [];
  prodottiList: Prodotto[] = [];
  filteredProdotti: (Prodotto[] | undefined)[] = [];
  variantiPerRiga: ProdottoVariante[][] = [];
  aliquoteIva: AliquotaIva[] = [];
  unitaMisura: UnitaMisura[] = [];
  clientiList: Cliente[] = [];

  readonly metodiPagamento: MetodoPagamento[] = [
    { valore: 'CONTANTI',         label: 'venditaBanco.metodo.contanti',     icon: 'payments' },
    { valore: 'BANCOMAT',         label: 'venditaBanco.metodo.bancomat',     icon: 'credit_card' },
    { valore: 'CARTA DI CREDITO', label: 'venditaBanco.metodo.cartaCredito', icon: 'contactless' },
    { valore: 'BONIFICO',         label: 'venditaBanco.metodo.bonifico',     icon: 'account_balance' },
    { valore: 'ASSEGNO',          label: 'venditaBanco.metodo.assegno',      icon: 'receipt_long' },
  ];

  // ── Fattura ──────────────────────────────────────────────────────────────
  vuoleFattura = false;
  cercaStr = '';
  cercandoPiva = false;
  clienteSelezionato: { id?: number; ragioneSociale: string; pIva?: string } | null = null;
  mostraFormManuale = false;
  nuovoCliente = { ragioneSociale: '', pIva: '', via: '', cap: '', citta: '', provincia: '', stato: 'IT' };

  /** Clears autocomplete display value after selection */
  readonly displayNone = (_: any) => '';

  get filteredClienti(): Cliente[] {
    const q = (this.cercaStr ?? '').trim().toLowerCase();
    if (q.length < 2) return [];
    const norm = normalizePiva(this.cercaStr);
    return this.clientiList.filter(c =>
      c.ragioneSociale.toLowerCase().includes(q) ||
      normalizePiva(c.pIva || '').includes(norm)
    ).slice(0, 8);
  }

  get isPivaInput(): boolean {
    return normalizePiva(this.cercaStr).length === 11;
  }

  selectClienteDaLista(c: Cliente) {
    if (!c) return;
    this.clienteSelezionato = { id: c.id, ragioneSociale: c.ragioneSociale, pIva: c.pIva };
    this.mostraFormManuale = false;
  }

  inserisciManualmente() {
    this.nuovoCliente = { ragioneSociale: this.cercaStr.trim(), pIva: normalizePiva(this.cercaStr), via: '', cap: '', citta: '', provincia: '', stato: 'IT' };
    this.mostraFormManuale = true;
  }

  // ── Totali ────────────────────────────────────────────────────────────────
  get imponibile(): number {
    return this.righe.reduce((s, r) => s + (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100), 0);
  }
  get ivaTotal(): number {
    return this.righe.reduce((s, r) => {
      const imp = (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
      return s + imp * ((r.iva || 0) / 100);
    }, 0);
  }
  get totale(): number { return this.imponibile + this.ivaTotal; }

  // ── Pagamento misto ───────────────────────────────────────────────────────
  pagamentoMisto = false;
  pagamentiMisti: { metodo: string; importo: number | null }[] = [];

  get totalePagamentiMisti(): number {
    return this.pagamentiMisti.reduce((s, p) => s + (p.importo ?? 0), 0);
  }
  get rimanenteAllocare(): number {
    return Math.round((this.totale - this.totalePagamentiMisti) * 100) / 100;
  }
  get pagamentiMistiValidi(): boolean {
    return this.pagamentiMisti.length > 0 &&
           this.pagamentiMisti.every(p => p.importo != null && p.importo > 0) &&
           Math.abs(this.rimanenteAllocare) <= 0.01;
  }

  enablePagamentoMisto() {
    this.pagamentoMisto = true;
    this.pagamentiMisti = [{ metodo: this.vendita.metodoPagamento || 'CONTANTI', importo: null }];
    this.clearImporto();
  }

  disablePagamentoMisto() {
    this.pagamentoMisto = false;
    this.pagamentiMisti = [];
  }

  addPagamentoMisto() {
    const usati = new Set(this.pagamentiMisti.map(p => p.metodo));
    const disponibile = this.metodiPagamento.find(m => !usati.has(m.valore));
    if (!disponibile) return;
    const rimanente = Math.max(0, this.rimanenteAllocare);
    this.pagamentiMisti.push({ metodo: disponibile.valore, importo: rimanente > 0 ? rimanente : null });
  }

  removePagamentoMisto(i: number) {
    this.pagamentiMisti.splice(i, 1);
    if (this.pagamentiMisti.length === 0) this.disablePagamentoMisto();
  }

  // ── Calcolatrice resto ────────────────────────────────────────────────────
  importoPagato: number | null = null;
  selectedBanconote: number[] = [];
  get resto(): number | null {
    if (this.importoPagato == null) return null;
    return Math.round((this.importoPagato - this.totale) * 100) / 100;
  }
  readonly banconote = [5, 10, 20, 50, 100, 200];
  addBanconota(b: number) {
    this.selectedBanconote.push(b);
    this.importoPagato = this.selectedBanconote.reduce((a, x) => a + x, 0);
  }
  countBanconota(b: number): number { return this.selectedBanconote.filter(x => x === b).length; }
  clearImporto() { this.importoPagato = null; this.selectedBanconote = []; }

  ivaBreakdown(): { aliquota: number; imp: number; iva: number }[] {
    const map = new Map<number, { imp: number; iva: number }>();
    for (const r of this.righe) {
      const imp = (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100);
      const ex = map.get(r.iva) || { imp: 0, iva: 0 };
      map.set(r.iva, { imp: ex.imp + imp, iva: ex.iva + imp * (r.iva / 100) });
    }
    return [...map.entries()].map(([a, v]) => ({ aliquota: a, ...v })).filter(x => x.imp > 0);
  }

  // ── Storico ───────────────────────────────────────────────────────────────
  storico: VenditaBanco[] = [];
  dsStorico = new MatTableDataSource<VenditaBanco>([]);
  colStorico = ['data', 'numero', 'cliente', 'metodo', 'totale', 'azioni'];
  @ViewChild(MatSort) sort!: MatSort;

  constructor(private ds: DataService, private printSvc: PrintService, private snack: MatSnackBar, private dialog: MatDialog) {}

  ngOnInit() {
    void this.costi.assicura();
    this.ds.getProdotti().subscribe(p => this.prodottiList = p);
    this.ds.getAliquoteIva().subscribe(a => this.aliquoteIva = a.filter(x => x.attiva));
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getClienti().subscribe(c => this.clientiList = c);
    this.loadNextNumber();
    this.loadStorico();
  }

  ngAfterViewInit() {
    this.dsStorico.sort = this.sort;
    this.dsStorico.sortingDataAccessor = (item, col) => {
      if (col === 'totale') return item.totale ?? 0;
      if (col === 'data') return item.data;
      return (item as any)[col] ?? '';
    };
  }

  loadNextNumber() {
    this.ds.getNextNumberVenditaBanco().subscribe(r => {
      this.vendita.numero = String(r.numero).padStart(4, '0');
    });
  }

  loadStorico() {
    this.ds.getVenditeBanco().subscribe(v => { this.storico = v; this.dsStorico.data = v; });
  }

  // ── Metodo pagamento ──────────────────────────────────────────────────────
  setMetodo(m: string) {
    this.disablePagamentoMisto();
    this.vendita.metodoPagamento = m;
    this.clearImporto();
  }

  // ── Fattura ───────────────────────────────────────────────────────────────
  toggleFattura() {
    this.vuoleFattura = !this.vuoleFattura;
    if (!this.vuoleFattura) this.resetClienteFattura();
  }

  cercaPerPiva() {
    const piva = normalizePiva(this.cercaStr);
    if (!piva) return;
    this.cercandoPiva = true;
    this.clienteSelezionato = null;
    this.mostraFormManuale = false;

    this.ds.checkPivaDuplicate(piva, 'clienti').subscribe({
      next: check => {
        if (check.exists && check.id) {
          const c = this.clientiList.find(x => x.id === check.id);
          this.clienteSelezionato = { id: c?.id, ragioneSociale: c?.ragioneSociale || '', pIva: c?.pIva };
          this.cercandoPiva = false;
        } else {
          this.ds.lookupPiva(piva).subscribe({
            next: data => {
              this.nuovoCliente = {
                ragioneSociale: data.ragioneSociale || '',
                pIva: piva, via: data.via || '', cap: data.cap || '',
                citta: data.citta || '', provincia: data.provincia || '', stato: data.stato || 'IT',
              };
              this.mostraFormManuale = true;
              this.cercandoPiva = false;
            },
            error: () => {
              this.nuovoCliente = { ragioneSociale: '', pIva: piva, via: '', cap: '', citta: '', provincia: '', stato: 'IT' };
              this.mostraFormManuale = true;
              this.cercandoPiva = false;
            },
          });
        }
      },
      error: () => {
        this.nuovoCliente = { ragioneSociale: '', pIva: piva, via: '', cap: '', citta: '', provincia: '', stato: 'IT' };
        this.mostraFormManuale = true;
        this.cercandoPiva = false;
      },
    });
  }

  resetClienteFattura() {
    this.cercaStr = '';
    this.clienteSelezionato = null;
    this.mostraFormManuale = false;
    this.cercandoPiva = false;
    this.nuovoCliente = { ragioneSociale: '', pIva: '', via: '', cap: '', citta: '', provincia: '', stato: 'IT' };
  }

  // ── Righe ─────────────────────────────────────────────────────────────────
  addRiga() {
    const idx = this.righe.length;
    this.righe.push({ descrizione: '', quantita: 1, prezzo: 0, sconto: 0, iva: 22 });
    this.filteredProdotti[idx] = this.prodottiList;
    this.variantiPerRiga[idx] = [];
  }

  scannerBarcode() {
    const ref = this.dialog.open(BarcodeScannerDialogComponent, { width: '480px', maxWidth: '95vw' });
    ref.afterClosed().subscribe((code: string | null | undefined) => {
      if (!code) return;
      const match = this.prodottiList.find(p => p.barcode === code);
      if (match) {
        const idx = this.righe.length;
        this.righe.push({ descrizione: match.nome, quantita: 1, prezzo: 0, sconto: 0, iva: 22 });
        this.filteredProdotti[idx] = this.prodottiList;
        this.variantiPerRiga[idx] = [];
        this.selectProdotto(idx, match);
        return;
      }
      this.ds.searchByBarcode(code).subscribe({
        next: res => {
          const idx = this.righe.length;
          this.righe.push({ descrizione: res.prodotto.nome, quantita: 1, prezzo: 0, sconto: 0, iva: 22 });
          this.filteredProdotti[idx] = this.prodottiList;
          this.variantiPerRiga[idx] = [];
          this.selectProdotto(idx, res.prodotto);
        },
        error: () => this.snack.open(this.i18n.t('venditaBanco.msg.barcodeNonTrovato', { code }), this.i18n.t('venditaBanco.msg.ok'), { duration: 4000, panelClass: 'snack-error' })
      });
    });
  }

  removeRiga(i: number) {
    this.righe.splice(i, 1);
    this.filteredProdotti.splice(i, 1);
    this.variantiPerRiga.splice(i, 1);
  }

  onProdottoInput(i: number, value: string) {
    if (!value) { this.filteredProdotti[i] = this.prodottiList; return; }
    const v = value.toLowerCase();
    this.filteredProdotti[i] = this.prodottiList.filter(p =>
      p.nome.toLowerCase().includes(v) ||
      (p.codice || '').toLowerCase().includes(v) ||
      (p.barcode || '').toLowerCase().includes(v)
    );
    const match = this.prodottiList.find(p => p.barcode && p.barcode === value);
    if (match) { this.selectProdotto(i, match); this.righe[i].descrizione = match.nome; }
  }

  onBarcodeKeydown(i: number, event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    const val = this.righe[i].descrizione?.trim();
    if (!val) return;
    const match = this.prodottiList.find(p => p.barcode === val);
    if (match) { this.selectProdotto(i, match); this.righe[i].descrizione = match.nome; return; }
    this.ds.searchByBarcode(val).subscribe({
      next: res => {
        this.selectProdotto(i, res.prodotto);
        this.righe[i].descrizione = res.prodotto.nome;
        if (res.variante) this.selectVariante(i, res.variante);
      },
      error: () => {},
    });
  }

  selectProdotto(i: number, p: Prodotto) {
    const r = this.righe[i];
    r.descrizione = p.nome; r.prezzo = p.prezzo; r.iva = p.iva;
    r.prodottoId = p.id; r.unitaMisura = p.unitaMisura;
    r.haVarianti = p.haVarianti; r.varianteId = null;
    r.varianteTaglia = ''; r.varianteColore = '';
    this.variantiPerRiga[i] = [];
    if (p.haVarianti && p.id) this.ds.getProdottoVarianti(p.id).subscribe(v => { this.variantiPerRiga[i] = v; });
  }

  selectVariante(i: number, v: ProdottoVariante) {
    this.righe[i].varianteId = v.id;
    this.righe[i].varianteTaglia = v.taglia;
    this.righe[i].varianteColore = v.colore;
  }

  onVarianteChange(i: number) {
    const id = this.righe[i].varianteId != null ? +this.righe[i].varianteId! : null;
    const v = this.variantiPerRiga[i]?.find(x => x.id === id);
    if (v) {
      this.righe[i].varianteId = v.id;
      this.righe[i].varianteTaglia = v.taglia;
      this.righe[i].varianteColore = v.colore;
    } else {
      this.righe[i].varianteId = null;
      this.righe[i].varianteTaglia = '';
      this.righe[i].varianteColore = '';
    }
  }

  varianteLabel(v: ProdottoVariante): string {
    const parts = [v.taglia, v.colore].filter(Boolean);
    return parts.length
      ? `${parts.join(' / ')} ${this.i18n.t('venditaBanco.varianteQta', { n: v.quantita })}`
      : this.i18n.t('venditaBanco.varianteNumero', { n: v.id! });
  }

  roundIfPz(r: { unitaMisura?: string; quantita: number }) {
    if (r.unitaMisura === 'pz') r.quantita = Math.max(1, Math.round(r.quantita || 1));
    else r.quantita = Math.max(0.001, r.quantita || 0.001);
  }
  clampSconto(r: any) { r.sconto = Math.min(100, Math.max(0, r.sconto ?? 0)); }

  /** Vero se la riga, sconto compreso, va sotto il costo d'acquisto. */
  sottocosto(r: any): boolean {
    return this.costi.sottocosto(r?.prodottoId, this.nettoScontato(r));
  }

  tooltipSottocosto(r: any): string {
    const costo = this.costi.costo(r?.prodottoId) ?? 0;
    return this.i18n.t('comune.sottocostoDettaglio', {
      costo: costo.toFixed(2),
      perdita: this.costi.perdita(r?.prodottoId, this.nettoScontato(r)).toFixed(2),
    });
  }

  private nettoScontato(r: any): number {
    return Number(r?.prezzo ?? 0) * (1 - Number(r?.sconto ?? 0) / 100);
  }

  prezzoIvato(r: RigaVendita): number {
    return +((r.prezzo || 0) * (1 + (r.iva || 0) / 100)).toFixed(2);
  }
  setPrezzoFromGross(r: RigaVendita, event: Event) {
    const gross = Math.max(0, +(event.target as HTMLInputElement).value || 0);
    r.prezzo = gross > 0 ? +(gross / (1 + (r.iva || 0) / 100)).toFixed(6) : 0;
  }
  rigaImporto(r: RigaVendita): number {
    return (r.quantita || 0) * (r.prezzo || 0) * (1 + (r.iva || 0) / 100) * (1 - (r.sconto || 0) / 100);
  }

  // ── Salva ─────────────────────────────────────────────────────────────────
  salvaEStampa() {
    if (!this.righe.length) { this.snack.open(this.i18n.t('venditaBanco.msg.aggiungiProdotto'), '', { duration: 2000 }); return; }

    if (this.pagamentoMisto) {
      if (this.pagamentiMisti.some(p => !p.importo || p.importo <= 0)) {
        this.snack.open(this.i18n.t('venditaBanco.msg.importoTuttiMetodi'), '', { duration: 2500 }); return;
      }
      if (this.rimanenteAllocare > 0.01) {
        this.snack.open(this.i18n.t('venditaBanco.msg.importoNonCompleto', { importo: `€${this.rimanenteAllocare.toFixed(2)}` }), '', { duration: 2500 }); return;
      }
      if (this.rimanenteAllocare < -0.01) {
        this.snack.open(this.i18n.t('venditaBanco.msg.importoEccesso', { importo: `€${(-this.rimanenteAllocare).toFixed(2)}` }), '', { duration: 2500 }); return;
      }
    }

    if (this.vuoleFattura) {
      if (!this.clienteSelezionato && !this.mostraFormManuale) {
        this.snack.open(this.i18n.t('venditaBanco.msg.cercaPivaCliente'), '', { duration: 2500 }); return;
      }
      if (this.mostraFormManuale && !this.nuovoCliente.ragioneSociale.trim()) {
        this.snack.open(this.i18n.t('venditaBanco.msg.inserisciRagioneSociale'), '', { duration: 2500 }); return;
      }
    }

    if (this.vuoleFattura && !this.clienteSelezionato) {
      this.ds.createCliente(this.nuovoCliente as unknown as Cliente).subscribe({
        next: r => this.procediSalvataggio(r.id),
        error: e => this.snack.open(this.i18n.t('venditaBanco.msg.erroreCreazioneCliente', { err: e.message }), '', { duration: 3000 }),
      });
    } else {
      this.procediSalvataggio(this.clienteSelezionato?.id);
    }
  }

  private procediSalvataggio(clienteId?: number) {
    const nomeCliente = this.clienteSelezionato?.ragioneSociale || this.nuovoCliente.ragioneSociale || '';
    const payload: VenditaBanco = {
      ...this.vendita,
      clienteNome: this.vuoleFattura ? nomeCliente : '',
      righe: this.righe,
      ...(this.pagamentoMisto ? {
        pagamenti: this.pagamentiMisti.map(p => ({ metodo: p.metodo, importo: p.importo! }))
      } : {}),
    };

    this.ds.createVenditaBanco(payload).subscribe({
      next: res => {
        this.printSvc.printDocumentale(res.id);
        if (this.vuoleFattura && clienteId) {
          this.ds.generaFatturaFromVendita(res.id, clienteId).subscribe({
            next: fat => {
              this.snack.open(this.i18n.t('venditaBanco.msg.venditaFatturaGenerata', { numero: fat.numero }), '', { duration: 3500 });
              this.loadStorico();
              this.resetForm();
            },
            error: () => {
              this.snack.open(this.i18n.t('venditaBanco.msg.venditaSalvataErroreFattura'), '', { duration: 3500 });
              this.loadStorico();
              this.resetForm();
            },
          });
        } else {
          this.snack.open(this.i18n.t('venditaBanco.msg.venditaRegistrata'), '', { duration: 2000 });
          this.loadStorico();
          this.resetForm();
        }
      },
      error: e => this.snack.open(e.error?.error || e.message, this.i18n.t('venditaBanco.msg.ok'), { duration: 4000, panelClass: 'snack-error' }),
    });
  }

  private resetForm() {
    this.righe = [];
    this.filteredProdotti = [];
    this.variantiPerRiga = [];
    this.importoPagato = null;
    this.selectedBanconote = [];
    this.vuoleFattura = false;
    this.pagamentoMisto = false;
    this.pagamentiMisti = [];
    this.resetClienteFattura();
    this.vendita = { numero: '', data: this.today, metodoPagamento: 'CONTANTI' };
    this.loadNextNumber();
  }

  // ── Storico ───────────────────────────────────────────────────────────────
  stampa(v: VenditaBanco) { this.printSvc.printDocumentale(v.id!); }

  info(v: VenditaBanco) {
    this.ds.getVenditaBancoPrint(v.id!).subscribe(doc => {
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: this.i18n.t('venditaBanco.docTipo'), sottotitolo: this.i18n.t('venditaBanco.pagamentoInfo', { metodo: v.metodoPagamento ?? 'CONTANTI' }),
          numero: doc.numero, data: doc.data, stato: doc.stato ?? 'EMESSA',
          controparte: doc.clienteNome || undefined,
          totale: imponibile + ivaT, imponibile, righe,
          note: doc.note,
        } as DocInfoData,
        width: '720px', maxWidth: '98vw', maxHeight: '92vh',
      });
    });
  }

  async elimina(v: VenditaBanco) {
    if (!await this.confirm.delete(this.i18n.t('venditaBanco.msg.confermaElimina', { numero: v.numero }))) return;
    this.ds.deleteVenditaBanco(v.id!).subscribe(() => {
      this.loadStorico();
      this.snack.open(this.i18n.t('venditaBanco.msg.eliminata'), '', { duration: 2000 });
    });
  }

  fd(s: string): string {
    if (!s) return '—';
    const p = s.substring(0, 10).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
  }
}
