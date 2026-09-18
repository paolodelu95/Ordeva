import { Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule, MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { Cliente, Fattura } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

/** Scheda riassuntiva del cliente: dati, indicatori economici, ultime fatture e top prodotti.
 *  Compone dati già esistenti (fatture filtrate per clienteId + top prodotti). */
@Component({
  selector: 'app-scheda-cliente-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, TPipe],
  template: `
    <div class="sc-head">
      <div class="sc-avatar">{{ (cliente.ragioneSociale || '?').charAt(0).toUpperCase() }}</div>
      <div style="flex:1;min-width:0">
        <h2 class="sc-nome">{{ cliente.ragioneSociale }}</h2>
        <div class="sc-sub">
          @if (cliente.pIva) { <span>P.IVA {{ cliente.pIva }}</span> }
          @if (cliente.citta) { <span>{{ cliente.citta }}@if (cliente.provincia) { ({{ cliente.provincia }}) }</span> }
          @if (cliente.telefono) { <span>{{ cliente.telefono }}</span> }
          @if (cliente.email) { <span>{{ cliente.email }}</span> }
        </div>
      </div>
      <button mat-icon-button (click)="dialogRef.close()"><mat-icon>close</mat-icon></button>
    </div>

    @if (loading) {
      <div style="text-align:center;padding:48px 0"><mat-spinner diameter="36" style="margin:0 auto"></mat-spinner></div>
    } @else {
      <div class="sc-kpi">
        <div class="sc-card">
          <div class="sc-k-label">{{ 'clienti.scheda.fatturato' | t:{ anno } }}</div>
          <div class="sc-k-val">{{ fatturatoAnno | currency:'EUR':'symbol':'1.2-2':'it' }}</div>
        </div>
        <div class="sc-card" [class.sc-warn]="saldoAperto > 0">
          <div class="sc-k-label">{{ 'clienti.scheda.daIncassare' | t }}</div>
          <div class="sc-k-val">{{ saldoAperto | currency:'EUR':'symbol':'1.2-2':'it' }}</div>
        </div>
        <div class="sc-card">
          <div class="sc-k-label">{{ 'clienti.scheda.fatture' | t }}</div>
          <div class="sc-k-val">{{ nFatture }}</div>
          @if (ultimaData) { <div class="sc-k-note">{{ 'clienti.scheda.ultima' | t:{ data: (ultimaData | date:'dd/MM/yy') || '' } }}</div> }
        </div>
      </div>

      <!-- Accanto a "Da incassare": è qui che si decide se farsi avvisare. -->
      <div class="sc-avviso">
        <mat-slide-toggle [checked]="cliente.avvisoInsoluti !== false" [disabled]="salvandoAvviso"
                          (change)="cambiaAvviso($event)">
          {{ 'clienti.form.avvisoInsoluti' | t }}
        </mat-slide-toggle>
        <div class="sc-muted">{{ 'clienti.form.avvisoInsolutiHint' | t }}</div>
      </div>

      <div class="sc-cols">
        <div class="sc-col">
          <div class="sc-sec">{{ 'clienti.scheda.ultimeFatture' | t }}</div>
          @if (ultimeFatture.length) {
            @for (f of ultimeFatture; track f.id) {
              <div class="sc-row">
                <div style="flex:1;min-width:0">
                  <b>{{ f.numero }}</b>
                  <span class="sc-muted"> · {{ f.dataEmissione | date:'dd/MM/yy' }}</span>
                </div>
                <span class="sc-badge" [class.sc-badge--ok]="(f.stato||'').toUpperCase()==='PAGATA'">{{ f.stato }}</span>
                <b style="min-width:82px;text-align:right">{{ f.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
              </div>
            }
          } @else { <div class="sc-empty">{{ 'clienti.scheda.nessunaFattura' | t }}</div> }
        </div>

        <div class="sc-col">
          <div class="sc-sec">{{ 'clienti.scheda.prodottiPiuAcquistati' | t }}</div>
          @if (topProdotti.length) {
            @for (p of topProdotti; track p.id) {
              <div class="sc-row">
                <div style="flex:1;min-width:0">
                  {{ p.codice }}
                  <span class="sc-muted"> · {{ p.quantitaTotale }} {{ p.unitaMisura || '' }}</span>
                </div>
                <span class="sc-muted">{{ p.occorrenze }}×</span>
              </div>
            }
          } @else { <div class="sc-empty">{{ 'clienti.scheda.nessunAcquisto' | t }}</div> }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display:block; width:660px; max-width:100%; }
    .sc-head { display:flex; align-items:center; gap:14px; padding:20px 24px 16px; border-bottom:1px solid #e2e8f0; }
    .sc-avatar { width:46px; height:46px; border-radius:12px; flex:none; display:grid; place-items:center;
      color:#fff; font-weight:700; font-size:20px; background:linear-gradient(135deg,#11769b,#15a4a2); }
    .sc-nome { margin:0; font-size:19px; letter-spacing:-.01em; }
    .sc-sub { display:flex; flex-wrap:wrap; gap:4px 14px; color:#64748b; font-size:12.5px; margin-top:3px; }
    .sc-kpi { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding:18px 24px 6px; }
    .sc-card { background:#f8fafc; border-radius:12px; padding:12px 14px; }
    .sc-card.sc-warn { background:#fef2f2; }
    .sc-k-label { font-size:12px; color:#64748b; }
    .sc-k-val { font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
    .sc-card.sc-warn .sc-k-val { color:#b91c1c; }
    .sc-k-note { font-size:11px; color:#94a3b8; margin-top:2px; }
    .sc-cols { display:grid; grid-template-columns:1fr 1fr; gap:20px; padding:14px 24px 22px; }
    .sc-sec { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px; }
    .sc-row { display:flex; align-items:center; gap:8px; padding:7px 0; border-bottom:1px solid #f1f5f9; font-size:13px; }
    .sc-muted { color:#94a3b8; font-size:12px; }
    .sc-avviso { margin:4px 0 14px; padding:10px 12px; border-radius:10px; background:var(--bg-subtle); display:flex; flex-direction:column; gap:4px; }
    .sc-badge { font-size:11px; padding:2px 8px; border-radius:99px; background:#eef2f7; color:#475569; white-space:nowrap; }
    .sc-badge--ok { background:rgba(22,163,74,.14); color:#15803d; }
    .sc-empty { color:#94a3b8; font-size:13px; padding:10px 0; }
    @media (max-width:600px){ .sc-kpi{grid-template-columns:1fr} .sc-cols{grid-template-columns:1fr} :host{width:auto} }
  `]
})
export class SchedaClienteDialogComponent implements OnInit {
  loading = true;
  fatturatoAnno = 0;
  saldoAperto = 0;
  nFatture = 0;
  ultimaData = '';
  ultimeFatture: Fattura[] = [];
  topProdotti: any[] = [];
  readonly anno = new Date().getFullYear();
  salvandoAvviso = false;
  private snack = inject(MatSnackBar);
  private i18n = inject(I18nService);

