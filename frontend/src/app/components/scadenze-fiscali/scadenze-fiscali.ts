import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';

import { DataService } from '../../services/data.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { ScadenzaFiscale } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Calendario delle scadenze fiscali italiane (edizione offline). Le scadenze standard
 * (IVA, LIPE, ritenute, imposte, dichiarazioni) sono generate dal backend in base a due
 * impostazioni (periodicità IVA, sostituto d'imposta); qui si consultano per anno, si
 * segnano "fatto", si aggiungono scadenze manuali. Le imminenti/scadute alimentano anche
 * le notifiche di sistema (badge).
 */
@Component({
  selector: 'app-scadenze-fiscali',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatIconModule, MatButtonModule, MatCheckboxModule,
    MatSelectModule, MatSlideToggleModule, MatFormFieldModule, MatInputModule, TPipe,
  ],
  template: `
    <div class="page">
      <header class="head">
        <div>
          <h1>{{ 'scadenzeFiscali.title' | t }}</h1>
          <p class="sub">{{ 'scadenzeFiscali.subtitle' | t }}</p>
        </div>
        <div class="year">
          <button mat-icon-button (click)="cambiaAnno(-1)" [title]="'scadenzeFiscali.annoPrecedente' | t"><mat-icon>chevron_left</mat-icon></button>
          <span class="year-val">{{ anno }}</span>
          <button mat-icon-button (click)="cambiaAnno(1)" [title]="'scadenzeFiscali.annoSuccessivo' | t"><mat-icon>chevron_right</mat-icon></button>
        </div>
      </header>

      <div class="card config">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width:220px">
          <mat-label>{{ 'scadenzeFiscali.liquidazioneIva' | t }}</mat-label>
          <mat-select [(value)]="ivaPeriodicita" (selectionChange)="salvaConfig()">
            <mat-option value="trimestrale">{{ 'scadenzeFiscali.trimestrale' | t }}</mat-option>
            <mat-option value="mensile">{{ 'scadenzeFiscali.mensile' | t }}</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-slide-toggle [(ngModel)]="sostitutoImposta" (change)="salvaConfig()">
          {{ 'scadenzeFiscali.sostitutoImposta' | t }}
        </mat-slide-toggle>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="toggleNuova()"><mat-icon>add</mat-icon> {{ 'scadenzeFiscali.aggiungiScadenza' | t }}</button>
      </div>

      @if (mostraNuova) {
        <div class="card nuova">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>{{ 'scadenzeFiscali.nuova.data' | t }}</mat-label>
            <input matInput type="date" [(ngModel)]="nuova.data">
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="flex:1;min-width:200px">
            <mat-label>{{ 'scadenzeFiscali.nuova.descrizione' | t }}</mat-label>
            <input matInput [(ngModel)]="nuova.titolo" [placeholder]="'scadenzeFiscali.nuova.descrizionePlaceholder' | t">
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width:170px">
            <mat-label>{{ 'scadenzeFiscali.nuova.categoria' | t }}</mat-label>
            <mat-select [(value)]="nuova.categoria">
              @for (c of categorie; track c) { <mat-option [value]="c">{{ categoriaLabel(c) }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" style="width:130px">
            <mat-label>{{ 'scadenzeFiscali.nuova.importo' | t }}</mat-label>
            <input matInput type="number" [(ngModel)]="nuova.importo">
          </mat-form-field>
          <button mat-flat-button color="primary" [disabled]="!nuova.data || !nuova.titolo" (click)="creaNuova()">{{ 'fatture.dialog.salva' | t }}</button>
        </div>
      }

      @if (scadenze.length === 0) {
        <p class="vuoto">{{ i18n.t('scadenzeFiscali.nessunaScadenza', { anno }) }}</p>
      }

      <div class="lista">
        @for (s of scadenze; track s.id) {
          <div class="riga" [class.fatto]="s.stato === 'fatto'"
               [class.scaduta]="stato(s) === 'scaduta'" [class.imminente]="stato(s) === 'imminente'">
            <mat-checkbox [checked]="s.stato === 'fatto'" (change)="segna(s, $event.checked)" [title]="'scadenzeFiscali.segnaFatto' | t"></mat-checkbox>
            <div class="data">
              <span class="g">{{ s.data | date:'dd' }}</span>
              <span class="m">{{ s.data | date:'MMM' }}</span>
            </div>
            <div class="info">
              <div class="titolo">{{ s.titolo }}</div>
              <div class="meta">
                <span class="chip" [attr.data-cat]="s.categoria">{{ categoriaLabel(s.categoria) }}</span>
                @if (s.importo) { <span class="imp">€ {{ s.importo | number:'1.2-2' }}</span> }
                @if (stato(s) === 'scaduta') { <span class="warn">{{ 'scadenzeFiscali.scaduta' | t }}</span> }
                @else if (stato(s) === 'imminente') { <span class="soon">{{ 'scadenzeFiscali.inArrivo' | t }}</span> }
              </div>
              @if (s.iva) {
                <!-- Quanto c'è da versare, calcolato dai documenti registrati:
                     è la stessa liquidazione della pagina Adempimenti. -->
                <div class="iva-riepilogo" [class.credito]="s.iva.aCredito">
                  @if (s.iva.aCredito) {
                    <mat-icon>trending_down</mat-icon>
                    <span>{{ i18n.t('scadenzeFiscali.iva.credito', { periodo: s.iva.periodo, importo: fmt(-s.iva.saldo) }) }}</span>
                  } @else if (s.iva.daVersare > 0) {
                    <mat-icon>account_balance</mat-icon>
                    <span>
                      <b>{{ fmt(s.iva.daVersare) }}</b>
                      {{ i18n.t('scadenzeFiscali.iva.daVersare', { periodo: s.iva.periodo }) }}
                      <span class="tributo">{{ i18n.t('scadenzeFiscali.iva.tributo', { codice: s.iva.codiceTributo }) }}</span>
                      @if (s.iva.interessi > 0) {
                        <span class="tributo">{{ i18n.t('scadenzeFiscali.iva.interessi', { importo: fmt(s.iva.interessi) }) }}</span>
                      }
                    </span>
                  } @else {
                    <mat-icon>check_circle</mat-icon>
                    <span>{{ i18n.t('scadenzeFiscali.iva.nulla', { periodo: s.iva.periodo }) }}</span>
                  }
                </div>
                @if (s.iva.scaduta) {
                  <div class="ritardo">
                    <mat-icon>warning_amber</mat-icon>
                    <span>{{ i18n.t('scadenzeFiscali.iva.ritardo', { giorni: s.iva.giorniRitardo }) }}</span>
                  </div>
                }
              }
            </div>
            @if (!s.auto) {
              <button mat-icon-button (click)="elimina(s)" [title]="'scadenzeFiscali.elimina' | t"><mat-icon>delete_outline</mat-icon></button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { max-width: 880px; margin: 0 auto; padding: 24px 20px 60px; color: var(--text-primary); }
    .head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
    h1 { margin:0; font-size:24px; }
    .sub { color:var(--text-secondary); font-size:13px; margin:4px 0 0; }
    .year { display:flex; align-items:center; gap:6px; }
    .year-val { font-size:20px; font-weight:700; min-width:62px; text-align:center; }
    /* Il token --surface non esiste (si chiama --bg-surface): il fallback #fff
       teneva card e righe bianche anche in dark, col testo chiaro sopra. */
    .card { background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
    .config { display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
    .config .spacer { flex:1; }
    .nuova { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
    .vuoto { color:var(--text-tertiary); text-align:center; padding:30px; }
    .lista { display:flex; flex-direction:column; gap:8px; }
    .riga { display:flex; align-items:center; gap:14px; background:var(--bg-surface); border:1px solid var(--border); border-left:4px solid var(--border-strong); border-radius:10px; padding:10px 14px; }
    .riga.imminente { border-left-color:#d97706; }
    /* Riepilogo IVA sotto la scadenza: l'importo si legge senza aprire altro. */
    .iva-riepilogo {
      display:flex; align-items:flex-start; gap:6px; margin-top:6px;
      font-size:12.5px; color:var(--text-secondary,#475569); line-height:1.45;
    }
    .iva-riepilogo mat-icon { font-size:16px; width:16px; height:16px; flex-shrink:0; margin-top:1px; color:#0f766e; }
    .iva-riepilogo b { color:var(--text-primary,#0f172a); font-size:13.5px; }
    .iva-riepilogo.credito mat-icon { color:#15803d; }
    .tributo { color:var(--text-tertiary,#94a3b8); margin-left:8px; white-space:nowrap; }
    .ritardo {
      display:flex; align-items:center; gap:6px; margin-top:4px;
      font-size:12.5px; font-weight:600; color:#b91c1c;
    }
    .ritardo mat-icon { font-size:16px; width:16px; height:16px; }
    .riga.scaduta { border-left-color:#dc2626; }
    .riga.fatto { opacity:.55; }
    .riga.fatto .titolo { text-decoration:line-through; }
    .data { width:46px; text-align:center; line-height:1; }
    .data .g { display:block; font-size:20px; font-weight:700; }
    .data .m { display:block; font-size:11px; text-transform:uppercase; color:var(--text-secondary); }
    .info { flex:1; }
    .titolo { font-weight:600; }
    .meta { display:flex; align-items:center; gap:10px; margin-top:3px; font-size:12.5px; }
    .chip { background:#eef2f7; color:#334155; border-radius:999px; padding:1px 9px; font-size:11.5px; font-weight:600; }
    .chip[data-cat="IVA"] { background:#e0f2fe; color:#075985; }
    .chip[data-cat="LIPE"] { background:#ede9fe; color:#5b21b6; }
    .chip[data-cat="Ritenute"] { background:#fef3c7; color:#92400e; }
    .chip[data-cat="Imposte"] { background:#fee2e2; color:#991b1b; }
    .chip[data-cat="Dichiarazioni"] { background:#dcfce7; color:#166534; }
    .imp { color:var(--text-primary); font-weight:600; }
    .warn { color:#dc2626; font-weight:600; }
    .soon { color:#d97706; font-weight:600; }
  `],
})
export class ScadenzeFiscaliComponent implements OnInit {
  i18n = inject(I18nService);
  private ds = inject(DataService);
  private confirm = inject(ConfirmService);
  private snack = inject(MatSnackBar);

