import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DataService } from '../../services/data.service';
import { ApiService } from '../../services/api.service';
import { AcquistoRegistraDialogComponent } from '../acquisti/acquisto-registra-dialog';
import { markSdiSeen } from '../../utils/sdi-letture';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { isoOggi } from '../../utils/data-locale';

interface Ricevuta {
  id: number;
  numero: string;
  dataEmissione: string;
  fornitoreNome: string;
  stato: string;
  numRighe: number;
  totale: number;
  importoPagato: number;
  pagato: boolean;
  caricatoMagazzino: boolean;
}

@Component({
  selector: 'app-sdi-passive',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatMenuModule, MatTooltipModule, MatProgressBarModule,
    MatSnackBarModule, MatDialogModule, TPipe,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">{{ 'sdiPassive.title' | t }}</h1>
        <div class="header-actions">
          <button mat-flat-button type="button" (click)="scarica()" [disabled]="polling">
            <mat-icon>cloud_download</mat-icon> {{ 'sdiPassive.scaricaSdi' | t }}
          </button>
          <button mat-stroked-button type="button" (click)="xmlInput.click()">
            <mat-icon>upload_file</mat-icon> {{ 'sdiPassive.importaXml' | t }}
          </button>
          <input #xmlInput type="file" accept=".xml,text/xml,application/xml" hidden (change)="importaXml($event)">
        </div>
      </div>

      <!-- ── Scarica dallo SDI ────────────────────────────────────────────── -->
      <div class="card scarica-card">
        <div class="filter-bar">
          <mat-form-field appearance="outline" style="max-width:160px">
            <mat-label>{{ 'sdiPassive.provider' | t }}</mat-label>
            <mat-select [(ngModel)]="provider">
              <mat-option value="aruba">Aruba</mat-option>
              <mat-option value="fic">Fatture in Cloud</mat-option>
              <mat-option value="acube">Acubeapi</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'sdiPassive.dal' | t }}</mat-label>
            <input matInput type="date" [(ngModel)]="dataDa">
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>{{ 'sdiPassive.al' | t }}</mat-label>
            <input matInput type="date" [(ngModel)]="dataA">
          </mat-form-field>
        </div>
        @if (polling) { <mat-progress-bar mode="indeterminate"></mat-progress-bar> }
        @if (pollResult) {
          <div class="poll-result" [class.poll-error]="pollResult.error">
            @if (pollResult.error) {
              <mat-icon>error_outline</mat-icon>
              <div>
                <b>{{ pollResult.error }}</b>
                @if (pollResult.hint) { <div class="hint">{{ pollResult.hint }}</div> }
              </div>
            } @else {
              <mat-icon>check_circle</mat-icon>
              <span>{{ i18n.t('sdiPassive.trovateImportateSaltate', { trovate: pollResult.trovate, importate: pollResult.importate, saltate: pollResult.saltate }) }}@if (pollResult.errori?.length) { {{ i18n.t('sdiPassive.errori', { n: pollResult.errori.length }) }} }</span>
            }
          </div>
        }
        <p class="config-note">
          <mat-icon>info_outline</mat-icon>
          <span class="config-note__text">{{ 'sdiPassive.configNote.part1' | t }} <code>ARUBA_USER</code> / <code>ARUBA_PASS</code>{{ 'sdiPassive.configNote.part3' | t }} <b>{{ 'sdiPassive.configNote.boldPart' | t }}</b> {{ 'sdiPassive.configNote.part4' | t }}</span>
        </p>
      </div>

      <!-- ── Fatture passive ricevute ─────────────────────────────────────── -->
      <div class="card">
        <div class="card-title-row">
          <h3 style="margin:0">{{ i18n.t('sdiPassive.fattureRicevute', { n: ricevute.length }) }}</h3>
          <button mat-icon-button type="button" (click)="load()" [attr.aria-label]="'sdiPassive.aggiorna' | t" [matTooltip]="'sdiPassive.aggiorna' | t"><mat-icon>refresh</mat-icon></button>
        </div>

        @if (loading) {
          <p style="color:var(--text-tertiary)">{{ 'sdiPassive.caricamento' | t }}</p>
        } @else if (!ricevute.length) {
          <div class="empty">
            <mat-icon>inbox</mat-icon>
            <p>{{ 'sdiPassive.nessunaFatturaPassiva' | t }}<br>{{ 'sdiPassive.usaPrefix' | t }} <b>{{ 'sdiPassive.scaricaSdi' | t }}</b> {{ 'sdiPassive.oConnector' | t }} <b>{{ 'sdiPassive.importaXml' | t }}</b>.</p>
          </div>
        } @else {
          <div class="ric-list">
            @for (r of ricevute; track r.id) {
              <div class="ric-row">
                <div class="ric-main">
                  <div class="ric-num"><b>{{ r.numero }}</b> <span class="ric-date">{{ r.dataEmissione | date:'dd/MM/yyyy' }}</span></div>
                  <div class="ric-forn">{{ r.fornitoreNome }}</div>
                </div>
                <div class="ric-meta">
                  <span class="ric-righe">{{ i18n.t('sdiPassive.righe', { n: r.numRighe ?? '' }) }}</span>
                  <span class="ric-tot euro-neg">{{ r.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
                </div>
                <div class="ric-badges">
                  <span class="badge" [class.badge-on]="r.caricatoMagazzino">
                    <mat-icon>{{ r.caricatoMagazzino ? 'inventory_2' : 'inventory' }}</mat-icon>
                    {{ (r.caricatoMagazzino ? 'sdiPassive.aMagazzino' : 'sdiPassive.nonCaricata') | t }}
                  </span>
                  <span class="badge" [class.badge-on]="r.pagato">
                    <mat-icon>{{ r.pagato ? 'paid' : 'schedule' }}</mat-icon>
                    {{ (r.pagato ? 'sdiPassive.pagata' : 'sdiPassive.daPagare') | t }}
                  </span>
                </div>
                <div class="ric-actions">
                  <button mat-flat-button type="button" (click)="registra(r)"
                          [disabled]="r.pagato && r.caricatoMagazzino"
                          [matTooltip]="'sdiPassive.registraTooltip' | t">
                    <mat-icon>task_alt</mat-icon> {{ 'sdiPassive.registra' | t }}
                  </button>
                  <button mat-icon-button type="button" [matMenuTriggerFor]="m"
                          [attr.aria-label]="i18n.t('sdiPassive.azioniPerFattura', { numero: r.numero || r.id })" [title]="'sdiPassive.azioni' | t"><mat-icon>more_vert</mat-icon></button>
                  <mat-menu #m="matMenu">
                    <button mat-menu-item type="button" (click)="vaiAcquisto()"><mat-icon>open_in_new</mat-icon> {{ 'sdiPassive.apriInAcquisti' | t }}</button>
                  </mat-menu>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .scarica-card { margin-bottom: 16px; }
    .filter-bar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .filter-bar mat-form-field { flex: 1 1 160px; }
    .poll-result { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--success-soft); color: var(--success-on); font-size: 13px; margin-top: 4px; }
    .poll-result mat-icon { flex-shrink: 0; }
    .poll-result.poll-error { background: var(--danger-soft); color: var(--danger-on); align-items: flex-start; }
    .poll-result .hint { font-size: 12px; font-weight: 400; margin-top: 2px; opacity: 0.9; }
    .config-note { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-tertiary, #64748b); margin: 12px 0 0; line-height: 1.5; }
    .config-note mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .config-note__text { min-width: 0; flex: 1 1 auto; }
    .config-note code { background: var(--bg-surface-2, #f1f5f9); padding: 1px 5px; border-radius: 4px; font-size: 11px; overflow-wrap: anywhere; word-break: break-word; }
    .card-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .empty { text-align: center; padding: 32px 16px; color: var(--text-tertiary, #94a3b8); }
    .empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.5; }
    .ric-list { display: flex; flex-direction: column; gap: 8px; }
    .ric-row { display: grid; grid-template-columns: 2fr 1.2fr 1.6fr auto; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border-subtle, #eef0f4); border-radius: 10px; background: var(--bg-surface, #fff); }
    .ric-num { font-size: 14px; }
    .ric-date { color: var(--text-tertiary, #94a3b8); font-size: 12px; margin-left: 6px; }
    .ric-forn { color: var(--text-secondary, #475569); font-size: 13px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; }
    .ric-meta { display: flex; flex-direction: column; gap: 2px; }
    .ric-righe { font-size: 12px; color: var(--text-tertiary, #94a3b8); }
    .ric-tot { font-weight: 600; font-variant-numeric: tabular-nums; }
    .ric-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: var(--bg-surface-2, #f1f5f9); color: var(--text-tertiary, #64748b); }
    .badge mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .badge-on { background: var(--success-soft); color: var(--success-on); }
    .ric-actions { display: flex; align-items: center; gap: 4px; justify-self: end; }
    @media (max-width: 760px) {
      .ric-row { grid-template-columns: 1fr; gap: 8px; }
      .ric-actions { justify-self: stretch; }
      .ric-actions button[mat-flat-button] { flex: 1; }
    }
  `]
})
export class SdiPassiveComponent implements OnInit {
  i18n = inject(I18nService);
  provider = 'aruba';
  dataDa = `${new Date().getFullYear()}-01-01`;
  dataA = isoOggi();
  polling = false;
  pollResult: any = null;

  loading = true;
  ricevute: Ricevuta[] = [];

  constructor(
    private ds: DataService,
    private api: ApiService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private router: Router,
  ) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    this.ds.getSdiRicevute().subscribe({
      next: r => {
        this.ricevute = r || [];
        this.loading = false;
        // Visitando questa pagina le fatture passive correnti diventano "lette":
        // azzera la pillola "non lette" in dashboard finché non ne arrivano di nuove.
        markSdiSeen(this.ricevute.map(x => x.id));
      },
      error: () => { this.ricevute = []; this.loading = false; },
    });
  }

  scarica() {
    this.polling = true;
    this.pollResult = null;
    this.ds.sdiPoll(this.provider, this.dataDa, this.dataA).subscribe({
      next: r => {
        this.polling = false;
        this.pollResult = r;
        if (r?.importate > 0) this.load();
      },
      error: e => {
        this.polling = false;
        this.pollResult = { error: e.error?.error || this.i18n.t('sdiPassive.msg.erroreScarico'), hint: e.error?.hint };
      },
    });
  }

  importaXml(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';
    const reader = new FileReader();
    reader.onload = () => {
      this.ds.sdiImportXml(reader.result as string).subscribe({
        next: (r: any) => {
          this.snack.open(this.i18n.t('sdiPassive.msg.importataFattura', { numero: r.numero, righe: r.righe, ragSoc: r.ragSoc }), this.i18n.t('sdiPassive.msg.ok'), { duration: 4500, panelClass: 'snack-ok' });
          this.load();
        },
        error: e => this.snack.open(e.error?.error || this.i18n.t('sdiPassive.msg.xmlNonValido'), this.i18n.t('sdiPassive.msg.ok'), { duration: 4000, panelClass: 'snack-error' }),
      });
    };
    reader.readAsText(file, 'UTF-8');
  }

  registra(r: Ricevuta) {
    const ref = this.dialog.open(AcquistoRegistraDialogComponent, {
      data: { acquistoId: r.id, api: this.api, fornitoreNome: r.fornitoreNome },
      maxWidth: '92vw',
    });
    ref.afterClosed().subscribe(result => {
      if (!result?.registered) return;
      const parts: string[] = [];
      if (result.arrivo) parts.push(this.i18n.t('sdiPassive.msg.arrivoMerce', { numero: result.arrivo.numero }));
      if (result.pagamento) parts.push(this.i18n.t('sdiPassive.msg.pagamentoImporto', { importo: result.pagamento.importo.toFixed(2) }));
      this.snack.open(this.i18n.t('sdiPassive.msg.registrato', { parts: parts.join(' + ') || this.i18n.t('sdiPassive.msg.nessunaOperazione') }), this.i18n.t('sdiPassive.msg.ok'), { duration: 4500, panelClass: 'snack-ok' });
      this.load();
    });
  }

  vaiAcquisto() { this.router.navigate(['/acquisti']); }
}
