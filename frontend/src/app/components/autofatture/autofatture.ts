import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../services/i18n.service';
import { DocumentTextService } from '../../services/document-text.service';
import { DataService } from '../../services/data.service';
import { TPipe } from '../../pipes/t.pipe';
import type { Fornitore } from '../../models';

/** Riga dell'autofattura: la copia di una riga della fattura estera. */
interface RigaAf {
  descrizione: string;
  codice: string;
  quantita: number;
  unitaMisura: string;
  /** Importo unitario in euro: è quello che finisce nell'XML. */
  prezzo: number;
  /** Importo unitario nella valuta originale, se diversa dall'euro. */
  prezzoValuta: number | null;
  /** Aliquota IVA ITALIANA da applicare: sulla fattura estera non c'è. */
  iva: number;
}

interface Autofattura {
  id?: number;
  numero: string;
  data: string;
  tipoDocumento: 'TD17' | 'TD18' | 'TD19';
  fornitoreId: number | null;
  fornitoreNome?: string;
  fornitorePaese?: string;
  fatturaEsteraNumero: string;
  fatturaEsteraData: string;
  valuta: string;
  cambio: number;
  totaleEstero: number | null;
  note: string;
  stato?: string;
  acquistoId?: number | null;
  imponibile?: number;
  imposta?: number;
  totale?: number;
  righe?: RigaAf[];
}

interface Controllo {
  id: string;
  esito: 'errore' | 'attenzione';
  params: Record<string, string | number>;
}

interface Conferma {
  id: string;
  fatta: boolean;
  quando: string | null;
}

interface Verifiche {
  controlli: Controllo[];
  conferme: Conferma[];
  bloccanti: number;
  puoConfermare: boolean;
}

const TIPI: Array<'TD17' | 'TD18' | 'TD19'> = ['TD17', 'TD18', 'TD19'];
/** Le valute in cui arriva praticamente sempre una fattura estera. */
const VALUTE = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'DKK', 'NOK', 'PLN', 'CZK', 'CNY', 'JPY'];

/**
 * Autofatture per acquisti dall'estero.
 *
 * Chi compra da un fornitore estero non riceve l'IVA in fattura: la deve
 * calcolare e versare lui, emettendo un documento elettronico intestato a sé
 * stesso. Sbagliarlo significa versare l'importo sbagliato all'erario, quindi
 * la pagina è costruita per far RALLENTARE: si legge la fattura estera con
 * l'OCR e le righe si copiano identiche, poi il programma elenca i controlli
 * che non tornano e l'utente deve spuntare, uno per uno, di aver confrontato
 * ciò che vede a schermo con il documento che ha in mano. Solo allora
 * l'autofattura si può confermare.
 */
