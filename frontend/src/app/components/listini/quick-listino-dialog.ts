import { Component, OnInit, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin, of } from 'rxjs';
import { DataService } from '../../services/data.service';
import { Listino, Prodotto } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';

interface RigaSel {
  prodotto: Prodotto;
  sconto: number | null;   // % sconto sul prezzo base
  prezzo: number | null;   // prezzo override (ha precedenza sullo sconto)
}

@Component({
  selector: 'app-quick-listino-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule,
    MatCheckboxModule, MatTooltipModule, MatSnackBarModule, TPipe,
  ],
  template: `
    <mat-dialog-content class="ql-content">
      <div class="dialog-hero">
        <div class="dialog-hero-icon" style="background:linear-gradient(135deg,#0891b2 0%,#11769b 100%)">
          <mat-icon>price_change</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ 'listini.quick.title' | t }}</span>
          <span class="dialog-hero-sub">{{ 'listini.quick.subtitle' | t }}</span>
        </div>
      </div>

      <form [formGroup]="form" class="ql-form">
        <div class="form-row">
          <mat-form-field style="flex:2">
            <mat-label>{{ 'listini.quick.nomeListino' | t }}</mat-label>
            <input matInput formControlName="nome" [placeholder]="'listini.nuovoDialog.nomePh' | t">
          </mat-form-field>
          <mat-form-field style="flex:1;max-width:180px">
            <mat-label>{{ 'listini.quick.scontoDefault' | t }}</mat-label>
            <input matInput type="number" step="0.5" min="0" max="100" formControlName="scontoDefault">
            <mat-icon matSuffix>percent</mat-icon>
          </mat-form-field>
        </div>
      </form>

      <!-- ── Selezione prodotti ──────────────────────────────── -->
      <div class="form-section">
        <div class="form-section-header">
          <mat-icon>inventory_2</mat-icon>
          <span>{{ 'listini.quick.prodottiNelListino' | t }}</span>
          @if (selezionati.length) { <span class="ql-badge">{{ selezionati.length }}</span> }
        </div>

        <mat-form-field style="width:100%">
          <mat-label>{{ 'listini.quick.cercaProdotto' | t }}</mat-label>
          <input matInput [(ngModel)]="query" [ngModelOptions]="{ standalone: true }"
                 (ngModelChange)="filtra()" [placeholder]="'listini.quick.cercaProdottoPh' | t">
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>

        @if (query) {
          <div class="ql-picker">
            <div class="ql-picker-head">
              <button mat-button type="button" color="primary" (click)="aggiungiTuttiFiltrati()" [disabled]="!filtrati.length">
                <mat-icon>done_all</mat-icon> {{ i18n.t('listini.quick.aggiungiTuttiRisultati', { n: filtrati.length }) }}
              </button>
            </div>
            @for (p of filtrati; track p.id) {
              <div class="ql-picker-row" (click)="toggle(p)">
                <mat-checkbox [checked]="isSel(p)" (click)="$event.preventDefault()"></mat-checkbox>
                <span class="ql-pname">{{ p.nome }}</span>
                @if (p.codice) { <span class="ql-pcode">{{ p.codice }}</span> }
                <span class="ql-pprice">{{ p.prezzo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</span>
              </div>
            }
            @if (!filtrati.length) {
              <p class="ql-empty">{{ i18n.t('listini.quick.nessunProdottoPer', { q: query }) }}</p>
            }
          </div>
        }
      </div>

      <!-- ── Righe selezionate + prezzi ──────────────────────── -->
      @if (selezionati.length) {
        <div class="ql-bulk">
          <span class="ql-bulk-label">{{ 'listini.quick.applicaATuttiSelezionati' | t }}</span>
          <mat-form-field class="ql-bulk-field" subscriptSizing="dynamic">
            <mat-label>{{ 'listini.scontoPercentPh' | t }}</mat-label>
            <input matInput type="number" step="0.5" min="0" max="100" [(ngModel)]="scontoBulk" [ngModelOptions]="{ standalone: true }">
          </mat-form-field>
          <button mat-stroked-button type="button" color="primary" (click)="applicaScontoBulk()">
            <mat-icon>percent</mat-icon> {{ 'listini.quick.applicaSconto' | t }}
          </button>
          <span class="totals-spacer"></span>
          <button mat-button type="button" color="warn" (click)="selezionati = []">{{ 'listini.quick.svuota' | t }}</button>
        </div>

        <table class="ql-table">
          <thead>
            <tr>
              <th>{{ 'listini.quick.col.prodotto' | t }}</th>
              <th class="num">{{ 'listini.quick.col.prezzoBase' | t }}</th>
              <th class="num">{{ 'listini.quick.col.scontoPercent' | t }}</th>
              <th class="num">{{ 'listini.quick.col.prezzoManuale' | t }}</th>
              <th class="num">{{ 'listini.quick.col.prezzoFinale' | t }}</th>
              <th style="width:36px"></th>
            </tr>
          </thead>
          <tbody>
            @for (r of selezionati; track r.prodotto.id) {
              <tr>
                <td>
                  <div style="font-weight:600">{{ r.prodotto.nome }}</div>
                  @if (r.prodotto.codice) { <div class="ql-pcode">{{ r.prodotto.codice }}</div> }
                </td>
                <td class="num" style="color:var(--text-tertiary)">{{ r.prodotto.prezzo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</td>
                <td><input class="ql-input num" type="number" step="0.5" min="0" max="100"
                           [(ngModel)]="r.sconto" [ngModelOptions]="{ standalone: true }"
                           [disabled]="r.prezzo != null" placeholder="—"></td>
                <td><input class="ql-input num" type="number" [step]="prezzoFmt.step()" min="0"
                           [(ngModel)]="r.prezzo" [ngModelOptions]="{ standalone: true }" placeholder="—"></td>
                <td class="num"><b>{{ prezzoFinale(r) | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</b></td>
                <td><button mat-icon-button type="button" color="warn" (click)="rimuovi(r)" [matTooltip]="'listini.quick.rimuoviTooltip' | t">
                  <mat-icon style="font-size:18px">close</mat-icon></button></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="ql-hint">
          <mat-icon>info</mat-icon>
          <span>{{ 'listini.quick.hintA' | t }} <b>{{ 'listini.quick.hintScontoLabel' | t }}</b> {{ 'listini.quick.hintB' | t }} <b>{{ 'listini.quick.hintPrezzoManualeLabel' | t }}</b> {{ 'listini.quick.hintC' | t }}</span>
        </div>
      } @else {
        <div class="ql-empty-box">
          <mat-icon>shopping_cart</mat-icon>
          <p>{{ 'listini.quick.cercaVuoto' | t }}</p>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="crea()" [disabled]="form.invalid || saving">
        <mat-icon>check</mat-icon> {{ 'listini.quick.creaListino' | t }}
        @if (selezionati.length) { <span>&nbsp;({{ selezionati.length }})</span> }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .ql-content { min-width: 720px; max-width: 100%; }
    @media (max-width: 767px) { .ql-content { min-width: 0; } }
    .ql-form { padding-top: 8px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .ql-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; padding: 0 6px; margin-left: 8px;
      background: var(--primary); color: #fff; border-radius: 9px; font-size: 10px; font-weight: 700;
    }
    .ql-picker {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      max-height: 230px; overflow-y: auto; background: var(--bg-surface);
    }
    .ql-picker-head { padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); position: sticky; top: 0; background: var(--bg-surface); }
    .ql-picker-row {
      display: flex; align-items: center; gap: 10px; padding: 7px 10px; cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
    }
    .ql-picker-row:hover { background: var(--bg-surface-2); }
    .ql-pname { flex: 1; font-weight: 500; }
    .ql-pcode { font-family: monospace; font-size: 11px; color: var(--text-tertiary); }
    .ql-pprice { color: #059669; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ql-empty { text-align: center; color: var(--text-tertiary); padding: 16px; font-size: 13px; margin: 0; }
    .ql-empty-box { text-align: center; padding: 32px 16px; color: var(--text-tertiary);
      mat-icon { font-size: 38px; width: 38px; height: 38px; opacity: 0.5; margin-bottom: 6px; }
      p { margin: 0; font-size: 13px; } }
    .ql-bulk { display: flex; align-items: center; gap: 10px; margin: 14px 0 8px; flex-wrap: wrap; }
    .ql-bulk-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
    .ql-bulk-field { max-width: 120px; }
    .ql-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      th { background: var(--bg-surface-2); padding: 8px 10px; text-align: left;
           font-size: 11px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase;
           border-bottom: 1px solid var(--border); letter-spacing: 0.04em; }
      th.num, td.num { text-align: right; }
      td { padding: 6px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
    }
    .ql-input {
      border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px;
      font-size: 13px; width: 90px; box-sizing: border-box; background: var(--bg-surface);
      color: var(--text-primary); font-variant-numeric: tabular-nums;
    }
    .ql-input.num { text-align: right; }
    .ql-input:disabled { background: var(--bg-surface-2); color: var(--text-tertiary); }
    .ql-input:focus { outline: none; border-color: var(--primary); box-shadow: var(--shadow-focus); }
    .ql-hint {
      display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px;
      background: var(--info-soft); border: 1px solid rgba(14,165,233,0.20);
      border-radius: 8px; margin-top: 12px; font-size: 12px; color: var(--info-on);
      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    }
  `],
})
export class QuickListinoDialogComponent implements OnInit {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  form: FormGroup;
  prodotti: Prodotto[] = [];
  filtrati: Prodotto[] = [];
  selezionati: RigaSel[] = [];
  query = '';
  scontoBulk: number | null = null;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private snack: MatSnackBar,
    public dialogRef: MatDialogRef<QuickListinoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
  ) {
    this.form = this.fb.group({
      nome: ['', Validators.required],
      descrizione: [''],
      scontoDefault: [0, [Validators.min(0), Validators.max(100)]],
      attivo: [true],
    });
  }

  ngOnInit() {
    this.ds.getProdotti().subscribe(p => this.prodotti = p);
  }

  filtra() {
    const tokens = this.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) { this.filtrati = []; return; }
    const selIds = new Set(this.selezionati.map(r => r.prodotto.id));
    this.filtrati = this.prodotti
      .filter(p => !selIds.has(p.id))
      .filter(p => {
        const hay = `${p.codice ?? ''} ${p.nome ?? ''} ${p.categoria ?? ''}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
      })
      .slice(0, 100);
  }

  isSel(p: Prodotto): boolean {
    return this.selezionati.some(r => r.prodotto.id === p.id);
  }

  toggle(p: Prodotto) {
    const i = this.selezionati.findIndex(r => r.prodotto.id === p.id);
    if (i >= 0) this.selezionati.splice(i, 1);
    else this.selezionati.push({ prodotto: p, sconto: this.form.value.scontoDefault || null, prezzo: null });
    this.filtra();
  }

  aggiungiTuttiFiltrati() {
    const sconto = this.form.value.scontoDefault || null;
    for (const p of this.filtrati) this.selezionati.push({ prodotto: p, sconto, prezzo: null });
    this.filtra();
  }

  rimuovi(r: RigaSel) {
    this.selezionati = this.selezionati.filter(x => x !== r);
    this.filtra();
  }

  applicaScontoBulk() {
    const s = this.scontoBulk;
    if (s == null || isNaN(+s)) return;
    for (const r of this.selezionati) { r.sconto = +s; r.prezzo = null; }
  }

  prezzoFinale(r: RigaSel): number {
    if (r.prezzo != null) return +r.prezzo;
    const base = r.prodotto.prezzo || 0;
    const sconto = r.sconto != null ? +r.sconto : (this.form.value.scontoDefault || 0);
    return +(base * (1 - sconto / 100)).toFixed(this.prezzoFmt.decimali());
  }

  crea() {
    if (this.form.invalid || this.saving) return;
    this.saving = true;
    const payload: Listino = { ...this.form.value };
    this.ds.createListino(payload).subscribe({
      next: (r: any) => {
        const id = r?.id;
        if (!id || !this.selezionati.length) { this.dialogRef.close(id ?? true); return; }
        const ops = this.selezionati.map(row =>
          this.ds.upsertListinoPrezzo(id, {
            prodottoId: row.prodotto.id!,
            prezzo: row.prezzo != null ? +row.prezzo : null,
            sconto: row.prezzo == null && row.sconto != null ? +row.sconto : null,
          }));
        forkJoin(ops.length ? ops : [of(null)]).subscribe({
          next: () => { this.snack.open(this.i18n.t('listini.quick.msgListinoCreato', { n: this.selezionati.length }), '', { duration: 2500 }); this.dialogRef.close(id); },
          error: () => { this.saving = false; this.snack.open(this.i18n.t('listini.quick.msgListinoCreatoParziale'), 'OK', { duration: 4000 }); this.dialogRef.close(id); },
        });
      },
      error: (e) => { this.saving = false; this.snack.open(e.error?.error || this.i18n.t('listini.msg.erroreCreazione'), 'OK', { duration: 4000 }); },
    });
  }
}