  /** Salva subito: la scheda non ha un pulsante Salva. */
  cambiaAvviso(e: MatSlideToggleChange) {
    const id = this.cliente.id;
    if (!id) return;
    this.salvandoAvviso = true;
    this.ds.setAvvisoInsolutiCliente(id, e.checked).subscribe({
      next: () => {
        this.cliente.avvisoInsoluti = e.checked;
        this.salvandoAvviso = false;
        this.snack.open(this.i18n.t(e.checked ? 'clienti.msg.avvisoAcceso' : 'clienti.msg.avvisoSpento'), '', { duration: 2500 });
      },
      error: () => {
        e.source.checked = !e.checked;   // torna allo stato salvato
        this.salvandoAvviso = false;
        this.snack.open(this.i18n.t('shared.fattureInsolute.msg.errore'), '', { duration: 3500 });
      },
    });
  }

  constructor(
    private ds: DataService,
    public dialogRef: MatDialogRef<SchedaClienteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public cliente: Cliente,
  ) {}

  ngOnInit() {
    const id = this.cliente.id!;
    forkJoin({
      fatture: this.ds.getFatture().pipe(catchError(() => of([] as Fattura[]))),
      top: this.ds.getTopProdottiCliente(id, 5).pipe(catchError(() => of([] as any[]))),
    }).subscribe(({ fatture, top }) => {
      const attive = (fatture || [])
        .filter(f => f.clienteId === id && (f.stato || '').toUpperCase() !== 'ANNULLATA');
      this.nFatture = attive.length;
      this.fatturatoAnno = attive
        .filter(f => (f.dataEmissione || '').slice(0, 4) === String(this.anno))
        .reduce((s, f) => s + (Number(f.totale) || 0), 0);
      this.saldoAperto = attive
        .filter(f => (f.stato || '').toUpperCase() !== 'PAGATA')
        .reduce((s, f) => s + (Number(f.totale) || 0), 0);
      const ord = [...attive].sort((a, b) => (b.dataEmissione || '').localeCompare(a.dataEmissione || ''));
      this.ultimaData = ord[0]?.dataEmissione || '';
      this.ultimeFatture = ord.slice(0, 5);
      this.topProdotti = top || [];
      this.loading = false;
    });
  }
}