@Component({
  selector: 'app-autofatture',
  host: { '[class.confronto-aperto]': 'anteprime.length > 0' },
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    MatCheckboxModule, TPipe,
  ],
  styles: [`
    :host { display: block; padding: 24px; max-width: 1100px; margin: 0 auto; }
    :host(.confronto-aperto) { max-width: 1500px; }

    .page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .page-header-icon {
      width: 48px; height: 48px; border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--primary) 0%, var(--brand-mid) 100%);
      box-shadow: 0 4px 12px -2px rgba(17,118,155,0.35);
      display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0;
    }
    .page-header-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .page-title { font-size: 20px; font-weight: 700; color: var(--text-primary); margin: 0 0 2px; }
    .page-sub { font-size: 13px; color: var(--text-secondary); margin: 0; }
    .header-actions { margin-left: auto; display: flex; gap: 8px; }

    .card {
      background: var(--bg-surface); border: 1px solid var(--border);
      border-radius: var(--radius-xl); box-shadow: var(--shadow-sm); padding: 28px;
    }

    /* ── elenco ── */
    .lista { width: 100%; border-collapse: collapse; font-size: 13px; }
    .lista th {
      padding: 8px 6px; text-align: left; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-secondary); background: var(--bg-subtle);
      border-bottom: 2px solid var(--border-strong);
    }
    .lista td { padding: 8px 6px; border-bottom: 1px solid var(--border-subtle); }
    .lista tbody tr { cursor: pointer; }
    .lista tbody tr:hover { background: var(--bg-subtle); }
    .num { text-align: right; }
    .vuoto { text-align: center; color: var(--text-tertiary); padding: 40px 8px; font-size: 14px; }
    .vuoto p { margin: 0 0 6px; }

    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 11px; font-weight: 700; letter-spacing: .02em;
    }
    .badge.bozza { background: var(--warning-soft, #fef3c7); color: var(--warning-on, #92400e); }
    .badge.confermata { background: var(--success-soft, #dcfce7); color: var(--success-on, #15803d); }
    .badge.tipo { background: var(--primary-soft); color: var(--primary); }

    /* ── editor ── */
    .confronto-host { container-type: inline-size; }
    .confronto { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
    .confronto > .col-dati { min-width: 0; }
    .anteprima { order: -1; min-width: 0; }
    .anteprima-box {
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
      background: var(--bg-subtle, #f8fafc); padding: 8px; overflow: auto;
      display: flex; gap: 8px; max-height: 36vh; flex-direction: row; align-items: flex-start;
    }
    .anteprima-box img { border-radius: 4px; box-shadow: var(--shadow-sm); display: block; width: auto; height: 32vh; object-fit: contain; }
    .anteprima-head {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; font-weight: 600; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px;
    }
    .anteprima-vuota { font-size: 13px; color: var(--text-tertiary); padding: 24px 8px; text-align: center; }
    @container (min-width: 1100px) {
      .confronto:has(.anteprima) { grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 28px; align-items: start; }
      .anteprima { order: 0; position: sticky; top: 12px; }
      .anteprima-box { max-height: 70vh; flex-direction: column; align-items: stretch; }
      .anteprima-box img { width: 100%; height: auto; }
    }

    .fields-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; margin-bottom: 20px; }
    @media (max-width: 600px) { .fields-grid { grid-template-columns: 1fr; } }
    .field-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field-group label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
    .field-input {
      height: 38px; padding: 0 12px; width: 100%; box-sizing: border-box; min-width: 0;
      border: 1px solid var(--border-strong); border-radius: var(--radius-md);
      background: var(--bg-surface-2); color: var(--text-primary); font-size: 14px; outline: none;
    }
    .field-input:focus { border-color: var(--primary); box-shadow: var(--shadow-focus); }
    .field-hint { font-size: 11.5px; color: var(--text-tertiary); }

    .sezione-titolo {
      font-size: 13px; font-weight: 700; color: var(--text-primary);
      margin: 22px 0 10px; display: flex; align-items: center; gap: 8px;
    }
    .sezione-titolo mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--text-secondary); }

    /* Il tipo lo propone il programma, ma la scelta resta di chi ha comprato. */
    .tipo-doc { display: inline-flex; gap: 4px; background: var(--bg-subtle,#f1f5f9); padding: 3px; border-radius: var(--radius-md); }
    .tipo-doc button {
      border: 0; background: none; padding: 6px 14px; border-radius: calc(var(--radius-md) - 2px);
      font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
    }
    .tipo-doc button.attivo { background: var(--bg-surface); color: var(--primary); box-shadow: var(--shadow-sm); }
    .tipo-spiega { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; max-width: 620px; }

    .righe-section { margin-bottom: 20px; overflow-x: auto; }
    .righe-table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 13px; }
    .righe-table th {
      padding: 8px 6px; text-align: left; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);
      background: var(--bg-subtle); border-bottom: 2px solid var(--border-strong);
    }
    .righe-table td { padding: 4px 2px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    .righe-table tfoot td { padding: 6px 8px; border-top: 2px solid var(--border-strong); }
    .riga-input {
      width: 100%; height: 32px; padding: 0 8px; box-sizing: border-box;
      border: 1px solid transparent; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-primary); font-size: 13px; outline: none;
    }
    .riga-input:focus { border-color: var(--primary); background: var(--bg-surface); }
    .riga-input.num { text-align: right; }
    .col-descr { min-width: 240px; }
    .col-q { width: 70px; } .col-um { width: 60px; } .col-pz { width: 100px; }
    .col-iva { width: 70px; } .col-tot { width: 100px; text-align: right; } .col-del { width: 40px; }
    .total-cell { text-align: right; padding: 4px 8px; font-weight: 600; }
    .summary-label { text-align: right; color: var(--text-secondary); font-size: 12px; padding-right: 8px; }
    .summary-value { text-align: right; padding-right: 8px; font-weight: 600; }
    .total-row .summary-label, .total-row .summary-value { font-size: 15px; font-weight: 700; color: var(--text-primary); }

    /* ── verifiche ── */
    .verifiche { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; margin-top: 8px; }
    .verifiche.pronte { border-color: var(--success, #16a34a); background: var(--success-soft, #f0fdf4); }
    .verifiche.bloccate { border-color: var(--danger, #dc2626); background: var(--danger-soft, #fef2f2); }
    .controllo {
      display: flex; gap: 8px; align-items: flex-start; font-size: 13px;
      padding: 7px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .controllo:last-child { border-bottom: 0; }
    .controllo mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    .controllo.errore mat-icon { color: var(--danger, #dc2626); }
    .controllo.attenzione mat-icon { color: var(--warning, #d97706); }
    .conferma-riga { padding: 6px 0; display: flex; align-items: center; gap: 10px; }
    .conferma-riga .quando { font-size: 11px; color: var(--text-tertiary); margin-left: auto; white-space: nowrap; }
    .tutto-ok { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--success-on, #15803d); font-weight: 600; }
    .azioni { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; align-items: center; }
    .azioni .spazio { margin-left: auto; }

    .avviso {
      display: flex; gap: 8px; align-items: flex-start; font-size: 13px;
      background: var(--warning-soft, #fffbeb); color: var(--warning-on, #92400e);
      border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 16px;
    }
    .avviso mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }

    .center-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; min-height: 220px; text-align: center; }
  `],
  template: `
    <div class="page-header">
      <div class="page-header-icon"><mat-icon>swap_horiz</mat-icon></div>
      <div>
        <h1 class="page-title">{{ 'autofatture.titolo' | t }}</h1>
        <p class="page-sub">{{ 'autofatture.sottotitolo' | t }}</p>
      </div>
      @if (vista === 'lista') {
        <div class="header-actions">
          <button mat-stroked-button (click)="apriNuova()">
            <mat-icon>add</mat-icon>&nbsp;{{ 'autofatture.nuova' | t }}
          </button>
          <button mat-flat-button color="primary" (click)="fileInput.click()">
            <mat-icon>document_scanner</mat-icon>&nbsp;{{ 'autofatture.scansiona' | t }}
          </button>
        </div>
      }
    </div>

    <input #fileInput type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" (change)="onFile($event)">

    @if (vista === 'lista') {
      <div class="card">
        @if (caricando) {
          <div class="center-card"><mat-spinner diameter="36"></mat-spinner></div>
        } @else if (!elenco.length) {
          <div class="vuoto">
            <p>{{ 'autofatture.nessuna' | t }}</p>
            <p class="page-sub">{{ 'autofatture.nessunaSub' | t }}</p>
          </div>
        } @else {
          <table class="lista">
            <thead>
              <tr>
                <th>{{ 'autofatture.campo.numero' | t }}</th>
                <th>{{ 'autofatture.campo.data' | t }}</th>
                <th>{{ 'autofatture.campo.tipo' | t }}</th>
                <th>{{ 'autofatture.campo.fornitore' | t }}</th>
                <th>{{ 'autofatture.campo.fatturaEstera' | t }}</th>
                <th class="num">{{ 'autofatture.campo.totale' | t }}</th>
                <th>{{ 'autofatture.campo.stato' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (a of elenco; track a.id) {
                <tr (click)="apri(a.id!)">
                  <td><b>{{ a.numero }}</b></td>
                  <td>{{ a.data }}</td>
                  <td><span class="badge tipo">{{ a.tipoDocumento }}</span></td>
                  <td>{{ a.fornitoreNome || '—' }}</td>
                  <td>{{ a.fatturaEsteraNumero || '—' }}</td>
                  <td class="num">{{ formatta(a.totale || 0) }}</td>
                  <td>
                    <span class="badge" [class.bozza]="a.stato !== 'CONFERMATA'" [class.confermata]="a.stato === 'CONFERMATA'">
                      {{ ('autofatture.stato.' + (a.stato === 'CONFERMATA' ? 'confermata' : 'bozza')) | t }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }

    @if (vista === 'lettura') {
      <div class="card center-card">
        <mat-spinner diameter="42"></mat-spinner>
        <p class="page-title">{{ 'autofatture.lettura' | t }}</p>
        <p class="page-sub">{{ (docText.fase() === 'ocr' ? 'autofatture.letturaOcr' : 'autofatture.letturaSub') | t }}</p>
      </div>
    }

    @if (vista === 'editor' && doc) {
      <div class="card confronto-host">
        <div class="confronto">
          <div class="col-dati">

            @if (doc.stato === 'CONFERMATA') {
              <div class="avviso">
                <mat-icon>lock</mat-icon>
                <span>{{ 'autofatture.giaConfermata' | t }}</span>
              </div>
            }

            <div class="fields-grid">
              <div class="field-group">
                <label>{{ 'autofatture.campo.numero' | t }}</label>
                <input class="field-input" [(ngModel)]="doc.numero" [disabled]="bloccato">
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.data' | t }}</label>
                <input class="field-input" type="date" [(ngModel)]="doc.data" [disabled]="bloccato">
                <span class="field-hint">{{ 'autofatture.aiuto.data' | t }}</span>
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.fornitore' | t }}</label>
                <select class="field-input" [ngModel]="doc.fornitoreId" (ngModelChange)="scegliFornitore($event)" [disabled]="bloccato">
                  <option [ngValue]="null">{{ 'autofatture.scegliFornitore' | t }}</option>
                  @for (f of fornitoriEsteri; track f.id) {
                    <option [ngValue]="f.id">{{ f.ragioneSociale }} — {{ f.stato }}</option>
                  }
                </select>
                @if (!fornitoriEsteri.length) {
                  <span class="field-hint">{{ 'autofatture.aiuto.nessunFornitoreEstero' | t }}</span>
                }
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.numeroEstero' | t }}</label>
                <input class="field-input" [(ngModel)]="doc.fatturaEsteraNumero" [disabled]="bloccato">
                <span class="field-hint">{{ 'autofatture.aiuto.numeroEstero' | t }}</span>
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.dataEstera' | t }}</label>
                <input class="field-input" type="date" [(ngModel)]="doc.fatturaEsteraData" [disabled]="bloccato">
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.totaleEstero' | t }}</label>
                <input class="field-input" type="number" step="0.01" [(ngModel)]="doc.totaleEstero" [disabled]="bloccato">
                <span class="field-hint">{{ 'autofatture.aiuto.totaleEstero' | t }}</span>
              </div>
              <div class="field-group">
                <label>{{ 'autofatture.campo.valuta' | t }}</label>
                <select class="field-input" [(ngModel)]="doc.valuta" (ngModelChange)="cambiaValuta()" [disabled]="bloccato">
                  @for (v of valute; track v) { <option [ngValue]="v">{{ v }}</option> }
                </select>
              </div>
              @if (doc.valuta !== 'EUR') {
                <div class="field-group">
                  <label>{{ 'autofatture.campo.cambio' | t }}</label>
                  <input class="field-input" type="number" step="0.000001" [(ngModel)]="doc.cambio"
                         (ngModelChange)="ricalcolaCambio()" [disabled]="bloccato">
                  <span class="field-hint">{{ 'autofatture.aiuto.cambio' | t: { valuta: doc.valuta } }}</span>
                </div>
              }
            </div>

            <div class="sezione-titolo"><mat-icon>category</mat-icon>{{ 'autofatture.campo.tipo' | t }}</div>
            <div class="tipo-doc" role="group">
              @for (t of tipi; track t) {
                <button type="button" [class.attivo]="doc.tipoDocumento === t" [disabled]="bloccato"
                        (click)="doc.tipoDocumento = t">{{ t }}</button>
              }
            </div>
            <p class="tipo-spiega">{{ ('autofatture.tipoSpiega.' + doc.tipoDocumento) | t }}</p>
            @if (motivoTipo) {
              <p class="tipo-spiega"><b>{{ 'autofatture.tipoProposto' | t }}</b> {{ ('autofatture.motivo.' + motivoTipo) | t }}</p>
            }

            <div class="sezione-titolo">
              <mat-icon>list_alt</mat-icon>{{ 'autofatture.righe' | t }}
              @if (!bloccato) {
                <button mat-icon-button [matTooltip]="'autofatture.scansionaRighe' | t" (click)="fileInput.click()">
                  <mat-icon>document_scanner</mat-icon>
                </button>
              }
            </div>
            <p class="tipo-spiega">{{ 'autofatture.righeSpiega' | t }}</p>

            <div class="righe-section">
              <table class="righe-table">
                <thead>
                  <tr>
                    <th>{{ 'autofatture.campo.codice' | t }}</th>
                    <th class="col-descr">{{ 'autofatture.campo.descrizione' | t }}</th>
                    <th class="col-q">{{ 'autofatture.campo.qta' | t }}</th>
                    <th class="col-um">{{ 'autofatture.campo.um' | t }}</th>
                    @if (doc.valuta !== 'EUR') { <th class="col-pz">{{ doc.valuta }}</th> }
                    <th class="col-pz">{{ 'autofatture.campo.prezzoEuro' | t }}</th>
                    <th class="col-iva">{{ 'autofatture.campo.iva' | t }}</th>
                    <th class="col-tot">{{ 'autofatture.campo.imponibile' | t }}</th>
                    @if (!bloccato) { <th class="col-del"></th> }
                  </tr>
                </thead>
                <tbody>
                  @for (r of righe; track $index) {
                    <tr>
                      <td><input class="riga-input" [(ngModel)]="r.codice" [disabled]="bloccato"></td>
                      <td><input class="riga-input" [(ngModel)]="r.descrizione" [disabled]="bloccato"></td>
                      <td><input class="riga-input num" type="number" step="0.01" [(ngModel)]="r.quantita" [disabled]="bloccato"></td>
                      <td><input class="riga-input" [(ngModel)]="r.unitaMisura" [disabled]="bloccato"></td>
                      @if (doc.valuta !== 'EUR') {
                        <td><input class="riga-input num" type="number" step="0.01" [(ngModel)]="r.prezzoValuta"
                                   (ngModelChange)="convertiRiga(r)" [disabled]="bloccato"></td>
                      }
                      <td><input class="riga-input num" type="number" step="0.01" [(ngModel)]="r.prezzo" [disabled]="bloccato"></td>
                      <td><input class="riga-input num" type="number" step="0.5" [(ngModel)]="r.iva" [disabled]="bloccato"></td>
                      <td class="total-cell">{{ formatta(r.quantita * r.prezzo) }}</td>
                      @if (!bloccato) {
                        <td>
                          <button mat-icon-button (click)="togliRiga($index)"><mat-icon>delete_outline</mat-icon></button>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <td [attr.colspan]="colonneTotali" class="summary-label">{{ 'autofatture.campo.imponibile' | t }}</td>
                    <td class="summary-value">{{ formatta(imponibile) }}</td>
                    @if (!bloccato) { <td></td> }
                  </tr>
                  <tr>
                    <td [attr.colspan]="colonneTotali" class="summary-label">{{ 'autofatture.campo.imposta' | t }}</td>
                    <td class="summary-value">{{ formatta(imposta) }}</td>
                    @if (!bloccato) { <td></td> }
                  </tr>
                  <tr class="total-row">
                    <td [attr.colspan]="colonneTotali" class="summary-label">{{ 'autofatture.campo.totale' | t }}</td>
                    <td class="summary-value">{{ formatta(imponibile + imposta) }}</td>
                    @if (!bloccato) { <td></td> }
                  </tr>
                </tfoot>
              </table>
            </div>

            @if (!bloccato) {
              <button mat-stroked-button (click)="aggiungiRiga()">
                <mat-icon>add</mat-icon>&nbsp;{{ 'autofatture.aggiungiRiga' | t }}
              </button>
            }

            <div class="sezione-titolo"><mat-icon>fact_check</mat-icon>{{ 'autofatture.verifiche' | t }}</div>
            <p class="tipo-spiega">{{ 'autofatture.verificheSpiega' | t }}</p>

            @if (!verifiche) {
              <div class="verifiche">
                <div class="controllo attenzione">
                  <mat-icon>info</mat-icon>
                  <span>{{ 'autofatture.salvaPerVerificare' | t }}</span>
                </div>
              </div>
            }
            @if (verifiche) {
              <div class="verifiche" [class.pronte]="verifiche.puoConfermare" [class.bloccate]="verifiche.bloccanti > 0">
                @if (verifiche.controlli.length) {
                  @for (c of verifiche.controlli; track c.id) {
                    <div class="controllo" [class.errore]="c.esito === 'errore'" [class.attenzione]="c.esito === 'attenzione'">
                      <mat-icon>{{ c.esito === 'errore' ? 'error' : 'warning' }}</mat-icon>
                      <span>{{ ('autofatture.controllo.' + c.id) | t: c.params }}</span>
                    </div>
                  }
                } @else {
                  <div class="tutto-ok"><mat-icon>check_circle</mat-icon>{{ 'autofatture.nessunProblema' | t }}</div>
                }

                @if (!bloccato) {
                  <div class="sezione-titolo">{{ 'autofatture.confermeTitolo' | t }}</div>
                  @for (c of verifiche.conferme; track c.id) {
                    <div class="conferma-riga">
                      <mat-checkbox [checked]="c.fatta" (change)="spunta(c.id, $event.checked)">
                        {{ ('autofatture.conferma.' + c.id) | t }}
                      </mat-checkbox>
                      @if (c.quando) { <span class="quando">{{ c.quando }}</span> }
                    </div>
                  }
                }
              </div>
            }

            <div class="azioni">
              <button mat-stroked-button (click)="tornaAllaLista()">{{ 'autofatture.indietro' | t }}</button>
              @if (!bloccato) {
                <button mat-stroked-button [disabled]="salvando" (click)="salva()">
                  <mat-icon>save</mat-icon>&nbsp;{{ 'autofatture.salva' | t }}
                </button>
                <button mat-flat-button color="primary" class="spazio"
                        [disabled]="salvando || !verifiche?.puoConfermare" (click)="conferma()">
                  <mat-icon>verified</mat-icon>&nbsp;{{ 'autofatture.confermaEmetti' | t }}
                </button>
              } @else {
                <button mat-stroked-button class="spazio" (click)="scaricaXml()">
                  <mat-icon>download</mat-icon>&nbsp;{{ 'autofatture.scaricaXml' | t }}
                </button>
                <button mat-stroked-button (click)="riapri()">
                  <mat-icon>lock_open</mat-icon>&nbsp;{{ 'autofatture.riapri' | t }}
                </button>
              }
            </div>

          </div><!-- /col-dati -->

          @if (anteprime.length) {
            <aside class="anteprima">
              <div class="anteprima-head"><span>{{ 'autofatture.anteprima' | t }}</span></div>
              <div class="anteprima-box">
                @for (p of anteprime; track $index) {
                  <img [src]="p" [alt]="('autofatture.anteprima' | t) + ' ' + ($index + 1)">
                }
              </div>
            </aside>
          }
        </div>
      </div>
    }
  `,
})
export class AutofattureComponent {
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly i18n = inject(I18nService);
  readonly docText = inject(DocumentTextService);
  private readonly ds = inject(DataService);

