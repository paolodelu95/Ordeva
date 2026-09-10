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
import { DataService } from '../../services/data.service';
import type { Fornitore } from '../../models';
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
  /** I valori letti sulla riga, nell'ordine in cui compaiono sul documento. */
  celle?: string[];
}

/** Arrivo merce già in archivio che potrebbe corrispondere al DDT citato. */
interface ArrivoCandidato {
  id: number;
  numero: string;
  data: string;
  numeroDocumentoFornitore: string;
  righe: number;
}

/** Ruolo assegnabile a una colonna letta. */
type RuoloColonna = 'ignora' | 'codice' | 'descrizione' | 'quantita' | 'prezzo' | 'iva' | 'totale';

const RUOLI: RuoloColonna[] = ['ignora', 'codice', 'descrizione', 'quantita', 'prezzo', 'iva', 'totale'];

type Step = 'idle' | 'loading' | 'preview' | 'success' | 'error';

@Component({
  selector: 'app-ocr-fatture',
  host: { '[class.confronto-aperto]': "step === 'preview'" },
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatTooltipModule, RouterLink, TPipe,
  ],
  styles: [`
    /* 900px bastano per l'area di caricamento e la conferma finale. Quando
       compaiono i dati da verificare accanto al documento serve più spazio:
       sotto una certa larghezza le due colonne non ci stanno e il confronto
       si perde (lo decide la container query più in basso). */
    :host { display: block; padding: 24px; max-width: 900px; margin: 0 auto; }
    :host(.confronto-aperto) { max-width: 1500px; }

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

    /* min-width:0 e width:100%: senza, un valore lungo (una ragione sociale
       intera) allarga la colonna del grid e i campi escono dalla scheda. */
    .field-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field-group .field-input { width: 100%; box-sizing: border-box; min-width: 0; }
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
    /* La tabella non deve uscire dalla colonna: dentro scorre, fuori no. */
    .righe-section { margin-bottom: 24px; overflow-x: auto; }
    .righe-table { min-width: 620px; }
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

    .anteprima-head {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; font-weight: 600; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px;
    }
    .anteprima-box {
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
      background: var(--bg-subtle, #f8fafc); padding: 8px;
      overflow: auto; display: flex; gap: 8px;
    }
    .anteprima-box img { border-radius: 4px; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.12)); display: block; }
    .anteprima-vuota { font-size: 13px; color: var(--text-tertiary); padding: 24px 8px; text-align: center; }
    .zoom-link { font-size: 12px; font-weight: 600; color: var(--primary); cursor: pointer; background: none; border: 0; padding: 0; }

    /* Il documento accanto ai dati vale solo se restano leggibili ENTRAMBI. Con
       la barra laterale aperta la scheda è larga ~850px: due colonne lì
       strizzerebbero la tabella delle righe fino a nasconderne prezzo e totale.
       Decide quindi lo spazio reale della scheda, non la larghezza della
       finestra: sotto la soglia il documento va sopra, in orizzontale. */
    .confronto-host { container-type: inline-size; }
    .confronto { display: grid; grid-template-columns: 1fr; gap: 20px; }
    .confronto > .col-dati { min-width: 0; }
    .anteprima { order: -1; min-width: 0; }
    /* Documento sopra i dati: pagine affiancate, altezza fissa e proporzioni
       intatte (senza align-items il flex le stira e il testo si deforma). */
    .anteprima-box { max-height: 36vh; flex-direction: row; align-items: flex-start; }
    .anteprima-box img { width: auto; height: 32vh; object-fit: contain; }

    @container (min-width: 1100px) {
      .confronto { grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 28px; align-items: start; }
      .anteprima { order: 0; position: sticky; top: 12px; }
      .anteprima-box { max-height: 70vh; flex-direction: column; align-items: stretch; }
      .anteprima-box img { width: 100%; height: auto; }
    }
    /* Tipo di documento: due possibilità, si vede subito qual è quella scelta. */
    .tipo-doc { display: inline-flex; gap: 4px; background: var(--bg-subtle,#f1f5f9); padding: 3px; border-radius: var(--radius-md); margin-bottom: 18px; }
    .tipo-doc button {
      border: 0; background: none; padding: 6px 14px; border-radius: calc(var(--radius-md) - 2px);
      font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
    }
    .tipo-doc button.attivo { background: var(--bg-surface); color: var(--text-primary); box-shadow: var(--shadow-xs); }

    /* Collegamento al DDT già caricato e carico manuale. */
    .collega {
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
      padding: 12px 14px; margin-bottom: 18px; background: var(--bg-subtle,#f8fafc);
    }
    .collega-titolo { font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .collega-nota { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }
    .collega label { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; cursor: pointer; }

    /* Ruoli delle colonne lette. */
    .colonne { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 16px; }
    .colonne-head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 14px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text-primary);
    }
    .colonne-corpo { padding: 0 14px 12px; display: flex; flex-wrap: wrap; gap: 10px; }
    .colonna-item { display: flex; flex-direction: column; gap: 3px; min-width: 150px; }
    .colonna-item .esempio { font-size: 11px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
    .colonna-item select { height: 32px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 6px); background: var(--bg-surface); font-size: 13px; padding: 0 6px; }

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
        <p class="page-sub">{{ (step === 'preview' && tipo === 'DDT' ? 'ocrFatture.subtitleDdt' : 'ocrFatture.subtitle') | t }}</p>
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
      <div class="card confronto-host">
        <div class="preview-header">
          <div>
            <h2 class="preview-title">{{ 'ocrFatture.datiEstratti' | t }}</h2>
            <p class="preview-sub">{{ 'ocrFatture.previewSub' | t }}</p>
          </div>
          <button mat-icon-button [matTooltip]="'ocrFatture.ricomincia' | t" (click)="reset()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <div class="confronto">
        <div class="col-dati">

        <div class="tipo-doc" role="group" [attr.aria-label]="'ocrFatture.tipoDocumento' | t">
          <button type="button" [class.attivo]="tipo === 'FATTURA'" (click)="cambiaTipo('FATTURA')">
            {{ 'ocrFatture.tipo.fattura' | t }}
          </button>
          <button type="button" [class.attivo]="tipo === 'DDT'" (click)="cambiaTipo('DDT')">
            {{ 'ocrFatture.tipo.ddt' | t }}
          </button>
        </div>

        <div class="fields-grid">
          <div class="field-group">
            <label>{{ 'ocrFatture.fornitore' | t }}</label>
            <select class="field-input" [ngModel]="fornitoreId ?? 'nuovo'" (ngModelChange)="scegliFornitore($event)">
              <option value="nuovo">{{ 'ocrFatture.fornitoreNuovo' | t }}</option>
              @for (f of fornitori; track f.id) {
                <option [ngValue]="f.id">{{ f.ragioneSociale }}</option>
              }
            </select>
            @if (fornitoreId == null) {
              <input class="field-input" style="margin-top:6px" [(ngModel)]="fornitore"
                     [placeholder]="'ocrFatture.ragioneSocialePlaceholder' | t">
            }
          </div>
          <div class="field-group">
            <label>{{ 'ocrFatture.pIvaFornitore' | t }}</label>
            <input class="field-input" [(ngModel)]="pIva" placeholder="IT12345678901">
          </div>
          <div class="field-group">
            <label>{{ (tipo === 'DDT' ? 'ocrFatture.numeroDdt' : 'ocrFatture.numeroFattura') | t }}</label>
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

        @if (tipo === 'FATTURA') {
          <div class="collega">
            @if (arriviCandidati.length) {
              <div class="collega-titolo">
                <mat-icon style="font-size:18px;width:18px;height:18px">link</mat-icon>
                {{ 'ocrFatture.collega.titolo' | t }}
              </div>
              <p class="collega-nota">{{ 'ocrFatture.collega.nota' | t }}</p>
              @for (a of arriviCandidati; track a.id) {
                <label>
                  <input type="radio" name="arrivo" [value]="a.id" [(ngModel)]="arrivoId">
                  <span>{{ 'ocrFatture.collega.arrivo' | t }} {{ a.numero }} · {{ a.data }}
                    @if (a.numeroDocumentoFornitore) { · {{ 'ocrFatture.collega.ddtNum' | t }} {{ a.numeroDocumentoFornitore }} }
                    · {{ 'ocrFatture.righeCount' | t: { n: a.righe } }}</span>
                </label>
              }
              <label>
                <input type="radio" name="arrivo" [value]="null" [(ngModel)]="arrivoId">
                <span>{{ 'ocrFatture.collega.nessuno' | t }}</span>
              </label>
            } @else {
              <div class="collega-titolo">
                <mat-icon style="font-size:18px;width:18px;height:18px">inventory_2</mat-icon>
                {{ 'ocrFatture.collega.nessunDdt' | t }}
              </div>
              <p class="collega-nota">{{ 'ocrFatture.collega.notaSenzaDdt' | t }}</p>
            }
            @if (!arrivoId) {
              <label>
                <input type="checkbox" [(ngModel)]="caricaMagazzino">
                <span>{{ 'ocrFatture.collega.caricaMagazzino' | t }}</span>
              </label>
            }
          </div>
        }

        @if (numeroColonne > 1) {
          <div class="colonne">
            <div class="colonne-head" (click)="colonneAperte = !colonneAperte">
              <span>
                <mat-icon style="font-size:18px;width:18px;height:18px;vertical-align:middle">view_column</mat-icon>
                {{ 'ocrFatture.colonne.titolo' | t }}
              </span>
              <mat-icon>{{ colonneAperte ? 'expand_less' : 'expand_more' }}</mat-icon>
            </div>
            @if (colonneAperte) {
              <div class="colonne-corpo">
                @for (c of [].constructor(numeroColonne); track $index) {
                  <div class="colonna-item">
                    <span class="esempio">{{ esempioColonna($index) }}</span>
                    <select [ngModel]="ruoloDi($index)" [ngModelOptions]="{ standalone: true }"
                            (ngModelChange)="cambiaRuolo($index, $event)">
                      @for (r of ruoliDisponibili; track r) {
                        <option [value]="r">{{ 'ocrFatture.ruolo.' + r | t }}</option>
                      }
                    </select>
                  </div>
                }
                <div style="align-self:flex-end">
                  <button mat-stroked-button type="button" (click)="salvaColonne()">
                    <mat-icon>save</mat-icon>&nbsp;{{ 'ocrFatture.colonne.ricorda' | t }}
                  </button>
                </div>
              </div>
            }
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
            <tfoot [hidden]="tipo === 'DDT' && !totaleNetto">
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
            <mat-icon>check</mat-icon>&nbsp;{{ (tipo === 'DDT' ? 'ocrFatture.confermaCaricaMagazzino' : 'ocrFatture.confermaCreaAcquisto') | t }}
          </button>
        </div>

        </div><!-- /colonna dati -->

        <aside class="anteprima">
          <div class="anteprima-head">
            <span>{{ 'ocrFatture.anteprima' | t }}</span>
            @if (anteprime.length) {
              <button type="button" class="zoom-link" (click)="apriDocumento()">{{ 'ocrFatture.apriDocumento' | t }}</button>
            }
          </div>
          <div class="anteprima-box">
            @if (anteprime.length) {
              @for (pagina of anteprime; track $index) {
                <img [src]="pagina" [alt]="('ocrFatture.anteprima' | t) + ' ' + ($index + 1)">
              }
            } @else {
              <div class="anteprima-vuota">{{ 'ocrFatture.anteprimaNonDisponibile' | t }}</div>
            }
          </div>
        </aside>

        </div><!-- /confronto -->
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
  /** Arrivo merce creato (DDT, o fattura con carico) e arrivo collegato alla fattura. */
  arrivoCreatoId: number | null = null;
  arrivoCollegatoId: number | null = null;
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
  /** Anagrafica fornitori, per scegliere invece di riscrivere la ragione sociale. */
  fornitori: Fornitore[] = [];
  /** Pagine del documento come immagini, da confrontare con i dati estratti. */
  anteprime: string[] = [];
  /** Il file caricato, tenuto per poterlo riaprire a schermo intero. */
  private fileCorrente: File | null = null;

  /** Fattura o DDT: lo riconosce il backend, l'utente può correggerlo. */
  tipo: 'FATTURA' | 'DDT' = 'FATTURA';
  /** DDT citati dalla fattura e arrivi merce che vi corrispondono. */
  arriviCandidati: ArrivoCandidato[] = [];
  /** Arrivo scelto da collegare alla fattura (null = nessuno). */
  arrivoId: number | null = null;
  /** Senza DDT da collegare: se attiva, la fattura carica anche il magazzino. */
  caricaMagazzino = false;
  /** Ruolo di ogni colonna letta; si ricorda per fornitore. */
  ruoli: RuoloColonna[] = [];
  /** Pannello dei ruoli aperto (si apre da solo quando il riconoscimento è debole). */
  colonneAperte = false;
  readonly ruoliDisponibili = RUOLI;
  /** Testo del documento, per rileggere le righe quando cambiano i ruoli. */
  private righeLette: OcrRiga[] = [];

  readonly docText = inject(DocumentTextService);
  private readonly ds = inject(DataService);

  constructor(private http: HttpClient, private snack: MatSnackBar) {
    // L'anagrafica serve appena si apre la pagina: la tendina dev'essere già
    // pronta quando compaiono i dati letti.
    this.ds.getFornitori().subscribe({
      next: (f) => (this.fornitori = f ?? []),
      error: () => (this.fornitori = []),
    });
  }

  /**
   * Scelta dalla tendina: con un fornitore esistente si prendono ragione sociale
   * e P.IVA dall'anagrafica — sono più affidabili di quelle lette dal documento —
   * e si richiede l'abbinamento delle righe, che dipende dal fornitore.
   */
  scegliFornitore(valore: number | 'nuovo') {
    if (valore === 'nuovo') {
      this.fornitoreId = null;
      this.fornitoreNoto = false;
      return;
    }
    const scelto = this.fornitori.find((f) => f.id === valore);
    if (!scelto) return;
    this.fornitoreId = scelto.id ?? null;
    this.fornitoreNoto = true;
    this.fornitore = scelto.ragioneSociale;
    if (scelto.pIva) this.pIva = scelto.pIva;
    this.analizzaRighe();
  }

  /** Tipo scelto a mano: la prima lettura lascia decidere al riconoscimento. */
  private tipoForzato: 'FATTURA' | 'DDT' | null = null;

  /** Numero massimo di colonne lette su una riga: definisce quante tendine mostrare. */
  get numeroColonne(): number {
    return this.righeLette.reduce((max, r) => Math.max(max, r.celle?.length ?? 0), 0);
  }

  /** Valori d'esempio di una colonna, per capire che cos'è senza indovinare. */
  esempioColonna(i: number): string {
    const valori = this.righeLette
      .map((r) => r.celle?.[i] ?? '')
      .filter((v) => v.trim())
      .slice(0, 2);
    return valori.join(' · ') || '—';
  }

  ruoloDi(i: number): RuoloColonna {
    return this.ruoli[i] ?? 'ignora';
  }

  /**
   * L'utente cambia il ruolo di una colonna: le righe si ricostruiscono dai
   * valori letti, non si rilegge il documento. Il risultato si vede subito.
   */
  cambiaRuolo(i: number, ruolo: RuoloColonna) {
    const n = this.numeroColonne;
    if (!this.ruoli.length) this.ruoli = Array.from({ length: n }, () => 'ignora' as RuoloColonna);
    while (this.ruoli.length < n) this.ruoli.push('ignora');
    // Codice, descrizione e prezzo stanno in una colonna sola: assegnarli
    // altrove libera la precedente, così non restano due "prezzo".
    if (ruolo !== 'ignora') {
      this.ruoli = this.ruoli.map((r) => (r === ruolo ? 'ignora' : r));
    }
    this.ruoli[i] = ruolo;
    this.applicaRuoli();
  }

  /** Ricostruisce le righe dai valori letti secondo i ruoli assegnati. */
  private applicaRuoli() {
    if (!this.ruoli.some((r) => r && r !== 'ignora')) return;
    const numero = (v: string | undefined) => {
      if (!v) return null;
      // "1.234,56" all'italiana, "1,234.56" all'inglese: decide l'ultimo separatore.
      const pulito = v.replace(/[^\d.,-]/g, '');
      const sep = Math.max(pulito.lastIndexOf(','), pulito.lastIndexOf('.'));
      const norm = sep >= 0 && pulito.length - sep - 1 <= 2
        ? pulito.slice(0, sep).replace(/[.,]/g, '') + '.' + pulito.slice(sep + 1)
        : pulito.replace(/[.,]/g, '');
      const n = parseFloat(norm);
      return Number.isFinite(n) ? n : null;
    };

    this.righe = this.righeLette.map((letta, idx) => {
      const celle = letta.celle ?? [];
      const precedente = this.righe[idx];
      const riga: OcrRiga = { ...letta, candidati: precedente?.candidati, prodottoId: precedente?.prodottoId ?? null };
      this.ruoli.forEach((ruolo, i) => {
        const valore = celle[i];
        if (!valore || ruolo === 'ignora') return;
        switch (ruolo) {
          case 'codice': riga.codice = valore; break;
          case 'descrizione': riga.descrizione = valore; break;
          case 'quantita': riga.quantita = numero(valore) ?? riga.quantita; break;
          case 'prezzo': riga.prezzo = numero(valore) ?? riga.prezzo; break;
          case 'iva': riga.iva = numero(valore) ?? riga.iva; break;
          case 'totale': break; // il totale si ricalcola da quantità e prezzo
        }
      });
      return riga;
    });
  }

  /** Ricorda i ruoli per questo fornitore, così il prossimo documento è già a posto. */
  salvaColonne() {
    if (!this.fornitoreId) {
      this.snack.open(this.i18n.t('ocrFatture.colonne.serveFornitore'), '', { duration: 4000 });
      return;
    }
    this.http.post(`${environment.apiUrl}/ocr/layout`, {
      fornitoreId: this.fornitoreId, tipo: this.tipo, ruoli: this.ruoli,
    }).subscribe({
      next: () => this.snack.open(this.i18n.t('ocrFatture.colonne.salvate'), '', { duration: 2500 }),
      error: () => this.snack.open(this.i18n.t('ocrFatture.colonne.erroreSalvataggio'), '', { duration: 4000 }),
    });
    this.analizzaRighe();
  }

  /** Rilegge lo stesso documento come fattura o come DDT. */
  cambiaTipo(nuovo: 'FATTURA' | 'DDT') {
    if (nuovo === this.tipo || !this.fileCorrente) return;
    this.tipoForzato = nuovo;
    void this.processFile(this.fileCorrente);
  }

  /** Apre il documento originale in una finestra a parte, per leggerlo in grande. */
  apriDocumento() {
    if (!this.fileCorrente) return;
    const url = URL.createObjectURL(this.fileCorrente);
    window.open(url, '_blank', 'noopener');
    // L'oggetto resta valido finché la nuova finestra non l'ha caricato.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

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
    this.fileCorrente = file;
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

    this.http.post<any>(`${environment.apiUrl}/ocr/fattura/testo`, { testo, tipo: this.tipoForzato }).subscribe({
      next: (res) => {
        const s = res.suggerito;
        this.affidabilita = res.affidabilita ?? null;
        this.tipo = res.tipo === 'DDT' ? 'DDT' : 'FATTURA';
        this.arriviCandidati = res.arriviCandidati ?? [];
        // Un solo arrivo corrispondente: è quasi certamente quello, si propone
        // già collegato. Se sono più d'uno la scelta resta all'utente.
        this.arrivoId = this.arriviCandidati.length === 1 ? this.arriviCandidati[0].id : null;
        this.ruoli = (res.layoutRighe as RuoloColonna[]) ?? [];
        this.fornitore = s.fornitore || '';
        this.pIva = s.pIvaFornitore || '';
        this.dataDoc = s.dataDoc || new Date().toISOString().substring(0, 10);
        this.numero = s.numero || '';
        this.ocrTotaleNetto = s.totaleNetto != null ? s.totaleNetto : null;
        this.righe = s.righe?.length
          ? s.righe
          : [{ descrizione: '', quantita: 1, prezzo: 0, iva: 22 }];
        this.righeLette = this.righe.map((r) => ({ ...r }));
        if (this.ruoli.length) this.applicaRuoli();
        // Se il riconoscimento è andato male, il pannello dei ruoli si apre da
        // solo: è lì che si sistema, e non è ovvio che esista.
        this.colonneAperte = !this.ruoli.length && (this.affidabilita ?? 1) < 0.6;
        this.step = 'preview';
        this.analizzaRighe();
        // L'anteprima arriva dopo i dati: è un aiuto al controllo, non deve
        // ritardare la comparsa dei campi da rivedere.
        void this.caricaAnteprima();
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
    const righe = this.righe.map(r => ({
      descrizione: r.descrizione, quantita: r.quantita, prezzo: r.prezzo, iva: r.iva,
      prodottoId: r.prodottoId ?? null, codice: r.codice || '',
    }));
    const comune = { fornitore: this.fornitore, pIva: this.pIva, dataDoc: this.dataDoc, numero: this.numero, righe };

    // Un DDT diventa un arrivo merce (e carica il magazzino); una fattura
    // diventa un acquisto, che carica solo se glielo si chiede.
    const url = this.tipo === 'DDT' ? 'ocr/ddt/conferma' : 'ocr/fattura/conferma';
    const corpo = this.tipo === 'DDT'
      ? comune
      : { ...comune, arrivoId: this.arrivoId, caricaMagazzino: this.arrivoId ? false : this.caricaMagazzino };

    this.http.post<any>(`${environment.apiUrl}/${url}`, corpo).subscribe({
      next: (res) => {
        this.acquistoId = res.acquistoId ?? null;
        this.arrivoCreatoId = res.arrivoId ?? res.arrivoCreato ?? null;
        this.arrivoCollegatoId = res.arrivoCollegato ?? null;
        this.step = 'success';
      },
      error: (e) => {
        if (e.status === 409) {
          const gia = this.tipo === 'DDT'
            ? this.i18n.t('ocrFatture.msg.ddtGiaCaricato', { id: e.error?.arrivoId })
            : this.i18n.t('ocrFatture.msg.acquistoGiaPresente', { id: e.error?.acquistoId });
          this.snack.open(gia, this.i18n.t('ocrFatture.vaiAcquisti'), { duration: 5000 });
          this.step = 'preview';
        } else {
          this.errorMsg = e.error?.error || this.i18n.t('ocrFatture.msg.erroreConferma');
          this.step = 'error';
        }
      },
    });
  }

  private async caricaAnteprima(): Promise<void> {
    if (!this.fileCorrente) return;
    this.anteprime = await this.docText.anteprima(this.fileCorrente);
  }

  reset() {
    this.step = 'idle';
    this.anteprime = [];
    this.fileCorrente = null;
    this.fornitore = '';
    this.pIva = '';
    this.dataDoc = '';
    this.numero = '';
    this.righe = [];
    this.acquistoId = null;
    this.arrivoCreatoId = null;
    this.arrivoCollegatoId = null;
    this.tipo = 'FATTURA';
    this.tipoForzato = null;
    this.arriviCandidati = [];
    this.arrivoId = null;
    this.caricaMagazzino = false;
    this.ruoli = [];
    this.colonneAperte = false;
    this.righeLette = [];
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
