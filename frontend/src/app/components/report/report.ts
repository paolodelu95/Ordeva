import { Component, OnInit, AfterViewInit, OnDestroy, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Chart, registerables } from 'chart.js';
import { DataService } from '../../services/data.service';
import { ExcelService } from '../../services/excel.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

Chart.register(...registerables);

function fmtEuro(v: number): string {
  if (v >= 1_000_000) return '€' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000)     return '€' + (v / 1_000).toFixed(0) + 'k';
  return '€' + v.toFixed(0);
}

@Component({
  selector: 'app-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule, MatTabsModule,
            MatSelectModule, MatFormFieldModule, MatProgressSpinnerModule, MatTooltipModule, TPipe, TnPipe],
  templateUrl: './report.html',
  styleUrl: './report.scss'
})
export class ReportComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  mesi = Array.from({ length: 12 }, (_, i) => this.i18n.t(`fatture.mese.${i + 1}`));

  @ViewChild('chartYoy')      chartYoyRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartMargine')  chartMargineRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCategorie') chartCatRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartStagione') chartStagRef!: ElementRef<HTMLCanvasElement>;

  loading = true;
  loadError = false;
  bi: any = null;
  margini: any = null;
  annoSel = new Date().getFullYear();
  anni = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  abcFiltro: 'A' | 'B' | 'C' | 'tutti' = 'tutti';

  private charts: Chart[] = [];
  private viewReady = false;
  private dataReady = false;

  constructor(private ds: DataService, private excel: ExcelService) {}

  ngOnInit() { this.load(); }

  ngAfterViewInit() {
    this.viewReady = true;
    if (this.dataReady) this.buildCharts();
  }

  ngOnDestroy() { this.destroyCharts(); }

  load() {
    this.loading = true;
    this.loadError = false;
    this.dataReady = false;
    this.destroyCharts();
    this.ds.getMargini(this.annoSel).subscribe({ next: m => this.margini = m ?? {}, error: () => this.margini = {} });
    this.ds.getBiStats(this.annoSel).subscribe({
      next: data => {
        this.bi = data ?? {};
        this.loading = false;
        this.dataReady = true;
        if (this.viewReady) setTimeout(() => this.buildCharts(), 50);
      },
      error: () => {
        this.loading = false;
        this.loadError = true;
        this.bi = {};
      }
    });
  }

  get abcVisibili() {
    if (!this.bi?.abcClienti) return [];
    return this.abcFiltro === 'tutti'
      ? this.bi.abcClienti
      : this.bi.abcClienti.filter((c: any) => c.classe === this.abcFiltro);
  }

  get kpiFatturato() {
    if (!this.bi?.fatturaMensile) return 0;
    return this.bi.fatturaMensile
      .filter((r: any) => r.mese.startsWith(this.annoSel.toString()))
      .reduce((s: number, r: any) => s + r.fatturato, 0);
  }

  get kpiFatturatoPrec() {
    if (!this.bi?.fatturaMensile) return 0;
    return this.bi.fatturaMensile
      .filter((r: any) => r.mese.startsWith(this.bi.annoPrec))
      .reduce((s: number, r: any) => s + r.fatturato, 0);
  }

  get kpiCosti() {
    if (!this.bi?.acquistiMensili) return 0;
    return this.bi.acquistiMensili
      .filter((r: any) => r.mese.startsWith(this.annoSel.toString()))
      .reduce((s: number, r: any) => s + r.costi, 0);
  }

  get kpiMargine() { return this.kpiFatturato - this.kpiCosti; }
  get kpiMarginePerc() { return this.kpiFatturato > 0 ? (this.kpiMargine / this.kpiFatturato) * 100 : 0; }
  get kpiVariazione() {
    if (!this.kpiFatturatoPrec) return null;
    return ((this.kpiFatturato - this.kpiFatturatoPrec) / this.kpiFatturatoPrec) * 100;
  }

  get maxStagionalita(): number {
    if (!this.bi?.stagionalita?.length) return 1;
    return Math.max(...this.bi.stagionalita.map((s: any) => s.media ?? 0)) || 1;
  }

  // ── Highlight cards ─────────────────────────────────────────────────────────
  get clienteTop(): { nome: string; fatturato: number; numFatture?: number } | null {
    const arr = this.bi?.abcClienti;
    if (!arr?.length) return null;
    return arr[0];
  }

  get prodottoTop(): { codice: string; ricavi: number; marginePerc?: number } | null {
    const arr = this.bi?.prodottiMargini;
    if (!arr?.length) return null;
    return arr.slice().sort((a: any, b: any) => (b.ricavi ?? 0) - (a.ricavi ?? 0))[0];
  }

  get meseTop(): { mese: string; fatturato: number } | null {
    const arr = this.bi?.fatturaMensile?.filter((r: any) => r.mese.startsWith(this.annoSel.toString()));
    if (!arr?.length) return null;
    const top = arr.slice().sort((a: any, b: any) => (b.fatturato ?? 0) - (a.fatturato ?? 0))[0];
    if (!top?.fatturato) return null;
    const idx = parseInt(top.mese.split('-')[1], 10) - 1;
    return { mese: this.mesi[idx] || top.mese, fatturato: top.fatturato };
  }

  get hasData(): boolean {
    return (this.kpiFatturato || 0) > 0 || (this.kpiCosti || 0) > 0;
  }

  private buildCharts() {
    this.destroyCharts();
    this.buildYoyChart();
    this.buildMargineChart();
    this.buildCategorieChart();
    this.buildStagionalitaChart();
  }

  private buildYoyChart() {
    if (!this.chartYoyRef) return;
    const annoStr = this.annoSel.toString();
    const precStr = this.bi.annoPrec;

    const mesiFattura = (mese: string) => {
      const m = this.bi.fatturaMensile.find((r: any) => r.mese === mese);
      return m?.fatturato ?? 0;
    };

    const labels = this.mesi;
    const dataCorr = labels.map((_, i) => mesiFattura(`${annoStr}-${String(i+1).padStart(2,'0')}`));
    const dataPrec = labels.map((_, i) => mesiFattura(`${precStr}-${String(i+1).padStart(2,'0')}`));

    this.charts.push(new Chart(this.chartYoyRef.nativeElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: `${annoStr}`, data: dataCorr, backgroundColor: 'rgba(21, 164, 162,0.8)', borderRadius: 4 },
          { label: `${precStr}`, data: dataPrec, backgroundColor: 'rgba(21, 164, 162,0.2)', borderRadius: 4 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { ticks: { callback: (v: any) => fmtEuro(+v) } }
        }
      }
    }));
  }

  private buildMargineChart() {
    if (!this.chartMargineRef) return;
    const annoStr = this.annoSel.toString();
    const labels = this.mesi;
    const fat = labels.map((_, i) => {
      const m = this.bi.fatturaMensile.find((r: any) => r.mese === `${annoStr}-${String(i+1).padStart(2,'0')}`);
      return m?.imponibile ?? 0;
    });
    const acq = labels.map((_, i) => {
      const m = this.bi.acquistiMensili.find((r: any) => r.mese === `${annoStr}-${String(i+1).padStart(2,'0')}`);
      return m?.costi ?? 0;
    });
    const margini = fat.map((f, i) => f - acq[i]);

    this.charts.push(new Chart(this.chartMargineRef.nativeElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: this.i18n.t('andamento.legend.ricavi'), data: fat, backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 4, stack: 'a' },
          { label: this.i18n.t('andamento.legend.costi'), data: acq, backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4, stack: 'b' },
          { type: 'line', label: this.i18n.t('andamento.legend.margine'), data: margini, borderColor: '#11769b',
            backgroundColor: 'rgba(21, 164, 162,0.1)', tension: 0.4, fill: true, pointRadius: 3 } as any,
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
          y: { ticks: { callback: (v: any) => fmtEuro(+v) } }
        }
      }
    }));
  }

  private buildCategorieChart() {
    if (!this.chartCatRef || !this.bi?.categorie?.length) return;
    const top = this.bi.categorie.slice(0, 8);
    const colors = ['#11769b','#22c55e','#f59e0b','#ef4444','#06b6d4','#0891b2','#ec4899','#14b8a6'];
    this.charts.push(new Chart(this.chartCatRef.nativeElement, {
      type: 'doughnut',
      data: {
        labels: top.map((c: any) => c.categoria),
        datasets: [{ data: top.map((c: any) => c.imponibile), backgroundColor: colors, borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => ` €${(ctx.raw as number).toLocaleString('it')}` } }
        }
      }
    }));
  }

  private buildStagionalitaChart() {
    if (!this.chartStagRef || !this.bi?.stagionalita?.length) return;
    const byMese = new Array(12).fill(0);
    this.bi.stagionalita.forEach((s: any) => { byMese[parseInt(s.mese_num) - 1] = s.media ?? 0; });
    this.charts.push(new Chart(this.chartStagRef.nativeElement, {
      type: 'radar',
      data: {
        labels: this.mesi,
        datasets: [{
          label: this.i18n.t('andamento.legend.mediaMensile'),
          data: byMese,
          backgroundColor: 'rgba(21, 164, 162,0.2)',
          borderColor: '#11769b',
          pointBackgroundColor: '#11769b',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { ticks: { callback: (v: any) => fmtEuro(+v) } } }
      }
    }));
  }

  private destroyCharts() {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
  }

  exportAbc() {
    if (!this.bi?.abcClienti) return;
    this.excel.export(this.bi.abcClienti, [
      { header: this.i18n.t('andamento.col.cliente'), field: 'nome', width: 35 },
      { header: this.i18n.t('andamento.col.fatturato'), field: 'fatturato', width: 14 },
      { header: this.i18n.t('andamento.export.percSulTotale'), field: 'pct', width: 12 },
      { header: this.i18n.t('andamento.export.percCumulativa'), field: 'pctCumulativa', width: 14 },
      { header: this.i18n.t('andamento.col.classe'), field: 'classe', width: 8 },
      { header: this.i18n.t('andamento.col.nFatt'), field: 'numFatture', width: 10 },
    ], `abc-clienti-${this.annoSel}`);
  }

  exportMargini() {
    if (!this.bi?.prodottiMargini) return;
    this.excel.export(this.bi.prodottiMargini, [
      { header: this.i18n.t('andamento.col.prodotto'), field: 'codice', width: 35 },
      { header: this.i18n.t('andamento.col.ricavi'), field: 'ricavi', width: 14 },
      { header: this.i18n.t('andamento.export.costiStimati'), field: 'costiStimati', width: 14 },
      { header: this.i18n.t('andamento.col.margineEuro'), field: 'margine', width: 12 },
      { header: this.i18n.t('andamento.col.marginePerc'), field: 'marginePerc', width: 12 },
      { header: this.i18n.t('andamento.export.qtaVenduta'), field: 'qtaVenduta', width: 12 },
    ], `margini-prodotti-${this.annoSel}`);
  }
}