  readonly tipi = TIPI;
  readonly valute = VALUTE;

  vista: 'lista' | 'lettura' | 'editor' = 'lista';
  caricando = false;
  salvando = false;

  elenco: Autofattura[] = [];
  doc: Autofattura | null = null;
  righe: RigaAf[] = [];
  verifiche: Verifiche | null = null;
  /** Perché il programma ha proposto quel tipo: si mostra finché non si salva. */
  motivoTipo = '';
  anteprime: string[] = [];
  fornitori: Fornitore[] = [];

  constructor(private http: HttpClient, private snack: MatSnackBar) {
    this.ds.getFornitori().subscribe({
      next: (f) => (this.fornitori = f ?? []),
      error: () => (this.fornitori = []),
    });
    this.caricaElenco();
  }

  /**
   * L'autofattura riguarda solo fornitori esteri: gli altri confondono e basta.
   * Quello già scelto resta però sempre in elenco, anche se in anagrafica è
   * cambiato: altrimenti la tendina si svuoterebbe e il nome sparirebbe.
   */
  get fornitoriEsteri(): Fornitore[] {
    const scelto = this.doc?.fornitoreId ?? null;
    return this.fornitori.filter((f) => {
      if (f.id === scelto) return true;
      const paese = (f.stato || '').trim().toLowerCase();
      return f.estero === true || (paese !== '' && paese !== 'italia' && paese !== 'it');
    });
  }

