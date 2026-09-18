import { Component, Inject, inject } from '@angular/core';
import { CommonModule, formatCurrency } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';
import { FatturaInsoluta } from '../../models';

export interface FattureInsoluteDialogData {
  clienteNome: string;
  fatture: FatturaInsoluta[];
}

/**
 * Cosa ha scelto l'utente chiudendo l'avviso:
 *  - `continua`: ha preso nota, prosegue col documento;
 *  - `cliente`: non vuole più l'avviso per questo cliente;
 *  - `tutti`: non vuole più l'avviso per nessun cliente.
 * Chiudere con Esc o cliccando fuori equivale a `continua`.
 */
export type SceltaAvvisoInsoluti = 'continua' | 'cliente' | 'tutti';

/**
 * Avviso "il cliente ha fatture da saldare".
 *
 * È INFORMATIVO: compare quando si sceglie il cliente di una nuova fattura o
 * di un nuovo DDT, cioè prima di scrivere le righe, e non blocca nulla. Prima
 * compariva solo al salvataggio, a lavoro finito, con un "Non salvare ora"
 * che faceva perdere il documento appena composto. Le due opzioni per
 * spegnerlo stanno qui, dove l'avviso dà fastidio: chi lo spegne sa sempre
 * dove riaccenderlo (scheda cliente / Impostazioni), lo dice lo snackbar.
 */
