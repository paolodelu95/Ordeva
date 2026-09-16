import { Component, OnInit, inject } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { ExcelService } from '../../services/excel.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';
import { isoOggi } from '../../utils/data-locale';

interface ReportTpl { key: string; nome: string; descrizione: string; categoria: string; parametri: string[]; }
interface ReportColonna { key: string; label: string; format: 'text' | 'int' | 'num' | 'eur' | 'pct' | 'date'; }
interface ReportResult { key: string; nome: string; parametri: any; colonne: ReportColonna[]; righe: any[]; totali: Record<string, number>; }

@Component({
  selector: 'app-reports',
  standalone: true,
  providers: [DatePipe, CurrencyPipe, DecimalPipe],
  imports: [
    CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule, MatSnackBarModule,
    TPipe, TnPipe,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">{{ 'reportsTabellari.title' | t }}</h1>
        <p style="color:#64748b;font-size:13px;margin:4px 0 0">
          {{ 'reportsTabellari.intro' | t }}
        </p>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="flex:1;min-width:260px">
            <mat-label>{{ 'reportsTabellari.reportLabel' | t }}</mat-label>
            <mat-select [(ngModel)]="selKey" (selectionChange)="onSelect()">
              @for (cat of categorie(); track cat) {
                <mat-optgroup [label]="cat">
                  @for (t of templatePerCategoria(cat); track t.key) {
                    <mat-option [value]="t.key">{{ t.nome }}</mat-option>
                  }
                </mat-optgroup>
              }
            </mat-select>
          </mat-form-field>

          @if (selTpl?.parametri?.includes('dataDa')) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic" style="max-width:160px">
              <mat-label>{{ 'reportsTabellari.dalLabel' | t }}</mat-label>
              <input matInput type="date" [(ngModel)]="dataDa">
            </mat-form-field>
          }
          @if (selTpl?.parametri?.includes('dataA')) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic" style="max-width:160px">
              <mat-label>{{ 'reportsTabellari.alLabel' | t }}</mat-label>
              <input matInput type="date" [(ngModel)]="dataA">
            </mat-form-field>
          }
          <button mat-flat-button (click)="esegui()" [disabled]="!selKey || loading">
            <mat-icon>play_arrow</mat-icon> {{ 'reportsTabellari.esegui' | t }}
          </button>
          @if (result) {
            <button mat-stroked-button (click)="exportExcel()">
              <mat-icon>download</mat-icon> {{ 'reportsTabellari.esportaExcel' | t }}
            </button>
            <button mat-stroked-button (click)="stampa()">
              <mat-icon>print</mat-icon> {{ 'reportsTabellari.stampa' | t }}
            </button>
          }
        </div>

        @if (selTpl?.descrizione) {
          <p style="font-size:12px;color:#64748b;margin:12px 0 0">{{ selTpl?.descrizione }}</p>
        }
      </div>

      @if (loading) {
        <div style="text-align:center;padding:32px"><mat-spinner diameter="32" style="margin:0 auto"></mat-spinner></div>
      } @else if (result) {
        <div class="card" #reportArea>
          <h3 style="margin:0 0 12px">{{ result.nome }}</h3>
          @if (result.righe.length === 0) {
            <p style="color:#94a3b8;text-align:center;padding:24px">{{ 'reportsTabellari.nessunDato' | t }}</p>
          } @else {
            <table class="rep-table">
              <thead>
                <tr>
                  @for (c of result.colonne; track c.key) {
                    <th [class.right]="isNumeric(c.format)">{{ c.label }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of result.righe; track $index) {
                  <tr>
                    @for (c of result.colonne; track c.key) {
                      <td [class.right]="isNumeric(c.format)">{{ formatCell(row[c.key], c.format) }}</td>
                    }
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  @for (c of result.colonne; track c.key; let i = $index) {
                    <td [class.right]="isNumeric(c.format)">
                      @if (i === 0) { <b>{{ 'reportsTabellari.totali' | t }}</b> }
                      @else if (result.totali[c.key] !== undefined) {
                        <b>{{ formatCell(result.totali[c.key], c.format) }}</b>
                      }
                    </td>
                  }
                </tr>
              </tfoot>
            </table>
            <p style="font-size:11px;color:#94a3b8;margin-top:12px">{{ result.righe.length | tn:'reportsTabellari.msg.righe' }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; max-width: 1400px; margin: 0 auto; }
    .page-header { margin-bottom: 16px; }
    .page-title { font-size: 24px; font-weight: 700; margin: 0; }
    .card { background: var(--bg-surface, #fff); border-radius: 10px; padding: 16px; border: 1px solid var(--border-subtle, #e2e8f0); }

    .rep-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .rep-table th { background: var(--bg-surface-2, #f8fafc); padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-tertiary, #64748b); border-bottom: 1px solid var(--border-subtle, #e2e8f0); }
    .rep-table td { padding: 6px 10px; border-bottom: 1px solid var(--border-subtle, #f1f5f9); }
    .rep-table tfoot td { background: var(--bg-surface-2, #f8fafc); border-top: 2px solid var(--border-subtle, #e2e8f0); border-bottom: none; padding: 10px; }
    .rep-table .right, .rep-table th.right { text-align: right; font-variant-numeric: tabular-nums; }

    @media print {
      .page-header, .card.no-print { display: none; }
      .card { border: none; padding: 0; }
    }
  `],
})
export class ReportsComponent implements OnInit {
  private i18n = inject(I18nService);
  templates: ReportTpl[] = [];
  selKey: string = '';
  get selTpl(): ReportTpl | undefined { return this.templates.find(t => t.key === this.selKey); }

  dataDa = `${new Date().getFullYear()}-01-01`;
  dataA = isoOggi();

  loading = false;
  result: ReportResult | null = null;

  constructor(private api: ApiService, private snack: MatSnackBar,
              private excel: ExcelService,
              private currency: CurrencyPipe, private number: DecimalPipe, private date: DatePipe) {}

  ngOnInit() {
    this.api.get<ReportTpl[]>('reports').subscribe(t => this.templates = t);
  }

  categorie(): string[] {
    const seen = new Set<string>();
    return this.templates.filter(t => { if (seen.has(t.categoria)) return false; seen.add(t.categoria); return true; }).map(t => t.categoria);
  }
  templatePerCategoria(cat: string): ReportTpl[] {
    return this.templates.filter(t => t.categoria === cat);
  }
  onSelect() { this.result = null; }

  isNumeric(f: string): boolean { return ['int', 'num', 'eur', 'pct'].includes(f); }

  formatCell(v: any, fmt: string): string {
    if (v == null || v === '') return '';
    switch (fmt) {
      case 'eur': return this.currency.transform(v, 'EUR', 'symbol', '1.2-2', 'it') || '';
      case 'pct': return (Number(v) || 0).toFixed(2) + '%';
      case 'int': return this.number.transform(v, '1.0-0', 'it') || '';
      case 'num': return this.number.transform(v, '1.0-2', 'it') || '';
      case 'date': return this.date.transform(v, 'dd/MM/yyyy') || String(v);
      default:    return String(v);
    }
  }

  esegui() {
    if (!this.selKey) return;
    this.loading = true;
    const parametri: any = {};
    if (this.selTpl?.parametri.includes('dataDa')) parametri.dataDa = this.dataDa;
    if (this.selTpl?.parametri.includes('dataA')) parametri.dataA = this.dataA;
    this.api.post<ReportResult>('reports/run', { key: this.selKey, parametri }).subscribe({
      next: r => { this.result = r; this.loading = false; },
      error: e => { this.loading = false; this.snack.open(this.i18n.t('reportsTabellari.msg.errore', { err: e.error?.error || e.message }), this.i18n.t('reportsTabellari.msg.ok'), { duration: 4000 }); },
    });
  }

  exportExcel() {
    if (!this.result) return;
    const cols = this.result.colonne.map(c => ({ header: c.label, field: c.key as any }));
    const fileName = `${this.result.key}_${this.dataDa}_${this.dataA}`.replace(/[^\w-]/g, '_');
    this.excel.export(this.result.righe, cols, fileName);
  }

  stampa() {
    window.print();
  }
}