  get bloccato(): boolean {
    return this.doc?.stato === 'CONFERMATA';
  }

  /** Quante colonne occupa l'etichetta dei totali: dipende dalla valuta. */
  get colonneTotali(): number {
    return this.doc && this.doc.valuta !== 'EUR' ? 7 : 6;
  }

  get imponibile(): number {
    return round2(this.righe.reduce((s, r) => s + round2((r.quantita || 0) * (r.prezzo || 0)), 0));
  }

  get imposta(): number {
    return round2(
      this.righe.reduce((s, r) => s + round2((r.quantita || 0) * (r.prezzo || 0)) * (r.iva || 0) / 100, 0),
    );
  }

  private caricaElenco() {
    this.caricando = true;
    this.http.get<Autofattura[]>(`${environment.apiUrl}/autofatture`).subscribe({
      next: (r) => { this.elenco = r ?? []; this.caricando = false; },
      error: () => { this.elenco = []; this.caricando = false; },
    });
  }

  tornaAllaLista() {
    this.vista = 'lista';
    this.doc = null;
    this.righe = [];
    this.verifiche = null;
    this.anteprime = [];
    this.motivoTipo = '';
    this.caricaElenco();
  }

  apriNuova() {
    this.http.get<Autofattura>(`${environment.apiUrl}/autofatture/nuovo`).subscribe({
      next: (d) => {
        this.doc = { ...d, righe: [] };
        this.righe = [vuota()];
        this.verifiche = null;
        this.anteprime = [];
        this.motivoTipo = '';
        this.vista = 'editor';
      },
      error: () => this.snack.open(this.i18n.t('autofatture.msg.erroreApertura'), '', { duration: 3000 }),
    });
  }