@Component({
  selector: 'app-fatture-insolute-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule, TPipe, TnPipe],
  template: `
    <div class="fi-head">
      <div class="fi-icona" [class.fi-icona--scaduta]="scaduto > 0">
        <mat-icon>{{ scaduto > 0 ? 'error_outline' : 'warning_amber' }}</mat-icon>
      </div>
      <div class="fi-titoli">
        <h2 mat-dialog-title class="fi-titolo">{{ 'shared.fattureInsolute.titleScadute' | t }}</h2>
        <p class="fi-cliente">{{ data.clienteNome }}</p>
      </div>
    </div>

    <mat-dialog-content class="fi-corpo">
      <p class="fi-intro">
        {{ 'shared.fattureInsolute.introPrefix' | t }}
        <strong>{{ data.fatture.length | tn:'shared.fattureInsolute.fatturaAperta' }}</strong>
        {{ data.fatture.length | tn:'shared.fattureInsolute.nonSaldata' }}
      </p>

      <div class="fi-tabella-wrap">
        <table class="fi-tabella">
          <thead>
            <tr>
              <th>{{ 'shared.fattureInsolute.colNumero' | t }}</th>
              <th>{{ 'shared.fattureInsolute.colScadenza' | t }}</th>
              <th class="r">{{ 'shared.fattureInsolute.colResiduo' | t }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (f of data.fatture; track f.id) {
              <tr>
                <td class="fi-num">{{ f.numero }}<span class="fi-data">{{ f.dataEmissione | date:'dd/MM/yyyy' }}</span></td>
                <td>{{ f.dataScadenza ? (f.dataScadenza | date:'dd/MM/yyyy') : '—' }}</td>
                <td class="r fi-importo">{{ f.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                <td>
                  <span class="fi-chip" [class.fi-chip--scaduta]="f.scaduta">
                    {{ (f.scaduta ? 'shared.fattureInsolute.scaduta' : 'shared.fattureInsolute.inScadenza') | t }}
                  </span>
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">
                {{ 'shared.fattureInsolute.totaleAperto' | t }}
                @if (scaduto > 0 && scaduto < totale) {
                  <span class="fi-di-cui">{{ 'shared.fattureInsolute.diCuiScaduto' | t: { importo: scadutoTesto } }}</span>
                }
              </td>
              <td class="r fi-totale">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="fi-azioni">
      <button mat-button type="button" [matMenuTriggerFor]="menuSpegni" class="fi-spegni">
        <mat-icon>notifications_off</mat-icon>
        {{ 'shared.fattureInsolute.nonAvvisarmi' | t }}
        <mat-icon iconPositionEnd>expand_more</mat-icon>
      </button>
      <mat-menu #menuSpegni="matMenu">
        <button mat-menu-item type="button" (click)="chiudi('cliente')">
          <mat-icon>person_off</mat-icon> {{ 'shared.fattureInsolute.nonPerCliente' | t }}
        </button>
        <button mat-menu-item type="button" (click)="chiudi('tutti')">
          <mat-icon>notifications_off</mat-icon> {{ 'shared.fattureInsolute.nonPerTutti' | t }}
        </button>
      </mat-menu>
      <span class="fi-spazio"></span>
      <button mat-flat-button color="primary" type="button" (click)="chiudi('continua')" cdkFocusInitial>
        {{ 'shared.fattureInsolute.continua' | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .fi-head { display: flex; align-items: center; gap: 12px; padding: 20px 24px 0; }
    .fi-icona {
      width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--warning-soft); color: var(--warning-on);
    }
    .fi-icona--scaduta { background: var(--danger-soft); color: var(--danger-on); }
    .fi-icona mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .fi-titolo { margin: 0; padding: 0; font-size: 16px; font-weight: 600; }
    .fi-cliente { margin: 2px 0 0; font-size: 13px; color: var(--text-secondary); }

    .fi-corpo { min-width: 480px; max-width: 640px; padding: 16px 24px; }
    .fi-intro { margin: 0 0 14px; font-size: 13.5px; color: var(--text-primary); }
    .fi-tabella-wrap { overflow-x: auto; }
    .fi-tabella { width: 100%; border-collapse: collapse; font-size: 13px; }
    .fi-tabella th {
      text-align: left; padding: 7px 10px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .03em; color: var(--text-tertiary);
      background: var(--bg-subtle); border-bottom: 1px solid var(--border);
    }
    .fi-tabella td { padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    .fi-tabella .r { text-align: right; }
    .fi-num { font-weight: 600; white-space: nowrap; }
    .fi-data { display: block; font-weight: 400; font-size: 11.5px; color: var(--text-tertiary); }
    .fi-importo { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .fi-chip {
      display: inline-block; padding: 2px 8px; border-radius: 99px; white-space: nowrap;
      font-size: 11px; font-weight: 600; background: var(--warning-soft); color: var(--warning-on);
    }
    .fi-chip--scaduta { background: var(--danger-soft); color: var(--danger-on); }
    .fi-tabella tfoot td {
      padding: 9px 10px; font-weight: 600; background: var(--bg-subtle);
      border-top: 2px solid var(--border); border-bottom: 0;
    }
    .fi-di-cui { display: block; font-weight: 500; font-size: 12px; color: var(--danger-on); }
    .fi-totale { color: var(--danger-on); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

    .fi-azioni { display: flex; align-items: center; gap: 8px; padding: 12px 24px 16px; flex-wrap: wrap; }
    .fi-spazio { flex: 1; }
    .fi-spegni { color: var(--text-secondary); }

    @media (max-width: 600px) {
      .fi-corpo { min-width: 0; }
      .fi-spegni { width: 100%; }
    }
  `],
})
export class FattureInsoluteDialogComponent {
  i18n = inject(I18nService);
  /** Residuo complessivo e quota già scaduta. */
  totale: number;
  scaduto: number;

  constructor(
    public dialogRef: MatDialogRef<FattureInsoluteDialogComponent, SceltaAvvisoInsoluti>,
    @Inject(MAT_DIALOG_DATA) public data: FattureInsoluteDialogData,
  ) {
    this.totale = data.fatture.reduce((s, f) => s + (f.totale ?? 0), 0);
    this.scaduto = data.fatture.filter(f => f.scaduta).reduce((s, f) => s + (f.totale ?? 0), 0);
  }

  /** Quota scaduta già formattata: la pipe currency può dare null e il t-pipe vuole una stringa. */
  get scadutoTesto(): string {
    // formatCurrency come la pipe del resto della tabella: toLocaleString in
    // italiano non separa le migliaia sotto 10.000 ("2442,40 €").
    return formatCurrency(this.scaduto, 'it', '€', 'EUR', '1.2-2');
  }

  chiudi(scelta: SceltaAvvisoInsoluti) {
    this.dialogRef.close(scelta);
  }
}
