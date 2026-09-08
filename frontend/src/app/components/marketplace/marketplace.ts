import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { MarketplaceStatistica } from '../../models';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Vendite per canale (eBay/Amazon/Shopify) — sola lettura. La connessione dei
 * canali e le sincronizzazioni vivono invece in Impostazioni → Sincronizzazione
 * (vedi MarketplaceCanaliComponent): questa è una pagina di report vendite,
 * per questo sta sotto il menu Vendite e non dentro Impostazioni.
 */
@Component({
  selector: 'app-marketplace',
  standalone: true,
  imports: [CommonModule, TPipe],
  template: `
    <div class="mkt-page">
      <h1 class="page-title">{{ 'marketplace.title' | t }}</h1>
      <p class="mkt-hint">{{ 'marketplace.hint' | t }}</p>

      <div class="card">
        <h3 class="section-title">{{ 'marketplace.statistiche.titolo' | t }}</h3>
        @if (statistiche.length) {
          <table class="mkt-stats-table">
            <thead>
              <tr>
                <th>{{ 'marketplace.statistiche.data' | t }}</th>
                <th>{{ 'marketplace.statistiche.canale' | t }}</th>
                <th class="mkt-num">{{ 'marketplace.statistiche.numeroVendite' | t }}</th>
                <th class="mkt-num">{{ 'marketplace.statistiche.totale' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of statistiche; track r.data + r.canale) {
                <tr>
                  <td>{{ r.data | date:'dd/MM/yyyy' }}</td>
                  <td><span class="badge" [class.primary]="r.canale === 'EBAY'" [class.success]="r.canale === 'SHOPIFY'" [class.warning]="r.canale === 'AMAZON'">{{ canaleLabel(r.canale) }}</span></td>
                  <td class="mkt-num">{{ r.numeroVendite }}</td>
                  <td class="mkt-num">{{ r.totale | currency:'EUR' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="mkt-intro">{{ 'marketplace.statistiche.vuoto' | t }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .mkt-page { padding: 18px; max-width: 640px; margin: 0 auto; }
    .mkt-page .page-title { margin: 0 0 2px; }
    .mkt-hint { font-size: 12.5px; color: var(--text-tertiary, #94a3b8); margin: 0 0 18px; }
    .section-title {
      font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      color: #64748b; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
    }
    .mkt-intro { color: #64748b; font-size: 13px; margin: 0; }
    .mkt-stats-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .mkt-stats-table th { text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.03em; color: #94a3b8; padding: 0 8px 8px 0; }
    .mkt-stats-table td { padding: 8px 8px 8px 0; border-top: 1px solid #f1f5f9; color: #0f172a; }
    .mkt-stats-table .mkt-num { text-align: right; }
  `],
})
export class MarketplaceComponent implements OnInit {
  private ds = inject(DataService);

  statistiche: MarketplaceStatistica[] = [];

  ngOnInit() {
    this.ds.getMarketplaceStatistiche().subscribe(r => this.statistiche = r ?? []);
  }

  canaleLabel(canale: string): string {
    return canale === 'EBAY' ? 'eBay' : canale === 'SHOPIFY' ? 'Shopify' : canale === 'AMAZON' ? 'Amazon' : canale;
  }
}