  apri(id: number) {
    this.http.get<Autofattura>(`${environment.apiUrl}/autofatture/${id}`).subscribe({
      next: (d) => {
        this.doc = d;
        this.righe = (d.righe ?? []).map((r) => ({ ...r }));
        // L'anteprima del documento scansionato resta: serve proprio a
        // confrontarla con le righe ricaricate dopo ogni salvataggio.
        this.vista = 'editor';
        this.ricaricaVerifiche();
      },
      error: () => this.snack.open(this.i18n.t('autofatture.msg.erroreApertura'), '', { duration: 3000 }),
    });
  }

  scegliFornitore(id: number | null) {
    if (!this.doc) return;
    this.doc.fornitoreId = id;
    const f = this.fornitori.find((x) => x.id === id);
    this.doc.fornitoreNome = f?.ragioneSociale ?? '';
  }

  aggiungiRiga() { this.righe.push(vuota()); }
  togliRiga(i: number) { this.righe.splice(i, 1); }

  /** Cambiata la valuta: senza cambio valido gli importi in euro non hanno senso. */
  cambiaValuta() {
    if (!this.doc) return;
    if (this.doc.valuta === 'EUR') {
      this.doc.cambio = 1;
      this.righe.forEach((r) => (r.prezzoValuta = null));
    } else {
      this.righe.forEach((r) => { if (r.prezzoValuta == null) r.prezzoValuta = r.prezzo; });
      this.ricalcolaCambio();
    }
  }

