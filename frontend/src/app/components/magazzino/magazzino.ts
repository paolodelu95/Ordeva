import { Component, OnInit, AfterViewInit, ViewChild, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { EmptyStateComponent } from '../shared/empty-state';
import { InventarioScanComponent } from './inventario-scan';
import { DataService } from '../../services/data.service';
import { MovimentoMagazzino, GiacenzaStorica, Prodotto, Cliente, PropostaRiordino, Magazzino, Giacenza, ScadenzaLotto } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';
import { selezionabili } from '../../utils/anagrafiche';
import { stepPerUnita, arrotondaPerUnita } from '../../utils/unita';

// ── Rettifica giacenza con scelta prodotto (dal Magazzino) ───────────────────
@Component({
  selector: 'app-magazzino-rettifica-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'magazzino.rettificaGiacenza' | t }}</h2>
    <mat-dialog-content style="min-width:380px">
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>{{ 'magazzino.rettificaDialog.prodotto' | t }}</mat-label>
        <mat-select [(ngModel)]="prodottoId" (ngModelChange)="onProdotto()">
          @for (p of data.prodotti; track p.id) {
            <mat-option [value]="p.id">{{ p.codice }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (sel) {
        <p style="margin:0 0 12px;font-size:13px;color:var(--text-tertiary,#94a3b8)">
          {{ 'magazzino.rettificaDialog.giacenzaAttuale' | t }} <b>{{ sel.quantita }}</b> {{ sel.unitaMisura || '' }}
        </p>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'magazzino.rettificaDialog.nuovaGiacenza' | t }}</mat-label>
          <input matInput type="number" [step]="step" [(ngModel)]="nuova" (keyup.enter)="save()">
          <!-- Il delta sta nell'hint, il cui spazio sotto il campo è già riservato:
               comparendo non allunga il dialog, che essendo centrato spostava in
               alto il campo (e le freccette) a ogni click. -->
          @if (nuova !== null && delta !== 0) {
            <mat-hint [style.color]="delta > 0 ? '#16a34a' : '#dc2626'">
              <mat-icon style="font-size:14px;width:14px;height:14px;vertical-align:middle">{{ delta > 0 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
              {{ delta > 0 ? '+' : '' }}{{ delta }}{{ 'magazzino.rettificaDialog.verraRegistrato' | t }}
            </mat-hint>
          }
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'magazzino.rettificaDialog.motivo' | t }}</mat-label>
          <input matInput [(ngModel)]="note" [placeholder]="'magazzino.rettificaDialog.motivoPh' | t">
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="!sel || nuova === null">{{ 'magazzino.rettificaDialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class MagazzinoRettificaDialogComponent {
  prodottoId: number | null = null;
  nuova: number | null = null;
  note = '';
  sel: Prodotto | null = null;
  constructor(
    public dialogRef: MatDialogRef<MagazzinoRettificaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { prodotti: Prodotto[] }
  ) {}
  onProdotto() {
    this.sel = this.data.prodotti.find(p => p.id === this.prodottoId) || null;
    this.nuova = this.sel?.quantita ?? 0;
  }
  /** Le freccette avanzano di 1 per i pezzi, di frazioni per kg/lt… (come in Prodotti). */
  get step(): number { return stepPerUnita(this.sel?.unitaMisura); }
  // Arrotondato: 5,001 − 5 in virgola mobile fa 0,000999…
  get delta(): number { return +((this.nuova ?? 0) - (this.sel?.quantita ?? 0)).toFixed(3); }
  save() {
    if (this.sel && this.nuova !== null)
      this.dialogRef.close({ prodottoId: this.sel.id, quantita: arrotondaPerUnita(this.nuova, this.sel.unitaMisura), note: this.note });
  }
}

@Component({
  selector: 'app-magazzino',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatTabsModule, MatTooltipModule, MatSnackBarModule, MatDialogModule, EmptyStateComponent,
    MatPaginatorModule, TPipe, TnPipe,
  ],
  templateUrl: './magazzino.html',
  styles: [`
    .card { background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); border: 1px solid var(--border-subtle); overflow-x: auto; padding: 0; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px; border-bottom: 1px solid var(--border-subtle); align-items: center; }
    .filter-bar mat-select { min-width: 150px; }
    .filter-bar input[type=date] { border: 1px solid var(--border-strong); border-radius: 6px; padding: 6px 10px; font-size: 13px; color: var(--text-primary); background: var(--bg-surface); height: 36px; accent-color: var(--brand-teal, #15a4a2); }
    .filter-label { font-size: 12px; color: var(--text-tertiary); font-weight: 600; letter-spacing:.5px; }
    .filter-group { display: flex; align-items: center; gap: 6px; }
    mat-table { width: 100%; }
    th.mat-header-cell { font-weight: 700; font-size: 12px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .5px; background: var(--bg-surface-2); }
    td.mat-cell { font-size: 13px; color: var(--text-primary); padding: 8px 16px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }
    .chip.carico  { background: var(--success-soft); color: var(--success-on); }
    .chip.scarico { background: var(--danger-soft); color: var(--danger-on); }
    .causale-label { font-size: 11px; color: var(--text-tertiary); font-weight: 600; }
    .doc-link { font-weight: 600; color: var(--primary); }
    .empty-msg { text-align: center; padding: 40px; color: var(--text-tertiary); }
    .storico-bar { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; }
    .storico-bar input[type=date] { border: 1px solid var(--border-strong); border-radius: 6px; padding: 8px 12px; font-size: 14px; color: var(--text-primary); background: var(--bg-surface); accent-color: var(--brand-teal, #15a4a2); }
    .qty-low { color: var(--danger-on); font-weight: 700; }
    .qty-ok  { color: var(--success-on); font-weight: 700; }
    .summary-bar { display: flex; gap: 20px; padding: 12px 16px; background: var(--bg-surface-2); border-bottom: 1px solid var(--border-subtle); }
    .summary-item { font-size: 13px; color: var(--text-secondary); }
    .summary-item b { color: var(--text-primary); }
    .riordino-table { width: 100%; border-collapse: collapse; }
    .riordino-table th { font-weight: 700; font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: .5px; background: var(--bg-surface-2); padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border-subtle); }
    .riordino-table td { font-size: 13px; color: var(--text-primary); padding: 8px 16px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    .riordino-no-forn { opacity: .65; }
    .riordino-qty { width: 90px; border: 1px solid var(--border-strong); border-radius: 6px; padding: 6px 8px; font-size: 13px; text-align: right; background: var(--bg-surface); color: var(--text-primary); }
  `]
})
export class MagazzinoComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);

  // ── Movimenti ──────────────────────────────────────────────────────────────
  movimenti: MovimentoMagazzino[] = [];
  dsMovimenti = new MatTableDataSource<MovimentoMagazzino>([]);
  colMovimenti = ['data', 'prodotto', 'variante', 'tipo', 'quantita', 'causale', 'documento', 'controparte'];

  filtroProdotto: number | null = null;
  filtroCliente: number | null = null;
  filtroTipo: string = '';
  filtroAnno: number | null = null;
  filtroMese: number | null = null;
  filtroDataFrom: string = '';
  filtroDataTo: string = '';

  prodottiList: Prodotto[] = [];
  clientiList: Cliente[] = [];

  anni: number[] = [];
  mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: 'common.meseFull.' + v }));
  causali = [
    { v: 'DDT', l: 'magazzino.causale.ddt' }, { v: 'FATTURA', l: 'magazzino.causale.fattura' },
    { v: 'NOTA_CREDITO', l: 'magazzino.causale.notaCredito' }, { v: 'ARRIVO_MERCE', l: 'magazzino.causale.arrivoMerce' },
    { v: 'VENDITA_BANCO', l: 'magazzino.causale.venditaBanco' }, { v: 'ORDINE_ACQUISTO', l: 'magazzino.causale.ordineAcquisto' },
    { v: 'RETTIFICA', l: 'magazzino.causale.rettifica' },
    { v: 'STORNO', l: 'magazzino.causale.storno' }, { v: 'ELIMINAZIONE', l: 'magazzino.causale.eliminazione' },
    { v: 'ANNULLAMENTO', l: 'magazzino.causale.annullamento' }, { v: 'RIATTIVAZIONE', l: 'magazzino.causale.riattivazione' },
  ];
  filtroCausale: string = '';

  get hasFiltri(): boolean {
    return !!(this.filtroProdotto || this.filtroCliente || this.filtroTipo || this.filtroAnno || this.filtroMese || this.filtroDataFrom || this.filtroDataTo || this.filtroCausale);
  }

  get totaleCarichi(): number { return this.movimenti.filter(m => m.tipo === 'CARICO').reduce((s, m) => s + m.quantita, 0); }
  get totaleScarichi(): number { return this.movimenti.filter(m => m.tipo === 'SCARICO').reduce((s, m) => s + m.quantita, 0); }

  @ViewChild('sortMov') sortMov!: MatSort;
  @ViewChild('paginatorMov') paginatorMov!: MatPaginator;

  // ── Storico ────────────────────────────────────────────────────────────────
  dataStorico: string = '';
  giacenze: GiacenzaStorica[] = [];
  dsStorico = new MatTableDataSource<GiacenzaStorica>([]);
  colStorico = ['codice', 'categoria', 'quantita', 'unitaMisura', 'sogliaMinima'];
  loadingStorico = false;
  searchStorico = '';

  /** La tabella sta dentro @if (giacenze.length): nasce dopo ngAfterViewInit, e rinasce
   *  a ogni nuova data. L'ordinamento va quindi agganciato ogni volta che compare. */
  @ViewChild('sortStor') set sortStor(s: MatSort | undefined) { if (s) this.dsStorico.sort = s; }

  // ── Da riordinare ────────────────────────────────────────────────────────
  proposte: PropostaRiordino[] = [];
  generando = false;
  selectedTab = 0;

  // ── Depositi & giacenze ──────────────────────────────────────────────────
  magazzini: Magazzino[] = [];
  depositoSel: number | null = null;
  giacenzeDeposito: Giacenza[] = [];
  dsGiacenze = new MatTableDataSource<Giacenza>([]);
  colGiacenze = ['prodotto', 'variante', 'lotto', 'scadenza', 'quantita'];
  scadenze: ScadenzaLotto[] = [];
  /** Come per lo storico: la tabella esiste solo quando il deposito ha delle giacenze. */
  @ViewChild('sortGiac') set sortGiac(s: MatSort | undefined) { if (s) this.dsGiacenze.sort = s; }

  loadDepositi() {
    this.ds.getMagazzini().subscribe(m => {
      this.magazzini = m;
      if (this.depositoSel == null) this.depositoSel = m.find(x => x.predefinito)?.id ?? m[0]?.id ?? null;
      this.loadGiacenze();
    });
  }
  loadGiacenze() {
    if (this.depositoSel == null) { this.giacenzeDeposito = []; this.dsGiacenze.data = []; return; }
    this.ds.getGiacenze({ magazzinoId: this.depositoSel, soloDisponibili: 1 }).subscribe(g => {
      this.giacenzeDeposito = g; this.dsGiacenze.data = g;
    });
  }
  loadScadenze() { this.ds.getScadenze(30).subscribe(s => this.scadenze = s); }

  openDepositi() {
    this.dialog.open(DepositiDialogComponent, { width: '560px', data: { magazzini: this.magazzini } })
      .afterClosed().subscribe(changed => { if (changed) this.loadDepositi(); });
  }
  openTrasferimento() {
    this.dialog.open(TrasferimentoDialogComponent, { width: '520px', data: { magazzini: this.magazzini, prodotti: this.prodottiList } })
      .afterClosed().subscribe(done => { if (done) { this.loadGiacenze(); this.loadScadenze(); } });
  }
  giorniAScadenza(s: ScadenzaLotto): number { return Math.ceil((new Date(s.scadenza).getTime() - Date.now()) / 86400000); }

  loadProposte() {
    this.ds.getProposteRiordino().subscribe(p => {
      this.proposte = p.map(x => ({ ...x, selected: x.fornitoreId != null }));
    });
  }
  get proposteSelezionate(): PropostaRiordino[] {
    return this.proposte.filter(p => p.selected && p.fornitoreId);
  }
  generaOrdini() {
    const items = this.proposteSelezionate.map(p => ({
      prodottoId: p.prodottoId, quantita: p.quantitaSuggerita, fornitoreId: p.fornitoreId!,
    }));
    if (!items.length) { this.snack.open(this.i18n.t('magazzino.msg.selezionaProdottoFornitore'), '', { duration: 2800 }); return; }
    this.generando = true;
    this.ds.generaRiordino(items).subscribe({
      next: r => {
        this.generando = false;
        this.snack.open(this.i18n.tn('magazzino.msg.ordiniCreati', r.created.length), '', { duration: 3000, panelClass: 'snack-ok' });
        this.loadProposte();
      },
      error: e => { this.generando = false; this.snack.open(e.error?.error || this.i18n.t('magazzino.msg.erroreGenerazioneOrdini'), '', { duration: 3000 }); },
    });
  }

  constructor(private ds: DataService, private snack: MatSnackBar, private dialog: MatDialog, private route: ActivatedRoute) {}

  openRettifica() {
    this.dialog.open(MagazzinoRettificaDialogComponent, { data: { prodotti: this.prodottiList }, width: '440px' })
      .afterClosed().subscribe(res => {
        if (!res) return;
        this.ds.rettificaGiacenza(res.prodottoId, res.quantita, res.note).subscribe({
          next: () => {
            this.snack.open(this.i18n.t('magazzino.msg.giacenzaAggiornata'), '', { duration: 2000 });
            this.ds.getProdotti().subscribe(p => this.prodottiList = p);
            this.loadMovimenti();
          },
          error: e => this.snack.open(e.error?.error || this.i18n.t('magazzino.msg.erroreRettifica'), '', { duration: 3000 })
        });
      });
  }

  openInventario() {
    this.dialog.open(InventarioScanComponent, {
      data: { prodotti: this.prodottiList },
      panelClass: 'inventario-scan-dialog',
      maxWidth: '560px', width: '96vw', height: '92vh', maxHeight: '92vh',
      autoFocus: false,
    }).afterClosed().subscribe(res => {
      if (!res) return;
      const n = res.movimenti;
      this.snack.open(
        n ? this.i18n.tn('magazzino.msg.inventarioApplicato', n) : this.i18n.t('magazzino.msg.inventarioNessunaDifferenza'),
        '', { duration: 3000, panelClass: 'snack-ok' });
      this.ds.getProdotti().subscribe(p => this.prodottiList = p);
      this.loadMovimenti();
    });
  }

  ngOnInit() {
    const y = new Date().getFullYear();
    this.anni = Array.from({ length: 5 }, (_, i) => y - i);
    this.ds.getProdotti().subscribe(p => this.prodottiList = p);
    this.ds.getClienti().subscribe(c => this.clientiList = selezionabili(c));
    this.loadMovimenti();
    this.loadProposte();
    this.loadDepositi();
    this.loadScadenze();
    this.route.queryParams.subscribe(q => { if (q['tab'] === 'riordino') this.selectedTab = 2; });
  }

  ngAfterViewInit() {
    this.dsGiacenze.sortingDataAccessor = (g, col) => {
      if (col === 'prodotto') return g.prodottoCodice || '';
      if (col === 'variante') return `${g.varianteTaglia || ''} ${g.varianteColore || ''}`.trim();
      if (col === 'quantita') return g.quantita ?? 0;
      return (g as any)[col] ?? '';
    };
    this.dsMovimenti.sort = this.sortMov;
    this.dsMovimenti.paginator = this.paginatorMov;
    this.dsMovimenti.sortingDataAccessor = (item, col) => {
      if (col === 'data') return item.data;
      if (col === 'quantita') return item.quantita;
      if (col === 'prodotto') return item.prodottoCodice || '';
      return '';
    };
    this.dsStorico.sortingDataAccessor = (item, col) => {
      if (col === 'quantita') return item.quantita;
      if (col === 'codice') return item.codice;
      return (item as any)[col] ?? '';
    };
    this.dsStorico.filterPredicate = (item, f) =>
      [item.codice, item.categoria].some(v => v?.toLowerCase().includes(f));
  }

  loadMovimenti() {
    const f: Record<string, any> = {};
    if (this.filtroProdotto) f['prodottoId'] = this.filtroProdotto;
    if (this.filtroCliente)  f['clienteId']  = this.filtroCliente;
    if (this.filtroTipo)     f['tipo']        = this.filtroTipo;
    if (this.filtroCausale)  f['causale']     = this.filtroCausale;
    if (this.filtroAnno)     f['anno']        = this.filtroAnno;
    if (this.filtroMese)     f['mese']        = this.filtroMese;
    if (this.filtroDataFrom) f['dataFrom']    = this.filtroDataFrom;
    if (this.filtroDataTo)   f['dataTo']      = this.filtroDataTo;
    this.ds.getMovimentiMagazzino(f).subscribe({
      next: data => { this.movimenti = data; this.dsMovimenti.data = data; },
      error: () => this.snack.open(this.i18n.t('magazzino.msg.erroreMovimenti'), '', { duration: 2000 })
    });
  }

  resetFiltri() {
    this.filtroProdotto = null; this.filtroCliente = null; this.filtroTipo = '';
    this.filtroCausale = ''; this.filtroAnno = null; this.filtroMese = null;
    this.filtroDataFrom = ''; this.filtroDataTo = '';
    this.loadMovimenti();
  }

  loadStorico() {
    if (!this.dataStorico) return;
    this.loadingStorico = true;
    this.ds.getMagazzinoStorico(this.dataStorico).subscribe({
      next: data => { this.giacenze = data; this.dsStorico.data = data; this.loadingStorico = false; },
      error: () => { this.snack.open(this.i18n.t('magazzino.msg.erroreStorico'), '', { duration: 2000 }); this.loadingStorico = false; }
    });
  }

  filterStorico(e: Event) {
    const v = (e.target as HTMLInputElement).value.toLowerCase();
    this.searchStorico = v;
    this.dsStorico.filter = v;
  }

  /** Etichette leggibili delle causali. Quelle che mancavano (nota di credito,
   *  arrivo merce, vendita al banco, ordine d'acquisto) finivano a video come
   *  enum grezzo, underscore compresi: "NOTA_CREDITO". */
  private static readonly CAUSALI: Record<string, string> = {
    DDT: 'magazzino.causale.ddt', FATTURA: 'magazzino.causale.fattura', RETTIFICA: 'magazzino.causale.rettifica',
    STORNO: 'magazzino.causale.storno', ELIMINAZIONE: 'magazzino.causale.eliminazione',
    ANNULLAMENTO: 'magazzino.causale.annullamento', RIATTIVAZIONE: 'magazzino.causale.riattivazione',
    NOTA_CREDITO: 'magazzino.causale.notaCredito', ARRIVO_MERCE: 'magazzino.causale.arrivoMerce',
    VENDITA_BANCO: 'magazzino.causale.venditaBanco', ORDINE_ACQUISTO: 'magazzino.causale.ordineAcquisto',
  };

  labelCausale(causale: string): string {
    return MagazzinoComponent.CAUSALI[causale] || causale;
  }

  fd(s: string): string {
    if (!s) return '—';
    const p = s.substring(0, 10).split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
  }
}

