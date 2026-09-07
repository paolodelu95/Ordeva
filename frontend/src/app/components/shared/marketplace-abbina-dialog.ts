import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProdottoPickerComponent, ProdottoPick } from './prodotto-picker';
import { MarketplaceRigaDaAbbinare } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

interface RigaAbbinaVM extends MarketplaceRigaDaAbbinare {
  prodottoId: number | null;
  prodottoNome: string | null;
}

/**
 * Righe di un ordine marketplace (eBay, poi Amazon) il cui SKU non è ancora
 * collegato a un Prodotto locale — l'utente lo conferma una volta sola qui,
 * poi il backend lo ricorda per sempre (marketplace_mapping) e i prossimi
 * ordini con lo stesso SKU si abbinano da soli.
 */
@Component({
  selector: 'app-marketplace-abbina-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TPipe, TnPipe],
  template: `
    <h2 mat-dialog-title>{{ 'marketplaceAbbina.title' | t }}</h2>
    <mat-dialog-content style="min-width:520px;max-width:720px">
      <p style="font-size:13px;color:var(--text-tertiary);margin:0 0 14px">
        {{ 'marketplaceAbbina.intro' | t }}
      </p>
      @for (r of righe; track r.orderId + r.sku + r.titolo) {
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="flex:1;font-size:13px;font-weight:600;color:var(--text-secondary)">{{ r.titolo }}</span>
            <span style="font-size:12px;color:var(--text-tertiary)">{{ r.prezzo | currency:'EUR':'symbol':'1.2-2':'it' }} · {{ 'marketplaceAbbina.acquirente' | t }} {{ r.acquirente }}</span>
          </div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:2px">
            {{ 'marketplaceAbbina.sku' | t }} <span style="font-family:monospace">{{ r.sku || '—' }}</span>
            · {{ 'marketplaceAbbina.quantita' | t }} {{ r.quantita }}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            @if (r.prodottoId) {
              <span style="flex:1;font-size:13px;color:var(--text-primary)">{{ r.prodottoNome }}</span>
              <button mat-button type="button" (click)="scegli(r)">{{ 'marketplaceAbbina.cambia' | t }}</button>
            } @else {
              <button mat-stroked-button type="button" style="flex:1" (click)="scegli(r)">
                <mat-icon>search</mat-icon> {{ 'marketplaceAbbina.scegliProdotto' | t }}
              </button>
            }
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <span style="flex:1;font-size:13px;color:var(--text-secondary);padding-left:6px">{{ 'marketplaceAbbina.tutteRichieste' | t }}</span>
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="nPronte < righe.length" (click)="conferma()">
        {{ 'marketplaceAbbina.conferma' | t }}
      </button>
    </mat-dialog-actions>`,
})
export class MarketplaceAbbinaDialogComponent {
  i18n = inject(I18nService);
  righe: RigaAbbinaVM[];

  constructor(
    public dialogRef: MatDialogRef<MarketplaceAbbinaDialogComponent>,
    private dialog: MatDialog,
    @Inject(MAT_DIALOG_DATA) data: MarketplaceRigaDaAbbinare[],
  ) {
    this.righe = data.map(r => ({ ...r, prodottoId: null, prodottoNome: null }));
  }

  // Tutte le righe devono essere abbinate prima di confermare: il backend
  // raggruppa per ordine e importerebbe un ordine multi-articolo con solo le
  // righe inviate, perdendo per sempre quelle mancanti (l'ordine risulta già
  // importato). Meglio bloccare la conferma finché non sono tutte pronte.
  get nPronte(): number {
    return this.righe.filter(r => r.prodottoId != null).length;
  }

  scegli(r: RigaAbbinaVM) {
    this.dialog.open(ProdottoPickerComponent, { width: '600px', maxWidth: '96vw' })
      .afterClosed().subscribe((pick: ProdottoPick | undefined) => {
        if (!pick?.prodotto?.id) return;
        r.prodottoId = pick.prodotto.id;
        r.prodottoNome = pick.prodotto.nome;
      });
  }

  conferma() {
    const pronte = this.righe.filter(r => r.prodottoId != null);
    if (!pronte.length) return;
    this.dialogRef.close(pronte.map(r => ({
      orderId: r.orderId, sku: r.sku, titolo: r.titolo, quantita: r.quantita,
      prezzo: r.prezzo, acquirente: r.acquirente, prodottoId: r.prodottoId!,
    })));
  }
}