  /** Cambiato il tasso: gli importi in euro si rifanno tutti da capo. */
  ricalcolaCambio() {
    this.righe.forEach((r) => this.convertiRiga(r));
  }

  convertiRiga(r: RigaAf) {
    const cambio = this.doc?.cambio ?? 1;
    if (r.prezzoValuta != null && cambio > 0) r.prezzo = round2(r.prezzoValuta * cambio);
  }

  /** Ricarica la checklist dal server: i controlli li fa lui, sui dati salvati. */
  ricaricaVerifiche() {
    if (!this.doc?.id) return;
    this.http.get<Verifiche>(`${environment.apiUrl}/autofatture/${this.doc.id}/verifiche`).subscribe({
      next: (v) => (this.verifiche = v),
      error: () => (this.verifiche = null),
    });
  }

  spunta(id: string, valore: boolean) {
    if (!this.doc?.id) return;
    this.http.post<Verifiche>(`${environment.apiUrl}/autofatture/${this.doc.id}/verifiche`, { [id]: valore })
      .subscribe({
        next: (v) => (this.verifiche = v),
        error: () => this.snack.open(this.i18n.t('autofatture.msg.erroreSalvataggio'), '', { duration: 3000 }),
      });
  }

  salva(silenzioso = false): void {
    if (!this.doc) return;
    const corpo = { ...this.doc, righe: this.righe };
    this.salvando = true;
    const fine = (id: number) => {
      this.salvando = false;
      this.motivoTipo = '';
      if (!silenzioso) this.snack.open(this.i18n.t('autofatture.msg.salvata'), '', { duration: 2500 });
      this.apri(id);
    };
    const errore = (e: any) => {
      this.salvando = false;
      this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreSalvataggio'), '', { duration: 5000 });
    };
    if (this.doc.id) {
      const id = this.doc.id;
      this.http.put(`${environment.apiUrl}/autofatture/${id}`, corpo).subscribe({ next: () => fine(id), error: errore });
    } else {
      this.http.post<{ id: number }>(`${environment.apiUrl}/autofatture`, corpo)
        .subscribe({ next: (r) => fine(r.id), error: errore });
    }
  }

