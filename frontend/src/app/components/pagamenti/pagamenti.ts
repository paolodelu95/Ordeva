import { inject, Component, OnInit, Inject } from '@angular/core';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SelectionModel } from '@angular/cdk/collections';
import { forkJoin } from 'rxjs';
import { DataService } from '../../services/data.service';
import { Pagamento, Fattura, TipoPagamento, ScadenzarioEntry, CausalePagamento } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

// ── Salda singolo ─────────────────────────────────────────────────────────────
interface SaldaData { entry: ScadenzarioEntry; tipiPagamento: TipoPagamento[]; }

@Component({
  selector: 'app-salda-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('pagamenti.saldaDialog.title', { numero: data.entry.numero }) }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form" (keydown.enter)="save()">
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.saldaDialog.importo' | t }}</mat-label>
          <input matInput type="number" step="0.01" formControlName="importo">
          <mat-hint>{{ i18n.t('pagamenti.saldaDialog.rimane', { importo: (data.entry.rimanente | currency:'EUR':'symbol':'1.2-2':'it') ?? '' }) }}</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.saldaDialog.dataSaldo' | t }}</mat-label>
          <input matInput type="date" formControlName="dataPagamento">
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.saldaDialog.metodoPagamento' | t }}</mat-label>
          <mat-select formControlName="tipoPagamentoId">
            <mat-option [value]="null">{{ 'pagamenti.saldaDialog.nessuno' | t }}</mat-option>
            @for (t of data.tipiPagamento; track t.id) {
              <mat-option [value]="t.id">{{ t.nome }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.invalid">{{ 'pagamenti.saldaDialog.confermaSaldo' | t }}</button>
    </mat-dialog-actions>`
})
export class SaldaDialogComponent {
  i18n = inject(I18nService);
  form: FormGroup;
  constructor(private fb: FormBuilder, public dialogRef: MatDialogRef<SaldaDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: SaldaData) {
    this.form = this.fb.group({
      importo:         [data.entry.rimanente, [Validators.required, Validators.min(0.01)]],
      dataPagamento:   [new Date().toISOString().substring(0, 10), Validators.required],
      tipoPagamentoId: [null],
    });
  }
  save() { if (this.form.valid) this.dialogRef.close(this.form.value); }
}

// ── Salda multiplo ────────────────────────────────────────────────────────────
interface SaldaMultiploData { entries: ScadenzarioEntry[]; tipiPagamento: TipoPagamento[]; }

@Component({
  selector: 'app-salda-multiplo-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('pagamenti.saldaMultiploDialog.title', { n: data.entries.length }) }}</h2>
    <mat-dialog-content>
      <p style="margin:0 0 16px;color:var(--text-secondary)">
        {{ 'pagamenti.saldaMultiploDialog.totale' | t }} <b style="color:var(--text-primary)">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
      </p>
      <form [formGroup]="form" class="dialog-form" (keydown.enter)="save()">
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.saldaDialog.dataSaldo' | t }}</mat-label>
          <input matInput type="date" formControlName="dataPagamento">
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.saldaDialog.metodoPagamento' | t }}</mat-label>
          <mat-select formControlName="tipoPagamentoId">
            <mat-option [value]="null">{{ 'pagamenti.saldaDialog.nessuno' | t }}</mat-option>
            @for (t of data.tipiPagamento; track t.id) {
              <mat-option [value]="t.id">{{ t.nome }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.invalid">{{ 'pagamenti.saldaDialog.confermaSaldo' | t }}</button>
    </mat-dialog-actions>`
})
export class SaldaMultiploDialogComponent {
  i18n = inject(I18nService);
  form: FormGroup;
  get totale() { return this.data.entries.reduce((s, e) => s + e.rimanente, 0); }
  constructor(private fb: FormBuilder, public dialogRef: MatDialogRef<SaldaMultiploDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: SaldaMultiploData) {
    this.form = this.fb.group({
      dataPagamento:   [new Date().toISOString().substring(0, 10), Validators.required],
      tipoPagamentoId: [null],
    });
  }
  save() { if (this.form.valid) this.dialogRef.close(this.form.value); }
}

// ── Pagamento manuale dialog ──────────────────────────────────────────────────
@Component({
  selector: 'app-pagamento-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule,
            MatSlideToggleModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'pagamenti.dialog.modificaTitle' : 'pagamenti.nuovoPagamento') | t }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <div class="form-row">
          <mat-form-field appearance="outline">
            <mat-label>{{ 'pagamenti.dialog.data' | t }}</mat-label>
            <input matInput type="date" formControlName="dataPagamento">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'pagamenti.dialog.importo' | t }}</mat-label>
            <input matInput type="number" step="0.01" formControlName="importo">
            <span matTextPrefix>€&nbsp;</span>
          </mat-form-field>
        </div>
        <div class="form-row">
          <mat-form-field appearance="outline">
            <mat-label>{{ 'pagamenti.dialog.tipo' | t }}</mat-label>
            <mat-select formControlName="tipo">
              <mat-option value="ENTRATA">{{ 'pagamenti.tipoEntry.entrata' | t }}</mat-option>
              <mat-option value="USCITA">{{ 'pagamenti.tipoEntry.uscita' | t }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'pagamenti.saldaDialog.metodoPagamento' | t }}</mat-label>
            <mat-select formControlName="tipoPagamentoId">
              <mat-option [value]="null">{{ 'pagamenti.saldaDialog.nessuno' | t }}</mat-option>
              @for (t of tipiPagamento; track t.id) {
                <mat-option [value]="t.id">{{ t.nome }}</mat-option>
              }
            </mat-select>
            <mat-hint>{{ 'pagamenti.dialog.contoHint' | t }}</mat-hint>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.dialog.causale' | t }}</mat-label>
          <mat-select formControlName="causale">
            <mat-option [value]="''">{{ 'pagamenti.dialog.nessuna' | t }}</mat-option>
            @for (c of causali; track c.id) {
              <mat-option [value]="c.nome">{{ c.nome }}</mat-option>
            }
          </mat-select>
          <mat-hint>{{ 'pagamenti.dialog.causaleHint' | t }}</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.dialog.fatturaCollegata' | t }}</mat-label>
          <mat-select formControlName="fatturaId">
            <mat-option [value]="null">{{ 'pagamenti.dialog.nessuna' | t }}</mat-option>
            @for (f of fatture; track f.id) {
              <mat-option [value]="f.id">{{ f.numero }} — {{ f.clienteNome }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'pagamenti.dialog.note' | t }}</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
        <mat-slide-toggle formControlName="saldato">
          {{ 'pagamenti.dialog.saldato' | t }}
        </mat-slide-toggle>
        <p style="color:#64748b;font-size:12px;margin:6px 0 0">
          {{ 'pagamenti.dialog.saldatoHint' | t }}
        </p>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.invalid">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class PagamentoDialogComponent implements OnInit {
  i18n = inject(I18nService);
  form: FormGroup;
  fatture: Fattura[] = [];
  tipiPagamento: TipoPagamento[] = [];
  causali: CausalePagamento[] = [];

  constructor(private fb: FormBuilder, private ds: DataService,
              public dialogRef: MatDialogRef<PagamentoDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: Pagamento | null) {
    this.form = this.fb.group({
      dataPagamento:   [data?.dataPagamento ?? new Date().toISOString().substring(0, 10), Validators.required],
      importo:         [data?.importo ?? '', [Validators.required, Validators.min(0.01)]],
      fatturaId:       [data?.fatturaId ?? null],
      tipo:            [data?.tipo ?? 'ENTRATA'],
      causale:         [data?.causale ?? ''],
      tipoPagamentoId: [data?.tipoPagamentoId ?? null],
      note:            [data?.note ?? ''],
      saldato:         [data?.saldato ?? true],
    });
  }

  ngOnInit() {
    this.ds.getFatture().subscribe(f => this.fatture = f.filter(x => x.stato !== 'ANNULLATA'));
    this.ds.getTipiPagamento().subscribe(t => this.tipiPagamento = t.filter(x => x.attivo));
    this.ds.getCausali().subscribe(c => this.causali = c.filter(x => x.attivo !== false));
  }

  save() { if (this.form.valid) this.dialogRef.close({ ...this.data, ...this.form.value }); }
}

