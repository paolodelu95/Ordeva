import { Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { DataService } from '../../services/data.service';
import { Prodotto, ProdottoVariante } from '../../models';
import { creaProdottoDaRiga } from '../../utils/crea-prodotto-da-riga';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

export interface ProdottoPick {
  prodotto: Prodotto;
  variante?: ProdottoVariante;
}

@Component({
  selector: 'app-prodotto-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatInputModule, MatFormFieldModule, TPipe],
  template: `
    <h2 mat-dialog-title style="display:flex;align-items:center;gap:8px">
      @if (selectedProdotto) {
        <button mat-icon-button type="button" (click)="backToList()" style="margin-right:4px">
          <mat-icon>arrow_back</mat-icon>
        </button>
        {{ i18n.t('shared.prodottoPicker.titleVarianti', { nome: selectedProdotto.codice }) }}
      } @else {
        {{ 'shared.prodottoPicker.titleSeleziona' | t }}
      }
    </h2>
    <mat-dialog-content style="width:580px; min-height:420px">
      @if (!selectedProdotto) {
        <mat-form-field style="width:100%; margin-bottom:8px">
          <mat-label>{{ 'shared.prodottoPicker.cercaLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="query" (ngModelChange)="filter()" autofocus
                 [placeholder]="'shared.prodottoPicker.cercaPh' | t">
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
        <div class="picker-list">
          @for (p of filtered; track p.id) {
            <div class="picker-row" (click)="select(p)">
              <span class="picker-code">{{ p.codice || '—' }}</span>
              <span class="picker-nome">
                {{ p.descrizione }}
                @if (p.haVarianti) {
                  <span style="font-size:10px;background:#cffafe;color:#6d28d9;padding:1px 5px;border-radius:99px;margin-left:4px;font-weight:700">{{ 'shared.prodottoPicker.varianti' | t }}</span>
                }
              </span>
              <span class="picker-cat">{{ p.categoria }}</span>
              @if (p.barcode) { <span class="picker-barcode">{{ p.barcode }}</span> }
              <span class="picker-price">{{ p.prezzo | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
              <span class="picker-iva">{{ p.iva }}%</span>
            </div>
          }
          @if (!filtered.length) {
            <div style="padding:24px 0; text-align:center">
              <p style="color:#94a3b8; margin:0 0 12px">{{ 'shared.prodottoPicker.nessunProdotto' | t }}</p>
              <button mat-flat-button color="primary" type="button" (click)="creaNuovo()">
                <mat-icon>add</mat-icon> {{ query ? i18n.t('shared.prodottoPicker.creaConQuery', { query }) : ('shared.prodottoPicker.creaNuovoProdotto' | t) }}
              </button>
            </div>
          }
        </div>
      } @else {
        <div style="margin-bottom:12px;color:#64748b;font-size:13px">
          {{ 'shared.prodottoPicker.selezionaVariante' | t }}
        </div>
        <div class="picker-list">
          <!-- Option: take the product without a specific variant -->
          <div class="picker-row picker-row-no-variant" (click)="selectWithoutVariant()">
            <mat-icon style="color:#94a3b8;font-size:18px">inventory_2</mat-icon>
            <span style="flex:1;font-style:italic;color:#64748b">{{ 'shared.prodottoPicker.nessunaVarianteSpecifica' | t }}</span>
          </div>
          @for (v of variantiList; track v.id) {
            <div class="picker-row" (click)="selectVariante(v)"
                 [style.opacity]="v.quantita === 0 ? '0.45' : '1'">
              <div style="flex:1;display:flex;align-items:center;gap:12px">
                @if (v.taglia) {
                  <span style="background:#f1f5f9;border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px">{{ v.taglia }}</span>
                }
                @if (v.colore) {
                  <span style="background:#cffafe;color:#6d28d9;border-radius:6px;padding:3px 10px;font-weight:700;font-size:13px">{{ v.colore }}</span>
                }
                @if (v.barcode) {
                  <span style="font-size:11px;color:#94a3b8;font-family:monospace">{{ v.barcode }}</span>
                }
              </div>
              <span style="font-size:13px;color:#1e293b;font-weight:600">
                {{ i18n.t('shared.prodottoPicker.qta', { n: v.quantita }) }}
                @if (v.quantita === 0) { <span style="color:#ef4444;font-size:11px"> ({{ 'shared.prodottoPicker.esaurito' | t }})</span> }
              </span>
            </div>
          }
          @if (!variantiList.length) {
            <p style="color:#94a3b8;padding:24px;text-align:center">{{ 'shared.prodottoPicker.nessunaVarianteConfigurata' | t }}</p>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!selectedProdotto) {
        <button mat-stroked-button color="primary" type="button" (click)="creaNuovo()" style="margin-right:auto">
          <mat-icon>add</mat-icon> {{ 'shared.prodottoPicker.creaNuovoProdotto' | t }}
        </button>
      }
      <button mat-button mat-dialog-close>{{ 'shared.prodottoPicker.annulla' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .picker-list { max-height: 380px; overflow-y: auto; }
    .picker-row {
      display: flex; align-items: center; padding: 10px 8px; cursor: pointer;
      gap: 12px; border-bottom: 1px solid #f1f5f9;
    }
    .picker-row:hover { background: #f0f4ff; }
    .picker-row-no-variant { border: 1px dashed #e2e8f0; border-radius: 8px; margin-bottom: 8px; }
    .picker-code { font-family: monospace; font-weight: 700; min-width: 90px; color: #0e6480; font-size: 13px; }
    .picker-nome { flex: 1; font-weight: 500; }
    .picker-cat { color: #64748b; font-size: 12px; min-width: 80px; }
    .picker-barcode { font-family: monospace; font-size: 11px; color: #94a3b8; min-width: 100px; }
    .picker-price { color: #059669; font-weight: 600; min-width: 80px; text-align: right; }
    .picker-iva { color: #94a3b8; font-size: 12px; min-width: 40px; text-align: right; }
  `]
})
export class ProdottoPickerComponent implements OnInit {
  i18n = inject(I18nService);
  query = '';
  prodotti: Prodotto[] = [];
  filtered: Prodotto[] = [];
  selectedProdotto: Prodotto | null = null;
  variantiList: ProdottoVariante[] = [];

