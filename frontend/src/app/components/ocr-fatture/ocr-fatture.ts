import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../services/i18n.service';
import { DocumentTextService } from '../../services/document-text.service';
import { TPipe } from '../../pipes/t.pipe';

interface Candidato {
  prodottoId: number;
  nome: string;
  codice?: string;
  fascia: 'alta' | 'media' | 'bassa';
  perche?: string;
  giaMemorizzato?: boolean;
}

interface OcrRiga {
  descrizione: string;
  quantita: number;
  prezzo: number;
  iva: number;
  codice?: string;
  prodottoId?: number | null;
  candidati?: Candidato[];
}

type Step = 'idle' | 'loading' | 'preview' | 'success' | 'error';

@Component({
  selector: 'app-ocr-fatture',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatTooltipModule, RouterLink, TPipe,
  ],
  styles: [`
    :host { display: block; padding: 24px; max-width: 900px; margin: 0 auto; }

    .page-header {
      display: flex; align-items: center; gap: 16px; margin-bottom: 28px;
    }
    .page-header-icon {
      width: 48px; height: 48px; border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--primary) 0%, var(--brand-mid) 100%);
      box-shadow: 0 4px 12px -2px rgba(17,118,155,0.35);
      display: flex; align-items: center; justify-content: center;
      color: #fff; flex-shrink: 0;
    }
    .page-header-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .page-title { font-size: 20px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; }
    .page-sub { font-size: 13px; color: var(--text-secondary); margin: 0; }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm);
      padding: 32px;
    }

    /* ── DROP ZONE ── */
    .drop-card {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 12px; min-height: 280px; cursor: default;
      border: 2px dashed var(--border-strong);
      transition: border-color var(--transition-base), background var(--transition-base);
    }
    .drop-card.drag-over {
      border-color: var(--primary); background: var(--primary-soft);
    }
    .drop-icon {
      font-size: 56px; width: 56px; height: 56px;
      color: var(--primary); opacity: 0.7;
    }
    .drop-title { font-size: 17px; font-weight: 600; color: var(--text-primary); margin: 0; }
    .drop-sub { font-size: 13px; color: var(--text-tertiary); margin: 0; }
    .drop-hint { font-size: 12px; color: var(--text-muted); margin: 4px 0 0; }

    /* ── LOADING / CENTER CARD ── */
    .center-card {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 16px; min-height: 280px; text-align: center;
    }
    .loading-title { font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0; }
    .loading-sub { font-size: 13px; color: var(--text-secondary); margin: 0; }

    /* ── SUCCESS ── */
    .success-icon {
      font-size: 56px; width: 56px; height: 56px; color: var(--success);
    }
    .success-title { font-size: 20px; font-weight: 700; color: var(--text-primary); margin: 0; }
    .success-sub { font-size: 14px; color: var(--text-secondary); margin: 0; }

    /* ── ERROR ── */
    .error-icon {
      font-size: 52px; width: 52px; height: 52px; color: var(--danger);
    }
    .error-title { font-size: 18px; font-weight: 700; color: var(--text-primary); margin: 0; }
    .error-msg {
      font-size: 13px; color: var(--danger-on);
      background: var(--danger-soft); border-radius: var(--radius-md);
      padding: 10px 16px; max-width: 480px; margin: 0;
    }

    /* ── PREVIEW ── */
    .preview-header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 24px;
    }
    .preview-title { font-size: 17px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; }
    .preview-sub { font-size: 13px; color: var(--text-secondary); margin: 0; }

    .fields-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin-bottom: 28px;
    }
    @media (max-width: 600px) { .fields-grid { grid-template-columns: 1fr; } }

    .field-group { display: flex; flex-direction: column; gap: 4px; }
    .field-group label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
    .field-input {
      height: 38px; padding: 0 12px;
      border: 1px solid var(--border-strong); border-radius: var(--radius-md);
      background: var(--bg-surface-2); color: var(--text-primary);
      font-size: 14px; outline: none;
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    .field-input:focus { border-color: var(--primary); box-shadow: var(--shadow-focus); }

    /* ── RIGHE TABLE ── */
    .righe-section { margin-bottom: 24px; }
    .righe-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px;
    }
    .righe-header b { font-size: 14px; font-weight: 700; color: var(--text-primary); }
    .righe-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .righe-table thead tr { border-bottom: 2px solid var(--border-strong); }
    .righe-table th {
      padding: 8px 6px; text-align: left; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);
      background: var(--bg-subtle);
    }
    .righe-table td { padding: 4px 2px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    .righe-table tfoot td { padding: 6px 6px; border-top: 1px solid var(--border-strong); }
    .righe-table tfoot tr:first-child td { border-top: 2px solid var(--border-strong); }

    .riga-input {
      width: 100%; height: 32px; padding: 0 8px;
      border: 1px solid transparent; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-primary); font-size: 13px;
      outline: none; box-sizing: border-box;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .riga-input:focus { border-color: var(--primary); background: var(--bg-surface); }
    .riga-input.num { width: 80px; text-align: right; }
    .num-col { width: 90px; text-align: right; }
    .del-col { width: 40px; }
    .total-cell { text-align: right; padding: 4px 8px; font-weight: 600; color: var(--text-primary); }
    .summary-label { text-align: right; color: var(--text-secondary); font-size: 12px; padding-right: 8px; }
    .summary-value { text-align: right; padding-right: 8px; font-weight: 600; }
    .total-row .summary-label,
    .total-row .summary-value { font-size: 15px; font-weight: 700; color: var(--text-primary); padding-top: 8px; }

    .preview-actions {
      display: flex; justify-content: flex-end; gap: 12px; padding-top: 20px;
      border-top: 1px solid var(--border-subtle);
    }
  `],
  template: `
    <div class="page-header">
      <div class="page-header-icon"><mat-icon>document_scanner</mat-icon></div>
      <div>
        <h1 class="page-title">{{ 'ocrFatture.title' | t }}</h1>
        <p class="page-sub">{{ 'ocrFatture.subtitle' | t }}</p>
      </div>
    </div>

    @if (step === 'idle') {
      <div class="card drop-card" [class.drag-over]="dragOver"
           (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
        <mat-icon class="drop-icon">upload_file</mat-icon>
        <p class="drop-title">{{ 'ocrFatture.dropTitle' | t }}</p>
        <p class="drop-sub">{{ 'ocrFatture.oppure' | t }}</p>
        <input #fileInput type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp" style="display:none" (change)="onFileSelected($event)">
        <button mat-flat-button color="primary" (click)="fileInput.click()">
          <mat-icon>attach_file</mat-icon>&nbsp;{{ 'ocrFatture.sfoglia' | t }}
        </button>
        <p class="drop-hint">{{ 'ocrFatture.dropHint' | t }}</p>
      </div>
    }

    @if (step === 'loading') {
      <div class="card center-card">
        @if (docText.fase() === 'ocr') {
          <mat-spinner diameter="52" mode="determinate" [value]="docText.progresso() * 100"></mat-spinner>
        } @else {
          <mat-spinner diameter="52"></mat-spinner>
        }
        <p class="loading-title">{{ 'ocrFatture.analisiInCorso' | t }}</p>
        <p class="loading-sub">
          {{ (docText.fase() === 'ocr' ? 'ocrFatture.fase.ocr' : 'ocrFatture.loadingSub') | t }}
        </p>
      </div>
    }

    @if (step === 'preview') {
      <div class="card">
        <div class="preview-header">
          <div>
            <h2 class="preview-title">{{ 'ocrFatture.datiEstratti' | t }}</h2>
            <p class="preview-sub">{{ 'ocrFatture.previewSub' | t }}</p>
          </div>
          <button mat-icon-button [matTooltip]="'ocrFatture.ricomincia' | t" (click)="reset()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="fields-grid">
          <div class="field-group">
            <label>{{ 'ocrFatture.fornitore' | t }}</label>
            <input class="field-input" [(ngModel)]="fornitore" [placeholder]="'ocrFatture.ragioneSocialePlaceholder' | t">
          </div>
          <div class="field-group">
            <label>{{ 'ocrFatture.pIvaFornitore' | t }}</label>
            <input class="field-input" [(ngModel)]="pIva" placeholder="IT12345678901">
          </div>
          <div class="field-group">
            <label>{{ 'ocrFatture.numeroFattura' | t }}</label>
            <input class="field-input" [(ngModel)]="numero" placeholder="2024/001">
          </div>
          <div class="field-group">
            <label>{{ 'ocrFatture.dataDocumento' | t }}</label>
            <input class="field-input" type="date" [(ngModel)]="dataDoc">
          </div>
        </div>

        @if (avvisi.length) {
          <div style="background:var(--warning-soft,#fef3c7);border:1px solid var(--warning,#f59e0b);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:18px">
            <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:var(--warning-on,#b45309)">
              <mat-icon style="font-size:18px;width:18px;height:18px">warning</mat-icon> {{ 'ocrFatture.controlliDaVerificare' | t }}
            </div>
            <ul style="margin:6px 0 0;padding-left:20px;font-size:12px;color:var(--text-secondary)">
              @for (w of avvisi; track w) { <li>{{ w }}</li> }
            </ul>
          </div>
        }

        <div class="righe-section">
          <div class="righe-header">
            <b>{{ i18n.t('ocrFatture.righeCount', { n: righe.length }) }}</b>
            <div style="display:flex;align-items:center;gap:10px">
              @if (analizzando) {
                <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-tertiary)">
                  <mat-spinner diameter="14"></mat-spinner> {{ 'ocrFatture.riconoscimentoProdotti' | t }}
                </span>
              } @else if (righe.length) {
                <span style="font-size:12px;color:var(--text-tertiary)">{{ i18n.t('ocrFatture.abbinate', { n: nAbbinate, totale: righe.length }) }}</span>
                <button mat-button (click)="analizzaRighe()" [matTooltip]="'ocrFatture.ricalcolaTooltip' | t">
                  <mat-icon>auto_fix_high</mat-icon> {{ 'ocrFatture.riconosciProdotti' | t }}
                </button>
              }
              <button mat-button (click)="addRiga()">
                <mat-icon>add</mat-icon> {{ 'ocrFatture.aggiungiRiga' | t }}
              </button>
            </div>
          </div>
          <table class="righe-table">
            <thead>
              <tr>
                <th>{{ 'ocrFatture.col.descrizione' | t }}</th>
                <th style="min-width:180px">{{ 'ocrFatture.col.prodottoMagazzino' | t }}</th>
                <th class="num-col">{{ 'ocrFatture.col.qta' | t }}</th>
                <th class="num-col">{{ 'ocrFatture.col.prezzo' | t }}</th>
                <th class="num-col">{{ 'ocrFatture.col.ivaPercent' | t }}</th>
                <th class="num-col">{{ 'ocrFatture.col.totale' | t }}</th>
                <th class="del-col"></th>
              </tr>
            </thead>
            <tbody>
              @for (r of righe; track $index) {
                <tr>
                  <td><input class="riga-input" [(ngModel)]="r.descrizione" [placeholder]="'ocrFatture.descrizionePlaceholder' | t"></td>
                  <td>
                    <select class="riga-input" [(ngModel)]="r.prodottoId" style="width:100%">
                      <option [ngValue]="null">{{ 'ocrFatture.nonAbbinato' | t }}</option>
                      @for (c of r.candidati; track c.prodottoId) {
                        <option [ngValue]="c.prodottoId">{{ c.nome }}{{ c.giaMemorizzato ? ' ★' : '' }}</option>
                      }
                    </select>
                    @if (candidatoSel(r); as c) {
                      <div style="font-size:11px;margin-top:1px" [style.color]="fasciaColor(c.fascia)">
                        {{ c.giaMemorizzato ? ('ocrFatture.giaAbbinato' | t) : c.fascia }}<span style="color:var(--text-tertiary)"> · {{ c.perche }}</span>
                      </div>
                    }
                  </td>
                  <td><input class="riga-input num" type="number" [(ngModel)]="r.quantita" min="0.001" step="0.001"></td>
                  <td><input class="riga-input num" type="number" [(ngModel)]="r.prezzo" min="0" step="0.01"></td>
                  <td><input class="riga-input num" type="number" [(ngModel)]="r.iva" min="0" max="100"></td>
                  <td class="total-cell">{{ formatCurrency(r.quantita * r.prezzo) }}</td>
                  <td>
                    <button mat-icon-button (click)="removeRiga($index)" [disabled]="righe.length <= 1"
                            [matTooltip]="'ocrFatture.rimuoviRigaTooltip' | t">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5" class="summary-label">{{ 'ocrFatture.imponibile' | t }}</td>
                <td colspan="2" class="summary-value">{{ formatCurrency(totaleNetto) }}</td>
              </tr>
              <tr>
                <td colspan="5" class="summary-label">{{ 'ocrFatture.iva' | t }}</td>
                <td colspan="2" class="summary-value">{{ formatCurrency(totaleIva) }}</td>
              </tr>
              <tr class="total-row">
                <td colspan="5" class="summary-label">{{ 'ocrFatture.totaleLordo' | t }}</td>
                <td colspan="2" class="summary-value">{{ formatCurrency(totaleLordo) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="preview-actions">
          <button mat-button (click)="reset()">{{ 'ocrFatture.ricomincia' | t }}</button>
          <button mat-flat-button color="primary" (click)="conferma()">
            <mat-icon>check</mat-icon>&nbsp;{{ 'ocrFatture.confermaCreaAcquisto' | t }}
          </button>
        </div>
      </div>
    }

    @if (step === 'success') {
      <div class="card center-card">
        <mat-icon class="success-icon">check_circle</mat-icon>
        <h2 class="success-title">{{ 'ocrFatture.acquistoCreato' | t }}</h2>
        <p class="success-sub">{{ 'ocrFatture.acquistoSalvato.part1' | t }} <b>#{{ acquistoId }}</b> {{ 'ocrFatture.acquistoSalvato.part2' | t }}</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
          <button mat-button (click)="reset()">{{ 'ocrFatture.nuovaFatturaOcr' | t }}</button>
          <button mat-flat-button color="primary" routerLink="/acquisti">{{ 'ocrFatture.vaiAcquisti' | t }}</button>
        </div>
      </div>
    }

    @if (step === 'error') {
      <div class="card center-card">
        <mat-icon class="error-icon">error_outline</mat-icon>
        <h2 class="error-title">{{ 'ocrFatture.erroreAnalisi' | t }}</h2>
        <p class="error-msg">{{ errorMsg }}</p>
        <button mat-flat-button color="primary" (click)="reset()">{{ 'ocrFatture.riprova' | t }}</button>
      </div>
    }
  `,
})
export class OcrFattureComponent {
  i18n = inject(I18nService);
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  step: Step = 'idle';
  dragOver = false;

