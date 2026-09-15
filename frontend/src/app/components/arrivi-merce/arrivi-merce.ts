import { inject, Component, OnInit, AfterViewInit, Inject, ViewChild, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { ConfirmService } from '../shared/confirm-dialog';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { DataService } from '../../services/data.service';
import { ArrivoMerce, Acquisto, Fornitore, Prodotto, RigaArrivoMerce, UnitaMisura, Magazzino } from '../../models';
import { findProdottoByCodice } from '../../utils/prodotto-match';
import { ProdottoPickerComponent, ProdottoPick } from '../shared/prodotto-picker';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { selezionabili } from '../../utils/anagrafiche';
import { righeDaSalvare } from '../../utils/righe-documento';

// ── Dialog selezione fattura acquisto ────────────────────────────────────────
@Component({
  selector: 'app-seleziona-acquisto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatFormFieldModule, MatInputModule, MatTableModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'arriviMerce.selAcquisto.title' | t }}</h2>
    <mat-dialog-content style="min-width:520px;max-width:700px;padding-top:8px">
      <mat-form-field style="width:100%" subscriptSizing="dynamic">
        <mat-label>{{ 'arriviMerce.selAcquisto.cerca' | t }}</mat-label>
        <input matInput [(ngModel)]="filtro" [placeholder]="'arriviMerce.selAcquisto.cercaPlaceholder' | t">
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <div style="margin-top:12px;max-height:420px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f8fafc;position:sticky;top:0;z-index:1">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0">{{ 'arriviMerce.selAcquisto.col.numero' | t }}</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0">{{ 'arriviMerce.selAcquisto.col.data' | t }}</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0">{{ 'arriviMerce.selAcquisto.col.fornitore' | t }}</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:#64748b;border-bottom:2px solid #e2e8f0">{{ 'arriviMerce.selAcquisto.col.importo' | t }}</th>
              <th style="padding:8px 4px;border-bottom:2px solid #e2e8f0"></th>
            </tr>
          </thead>
          <tbody>
            @for (a of righeVisibili; track a.id) {
              <tr style="cursor:pointer;transition:background .15s"
                  (mouseenter)="hovered=a.id??null" (mouseleave)="hovered=null"
                  [style.background]="hovered===a.id ? '#f1f5f9' : 'white'"
                  (click)="select(a)">
                <td style="padding:10px 12px;font-weight:600;color:#0e6480">{{ a.numero }}</td>
                <td style="padding:10px 12px;color:#64748b">{{ a.dataEmissione | date:'dd/MM/yyyy' }}</td>
                <td style="padding:10px 12px">{{ a.fornitoreNome || '—' }}</td>
                <td style="padding:10px 12px;text-align:right;font-weight:600">
                  {{ a.totale | currency:'EUR':'symbol':'1.2-2':'it' }}
                </td>
                <td style="padding:10px 4px;text-align:center">
                  <mat-icon style="color:#0e6480;font-size:18px">chevron_right</mat-icon>
                </td>
              </tr>
            }
            @if (!righeVisibili.length) {
              <tr>
                <td colspan="5" style="padding:24px;text-align:center;color:#94a3b8">
                  {{ 'arriviMerce.selAcquisto.nessunaFattura' | t }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
    </mat-dialog-actions>`,
})
export class SelezionaAcquistoDialogComponent {
  filtro = '';
  hovered: number | null = null;

  constructor(
    public dialogRef: MatDialogRef<SelezionaAcquistoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public acquisti: Acquisto[]
  ) {}

  get righeVisibili(): Acquisto[] {
    if (!this.filtro.trim()) return this.acquisti;
    const q = this.filtro.toLowerCase();
    return this.acquisti.filter(a =>
      (a.numero ?? '').toLowerCase().includes(q) ||
      (a.fornitoreNome ?? '').toLowerCase().includes(q)
    );
  }

  select(a: Acquisto) { this.dialogRef.close(a); }
}

const STYLES = `
  .righe-section { margin-top: 16px; }
  .righe-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .righe-table { width: 100%; border-collapse: collapse; }
  .righe-table th { background: #f8fafc; padding: 8px; font-size: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
  .righe-table td { padding: 4px 2px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  .riga-input { border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 8px; font-size: 13px; width: 100%; box-sizing: border-box; }
  .riga-input.num { width: 80px; }
  .riga-input.cod { width: 110px; }
  .td-search { width: 36px; padding: 0 !important; }
  .badge-ricevuto { background:#dcfce7;color:#166534;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:600; }
  .badge-attesa  { background:#fef9c3;color:#854d0e;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:600; }
  .badge-annullato { background:#fee2e2;color:#991b1b;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:600; }
  .warn-row { color: #9ca3af; font-style: italic; }
  .totale-riga { text-align: right; padding: 10px 16px; font-weight: 700; background: #f8fafc; border-top: 2px solid #e2e8f0; }
`;

// ── Dialog creazione rapida prodotto ─────────────────────────────────────────
@Component({
  selector: 'app-quick-prodotto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'arriviMerce.quickProdotto.title' | t }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form" style="display:flex;flex-direction:column;gap:12px;min-width:340px;padding-top:8px">
        <mat-form-field>
          <mat-label>{{ 'arriviMerce.quickProdotto.codiceInterno' | t }}</mat-label>
          <input matInput formControlName="codice" required>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'prodotti.form.descrizione' | t }}</mat-label>
          <input matInput formControlName="descrizione">
        </mat-form-field>
        <div style="display:flex;gap:12px">
          <mat-form-field style="flex:1">
            <mat-label>{{ 'arriviMerce.quickProdotto.categoria' | t }}</mat-label>
            <input matInput formControlName="categoria">
          </mat-form-field>
          <mat-form-field style="width:110px">
            <mat-label>{{ 'arriviMerce.quickProdotto.um' | t }}</mat-label>
            <mat-select formControlName="unitaMisura">
              <mat-option value="pz">pz</mat-option>
              <mat-option value="kg">kg</mat-option>
              <mat-option value="lt">lt</mat-option>
              <mat-option value="mt">mt</mat-option>
              <mat-option value="h">h</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field>
          <mat-label>{{ 'arriviMerce.quickProdotto.codiceFornitore' | t }}</mat-label>
          <input matInput formControlName="codiceFornitore">
        </mat-form-field>
        <div style="display:flex;gap:12px">
          <mat-form-field style="flex:1">
            <mat-label>{{ 'arriviMerce.quickProdotto.prezzoVendita' | t }}</mat-label>
            <input matInput type="number" step="0.01" formControlName="prezzo">
          </mat-form-field>
          <mat-form-field style="width:100px">
            <mat-label>{{ 'arriviMerce.quickProdotto.ivaPercent' | t }}</mat-label>
            <input matInput type="number" formControlName="iva">
          </mat-form-field>
        </div>
        <mat-form-field>
          <mat-label>{{ 'arriviMerce.quickProdotto.sogliaMinima' | t }}</mat-label>
          <input matInput type="number" formControlName="sogliaMinima">
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.invalid">{{ 'arriviMerce.quickProdotto.creaProdotto' | t }}</button>
    </mat-dialog-actions>`,
})
export class QuickProdottoDialogComponent {
  form: FormGroup;
  constructor(
    fb: FormBuilder,
    public dialogRef: MatDialogRef<QuickProdottoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { codiceFornitore?: string; descrizione?: string }
  ) {
    this.form = fb.group({
      // Il codice identifica il prodotto: propongo quello del fornitore, che è
      // l'unico riferimento che la riga d'arrivo porta con sé.
      codice: [data?.codiceFornitore || data?.descrizione || '', Validators.required],
      descrizione: [data?.descrizione ?? ''],
      categoria: [''],
      unitaMisura: ['pz'],
      codiceFornitore: [data?.codiceFornitore ?? ''],
      prezzo: [0],
      iva: [22],
      sogliaMinima: [0],
    });
  }
  save() {
    if (!this.form.valid) return;
    this.dialogRef.close(this.form.value);
  }
}

// ── Dialog arrivo merce ──────────────────────────────────────────────────────
@Component({
  selector: 'app-arrivo-merce-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule,
            MatAutocompleteModule, MatIconModule, MatTooltipModule, MatChipsModule, TPipe],
  template: `
    <h2 mat-dialog-title>
      {{ (data?.id ? 'arriviMerce.dialog.modificaTitle' : 'arriviMerce.dialog.nuovoTitle') | t }}
      @if (data?.acquistoId) {
        <span style="font-size:13px;color:#64748b;margin-left:8px">
          {{ i18n.t('arriviMerce.dialog.importatoDa', { numero: data?.numeroDocumentoFornitore ?? '' }) }}
        </span>
      }
    </h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <div class="form-row">
          <mat-form-field>
            <mat-label>{{ 'arriviMerce.dialog.numeroArrivo' | t }}</mat-label>
            <input matInput formControlName="numero">
          </mat-form-field>
          <mat-form-field>
            <mat-label>{{ 'arriviMerce.dialog.data' | t }}</mat-label>
            <input matInput type="date" formControlName="data">
          </mat-form-field>
        </div>
        <div class="form-row">
          <mat-form-field style="flex:1">
            <mat-label>{{ 'arriviMerce.dialog.fornitore' | t }}</mat-label>
            <input matInput [matAutocomplete]="autoForn" [formControl]="fornitoreCtrl"
                   (keyup.enter)="autoSelectFornitore()" [placeholder]="'arriviMerce.dialog.cercaFornitore' | t">
            <mat-icon matSuffix>search</mat-icon>
            <mat-autocomplete #autoForn="matAutocomplete" [displayWith]="displayFornitore">
              @for (f of filteredFornitori; track f.id) {
                <mat-option [value]="f">{{ f.ragioneSociale }}</mat-option>
              }
            </mat-autocomplete>
          </mat-form-field>
          <mat-form-field style="flex:1">
            <mat-label>{{ 'arriviMerce.dialog.numeroDocFornitore' | t }}</mat-label>
            <input matInput formControlName="numeroDocumentoFornitore" [placeholder]="'arriviMerce.dialog.numeroDocFornitorePlaceholder' | t">
          </mat-form-field>
          <mat-form-field style="flex:1">
            <mat-label>{{ 'arriviMerce.dialog.depositoDestinazione' | t }}</mat-label>
            <mat-select formControlName="magazzinoId">
              @for (m of magazzini; track m.id) {
                <mat-option [value]="m.id">{{ m.nome }}@if (m.predefinito) { · {{ 'arriviMerce.dialog.predefinito' | t }} }</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </form>

      <!-- Righe -->
      <div class="righe-section">
        <div class="righe-header">
          <b>{{ 'arriviMerce.dialog.prodottiRicevuti' | t }}</b>
          <button mat-stroked-button type="button" (click)="addRiga()">
            <mat-icon>add</mat-icon> {{ 'arriviMerce.dialog.aggiungiRiga' | t }}
          </button>
        </div>
        <table class="righe-table">
          <thead>
            <tr>
              <th>{{ 'arriviMerce.dialog.col.prodotto' | t }}</th>
              <th class="td-search"></th>
              <th>{{ 'arriviMerce.dialog.col.codFornitore' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.qta' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.um' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.lotto' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.scadenza' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.prezzoAcquisto' | t }}</th>
              <th>{{ 'arriviMerce.dialog.col.totale' | t }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (riga of righe; track $index) {
              <tr [class.warn-row]="!riga.prodottoId">
                <td>
                  <input class="riga-input" #rigaCodice [(ngModel)]="riga.descrizione"
                         [placeholder]="'arriviMerce.dialog.codiceNomePlaceholder' | t"
                         [title]="riga.prodottoId ? i18n.t('arriviMerce.dialog.idLabel', { id: riga.prodottoId }) : ('arriviMerce.dialog.prodottoNonCollegato' | t)"
                         (keydown.enter)="risolviCodiceRiga($index, $event)" (keydown.f2)="searchProdotto($index)"
                         (keydown.arrowdown)="focusSiblingCodice($event, 1)" (keydown.arrowup)="focusSiblingCodice($event, -1)" (keydown.backspace)="onCodiceBackspace($index, $event)">
                </td>
                <td class="td-search">
                  <button mat-icon-button type="button" (click)="searchProdotto($index)" [title]="'arriviMerce.dialog.cercaProdotto' | t">
                    <mat-icon>search</mat-icon>
                  </button>
                </td>
                <td>
                  <input class="riga-input cod" [(ngModel)]="riga.codiceFornitore" placeholder="—">
                </td>
                <td>
                  <input class="riga-input num" type="number" min="0" step="1" [(ngModel)]="riga.quantita">
                </td>
                <td>
                  <select class="riga-input num" [(ngModel)]="riga.unitaMisura">
                    <option value="">—</option>
                    @for (u of unitaMisura; track u.id) {
                      <option [value]="u.simbolo">{{ u.simbolo }}</option>
                    }
                  </select>
                </td>
                <td>
                  <input class="riga-input cod" [(ngModel)]="riga.lotto" placeholder="—">
                </td>
                <td>
                  <input class="riga-input num" type="date" [(ngModel)]="riga.scadenza">
                </td>
                <td>
                  <input class="riga-input num" type="number" min="0" step="0.01" [(ngModel)]="riga.prezzoAcquisto">
                </td>
                <td style="padding:4px 8px; white-space:nowrap; font-weight:600">
                  {{ (riga.quantita * (riga.prezzoAcquisto || 0)) | currency:'EUR':'symbol':'1.2-2':'it' }}
                </td>
                <td style="display:flex;align-items:center;gap:2px;padding:4px 0">
                  @if (!riga.prodottoId) {
                    <button mat-icon-button type="button" color="accent"
                            [title]="'arriviMerce.dialog.creaProdottoRapido' | t"
                            (click)="quickCreateProdotto($index)">
                      <mat-icon>add_circle_outline</mat-icon>
                    </button>
                  }
                  <button mat-icon-button color="warn" type="button" (click)="removeRiga($index)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
        <div class="totale-riga">
          {{ i18n.t('arriviMerce.dialog.valoreTotale', { importo: (totale | currency:'EUR':'symbol':'1.2-2':'it') ?? '' }) }}
        </div>
      </div>

      <div [formGroup]="form" style="margin-top:16px">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'arriviMerce.dialog.note' | t }}</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="save('ATTESA')" [disabled]="form.invalid">
        {{ 'arriviMerce.dialog.salvaAttesa' | t }}
      </button>
      <button mat-flat-button (click)="save('RICEVUTO')" [disabled]="form.invalid">
        <mat-icon>inventory</mat-icon> {{ 'arriviMerce.confermaRicezione' | t }}
      </button>
    </mat-dialog-actions>`,
  styles: [STYLES]
})
export class ArrivoMerceDialogComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  form: FormGroup;
  fornitori: Fornitore[] = [];
  filteredFornitori: Fornitore[] = [];
  fornitoreCtrl = new FormControl<Fornitore | string | null>('');
  righe: RigaArrivoMerce[] = [];
  unitaMisura: UnitaMisura[] = [];
  prodotti: Prodotto[] = [];
  magazzini: Magazzino[] = [];

  get totale() {
    return this.righe.reduce((s, r) => s + r.quantita * (r.prezzoAcquisto || 0), 0);
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    public dialogRef: MatDialogRef<ArrivoMerceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Partial<ArrivoMerce> | null
  ) {
    this.form = this.fb.group({
      numero: [data?.numero ?? '', Validators.required],
      data: [data?.data ?? new Date().toISOString().substring(0, 10), Validators.required],
      numeroDocumentoFornitore: [data?.numeroDocumentoFornitore ?? ''],
      note: [data?.note ?? ''],
      magazzinoId: [data?.magazzinoId ?? null],
    });

    if (data?.id) {
      this.ds.getArrivoMerceById(data.id).subscribe(a => {
        this.righe = a.righe ?? [];
      });
    } else if (data?.righe?.length) {
      this.righe = data.righe.map(r => ({ ...r }));
    } else {
      this.righe = [{ descrizione: '', quantita: 1, unitaMisura: 'pz', prezzoAcquisto: 0 }];
    }
  }

  ngOnInit() {
    this.fornitoreCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredFornitori = this.fornitori.filter(f => f.ragioneSociale.toLowerCase().includes(q));
    });
    this.ds.getFornitori().subscribe(all => {
      const f = selezionabili(all, this.data?.fornitoreId);
      this.fornitori = f;
      this.filteredFornitori = f;
      if (this.data?.fornitoreId) {
        const found = f.find(x => x.id === this.data!.fornitoreId);
        if (found) this.fornitoreCtrl.setValue(found, { emitEvent: false });
      }
    });
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getProdotti().subscribe(p => this.prodotti = p);
    this.ds.getMagazzini().subscribe(m => {
      this.magazzini = m;
      if (this.form.value.magazzinoId == null) {
        this.form.patchValue({ magazzinoId: m.find(x => x.predefinito)?.id ?? m[0]?.id ?? null });
      }
    });

    if (!this.data?.id) {
      this.ds.getNextNumero('arrivi-merce').subscribe(n => this.form.patchValue({ numero: String(n.numero) }));
    }
  }

  displayFornitore(f: Fornitore | string | null): string {
    return f && typeof f !== 'string' ? (f as Fornitore).ragioneSociale : '';
  }

  autoSelectFornitore() {
    if (this.filteredFornitori.length > 0) this.fornitoreCtrl.setValue(this.filteredFornitori[0]);
  }

  @ViewChildren('rigaCodice') private codiceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  ngAfterViewInit() {
    setTimeout(() => this.codiceInputs?.first?.nativeElement.focus(), 0);
  }

  searchProdotto(index: number, lista?: Prodotto[]) {
    const query = (this.righe[index]?.descrizione ?? '').toString().trim();
    this.matDialog.open(ProdottoPickerComponent, { width: '720px', maxWidth: '96vw', data: { prodotti: lista ?? this.prodotti, query } })
      .afterClosed().subscribe((pick: ProdottoPick) => {
        if (!pick) return;
        this.applyProdottoToRiga(index, pick.prodotto, pick.variante);
      });
  }

  /** Riempie la riga arrivo coi dati del prodotto (selettore o inserimento via codice). */
  private applyProdottoToRiga(index: number, p: Prodotto, v?: ProdottoPick['variante']) {
    const varSuffix = v ? ` (${[v.taglia, v.colore].filter(Boolean).join(' / ')})` : '';
    this.righe[index].descrizione = (p.codice || p.descrizione || '') + varSuffix;
    this.righe[index].prodottoId = p.id ?? null;
    this.righe[index].prodottoCodice = p.codice;
    this.righe[index].codiceFornitore = p.codiceFornitore ?? '';
    this.righe[index].unitaMisura = p.unitaMisura ?? 'pz';
    this.righe[index].prezzoAcquisto = 0;
    this.righe[index].varianteId = v?.id ?? null;
    this.righe[index].varianteTaglia = v?.taglia ?? '';
    this.righe[index].varianteColore = v?.colore ?? '';
  }

  /** Inserimento rapido da tastiera: codice/descrizione (anche parziale) + Invio. */
  risolviCodiceRiga(index: number, event: Event) {
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    const q = (this.righe[index]?.descrizione ?? '').toString().trim();
    if (!q) { this.searchProdotto(index); return; }
    const { exact, matches } = findProdottoByCodice(this.prodotti, q);
    if (exact) { this.applyProdottoToRiga(index, exact); this.focusNextCodice(input); }
    else if (matches.length === 1) { this.applyProdottoToRiga(index, matches[0]); this.focusNextCodice(input); }
    else if (matches.length > 1) { this.searchProdotto(index, matches); }
    // nessun match: lascio il testo digitato (collegabile col selettore o quick-create)
  }

  /** Backspace su campo vuoto = elimina la riga corrente e torna alla precedente. */
  onCodiceBackspace(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.value !== '' || this.righe.length <= 1) return;
    event.preventDefault();
    this.removeRiga(index);
    setTimeout(() => {
      const arr = this.codiceInputs?.toArray() ?? [];
      arr[Math.max(0, index - 1)]?.nativeElement.focus();
    }, 0);
  }

  /** ↑/↓ tra i codici delle righe (gli input single-line non usano le frecce verticali). */
  focusSiblingCodice(event: Event, delta: number) {
    event.preventDefault();
    const inputs = this.codiceInputs?.toArray() ?? [];
    const i = inputs.findIndex(r => r.nativeElement === (event.target as HTMLInputElement));
    const target = inputs[i + delta];
    if (target) { target.nativeElement.focus(); target.nativeElement.select(); }
  }

  private focusNextCodice(current: HTMLInputElement) {
    const inputs = this.codiceInputs?.toArray() ?? [];
    const i = inputs.findIndex(r => r.nativeElement === current);
    const next = i >= 0 ? inputs[i + 1] : undefined;
    if (next) { setTimeout(() => { next.nativeElement.focus(); next.nativeElement.select(); }, 0); }
    else {
      this.addRiga();
      setTimeout(() => {
        const arr = this.codiceInputs.toArray();
        const el = arr[arr.length - 1]?.nativeElement;
        if (el) { el.focus(); el.select(); }
      }, 0);
    }
  }

  quickCreateProdotto(index: number) {
    const riga = this.righe[index];
    const ref = this.matDialog.open(QuickProdottoDialogComponent, {
      width: '460px',
      data: { codiceFornitore: riga.codiceFornitore ?? '', descrizione: riga.descrizione ?? '' }
    });
    ref.afterClosed().subscribe(newProd => {
      if (!newProd) return;
      this.ds.createProdotto({ ...newProd, quantita: 0 }).subscribe((res: { id: number }) => {
        this.righe[index].prodottoId = res.id;
        this.righe[index].prodottoCodice = newProd.codice;
        this.righe[index].descrizione = newProd.codice || newProd.descrizione || '';
        this.righe[index].codiceFornitore = newProd.codiceFornitore || '';
        this.righe[index].unitaMisura = newProd.unitaMisura || 'pz';
        this.ds.getProdotti().subscribe(p => this.prodotti = p);
      });
    });
  }

  addRiga() {
    this.righe.push({ descrizione: '', quantita: 1, unitaMisura: 'pz', prezzoAcquisto: 0 });
  }

  removeRiga(i: number) { this.righe.splice(i, 1); }

  save(stato: string) {
    if (!this.form.valid) return;
    const v = this.fornitoreCtrl.value;
    const fornitoreId = v && typeof v !== 'string' ? (v as Fornitore).id ?? null : null;
    this.dialogRef.close({
      ...this.data,
      ...this.form.value,
      fornitoreId,
      stato,
      righe: righeDaSalvare(this.righe),
    });
  }
}

// ── Componente lista arrivi merce ─────────────────────────────────────────────
@Component({
  selector: 'app-arrivi-merce',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatSortModule,
            MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule, MatPaginatorModule,
            MatMenuModule, TPipe],
  templateUrl: './arrivi-merce.html',
})
export class ArriviMerceComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allArrivi: ArrivoMerce[] = [];
  dataSource = new MatTableDataSource<ArrivoMerce>([]);
  displayedColumns = ['numero', 'data', 'fornitoreNome', 'numeroDocumentoFornitore', 'totale', 'stato', 'azioni'];

  filtroAnno: number | null = null;
  filtroFornitore: number | null = null;

  get anni() { return [...new Set(this.allArrivi.map(a => +a.data.substring(0, 4)))].sort().reverse(); }
  get fornitoriList() {
    const map = new Map<number, string>();
    this.allArrivi.forEach(a => { if (a.fornitoreId) map.set(a.fornitoreId, a.fornitoreNome ?? ''); });
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }

  acquisti: { id: number; numero: string; fornitoreNome: string }[] = [];

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar) {}

  ngOnInit() {
    this.load();
    this.ds.getAcquisti().subscribe(a => {
      this.acquisti = a.map(x => ({ id: x.id!, numero: x.numero, fornitoreNome: x.fornitoreNome ?? '' }));
    });
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sortingDataAccessor = (item, col) => {
      switch (col) {
        case 'numero': {
          const n = item.numero || '';
          const slash = n.match(/^(\d+)\/(\d+)$/);
          if (slash) return parseInt(slash[1], 10) * 100000 + parseInt(slash[2], 10);
          const plain = n.match(/(\d+)/);
          return plain ? parseInt(plain[1], 10) : 0;
        }
        case 'totale': return item.totale ?? 0;
        case 'data': return item.data ?? '';
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) => {
      const s = filter.toLowerCase();
      return (item.numero ?? '').toLowerCase().includes(s)
          || (item.fornitoreNome ?? '').toLowerCase().includes(s)
          || (item.numeroDocumentoFornitore ?? '').toLowerCase().includes(s);
    };
  }

  load() {
    this.ds.getArriviMerce().subscribe(a => {
      this.allArrivi = a;
      this.applyFilters();
    });
  }

  applyFilters() {
    let data = this.allArrivi;
    if (this.filtroAnno) data = data.filter(a => +a.data.substring(0, 4) === this.filtroAnno);
    if (this.filtroFornitore) data = data.filter(a => a.fornitoreId === this.filtroFornitore);
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
  }

  resetFiltri() {
    this.filtroAnno = null; this.filtroFornitore = null;
    this.dataSource.filter = ''; this.applyFilters();
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim();
  }

  open(a?: ArrivoMerce) {
    const ref = this.dialog.open(ArrivoMerceDialogComponent, {
      data: a ?? null, width: '90vw', maxWidth: '1100px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateArrivoMerce(result) : this.ds.createArrivoMerce(result);
      op.subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('arriviMerce.msg.salvato'), '', { duration: 2000 }); },
        error: (e: any) => this.snack.open(e.error?.error || e.message, this.i18n.t('arriviMerce.msg.ok'), { duration: 4000, panelClass: 'snack-error' })
      });
    });
  }

  importaDaAcquisto() {
    if (!this.acquisti.length) {
      this.snack.open(this.i18n.t('arriviMerce.msg.nessunaFatturaDisponibile'), '', { duration: 3000 });
      return;
    }
    const selRef = this.dialog.open(SelezionaAcquistoDialogComponent, {
      data: this.acquisti, width: '90vw', maxWidth: '740px', maxHeight: '90vh'
    });
    selRef.afterClosed().subscribe((acquisto: Acquisto | undefined) => {
      if (!acquisto) return;
      this.ds.importArrivoMerceFromAcquisto(acquisto.id!).subscribe({
        next: (precompiled) => {
          const ref = this.dialog.open(ArrivoMerceDialogComponent, {
            data: { ...precompiled, id: undefined },
            width: '90vw', maxWidth: '1100px', maxHeight: '95vh'
          });
          ref.afterClosed().subscribe(result => {
            if (!result) return;
            this.ds.createArrivoMerce(result).subscribe({
              next: () => { this.load(); this.snack.open(this.i18n.t('arriviMerce.msg.arrivoCreato'), '', { duration: 2000 }); },
              error: (e: any) => this.snack.open(e.message, '', { duration: 3000 })
            });
          });
        },
        error: (e: any) => this.snack.open(e.message, '', { duration: 3000 })
      });
    });
  }

  async delete(a: ArrivoMerce) {
    if (!await this.confirm.delete(this.i18n.t('arriviMerce.msg.confermaElimina', { numero: a.numero }))) return;
    this.ds.deleteArrivoMerce(a.id!).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('arriviMerce.msg.eliminato'), '', { duration: 2000 }); },
      error: (e: any) => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  setStato(a: ArrivoMerce, stato: string) {
    this.ds.setArrivoMerceStato(a.id!, stato).subscribe({
      next: () => this.load(),
      error: (e: any) => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  badgeClass(stato: string) {
    if (stato === 'RICEVUTO') return 'badge-ricevuto';
    if (stato === 'ANNULLATO') return 'badge-annullato';
    return 'badge-attesa';
  }

  statoLabel(stato: string): string {
    const map: Record<string, string> = {
      ATTESA: 'arriviMerce.stato.attesa', RICEVUTO: 'arriviMerce.stato.ricevuto', ANNULLATO: 'arriviMerce.stato.annullato',
      APERTO: 'arriviMerce.stato.aperto', CONFERMATO: 'arriviMerce.stato.confermato',
    };
    return map[stato] ? this.i18n.t(map[stato]) : stato;
  }
}