// ── Componente principale ─────────────────────────────────────────────────────
@Component({
  selector: 'app-pagamenti',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatButtonToggleModule,
            FormsModule, MatCheckboxModule, MatSelectModule, MatFormFieldModule, MatMenuModule, EmptyStateComponent,
            MatPaginatorModule, TPipe, TnPipe],
  templateUrl: './pagamenti.html',
  styleUrl: './pagamenti.scss'
})
export class PagamentiComponent implements OnInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allPagamenti: Pagamento[] = [];
  private allScadenzario: ScadenzarioEntry[] = [];
  tipiPagamento: TipoPagamento[] = [];
  filtro = 'TUTTI';
  selection = new SelectionModel<ScadenzarioEntry>(true, []);
  readonly oggi = new Date().toISOString().substring(0, 10);
  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));

  filtroAnno: number | null = null;
  filtroMese: number | null = null;
  filtroControparte: string | null = null;

  pagamentiCols = ['data', 'tipo', 'importo', 'documento', 'controparte', 'tipoPagamentoNome', 'conto', 'azioni'];
  scadenzarioCols = ['select', 'tipo', 'numero', 'dataEmissione', 'dataScadenza', 'controparte', 'rimanente', 'azioni'];
  scadenzarioColsTutti = ['tipo', 'numero', 'dataEmissione', 'dataScadenza', 'controparte', 'rimanente', 'azioni'];

  pagSortCol = 'data'; pagSortDir: 'asc'|'desc' = 'desc';
  scadSortCol = 'dataScadenza'; scadSortDir: 'asc'|'desc' = 'asc';

  onPagSort(s: { active: string; direction: string }) { this.pagSortCol = s.active; this.pagSortDir = (s.direction || 'desc') as 'asc'|'desc'; this.pagPageIndex = 0; }
  onScadSort(s: { active: string; direction: string }) { this.scadSortCol = s.active; this.scadSortDir = (s.direction || 'asc') as 'asc'|'desc'; }

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar) {}

  ngOnInit() {
    forkJoin({
      pagamenti: this.ds.getPagamenti(),
      scadenzario: this.ds.getScadenzario(),
      tipi: this.ds.getTipiPagamento(),
    }).subscribe(r => {
      this.allPagamenti = r.pagamenti;
      this.allScadenzario = r.scadenzario;
      this.tipiPagamento = r.tipi.filter(t => t.attivo);
    });
  }

  load() {
    this.selection.clear();
    if (this.filtro === 'DA_SALDARE') {
      this.ds.getScadenzario().subscribe(s => { this.allScadenzario = s; });
    } else if (this.filtro === 'TUTTI') {
      forkJoin({ pagamenti: this.ds.getPagamenti(), scadenzario: this.ds.getScadenzario() })
        .subscribe(r => { this.allPagamenti = r.pagamenti; this.allScadenzario = r.scadenzario; });
    } else {
      this.ds.getPagamenti(this.filtro).subscribe(p => { this.allPagamenti = p; });
    }
  }

  resetFiltri() { this.filtroAnno = null; this.filtroMese = null; this.filtroControparte = null; }

  print() {
    const t = (k: string) => this.i18n.t(k);
    const d = (s: string) => { const p = (s||'').substring(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:'—'; };
    const e = (n: number|undefined) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n??0);
    let html: string;
    if (this.filtro === 'DA_SALDARE') {
      const rows = this.selection.hasValue() ? this.selection.selected : this.scadenzario;
      const body = rows.map(r=>`<tr><td>${r.tipoEntry}</td><td>${r.numero}</td><td>${d(r.dataEmissione)}</td><td>${d(r.dataScadenza||'')}</td><td>${r.controparte||'—'}</td><td class="r">${e(r.rimanente)}</td></tr>`).join('');
      const title = t('pagamenti.print.daSaldareTitle');
      html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${title}</h1><table><thead><tr><th>${t('pagamenti.col.tipo')}</th><th>${t('pagamenti.col.numero')}</th><th>${t('pagamenti.col.data')}</th><th>${t('pagamenti.col.scadenza')}</th><th>${t('pagamenti.col.clienteFornitore')}</th><th class="r">${t('pagamenti.col.rimanente')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    } else {
      const rows = this.pagamenti;
      const body = rows.map(p=>`<tr><td>${d(p.dataPagamento)}</td><td>${p.tipo||'—'}</td><td class="r">${e(p.importo)}</td><td>${p.clienteNome||p.fornitoreNome||'—'}</td><td>${p.metodo||'—'}</td></tr>`).join('');
      const title = this.filtro === 'ENTRATE' ? t('pagamenti.print.entrateTitle') : this.filtro === 'USCITE' ? t('pagamenti.print.usciteTitle') : t('pagamenti.title');
      html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${title}</h1><table><thead><tr><th>${t('pagamenti.col.data')}</th><th>${t('pagamenti.col.tipo')}</th><th class="r">${t('pagamenti.col.importo')}</th><th>${t('pagamenti.col.clienteFornitore')}</th><th>${t('pagamenti.col.metodo')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    }
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  get anni() {
    if (this.filtro === 'DA_SALDARE')
      return [...new Set(this.allScadenzario.map(e => +e.dataEmissione.substring(0, 4)))].sort().reverse();
    if (this.filtro === 'TUTTI')
      return [...new Set([
        ...this.allPagamenti.map(p => +p.dataPagamento.substring(0, 4)),
        ...this.allScadenzario.map(e => +e.dataEmissione.substring(0, 4)),
      ])].sort().reverse();
    return [...new Set(this.allPagamenti.map(p => +p.dataPagamento.substring(0, 4)))].sort().reverse();
  }

  get controparti() {
    if (this.filtro === 'DA_SALDARE')
      return [...new Set(this.allScadenzario.map(e => e.controparte).filter(Boolean))].sort() as string[];
    if (this.filtro === 'TUTTI')
      return [...new Set([
        ...this.allPagamenti.map(p => p.clienteNome || p.fornitoreNome).filter(Boolean),
        ...this.allScadenzario.map(e => e.controparte).filter(Boolean),
      ] as string[])].sort();
    return [...new Set(this.allPagamenti.map(p => p.clienteNome || p.fornitoreNome).filter(Boolean))].sort() as string[];
  }

  pagPageIndex = 0;
  pagPageSize = 25;

  onPagPage(e: PageEvent) { this.pagPageIndex = e.pageIndex; this.pagPageSize = e.pageSize; }

  /** Pagina corrente di `pagamenti` per la tabella (B.8): con dati reali la lista
   *  può superare le 200 righe. Riallinea l'indice se un filtro ne riduce il totale
   *  sotto la pagina in cui l'utente si trovava, invece di mostrarne una vuota. */
  get pagamentiPagina(): Pagamento[] {
    const data = this.pagamenti;
    return data.slice(this.pagPageIndexClamped * this.pagPageSize, (this.pagPageIndexClamped + 1) * this.pagPageSize);
  }

  get pagPageIndexClamped(): number {
    const maxIndex = Math.max(0, Math.ceil(this.pagamenti.length / this.pagPageSize) - 1);
    return Math.min(this.pagPageIndex, maxIndex);
  }

  get pagamenti(): Pagamento[] {
    let data = this.allPagamenti;
    if (this.filtroAnno) data = data.filter(p => +p.dataPagamento.substring(0, 4) === this.filtroAnno);
    if (this.filtroMese) data = data.filter(p => +p.dataPagamento.substring(5, 7) === this.filtroMese);
    if (this.filtroControparte) data = data.filter(p => (p.clienteNome || p.fornitoreNome) === this.filtroControparte);
    const dir = this.pagSortDir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      switch (this.pagSortCol) {
        case 'dataPagamento': return (a.dataPagamento || '').localeCompare(b.dataPagamento || '') * dir;
        case 'importo':       return ((a.importo ?? 0) - (b.importo ?? 0)) * dir;
        case 'controparte':   return ((a.clienteNome || a.fornitoreNome || '') as string).localeCompare((b.clienteNome || b.fornitoreNome || '') as string) * dir;
        default:              return ((a as any)[this.pagSortCol] || '').localeCompare((b as any)[this.pagSortCol] || '') * dir;
      }
    });
  }

  get scadenzario(): ScadenzarioEntry[] {
    let data = this.allScadenzario;
    if (this.filtroAnno) data = data.filter(e => +e.dataEmissione.substring(0, 4) === this.filtroAnno);
    if (this.filtroMese) data = data.filter(e => +e.dataEmissione.substring(5, 7) === this.filtroMese);
    if (this.filtroControparte) data = data.filter(e => e.controparte === this.filtroControparte);
    const dir = this.scadSortDir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      switch (this.scadSortCol) {
        case 'rimanente':    return ((a.rimanente ?? 0) - (b.rimanente ?? 0)) * dir;
        case 'controparte':  return (a.controparte || '').localeCompare(b.controparte || '') * dir;
        default:             return ((a as any)[this.scadSortCol] || '').localeCompare((b as any)[this.scadSortCol] || '') * dir;
      }
    });
  }

  get totaleEntrate()     { return this.pagamenti.filter(p => p.tipo === 'ENTRATA').reduce((s, p) => s + p.importo, 0); }
  get totaleUscite()      { return this.pagamenti.filter(p => p.tipo === 'USCITA').reduce((s, p) => s + p.importo, 0); }
  get daSaldareEntrate()  { return this.scadenzario.filter(e => this.entryDirezione(e) === 'ENTRATA').reduce((s, e) => s + e.rimanente, 0); }
  get daSaldareUscite()   { return this.scadenzario.filter(e => this.entryDirezione(e) === 'USCITA').reduce((s, e) => s + e.rimanente, 0); }
  get totaleSelezionato() { return this.selection.selected.reduce((s, e) => s + e.rimanente, 0); }

  /** Verso di una voce di scadenzario: FATTURA=incasso, ACQUISTO=pagamento,
   *  PAGAMENTO_MANUALE=dal proprio campo `tipo` (ENTRATA/USCITA). */
  entryDirezione(e: ScadenzarioEntry): 'ENTRATA' | 'USCITA' {
    if (e.tipoEntry === 'FATTURA') return 'ENTRATA';
    if (e.tipoEntry === 'ACQUISTO') return 'USCITA';
    return e.tipo ?? 'ENTRATA';
  }

  isScaduta(e: ScadenzarioEntry) { return e.dataScadenza && e.dataScadenza < this.oggi; }

  isAllSelected() { return this.scadenzario.length > 0 && this.selection.selected.length === this.scadenzario.length; }
  masterToggle() {
    if (this.isAllSelected()) this.selection.clear();
    else this.scadenzario.forEach(e => this.selection.select(e));
  }

  open(p?: Pagamento) {
    const ref = this.dialog.open(PagamentoDialogComponent, { data: p ?? null, width: '720px' });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updatePagamento(result) : this.ds.createPagamento(result);
      op.subscribe({ next: () => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.salvato'), '', { duration: 2000 }); },
                     error: e => this.snack.open(e.message, '', { duration: 3000 }) });
    });
  }

  async delete(p: Pagamento) {
    const doc = p.fatturaNumero ? this.i18n.t('pagamenti.msg.docFattura', { numero: p.fatturaNumero })
              : p.acquistoNumero ? this.i18n.t('pagamenti.msg.docAcquisto', { numero: p.acquistoNumero })
              : this.i18n.t('pagamenti.msg.docGenerico');
    if (!await this.confirm.delete(this.i18n.t('pagamenti.msg.confermaElimina', { importo: p.importo, doc }))) return;
    this.ds.deletePagamento(p.id!).subscribe(() => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.saldoAnnullato'), '', { duration: 2000 }); });
  }

  salda(entry: ScadenzarioEntry) {
    if (entry.tipoEntry === 'PAGAMENTO_MANUALE') {
      this.ds.saldaPagamento(entry.id).subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.saldato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.message, '', { duration: 3000 })
      });
      return;
    }
    const ref = this.dialog.open(SaldaDialogComponent, {
      data: { entry, tipiPagamento: this.tipiPagamento },
      width: '440px',
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      this.registraPagamento(entry, result).subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.saldato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.message, '', { duration: 3000 })
      });
    });
  }

  saldaSelezionati() {
    const selected = this.selection.selected;
    if (!selected.length) return;
    const manuali = selected.filter(e => e.tipoEntry === 'PAGAMENTO_MANUALE');
    const altri = selected.filter(e => e.tipoEntry !== 'PAGAMENTO_MANUALE');

    const eseguiManuali = () => forkJoin(manuali.map(e => this.ds.saldaPagamento(e.id)));

    if (!altri.length) {
      eseguiManuali().subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.vociSaldate', { n: selected.length }), '', { duration: 2500 }); },
        error: e => this.snack.open(e.message, '', { duration: 3000 })
      });
      return;
    }
    const ref = this.dialog.open(SaldaMultiploDialogComponent, {
      data: { entries: altri, tipiPagamento: this.tipiPagamento },
      width: '440px',
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const requests = [
        ...altri.map(entry => this.registraPagamento(entry, { ...result, importo: entry.rimanente })),
        ...(manuali.length ? [eseguiManuali()] : []),
      ];
      forkJoin(requests).subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('pagamenti.msg.vociSaldate', { n: selected.length }), '', { duration: 2500 }); },
        error: e => this.snack.open(e.message, '', { duration: 3000 })
      });
    });
  }

  private registraPagamento(entry: ScadenzarioEntry, result: any) {
    const tipoSel = this.tipiPagamento.find(t => t.id === result.tipoPagamentoId);
    return this.ds.createPagamento({
      dataPagamento:   result.dataPagamento,
      importo:         result.importo,
      tipo:            entry.tipoEntry === 'FATTURA' ? 'ENTRATA' : 'USCITA',
      conto:           tipoSel?.conto ?? entry.conto ?? 'BANCA',
      fatturaId:       entry.tipoEntry === 'FATTURA'  ? entry.id : null,
      acquistoId:      entry.tipoEntry === 'ACQUISTO' ? entry.id : null,
      tipoPagamentoId: result.tipoPagamentoId ?? null,
      metodo:          tipoSel?.nome ?? entry.tipoPagamentoNome ?? 'Bonifico',
      note:            '',
    } as Pagamento);
  }
}
