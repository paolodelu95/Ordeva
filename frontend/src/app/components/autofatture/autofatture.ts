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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../services/i18n.service';
import { DocumentTextService } from '../../services/document-text.service';
import { DataService } from '../../services/data.service';
import { TPipe } from '../../pipes/t.pipe';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
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
  statoSdi?: string;
  dataInvioSdi?: string;
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
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
    MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatMenuModule, EmptyStateComponent, TPipe,
  ],
  styles: [`
    /* La pagina segue il guscio comune (.page/.card/.badge da styles.scss):
       qui restano solo le cose che esistono davvero soltanto in questa schermata. */
    .intestazione { flex: 1; min-width: 0; }
    .sotto-titolo { font-size: 13px; color: var(--text-secondary); margin: 4px 0 0; max-width: 760px; line-height: 1.45; }

    /* ── elenco ── */
    .lista { width: 100%; border-collapse: collapse; font-size: 13.5px; }
    .lista th {
      padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap;
      color: var(--text-secondary); border-bottom: 1px solid var(--border);
    }
    .lista td { padding: 11px 12px; border-bottom: 1px solid var(--border-subtle); }
    .lista tbody tr { cursor: pointer; transition: background var(--transition-fast); }
    .lista tbody tr:hover { background: var(--bg-subtle); }
    .lista tbody tr:last-child td { border-bottom: 0; }
    .col-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .col-azioni { width: 48px; text-align: right; }
    .fornitore-cella { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .paese {
      flex-shrink: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
      color: var(--text-tertiary); border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 1px 5px;
    }
    .badge + .badge { margin-left: 6px; }

    /* ── editor ── */
    /* Due colonne solo quando c'è davvero il documento da affiancare. */
    .confronto-host { container-type: inline-size; }
    .confronto { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
    .confronto > .col-dati { min-width: 0; }
    .anteprima { min-width: 0; order: -1; }
    .anteprima-head {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 11px; font-weight: 700; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
    }
    .anteprima-box {
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
      background: var(--bg-subtle); padding: 8px; overflow: auto;
      display: flex; gap: 8px; max-height: 38vh; flex-direction: row; align-items: flex-start;
    }
    .anteprima-box img {
      border-radius: var(--radius-sm); box-shadow: var(--shadow-xs);
      display: block; width: auto; height: 34vh; object-fit: contain;
    }
    @container (min-width: 1080px) {
      /* Senza :has() la colonna resterebbe riservata anche a vuoto, e il modulo
         si stringerebbe nella metà sinistra di una scheda mezza bianca. */
      .confronto:has(.anteprima) { grid-template-columns: minmax(0, 1fr) minmax(280px, 360px); }
      .anteprima { order: 0; position: sticky; top: 12px; }
      .anteprima-box { max-height: 72vh; flex-direction: column; align-items: stretch; }
      .anteprima-box img { width: 100%; height: auto; }
    }

    /* Intestazione del documento aperto: numero e stato, allineati alle azioni. */
    .doc-head {
      display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;
      padding-bottom: 16px; margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle);
    }
    .doc-titolo { font-size: 17px; font-weight: 700; color: var(--text-primary); margin: 0; }
    .doc-sotto { font-size: 12.5px; color: var(--text-tertiary); margin: 3px 0 0; }
    .doc-stati { margin-left: auto; display: flex; align-items: center; gap: 6px; }

    .sezione {
      font-size: 11px; font-weight: 700; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em;
      margin: 26px 0 12px; display: flex; align-items: center; gap: 8px;
    }
    .sezione:first-of-type { margin-top: 0; }
    .sezione mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--text-tertiary); }
    .sezione .azione-inline { margin-left: auto; }
    .nota { font-size: 12.5px; color: var(--text-secondary); margin: 0 0 14px; max-width: 720px; line-height: 1.5; }

    /* align-items:start: senza, la griglia stira ogni campo all'altezza della
       riga e i riquadri accanto a un testo d'aiuto lungo diventano enormi. */
    .campi {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 4px 16px; align-items: start;
    }
    .campi mat-form-field { width: 100%; }

    /* Tipo documento: tre possibilità, si vede a colpo d'occhio quale è scelta. */
    .tipo-doc { display: inline-flex; gap: 4px; background: var(--bg-subtle); padding: 3px; border-radius: var(--radius-md); }
    .tipo-doc button {
      border: 0; background: none; padding: 7px 18px; border-radius: calc(var(--radius-md) - 2px);
      font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .tipo-doc button:hover:not(:disabled):not(.attivo) { color: var(--text-primary); }
    .tipo-doc button.attivo { background: var(--bg-surface); color: var(--primary); box-shadow: var(--shadow-xs); }
    .tipo-doc button:disabled { cursor: default; opacity: .7; }

    /* ── righe ── */
    .righe-wrap { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
    .righe { width: 100%; min-width: 700px; border-collapse: collapse; font-size: 13px; }
    .righe th {
      padding: 8px 8px; text-align: left; font-size: 10.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap;
      color: var(--text-secondary); border-bottom: 1px solid var(--border);
    }
    .righe td { padding: 3px 4px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    .righe tfoot td { padding: 7px 10px; border-bottom: 0; }
    .righe tfoot tr:first-child td { border-top: 1px solid var(--border); }
    .righe .num, .righe th.num { text-align: right; }
    .cella {
      width: 100%; height: 34px; padding: 0 8px; box-sizing: border-box;
      border: 1px solid transparent; border-radius: var(--radius-sm);
      background: transparent; color: var(--text-primary); font-size: 13px; outline: none;
      transition: border-color var(--transition-fast), background var(--transition-fast);
    }
    .cella:hover:not(:disabled) { border-color: var(--border); }
    .cella:focus { border-color: var(--primary); background: var(--bg-surface); box-shadow: var(--shadow-focus); }
    .cella:disabled { color: var(--text-secondary); }
    .cella.num { text-align: right; font-variant-numeric: tabular-nums; }
    /* Le frecce su/giù dei campi numerici rubano larghezza alla colonna e
       rendono la tabella irregolare: i valori si scrivono, non si cliccano. */
    .cella[type=number] { -moz-appearance: textfield; appearance: textfield; }
    .cella[type=number]::-webkit-outer-spin-button,
    .cella[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .w-qta { width: 76px; } .w-um { width: 66px; } .w-prezzo { width: 108px; }
    .w-iva { width: 76px; } .w-tot { width: 116px; } .w-del { width: 44px; }
    .totale-riga { text-align: right; padding-right: 10px; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    .riepilogo-et { text-align: right; color: var(--text-secondary); font-size: 12.5px; }
    .riepilogo-val { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .riga-totale .riepilogo-et, .riga-totale .riepilogo-val { font-size: 15px; font-weight: 700; color: var(--text-primary); }

    /* ── verifiche ── */
    .verifiche {
      border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: 6px 18px 14px; background: var(--bg-surface-2);
    }
    .verifiche.pronte { border-color: var(--success); background: var(--success-soft); }
    .verifiche.bloccate { border-color: var(--danger); background: var(--danger-soft); }
    .controllo {
      display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45;
      padding: 9px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .controllo:last-child { border-bottom: 0; }
    .controllo mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    .controllo.errore mat-icon { color: var(--danger); }
    .controllo.attenzione mat-icon { color: var(--warning); }
    .controllo.info mat-icon { color: var(--text-tertiary); }
    .tutto-ok {
      display: flex; gap: 8px; align-items: center; font-size: 13px; font-weight: 600;
      color: var(--success-on); padding: 10px 0;
    }
    .conferme-titolo {
      font-size: 11px; font-weight: 700; color: var(--text-secondary);
      text-transform: uppercase; letter-spacing: 0.05em;
      margin: 14px 0 4px; padding-top: 12px; border-top: 1px solid var(--border-subtle);
    }
    .conferma-riga { display: flex; align-items: center; gap: 12px; padding: 5px 0; }
    .conferma-riga .quando { font-size: 11px; color: var(--text-tertiary); margin-left: auto; white-space: nowrap; }

    /* Barra azioni: sempre in fondo, con la primaria staccata a destra. */
    .azioni {
      display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
      margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border-subtle);
    }
    .azioni .a-destra { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }

    .avviso {
      display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45;
      background: var(--warning-soft); color: var(--warning-on);
      border-radius: var(--radius-md); padding: 11px 14px; margin-bottom: 18px;
    }
    .avviso.ok { background: var(--success-soft); color: var(--success-on); }
    .avviso mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }

    .attesa { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 56px 24px; text-align: center; }
    .attesa p { margin: 0; }
    .attesa .titolo { font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .attesa .sotto { font-size: 13px; color: var(--text-secondary); max-width: 420px; }
  `],
  template: `
    <div class="page">
      <div class="page-header">
        <div class="intestazione">
          <h1 class="page-title">{{ 'autofatture.titolo' | t }}</h1>
          @if (vista === 'lista') {
            <p class="sotto-titolo">{{ 'autofatture.sottotitolo' | t }}</p>
          }
        </div>
        @if (vista === 'lista') {
          <div class="header-actions">
            <button mat-stroked-button type="button" (click)="apriNuova()">
              <mat-icon>add</mat-icon> {{ 'autofatture.nuova' | t }}
            </button>
            <button mat-flat-button type="button" (click)="fileInput.click()">
              <mat-icon>document_scanner</mat-icon> {{ 'autofatture.scansiona' | t }}
            </button>
          </div>
        }
      </div>

      <input #fileInput type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" (change)="onFile($event)">

      @if (vista === 'lista') {
        <div class="card">
          @if (caricando) {
            <div class="attesa"><mat-spinner diameter="36"></mat-spinner></div>
          } @else if (!elenco.length) {
            <app-empty-state icon="swap_horiz"
                             [title]="'autofatture.nessuna' | t"
                             [message]="'autofatture.nessunaSub' | t">
              <button mat-flat-button type="button" (click)="fileInput.click()">
                <mat-icon>document_scanner</mat-icon> {{ 'autofatture.scansiona' | t }}
              </button>
            </app-empty-state>
          } @else {
            <table class="lista">
              <thead>
                <tr>
                  <th>{{ 'autofatture.campo.numero' | t }}</th>
                  <th>{{ 'autofatture.campo.data' | t }}</th>
                  <th>{{ 'autofatture.campo.tipo' | t }}</th>
                  <th>{{ 'autofatture.campo.fornitore' | t }}</th>
                  <th>{{ 'autofatture.campo.fatturaEstera' | t }}</th>
                  <th class="col-num">{{ 'autofatture.campo.totale' | t }}</th>
                  <th>{{ 'autofatture.campo.stato' | t }}</th>
                  <th class="col-azioni"></th>
                </tr>
              </thead>
              <tbody>
                @for (a of elenco; track a.id) {
                  <tr (click)="apri(a.id!)">
                    <td><b>{{ a.numero }}</b></td>
                    <td>{{ a.data | date:'dd/MM/yyyy' }}</td>
                    <td><span class="badge primary">{{ a.tipoDocumento }}</span></td>
                    <td>
                      <div class="fornitore-cella">
                        @if (a.fornitorePaese) { <span class="paese">{{ a.fornitorePaese }}</span> }
                        <span>{{ a.fornitoreNome || '—' }}</span>
                      </div>
                    </td>
                    <td>{{ a.fatturaEsteraNumero || '—' }}</td>
                    <td class="col-num">{{ a.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                    <td>
                      <span class="badge" [class.warning]="a.stato !== 'CONFERMATA'" [class.success]="a.stato === 'CONFERMATA'">
                        {{ ('autofatture.stato.' + (a.stato === 'CONFERMATA' ? 'confermata' : 'bozza')) | t }}
                      </span>
                      @if (a.statoSdi === 'INVIATA') {
                        <span class="badge info">{{ 'autofatture.stato.inviata' | t }}</span>
                      }
                    </td>
                    <td class="col-azioni" (click)="$event.stopPropagation()">
                      <button mat-icon-button type="button" [matMenuTriggerFor]="menu"
                              [attr.aria-label]="'autofatture.azioni' | t">
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #menu="matMenu">
                        <button mat-menu-item type="button" (click)="apri(a.id!)">
                          <mat-icon>open_in_new</mat-icon> {{ 'autofatture.apri' | t }}
                        </button>
                        <button mat-menu-item type="button" (click)="scaricaXml(a.id!)">
                          <mat-icon>download</mat-icon> {{ 'autofatture.scaricaXml' | t }}
                        </button>
                        <button mat-menu-item type="button" (click)="elimina(a)" [disabled]="a.statoSdi === 'INVIATA'">
                          <mat-icon color="warn">delete_outline</mat-icon> {{ 'autofatture.elimina' | t }}
                        </button>
                      </mat-menu>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }

      @if (vista === 'lettura') {
        <div class="card">
          <div class="attesa">
            <mat-spinner diameter="42"></mat-spinner>
            <p class="titolo">{{ 'autofatture.lettura' | t }}</p>
            <p class="sotto">{{ (docText.fase() === 'ocr' ? 'autofatture.letturaOcr' : 'autofatture.letturaSub') | t }}</p>
          </div>
        </div>
      }

      @if (vista === 'editor' && doc) {
        <div class="card confronto-host">
          <div class="confronto">
            <div class="col-dati">

              <div class="doc-head">
                <div>
                  <h2 class="doc-titolo">{{ doc.numero || ('autofatture.nuova' | t) }}</h2>
                  <p class="doc-sotto">
                    {{ ('autofatture.tipoSpiega.' + doc.tipoDocumento) | t }}
                  </p>
                </div>
                <div class="doc-stati">
                  <span class="badge" [class.warning]="!bloccato" [class.success]="bloccato">
                    {{ ('autofatture.stato.' + (bloccato ? 'confermata' : 'bozza')) | t }}
                  </span>
                  @if (doc.statoSdi === 'INVIATA') {
                    <span class="badge info" [matTooltip]="doc.dataInvioSdi || ''">{{ 'autofatture.stato.inviata' | t }}</span>
                  }
                </div>
              </div>

              @if (doc.statoSdi === 'INVIATA') {
                <div class="avviso ok">
                  <mat-icon>cloud_done</mat-icon>
                  <span>{{ 'autofatture.giaInviata' | t: { data: doc.dataInvioSdi || '' } }}</span>
                </div>
              } @else if (bloccato) {
                <div class="avviso">
                  <mat-icon>lock</mat-icon>
                  <span>{{ 'autofatture.giaConfermata' | t }}</span>
                </div>
              }

              <div class="sezione"><mat-icon>description</mat-icon>{{ 'autofatture.sezione.documento' | t }}</div>
              <div class="campi">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.numero' | t }}</mat-label>
                  <input matInput [(ngModel)]="doc.numero" [disabled]="bloccato">
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.data' | t }}</mat-label>
                  <input matInput type="date" [(ngModel)]="doc.data" [disabled]="bloccato">
                  <mat-hint>{{ 'autofatture.aiuto.data' | t }}</mat-hint>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.fornitore' | t }}</mat-label>
                  <mat-select [ngModel]="doc.fornitoreId" (ngModelChange)="scegliFornitore($event)" [disabled]="bloccato">
                    <mat-option [value]="null">{{ 'autofatture.scegliFornitore' | t }}</mat-option>
                    @for (f of fornitoriEsteri; track f.id) {
                      <mat-option [value]="f.id">{{ f.ragioneSociale }}@if (f.stato) { &nbsp;— {{ f.stato }} }</mat-option>
                    }
                  </mat-select>
                  @if (!fornitoriEsteri.length) {
                    <mat-hint>{{ 'autofatture.aiuto.nessunFornitoreEstero' | t }}</mat-hint>
                  }
                </mat-form-field>
              </div>

              <div class="sezione"><mat-icon>receipt_long</mat-icon>{{ 'autofatture.sezione.originale' | t }}</div>
              <div class="campi">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.numeroEstero' | t }}</mat-label>
                  <input matInput [(ngModel)]="doc.fatturaEsteraNumero" [disabled]="bloccato">
                  <mat-hint>{{ 'autofatture.aiuto.numeroEstero' | t }}</mat-hint>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.dataEstera' | t }}</mat-label>
                  <input matInput type="date" [(ngModel)]="doc.fatturaEsteraData" [disabled]="bloccato">
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.totaleEstero' | t }}</mat-label>
                  <input matInput type="number" step="0.01" [(ngModel)]="doc.totaleEstero" [disabled]="bloccato">
                  <mat-hint>{{ 'autofatture.aiuto.totaleEstero' | t }}</mat-hint>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>{{ 'autofatture.campo.valuta' | t }}</mat-label>
                  <mat-select [(ngModel)]="doc.valuta" (ngModelChange)="cambiaValuta()" [disabled]="bloccato">
                    @for (v of valute; track v) { <mat-option [value]="v">{{ v }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                @if (doc.valuta !== 'EUR') {
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>{{ 'autofatture.campo.cambio' | t }}</mat-label>
                    <input matInput type="number" step="0.000001" [(ngModel)]="doc.cambio"
                           (ngModelChange)="ricalcolaCambio()" [disabled]="bloccato">
                    <mat-hint>{{ 'autofatture.aiuto.cambio' | t: { valuta: doc.valuta } }}</mat-hint>
                  </mat-form-field>
                }
              </div>

              <div class="sezione"><mat-icon>category</mat-icon>{{ 'autofatture.campo.tipo' | t }}</div>
              <div class="tipo-doc" role="group" [attr.aria-label]="'autofatture.campo.tipo' | t">
                @for (t of tipi; track t) {
                  <button type="button" [class.attivo]="doc.tipoDocumento === t" [disabled]="bloccato"
                          (click)="doc.tipoDocumento = t">{{ t }}</button>
                }
              </div>
              @if (motivoTipo) {
                <p class="nota" style="margin-top:10px">
                  <b>{{ 'autofatture.tipoProposto' | t }}</b> {{ ('autofatture.motivo.' + motivoTipo) | t }}
                </p>
              }

              <div class="sezione">
                <mat-icon>list_alt</mat-icon>{{ 'autofatture.righe' | t }}
                @if (!bloccato) {
                  <button mat-icon-button type="button" class="azione-inline"
                          [matTooltip]="'autofatture.scansionaRighe' | t" (click)="fileInput.click()">
                    <mat-icon>document_scanner</mat-icon>
                  </button>
                }
              </div>
              <p class="nota">{{ 'autofatture.righeSpiega' | t }}</p>

              <div class="righe-wrap">
                <table class="righe">
                  <thead>
                    <tr>
                      <th>{{ 'autofatture.campo.codice' | t }}</th>
                      <th>{{ 'autofatture.campo.descrizione' | t }}</th>
                      <th class="num">{{ 'autofatture.campo.qta' | t }}</th>
                      <th>{{ 'autofatture.campo.um' | t }}</th>
                      @if (doc.valuta !== 'EUR') { <th class="num">{{ doc.valuta }}</th> }
                      <th class="num">{{ 'autofatture.campo.prezzoEuro' | t }}</th>
                      <th class="num">{{ 'autofatture.campo.iva' | t }}</th>
                      <th class="num">{{ 'autofatture.campo.imponibile' | t }}</th>
                      @if (!bloccato) { <th class="w-del"></th> }
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of righe; track $index) {
                      <tr>
                        <td><input class="cella" [(ngModel)]="r.codice" [disabled]="bloccato"></td>
                        <td><input class="cella" [(ngModel)]="r.descrizione" [disabled]="bloccato"></td>
                        <td class="w-qta"><input class="cella num" type="number" step="0.01" [(ngModel)]="r.quantita" [disabled]="bloccato"></td>
                        <td class="w-um"><input class="cella" [(ngModel)]="r.unitaMisura" [disabled]="bloccato"></td>
                        @if (doc.valuta !== 'EUR') {
                          <td class="w-prezzo"><input class="cella num" type="number" step="0.01" [(ngModel)]="r.prezzoValuta"
                                     (ngModelChange)="convertiRiga(r)" [disabled]="bloccato"></td>
                        }
                        <td class="w-prezzo"><input class="cella num" type="number" step="0.01" [(ngModel)]="r.prezzo" [disabled]="bloccato"></td>
                        <td class="w-iva"><input class="cella num" type="number" step="0.5" [(ngModel)]="r.iva" [disabled]="bloccato"></td>
                        <td class="w-tot totale-riga">{{ (r.quantita * r.prezzo) | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                        @if (!bloccato) {
                          <td class="w-del">
                            <button mat-icon-button type="button" (click)="togliRiga($index)"
                                    [attr.aria-label]="'autofatture.togliRiga' | t">
                              <mat-icon>delete_outline</mat-icon>
                            </button>
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr>
                      <td [attr.colspan]="colonneTotali" class="riepilogo-et">{{ 'autofatture.campo.imponibile' | t }}</td>
                      <td class="riepilogo-val">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                      @if (!bloccato) { <td></td> }
                    </tr>
                    <tr>
                      <td [attr.colspan]="colonneTotali" class="riepilogo-et">{{ 'autofatture.campo.imposta' | t }}</td>
                      <td class="riepilogo-val">{{ imposta | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                      @if (!bloccato) { <td></td> }
                    </tr>
                    <tr class="riga-totale">
                      <td [attr.colspan]="colonneTotali" class="riepilogo-et">{{ 'autofatture.campo.totale' | t }}</td>
                      <td class="riepilogo-val">{{ (imponibile + imposta) | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                      @if (!bloccato) { <td></td> }
                    </tr>
                  </tfoot>
                </table>
              </div>

              @if (!bloccato) {
                <button mat-stroked-button type="button" style="margin-top:12px" (click)="aggiungiRiga()">
                  <mat-icon>add</mat-icon> {{ 'autofatture.aggiungiRiga' | t }}
                </button>
              }

              <div class="sezione"><mat-icon>fact_check</mat-icon>{{ 'autofatture.verifiche' | t }}</div>
              <p class="nota">{{ 'autofatture.verificheSpiega' | t }}</p>

              @if (!verifiche) {
                <div class="verifiche">
                  <div class="controllo info">
                    <mat-icon>info_outline</mat-icon>
                    <span>{{ 'autofatture.salvaPerVerificare' | t }}</span>
                  </div>
                </div>
              } @else {
                <div class="verifiche" [class.pronte]="verifiche.puoConfermare" [class.bloccate]="verifiche.bloccanti > 0">
                  @if (verifiche.controlli.length) {
                    @for (c of verifiche.controlli; track c.id) {
                      <div class="controllo" [class.errore]="c.esito === 'errore'" [class.attenzione]="c.esito === 'attenzione'">
                        <mat-icon>{{ c.esito === 'errore' ? 'error_outline' : 'warning_amber' }}</mat-icon>
                        <span>{{ ('autofatture.controllo.' + c.id) | t: paramiLeggibili(c) }}</span>
                      </div>
                    }
                  } @else {
                    <div class="tutto-ok"><mat-icon>check_circle</mat-icon>{{ 'autofatture.nessunProblema' | t }}</div>
                  }

                  @if (!bloccato) {
                    <div class="conferme-titolo">{{ 'autofatture.confermeTitolo' | t }}</div>
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
                <button mat-stroked-button type="button" (click)="tornaAllaLista()">
                  <mat-icon>arrow_back</mat-icon> {{ 'autofatture.indietro' | t }}
                </button>
                @if (doc.id) {
                  <button mat-icon-button type="button" color="warn"
                          [matTooltip]="'autofatture.elimina' | t"
                          [attr.aria-label]="'autofatture.elimina' | t"
                          [disabled]="doc.statoSdi === 'INVIATA'" (click)="elimina(doc)">
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                }
                <div class="a-destra">
                  @if (!bloccato) {
                    <button mat-stroked-button type="button" [disabled]="salvando" (click)="salva()">
                      <mat-icon>save</mat-icon> {{ 'autofatture.salva' | t }}
                    </button>
                    <button mat-flat-button type="button"
                            [disabled]="salvando || !verifiche?.puoConfermare" (click)="conferma()">
                      <mat-icon>verified</mat-icon> {{ 'autofatture.confermaEmetti' | t }}
                    </button>
                  } @else {
                    <button mat-stroked-button type="button" (click)="scaricaXml(doc.id!)">
                      <mat-icon>download</mat-icon> {{ 'autofatture.scaricaXml' | t }}
                    </button>
                    @if (doc.statoSdi !== 'INVIATA') {
                      <button mat-stroked-button type="button" (click)="riapri()">
                        <mat-icon>lock_open</mat-icon> {{ 'autofatture.riapri' | t }}
                      </button>
                      <button mat-flat-button type="button" [disabled]="salvando" (click)="inviaSdi()">
                        <mat-icon>cloud_upload</mat-icon> {{ 'autofatture.inviaSdi' | t }}
                      </button>
                    }
                  }
                </div>
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
    </div>
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

  private readonly conferme = inject(ConfirmService);

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

  scaricaXml(id: number) {
    window.open(`${environment.apiUrl}/autofatture/${id}/xml`, '_blank');
  }

  /**
   * Eliminazione. Si dice esattamente che cosa sparisce: se l'autofattura era
   * confermata, con lei se ne va anche l'acquisto generato — che è una
   * registrazione contabile, non un dettaglio.
   */
  async elimina(a: Autofattura) {
    if (!a.id) return;
    const ok = await this.conferme.ask({
      title: this.i18n.t('autofatture.eliminaTitolo'),
      message: a.acquistoId
        ? this.i18n.t('autofatture.eliminaConAcquisto', { numero: a.numero })
        : this.i18n.t('autofatture.eliminaMessaggio', { numero: a.numero }),
      confirmText: this.i18n.t('autofatture.elimina'),
      danger: true,
    });
    if (!ok) return;
    this.http.delete(`${environment.apiUrl}/autofatture/${a.id}`).subscribe({
      next: () => {
        this.snack.open(this.i18n.t('autofatture.msg.eliminata'), '', { duration: 3000 });
        this.tornaAllaLista();
      },
      error: (e) =>
        this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreSalvataggio'), '', { duration: 5000 }),
    });
  }

  /**
   * Trasmissione allo SdI. Dal 1° luglio 2022 questi documenti vanno inviati per
   * obbligo (hanno sostituito l'esterometro), quindi il posto giusto per farlo è
   * qui, subito dopo la conferma.
   */
  async inviaSdi() {
    if (!this.doc?.id) return;
    const ok = await this.conferme.ask({
      title: this.i18n.t('autofatture.inviaSdiTitolo'),
      message: this.i18n.t('autofatture.inviaSdiMessaggio', { numero: this.doc.numero }),
      confirmText: this.i18n.t('autofatture.inviaSdi'),
    });
    if (!ok) return;
    this.salvando = true;
    this.http.post(`${environment.apiUrl}/autofatture/${this.doc.id}/invia-sdi`, {}).subscribe({
      next: () => {
        this.salvando = false;
        this.snack.open(this.i18n.t('autofatture.msg.inviata'), '', { duration: 4000 });
        this.apri(this.doc!.id!);
      },
      error: (e) => {
        this.salvando = false;
        this.snack.open(e.error?.error || this.i18n.t('autofatture.msg.erroreInvio'), '', { duration: 6000 });
      },
    });
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
    let troncato = 0;
    try {
      const estratto = await this.docText.estrai(file);
      testo = estratto.testo;
      // Documento più lungo di quanto si riesca a leggere: va detto subito,
      // perché il totale non tornerà e il motivo non sarebbe intuibile.
      troncato = Math.max(0, estratto.pagineTotali - estratto.pagine);
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
          // Su una fattura estera la partita IVA italiana presente sul documento
          // è quella di chi la riceve: cercare il fornitore con quella avrebbe
          // trovato la propria azienda. Vale la partita IVA estera.
          fornitore: s.fornitore, pIva: s.pIvaEstera || s.pIvaFornitore,
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
            const messaggio = troncato
              ? this.i18n.t('autofatture.msg.pagineNonLette', { pagine: troncato, righe: lette })
              : this.i18n.t(lette ? 'autofatture.msg.righeCopiate' : 'autofatture.msg.righeNonLette');
            this.snack.open(messaggio, '', { duration: lette && !troncato ? 5000 : 9000 });
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

  /**
   * Gli importi dentro i messaggi dei controlli arrivano come numeri nudi: letti
   * così ("le righe fanno 552 ma sulla fattura c'è 600") sembrano codici, non
   * soldi. Qui diventano importi, con il separatore e il simbolo giusti.
   */
  paramiLeggibili(c: Controllo): Record<string, string | number> {
    const soldi = new Set(['righe', 'documento', 'differenza']);
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(c.params ?? {})) {
      out[k] = soldi.has(k) && typeof v === 'number' ? this.formatta(v) : v;
    }
    return out;
  }
}

function round2(v: number): number {
  return Math.round((v || 0) * 100) / 100;
}

function vuota(): RigaAf {
  return { descrizione: '', codice: '', quantita: 1, unitaMisura: '', prezzo: 0, prezzoValuta: null, iva: 22 };
}
