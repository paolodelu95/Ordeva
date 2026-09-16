import { Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { isoOggi } from '../../utils/data-locale';

interface AnalisiRiga {
  rigaId: number;
  descrizione: string;
  quantita: number;
  prezzoAcquisto: number;
  codiceFornitore: string;
  stato: 'matched' | 'unmatched' | 'noCode';
  prodottoId?: number;
  prodottoCodice?: string;
  nuovoProdotto?: any;
  inclusa?: boolean;
  creaNuovo?: boolean;
}

interface Analisi {
  acquistoId: number;
  numero: string;
  totale: number;
  matched: number;
  unmatched: number;
  noCode: number;
  righe: AnalisiRiga[];
}

/**
 * Dialog "Registra fattura di acquisto": in un solo passaggio
 *   1) carica i prodotti a magazzino (genera arrivo merce)
 *   2) registra il pagamento (uscita)
 * Esattamente come l'import di un XML, ma applicabile a qualsiasi acquisto
 * (tipicamente una fattura passiva scaricata dallo SDI).
 */
@Component({
  selector: 'app-acquisto-registra-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule,
    MatCheckboxModule, MatTooltipModule, MatFormFieldModule, MatInputModule, MatSelectModule, TPipe,
  ],
  template: `
    <h2 mat-dialog-title style="display:flex;align-items:center;gap:10px">
      <mat-icon style="color:#11769b">task_alt</mat-icon>
      {{ 'acquisti.registra.title' | t }}
    </h2>

    <mat-dialog-content style="min-width:min(620px,92vw);max-width:820px">
      @if (loading) {
        <p>{{ 'acquisti.registra.analisiInCorso' | t }}</p>
      } @else if (analisi) {
        <p class="lead">{{ 'acquisti.registra.lead' | t:{ numero: analisi.numero, fornitore: (fornitoreNome ? ' — ' + fornitoreNome : '') } }}</p>

        <!-- ── Carico magazzino ─────────────────────────────────────── -->
        <div class="section">
          <mat-checkbox [(ngModel)]="caricaMagazzino" class="section-head">
            <span class="section-title"><mat-icon>move_to_inbox</mat-icon> {{ 'acquisti.registra.caricaAMagazzino' | t }}</span>
          </mat-checkbox>

          @if (caricaMagazzino) {
            <div class="summary">
              @if (analisi.matched > 0) { <span class="chip chip-ok"><mat-icon>check_circle</mat-icon> {{ 'acquisti.registra.aCatalogo' | t:{ n: analisi.matched } }}</span> }
              @if (analisi.unmatched > 0) { <span class="chip chip-warn"><mat-icon>add_circle_outline</mat-icon> {{ 'acquisti.registra.nuovi' | t:{ n: analisi.unmatched } }}</span> }
              @if (analisi.noCode > 0) { <span class="chip chip-muted"><mat-icon>help_outline</mat-icon> {{ 'acquisti.registra.senzaCodice' | t:{ n: analisi.noCode } }}</span> }
            </div>
            <div class="righe-list">
              @for (r of analisi.righe; track r.rigaId) {
                <div class="riga" [class.riga-skip]="!r.inclusa">
                  <mat-checkbox [(ngModel)]="r.inclusa"></mat-checkbox>
                  <div class="riga-body">
                    <div class="riga-top">
                      <span class="riga-desc">{{ r.descrizione }}</span>
                      <span class="riga-qty">{{ r.quantita }} pz · € {{ r.prezzoAcquisto | number:'1.2-2' }}</span>
                    </div>
                    <div class="riga-meta">
                      @if (r.stato === 'matched') {
                        <span class="badge badge-ok"><mat-icon>check</mat-icon> {{ 'acquisti.registra.esistente' | t }} <b>{{ r.prodottoCodice }}</b></span>
                      } @else if (r.stato === 'unmatched') {
                        <span class="badge badge-warn"><mat-icon>add</mat-icon> {{ 'acquisti.registra.nuovo' | t }} <b>{{ r.nuovoProdotto?.codice }}</b></span>
                        <mat-checkbox [(ngModel)]="r.creaNuovo" class="tiny">{{ 'acquisti.registra.creaACatalogo' | t }}</mat-checkbox>
                      } @else {
                        <span class="badge badge-muted"><mat-icon>warning_amber</mat-icon> {{ 'acquisti.registra.senzaCodiceSaraSaltata' | t }}</span>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- ── Pagamento ────────────────────────────────────────────── -->
        <div class="section">
          <mat-checkbox [(ngModel)]="registraPagamento" class="section-head">
            <span class="section-title"><mat-icon>payments</mat-icon> {{ 'acquisti.registra.registraPagamento' | t }}</span>
          </mat-checkbox>

          @if (registraPagamento) {
            <div class="pay-grid">
              <mat-form-field appearance="outline">
                <mat-label>{{ 'acquisti.registra.dataPagamento' | t }}</mat-label>
                <input matInput type="date" [(ngModel)]="dataPagamento">
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>{{ 'acquisti.registra.importo' | t }}</mat-label>
                <input matInput type="number" step="0.01" min="0" [(ngModel)]="importo">
                <span matTextPrefix>€&nbsp;</span>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>{{ 'acquisti.registra.metodo' | t }}</mat-label>
                <mat-select [(ngModel)]="metodo">
                  <mat-option value="Bonifico">{{ 'acquisti.registra.metodoOpt.bonifico' | t }}</mat-option>
                  <mat-option value="Contanti">{{ 'acquisti.registra.metodoOpt.contanti' | t }}</mat-option>
                  <mat-option value="Carta">{{ 'acquisti.registra.metodoOpt.carta' | t }}</mat-option>
                  <mat-option value="RID/SDD">{{ 'acquisti.registra.metodoOpt.ridSdd' | t }}</mat-option>
                  <mat-option value="Assegno">{{ 'acquisti.registra.metodoOpt.assegno' | t }}</mat-option>
                  <mat-option value="Altro">{{ 'acquisti.registra.metodoOpt.altro' | t }}</mat-option>
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>{{ 'acquisti.registra.conto' | t }}</mat-label>
                <mat-select [(ngModel)]="conto">
                  <mat-option value="BANCA">{{ 'acquisti.registra.contoOpt.banca' | t }}</mat-option>
                  <mat-option value="CASSA">{{ 'acquisti.registra.contoOpt.cassa' | t }}</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
            <p class="hint">{{ 'acquisti.registra.totaleDocumento' | t }} <b>€ {{ totale | number:'1.2-2' }}</b></p>
          }
        </div>

        <p class="note">
          <mat-icon>info_outline</mat-icon>
          {{ 'acquisti.registra.notaFinale' | t }}
        </p>
      } @else {
        <p style="color:#b91c1c">{{ 'acquisti.registra.errore' | t:{ msg: (errorMsg || ('acquisti.magazzino.impossibileLeggere' | t)) } }}</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ 'acquisti.registra.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="registra()"
              [disabled]="!analisi || saving || (!caricaMagazzino && !registraPagamento)">
        @if (saving) { {{ 'acquisti.registra.registrazioneInCorso' | t }} } @else { {{ 'acquisti.registra.registraBtn' | t }} }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .lead { font-size: 14px; color: var(--text-secondary, #334155); margin: 0 0 14px; line-height: 1.5; }
    .section { border: 1px solid var(--border-subtle, #e6e8ee); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .section-head { font-weight: 600; }
    .section-title { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
    .section-title mat-icon { font-size: 18px; width: 18px; height: 18px; color: #11769b; }
    .summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 10px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    .chip mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .chip-ok { background: rgba(22,163,74,0.12); color: #15803d; }
    .chip-warn { background: rgba(217,119,6,0.12); color: #b45309; }
    .chip-muted { background: var(--bg-subtle); color: var(--text-secondary); }
    .righe-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
    .riga { display: flex; gap: 10px; padding: 8px 10px; background: var(--bg-surface-2, #f8fafc); border-radius: 6px; }
    .riga-skip { opacity: 0.45; }
    .riga-body { flex: 1; min-width: 0; }
    .riga-top { display: flex; justify-content: space-between; gap: 8px; }
    .riga-desc { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .riga-qty { font-size: 12px; color: var(--text-tertiary, #64748b); white-space: nowrap; }
    .riga-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; margin-top: 2px; }
    .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
    .badge mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .badge-ok { color: #15803d; } .badge-warn { color: #b45309; } .badge-muted { color: #64748b; }
    .tiny ::ng-deep label { font-size: 11px; }
    .pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 10px; }
    .pay-grid mat-form-field { width: 100%; }
    .hint { font-size: 12px; color: var(--text-tertiary, #64748b); margin: 2px 0 0; }
    .note { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: var(--text-tertiary, #64748b); margin: 6px 0 0; }
    .note mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
    @media (max-width: 600px) { .pay-grid { grid-template-columns: 1fr; } }
  `]
})
export class AcquistoRegistraDialogComponent implements OnInit {
  loading = true;
  saving = false;
  analisi: Analisi | null = null;
  errorMsg = '';