  constructor(
    private ds: DataService,
    private dialog: MatDialog,
    public dialogRef: MatDialogRef<ProdottoPickerComponent>,
    // Accetta sia la lista prodotti diretta (uso legacy) sia un oggetto
    // { prodotti?, query? } per aprire il picker GIÀ filtrato sul testo digitato.
    @Inject(MAT_DIALOG_DATA) data: Prodotto[] | { prodotti?: Prodotto[]; query?: string } | null
  ) {
    const arr = Array.isArray(data) ? data : data?.prodotti;
    this.query = (Array.isArray(data) ? '' : (data?.query || '')).trim();
    if (arr?.length) {
      this.prodotti = arr;
      this.filtered = this.query ? this.applyQuery(arr) : [...arr];
    }
  }

  ngOnInit() {
    this.ds.getProdotti().subscribe(p => {
      this.prodotti = p;
      this.filtered = this.query ? this.applyQuery(p) : [...p];
    });
  }

  filter() {
    this.filtered = this.applyQuery(this.prodotti);
  }

  private applyQuery(list: Prodotto[]): Prodotto[] {
    // Ricerca "a token": ogni pezzo della query (separato da spazi) deve essere
    // contenuto in codice + descrizione (+ categoria). Così "12 7" trova "SKB 12V 7,2Ah".
    // Barcode e codice fornitore sono esclusi dal match parziale: sono lunghi e tutti
    // cifre, quindi pezzi numerici corti combacerebbero con quasi ogni prodotto.
    const tokens = this.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [...list];
    return list.filter(p => {
      const hay = `${p.codice ?? ''} ${p.descrizione ?? ''} ${p.categoria ?? ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  select(p: Prodotto) {
    if (p.haVarianti) {
      this.selectedProdotto = p;
      this.variantiList = [];
      this.ds.getProdottoVarianti(p.id!).subscribe(v => this.variantiList = v);
    } else {
      this.dialogRef.close({ prodotto: p, variante: undefined } as ProdottoPick);
    }
  }

  selectWithoutVariant() {
    if (this.selectedProdotto) {
      this.dialogRef.close({ prodotto: this.selectedProdotto, variante: undefined } as ProdottoPick);
    }
  }

  selectVariante(v: ProdottoVariante) {
    this.dialogRef.close({ prodotto: this.selectedProdotto!, variante: v } as ProdottoPick);
  }

  backToList() {
    this.selectedProdotto = null;
    this.variantiList = [];
  }

  /** Crea un nuovo prodotto (stesso dialog della schermata Prodotti) precompilato col
   *  testo cercato; al salvataggio chiude il picker restituendo il prodotto creato. */
  creaNuovo() {
    creaProdottoDaRiga(this.dialog, this.ds, { codiceProdotto: this.query })
      .subscribe(nuovo => {
        if (nuovo) this.dialogRef.close({ prodotto: nuovo, variante: undefined } as ProdottoPick);
      });
  }
}
