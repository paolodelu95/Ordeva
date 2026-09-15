import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

interface FatturaSdi {
  id: number;
  numero: string;
  dataEmissione: string;
  clienteNome: string;
  totale: number;
  stato: string;
  statoSdi: string;
  dataInvioSdi: string;
  idTrasmissioneSdi: string;
  /** Ultima notifica ricevuta: per una scartata è il motivo, ed è la cosa da leggere. */
  motivo?: string;
}

interface StatoMeta { key: string; label: string; cls: string; icon: string; }

// Stati notifica SDI (FatturaPA). Riproducono le ricevute dell'intermediario.
const STATI: StatoMeta[] = [
  { key: 'NON_INVIATA',        label: 'fattureElettroniche.stato.nonInviata',        cls: 'sdi-grey',  icon: 'drafts' },
  { key: 'INVIATA',            label: 'fattureElettroniche.stato.inviata',           cls: 'sdi-blue',  icon: 'send' },
  { key: 'CONSEGNATA',         label: 'fattureElettroniche.stato.consegnata',        cls: 'sdi-green', icon: 'mark_email_read' },
  { key: 'MANCATA_CONSEGNA',   label: 'fattureElettroniche.stato.mancataConsegna',   cls: 'sdi-amber', icon: 'unsubscribe' },
  { key: 'ACCETTATA',          label: 'fattureElettroniche.stato.accettata',         cls: 'sdi-green', icon: 'verified' },
  { key: 'RIFIUTATA',          label: 'fattureElettroniche.stato.rifiutata',         cls: 'sdi-red',   icon: 'cancel' },
  { key: 'SCARTATA',           label: 'fattureElettroniche.stato.scartata',          cls: 'sdi-red',   icon: 'report' },
  { key: 'DECORRENZA_TERMINI', label: 'fattureElettroniche.stato.decorrenzaTermini', cls: 'sdi-teal',  icon: 'schedule' },
  { key: 'NON_RECAPITABILE',   label: 'fattureElettroniche.stato.nonRecapitabile',   cls: 'sdi-amber', icon: 'error_outline' },
];

