import { Component, OnInit, NgZone, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { MarketplaceAbbinaDialogComponent } from '../shared/marketplace-abbina-dialog';
import { MarketplaceCanale, MarketplaceRigaDaAbbinare } from '../../models';
import { TPipe } from '../../pipes/t.pipe';

@Component({
  selector: 'app-marketplace',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
            MatSlideToggleModule, MatProgressSpinnerModule, MatDialogModule, MatSnackBarModule, TPipe],
  template: `
    <div class="mkt-page">
      <h1 class="page-title">{{ 'marketplace.title' | t }}</h1>
      <p class="mkt-hint">{{ 'marketplace.hint' | t }}</p>

      <!-- ── eBay ─────────────────────────────────────────────────────────────── -->
      <div class="card">
        <h3 class="section-title">eBay</h3>
        <p class="mkt-intro">{{ 'marketplace.intro' | t }}</p>
        <div class="mkt-stato">
          <mat-icon [style.color]="ebayConnesso ? '#16a34a' : '#94a3b8'">{{ ebayConnesso ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
          <span class="mkt-stato-label">
            {{ (ebayConnesso ? 'marketplace.connesso' : 'marketplace.nonConnesso') | t }}
            @if (ebayConnesso && ebayConfig?.accountLabel) { <span class="mkt-stato-sub"> · {{ ebayConfig?.accountLabel }}</span> }
          </span>
          @if (ebayConnesso) {
            <mat-slide-toggle [checked]="!!ebayConfig?.attivo" (change)="toggleAttivo('ebay')">
              {{ 'marketplace.attiva' | t }}
            </mat-slide-toggle>
          }
        </div>
        @if (ebayConnesso && ebayConfig?.ultimaSync) {
          <p class="mkt-ultima-sync">{{ 'marketplace.ultimaSync' | t:{ data: (ebayConfig?.ultimaSync | date:'dd/MM/yyyy HH:mm') ?? '' } }}</p>
        }
        <div class="mkt-azioni">
          @if (!ebayConnesso) {
            <button mat-flat-button color="primary" type="button" (click)="connettiEbay()">
              <mat-icon>link</mat-icon> {{ 'marketplace.connetti' | t }}
            </button>
          } @else {
            <button mat-stroked-button type="button" [disabled]="syncInCorso['EBAY'] || !ebayConfig?.attivo" (click)="sincronizza('ebay')">
              @if (syncInCorso['EBAY']) { <mat-spinner diameter="16" class="mkt-spinner"></mat-spinner> }
              <mat-icon>sync</mat-icon> {{ (syncInCorso['EBAY'] ? 'marketplace.sincronizzazione' : 'marketplace.sincronizzaOra') | t }}
            </button>
            <button mat-button color="warn" type="button" (click)="disconnetti('ebay')">
              <mat-icon>link_off</mat-icon> {{ 'marketplace.scollega' | t }}
            </button>
          }
        </div>
      </div>

      <!-- ── Shopify ──────────────────────────────────────────────────────────── -->
      <div class="card">
        <h3 class="section-title">Shopify</h3>
        @if (!shopifyConnesso) {
          <p class="mkt-intro">{{ 'marketplace.shopify.intro' | t }}</p>
          <div class="mkt-shopify-form">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ 'marketplace.shopify.dominio' | t }}</mat-label>
              <input matInput [(ngModel)]="shopifyDominio" placeholder="nome-negozio.myshopify.com">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>{{ 'marketplace.shopify.token' | t }}</mat-label>
              <input matInput type="password" [(ngModel)]="shopifyToken">
            </mat-form-field>
            <button mat-flat-button color="primary" type="button" [disabled]="shopifyConnettendo || !shopifyDominio || !shopifyToken" (click)="connettiShopify()">
              @if (shopifyConnettendo) { <mat-spinner diameter="16" class="mkt-spinner"></mat-spinner> }
              <mat-icon>link</mat-icon> {{ 'marketplace.connetti' | t }}
            </button>
          </div>
        } @else {
          <div class="mkt-stato">
            <mat-icon style="color:#16a34a">check_circle</mat-icon>
            <span class="mkt-stato-label">
              {{ 'marketplace.connesso' | t }}
              @if (shopifyConfig?.accountLabel) { <span class="mkt-stato-sub"> · {{ shopifyConfig?.accountLabel }}</span> }
            </span>
            <mat-slide-toggle [checked]="!!shopifyConfig?.attivo" (change)="toggleAttivo('shopify')">
              {{ 'marketplace.attiva' | t }}
            </mat-slide-toggle>
          </div>
          @if (shopifyConfig?.ultimaSync) {
            <p class="mkt-ultima-sync">{{ 'marketplace.ultimaSync' | t:{ data: (shopifyConfig?.ultimaSync | date:'dd/MM/yyyy HH:mm') ?? '' } }}</p>
          }
          <div class="mkt-azioni">
            <button mat-stroked-button type="button" [disabled]="syncInCorso['SHOPIFY'] || !shopifyConfig?.attivo" (click)="sincronizza('shopify')">
              @if (syncInCorso['SHOPIFY']) { <mat-spinner diameter="16" class="mkt-spinner"></mat-spinner> }
              <mat-icon>sync</mat-icon> {{ (syncInCorso['SHOPIFY'] ? 'marketplace.sincronizzazione' : 'marketplace.sincronizzaOra') | t }}
            </button>
            <button mat-button color="warn" type="button" (click)="disconnetti('shopify')">
              <mat-icon>link_off</mat-icon> {{ 'marketplace.scollega' | t }}
            </button>
          </div>
        }
      </div>

      <!-- ── Amazon ───────────────────────────────────────────────────────────── -->
      <div class="card mkt-amazon">
        <h3 class="section-title">Amazon</h3>
        <div class="mkt-stato">
          <mat-icon style="color:#94a3b8">hourglass_empty</mat-icon>
          <span class="mkt-stato-label mkt-stato-attesa">{{ 'marketplace.amazonAttesa' | t }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .mkt-page { padding: 18px; max-width: 640px; margin: 0 auto; }
    .mkt-page .page-title { margin: 0 0 2px; }
    .mkt-hint { font-size: 12.5px; color: var(--text-tertiary, #94a3b8); margin: 0 0 18px; }
    .card { margin-bottom: 16px; }
    .section-title {
      font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      color: #64748b; margin: 0 0 8px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
    }
    .mkt-amazon { opacity: 0.65; }
    .mkt-intro { color: #64748b; font-size: 13px; margin: 0 0 14px; }
    .mkt-stato { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
    .mkt-stato-label { flex: 1; min-width: 180px; font-size: 14px; color: #0f172a; }
    .mkt-stato-attesa { color: #64748b; min-width: 220px; }
    .mkt-stato-sub { color: #64748b; }
    .mkt-ultima-sync { color: #94a3b8; font-size: 12.5px; margin: 8px 0 0; }
    .mkt-azioni { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .mkt-spinner { display: inline-block; vertical-align: middle; margin-right: 6px; }
    .mkt-shopify-form { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
  `],
})
export class MarketplaceComponent implements OnInit {
  private ds = inject(DataService);
  private i18n = inject(I18nService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private confirm = inject(ConfirmService);
  private zone = inject(NgZone);

  canali: MarketplaceCanale[] = [];
  syncInCorso: Record<string, boolean> = {};
  shopifyDominio = '';
  shopifyToken = '';
  shopifyConnettendo = false;

  get ebayConfig(): MarketplaceCanale | null { return this.canali.find(c => c.canale === 'EBAY') ?? null; }
  get ebayConnesso(): boolean { return !!this.ebayConfig?.connesso; }
  get shopifyConfig(): MarketplaceCanale | null { return this.canali.find(c => c.canale === 'SHOPIFY') ?? null; }
  get shopifyConnesso(): boolean { return !!this.shopifyConfig?.connesso; }

  ngOnInit() {
    this.load();
    this.listenOauthCallback();
  }

  private load() {
    this.ds.getMarketplaceConfigs().subscribe(r => this.canali = r.canali ?? []);
  }

  /** Ascolta il rientro OAuth dal browser di sistema (deep-link ordevaauth://,
   *  inoltrato da main.rs come evento "oauth-callback"). No-op fuori da Tauri. */
  private listenOauthCallback() {
    if (!isTauri()) return;
    listen<string[]>('oauth-callback', e => this.zone.run(() => this.handleOauthCallback(e.payload))).catch(() => {});
  }

  private handleOauthCallback(urls: string[]) {
    const url = urls.find(u => u.startsWith('ordevaauth://'));
    if (!url) return;
    let code: string | null = null;
    try { code = new URL(url).searchParams.get('code'); } catch { /* URL malformato, ignora */ }
    if (!code) {
      this.snack.open(this.i18n.t('marketplace.msg.codiceMancante'), '', { duration: 3500 });
      return;
    }
    this.ds.exchangeEbayCode(code).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('marketplace.msg.collegato'), '', { duration: 3000 }); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreCollegamento'), '', { duration: 4000 }),
    });
  }

  connettiEbay() {
    this.ds.getEbayAuthUrl().subscribe({
      next: r => { open(r.url).catch(() => {}); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreConnetti'), '', { duration: 4000 }),
    });
  }

  connettiShopify() {
    if (this.shopifyConnettendo || !this.shopifyDominio || !this.shopifyToken) return;
    this.shopifyConnettendo = true;
    this.ds.connectShopify(this.shopifyDominio, this.shopifyToken).subscribe({
      next: () => {
        this.shopifyConnettendo = false;
        this.shopifyDominio = '';
        this.shopifyToken = '';
        this.load();
        this.snack.open(this.i18n.t('marketplace.msg.collegato'), '', { duration: 3000 });
      },
      error: e => {
        this.shopifyConnettendo = false;
        this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreCollegamento'), '', { duration: 4500 });
      },
    });
  }

  toggleAttivo(canale: string) {
    this.ds.toggleMarketplace(canale).subscribe({
      next: () => this.load(),
      error: e => this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreGenerico'), '', { duration: 3500 }),
    });
  }

  async disconnetti(canale: string) {
    const ok = await this.confirm.delete(this.i18n.t('marketplace.msg.confermaScollega'));
    if (!ok) return;
    this.ds.disconnettiMarketplace(canale).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('marketplace.msg.scollegato'), '', { duration: 2500 }); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreGenerico'), '', { duration: 3500 }),
    });
  }

  sincronizza(canale: 'ebay' | 'shopify') {
    const canaleUp = canale.toUpperCase();
    if (this.syncInCorso[canaleUp]) return;
    this.syncInCorso[canaleUp] = true;
    const sync$ = canale === 'ebay' ? this.ds.syncEbay() : this.ds.syncShopify();
    sync$.subscribe({
      next: res => {
        this.syncInCorso[canaleUp] = false;
        this.load();
        if (res.daAbbinare.length) {
          this.dialog.open(MarketplaceAbbinaDialogComponent, { data: res.daAbbinare, width: '640px', maxWidth: '96vw' })
            .afterClosed().subscribe((abbinamenti: (MarketplaceRigaDaAbbinare & { prodottoId: number })[] | undefined) => {
              if (!abbinamenti?.length) {
                this.snack.open(this.i18n.tn('marketplace.msg.ordiniImportati', res.importati), '', { duration: 3000 });
                return;
              }
              this.ds.abbinaMarketplace(canaleUp, abbinamenti).subscribe({
                next: res2 => this.snack.open(this.i18n.tn('marketplace.msg.ordiniImportati', res.importati + res2.importati), '', { duration: 3000 }),
                error: e => this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreAbbinamento'), '', { duration: 4000 }),
              });
            });
        } else {
          this.snack.open(this.i18n.tn('marketplace.msg.ordiniImportati', res.importati), '', { duration: 3000 });
        }
      },
      error: e => {
        this.syncInCorso[canaleUp] = false;
        this.snack.open(e.error?.error || this.i18n.t('marketplace.msg.erroreSync'), '', { duration: 4000 });
      },
    });
  }
}
