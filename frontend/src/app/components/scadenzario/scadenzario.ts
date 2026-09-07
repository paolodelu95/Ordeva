import { inject, Component, OnInit, AfterViewInit, Inject, ViewChild } from '@angular/core';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SelectionModel } from '@angular/cdk/collections';
import { forkJoin } from 'rxjs';
import { DataService } from '../../services/data.service';
import { TipoPagamento } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

interface ScadenzarioItem {
  id: number;
  numero: string;
  tipo: 'fattura' | 'acquisto' | 'manuale';
  direzione: 'ENTRATA' | 'USCITA';
  dataScadenza: string | null;
  dataEmissione: string;
  totale: number;
  stato: string;
  controparte: string | null;
  giorniMancanti: number | null;
  scaduto: boolean;
}

// ── Saldo Multiplo Dialog ────────────────────────────────────────────────────
@Component({
  selector: 'app-saldo-multiplo-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, TPipe, TnPipe],
  template: `
    <div style="display:flex;align-items:center;gap:12px;padding:20px 24px 0">
      <div style="width:44px;height:44px;background:linear-gradient(135deg,#11769b,#0891b2);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 10px -2px rgba(21, 164, 162,.35)">
        <mat-icon style="color:#fff;font-size:22px;width:22px;height:22px">payments</mat-icon>
      </div>
      <div>
        <h2 mat-dialog-title style="margin:0;padding:0;font-size:16px;font-weight:600">{{ 'scadenzario.dialog.title' | t }}</h2>
        <p style="margin:2px 0 0;font-size:13px;color:#64748b">
          {{ data.items.length | tn:'scadenzario.dialog.docSelezionato' }}
        </p>
      </div>
    </div>

    <mat-dialog-content style="min-width:480px;max-width:640px;padding:16px 24px">

      <!-- Riepilogo documenti -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748b">{{ 'scadenzario.dialog.colNumero' | t }}</th>
            <th style="text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748b">{{ 'scadenzario.col.controparte' | t }}</th>
            <th style="text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748b">{{ 'scadenzario.dialog.colScadenza' | t }}</th>
            <th style="text-align:right;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:600;text-transform:uppercase;color:#64748b">{{ 'scadenzario.col.importo' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (item of data.items; track item.id) {
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:7px 10px;font-weight:600">
                <span style="font-size:10px;background:{{ item.direzione === 'ENTRATA' ? '#dcfce7' : '#fee2e2' }};color:{{ item.direzione === 'ENTRATA' ? '#166534' : '#991b1b' }};padding:1px 6px;border-radius:3px;margin-right:5px">
                  {{ item.tipo === 'fattura' ? 'FAT' : item.tipo === 'acquisto' ? 'ACQ' : (i18n.t('scadenzario.manuale.badge')) }}
                </span>
                {{ item.numero }}
              </td>
              <td style="padding:7px 10px;color:#374151">{{ item.controparte || '—' }}</td>
              <td style="padding:7px 10px;color:#64748b;font-size:12px">{{ item.dataScadenza ? (item.dataScadenza | date:'dd/MM/yyyy') : '—' }}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:600">{{ item.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:9px 10px;font-weight:600;background:#f8fafc;border-top:2px solid #e2e8f0">{{ 'scadenzario.dialog.totaleDaSaldare' | t }}</td>
            <td style="padding:9px 10px;text-align:right;font-weight:700;font-size:15px;background:#f8fafc;border-top:2px solid #e2e8f0;color:#1e293b">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
          </tr>
        </tfoot>
      </table>

      <!-- Parametri pagamento -->
      <div style="background:#f8fafc;border-radius:8px;padding:16px;border:1px solid #e2e8f0">
        <p style="margin:0 0 14px;font-size:12px;font-weight:600;text-transform:uppercase;color:#64748b;letter-spacing:.05em">{{ 'scadenzario.dialog.parametriPagamento' | t }}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <mat-form-field style="flex:1;min-width:160px">
            <mat-label>{{ 'scadenzario.dialog.dataPagamento' | t }}</mat-label>
            <input matInput type="date" [(ngModel)]="dataPagamento">
          </mat-form-field>
          <mat-form-field style="flex:2;min-width:200px">
            <mat-label>{{ 'scadenzario.dialog.tipoPagamento' | t }}</mat-label>
            <mat-select [(ngModel)]="tipoPagamentoId" (ngModelChange)="onTipoPagamentoChange()">
              <mat-option [value]="null">{{ 'scadenzario.dialog.nonSpecificato' | t }}</mat-option>
              @for (tp of tipiPagamento; track tp.id) {
                <mat-option [value]="tp.id">{{ tp.nome }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field style="flex:1;min-width:120px">
            <mat-label>{{ 'scadenzario.dialog.conto' | t }}</mat-label>
            <mat-select [(ngModel)]="conto">
              <mat-option value="BANCA">
                <mat-icon style="font-size:16px;vertical-align:middle;margin-right:4px">account_balance</mat-icon>{{ 'scadenzario.dialog.banca' | t }}
              </mat-option>
              <mat-option value="CASSA">
                <mat-icon style="font-size:16px;vertical-align:middle;margin-right:4px">account_balance_wallet</mat-icon>{{ 'scadenzario.dialog.cassa' | t }}
              </mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </div>

    </mat-dialog-content>

    <mat-dialog-actions align="end" style="padding:12px 24px 16px;gap:8px">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button [disabled]="!dataPagamento" (click)="confirm()"
              style="background:linear-gradient(135deg,#11769b,#0891b2);color:#fff">
        <mat-icon>check_circle</mat-icon>
        {{ i18n.t('scadenzario.dialog.confermaSaldo', { n: data.items.length }) }}
      </button>
    </mat-dialog-actions>
  `,
})
export class SaldoMultiploDialogComponent implements OnInit {
  i18n = inject(I18nService);
  tipiPagamento: TipoPagamento[] = [];
  dataPagamento = new Date().toISOString().substring(0, 10);
  tipoPagamentoId: number | null = null;
  conto: 'BANCA' | 'CASSA' = 'BANCA';

