import { inject, Component, OnInit, Inject } from '@angular/core';
import { RIGHE_STYLES } from '../shared/righe-styles';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DataService } from '../../services/data.service';
import { Cliente, TipoPagamento, UnitaMisura } from '../../models';
import { docRigaTotale } from '../../utils/doc-calc';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';

// ── Styles shared by dialog rig table ──────────────────────────────────────
// ── Dialog ─────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-fattura-ricorrente-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatDialogModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatSlideToggleModule,
    MatIconModule, MatSnackBarModule, TPipe
  ],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon is-purple">
          <mat-icon>repeat</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ (data?.id ? 'fattureRicorrenti.dialog.modificaTitle' : 'fattureRicorrenti.dialog.nuovaTitle') | t }}</span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'fattureRicorrenti.dialog.modificaSub' : 'fattureRicorrenti.dialog.nuovaSub') | t }}</span>
        </div>
      </div>

      <div class="doc-form">

        <div class="form-section is-primary">
          <div class="form-section-header"><mat-icon>person</mat-icon><span>{{ 'fattureRicorrenti.dialog.clienteContenuto' | t }}</span></div>
          <div class="doc-field-grid has-2-extra" [formGroup]="form">
            <mat-form-field>
              <mat-label>{{ 'fattureRicorrenti.dialog.cliente' | t }}</mat-label>
              <mat-select formControlName="clienteId">
                @for (c of clienti; track c.id) {
                  <mat-option [value]="c.id">{{ c.ragioneSociale }}</mat-option>
                }
              </mat-select>
              @if (form.get('clienteId')?.invalid && submitted) {
                <mat-error>{{ 'fattureRicorrenti.dialog.selezionaCliente' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field class="grid-span-all">
              <mat-label>{{ 'fattureRicorrenti.dialog.descrizione' | t }}</mat-label>
              <input matInput formControlName="descrizione" [placeholder]="'fattureRicorrenti.dialog.descrizionePlaceholder' | t">
              @if (form.get('descrizione')?.invalid && submitted) {
                <mat-error>{{ 'fattureRicorrenti.dialog.campoObbligatorio' | t }}</mat-error>
              }
            </mat-form-field>
          </div>
        </div>

        <div class="form-section">
          <div class="form-section-header"><mat-icon>event_repeat</mat-icon><span>{{ 'fattureRicorrenti.dialog.pianificazione' | t }}</span></div>
          <div class="doc-field-grid has-2-extra" [formGroup]="form">
            <mat-form-field>
              <mat-label>{{ 'fattureRicorrenti.dialog.frequenza' | t }}</mat-label>
              <mat-select formControlName="frequenza">
                <mat-option value="MENSILE">{{ 'fattureRicorrenti.freq.mensile' | t }}</mat-option>
                <mat-option value="BIMESTRALE">{{ 'fattureRicorrenti.freq.bimestrale' | t }}</mat-option>
                <mat-option value="TRIMESTRALE">{{ 'fattureRicorrenti.freq.trimestrale' | t }}</mat-option>
                <mat-option value="SEMESTRALE">{{ 'fattureRicorrenti.freq.semestrale' | t }}</mat-option>
                <mat-option value="ANNUALE">{{ 'fattureRicorrenti.freq.annuale' | t }}</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fattureRicorrenti.dialog.giornoEmissione' | t }}</mat-label>
              <input matInput type="number" min="1" max="28" formControlName="giornoEmissione">
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fattureRicorrenti.dialog.primaProssimaEmissione' | t }}</mat-label>
              <input matInput type="date" formControlName="prossimaEmissione">
              @if (form.get('prossimaEmissione')?.invalid && submitted) {
                <mat-error>{{ 'fattureRicorrenti.dialog.dataObbligatoria' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fattureRicorrenti.dialog.tipoPagamento' | t }}</mat-label>
              <mat-select formControlName="tipoPagamentoId">
                <mat-option [value]="null">{{ 'fattureRicorrenti.dialog.nonSpecificato' | t }}</mat-option>
                @for (t of tipiPagamento; track t.id) {
                  <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <div class="ric-toggle grid-span-all">
              <mat-slide-toggle formControlName="attiva">{{ 'fattureRicorrenti.dialog.ricorrenzaAttiva' | t }}</mat-slide-toggle>
              <span class="ric-toggle-hint">{{ 'fattureRicorrenti.dialog.ricorrenzaHint' | t }}</span>
            </div>
          </div>
        </div>

        <div class="form-section">
          <div class="righe-header">
            <div class="righe-header-title">
              <span>{{ 'fattureRicorrenti.dialog.righe' | t }}</span>
              @if (submitted && !hasRighe) {
                <span class="righe-error"><mat-icon>error_outline</mat-icon> {{ 'fattureRicorrenti.dialog.aggiungiRigaErrore' | t }}</span>
              }
            </div>
            <div class="righe-actions">
              <button mat-flat-button color="primary" type="button" (click)="addRiga()">
                <mat-icon>add</mat-icon> {{ 'fattureRicorrenti.dialog.aggiungiRiga' | t }}
              </button>
            </div>
          </div>
          <div class="righe-scroll">
          <table class="righe-table">
            <thead>
              <tr>
                <th class="td-desc">{{ 'fattureRicorrenti.dialog.col.descrizione' | t }}</th>
                <th class="td-qta">{{ 'fattureRicorrenti.dialog.col.qta' | t }}</th>
                <th class="td-um">{{ 'fattureRicorrenti.dialog.col.um' | t }}</th>
                <th class="td-prezzo">{{ 'fattureRicorrenti.dialog.col.prezzo' | t }}</th>
                <th class="td-sconto">{{ 'fattureRicorrenti.dialog.col.sconto' | t }}</th>
                <th class="td-iva">{{ 'fattureRicorrenti.dialog.col.iva' | t }}</th>
                <th class="td-totale">{{ 'fattureRicorrenti.dialog.col.totale' | t }}</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody>
              @for (riga of righe; track $index) {
                <tr>
                  <td class="td-desc"><input class="riga-input" [(ngModel)]="riga.descrizione" [placeholder]="'fattureRicorrenti.dialog.col.descrizione' | t"></td>
                  <td class="td-qta" [attr.data-label]="'fattureRicorrenti.dialog.col.qta' | t"><input class="riga-input" type="number" min="0" step="0.01" [(ngModel)]="riga.quantita"></td>
                  <td class="td-um" [attr.data-label]="'fattureRicorrenti.dialog.col.um' | t">
                    <select class="riga-input" [(ngModel)]="riga.unitaMisura">
                      <option value="">—</option>
                      @for (u of unitaMisura; track u.id) {
                        <option [value]="u.simbolo">{{ u.simbolo }}</option>
                      }
                    </select>
                  </td>
                  <td class="td-prezzo" [attr.data-label]="'fattureRicorrenti.dialog.col.prezzo' | t"><input class="riga-input" type="number" min="0" [step]="prezzoFmt.step()" [(ngModel)]="riga.prezzo"></td>
                  <td class="td-sconto" [attr.data-label]="'fattureRicorrenti.dialog.col.sconto' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.sconto" placeholder="0"></td>
                  <td class="td-iva" [attr.data-label]="'fattureRicorrenti.dialog.col.iva' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.iva"></td>
                  <td class="td-totale" [attr.data-label]="'fattureRicorrenti.dialog.col.totale' | t">
                    {{ rigaTotale(riga) | currency:'EUR':'symbol':'1.2-2':'it' }}
                  </td>
                  <td class="td-actions">
                    <button mat-icon-button color="warn" type="button" (click)="removeRiga($index)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          </div>
        </div>

        <div class="doc-totals-strip">
          <div class="totals-item"><span class="totals-label">{{ 'fattureRicorrenti.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <div class="totals-item"><span class="totals-label">{{ 'fattureRicorrenti.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <span class="totals-spacer"></span>
          <div class="totals-grand"><span class="totals-label">{{ 'fattureRicorrenti.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
        </div>

        <div class="form-section is-flat" [formGroup]="form">
          <div class="form-section-header"><mat-icon>notes</mat-icon><span>{{ 'fattureRicorrenti.dialog.note' | t }}</span></div>
          <mat-form-field>
            <mat-label>{{ 'fattureRicorrenti.dialog.note' | t }}</mat-label>
            <textarea matInput rows="2" formControlName="note"></textarea>
          </mat-form-field>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: [RIGHE_STYLES + `
    .ric-toggle { display: flex; flex-direction: column; gap: var(--sp-1); }
    .ric-toggle-hint { font-size: 12px; color: var(--text-tertiary); }
  `]
})
export class FatturaRicorrenteDialogComponent implements OnInit {
  prezzoFmt = inject(PrezzoFormatService);
  form: FormGroup;
  clienti: Cliente[] = [];
  tipiPagamento: TipoPagamento[] = [];
  unitaMisura: UnitaMisura[] = [];
  righe: any[] = [];
  submitted = false;

  get hasRighe() { return this.righe.length > 0 && this.righe.some(r => r.descrizione?.trim()); }
  get imponibile() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0); }
  get ivaTotal() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0); }
  get totale() { return this.imponibile + this.ivaTotal; }
  rigaTotale(r: any) { return docRigaTotale(r, false); }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    public dialogRef: MatDialogRef<FatturaRicorrenteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.form = this.fb.group({
      clienteId: [data?.clienteId ?? null, Validators.required],
      descrizione: [data?.descrizione ?? '', Validators.required],
      frequenza: [data?.frequenza ?? 'MENSILE', Validators.required],
      giornoEmissione: [data?.giornoEmissione ?? 1],
      prossimaEmissione: [data?.prossimaEmissione ?? new Date().toISOString().substring(0, 10), Validators.required],
      tipoPagamentoId: [data?.tipoPagamentoId ?? null],
      attiva: [data?.attiva !== false],
      note: [data?.note ?? ''],
    });
    this.righe = data?.righe?.length
      ? data.righe.map((r: any) => ({ ...r }))
      : [{ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22 }];
  }

  ngOnInit() {
    this.ds.getClienti().subscribe(c => this.clienti = c);
    this.ds.getTipiPagamento().subscribe(t => this.tipiPagamento = t.filter((x: any) => x.attivo));
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
  }

  addRiga() { this.righe.push({ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22 }); }
  removeRiga(i: number) { this.righe.splice(i, 1); }

  save() {
    this.submitted = true;
    if (this.form.invalid || !this.hasRighe) return;
    this.dialogRef.close({ ...this.data, ...this.form.value, righe: this.righe });
  }
}

// ── List component ─────────────────────────────────────────────────────────
@Component({
  selector: 'app-fatture-ricorrenti',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatDialogModule, MatSnackBarModule, MatSelectModule,
    MatChipsModule, MatTooltipModule, MatSlideToggleModule, MatMenuModule
  , EmptyStateComponent, TPipe],
  templateUrl: './fatture-ricorrenti.html',
  styleUrl: './fatture-ricorrenti.scss'
})
export class FattureRicorrentiComponent implements OnInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  ricorrenti: any[] = [];
  filtroAttiva: 'all' | 'attiva' | 'non-attiva' = 'all';
  today = new Date().toISOString().substring(0, 10);

  get filtered() {
    if (this.filtroAttiva === 'attiva') return this.ricorrenti.filter(r => r.attiva);
    if (this.filtroAttiva === 'non-attiva') return this.ricorrenti.filter(r => !r.attiva);
    return this.ricorrenti;
  }

  displayedColumns = ['cliente', 'descrizione', 'frequenza', 'prossimaEmissione', 'attiva', 'azioni'];

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar) {}

  ngOnInit() { this.load(); }

  load() {
    this.ds.getFattureRicorrenti().subscribe({ next: d => this.ricorrenti = d, error: () => {} });
  }

  isScaduta(r: any) { return r.prossimaEmissione && r.prossimaEmissione < this.today; }

  frequenzaLabel(f: string): string {
    const map: Record<string, string> = {
      MENSILE: 'fattureRicorrenti.freq.mensile', BIMESTRALE: 'fattureRicorrenti.freq.bimestrale',
      TRIMESTRALE: 'fattureRicorrenti.freq.trimestrale', SEMESTRALE: 'fattureRicorrenti.freq.semestrale',
      ANNUALE: 'fattureRicorrenti.freq.annuale'
    };
    return map[f] ? this.i18n.t(map[f]) : f;
  }

  toggleAttiva(r: any) {
    this.ds.updateFatturaRicorrente({ ...r, attiva: !r.attiva }).subscribe({
      next: () => { r.attiva = !r.attiva; },
      error: e => this.snack.open(this.i18n.t('fattureRicorrenti.msg.errore', { err: e.error?.error || e.message }), '', { duration: 3000 })
    });
  }

  open(r?: any) {
    const ref = this.dialog.open(FatturaRicorrenteDialogComponent, {
      data: r ?? null, width: '90vw', maxWidth: '960px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateFatturaRicorrente(result) : this.ds.createFatturaRicorrente(result);
      op.subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('fattureRicorrenti.msg.salvato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
      });
    });
  }

  emetti(r: any) {
    this.ds.emettiFatturaRicorrente(r.id).subscribe({
      next: res => {
        this.load();
        this.snack.open(this.i18n.t('fattureRicorrenti.msg.fatturaEmessa', { numero: res.numero }), '', { duration: 3500 });
      },
      error: e => this.snack.open(this.i18n.t('fattureRicorrenti.msg.errore', { err: e.error?.error || e.message }), '', { duration: 4000 })
    });
  }

  async delete(r: any) {
    if (!await this.confirm.delete(this.i18n.t('fattureRicorrenti.msg.confermaElimina', { descrizione: r.descrizione }))) return;
    this.ds.deleteFatturaRicorrente(r.id).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('fattureRicorrenti.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
    });
  }
}
