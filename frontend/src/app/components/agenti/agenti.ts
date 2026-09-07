import { Component, Inject, OnInit, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DataService } from '../../services/data.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { Agente } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

function basi(i18n: I18nService) {
  return [
    { v: 'IMPONIBILE', l: i18n.t('agenti.base.imponibile') },
    { v: 'INCASSATO',  l: i18n.t('agenti.base.incassato') },
    { v: 'MARGINE',    l: i18n.t('agenti.base.margine') },
  ];
}

// ── Dialog nuovo/modifica agente ────────────────────────────────────────────────
@Component({
  selector: 'app-agente-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (a.id ? 'agenti.dialog.modifica' : 'agenti.dialog.nuovo') | t }}</h2>
    <mat-dialog-content style="min-width:420px;max-width:100%">
      <mat-form-field style="width:100%"><mat-label>{{ 'agenti.dialog.nome' | t }}</mat-label>
        <input matInput [(ngModel)]="a.nome" autocomplete="off"></mat-form-field>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <mat-form-field style="flex:1;min-width:180px"><mat-label>{{ 'agenti.dialog.email' | t }}</mat-label>
          <input matInput [(ngModel)]="a.email" autocomplete="off"></mat-form-field>
        <mat-form-field style="flex:1;min-width:140px"><mat-label>{{ 'agenti.dialog.telefono' | t }}</mat-label>
          <input matInput [(ngModel)]="a.telefono" autocomplete="off"></mat-form-field>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <mat-form-field style="flex:1;min-width:200px"><mat-label>{{ 'agenti.dialog.baseProvvigione' | t }}</mat-label>
          <mat-select [(ngModel)]="a.baseProvvigione">
            @for (b of basi; track b.v) { <mat-option [value]="b.v">{{ b.l }}</mat-option> }
          </mat-select></mat-form-field>
        <mat-form-field style="width:150px"><mat-label>{{ 'agenti.dialog.percDefault' | t }}</mat-label>
          <input matInput type="number" min="0" max="100" step="0.5" [(ngModel)]="a.provvigioneDefault">
          <span matSuffix>%</span></mat-form-field>
      </div>
      <mat-slide-toggle [(ngModel)]="a.attivo" style="margin-top:6px">{{ 'agenti.dialog.attivo' | t }}</mat-slide-toggle>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()">{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="!a.nome?.trim()" (click)="salva()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>
  `,
})
export class AgenteDialogComponent {
  private i18n = inject(I18nService);
  readonly basi = basi(this.i18n);
  a: Agente;
  constructor(public ref: MatDialogRef<AgenteDialogComponent>, @Inject(MAT_DIALOG_DATA) data: Agente | null) {
    this.a = { baseProvvigione: 'IMPONIBILE', provvigioneDefault: 0, attivo: true, nome: '', ...(data || {}) };
  }
  salva() { if (this.a.nome?.trim()) this.ref.close(this.a); }
}

// ── Pagina Agenti ───────────────────────────────────────────────────────────────
@Component({
  selector: 'app-agenti',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTabsModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSnackBarModule, TPipe],
  template: `
    <div class="page">
      <div class="page-header"><h1 class="page-title">{{ 'agenti.title' | t }}</h1></div>

      <mat-tab-group animationDuration="0">
        <mat-tab [label]="'agenti.tab.agenti' | t">
          <div class="card" style="margin-top:16px">
            <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
              <button mat-flat-button color="primary" (click)="nuovo()"><mat-icon>person_add</mat-icon> {{ 'agenti.nuovoAgente' | t }}</button>
            </div>
            @if (agenti.length) {
              <table class="ag-table">
                <thead><tr><th>{{ 'agenti.col.nome' | t }}</th><th>{{ 'agenti.col.contatti' | t }}</th><th>{{ 'agenti.col.base' | t }}</th><th class="r">{{ 'agenti.col.percDefault' | t }}</th><th></th></tr></thead>
                <tbody>
                  @for (a of agenti; track a.id) {
                    <tr [class.ag-off]="!a.attivo">
                      <td><b>{{ a.nome }}</b>@if (!a.attivo) { <span class="ag-badge">{{ 'agenti.nonAttivo' | t }}</span> }</td>
                      <td class="ag-muted">{{ a.email }}@if (a.email && a.telefono) { · }{{ a.telefono }}</td>
                      <td>{{ baseLabel(a.baseProvvigione) }}</td>
                      <td class="r">{{ a.provvigioneDefault || 0 }}%</td>
                      <td class="r" style="white-space:nowrap">
                        <button mat-icon-button (click)="modifica(a)" [title]="'agenti.modifica' | t"><mat-icon>edit</mat-icon></button>
                        <button mat-icon-button (click)="elimina(a)" [title]="'agenti.elimina' | t"><mat-icon style="color:#ef4444">delete</mat-icon></button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <p class="ag-muted" style="padding:16px 0">{{ 'agenti.nessunAgente' | t }}</p>
            }
          </div>
        </mat-tab>

        <mat-tab [label]="'agenti.tab.provvigioni' | t">
          <div class="card" style="margin-top:16px">
            <div class="filter-bar">
              <mat-form-field appearance="outline"><mat-label>{{ 'agenti.dal' | t }}</mat-label>
                <input matInput type="date" [(ngModel)]="da"></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>{{ 'agenti.al' | t }}</mat-label>
                <input matInput type="date" [(ngModel)]="a"></mat-form-field>
              <button mat-flat-button color="primary" (click)="calcola()"><mat-icon>calculate</mat-icon> {{ 'agenti.calcola' | t }}</button>
            </div>
            @if (calcolato && !report.length) {
              <p class="ag-muted" style="padding:12px 0">{{ 'agenti.nessunaProvvigione' | t }}</p>
            }
            @for (r of report; track r.agenteId) {
              <div class="ag-rep">
                <div class="ag-rep-head">
                  <b>{{ r.agenteNome }}</b>
                  <span class="ag-muted">{{ 'agenti.baseLabel' | t }} {{ baseLabel(r.base) }} — {{ 'agenti.imponibileBase' | t }} {{ r.baseTotale | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
                  <b class="ag-tot">{{ r.provvigioneTotale | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
                </div>
                <table class="ag-table">
                  <thead><tr><th>{{ 'agenti.col.fattura' | t }}</th><th>{{ 'agenti.col.cliente' | t }}</th><th class="r">{{ 'agenti.col.base' | t }}</th><th class="r">{{ 'agenti.col.percent' | t }}</th><th class="r">{{ 'agenti.col.provvigione' | t }}</th></tr></thead>
                  <tbody>
                    @for (d of r.documenti; track d.fatturaId) {
                      <tr>
                        <td>{{ d.numero }} <span class="ag-muted">{{ d.data | date:'dd/MM/yy' }}</span>@if (!d.pagata) { <span class="ag-badge">{{ 'agenti.nonPagata' | t }}</span> }</td>
                        <td class="ag-muted">{{ d.clienteNome || '—' }}</td>
                        <td class="r">{{ d.base | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                        <td class="r">{{ d.perc }}%</td>
                        <td class="r"><b>{{ d.provvigione | currency:'EUR':'symbol':'1.2-2':'it' }}</b></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .ag-table { width:100%; border-collapse:collapse; font-size:13px; }
    .ag-table th { text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; padding:8px 10px; border-bottom:1px solid #e2e8f0; }
    .ag-table td { padding:8px 10px; border-bottom:1px solid #f1f5f9; }
    .ag-table .r, th.r { text-align:right; }
    .ag-muted { color:#94a3b8; font-size:12px; }
    .ag-off td { opacity:.55; }
    .ag-badge { font-size:10.5px; background:#fef2f2; color:#b91c1c; border-radius:99px; padding:1px 7px; margin-left:6px; }
    .ag-rep { margin-bottom:18px; }
    .ag-rep-head { display:flex; align-items:baseline; gap:12px; padding:8px 0; }
    .ag-rep-head .ag-tot { margin-left:auto; font-size:16px; color:#15803d; }
    .filter-bar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
  `]
})
export class AgentiComponent implements OnInit {
  private i18n = inject(I18nService);
  agenti: Agente[] = [];
  report: any[] = [];
  calcolato = false;
  da = `${new Date().getFullYear()}-01-01`;
  a = new Date().toISOString().slice(0, 10);

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, private confirm: ConfirmService) {}

  ngOnInit() { this.load(); }

  load() { this.ds.getAgenti().subscribe({ next: a => this.agenti = a, error: () => {} }); }

  baseLabel(b?: string) { return basi(this.i18n).find(x => x.v === (b || 'IMPONIBILE'))?.l || b; }

  nuovo() { this.apri(null); }
  modifica(a: Agente) { this.apri(a); }
  private apri(data: Agente | null) {
    this.dialog.open(AgenteDialogComponent, { data, autoFocus: false }).afterClosed().subscribe((res: Agente | undefined) => {
      if (!res) return;
      const obs: Observable<any> = res.id ? this.ds.aggiornaAgente(res.id, res) : this.ds.creaAgente(res);
      obs.subscribe({ next: () => { this.load(); this.snack.open(this.i18n.t('agenti.msg.agenteSalvato'), '', { duration: 2000 }); }, error: (e: any) => this.snack.open(e.error?.error || this.i18n.t('agenti.msg.errore'), '', { duration: 3000 }) });
    });
  }
  async elimina(a: Agente) {
    if (!await this.confirm.delete(this.i18n.t('agenti.msg.eliminaAgente', { nome: a.nome }))) return;
    this.ds.eliminaAgente(a.id!).subscribe({ next: () => { this.load(); this.snack.open(this.i18n.t('agenti.msg.agenteEliminato'), '', { duration: 2000 }); }, error: e => this.snack.open(e.error?.error || this.i18n.t('agenti.msg.errore'), '', { duration: 3000 }) });
  }

  calcola() {
    this.ds.getProvvigioni(this.da, this.a).subscribe({
      next: r => { this.report = r; this.calcolato = true; },
      error: () => { this.report = []; this.calcolato = true; this.snack.open(this.i18n.t('agenti.msg.calcoloNonRiuscito'), '', { duration: 2500 }); },
    });
  }
}