  get totale() { return this.data.items.reduce((s, i) => s + (i.totale ?? 0), 0); }

  constructor(
    public dialogRef: MatDialogRef<SaldoMultiploDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { items: ScadenzarioItem[] },
    private ds: DataService
  ) {}

  ngOnInit() {
    this.ds.getTipiPagamento().subscribe(t => { this.tipiPagamento = t.filter(x => x.attivo); });
  }

  onTipoPagamentoChange() {
    const tp = this.tipiPagamento.find(t => t.id === this.tipoPagamentoId);
    if (tp?.conto) this.conto = tp.conto as 'BANCA' | 'CASSA';
  }

  confirm() {
    if (!this.dataPagamento) return;
    this.dialogRef.close({ dataPagamento: this.dataPagamento, tipoPagamentoId: this.tipoPagamentoId, conto: this.conto });
  }
}

// ── Main Component ───────────────────────────────────────────────────────────
@Component({
  selector: 'app-scadenzario',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatSortModule, MatPaginatorModule,
    MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule, MatInputModule,
    MatTooltipModule, MatSnackBarModule, MatCheckboxModule, MatDialogModule,
    EmptyStateComponent, TPipe, TnPipe,
  ],
  templateUrl: './scadenzario.html',
  styleUrl: './scadenzario.scss',
})
export class ScadenzarioComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allItems: ScadenzarioItem[] = [];
  dataSource = new MatTableDataSource<ScadenzarioItem>();
  displayedColumns = ['select', 'direzione', 'numero', 'dataScadenza', 'controparte', 'totale', 'stato', 'giorni', 'azioni'];
  selection = new SelectionModel<ScadenzarioItem>(true, []);

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  // Filtri
  filtroMese = '';
  filtroVista: 'tutti' | 'in-scadenza' | 'scaduti' = 'tutti';

  readonly mesiOptions: { value: string; label: string }[] = this.buildMesiOptions();

  // KPI
  get totDaIncassare() {
    return this.allItems.filter(i => i.direzione === 'ENTRATA').reduce((s, i) => s + i.totale, 0);
  }
  get totDaPagare() {
    return this.allItems.filter(i => i.direzione === 'USCITA').reduce((s, i) => s + i.totale, 0);
  }
  get countScaduti() { return this.allItems.filter(i => i.scaduto).length; }
  get countInScadenza30() {
    return this.allItems.filter(i => !i.scaduto && i.giorniMancanti !== null && i.giorniMancanti <= 30).length;
  }

  get selectedTotal() { return this.selection.selected.reduce((s, i) => s + (i.totale ?? 0), 0); }

  isAllSelected() { return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  isIndeterminate() { return this.selection.hasValue() && !this.isAllSelected(); }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  constructor(
    private ds: DataService,
    private dialog: MatDialog,
    private snack: MatSnackBar
  ) {}

  ngOnInit() { this.load(); }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sortingDataAccessor = (item, prop) => {
      switch (prop) {
        case 'totale':       return item.totale ?? 0;
        case 'dataScadenza': return item.dataScadenza ?? '';
        case 'giorni':       return item.giorniMancanti ?? 99999;
        default:             return (item as any)[prop] ?? '';
      }
    };
  }

  load() {
    this.ds.getScadenzarioFull(this.filtroMese || undefined).subscribe({
      next: items => {
        this.allItems = items as ScadenzarioItem[];
        this.selection.clear();
        this.applyVista();
      },
      error: () => { this.allItems = []; this.applyVista(); },
    });
  }

  applyVista() {
    let data = [...this.allItems];
    if (this.filtroVista === 'scaduti')     data = data.filter(i => i.scaduto);
    if (this.filtroVista === 'in-scadenza') data = data.filter(i => !i.scaduto && i.giorniMancanti !== null && i.giorniMancanti <= 30);
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
  }

  onMeseChange() { this.load(); }
  setVista(v: 'tutti' | 'in-scadenza' | 'scaduti') { this.filtroVista = v; this.applyVista(); }

  async segnaPagato(item: ScadenzarioItem) {
    if (item.tipo === 'manuale') {
      const importoFmt = item.totale.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
      if (!await this.confirm.ask(this.i18n.t('scadenzario.msg.confermaSegnaPagato', { label: this.i18n.t('scadenzario.manuale.badge'), numero: item.controparte || '', importo: importoFmt }))) return;
      this.ds.saldaPagamento(item.id).subscribe({
        next: () => { this.snack.open(this.i18n.t('scadenzario.msg.pagamentoRegistrato'), '', { duration: 2500 }); this.load(); },
        error: () => this.snack.open(this.i18n.t('scadenzario.msg.errorePagamento'), '', { duration: 3000 }),
      });
      return;
    }
    const label = this.i18n.t(item.tipo === 'fattura' ? 'scadenzario.msg.fattura' : 'scadenzario.msg.acquisto');
    const importoFmt = item.totale.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    if (!await this.confirm.ask(this.i18n.t('scadenzario.msg.confermaSegnaPagato', { label, numero: item.numero, importo: importoFmt }))) return;
    const today = new Date().toISOString().substring(0, 10);
    this.ds.createPagamento({
      dataPagamento: today,
      importo: item.totale,
      metodo: 'Bonifico',
      tipo: item.direzione,
      conto: 'BANCA',
      fatturaId: item.tipo === 'fattura' ? item.id : null,
      acquistoId: item.tipo === 'acquisto' ? item.id : null,
    }).subscribe({
      next: () => { this.snack.open(this.i18n.t('scadenzario.msg.pagamentoRegistrato'), '', { duration: 2500 }); this.load(); },
      error: () => this.snack.open(this.i18n.t('scadenzario.msg.errorePagamento'), '', { duration: 3000 }),
    });
  }

  saldoMultiplo() {
    const items = this.selection.selected;
    if (!items.length) return;
    const manuali = items.filter(i => i.tipo === 'manuale');
    const altri = items.filter(i => i.tipo !== 'manuale');
    const eseguiManuali = () => forkJoin(manuali.map(i => this.ds.saldaPagamento(i.id)));

    if (!altri.length) {
      eseguiManuali().subscribe({
        next: () => { this.snack.open(this.i18n.tn('scadenzario.msg.pagamentiRegistrati', items.length), '', { duration: 2500 }); this.load(); },
        error: () => this.snack.open(this.i18n.t('scadenzario.msg.erroreSaldoMultiplo'), '', { duration: 3000 }),
      });
      return;
    }
    const ref = this.dialog.open(SaldoMultiploDialogComponent, {
      data: { items: [...altri] },
      width: '620px', maxWidth: '98vw',
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const { dataPagamento, tipoPagamentoId, conto } = result;
      const calls = [
        ...altri.map(item =>
          this.ds.createPagamento({
            dataPagamento,
            importo: item.totale,
            tipo: item.direzione,
            tipoPagamentoId: tipoPagamentoId || null,
            conto,
            fatturaId: item.tipo === 'fattura' ? item.id : null,
            acquistoId: item.tipo === 'acquisto' ? item.id : null,
          })
        ),
        ...(manuali.length ? [eseguiManuali()] : []),
      ];
      forkJoin(calls).subscribe({
        next: () => {
          this.snack.open(
            this.i18n.tn('scadenzario.msg.pagamentiRegistrati', items.length),
            '', { duration: 2500 }
          );
          this.load();
        },
        error: () => this.snack.open(this.i18n.t('scadenzario.msg.erroreSaldoMultiplo'), '', { duration: 3000 }),
      });
    });
  }

  giorniBadgeClass(item: ScadenzarioItem): string {
    if (item.scaduto) return 'badge-scaduto';
    if (item.giorniMancanti !== null && item.giorniMancanti <= 7) return 'badge-warning';
    return 'badge-ok';
  }

  private buildMesiOptions(): { value: string; label: string }[] {
    const today = new Date();
    const options: { value: string; label: string }[] = [];
    for (let delta = -5; delta <= 6; delta++) {
      const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const value = `${y}-${String(m + 1).padStart(2, '0')}`;
      options.push({ value, label: `${this.i18n.t('common.meseFull.' + (m + 1))} ${y}` });
    }
    return options;
  }
}