// ── Gestione depositi (CRUD) ─────────────────────────────────────────────────
@Component({
  selector: 'app-depositi-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatTooltipModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'magazzino.tab.depositi' | t }}</h2>
    <mat-dialog-content style="min-width:480px">
      @for (m of lista; track m.id) {
        <div class="dep-row">
          <input class="dep-in dep-nome" [(ngModel)]="m.nome" [placeholder]="'magazzino.depositiDialog.nomeDeposito' | t" (blur)="salva(m)">
          <input class="dep-in dep-cod" [(ngModel)]="m.codice" [placeholder]="'magazzino.depositiDialog.cod' | t" (blur)="salva(m)">
          @if (m.predefinito) {
            <span class="dep-badge">{{ 'magazzino.deposito.predefinito' | t }}</span>
          } @else {
            <button mat-button type="button" (click)="rendiPredefinito(m)" [matTooltip]="'magazzino.depositiDialog.impostaPredefinito' | t">{{ 'magazzino.depositiDialog.predef' | t }}</button>
          }
          <button mat-icon-button type="button" color="warn" (click)="elimina(m)" [disabled]="m.predefinito" [matTooltip]="'magazzino.depositiDialog.elimina' | t">
            <mat-icon>delete</mat-icon>
          </button>
        </div>
      }
      <div class="dep-row dep-new">
        <input class="dep-in dep-nome" [(ngModel)]="nuovo.nome" [placeholder]="'magazzino.depositiDialog.nuovoDepositoPh' | t" (keyup.enter)="aggiungi()">
        <input class="dep-in dep-cod" [(ngModel)]="nuovo.codice" [placeholder]="'magazzino.depositiDialog.cod' | t">
        <button mat-flat-button color="primary" type="button" (click)="aggiungi()" [disabled]="!nuovo.nome.trim()">
          <mat-icon>add</mat-icon> {{ 'magazzino.depositiDialog.aggiungi' | t }}
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button [mat-dialog-close]="changed">{{ 'magazzino.depositiDialog.chiudi' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .dep-row { display:flex; align-items:center; gap:8px; padding:6px 0; }
    .dep-in { border:1px solid var(--border,#cbd5e1); border-radius:8px; padding:7px 10px; font:inherit; background:var(--bg-surface,#fff); }
    .dep-nome { flex:1; } .dep-cod { width:80px; }
    .dep-badge { font-size:11px; font-weight:700; color:var(--primary,#11769b); background:var(--primary-soft,#e0f2fe); padding:3px 8px; border-radius:999px; }
    .dep-new { margin-top:8px; border-top:1px solid var(--border-subtle,#e2e8f0); padding-top:12px; }
  `]
})
export class DepositiDialogComponent {
  i18n = inject(I18nService);
  lista: Magazzino[] = [];
  nuovo: Magazzino = { nome: '', codice: '', indirizzo: '' };
  changed = false;
  constructor(@Inject(MAT_DIALOG_DATA) public data: { magazzini: Magazzino[] }, private ds: DataService, private snack: MatSnackBar) {
    this.lista = (data.magazzini || []).map(m => ({ ...m }));
  }
  private reload() { this.ds.getMagazzini().subscribe(m => this.lista = m.map(x => ({ ...x }))); }
  aggiungi() {
    if (!this.nuovo.nome.trim()) return;
    this.ds.createMagazzino(this.nuovo).subscribe(() => { this.changed = true; this.nuovo = { nome: '', codice: '', indirizzo: '' }; this.reload(); });
  }
  salva(m: Magazzino) { if (!m.nome?.trim()) return; this.ds.updateMagazzino(m.id!, m).subscribe(() => { this.changed = true; }); }
  rendiPredefinito(m: Magazzino) { this.ds.updateMagazzino(m.id!, { predefinito: true }).subscribe(() => { this.changed = true; this.reload(); }); }
  elimina(m: Magazzino) {
    this.ds.deleteMagazzino(m.id!).subscribe({
      next: () => { this.changed = true; this.reload(); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('magazzino.depositiDialog.msgImpossibileEliminare'), 'OK', { duration: 3500, panelClass: 'snack-error' }),
    });
  }
}

// ── Trasferimento tra depositi ───────────────────────────────────────────────
@Component({
  selector: 'app-trasferimento-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'magazzino.trasferimentoDialog.title' | t }}</h2>
    <mat-dialog-content style="min-width:440px">
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>{{ 'magazzino.trasferimentoDialog.prodotto' | t }}</mat-label>
        <mat-select [(ngModel)]="prodottoId" (ngModelChange)="onProdotto()">
          @for (p of data.prodotti; track p.id) { <mat-option [value]="p.id">{{ p.codice }}</mat-option> }
        </mat-select>
      </mat-form-field>
      @if (prodottoId) {
        @if (!giac.length) {
          <p style="font-size:13px;color:var(--text-tertiary,#94a3b8)">{{ 'magazzino.trasferimentoDialog.nessunaGiacenza' | t }}</p>
        } @else {
          <div style="display:flex;gap:10px">
            <mat-form-field appearance="outline" style="flex:1">
              <mat-label>{{ 'magazzino.trasferimentoDialog.daDeposito' | t }}</mat-label>
              <mat-select [(ngModel)]="daMag" (ngModelChange)="onDa()">
                @for (g of depositiOrigine; track g.key) { <mat-option [value]="g.magazzinoId">{{ g.magazzinoNome }} ({{ g.quantita }})</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" style="flex:1">
              <mat-label>{{ 'magazzino.trasferimentoDialog.aDeposito' | t }}</mat-label>
              <mat-select [(ngModel)]="aMag">
                @for (m of data.magazzini; track m.id) {
                  @if (m.id !== daMag) { <mat-option [value]="m.id">{{ m.nome }}</mat-option> }
                }
              </mat-select>
            </mat-form-field>
          </div>
          <mat-form-field appearance="outline" style="width:100%">
            <mat-label>{{ i18n.t('magazzino.trasferimentoDialog.quantita', { max: maxQty }) }}</mat-label>
            <input matInput type="number" min="0" [max]="maxQty" step="0.001" [(ngModel)]="qty" (keyup.enter)="salva()">
          </mat-form-field>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="salva()" [disabled]="!canSave">{{ 'magazzino.deposito.trasferisci' | t }}</button>
    </mat-dialog-actions>`
})
export class TrasferimentoDialogComponent {
  i18n = inject(I18nService);
  prodottoId: number | null = null;
  giac: Giacenza[] = [];
  daMag: number | null = null;
  aMag: number | null = null;
  qty: number | null = null;
  lotto = ''; scadenza = '';
  constructor(public dialogRef: MatDialogRef<TrasferimentoDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: { magazzini: Magazzino[]; prodotti: Prodotto[] },
              private ds: DataService, private snack: MatSnackBar) {}
  onProdotto() {
    this.giac = []; this.daMag = null; this.aMag = null; this.qty = null;
    if (!this.prodottoId) return;
    this.ds.getGiacenzeProdotto(this.prodottoId).subscribe(g => {
      this.giac = g; this.daMag = g[0]?.magazzinoId ?? null; this.onDa();
    });
  }
  /** Depositi che hanno giacenza (chiave include lotto/scadenza). */
  get depositiOrigine() {
    return this.giac.map(g => ({ ...g, key: `${g.magazzinoId}|${g.lotto}|${g.scadenza}` }));
  }
  onDa() {
    const g = this.giac.find(x => x.magazzinoId === this.daMag);
    this.lotto = g?.lotto || ''; this.scadenza = g?.scadenza || '';
  }
  get maxQty(): number {
    const g = this.giac.find(x => x.magazzinoId === this.daMag && (x.lotto || '') === this.lotto && (x.scadenza || '') === this.scadenza);
    return g?.quantita ?? 0;
  }
  get canSave(): boolean { return !!(this.prodottoId && this.daMag && this.aMag && this.daMag !== this.aMag && this.qty && this.qty > 0 && this.qty <= this.maxQty); }
  salva() {
    if (!this.canSave) return;
    this.ds.trasferimentoMagazzino({
      prodottoId: this.prodottoId, daMagazzinoId: this.daMag, aMagazzinoId: this.aMag,
      quantita: this.qty, lotto: this.lotto, scadenza: this.scadenza,
    }).subscribe({
      next: () => { this.snack.open(this.i18n.t('magazzino.trasferimentoDialog.msgEseguito'), '', { duration: 2000, panelClass: 'snack-ok' }); this.dialogRef.close(true); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('magazzino.trasferimentoDialog.msgErrore'), 'OK', { duration: 3500, panelClass: 'snack-error' }),
    });
  }
}