  fornitore = '';
  pIva = '';
  dataDoc = '';
  numero = '';
  righe: OcrRiga[] = [];

  acquistoId: number | null = null;
  errorMsg = '';

  // abbinamento prodotti + controllo qualita
  fornitoreId: number | null = null;
  fornitoreNoto = false;
  duplicatoId: number | null = null;
  analizzando = false;
  ocrTotaleNetto: number | null = null;
  /** Come è stato letto il documento: testo del PDF (esatto) o OCR (da rivedere). */
  fonte: 'pdf' | 'ocr' | null = null;
  /** Quota di campi riconosciuti (0-1): sotto il 60% conviene rileggere tutto. */
  affidabilita: number | null = null;

  readonly docText = inject(DocumentTextService);

  constructor(private http: HttpClient, private snack: MatSnackBar) {}

  onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(e: DragEvent) {
    this.dragOver = false;
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  onFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.processFile(file);
  }

  /**
   * Legge il documento sul computer dell'utente: prima il testo del PDF, e solo
   * se è una scansione l'OCR locale. Al backend arriva il testo, mai il file:
   * la fattura — che contiene dati di clienti e fornitori — non lascia il PC.
   */
  async processFile(file: File) {
    if (!DocumentTextService.accetta(file)) {
      this.snack.open(this.i18n.t('ocrFatture.msg.formatoNonSupportato'), '', { duration: 3000 });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.snack.open(this.i18n.t('ocrFatture.msg.fileTroppoGrande'), '', { duration: 3000 });
      return;
    }

    this.step = 'loading';
    let testo = '';
    try {
      const estratto = await this.docText.estrai(file);
      testo = estratto.testo;
      this.fonte = estratto.fonte;
    } catch {
      this.errorMsg = this.i18n.t('ocrFatture.msg.erroreLettura');
      this.step = 'error';
      return;
    }

    if (testo.trim().length < 20) {
      this.errorMsg = this.i18n.t('ocrFatture.msg.documentoIlleggibile');
      this.step = 'error';
      return;
    }

    this.http.post<any>(`${environment.apiUrl}/ocr/fattura/testo`, { testo }).subscribe({
      next: (res) => {
        const s = res.suggerito;
        this.affidabilita = res.affidabilita ?? null;
        this.fornitore = s.fornitore || '';
        this.pIva = s.pIvaFornitore || '';
        this.dataDoc = s.dataDoc || new Date().toISOString().substring(0, 10);
        this.numero = s.numero || '';
        this.ocrTotaleNetto = s.totaleNetto != null ? s.totaleNetto : null;
        this.righe = s.righe?.length
          ? s.righe
          : [{ descrizione: '', quantita: 1, prezzo: 0, iva: 22 }];
        this.step = 'preview';
        this.analizzaRighe();
      },
      error: (e) => {
        this.errorMsg = e.error?.error || this.i18n.t('ocrFatture.msg.erroreAnalisiOcr');
        this.step = 'error';
      },
    });
  }

