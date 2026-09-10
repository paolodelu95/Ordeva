import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { I18nService } from '../../services/i18n.service';
import { EtichetteService } from '../../services/etichette.service';
import { TPipe } from '../../pipes/t.pipe';
import type { Prodotto } from '../../models';

/**
 * Opzioni di stampa delle etichette. Poche e tutte con un motivo pratico:
 * quante copie (una scatola da sei pezzi vuole sei etichette), da quale casella
 * partire (per riusare un foglio già cominciato) e cosa scriverci sopra.
 */
@Component({
  selector: 'app-etichette-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatCheckboxModule, TPipe],
  styles: [`
    .campo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .campo label { font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
    .campo input {
      height: 38px; padding: 0 12px; font-size: 14px;
      border: 1px solid var(--border-strong); border-radius: var(--radius-md);
      background: var(--bg-surface-2); color: var(--text-primary); outline: none;
    }
    .nota { font-size: 12.5px; color: var(--text-secondary); margin: 0 0 16px; }
    .griglia { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
    .totale { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
    .totale b { color: var(--text-primary); }
  `],
  template: `
    <h2 mat-dialog-title>{{ 'etichette.titolo' | t }}</h2>
    <mat-dialog-content>
      <p class="nota">{{ 'etichette.nota' | t }}</p>

      <div class="griglia">
        <div class="campo">
          <label>{{ 'etichette.copie' | t }}</label>
          <input type="number" min="1" max="100" [(ngModel)]="copie">
        </div>
        <div class="campo">
          <label>{{ 'etichette.inizio' | t }}</label>
          <input type="number" min="1" max="24" [(ngModel)]="inizio">
        </div>
      </div>

      <mat-checkbox [(ngModel)]="prezzo">{{ 'etichette.mostraPrezzo' | t }}</mat-checkbox><br>
      <mat-checkbox [(ngModel)]="codice">{{ 'etichette.mostraCodice' | t }}</mat-checkbox>

      <p class="totale">
        {{ 'etichette.riepilogo' | t: { prodotti: prodotti.length, totale: prodotti.length * (copie || 1) } }}
        @if (senzaCodice) {
          <br>{{ 'etichette.senzaCodice' | t: { n: senzaCodice } }}
        }
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'comune.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="stampando" (click)="stampa()">
        <mat-icon>print</mat-icon>&nbsp;{{ 'etichette.stampa' | t }}
      </button>
    </mat-dialog-actions>
  `,
})
export class EtichetteDialogComponent {
  private readonly etichette = inject(EtichetteService);
  private readonly i18n = inject(I18nService);
  private readonly snack = inject(MatSnackBar);

  copie = 1;
  inizio = 1;
  prezzo = true;
  codice = true;
  stampando = false;

  constructor(
    public dialogRef: MatDialogRef<EtichetteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public prodotti: Prodotto[],
  ) {}

  /** Prodotti senza barcode né codice: l'etichetta esce, ma senza codice a barre. */
  get senzaCodice(): number {
    return this.prodotti.filter((p) => !`${p.barcode ?? ''}`.trim() && !`${p.codice ?? ''}`.trim()).length;
  }

  async stampa() {
    this.stampando = true;
    try {
      const n = await this.etichette.stampa(this.prodotti, {
        copie: this.copie || 1,
        inizio: this.inizio || 1,
        prezzo: this.prezzo,
        codice: this.codice,
      });
      this.dialogRef.close(n);
    } catch {
      this.snack.open(this.i18n.t('etichette.errore'), '', { duration: 4000 });
      this.stampando = false;
    }
  }
}