  fornitoreNome = '';
  totale = 0;

  caricaMagazzino = true;
  registraPagamento = true;
  dataPagamento = isoOggi();
  importo = 0;
  metodo = 'Bonifico';
  conto: 'BANCA' | 'CASSA' = 'BANCA';
  private snack = inject(MatSnackBar);
  private i18n = inject(I18nService);

  constructor(
    public dialogRef: MatDialogRef<AcquistoRegistraDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { acquistoId: number; api: ApiService; fornitoreNome?: string },
  ) {}

  ngOnInit() {
    this.fornitoreNome = this.data.fornitoreNome || '';
    // Carica i dettagli dell'acquisto (totale, fornitore) e l'analisi magazzino
    this.data.api.get<any>(`acquisti/${this.data.acquistoId}`).subscribe({
      next: a => {
        this.totale = +(a?.totale || 0);
        this.importo = +this.totale.toFixed(2);
        if (!this.fornitoreNome) this.fornitoreNome = a?.fornitoreNome || '';
      },
      error: () => {},
    });
    this.data.api.get<Analisi>(`acquisti/${this.data.acquistoId}/analisi-magazzino`).subscribe({
      next: a => {
        a.righe.forEach(r => {
          r.inclusa = r.stato !== 'noCode';
          r.creaNuovo = r.stato === 'unmatched';
        });
        this.analisi = a;
        this.loading = false;
      },
      error: e => {
        this.errorMsg = e.error?.error || e.message;
        this.loading = false;
      },
    });
  }

