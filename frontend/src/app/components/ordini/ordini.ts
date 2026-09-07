import { inject, Component, OnInit, AfterViewInit, OnDestroy, Inject, ViewChild, ViewChildren, QueryList, ElementRef, HostListener, DestroyRef } from '@angular/core';
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
import { Ordine, Cliente, Fornitore, Prodotto, RigaDocumento, UnitaMisura, NotaRapida } from '../../models';
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
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ViewStateService } from '../../services/view-state.service';
import { DocumentDirtyService } from '../../services/document-dirty.service';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

@Component({
  selector: 'app-ordine-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule,
            MatAutocompleteModule, MatIconModule, MatButtonToggleModule, MatMenuModule, MatTooltipModule, DragDropModule, TPipe, TnPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon is-warning">
          <mat-icon>shopping_cart</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">
            {{ data?.id ? i18n.t('ordini.dialog.titoloEsistente', { numero: data?.numero || '' }) : ('ordini.dialog.nuovo' | t) }}
            @if (data?.id && locked) {
              <span class="dialog-lock-chip"><mat-icon>lock</mat-icon>{{ 'fatture.dialog.bloccato' | t }}</span>
            }
          </span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'ordini.dialog.subEsistente' : 'ordini.dialog.subNuovo') | t }}</span>
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
          <div class="form-section-header">
            <mat-icon>{{ isFornitore ? 'business' : 'person' }}</mat-icon>
            <span>{{ 'fatture.dialog.intestazione' | t }}</span>
            <span class="doc-chip">{{ (isFornitore ? 'ordini.dialog.chipOrdineFornitore' : 'ordini.dialog.chipOrdineCliente') | t }}</span>
          </div>
          <div class="doc-field-grid" [formGroup]="form">
            @if (!isFornitore) {
              <mat-form-field>
                <mat-label>{{ 'ordini.dialog.cliente' | t }}</mat-label>
                <input matInput [matAutocomplete]="autoCliente" [formControl]="clienteCtrl"
                       (keyup.enter)="autoSelectCliente()" [placeholder]="'ordini.dialog.cercaClientePh' | t">
                <mat-icon matSuffix>search</mat-icon>
                <mat-autocomplete #autoCliente="matAutocomplete" [displayWith]="displayCliente">
                  @for (c of filteredClienti; track c.id) {
                    <mat-option [value]="c">{{ c.ragioneSociale }}</mat-option>
                  }
                </mat-autocomplete>
              </mat-form-field>
            }
            @if (isFornitore) {
              <mat-form-field>
                <mat-label>{{ 'ordini.dialog.fornitore' | t }}</mat-label>
                <input matInput [matAutocomplete]="autoFornitore" [formControl]="fornitoreCtrl"
                       (keyup.enter)="autoSelectFornitore()" [placeholder]="'ordini.dialog.cercaFornitorePh' | t">
                <mat-icon matSuffix>search</mat-icon>
                <mat-autocomplete #autoFornitore="matAutocomplete" [displayWith]="displayFornitore">
                  @for (f of filteredFornitori; track f.id) {
                    <mat-option [value]="f">{{ f.ragioneSociale }}</mat-option>
                  }
                </mat-autocomplete>
              </mat-form-field>
            }
            <mat-form-field>
              <mat-label>{{ 'fatture.dialog.numero' | t }}</mat-label>
              <input matInput formControlName="numero">
              @if (form.get('numero')?.hasError('numeroDuplicato')) {
                <mat-error>{{ 'fatture.dialog.numeroEsistente' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'ordini.dialog.dataOrdine' | t }}</mat-label>
              <input matInput type="date" formControlName="dataOrdine">
            </mat-form-field>
          </div>
        </div>

      <div class="form-section">
        <div class="righe-header">
          <div class="righe-header-title">
            <span>{{ 'ordini.dialog.righe' | t }}</span>
          </div>
          <div class="righe-actions">
            @if (!isFornitore) {
              <mat-button-toggle-group [(ngModel)]="showNetto" [hideSingleSelectionIndicator]="true">
                <mat-button-toggle [value]="false">{{ 'fatture.dialog.ivato' | t }}</mat-button-toggle>
                <mat-button-toggle [value]="true">{{ 'fatture.dialog.netto' | t }}</mat-button-toggle>
              </mat-button-toggle-group>
            }
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
        <div class="righe-scroll">
        <table class="righe-table">
          <thead>
            <tr>
              <th class="td-drag"></th>
              @if (isFornitore) { <th class="td-codfornitore">{{ 'ordini.dialog.colVostroCodice' | t }}</th> }
              <th class="td-desc">{{ 'fatture.dialog.colCodiceDescrizione' | t }}</th>
              <th class="td-search"></th>
              @if (!isFornitore) { <th class="td-history"></th> }
              <th class="td-qta">{{ 'fatture.dialog.colQta' | t }}</th>
              <th class="td-um">{{ 'fatture.dialog.colUm' | t }}</th>
              @if (!isFornitore) {
                <th class="td-prezzo">{{ (showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t }}</th>
                <th class="td-sconto">{{ 'fatture.dialog.colSconto' | t }}</th>
                <th class="td-iva">{{ 'preventivi.dialog.colIva' | t }}</th>
                <th class="td-totale">{{ (showNetto ? 'fatture.dialog.colTotaleNetto' : 'fatture.dialog.colTotaleIvato') | t }}</th>
              }
              <th class="td-actions"></th>
            </tr>
          </thead>
          <tbody cdkDropList (cdkDropListDropped)="dropRiga($event)">
            @for (riga of righe; track $index; let rowIdx = $index) {
              @if (riga.tipo === 'NOTA') {
                <tr class="riga-nota" cdkDrag cdkDragPreviewContainer="parent">
                  <td class="td-drag" cdkDragHandle><mat-icon>drag_indicator</mat-icon></td>
                  <td class="td-nota" [attr.colspan]="isFornitore ? 5 : 9">
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
                @if (isFornitore) {
                  <td class="td-codfornitore" [attr.data-label]="'ordini.dialog.colVostroCodice' | t"><input class="riga-input" [(ngModel)]="riga.codiceFornitore" [placeholder]="'ordini.dialog.codFornitorePh' | t"></td>
                }
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
                @if (!isFornitore) {
                  <td class="td-history">
                    @if (prezziRecenti[$index]?.length) {
                      <button mat-icon-button type="button" [matMenuTriggerFor]="menuPR" [matMenuTriggerData]="{idx: $index}" [title]="'fatture.dialog.prezziRecentiClienteTooltip' | t">
                        <mat-icon class="icon-primary">history</mat-icon>
                      </button>
                    }
                    @if (riga.prodottoId) {
                      <button mat-icon-button type="button" [title]="'fatture.dialog.prezziTuttiClientiTooltip' | t" [matMenuTriggerFor]="menuTutti" (click)="loadTuttiPrezzi($index, riga.prodottoId)">
                        <mat-icon class="icon-muted">groups</mat-icon>
                      </button>
                      <mat-menu #menuTutti="matMenu">
                        <div class="menu-section-label">{{ 'fatture.dialog.tuttiClienti' | t }}</div>
                        @if (!tuttiCaricati[$index]) {
                          <div class="menu-empty">{{ 'fatture.dialog.clicPerCaricare' | t }}</div>
                        }
                        @if (tuttiCaricati[$index] && !prezziRecentiTutti[$index]?.length) {
                          <div class="menu-empty">{{ 'fatture.dialog.nessunPrezzoTrovato' | t }}</div>
                        }
                        @for (pr of prezziRecentiTutti[rowIdx] ?? []; track $index) {
                          <button mat-menu-item type="button" (click)="usaPrezzo(rowIdx, pr.prezzo, pr.sconto)">
                            <div>
                              <span class="pr-meta" style="display:block">{{ pr.clienteNome ?? '' }} · {{ pr.tipo }} {{ pr.numero }} — {{ pr.dataEmissione | date:'dd/MM/yy' }}</span>
                              <b class="pr-value" style="margin-left:0">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</b>
                              @if (pr.sconto) { <span class="pr-discount">(-{{ pr.sconto }}%)</span> }
                            </div>
                          </button>
                        }
                      </mat-menu>
                    }
                  </td>
                }
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
                @if (!isFornitore) {
                  <td class="td-prezzo" [attr.data-label]="(showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t"><input class="riga-input" type="number" min="0" [step]="prezzoFmt.step()"
                    [value]="showNetto ? riga.prezzo : +(riga.prezzo * (1 + riga.iva/100)).toFixed(prezzoFmt.decimali())"
                    (change)="setPrezzoFromInput(riga, $event)"></td>
                  <td class="td-sconto" [attr.data-label]="'fatture.dialog.colSconto' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.sconto"></td>
                  <td class="td-iva" [attr.data-label]="'preventivi.dialog.colIva' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.iva"></td>
                  <td class="td-totale" [attr.data-label]="'fatture.dialog.totale' | t">
                    {{ rigaTotale(riga) | currency:'EUR':'symbol':'1.2-2':'it' }}
                  </td>
                }
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
            @for (pr of prezziRecenti[idx]; track $index) {
              <button mat-menu-item type="button" (click)="usaPrezzo(idx, pr.prezzo, pr.sconto)">
                <div class="prezzo-recente-item">
                  <span>{{ pr.prezzoEffettivo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}
                    @if (pr.sconto) { <span class="pr-discount">&nbsp;(-{{ pr.sconto }}%)</span> }
                  </span>
                  <span class="pr-meta">{{ pr.tipo }} {{ pr.numero }} · {{ pr.dataEmissione | date:'dd/MM/yy' }}</span>
                </div>
              </button>
            }
          </ng-template>
        </mat-menu>
      </div>

      @if (!isFornitore) {
        <div class="doc-totals-strip">
          <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
          <span class="totals-spacer"></span>
          <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
        </div>
      }

      <div class="form-section is-flat" [formGroup]="form">
        <div class="form-section-header"><mat-icon>notes</mat-icon><span>{{ 'fatture.dialog.noteInterne' | t }}</span></div>
        <mat-form-field>
          <mat-label>{{ 'fatture.dialog.annotazioniInterne' | t }}</mat-label>
          <textarea matInput rows="2" formControlName="note"></textarea>
        </mat-form-field>
      </div>

      </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      @if (data?.id) {
        <button mat-stroked-button type="button" (click)="esportaPdf()">
          <mat-icon>print</mat-icon> {{ 'fatture.dialog.esportaPdf' | t }}
        </button>
      }
      <button mat-flat-button (click)="save()" [disabled]="form.invalid || locked"
              [matTooltip]="locked ? ('fatture.dialog.sbloccaTooltip' | t) : (form.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : '')">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [RIGHE_STYLES + `
    .dialog-hero-icon.is-warning { background: linear-gradient(135deg, var(--warning) 0%, var(--warning-on) 100%); box-shadow: 0 4px 12px -2px color-mix(in srgb, var(--warning) 35%, transparent); }
  `]
})
export class OrdineDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  private documentDirty = inject(DocumentDirtyService);
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
  private readonly draftTipo = 'ordini';
  fornitori: Fornitore[] = [];
  filteredFornitori: Fornitore[] = [];
  fornitoreCtrl = new FormControl<Fornitore | string | null>('');
  righe: RigaDocumento[] = [];
  noteRapideList: NotaRapida[] = [];
  prodotti: Prodotto[] = [];
  unitaMisura: UnitaMisura[] = [];
  prezziRecenti: any[][] = [];
  prezziRecentiTutti: any[][] = [];
  tuttiCaricati: boolean[] = [];
  readonly isNew: boolean;

  showNetto = false;
  get isFornitore() { return this.form.get('tipo')?.value === 'FORNITORE'; }
  get fornitoreSelezionatoId(): number | null {
    const fv = this.fornitoreCtrl.value;
    return fv && typeof fv !== 'string' ? ((fv as Fornitore).id ?? null) : null;
  }
  /** Ricarica il codice (e prezzo) del fornitore dell'ordine per tutte le righe già inserite. */
  private refreshCodiciFornitore() {
    const fornId = this.fornitoreSelezionatoId;
    if (!fornId) return;
    this.righe.forEach((r, i) => {
      if (!r.prodottoId) return;
      this.ds.getProdottoFornitori(r.prodottoId).subscribe(list => {
        const m = list.find(x => x.fornitoreId === fornId);
        if (m) {
          this.righe[i].codiceFornitore = m.codiceFornitore || this.righe[i].codiceFornitore;
          if (m.prezzoAcquisto != null) this.righe[i].prezzo = m.prezzoAcquisto;
        }
      });
    });
  }
  get imponibile() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0); }
  get ivaTotal() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0); }
  get totale() { return this.imponibile + this.ivaTotal; }
  rigaTotale(riga: RigaDocumento) {
    return docRigaTotale(riga, this.showNetto);
  }
  setPrezzoFromInput(riga: RigaDocumento, event: Event) {
    const v = +(event.target as HTMLInputElement).value;
    riga.prezzo = prezzoNettoDaInput(v, riga.iva, this.showNetto, this.prezzoFmt.decimali());
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    private snack: MatSnackBar,
    public dialogRef: MatDialogRef<OrdineDialogComponent>,
    private printSvc: PrintService,
    private docLockSvc: DocLockService,
    @Inject(MAT_DIALOG_DATA) public data: Ordine | null
  ) {
    this.isNew = !data?.id;
    this.locked = !!data?.id && this.docLockSvc.enabled;
    this.numeriEsistenti = setNumeriEsistenti((data as any)?.numeriEsistenti);
    this.form = this.fb.group({
      numero: [data?.numero ?? '', [Validators.required, numeroUnivocoValidator(() => this.numeriEsistenti)]],
      dataOrdine: [data?.dataOrdine ?? new Date().toISOString().substring(0, 10), Validators.required],
      tipo: [data?.tipo ?? 'CLIENTE'],
      note: [data?.note ?? ''],
    });
    if (data?.id) { this.ds.getOrdineById(data.id).subscribe(o => { this.righe = (o.righe ?? []).map((r: any) => ({ ...r, sconto: r.sconto ?? 0 })); this.prezziRecenti = new Array(this.righe.length).fill([]); this.prezziRecentiTutti = new Array(this.righe.length).fill([]); this.tuttiCaricati = new Array(this.righe.length).fill(false); this.righe.forEach((r, i) => { if (r.prodottoId) this.loadPrezziRecenti(i); }); }); }
    else { this.righe = [{ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, iva: 22, sconto: 0 }]; this.prezziRecenti = [[]]; this.prezziRecentiTutti = [[]]; this.tuttiCaricati = [false]; }
  }

  ngOnInit() {
    this.setupBozza();
    this.clienteCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredClienti = this.clienti.filter(c => c.ragioneSociale.toLowerCase().includes(q));
    });
    this.fornitoreCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredFornitori = this.fornitori.filter(f => f.ragioneSociale.toLowerCase().includes(q));
      if (v && typeof v !== 'string') this.refreshCodiciFornitore();
    });

    this.ds.getClienti().subscribe(c => {
      this.clienti = c;
      this.filteredClienti = c;
      if (this.data?.clienteId) {
        const found = c.find(x => x.id === this.data!.clienteId);
        if (found) this.clienteCtrl.setValue(found, { emitEvent: false });
      }
    });

    this.ds.getFornitori().subscribe(f => {
      this.fornitori = f;
      this.filteredFornitori = f;
      if (this.data?.fornitoreId) {
        const found = f.find(x => x.id === this.data!.fornitoreId);
        if (found) this.fornitoreCtrl.setValue(found, { emitEvent: false });
      }
    });

    this.ds.getProdotti().subscribe(p => this.prodotti = p);
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getNoteRapide().subscribe(n => this.noteRapideList = n);

    if (this.isNew) {
      this.ds.getNextNumero('ordini').subscribe(n => this.form.patchValue({ numero: String(n.numero) }));
    }
  }

  displayCliente(c: Cliente | string | null): string {
    return c && typeof c !== 'string' ? (c as Cliente).ragioneSociale : '';
  }
  displayFornitore(f: Fornitore | string | null): string {
    return f && typeof f !== 'string' ? (f as Fornitore).ragioneSociale : '';
  }

  autoSelectCliente() {
    if (this.filteredClienti.length > 0) this.clienteCtrl.setValue(this.filteredClienti[0]);
  }
  autoSelectFornitore() {
    if (this.filteredFornitori.length > 0) this.fornitoreCtrl.setValue(this.filteredFornitori[0]);
  }

  private get selectedClienteId(): number | null {
    const v = this.clienteCtrl.value;
    return v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
  }

  @ViewChildren('rigaCodice') private codiceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  ngAfterViewInit() {
    setTimeout(() => this.codiceInputs?.first?.nativeElement.focus(), 0);
  }

  searchProdotto(index: number, lista?: Prodotto[]) {
    const query = (this.righe[index]?.codiceProdotto ?? '').toString().trim();
    this.matDialog.open(ProdottoPickerComponent, { width: '650px', data: { prodotti: lista ?? this.prodotti, query } })
      .afterClosed().subscribe((pick: ProdottoPick) => {
        if (!pick) return;
        this.applyProdottoToRiga(index, pick.prodotto, pick.variante);
      });
  }

  /** Riempie la riga coi dati del prodotto (riusato da selettore e inserimento via codice). */
  private applyProdottoToRiga(index: number, p: Prodotto, v?: ProdottoPick['variante']) {
    const varSuffix = v ? ` (${[v.taglia, v.colore].filter(Boolean).join(' / ')})` : '';
    this.righe[index].codiceProdotto = p.codice ?? '';
    this.righe[index].descrizione = (p.descrizione || p.nome) + varSuffix;
    this.righe[index].prezzo = p.prezzo ?? 0;
    this.righe[index].iva = p.iva ?? 22;
    this.righe[index].unitaMisura = p.unitaMisura ?? '';
    this.righe[index].prodottoId = p.id ?? null;
    this.righe[index].varianteId = v?.id ?? null;
    this.righe[index].varianteTaglia = v?.taglia ?? '';
    this.righe[index].varianteColore = v?.colore ?? '';
    if (this.isFornitore) {
      // Codice di default del prodotto (predefinito), poi sovrascritto col codice
      // del fornitore dell'ordine se esiste una riga specifica.
      if (p.codiceFornitore) this.righe[index].codiceFornitore = p.codiceFornitore;
      const fornId = this.fornitoreSelezionatoId;
      if (p.id && fornId) {
        this.ds.getProdottoFornitori(p.id).subscribe(list => {
          const m = list.find(x => x.fornitoreId === fornId);
          if (m) {
            this.righe[index].codiceFornitore = m.codiceFornitore || this.righe[index].codiceFornitore;
            if (m.prezzoAcquisto != null) this.righe[index].prezzo = m.prezzoAcquisto;
          }
        });
      }
    }
    if (this.form.get('tipo')?.value === 'CLIENTE') {
      this.applyListino(index);
      this.loadPrezziRecenti(index);
    }
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
  // Scorciatoia: Ctrl/Cmd+Invio salva il documento da qualunque campo.
  @HostListener('keydown', ['$event'])
  onDialogKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.save(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.save(); }
  }

  // Ogni modifica nei campi del dialog marca il documento come "sporco" (modifiche non salvate).
  @HostListener('input')
  @HostListener('change')
  onAnyEdit(): void {
    this.documentDirty.setDirty(true);
  }

  ngOnDestroy(): void {
    this.documentDirty.setDirty(false);
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

  private applyListino(index: number) {
    const riga = this.righe[index];
    const clienteId = this.selectedClienteId;
    if (!clienteId || !riga.prodottoId) return;
    this.ds.resolvePrezzoCliente(clienteId, riga.prodottoId).subscribe(r => {
      if (r.sorgente === 'BASE') return;
      riga.prezzo = r.prezzo;
      riga.sconto = r.sconto;
      if (r.listinoNome) this.snack.open(this.i18n.t('fatture.dialog.msg.prezzoListinoApplicato', { nome: r.listinoNome }), '', { duration: 2200 });
    });
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

  apriCopiaRighe() {
    let data: CopiaRigheDialogData;
    if (this.isFornitore) {
      const fv = this.fornitoreCtrl.value;
      data = {
        fornitoreId: fv && typeof fv !== 'string' ? (fv as Fornitore).id ?? null : null,
        fornitoreNome: fv && typeof fv !== 'string' ? (fv as Fornitore).ragioneSociale : null,
      };
    } else {
      const cv = this.clienteCtrl.value;
      data = {
        clienteId: cv && typeof cv !== 'string' ? (cv as Cliente).id ?? null : null,
        clienteNome: cv && typeof cv !== 'string' ? (cv as Cliente).ragioneSociale : null,
      };
    }
    data.righeCorrenti = this.righe;
    this.matDialog.open(CopiaRigheDialogComponent, { data }).afterClosed().subscribe((righe: RigaDocumento[]) => {
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
  addNota(testo: string) { this.righe.push({ tipo: 'NOTA', descrizione: testo, quantita: 0, prezzo: 0, sconto: 0, iva: 0 }); this.prezziRecenti.push([]); this.prezziRecentiTutti.push([]); this.tuttiCaricati.push(false); }
  removeRiga(i: number) { this.righe.splice(i, 1); this.prezziRecenti.splice(i, 1); this.prezziRecentiTutti.splice(i, 1); this.tuttiCaricati.splice(i, 1); }
  dropRiga(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.righe, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecenti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecentiTutti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.tuttiCaricati, event.previousIndex, event.currentIndex);
  }

  save() {
    if (!this.form.valid) return;
    const cv = this.clienteCtrl.value;
    const fv = this.fornitoreCtrl.value;
    const clienteId = cv && typeof cv !== 'string' ? (cv as Cliente).id ?? null : null;
    const fornitoreId = fv && typeof fv !== 'string' ? (fv as Fornitore).id ?? null : null;
    this.draft.clear(this.draftTipo);
    this.dialogRef.close({ ...this.data, ...this.form.value, clienteId, fornitoreId, righe: this.righe });
  }

  /** Autosalvataggio bozza (solo documento nuovo): ripristino su conferma + salvataggio periodico. */
  private setupBozza() {
    if (this.data?.id) return;
    const bozza = this.draft.load(this.draftTipo);
    const haContenuto = bozza && Array.isArray(bozza.righe) &&
      bozza.righe.some((r: any) => r?.descrizione?.trim() || r?.prodottoId);
    if (haContenuto) {
      this.confirmDraft.ask(this.i18n.t('ordini.dialog.msg.riprendiBozza')).then(ok => {
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

  // Esporta il documento in PDF dal dialog (apre anteprima con bottone "Salva PDF").
  // Visibile solo per ordini già salvati (data?.id presente).
  esportaPdf() {
    if (this.data?.id) this.printSvc.printOrdine(this.data.id);
  }
}

@Component({
  selector: 'app-ordini',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatCheckboxModule, MatMenuModule,
            MatSortModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatPaginatorModule, EmptyStateComponent,
            TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './ordini.html',
  styleUrl: './ordini.scss'
})
export class OrdiniComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allOrdini: Ordine[] = [];
  dataSource = new MatTableDataSource<Ordine>([]);
  displayedColumns = ['select', 'numero', 'dataOrdine', 'controparte', 'totale', 'stato', 'azioni'];
  selection = new SelectionModel<Ordine>(true, []);

  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));
  // Filtri multipli: array vuoto = "tutti" (si possono scegliere più anni/mesi).
  filtroAnni: number[] = [];
  filtroMesi: number[] = [];
  filtroTipi: string[] = [];

  get anni() { return [...new Set(this.allOrdini.map(o => +o.dataOrdine.substring(0, 4)))].sort().reverse(); }
  get ordini() { return this.dataSource.data; }
  /** Somma dei soli documenti selezionati (per la barra totali in fondo alla lista). */
  get totaleSelezione(): number { return this.selection.selected.reduce((s, x) => s + (Number((x as any).totale) || 0), 0); }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, private printSvc: PrintService, public excel: ExcelService, private viewState: ViewStateService) {}

  ngOnInit() {
    // Ripristino filtri/ordinamento salvati (prima di qualunque prefill, che deve poter prevalere).
    const vs = this.viewState.read<any>('ordini');
    if (vs) {
      if (Array.isArray(vs.filtroAnni)) this.filtroAnni = vs.filtroAnni;
      if (Array.isArray(vs.filtroMesi)) this.filtroMesi = vs.filtroMesi;
      if (Array.isArray(vs.filtroTipi)) this.filtroTipi = vs.filtroTipi;
    }
    this.load();
  }

  /** Persiste filtri e ordinamento correnti (pubblico: usato anche dal template su matSortChange). */
  saveViewState(): void {
    this.viewState.write('ordini', {
      filtroAnni: this.filtroAnni,
      filtroMesi: this.filtroMesi,
      filtroTipi: this.filtroTipi,
      sortActive: this.sort?.active ?? null,
      sortDir: this.sort?.direction ?? null,
    });
  }

  // Cmd/Ctrl+N = nuovo ordine (disabilitato quando un dialog è aperto).
  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    const vs = this.viewState.read<any>('ordini');
    if (vs?.sortActive && this.sort) {
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
        case 'dataOrdine': return item.dataOrdine ?? '';
        case 'controparte': return item.clienteNome || item.fornitoreNome || '';
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) => {
      const s = filter.toLowerCase();
      return (item.numero ?? '').toLowerCase().includes(s)
          || (item.clienteNome ?? '').toLowerCase().includes(s)
          || (item.fornitoreNome ?? '').toLowerCase().includes(s)
          || (item.stato ?? '').toLowerCase().includes(s)
          || (item.tipo ?? '').toLowerCase().includes(s);
    };
  }

  load() {
    this.ds.getOrdini().subscribe(o => {
      this.allOrdini = o.filter(x => x.tipo === 'CLIENTE');
      this.applyFilters();
      this.selection.clear();
    });
  }

  applyFilters() {
    let data = this.allOrdini;
    if (this.filtroAnni.length) data = data.filter(o => this.filtroAnni.includes(+o.dataOrdine.substring(0, 4)));
    if (this.filtroMesi.length) data = data.filter(o => this.filtroMesi.includes(+o.dataOrdine.substring(5, 7)));
    if (this.filtroTipi.length) data = data.filter(o => this.filtroTipi.includes(o.tipo));
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
    this.saveViewState();
  }

  resetFiltri() {
    this.filtroAnni = []; this.filtroMesi = []; this.filtroTipi = [];
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
    const body = rows.map(o=>`<tr><td>${o.numero}</td><td>${d(o.dataOrdine)}</td><td>${o.tipo}</td><td>${o.clienteNome||o.fornitoreNome||'—'}</td><td class="r">${e(o.totale)}</td><td>${o.stato}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('ordini.title')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${t('ordini.title')}</h1><table><thead><tr><th>${t('ordini.col.numero')}</th><th>${t('ordini.col.data')}</th><th>${t('ordini.col.tipo')}</th><th>${t('ordini.col.controparte')}</th><th class="r">${t('ordini.col.importo')}</th><th>${t('ordini.col.stato')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('ordini.col.numero'),  field: 'numero',      width: 14 },
    { header: this.i18n.t('ordini.col.data'),    field: 'dataOrdine',  width: 14 },
    { header: this.i18n.t('ordini.col.cliente'), field: 'clienteNome', width: 30 },
    { header: this.i18n.t('ordini.col.importo'), field: 'totale',      width: 14 },
    { header: this.i18n.t('ordini.col.stato'),   field: 'stato',       width: 16 },
  ];
  /** Righe da esportare: le selezionate se ce ne sono, altrimenti tutta la lista. */
  get exportRows(): any[] { return this.selection.hasValue() ? this.selection.selected : this.dataSource.data; }

  get totaleLista(): number {
    return this.dataSource.data.reduce((s, r) => s + (Number((r as any).totale) || 0), 0);
  }

  isAllSelected() { return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  setStato(o: Ordine, stato: string) {
    this.ds.setOrdineStato(o.id!, stato).subscribe({ next: () => this.load(), error: e => this.snack.open(e.message, '', { duration: 3000 }) });
  }
  bulkSetStato(stato: string) {
    const ids = this.selection.selected.map(o => o.id!);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.ds.setOrdineStato(id, stato))).subscribe({
      next: () => { this.selection.clear(); this.load(); },
      error: e => this.snack.open(e?.error?.error || e?.message || this.i18n.t('ordini.msg.erroreStato'), '', { duration: 3000 })
    });
  }

  async bulkElimina() {
    const sel = this.selection.selected;
    if (!sel.length) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('ordini.msg.confermaEliminaBulk', n))) return;
    forkJoin(sel.map(o => this.ds.getOrdineById(o.id!).pipe(catchError(() => of(null))))).subscribe(fulls => {
      const backups = fulls.filter(Boolean);
      forkJoin(sel.map(o => this.ds.deleteOrdine(o.id!).pipe(catchError(err => of({ __error: err }))))).subscribe(results => {
        const errori = results.filter((r: any) => r && r.__error).length;
        this.selection.clear();
        this.load();
        const msg = errori ? this.i18n.t('ordini.msg.eliminatiParziali', { ok: n - errori, errori }) : this.i18n.tn('ordini.msg.eliminatiBulk', n);
        const ref = this.snack.open(msg, this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createOrdine(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('ordini.msg.ripristinatiBulk'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      });
    });
  }

  open(o?: Ordine) {
    const numeriEsistenti = this.allOrdini.filter(x => x.id !== o?.id).map(x => x.numero);
    const ref = this.dialog.open(OrdineDialogComponent, {
      data: { tipo: 'CLIENTE', ...(o ?? {}), numeriEsistenti }, width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateOrdine(result) : this.ds.createOrdine(result);
      op.subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('ordini.msg.salvato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' })
      });
    });
  }

  printDoc(o: Ordine) { this.printSvc.printOrdine(o.id!); }

  inviaEmail(o: Ordine) {
    const isFornitore = o.tipo === 'FORNITORE';
    const sources: any = isFornitore
      ? forkJoin({ az: this.ds.getAzienda(), parti: this.ds.getFornitori() })
      : forkJoin({ az: this.ds.getAzienda(), parti: this.ds.getClienti() });
    sources.subscribe((r: { az: any; parti: any[] }) => {
      const { az, parti } = r;
      const parte: any = parti.find((p: any) => p.id === (isFornitore ? o.fornitoreId : o.clienteId));
      const ref = this.dialog.open(EmailDialogComponent, {
        width: '560px', maxWidth: '95vw',
        data: {
          title: this.i18n.t('ordini.msg.inviaTitolo', { numero: o.numero }),
          subtitle: parte?.ragioneSociale ? this.i18n.t('preventivi.msg.aCliente', { nome: parte.ragioneSociale }) : undefined,
          destinatario: parte?.email || '',
          testo: az?.emailCorpoDocumento || '',
        },
      });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.sendOrdineEmail(o.id!, result.destinatario, result.testo || undefined).subscribe({
          next: () => this.snack.open(this.i18n.t('preventivi.msg.emailInviata'), '', { duration: 2000 }),
          error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreEmail', { msg: e.error?.error || e.message }), '', { duration: 4000 })
        });
      });
    });
  }

  async convertiInDdt(o: Ordine) {
    if (!await this.confirm.ask(this.i18n.t('ordini.msg.confermaConvertiDdt', { numero: o.numero }))) return;
    this.ds.ordineToDD(o.id!).subscribe({
      next: r => { this.load(); this.snack.open(this.i18n.t('ordini.msg.ddtCreato', { numero: r.numero }), '', { duration: 3000 }); },
      error: e => this.snack.open(e.message || this.i18n.t('ordini.msg.erroreConversione'), '', { duration: 3000 }),
    });
  }

  // ── Conversione massiva: ordini selezionati -> DDT ──────────────────────────
  async bulkConvertiInDdt() {
    const sel = this.selection.selected.slice();
    if (!sel.length) return;
    if (!await this.confirm.ask(this.i18n.t('ordini.msg.confermaBulkDdt', { n: sel.length }))) return;
    forkJoin(sel.map(o => this.ds.ordineToDD(o.id!).pipe(catchError(() => of(null)))))
      .subscribe((res: any[]) => {
        const ok = res.filter(Boolean).length;
        this.selection.clear();
        this.load();
        const falliti = sel.length - ok;
        const msg = this.i18n.tn('preventivi.msg.creatiDdt', ok) + (falliti ? this.i18n.t('preventivi.msg.nonConvertiti', { n: falliti }) : '');
        this.snack.open(msg, '', { duration: 4000 });
      });
  }

  info(o: Ordine) {
    this.ds.getOrdinePrint(o.id!).subscribe(doc => {
      const isCliente = o.tipo === 'CLIENTE';
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      const cp = isCliente ? doc.cliente : doc.fornitore;
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: 'ORDINE', sottotitolo: this.i18n.t(isCliente ? 'ordini.dialog.chipOrdineCliente' : 'ordini.dialog.chipOrdineFornitore'),
          numero: doc.numero, data: doc.dataOrdine, stato: doc.stato,
          controparteLabel: this.i18n.t(isCliente ? 'preventivi.info.clienteLabel' : 'acquisti.info.fornitore'),
          controparte: cp?.ragioneSociale || (isCliente ? o.clienteNome : o.fornitoreNome) || '—',
          controparteInfo: cp ? [
            [cp.via, [cp.cap, cp.citta].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            cp.pIva ? `P.IVA: ${cp.pIva}` : '',
          ].filter(Boolean) as string[] : [],
          totale: imponibile + ivaT, imponibile, righe,
          note: doc.note,
        } as DocInfoData,
        width: '720px', maxWidth: '98vw', maxHeight: '92vh',
      });
    });
  }

  async delete(o: Ordine) {
    if (!await this.confirm.delete(this.i18n.t('ordini.msg.confermaElimina', { numero: o.numero }))) return;
    this.ds.getOrdineById(o.id!).subscribe(full => {
      this.ds.deleteOrdine(o.id!).subscribe(() => {
        this.load();
        const ref = this.snack.open(this.i18n.t('ordini.msg.eliminato', { numero: o.numero }), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          const { id, ...payload } = full as any;
          this.ds.createOrdine(payload).subscribe({
            next: () => { this.load(); this.snack.open(this.i18n.t('ordini.msg.ripristinato'), '', { duration: 2000, panelClass: 'snack-ok' }); },
            error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreRipristino', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
          });
        });
      });
    });
  }
}
