import { inject, Component, OnInit, OnDestroy, AfterViewInit, Inject, ViewChild, ViewChildren, QueryList, ElementRef, HostListener, DestroyRef } from '@angular/core';
import { DraftService } from '../../services/draft.service';
import { RIGHE_STYLES } from '../shared/righe-styles';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
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
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { NotaCredito, Cliente, Fattura, Prodotto, RigaDocumento, UnitaMisura, NotaRapida } from '../../models';
import { findProdottoByCodice } from '../../utils/prodotto-match';
import { scrollFocusLastRiga } from '../../utils/scroll';
import { numeroUnivocoValidator, setNumeriEsistenti } from '../../utils/numero-univoco';
import { docRigaTotale, prezzoNettoDaInput } from '../../utils/doc-calc';
import { ProdottoPickerComponent, ProdottoPick } from '../shared/prodotto-picker';
import { DocInfoDialogComponent, DocInfoData } from '../shared/doc-info-dialog';
import { EmailDialogComponent } from '../shared/email-dialog';
import { CopiaRigheDialogComponent, CopiaRigheDialogData } from '../shared/copia-righe-dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DocLockService } from '../../services/doc-lock.service';
import { ViewStateService } from '../../services/view-state.service';
import { environment } from '../../../environments/environment';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { DocumentDirtyService } from '../../services/document-dirty.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';
import { selezionabili } from '../../utils/anagrafiche';
import { righeDaSalvare } from '../../utils/righe-documento';
import { gestitoAScorta } from '../../utils/scorta';