  private buildPersonalizzazioni(): Record<number, any> {
    const personalizzazioni: Record<number, any> = {};
    for (const r of this.analisi!.righe) {
      if (!r.inclusa) { personalizzazioni[r.rigaId] = { prodottoId: null }; continue; }
      if (r.stato === 'matched') personalizzazioni[r.rigaId] = { prodottoId: r.prodottoId };
      else if (r.stato === 'unmatched' && r.creaNuovo) personalizzazioni[r.rigaId] = { nuovoProdotto: r.nuovoProdotto };
      else personalizzazioni[r.rigaId] = { prodottoId: null };
    }
    return personalizzazioni;
  }

  registra() {
    if (!this.analisi) return;
    this.saving = true;
    const result: any = { registered: true };

    const doPagamento = () => {
      if (!this.registraPagamento) { this.finish(result); return; }
      const imp = Number(this.importo);
      if (!Number.isFinite(imp) || imp <= 0) {
        this.saving = false;
        this.snack.open(this.i18n.t('acquisti.registra.msg.importoMaggioreZero'), 'OK',
                        { duration: 5000, panelClass: 'snack-error' });
        return;
      }
      this.data.api.post('pagamenti', {
        acquistoId: this.data.acquistoId,
        dataPagamento: this.dataPagamento,
        importo: imp,
        metodo: this.metodo,
        conto: this.conto,
        tipo: 'USCITA',
      }).subscribe({
        next: () => { result.pagamento = { importo: imp }; this.finish(result); },
        error: e => {
          this.saving = false;
          this.snack.open(e.error?.error || this.i18n.t('acquisti.registra.msg.errorePagamento'), 'OK',
                          { duration: 6000, panelClass: 'snack-error' });
        },
      });
    };

    if (this.caricaMagazzino) {
      this.data.api.post(`acquisti/${this.data.acquistoId}/genera-arrivo-merce`, {
        autoCreaProdotti: false,
        personalizzazioni: this.buildPersonalizzazioni(),
      }).subscribe({
        next: (r: any) => { result.arrivo = r; doPagamento(); },
        error: e => {
          this.saving = false;
          this.snack.open(e.error?.error || this.i18n.t('acquisti.registra.msg.erroreArrivoMerce'), 'OK',
                          { duration: 6000, panelClass: 'snack-error' });
        },
      });
    } else {
      doPagamento();
    }
  }

  private finish(result: any) {
    this.saving = false;
    this.dialogRef.close(result);
  }
}