  // Chiede al server: fornitore esistente? fattura gia caricata? e i prodotti
  // a magazzino piu probabili per ogni riga (memoria + match testuale).
  analizzaRighe() {
    if (!this.righe.length) return;
    this.analizzando = true;
    this.http.post<any>(`${environment.apiUrl}/ocr/fattura/analizza-righe`, {
      fornitore: this.fornitore, pIva: this.pIva, numero: this.numero,
      righe: this.righe.map(r => ({ descrizione: r.descrizione, codice: r.codice || '', prezzo: r.prezzo })),
    }).subscribe({
      next: (res) => {
        this.analizzando = false;
        this.fornitoreId = res.fornitoreId || null;
        this.fornitoreNoto = !!res.fornitoreId;
        this.duplicatoId = res.duplicato?.acquistoId || null;
        (res.righe || []).forEach((rr: any, i: number) => {
          if (!this.righe[i]) return;
          this.righe[i].candidati = rr.candidati || [];
          // pre-seleziona il candidato gia memorizzato o ad alta confidenza
          const top = rr.candidati?.[0];
          this.righe[i].prodottoId = (top && (top.giaMemorizzato || top.fascia === 'alta')) ? top.prodottoId : null;
        });
      },
      error: () => { this.analizzando = false; },
    });
  }