  anno = new Date().getFullYear();
  ivaPeriodicita = 'trimestrale';
  sostitutoImposta = false;
  scadenze: ScadenzaFiscale[] = [];
  readonly categorie = ['IVA', 'LIPE', 'Ritenute', 'Imposte', 'Dichiarazioni', 'Altro'];
  private static readonly CATEGORIA_I18N: Record<string, string> = {
    IVA: 'scadenzeFiscali.categoria.iva',
    LIPE: 'scadenzeFiscali.categoria.lipe',
    Ritenute: 'scadenzeFiscali.categoria.ritenute',
    Imposte: 'scadenzeFiscali.categoria.imposte',
    Dichiarazioni: 'scadenzeFiscali.categoria.dichiarazioni',
    Altro: 'scadenzeFiscali.categoria.altro',
  };
  /** Importo in euro come lo scrive chi compila un F24. */
  fmt(n: number): string {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n ?? 0);
  }

  categoriaLabel(c: string | undefined): string {
    return this.i18n.t(ScadenzeFiscaliComponent.CATEGORIA_I18N[c ?? ''] || c || '');
  }

  mostraNuova = false;
  nuova: Partial<ScadenzaFiscale> = { categoria: 'Altro' };

  ngOnInit() { this.carica(); }

  carica() {
    this.ds.getScadenzeFiscali(this.anno).subscribe({
      next: r => {
        this.scadenze = r.scadenze;
        this.ivaPeriodicita = r.config.ivaPeriodicita;
        this.sostitutoImposta = r.config.sostitutoImposta;
      },
      error: () => this.scadenze = [],
    });
  }

  cambiaAnno(d: number) { this.anno += d; this.carica(); }

  /** Stato visivo della scadenza: 'scaduta' | 'imminente' | 'ok'. */
  stato(s: ScadenzaFiscale): 'scaduta' | 'imminente' | 'ok' {
    if (s.stato === 'fatto') return 'ok';
    // Un periodo IVA chiuso a credito (o a zero) non ha niente da versare:
    // marcarlo "scaduta" spaventerebbe per un adempimento che non esiste.
    if (s.iva && s.iva.daVersare <= 0) return 'ok';
    const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
    const d = new Date(s.data + 'T00:00:00');
    const giorni = Math.round((d.getTime() - oggi.getTime()) / 86400000);
    if (giorni < 0) return 'scaduta';
    if (giorni <= 7) return 'imminente';
    return 'ok';
  }

  segna(s: ScadenzaFiscale, fatto: boolean) {
    const stato = fatto ? 'fatto' : 'pendente';
    s.stato = stato;
    this.ds.updateScadenzaFiscale(s.id!, { stato }).subscribe({ error: () => this.carica() });
  }

  salvaConfig() {
    this.ds.setScadenzeFiscaliConfig({ ivaPeriodicita: this.ivaPeriodicita, sostitutoImposta: this.sostitutoImposta })
      .subscribe({ next: () => this.carica(), error: () => this.snack.open(this.i18n.t('scadenzeFiscali.msg.erroreSalvataggio'), '', { duration: 2500 }) });
  }

  toggleNuova() { this.mostraNuova = !this.mostraNuova; if (this.mostraNuova) this.nuova = { categoria: 'Altro', data: this.anno + '-01-01' }; }

  creaNuova() {
    this.ds.createScadenzaFiscale(this.nuova).subscribe({
      next: () => { this.mostraNuova = false; this.nuova = { categoria: 'Altro' }; this.carica(); this.snack.open(this.i18n.t('scadenzeFiscali.msg.scadenzaAggiunta'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('scadenzeFiscali.msg.errore'), '', { duration: 3000 }),
    });
  }

  async elimina(s: ScadenzaFiscale) {
    if (!await this.confirm.delete(this.i18n.t('scadenzeFiscali.msg.confermaElimina', { titolo: s.titolo }))) return;
    this.ds.deleteScadenzaFiscale(s.id!).subscribe({
      next: () => { this.carica(); this.snack.open(this.i18n.t('scadenzeFiscali.msg.eliminata'), '', { duration: 2000 }); },
      error: () => this.snack.open(this.i18n.t('scadenzeFiscali.msg.errore'), '', { duration: 2500 }),
    });
  }
}