  conferma() {
    if (!this.doc?.id) return;
    this.salvando = true;
    this.http.post<{ acquistoId: number }>(`${environment.apiUrl}/autofatture/${this.doc.id}/conferma`, {}).subscribe({
      next: () => {
        this.salvando = false;
        this.snack.open(this.i18n.t('autofatture.msg.confermata'), '', { duration: 4000 });
        this.apri(this.doc!.id!);
      },
      error: (e) => {
        this.salvando = false;
        this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreConferma'), '', { duration: 5000 });
      },
    });
  }

  riapri() {
    if (!this.doc?.id) return;
    this.http.post(`${environment.apiUrl}/autofatture/${this.doc.id}/riapri`, {}).subscribe({
      next: () => this.apri(this.doc!.id!),
      error: () => this.snack.open(this.i18n.t('autofatture.msg.erroreSalvataggio'), '', { duration: 3000 }),
    });
  }

  scaricaXml() {
    if (!this.doc?.id) return;
    window.open(`${environment.apiUrl}/autofatture/${this.doc.id}/xml`, '_blank');
  }

  // ── lettura della fattura estera ───────────────────────────────────────────

  onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.leggiFattura(file);
  }

  /**
   * Legge la fattura estera e ne copia le righe. Il testo si estrae in locale
   * (layer del PDF o OCR), il backend riconosce le righe e crea la bozza; il
   * tipo di documento arriva come proposta, da confermare.
   */
  private async leggiFattura(file: File) {
    if (!DocumentTextService.accetta(file)) {
      this.snack.open(this.i18n.t('autofatture.msg.formatoNonSupportato'), '', { duration: 3000 });
      return;
    }
    const tornaIndietro = this.vista;
    this.vista = 'lettura';
    let testo = '';
    try {
      testo = (await this.docText.estrai(file)).testo;
    } catch {
      this.vista = tornaIndietro;
      this.snack.open(this.i18n.t('autofatture.msg.erroreLettura'), '', { duration: 4000 });
      return;
    }
    if (testo.trim().length < 20) {
      this.vista = tornaIndietro;
      this.snack.open(this.i18n.t('autofatture.msg.documentoIlleggibile'), '', { duration: 4000 });
      return;
    }

    this.http.post<any>(`${environment.apiUrl}/ocr/fattura/testo`, { testo, tipo: 'FATTURA' }).subscribe({
      next: (res) => {
        const s = res.suggerito ?? {};
        this.http.post<any>(`${environment.apiUrl}/autofatture/da-ocr`, {
          fornitore: s.fornitore, pIva: s.pIvaFornitore,
          numeroEstero: s.numero, dataEstera: s.dataDoc,
          totaleEstero: s.totaleLordo || null,
          righe: s.righe ?? [],
        }).subscribe({
          next: (creata) => {
            this.motivoTipo = creata.motivoTipo || '';
            void this.caricaAnteprima(file);
            this.apri(creata.id);
            // Zero righe riconosciute non è un fallimento: la bozza c'è e il
            // documento è lì accanto da ricopiare. Va però detto chiaramente.
            const lette = creata.righeLette ?? 0;
            this.snack.open(
              this.i18n.t(lette ? 'autofatture.msg.righeCopiate' : 'autofatture.msg.righeNonLette'),
              '',
              { duration: lette ? 5000 : 9000 },
            );
          },
          error: (e) => {
            this.vista = tornaIndietro;
            this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreLettura'), '', { duration: 5000 });
          },
        });
      },
      error: (e) => {
        this.vista = tornaIndietro;
        this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreLettura'), '', { duration: 5000 });
      },
    });
  }

  private async caricaAnteprima(file: File) {
    try {
      this.anteprime = await this.docText.anteprima(file);
    } catch {
      this.anteprime = [];
    }
  }

  formatta(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
  }
}

function round2(v: number): number {
  return Math.round((v || 0) * 100) / 100;
}

function vuota(): RigaAf {
  return { descrizione: '', codice: '', quantita: 1, unitaMisura: '', prezzo: 0, prezzoValuta: null, iva: 22 };
}