  candidatoSel(r: OcrRiga): Candidato | null {
    return r.prodottoId == null ? null : (r.candidati?.find(c => c.prodottoId === r.prodottoId) || null);
  }
  fasciaColor(f?: string): string {
    return f === 'alta' ? 'var(--success-on, #15803d)' : f === 'media' ? 'var(--warning-on, #b45309)' : 'var(--text-tertiary, #94a3b8)';
  }

  // ── Controllo qualita (#5) ──────────────────────────────────────────────────
  get pIvaValida(): boolean {
    const v = (this.pIva || '').replace(/^IT/i, '').trim();
    if (!v) return true; // vuota = non segnalata
    if (!/^\d{11}$/.test(v)) return false;
    let s = 0;
    for (let i = 0; i < 11; i++) {
      let n = +v[i];
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      s += n;
    }
    return s % 10 === 0;
  }
  get quadraturaDelta(): number | null {
    if (this.ocrTotaleNetto == null) return null;
    return +(this.totaleNetto - this.ocrTotaleNetto).toFixed(2);
  }
  get avvisi(): string[] {
    const a: string[] = [];
    // Il testo ricostruito dai pixel sbaglia soprattutto sulle cifre: se il
    // documento è passato dall'OCR conviene dirlo prima che dopo.
    if (this.fonte === 'ocr') a.push(this.i18n.t('ocrFatture.avviso.letturaOcr'));
    if (this.affidabilita != null && this.affidabilita < 0.6) a.push(this.i18n.t('ocrFatture.avviso.pochiCampi'));
    if (this.duplicatoId) a.push(this.i18n.t('ocrFatture.avviso.duplicato', { id: this.duplicatoId }));
    if (!this.pIvaValida) a.push(this.i18n.t('ocrFatture.avviso.pivaNonValida'));
    const d = this.quadraturaDelta;
    if (d != null && Math.abs(d) > 0.02) a.push(this.i18n.t('ocrFatture.avviso.quadratura', {
      righe: this.formatCurrency(this.totaleNetto), letto: this.formatCurrency(this.ocrTotaleNetto!), diff: this.formatCurrency(d),
    }));
    return a;
  }
  get nAbbinate(): number { return this.righe.filter(r => r.prodottoId != null).length; }