@Component({
  selector: 'app-nc-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule,
            MatAutocompleteModule, MatIconModule, MatButtonToggleModule, MatMenuModule, MatTooltipModule, DragDropModule, TPipe, TnPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon is-danger">
          <mat-icon>note_alt</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">
            {{ data?.id ? i18n.t('noteCredito.dialog.titoloEsistente', { numero: data?.numero || '' }) : ('noteCredito.nuovo' | t) }}
            @if (data?.id && locked) {
              <span class="dialog-lock-chip"><mat-icon>lock</mat-icon>{{ 'fatture.dialog.bloccato' | t }}</span>
            }
          </span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'noteCredito.dialog.subEsistente' : 'noteCredito.dialog.subNuovo') | t }}</span>
        </div>
        @if (data?.id) {
          <button mat-icon-button type="button"
                  class="dialog-lock-btn"
                  [class.is-locked]="locked"
                  [class.is-unlocked]="!locked"
                  [matTooltip]="(locked ? 'fatture.dialog.tooltipBloccato' : 'fatture.dialog.tooltipSbloccato') | t"
                  (click)="toggleLock()">
            <mat-icon>{{ locked ? 'lock' : 'lock_open' }}</mat-icon>
          </button>
        }
      </div>

      <div [class.doc-locked-content]="locked" (click)="onLockedClick($event)">

      <div class="doc-form">

        <div class="form-section is-primary">
          <div class="form-section-header"><mat-icon>person</mat-icon><span>{{ 'fatture.dialog.intestazione' | t }}</span></div>
          <div class="doc-field-grid has-2-extra" [formGroup]="form">
            <mat-form-field>
              <mat-label>{{ 'ordini.dialog.cliente' | t }}</mat-label>
              <input matInput [matAutocomplete]="autoCliente" [formControl]="clienteCtrl"
                     (keyup.enter)="autoSelectCliente()" [placeholder]="'preventivi.dialog.cercaClientePh' | t">
              <mat-icon matSuffix>search</mat-icon>
              <mat-autocomplete #autoCliente="matAutocomplete" [displayWith]="displayCliente">
                @for (c of filteredClienti; track c.id) {
                  <mat-option [value]="c">{{ c.ragioneSociale }}</mat-option>
                }
              </mat-autocomplete>
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'noteCredito.dialog.fatturaDaStornare' | t }}</mat-label>
              <mat-select formControlName="fatturaId">
                <mat-option [value]="null">{{ 'fatture.dialog.nessuna' | t }}</mat-option>
                @for (f of fattureDisponibili; track f.id) {
                  <mat-option [value]="f.id" [title]="f.stornato ? tooltipResiduo(f) : ''">
                    <span class="opt-fattura">
                      {{ f.numero }} — {{ f.dataEmissione | date:'dd/MM/yyyy' }}
                      @if (f.stornato) {
                        <span class="opt-residuo">{{ i18n.t('noteCredito.dialog.restaDaStornare', { importo: (residuoDaStornare(f) | currency:'EUR':'symbol':'1.2-2':'it') ?? '' }) }}</span>
                      }
                    </span>
                  </mat-option>
                }
              </mat-select>
              <mat-icon matSuffix>receipt</mat-icon>
              @if (!selectedClienteId) {
                <mat-hint>{{ 'noteCredito.dialog.selezionaClientePrima' | t }}</mat-hint>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fatture.dialog.numero' | t }}</mat-label>
              <input matInput formControlName="numero">
              @if (form.get('numero')?.hasError('numeroDuplicato')) {
                <mat-error>{{ 'fatture.dialog.numeroEsistente' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fatture.dialog.dataEmissione' | t }}</mat-label>
              <input matInput type="date" formControlName="dataEmissione">
            </mat-form-field>
          </div>
        </div>

        <div class="form-section">
          <div class="righe-header">
            <div class="righe-header-title">
              <span>{{ 'fatture.dialog.righe' | t }}</span>
            </div>
            <div class="righe-actions">
              <mat-button-toggle-group [(ngModel)]="showNetto" [hideSingleSelectionIndicator]="true">
                <mat-button-toggle [value]="false">{{ 'fatture.dialog.ivato' | t }}</mat-button-toggle>
                <mat-button-toggle [value]="true">{{ 'fatture.dialog.netto' | t }}</mat-button-toggle>
              </mat-button-toggle-group>
              <button mat-flat-button color="primary" type="button" (click)="addRiga()">
                <mat-icon>add</mat-icon> {{ 'fatture.dialog.aggiungiRiga' | t }}
              </button>
              <button mat-stroked-button type="button" (click)="apriCopiaRighe()">
                <mat-icon>content_copy</mat-icon> {{ 'fatture.dialog.copiaDa' | t }}
              </button>
              <button mat-stroked-button type="button" [matMenuTriggerFor]="menuNota">
                <mat-icon>note_add</mat-icon> {{ 'preventivi.dialog.aggiungiNota' | t }}
              </button>
              <mat-menu #menuNota="matMenu">
                <button mat-menu-item type="button" (click)="addNota('')">
                  <mat-icon>edit_note</mat-icon> {{ 'fatture.dialog.notaLibera' | t }}
                </button>
                @if (noteRapideList.length) {
                  <div class="menu-section-label">{{ 'fatture.dialog.noteRapide' | t }}</div>
                  @for (nr of noteRapideList; track nr.id) {
                    <button mat-menu-item type="button" (click)="addNota(nr.testo)">{{ nr.testo }}</button>
                  }
                }
              </mat-menu>
            </div>
          </div>

          @if (form.get('fatturaId')?.value) {
            <div class="doc-banner is-success grid-span-all">
              <mat-icon>auto_fix_high</mat-icon>
              <span>{{ 'noteCredito.dialog.bannerRigheImportate' | t }}</span>
            </div>
          }

          <div class="righe-scroll">
          <table class="righe-table">
            <thead>
              <tr>
                <th class="td-drag"></th>
                <th class="td-desc">{{ 'fatture.dialog.colCodiceDescrizione' | t }}</th>
                <th class="td-search"></th>
                <th class="td-history"></th>
                <th class="td-qta">{{ 'fatture.dialog.colQta' | t }}</th>
                <th class="td-um">{{ 'fatture.dialog.colUm' | t }}</th>
                <th class="td-prezzo">{{ (showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t }}</th>
                <th class="td-sconto">{{ 'fatture.dialog.colSconto' | t }}</th>
                <th class="td-iva">{{ 'preventivi.dialog.colIva' | t }}</th>
                <th class="td-totale">{{ (showNetto ? 'fatture.dialog.colTotaleNetto' : 'fatture.dialog.colTotaleIvato') | t }}</th>
                <th class="td-scarico" [title]="'noteCredito.dialog.rientroTooltip' | t">{{ 'noteCredito.dialog.colRientro' | t }}</th>
                <th class="td-actions"></th>
              </tr>
            </thead>
            <tbody cdkDropList (cdkDropListDropped)="dropRiga($event)">
              @for (riga of righe; track $index) {
                @if (riga.tipo === 'NOTA') {
                  <tr class="riga-nota" cdkDrag cdkDragPreviewContainer="parent">
                    <td class="td-drag" cdkDragHandle><mat-icon>drag_indicator</mat-icon></td>
                    <td class="td-nota" colspan="10">
                      <input class="riga-input" [(ngModel)]="riga.descrizione" [placeholder]="'fatture.dialog.notaPlaceholder' | t">
                    </td>
                    <td class="td-actions">
                      <button mat-icon-button color="warn" type="button" (click)="removeRiga($index)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </td>
                  </tr>
                } @else {
                <tr cdkDrag cdkDragPreviewContainer="parent">
                  <td class="td-drag" cdkDragHandle><mat-icon>drag_indicator</mat-icon></td>
                  <td class="td-desc">
                    <div class="codice-desc-stack">
                      <input class="riga-input riga-codice" #rigaCodice [(ngModel)]="riga.codiceProdotto" [placeholder]="'fatture.dialog.codicePh' | t" (keydown.enter)="risolviCodiceRiga($index, $event)" (keydown.f2)="searchProdotto($index)" (keydown.arrowdown)="focusSiblingCodice($event, 1)" (keydown.arrowup)="focusSiblingCodice($event, -1)" (keydown.backspace)="onCodiceBackspace($index, $event)">
                      <input class="riga-input riga-input--desc" [(ngModel)]="riga.descrizione" [placeholder]="'fatture.dialog.descrizionePh' | t">
                    </div>
                  </td>
                  <td class="td-search">
                    <button mat-icon-button type="button" (click)="searchProdotto($index)" [title]="'fatture.dialog.cercaProdotto' | t">
                      <mat-icon>search</mat-icon>
                    </button>
                  </td>
                  <td class="td-history">
                    @if (prezziRecenti[$index]?.length) {
                      <button mat-icon-button type="button" [matMenuTriggerFor]="menuPR" [matMenuTriggerData]="{idx: $index}" [title]="'fatture.dialog.prezziRecentiClienteTooltip' | t">
                        <mat-icon class="icon-primary">history</mat-icon>
                      </button>
                    }
                    @if (riga.prodottoId) {
                      <button mat-icon-button type="button" [matMenuTriggerFor]="menuPRTutti" [matMenuTriggerData]="{idx: $index}" (click)="loadTuttiPrezzi($index, riga.prodottoId)" [title]="'fatture.dialog.prezziTuttiClientiTooltip' | t">
                        <mat-icon class="icon-muted">groups</mat-icon>
                      </button>
                    }
                  </td>
                  <td class="td-qta" [attr.data-label]="'fatture.dialog.colQta' | t"><input class="riga-input" type="number" min="0"
                    [step]="riga.unitaMisura === 'pz' ? 1 : 0.01"
                    [(ngModel)]="riga.quantita" (change)="roundIfPz(riga)"></td>
                  <td class="td-um" [attr.data-label]="'fatture.dialog.colUm' | t">
                    <select class="riga-input" [(ngModel)]="riga.unitaMisura">
                      <option value="">—</option>
                      @for (u of unitaMisura; track u.id) {
                        <option [value]="u.simbolo">{{ u.simbolo }}</option>
                      }
                    </select>
                  </td>
                  <td class="td-prezzo" [attr.data-label]="(showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t"><input class="riga-input" type="number" min="0" step="0.01"
                    [value]="showNetto ? riga.prezzo : +(riga.prezzo * (1 + riga.iva/100)).toFixed(2)"
                    (change)="setPrezzoFromInput(riga, $event)"></td>
                  <td class="td-sconto" [attr.data-label]="'fatture.dialog.colSconto' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.sconto"></td>
                  <td class="td-iva" [attr.data-label]="'preventivi.dialog.colIva' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.iva"></td>
                  <td class="td-totale" [attr.data-label]="'fatture.dialog.totale' | t">
                    {{ rigaTotale(riga) | currency:'EUR':'symbol':'1.2-2':'it' }}
                  </td>
                  <td class="td-scarico" [attr.data-label]="'noteCredito.dialog.colRientro' | t">
                    @if (riga.prodottoId) {
                      <input type="checkbox" class="riga-check" [(ngModel)]="riga.scaricaMagazzino"
                             [title]="'noteCredito.dialog.rientroTooltip' | t">
                    } @else {
                      <span style="color:var(--text-tertiary)">—</span>
                    }
                  </td>
                  <td class="td-actions">
                    <button mat-icon-button color="warn" type="button" (click)="removeRiga($index)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </td>
                </tr>
                }
              }
            </tbody>
          </table>
          </div>
          <mat-menu #menuPR="matMenu">
            <ng-template matMenuContent let-idx="idx">
              <div class="menu-section-label">{{ 'fatture.dialog.prezziRecenti' | t }}</div>
              @for (pr of prezziRecenti[idx]; track $index) {
                <button mat-menu-item type="button" (click)="usaPrezzo(idx, pr.prezzo, pr.sconto)">
                  <span class="pr-meta">{{ pr.tipo }} {{ pr.numero }} · {{ pr.dataEmissione | date:'dd/MM/yy' }}</span>
                  <b class="pr-value">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
                  @if (pr.sconto) { <span class="pr-discount">(-{{ pr.sconto }}%)</span> }
                </button>
              }
            </ng-template>
          </mat-menu>
          <mat-menu #menuPRTutti="matMenu">
            <ng-template matMenuContent let-idx="idx">
              <div class="menu-section-label">{{ 'fatture.dialog.tuttiClienti' | t }}</div>
              @if (!tuttiCaricati[idx]) {
                <div class="menu-empty">{{ 'fatture.dialog.clicPerCaricare' | t }}</div>
              }
              @if (tuttiCaricati[idx] && !prezziRecentiTutti[idx]?.length) {
                <div class="menu-empty">{{ 'fatture.dialog.nessunPrezzoTrovato' | t }}</div>
              }
              @for (pr of prezziRecentiTutti[idx] ?? []; track $index) {
                <button mat-menu-item type="button" (click)="usaPrezzo(idx, pr.prezzo, pr.sconto)">
                  <div>
                    <span class="pr-meta" style="display:block">{{ pr.clienteNome ?? '' }} · {{ pr.tipo }} {{ pr.numero }} — {{ pr.dataEmissione | date:'dd/MM/yy' }}</span>
                    <b class="pr-value" style="margin-left:0">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
                    @if (pr.sconto) { <span class="pr-discount">(-{{ pr.sconto }}%)</span> }
                  </div>
                </button>
              }
            </ng-template>
          </mat-menu>
        </div>

        <div class="doc-totals-strip">
          <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <span class="totals-spacer"></span>
          <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
        </div>

        <div class="form-section is-flat" [formGroup]="form">
          <div class="form-section-header"><mat-icon>notes</mat-icon><span>{{ 'fatture.dialog.noteInterne' | t }}</span></div>
          <mat-form-field>
            <mat-label>{{ 'preventivi.dialog.noteAdUsoInterno' | t }}</mat-label>
            <textarea matInput rows="2" formControlName="note"></textarea>
          </mat-form-field>
        </div>
      </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      @if (data?.id) {
        <button mat-stroked-button type="button" (click)="printFromDialog()">
          <mat-icon>print</mat-icon> {{ 'fatture.dialog.esportaPdf' | t }}</button>
      }
      <button mat-flat-button (click)="save()" [disabled]="form.invalid || locked"
              [matTooltip]="locked ? ('fatture.dialog.sbloccaTooltip' | t) : (form.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : '')">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [RIGHE_STYLES + `
    .opt-fattura { display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap; }
    .opt-residuo { font-size: 12px; color: var(--text-tertiary); }
  `]
})
export class NotaCreditoDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  locked = false;
  toggleLock() { this.locked = !this.locked; }
  onLockedClick(ev: MouseEvent) {
    if (!this.locked) return;
    const target = ev.target as HTMLElement;
    if (target.closest('.dialog-lock-btn')) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.snack.open(this.i18n.t('fatture.dialog.msgDocBloccato'), 'OK', { duration: 2600 });
  }
  form: FormGroup;
  numeriEsistenti = new Set<string>();
  clienti: Cliente[] = [];
  filteredClienti: Cliente[] = [];
  clienteCtrl = new FormControl<Cliente | string | null>('');
  private draft = inject(DraftService);
  private destroyRef = inject(DestroyRef);
  private confirmDraft = inject(ConfirmService);
  private readonly draftTipo = 'note-credito';
  allFatture: Fattura[] = [];
  righe: RigaDocumento[] = [];
  noteRapideList: NotaRapida[] = [];
  prodotti: Prodotto[] = [];
  unitaMisura: UnitaMisura[] = [];
  prezziRecenti: any[][] = [];
  prezziRecentiTutti: any[][] = [];
  tuttiCaricati: boolean[] = [];
  readonly isNew: boolean;

  get selectedClienteId(): number | null {
    const v = this.clienteCtrl.value;
    return v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
  }

  /**
   * Fatture del cliente ancora stornabili. Una già stornata in parte resta in
   * elenco per il residuo: prima spariva al primo collegamento, e uno storno
   * parziale non si poteva più completare.
   */
  get fattureDisponibili(): Fattura[] {
    const cid = this.selectedClienteId;
    if (!cid) return [];
    return this.allFatture.filter(f =>
      f.clienteId === cid &&
      (f.id === this.form.value.fatturaId || this.residuoDaStornare(f) > 0.01)
    );
  }

  /** Quanto della fattura non è ancora coperto da note di credito. */
  residuoDaStornare(f: Fattura): number {
    return (f.totale ?? 0) - (f.stornato ?? 0);
  }

  /** Frase per esteso: nell'opzione ci sta solo l'importo. */
  tooltipResiduo(f: Fattura): string {
    const eur = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
    return this.i18n.t('noteCredito.dialog.residuoDaStornare', {
      importo: eur(this.residuoDaStornare(f)), stornato: eur(f.stornato ?? 0),
    });
  }

  showNetto = false;
  get imponibile() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0); }
  get ivaTotal() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0); }
  get totale() { return this.imponibile + this.ivaTotal; }
  rigaTotale(riga: RigaDocumento) {
    return docRigaTotale(riga, this.showNetto);
  }
  setPrezzoFromInput(riga: RigaDocumento, event: Event) {
    const v = +(event.target as HTMLInputElement).value;
    riga.prezzo = prezzoNettoDaInput(v, riga.iva, this.showNetto);
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    private snack: MatSnackBar,
    private printSvcDialog: PrintService,
    private docLockSvc: DocLockService,
    private documentDirty: DocumentDirtyService,
    public dialogRef: MatDialogRef<NotaCreditoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: NotaCredito | null
  ) {
    this.isNew = !data?.id;
    this.locked = !!data?.id && this.docLockSvc.enabled;
    this.numeriEsistenti = setNumeriEsistenti((data as any)?.numeriEsistenti);
    this.form = this.fb.group({
      numero: [data?.numero ?? '', [Validators.required, numeroUnivocoValidator(() => this.numeriEsistenti)]],
      dataEmissione: [data?.dataEmissione ?? new Date().toISOString().substring(0, 10), Validators.required],
      fatturaId: [data?.fatturaId ?? null],
      note: [data?.note ?? ''],
    });
    if (data?.id) { this.ds.getNotaCreditoById(data.id).subscribe(n => { this.righe = (n.righe ?? []).map((r: any) => ({ ...r, sconto: r.sconto ?? 0 })); this.prezziRecenti = new Array(this.righe.length).fill([]); this.prezziRecentiTutti = new Array(this.righe.length).fill([]); this.tuttiCaricati = new Array(this.righe.length).fill(false); this.righe.forEach((r, i) => { if (r.prodottoId) this.loadPrezziRecenti(i); }); }); }
    else { this.righe = [{ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, iva: 22, sconto: 0 }]; this.prezziRecenti = [[]]; this.prezziRecentiTutti = [[]]; this.tuttiCaricati = [false]; }
  }

  ngOnInit() {
    this.setupBozza();
    this.clienteCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredClienti = this.clienti.filter(c => c.ragioneSociale.toLowerCase().includes(q));
      // Reset fattura when client changes
      if (typeof v !== 'string') {
        this.form.patchValue({ fatturaId: null }, { emitEvent: false });
      }
    });

    this.ds.getClienti().subscribe(all => {
      const c = selezionabili(all, this.data?.clienteId);
      this.clienti = c;
      this.filteredClienti = c;
      if (this.data?.clienteId) {
        const found = c.find(x => x.id === this.data!.clienteId);
        if (found) this.clienteCtrl.setValue(found, { emitEvent: false });
      }
    });

    this.ds.getFatture().subscribe(f => this.allFatture = f);
    this.ds.getProdotti().subscribe(p => this.prodotti = p);
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getNoteRapide().subscribe(n => this.noteRapideList = n);
    // Auto-populate rows when a fattura is selected (only for new NCs)
    this.form.get('fatturaId')!.valueChanges.subscribe(id => {
      if (id && this.isNew) this.loadFatturaRows(id);
    });

    if (this.isNew) {
      this.ds.getNextNumero('note-credito').subscribe(n => this.form.patchValue({ numero: String(n.numero) }));
    }
  }

  /**
   * Ricopia le righe della fattura da stornare. Le quantità restano POSITIVE:
   * la nota di credito è un documento a sé, si stampa e si trasmette allo SdI
   * (TD04) con importi positivi ed è il tipo di documento a dire che storna. Le
   * righe erano importate col segno meno, e così la nota non si salvava nemmeno
   * (il backend rifiuta le quantità negative), la merce usciva dal magazzino
   * invece di rientrare e la stampa riportava totali negativi.
   */
  private loadFatturaRows(fatturaId: number) {
    this.ds.getFatturaById(fatturaId).subscribe(f => {
      const [y, mo, day] = f.dataEmissione.substring(0, 10).split('-');
      this.righe = [
        { descrizione: `Riferimento fattura n. ${f.numero} del ${day}/${mo}/${y}`, quantita: 0, prezzo: 0, iva: 0, sconto: 0, unitaMisura: '' },
        ...(f.righe ?? []).map(r => ({
          ...r, id: undefined, quantita: r.quantita ?? 0,
          scaricaMagazzino: gestitoAScorta(this.prodotti.find(x => x.id === r.prodottoId)),
        }))
      ];
      this.prezziRecenti = new Array(this.righe.length).fill([]);
      this.prezziRecentiTutti = new Array(this.righe.length).fill([]);
      this.tuttiCaricati = new Array(this.righe.length).fill(false);
    });
  }

  displayCliente(c: Cliente | string | null): string {
    return c && typeof c !== 'string' ? (c as Cliente).ragioneSociale : '';
  }

  autoSelectCliente() {
    if (this.filteredClienti.length > 0) this.clienteCtrl.setValue(this.filteredClienti[0]);
  }

  private applyListino(index: number) {
    const riga = this.righe[index];
    const clienteId = this.selectedClienteId;
    if (!clienteId || !riga.prodottoId) return;
    this.ds.resolvePrezzoCliente(clienteId, riga.prodottoId).subscribe(r => {
      if (r.sorgente === 'BASE') return;
      // Per note di credito mantengo il segno della quantita (rimangono in negativo se importate)
      riga.prezzo = r.prezzo;
      riga.sconto = r.sconto;
      if (r.listinoNome) this.snack.open(this.i18n.t('fatture.dialog.msg.prezzoListinoApplicato', { nome: r.listinoNome }), '', { duration: 2200 });
    });
  }

  @ViewChildren('rigaCodice') private codiceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  ngAfterViewInit() {
    setTimeout(() => this.codiceInputs?.first?.nativeElement.focus(), 0);
  }

  searchProdotto(index: number, lista?: Prodotto[]) {
    const query = (this.righe[index]?.codiceProdotto ?? '').toString().trim();
    this.matDialog.open(ProdottoPickerComponent, { width: '720px', maxWidth: '96vw', data: { prodotti: lista ?? this.prodotti, query } })
      .afterClosed().subscribe((pick: ProdottoPick) => {
        if (!pick) return;
        this.applyProdottoToRiga(index, pick.prodotto, pick.variante);
      });
  }

  /** Riempie la riga coi dati del prodotto (riusato da selettore e inserimento via codice). */
  private applyProdottoToRiga(index: number, p: Prodotto, v?: ProdottoPick['variante']) {
    const varSuffix = v ? ` (${[v.taglia, v.colore].filter(Boolean).join(' / ')})` : '';
    this.righe[index].codiceProdotto = p.codice ?? '';
    this.righe[index].descrizione = (p.descrizione || p.codice) + varSuffix;
    this.righe[index].prezzo = p.prezzo ?? 0;
    this.righe[index].iva = p.iva ?? 22;
    this.righe[index].unitaMisura = p.unitaMisura ?? '';
    this.righe[index].prodottoId = p.id ?? null;
    this.righe[index].varianteId = v?.id ?? null;
    this.righe[index].varianteTaglia = v?.taglia ?? '';
    this.righe[index].varianteColore = v?.colore ?? '';
    // Un reso rimette la merce a magazzino, salvo che l'utente lo escluda. Non
    // vale per manodopera e prestazioni: non c'è nulla da rimettere in scaffale.
    if (this.righe[index].scaricaMagazzino === undefined) this.righe[index].scaricaMagazzino = gestitoAScorta(p);
    this.applyListino(index);
    this.loadPrezziRecenti(index);
  }

  /** Inserimento rapido da tastiera: codice (anche parziale) + Invio. */
  risolviCodiceRiga(index: number, event: Event) {
    if ((event as KeyboardEvent).ctrlKey || (event as KeyboardEvent).metaKey) return;   // Ctrl/Cmd+Invio = salva
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    const q = (this.righe[index]?.codiceProdotto ?? '').toString().trim();
    if (!q) { this.searchProdotto(index); return; }
    const { exact, matches } = findProdottoByCodice(this.prodotti, q);
    if (exact) { this.applyProdottoToRiga(index, exact); this.focusNextCodice(input); }
    else if (matches.length === 1) { this.applyProdottoToRiga(index, matches[0]); this.focusNextCodice(input); }
    else if (matches.length > 1) { this.searchProdotto(index, matches); }
    else { this.searchProdotto(index); }
  }

  /** Sposta il focus al codice della riga successiva; se non esiste, ne crea una nuova. */
  // Scorciatoia: Ctrl/Cmd+Invio e Ctrl/Cmd+S salvano il documento da qualunque campo.
  @HostListener('keydown', ['$event'])
  onDialogKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.save(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.save(); }
  }

  // Marca il documento "sporco" a ogni modifica nei campi figli (gli eventi bubblano fino all'host).
  @HostListener('input')
  @HostListener('change')
  onAnyEdit(): void { this.documentDirty.setDirty(true); }

  ngOnDestroy(): void { this.documentDirty.setDirty(false); }

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

  /** ↑/↓ per spostarsi tra i codici delle righe (gli input single-line non usano le frecce verticali). */
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

  roundIfPz(riga: RigaDocumento) {
    if (riga.unitaMisura === 'pz') riga.quantita = Math.max(1, Math.round(riga.quantita || 1));
    else riga.quantita = Math.max(0.001, riga.quantita || 0.001);
  }
  clampSconto(riga: RigaDocumento) {
    riga.sconto = Math.min(100, Math.max(0, riga.sconto ?? 0));
  }

  loadPrezziRecenti(index: number) {
    const riga = this.righe[index];
    if (!riga.prodottoId) return;
    this.ds.getPrezziRecenti(riga.prodottoId, this.selectedClienteId).subscribe(pr => {
      this.prezziRecenti[index] = pr;
    });
  }

  loadTuttiPrezzi(index: number, prodottoId: number | null) {
    if (!prodottoId || this.tuttiCaricati[index]) return;
    this.tuttiCaricati[index] = true;
    this.ds.getPrezziRecenti(prodottoId, null).subscribe({
      next: p => {
        const cid = this.selectedClienteId ?? null;
        this.prezziRecentiTutti[index] = cid ? p.filter((x: any) => x.clienteId !== cid) : p;
      },
      error: () => { this.prezziRecentiTutti[index] = []; }
    });
  }

  usaPrezzo(index: number, prezzo: number, sconto: number) {
    this.righe[index].prezzo = prezzo;
    this.righe[index].sconto = sconto;
  }

  addRiga() { this.righe.push({ tipo: 'PRODOTTO', descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, iva: 22, sconto: 0 }); this.prezziRecenti.push([]); this.prezziRecentiTutti.push([]); this.tuttiCaricati.push(false); scrollFocusLastRiga(this.codiceInputs); }
  addNota(testo: string) { this.righe.push({ tipo: 'NOTA', descrizione: testo, quantita: 0, prezzo: 0, sconto: 0, iva: 0 }); this.prezziRecenti.push([]); this.prezziRecentiTutti.push([]); this.tuttiCaricati.push(false); }
  removeRiga(i: number) { this.righe.splice(i, 1); this.prezziRecenti.splice(i, 1); this.prezziRecentiTutti.splice(i, 1); this.tuttiCaricati.splice(i, 1); }

  apriCopiaRighe() {
    const cv = this.clienteCtrl.value;
    const clienteId = cv && typeof cv !== 'string' ? (cv as Cliente).id ?? null : null;
    const clienteNome = cv && typeof cv !== 'string' ? (cv as Cliente).ragioneSociale : null;
    this.matDialog.open(CopiaRigheDialogComponent, {
      data: { clienteId, clienteNome, righeCorrenti: this.righe } as CopiaRigheDialogData
    }).afterClosed().subscribe((righe: RigaDocumento[]) => {
      if (!righe?.length) return;
      if (this.righe.length === 1) {
        const r = this.righe[0];
        if (!r.descrizione?.trim() && !r.prodottoId) {
          this.righe.splice(0, 1);
          this.prezziRecenti.splice(0, 1);
          this.prezziRecentiTutti.splice(0, 1);
          this.tuttiCaricati.splice(0, 1);
        }
      }
      this.righe.push(...righe);
      this.prezziRecenti.push(...new Array(righe.length).fill([]));
      this.prezziRecentiTutti.push(...new Array(righe.length).fill([]));
      this.tuttiCaricati.push(...new Array(righe.length).fill(false));
    });
  }
  dropRiga(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.righe, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecenti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecentiTutti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.tuttiCaricati, event.previousIndex, event.currentIndex);
  }

  printFromDialog() { if (this.data?.id) this.printSvcDialog.printNotaCredito(this.data.id); }

  save() {
    if (!this.form.valid) return;
    const v = this.clienteCtrl.value;
    const clienteId = v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
    const fatturaId = this.form.value.fatturaId;
    const stato = fatturaId ? 'PAGATA' : (this.data?.stato ?? 'EMESSA');
    this.draft.clear(this.draftTipo);
    this.dialogRef.close({ ...this.data, ...this.form.value, clienteId, stato, righe: righeDaSalvare(this.righe) });
  }

  /** Autosalvataggio bozza (solo documento nuovo): ripristino su conferma + salvataggio periodico. */
  private setupBozza() {
    if (this.data?.id) return;
    const bozza = this.draft.load(this.draftTipo);
    const haContenuto = bozza && Array.isArray(bozza.righe) &&
      bozza.righe.some((r: any) => r?.descrizione?.trim() || r?.prodottoId);
    if (haContenuto) {
      this.confirmDraft.ask(this.i18n.t('fatture.dialog.msg.riprendiBozza')).then(ok => {
      if (ok) {
        try {
          const f = { ...(bozza.form || {}) }; delete f.numero;
          this.form.patchValue(f);
          this.righe = bozza.righe;
          this.prezziRecenti = new Array(this.righe.length).fill([]);
          this.prezziRecentiTutti = new Array(this.righe.length).fill([]);
          this.tuttiCaricati = new Array(this.righe.length).fill(false);
        } catch { this.draft.clear(this.draftTipo); }
      } else {
        this.draft.clear(this.draftTipo);
      }
      });
    }
    const t = setInterval(() => {
      try {
        const righe = this.righe || [];
        if (!righe.some((r: any) => r?.descrizione?.trim() || r?.prodottoId)) return;
        this.draft.save(this.draftTipo, { form: this.form.getRawValue(), righe });
      } catch { /* ignora */ }
    }, 3000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }
}