@Component({
  selector: 'app-fatture-elettroniche',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatTooltipModule, MatSnackBarModule, TPipe,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">{{ 'fattureElettroniche.title' | t }}</h1>
        <div class="header-actions">
          <button mat-flat-button type="button" (click)="notificaInput.click()">
            <mat-icon>rule_folder</mat-icon> {{ 'fattureElettroniche.importaNotifiche' | t }}
          </button>
          <button mat-icon-button type="button" (click)="load()" [attr.aria-label]="'fattureElettroniche.aggiorna' | t" [matTooltip]="'fattureElettroniche.aggiorna' | t"><mat-icon>refresh</mat-icon></button>
        </div>
        <input #notificaInput type="file" accept=".xml,text/xml,application/xml" multiple hidden (change)="importaNotifiche($event)">
      </div>

      @if (daSistemare.length) {
        <div class="allarme">
          <mat-icon>report</mat-icon>
          <div>
            <b>{{ i18n.t('fattureElettroniche.daSistemare', { n: daSistemare.length }) }}</b>
            <div class="allarme-sub">{{ 'fattureElettroniche.daSistemareSub' | t }}</div>
          </div>
          <button mat-stroked-button type="button" (click)="mostraSoloDaSistemare()">
            {{ 'fattureElettroniche.mostraQueste' | t }}
          </button>
        </div>
      }

      <!-- KPI per stato -->
      <div class="kpi-row">
        @for (s of statiConteggio; track s.key) {
          <button class="kpi-chip" [class.active]="filtroStato === s.key" [ngClass]="s.cls" (click)="toggleStato(s.key)">
            <mat-icon>{{ s.icon }}</mat-icon>
            <span class="kpi-n">{{ s.count }}</span>
            <span class="kpi-l">{{ s.label | t }}</span>
          </button>
        }
      </div>

      <div class="card">
        <div class="filter-bar">
          <mat-form-field appearance="outline" class="f-search">
            <mat-label>{{ 'fattureElettroniche.cercaPlaceholder' | t }}</mat-label>
            <input matInput [(ngModel)]="search" (ngModelChange)="applyFilters()">
            <mat-icon matSuffix>search</mat-icon>
          </mat-form-field>
          <mat-form-field appearance="outline" style="max-width:150px">
            <mat-label>{{ 'fattureElettroniche.anno' | t }}</mat-label>
            <mat-select [(ngModel)]="filtroAnno" (selectionChange)="applyFilters()">
              <mat-option [value]="null">{{ 'fattureElettroniche.tutti' | t }}</mat-option>
              @for (a of anni; track a) { <mat-option [value]="a">{{ a }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" style="max-width:200px">
            <mat-label>{{ 'fattureElettroniche.statoSdi' | t }}</mat-label>
            <mat-select [(ngModel)]="filtroStato" (selectionChange)="applyFilters()">
              <mat-option [value]="null">{{ 'fattureElettroniche.tuttiGliStati' | t }}</mat-option>
              @for (s of stati; track s.key) { <mat-option [value]="s.key">{{ s.label | t }}</mat-option> }
            </mat-select>
          </mat-form-field>
          @if (search || filtroAnno || filtroStato) {
            <button mat-icon-button type="button" [matTooltip]="'fattureElettroniche.rimuoviFiltri' | t" (click)="resetFiltri()"><mat-icon>clear</mat-icon></button>
          }
        </div>

        @if (loading) {
          <p style="color:var(--text-tertiary)">{{ 'fattureElettroniche.caricamento' | t }}</p>
        } @else if (!filtered.length) {
          <div class="empty"><mat-icon>receipt_long</mat-icon><p>{{ 'fattureElettroniche.nessunaFattura' | t }}</p></div>
        } @else {
          <div class="fe-list">
            <div class="fe-row fe-head">
              <span>{{ 'fattureElettroniche.col.numero' | t }}</span><span>{{ 'fattureElettroniche.col.cliente' | t }}</span><span class="r">{{ 'fattureElettroniche.col.importo' | t }}</span>
              <span>{{ 'fattureElettroniche.col.invioSdi' | t }}</span><span>{{ 'fattureElettroniche.col.stato' | t }}</span>
            </div>
            @for (f of filtered; track f.id) {
              <div class="fe-row">
                <div class="fe-num" [attr.data-label]="'fattureElettroniche.col.numero' | t">
                  <b>{{ f.numero }}</b><span class="fe-date">{{ f.dataEmissione | date:'dd/MM/yyyy' }}</span>
                </div>
                <div class="fe-cli" [attr.data-label]="'fattureElettroniche.col.cliente' | t">{{ f.clienteNome || '—' }}</div>
                <div class="fe-tot r" [attr.data-label]="'fattureElettroniche.col.importo' | t">{{ f.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</div>
                <div class="fe-invio" [attr.data-label]="'fattureElettroniche.col.invioSdi' | t">
                  @if (f.dataInvioSdi) {
                    {{ f.dataInvioSdi | date:'dd/MM/yyyy' }}
                    @if (f.idTrasmissioneSdi) { <span class="fe-id" [matTooltip]="i18n.t('fattureElettroniche.idTrasmissione', { id: f.idTrasmissioneSdi })">#{{ f.idTrasmissioneSdi }}</span> }
                  } @else { <span class="muted">—</span> }
                </div>
                <div class="fe-stato" [attr.data-label]="'fattureElettroniche.col.stato' | t">
                  <span class="sdi-badge" [ngClass]="metaOf(f.statoSdi).cls">
                    <mat-icon>{{ metaOf(f.statoSdi).icon }}</mat-icon>{{ metaOf(f.statoSdi).label | t }}
                  </span>
                  @if (f.motivo) { <div class="fe-motivo" [matTooltip]="f.motivo">{{ f.motivo }}</div> }
                </div>
              </div>
            }
          </div>
        }
      </div>

      <p class="foot-note">
        <mat-icon>info_outline</mat-icon>
        {{ 'fattureElettroniche.footNote' | t }}
      </p>
    </div>
  `,
  styles: [`
    .allarme {
      display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
      padding: 12px 16px; border-radius: var(--radius-md);
      background: rgba(220,38,38,.10); color: #b91c1c;
      border: 1px solid rgba(220,38,38,.28);
    }
    .allarme mat-icon { flex-shrink: 0; }
    .allarme > div { flex: 1; min-width: 0; }
    .allarme-sub { font-size: 12.5px; color: #7f1d1d; margin-top: 2px; line-height: 1.4; }
    .fe-motivo {
      font-size: 11.5px; color: #b91c1c; margin-top: 4px; line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .kpi-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .kpi-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--border-subtle, #e6e8ee); background: var(--bg-surface, #fff); cursor: pointer; font: inherit; transition: all .12s; }
    .kpi-chip:hover { border-color: var(--border, #cbd5e1); }
    .kpi-chip.active { box-shadow: 0 0 0 2px currentColor inset; }
    .kpi-chip mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .kpi-n { font-weight: 800; font-size: 16px; }
    .kpi-l { font-size: 12px; color: var(--text-secondary, #475569); }
    .filter-bar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .f-search { flex: 1 1 auto; min-width: 220px; }
    .empty { text-align: center; padding: 32px 16px; color: var(--text-tertiary, #94a3b8); }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .fe-list { display: flex; flex-direction: column; }
    .fe-row { display: grid; grid-template-columns: 1.4fr 1.6fr 1fr 1.3fr 1.2fr; gap: 12px; align-items: center; padding: 12px 8px; border-bottom: 1px solid var(--border-subtle, #eef0f4); }
    .fe-head { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-tertiary, #94a3b8); padding: 6px 8px; }
    .fe-head .r, .fe-tot.r { text-align: right; }
    .fe-num b { font-size: 14px; } .fe-date { display: block; font-size: 12px; color: var(--text-tertiary, #94a3b8); }
    .fe-cli { font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
    .fe-tot { font-weight: 600; font-variant-numeric: tabular-nums; }
    .fe-invio { font-size: 13px; } .fe-id { display: block; font-size: 11px; color: var(--text-tertiary, #94a3b8); }
    .muted { color: var(--text-tertiary, #94a3b8); }
    .sdi-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
    .sdi-badge mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .fe-act { justify-self: end; }
    .sdi-grey  { background: rgba(100,116,139,.14); color: #475569; } .sdi-grey-fg  { color: #475569; }
    .sdi-blue  { background: rgba(59,130,246,.14);  color: #1d4ed8; } .sdi-blue-fg  { color: #1d4ed8; }
    .sdi-green { background: rgba(22,163,74,.14);   color: #15803d; } .sdi-green-fg { color: #15803d; }
    .sdi-amber { background: rgba(217,119,6,.16);   color: #b45309; } .sdi-amber-fg { color: #b45309; }
    .sdi-red   { background: rgba(220,38,38,.14);   color: #b91c1c; } .sdi-red-fg   { color: #b91c1c; }
    .sdi-teal  { background: rgba(13,148,136,.14);  color: #0f766e; } .sdi-teal-fg  { color: #0f766e; }
    .foot-note { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-tertiary, #64748b); margin-top: 16px; line-height: 1.5; }
    .foot-note mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    @media (max-width: 768px) {
      .fe-head { display: none; }
      .fe-row { grid-template-columns: 1fr; gap: 6px; padding: 12px 14px; border: 1px solid var(--border-subtle, #eef0f4); border-radius: 10px; margin-bottom: 10px; }
      .fe-row > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .fe-row > div::before { content: attr(data-label); font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-tertiary, #94a3b8); }
      .fe-num::before, .fe-act::before { content: none; }
      .fe-tot.r { text-align: right; }
      .fe-act { justify-self: stretch; } .fe-act button { width: 100%; }
      .fe-date { display: inline; margin-left: 8px; }
    }
  `]
})
export class FattureElettronicheComponent implements OnInit {
  i18n = inject(I18nService);
  readonly stati = STATI;
  loading = true;
  all: FatturaSdi[] = [];
  filtered: FatturaSdi[] = [];

  search = '';
  filtroAnno: number | null = null;
  filtroStato: string | null = null;
  anni: number[] = [];

  /** Documenti scartati o rifiutati: sono fatture che risultano NON emesse. */
  daSistemare: FatturaSdi[] = [];

  constructor(
    private ds: DataService,
    private snack: MatSnackBar,
    private router: Router,
    private http: HttpClient,
  ) {}

  /**
   * Importa i file di notifica che lo SdI restituisce dopo l'invio (ricevuta di
   * consegna, scarto, mancata consegna…). Arrivano dall'intermediario o via PEC;
   * qui si leggono in locale, senza account né API, e aggiornano lo stato del
   * documento a cui si riferiscono.
   */
  async importaNotifiche(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;

    let aggiornate = 0;
    const orfane: string[] = [];
    const errori: string[] = [];
    for (const file of files) {
      try {
        const xml = await file.text();
        const r: any = await firstValueFrom(
          this.http.post(`${environment.apiUrl}/sdi-esiti/importa`, { xml, nomeFile: file.name }),
        );
        if (r?.collegata) aggiornate++;
        else orfane.push(file.name);
      } catch (e: any) {
        errori.push(`${file.name}: ${e?.error?.error || e?.message || ''}`);
      }
    }

    // Le notifiche non abbinate vanno dette: lo stato del documento non è
    // cambiato, e credere il contrario è peggio che non averle importate.
    const parti: string[] = [this.i18n.t('fattureElettroniche.notificheLette', { n: aggiornate })];
    if (orfane.length) parti.push(this.i18n.t('fattureElettroniche.notificheOrfane', { n: orfane.length }));
    if (errori.length) parti.push(this.i18n.t('fattureElettroniche.notificheErrore', { n: errori.length }));
    this.snack.open(parti.join(' · '), '', { duration: orfane.length || errori.length ? 8000 : 4000 });
    this.load();
  }

  mostraSoloDaSistemare() {
    this.search = '';
    this.filtroAnno = null;
    this.filtroStato = null;
    this.filtered = [...this.daSistemare];
  }

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.ds.getFatture().subscribe({
      next: (r: any[]) => {
        this.all = (r || []).map(f => ({
          id: f.id, numero: f.numero, dataEmissione: f.dataEmissione,
          clienteNome: f.clienteNome, totale: f.totale, stato: f.stato,
          statoSdi: f.statoSdi || '', dataInvioSdi: f.dataInvioSdi || '',
          idTrasmissioneSdi: f.idTrasmissioneSdi || '',
        }));
        const years = new Set<number>();
        for (const f of this.all) { const y = +(f.dataEmissione || '').slice(0, 4); if (y) years.add(y); }
        this.anni = [...years].sort((a, b) => b - a);
        this.applyFilters();
        this.loading = false;
        this.caricaEsiti();
      },
      error: () => { this.all = []; this.filtered = []; this.loading = false; },
    });
  }

  /** Motivi delle notifiche e elenco di ciò che va sistemato. */
  private caricaEsiti() {
    this.http.get<any>(`${environment.apiUrl}/sdi-esiti`).subscribe({
      next: (r) => {
        const perId = new Map<number, string>();
        for (const d of r?.documenti ?? []) {
          if (d.documentoTipo === 'FATTURA' && d.ultimaNotifica?.descrizione) {
            perId.set(d.id, d.ultimaNotifica.descrizione);
          }
        }
        for (const f of this.all) f.motivo = perId.get(f.id) || '';
        this.daSistemare = this.all.filter((f) =>
          ['SCARTATA', 'RIFIUTATA', 'MANCATA_CONSEGNA'].includes((f.statoSdi || '').toUpperCase()),
        );
      },
      error: () => { this.daSistemare = []; },
    });
  }

  metaOf(statoSdi: string): StatoMeta {
    const key = (statoSdi || '').toUpperCase() || 'NON_INVIATA';
    return STATI.find(s => s.key === key) || STATI[0];
  }

  get statiConteggio() {
    return STATI.map(s => ({
      ...s,
      count: this.all.filter(f => this.metaOf(f.statoSdi).key === s.key).length,
    }));
  }

  toggleStato(key: string) {
    this.filtroStato = this.filtroStato === key ? null : key;
    this.applyFilters();
  }

  applyFilters() {
    const q = this.search.trim().toLowerCase();
    this.filtered = this.all.filter(f => {
      if (this.filtroStato && this.metaOf(f.statoSdi).key !== this.filtroStato) return false;
      if (this.filtroAnno && +(f.dataEmissione || '').slice(0, 4) !== this.filtroAnno) return false;
      if (q && !(`${f.numero} ${f.clienteNome || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  resetFiltri() { this.search = ''; this.filtroAnno = null; this.filtroStato = null; this.applyFilters(); }
}