  addRiga() {
    this.righe.push({ descrizione: '', quantita: 1, prezzo: 0, iva: 22, candidati: [] });
  }

  removeRiga(i: number) {
    if (this.righe.length > 1) this.righe.splice(i, 1);
  }

  get totaleNetto(): number {
    return this.righe.reduce((s, r) => s + r.quantita * r.prezzo, 0);
  }

  get totaleIva(): number {
    return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * r.iva / 100, 0);
  }

  get totaleLordo(): number {
    return this.totaleNetto + this.totaleIva;
  }

  conferma() {
    if (!this.fornitore.trim()) {
      this.snack.open(this.i18n.t('ocrFatture.msg.fornitoreObbligatorio'), '', { duration: 3000 });
      return;
    }
    if (!this.dataDoc) {
      this.snack.open(this.i18n.t('ocrFatture.msg.dataObbligatoria'), '', { duration: 3000 });
      return;
    }

    this.step = 'loading';
    this.http.post<any>(`${environment.apiUrl}/ocr/fattura/conferma`, {
      fornitore: this.fornitore,
      pIva: this.pIva,
      dataDoc: this.dataDoc,
      numero: this.numero,
      righe: this.righe.map(r => ({
        descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, iva: r.iva,
        prodottoId: r.prodottoId ?? null, codice: r.codice || '',
      })),
    }).subscribe({
      next: (res) => {
        this.acquistoId = res.acquistoId;
        this.step = 'success';
      },
      error: (e) => {
        if (e.status === 409) {
          this.snack.open(
            this.i18n.t('ocrFatture.msg.acquistoGiaPresente', { id: e.error?.acquistoId }),
            this.i18n.t('ocrFatture.vaiAcquisti'),
            { duration: 5000 }
          );
          this.step = 'preview';
        } else {
          this.errorMsg = e.error?.error || this.i18n.t('ocrFatture.msg.erroreConferma');
          this.step = 'error';
        }
      },
    });
  }

  reset() {
    this.step = 'idle';
    this.fornitore = '';
    this.pIva = '';
    this.dataDoc = '';
    this.numero = '';
    this.righe = [];
    this.acquistoId = null;
    this.errorMsg = '';
    this.fornitoreId = null;
    this.fornitoreNoto = false;
    this.duplicatoId = null;
    this.analizzando = false;
    this.ocrTotaleNetto = null;
    this.fonte = null;
    this.affidabilita = null;
    if (this.fileInput) this.fileInput.nativeElement.value = '';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
  }
}