@Component({
  selector: 'app-note-credito',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatCheckboxModule, MatMenuModule,
            MatSortModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatPaginatorModule, EmptyStateComponent,
            TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './note-credito.html',
  styleUrl: './note-credito.scss'
})
export class NoteCreditoComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allNoteCredito: NotaCredito[] = [];
  dataSource = new MatTableDataSource<NotaCredito>([]);
  displayedColumns = ['select', 'numero', 'dataEmissione', 'clienteNome', 'totale', 'stato', 'azioni'];
  selection = new SelectionModel<NotaCredito>(true, []);

  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));
  // Filtri multipli: array vuoto = "tutti" (si possono scegliere più anni/mesi/clienti).
  filtroAnni: number[] = [];
  filtroMesi: number[] = [];
  filtroClienti: number[] = [];

  get anni() { return [...new Set(this.allNoteCredito.map(n => +n.dataEmissione.substring(0, 4)))].sort().reverse(); }
  get clientiList() {
    const map = new Map<number, string>();
    this.allNoteCredito.forEach(n => { if (n.clienteId) map.set(n.clienteId, n.clienteNome ?? ''); });
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  get noteCredito() { return this.dataSource.data; }
  /** Somma dei soli documenti selezionati (per la barra totali in fondo alla lista). */
  get totaleSelezione(): number { return this.selection.selected.reduce((s, x) => s + (Number((x as any).totale) || 0), 0); }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, private printSvc: PrintService, public excel: ExcelService, private viewState: ViewStateService) {}

  // Scorciatoia: Ctrl/Cmd+N apre una nuova nota di credito (disabilitata se un dialog è già aperto).
  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  ngOnInit() {
    // Ripristino filtri salvati (prima di qualunque prefill, che deve poter prevalere).
    const vs = this.viewState.read<any>('note-credito');
    if (vs) {
      if (Array.isArray(vs.filtroAnni)) this.filtroAnni = vs.filtroAnni;
      if (Array.isArray(vs.filtroMesi)) this.filtroMesi = vs.filtroMesi;
      if (Array.isArray(vs.filtroClienti)) this.filtroClienti = vs.filtroClienti;
    }
    this.load();
  }

  /** Salva filtri + ordinamento correnti per ripristinarli alla prossima apertura. */
  saveViewState(): void {
    this.viewState.write('note-credito', {
      filtroAnni: this.filtroAnni,
      filtroMesi: this.filtroMesi,
      filtroClienti: this.filtroClienti,
      sortActive: this.sort?.active ?? null,
      sortDir: this.sort?.direction ?? null,
    });
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    // Ripristino ordinamento salvato.
    const vs = this.viewState.read<any>('note-credito');
    if (vs?.sortActive) {
      this.sort.active = vs.sortActive;
      this.sort.direction = vs.sortDir ?? '';
      this.dataSource.sort = this.sort;
    }
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
        case 'dataEmissione': return item.dataEmissione ?? '';
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) => {
      const s = filter.toLowerCase();
      return (item.numero ?? '').toLowerCase().includes(s)
          || (item.clienteNome ?? '').toLowerCase().includes(s)
          || (item.stato ?? '').toLowerCase().includes(s);
    };
  }

  load() {
    this.ds.getNoteCredito().subscribe(n => {
      this.allNoteCredito = n;
      this.applyFilters();
      this.selection.clear();
    });
  }

  applyFilters() {
    let data = this.allNoteCredito;
    if (this.filtroAnni.length) data = data.filter(n => this.filtroAnni.includes(+n.dataEmissione.substring(0, 4)));
    if (this.filtroMesi.length) data = data.filter(n => this.filtroMesi.includes(+n.dataEmissione.substring(5, 7)));
    if (this.filtroClienti.length) data = data.filter(n => n.clienteId != null && this.filtroClienti.includes(n.clienteId));
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
    this.saveViewState();
  }

  resetFiltri() {
    this.filtroAnni = []; this.filtroMesi = []; this.filtroClienti = [];
    this.dataSource.filter = ''; this.applyFilters();
    this.saveViewState();
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim();
  }

  print() {
    const t = (k: string) => this.i18n.t(k);
    const rows = this.selection.hasValue() ? this.selection.selected : this.dataSource.data;
    const d = (s: string) => { const p = (s||'').substring(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:'—'; };
    const e = (n: number|undefined) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n??0);
    const body = rows.map(n=>`<tr><td>${n.numero}</td><td>${d(n.dataEmissione)}</td><td>${n.clienteNome||'—'}</td><td class="r">${e(n.totale)}</td><td>${n.stato}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('noteCredito.title')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${t('noteCredito.title')}</h1><table><thead><tr><th>${t('noteCredito.col.numero')}</th><th>${t('noteCredito.col.data')}</th><th>${t('noteCredito.col.cliente')}</th><th class="r">${t('noteCredito.col.importo')}</th><th>${t('noteCredito.col.stato')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('noteCredito.col.numero'),  field: 'numero',        width: 14 },
    { header: this.i18n.t('noteCredito.col.data'),    field: 'dataEmissione', width: 14 },
    { header: this.i18n.t('noteCredito.col.cliente'), field: 'clienteNome',   width: 30 },
    { header: this.i18n.t('noteCredito.col.importo'), field: 'totale',        width: 14 },
    { header: this.i18n.t('noteCredito.col.stato'),   field: 'stato',         width: 14 },
  ];
  /** Righe da esportare: le selezionate se ce ne sono, altrimenti tutta la lista. */
  get exportRows(): any[] { return this.selection.hasValue() ? this.selection.selected : this.dataSource.data; }

  get totaleLista(): number {
    return this.dataSource.data.reduce((s, r) => s + (Number((r as any).totale) || 0), 0);
  }

  isAllSelected() { return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  setStato(n: NotaCredito, stato: string) {
    this.ds.setNotaCreditoStato(n.id!, stato).subscribe({ next: () => this.load(), error: e => this.snack.open(e.message, '', { duration: 3000 }) });
  }
  bulkSetStato(stato: string) {
    const ids = this.selection.selected.map(n => n.id!);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.ds.setNotaCreditoStato(id, stato))).subscribe({
      next: () => { this.selection.clear(); this.load(); },
      error: e => this.snack.open(e?.error?.error || e?.message || this.i18n.t('noteCredito.msg.erroreStato'), '', { duration: 3000 })
    });
  }

  async bulkElimina() {
    const sel = this.selection.selected;
    if (!sel.length) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('noteCredito.msg.confermaEliminaBulk', n))) return;
    forkJoin(sel.map(x => this.ds.getNotaCreditoById(x.id!).pipe(catchError(() => of(null))))).subscribe(fulls => {
      const backups = fulls.filter(Boolean);
      forkJoin(sel.map(x => this.ds.deleteNotaCredito(x.id!).pipe(catchError(err => of({ __error: err }))))).subscribe(results => {
        const errori = results.filter((r: any) => r && r.__error).length;
        this.selection.clear();
        this.load();
        const msg = errori ? this.i18n.t('noteCredito.msg.eliminatiParziali', { ok: n - errori, errori }) : this.i18n.tn('noteCredito.msg.eliminatiBulk', n);
        const ref = this.snack.open(msg, this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createNotaCredito(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('noteCredito.msg.ripristinatiBulk'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      });
    });
  }

  open(n?: NotaCredito) {
    const numeriEsistenti = this.allNoteCredito.filter(x => x.id !== n?.id).map(x => x.numero);
    const ref = this.dialog.open(NotaCreditoDialogComponent, {
      data: { ...(n ?? {}), numeriEsistenti }, width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateNotaCredito(result) : this.ds.createNotaCredito(result);
      op.subscribe({
        next: () => {
          // Lo stato della fattura lo decide il backend confrontando incassato e
          // stornato: forzarlo da qui la marcava saldata anche per uno storno
          // parziale, e la lasciava saldata se poi la nota veniva eliminata.
          this.load();
          this.snack.open(this.i18n.t('noteCredito.msg.salvato'), '', { duration: 2000 });
        },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' })
      });
    });
  }

  printDoc(n: NotaCredito) { this.printSvc.printNotaCredito(n.id!); }

  downloadXml(n: NotaCredito) {
    const a = document.createElement('a');
    a.href = `${environment.apiUrl}/fattura-xml/nota-credito/${n.id}`;
    a.download = `NotaCredito_${n.numero}.xml`;
    a.click();
  }

  inviaSdi(n: NotaCredito) {
    this.ds.validateNotaXml(n.id!).subscribe({
      next: async v => {
        if (!v.ok) {
          await this.confirm.alert({
            title: this.i18n.t('noteCredito.msg.nonInviabileTitle'),
            message: this.i18n.t('noteCredito.msg.sistemarePunti') +
                     v.errors.map(e => '• ' + e).join('\n') +
                     (v.warnings.length ? '\n\n' + this.i18n.t('noteCredito.msg.avvisiPrefix') + v.warnings.map(w => '• ' + w).join('\n') : ''),
          });
          return;
        }
        const prefix = v.warnings.length
          ? `${this.i18n.t('noteCredito.msg.avvisiPrefix')}${v.warnings.map(w => '• ' + w).join('\n')}\n\n`
          : '';
        if (!await this.confirm.ask(`${prefix}${this.i18n.t('noteCredito.msg.confermaInvioSdi', { numero: n.numero })}`)) return;
        this.ds.inviaNotaSdi(n.id!).subscribe({
          next: r => { this.load(); this.snack.open(this.i18n.t('noteCredito.msg.inviataSdi', { id: r.idTrasmissione }), '', { duration: 4000, panelClass: 'snack-ok' }); },
          error: e => {
            const msg = e.error?.error || e.message || '';
            if (msg.includes('SDI non configurata')) {
              const ref = this.snack.open(
                this.i18n.t('noteCredito.msg.sdiNonConfigurata'),
                this.i18n.t('noteCredito.msg.scaricaXmlAction'), { duration: 9000, panelClass: 'snack-error' }
              );
              ref.onAction().subscribe(() => this.downloadXml(n));
            } else {
              this.snack.open(this.i18n.t('noteCredito.msg.erroreSdi', { msg }), '', { duration: 5000, panelClass: 'snack-error' });
            }
          }
        });
      },
      error: () => this.snack.open(this.i18n.t('noteCredito.msg.erroreControllo'), 'OK',
                                   { duration: 5000, panelClass: 'snack-error' })
    });
  }

  inviaEmail(n: NotaCredito) {
    forkJoin({ az: this.ds.getAzienda(), clienti: this.ds.getClienti() }).subscribe(({ az, clienti }) => {
      const cliente = clienti.find(c => c.id === n.clienteId);
      const ref = this.dialog.open(EmailDialogComponent, {
        width: '560px', maxWidth: '95vw',
        data: {
          title: this.i18n.t('noteCredito.msg.inviaTitolo', { numero: n.numero }),
          subtitle: cliente?.ragioneSociale ? this.i18n.t('preventivi.msg.aCliente', { nome: cliente.ragioneSociale }) : undefined,
          destinatario: cliente?.email || '',
          testo: az?.emailCorpoDocumento || '',
        },
      });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.sendNotaCreditoEmail(n.id!, result.destinatario, result.testo || undefined).subscribe({
          next: () => this.snack.open(this.i18n.t('preventivi.msg.emailInviata'), '', { duration: 2000 }),
          error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreEmail', { msg: e.error?.error || e.message }), '', { duration: 4000 })
        });
      });
    });
  }

  info(n: NotaCredito) {
    this.ds.getNotaCreditoPrint(n.id!).subscribe(doc => {
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      const extra: { label: string; value: string }[] = [];
      if (doc.fatturaNumeroColl) extra.push({ label: this.i18n.t('noteCredito.info.rifFattura'), value: doc.fatturaNumeroColl });
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: 'NOTA DI CREDITO', numero: doc.numero, data: doc.dataEmissione, stato: doc.stato,
          controparteLabel: this.i18n.t('preventivi.info.clienteLabel'),
          controparte: doc.cliente?.ragioneSociale || n.clienteNome || '—',
          controparteInfo: doc.cliente ? [
            [doc.cliente.via, [doc.cliente.cap, doc.cliente.citta].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            doc.cliente.pIva ? `P.IVA: ${doc.cliente.pIva}` : '',
          ].filter(Boolean) as string[] : [],
          totale: imponibile + ivaT, imponibile, righe, extraFields: extra, note: doc.note,
        } as DocInfoData,
        width: '720px', maxWidth: '98vw', maxHeight: '92vh',
      });
    });
  }

  /** Id delle note di credito in corso di duplicazione: evita un doppio clic
   *  rapido sul kebab → "Duplica" (il menu si chiude subito, quindi non basta
   *  disabilitare il bottone) che creerebbe due copie della stessa nota. */
  private duplicating = new Set<number>();

  duplicate(n: NotaCredito) {
    if (!n.id || this.duplicating.has(n.id)) return;
    this.duplicating.add(n.id);
    const fine = () => this.duplicating.delete(n.id!);
    forkJoin({ full: this.ds.getNotaCreditoById(n.id!), num: this.ds.getNextNumero('note-credito') }).subscribe({
      next: ({ full, num }) => {
        const { id, ...pre } = full as any;
        pre.numero = String(num.numero);
        pre.dataEmissione = new Date().toISOString().substring(0, 10);
        pre.stato = 'EMESSA';
        pre.fatturaId = null;
        this.ds.createNotaCredito(pre).subscribe({
          next: () => { fine(); this.load(); this.snack.open(this.i18n.t('noteCredito.msg.duplicato', { numero: pre.numero }), '', { duration: 2500, panelClass: 'snack-ok' }); },
          error: e => { fine(); this.snack.open(e.message || this.i18n.t('preventivi.msg.erroreDuplicazione'), 'OK', { duration: 4000, panelClass: 'snack-error' }); }
        });
      },
      error: e => { fine(); this.snack.open(this.i18n.t('preventivi.msg.erroreGenerico', { msg: e.message || '' }), 'OK', { duration: 4000 }); }
    });
  }

  async delete(n: NotaCredito) {
    if (!await this.confirm.delete(this.i18n.t('noteCredito.msg.confermaElimina', { numero: n.numero }))) return;
    this.ds.getNotaCreditoById(n.id!).subscribe(full => {
      this.ds.deleteNotaCredito(n.id!).subscribe(() => {
        this.load();
        const ref = this.snack.open(this.i18n.t('noteCredito.msg.eliminato', { numero: n.numero }), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          const { id, ...payload } = full as any;
          this.ds.createNotaCredito(payload).subscribe({
            next: () => { this.load(); this.snack.open(this.i18n.t('noteCredito.msg.ripristinato'), '', { duration: 2000, panelClass: 'snack-ok' }); },
            error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreRipristino', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
          });
        });
      });
    });
  }
}
