import { inject, Component, OnInit, OnDestroy, AfterViewInit, Inject, ViewChild, ViewChildren, QueryList, ElementRef, HostListener, DestroyRef } from '@angular/core';
import { RIGHE_STYLES } from '../shared/righe-styles';
import { ConfirmService } from '../shared/confirm-dialog';
import { DraftService } from '../../services/draft.service';
import { EmptyStateComponent } from '../shared/empty-state';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
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
import { Preventivo, Cliente, Prodotto, RigaDocumento, UnitaMisura, NotaRapida } from '../../models';
import { consumePrefill } from '../../utils/nav-prefill';
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
import { DocumentDirtyService } from '../../services/document-dirty.service';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

@Component({
  selector: 'app-preventivo-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSlideToggleModule,
            MatAutocompleteModule, MatIconModule, MatButtonToggleModule, MatMenuModule, MatTooltipModule, DragDropModule, TPipe, TnPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon">
          <mat-icon>request_quote</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">
            {{ data?.id ? i18n.t('preventivi.dialog.titoloEsistente', { numero: data?.numero || '' }) : ('preventivi.nuovo' | t) }}
            @if (data?.id && locked) {
              <span class="dialog-lock-chip"><mat-icon>lock</mat-icon>{{ 'fatture.dialog.bloccato' | t }}</span>
            }
          </span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'preventivi.dialog.subEsistente' : 'preventivi.dialog.subNuovo') | t }}</span>
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
              <mat-label>{{ 'fatture.dialog.cliente' | t }}</mat-label>
              <input matInput [matAutocomplete]="autoCliente" [formControl]="clienteCtrl"
                     (keyup.enter)="autoSelectCliente()" [placeholder]="'preventivi.dialog.cercaClientePh' | t"
                     [class.input-error]="submitted && !hasCliente">
              <mat-icon matSuffix>search</mat-icon>
              <mat-autocomplete #autoCliente="matAutocomplete" [displayWith]="displayCliente">
                @for (c of filteredClienti; track c.id) {
                  <mat-option [value]="c">{{ c.ragioneSociale }}</mat-option>
                }
              </mat-autocomplete>
              @if (submitted && !hasCliente) {
                <mat-error>{{ 'fatture.dialog.selezionaCliente' | t }}</mat-error>
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
            <mat-form-field>
              <mat-label>{{ 'preventivi.dialog.validita' | t }}</mat-label>
              <input matInput type="number" formControlName="validita">
              <mat-icon matSuffix>schedule</mat-icon>
            </mat-form-field>
          </div>
        </div>

        <div class="form-section">
          <div class="righe-header">
            <div class="righe-header-title">
              <span>{{ 'fatture.dialog.righe' | t }}</span>
              @if (submitted && !hasRighe) {
                <span class="righe-error"><mat-icon>error_outline</mat-icon> {{ 'fatture.dialog.aggiungiRigaAlmeno' | t }}</span>
              }
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
          <div class="righe-scroll">
          <table class="righe-table">
          <thead>
            <tr>
              <th class="td-drag"></th>
              <th class="td-desc">{{ 'fatture.dialog.colCodiceDescrizione' | t }}</th>
              <th class="td-search"></th>
              <th class="td-qta">{{ 'fatture.dialog.colQta' | t }}</th>
              <th class="td-um">{{ 'fatture.dialog.colUm' | t }}</th>
              <th class="td-prezzo">{{ (showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t }}</th>
              <th class="td-history"></th>
              <th class="td-sconto">{{ 'fatture.dialog.colSconto' | t }}</th>
              <th class="td-iva">{{ 'preventivi.dialog.colIva' | t }}</th>
              <th class="td-totale">{{ (showNetto ? 'fatture.dialog.colTotaleNetto' : 'fatture.dialog.colTotaleIvato') | t }}</th>
              <th class="td-actions"></th>
            </tr>
          </thead>
          <tbody cdkDropList (cdkDropListDropped)="dropRiga($event)">
            @for (riga of righe; track $index; let rowIdx = $index) {
              @if (riga.tipo === 'NOTA') {
                <tr class="riga-nota" cdkDrag cdkDragPreviewContainer="parent">
                  <td class="td-drag" cdkDragHandle><mat-icon>drag_indicator</mat-icon></td>
                  <td class="td-nota" colspan="9">
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
                <td class="td-prezzo" [attr.data-label]="(showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t"><input class="riga-input" type="number" min="0" [step]="prezzoFmt.step()"
                  [value]="showNetto ? riga.prezzo : +(riga.prezzo * (1 + riga.iva/100)).toFixed(prezzoFmt.decimali())"
                  (change)="setPrezzoFromInput(riga, $event)"></td>
                <td class="td-history">
                  @if (prezziRecenti[$index]?.length) {
                    <button mat-icon-button type="button" [title]="'fatture.dialog.prezziRecentiClienteTooltip' | t" [matMenuTriggerFor]="menuPrezzi">
                      <mat-icon class="icon-primary">history</mat-icon>
                    </button>
                    <mat-menu #menuPrezzi="matMenu">
                      <div class="menu-section-label">{{ 'fatture.dialog.prezziRecenti' | t }}</div>
                      @for (pr of prezziRecenti[rowIdx]; track $index) {
                        <button mat-menu-item type="button" (click)="usaPrezzo(rowIdx, pr.prezzo, pr.sconto)">
                          <span class="pr-meta">{{ pr.tipo }} {{ pr.numero }} — {{ pr.dataEmissione | date:'dd/MM/yy' }}</span>
                          <b class="pr-value">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</b>
                          @if (pr.sconto) { <span class="pr-discount">(-{{ pr.sconto }}%)</span> }
                        </button>
                      }
                    </mat-menu>
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
                <td class="td-sconto" [attr.data-label]="'fatture.dialog.colSconto' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.sconto" (change)="clampSconto(riga)" placeholder="0"></td>
                <td class="td-iva" [attr.data-label]="'preventivi.dialog.colIva' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.iva"></td>
                <td class="td-totale" [attr.data-label]="'fatture.dialog.totale' | t">
                  {{ rigaTotale(riga) | currency:'EUR':'symbol':'1.2-2':'it' }}
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
      </div>

      <div class="doc-totals-strip">
        <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
        <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
        <span class="totals-spacer"></span>
        <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
      </div>

      <div class="margine-strip">
        <div class="margine-head">
          <mat-icon>visibility_off</mat-icon>
          <span>{{ 'preventivi.dialog.soloUsoInterno' | t }}</span>
          @if (righeSenzaCosto > 0) {
            <mat-icon class="margine-warn" [matTooltip]="i18n.t('preventivi.dialog.margineParziale', { n: righeSenzaCosto })">info_outline</mat-icon>
          }
        </div>
        <div class="margine-stats">
          <div class="margine-stat">
            <span class="margine-stat-label">{{ 'preventivi.dialog.costo' | t }}</span>
            <span class="margine-stat-value">{{ costoTotale | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
          </div>
          <div class="margine-stat">
            <span class="margine-stat-label">{{ 'preventivi.dialog.guadagno' | t }}</span>
            <span class="margine-stat-value" [style.color]="guadagnoColor">{{ guadagno | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
          </div>
          <div class="margine-stat">
            <span class="margine-stat-label">{{ 'preventivi.dialog.margine' | t }}</span>
            <span class="margine-stat-value" [style.color]="guadagnoColor">{{ marginePerc !== null ? (marginePerc | number:'1.0-1') + '%' : '—' }}</span>
          </div>
        </div>
      </div>

      <div class="form-section is-flat" [formGroup]="form">
        <div class="form-section-header"><mat-icon>picture_as_pdf</mat-icon><span>{{ 'preventivi.dialog.opzioniStampa' | t }}</span></div>
        <mat-slide-toggle formControlName="stampaImmagini">
          {{ 'preventivi.dialog.mostraImmagini' | t }}
        </mat-slide-toggle>
        <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px">
          {{ 'preventivi.dialog.miniatureHint' | t }}
        </div>
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
      <button mat-flat-button (click)="save()" [disabled]="locked || form.get('numero')?.hasError('numeroDuplicato')"
              [matTooltip]="locked ? ('fatture.dialog.sbloccaTooltip' | t) : (form.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : '')">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [RIGHE_STYLES, `
    .margine-strip {
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      margin: 10px 0 0; padding: 12px 18px;
      border: 1px dashed var(--border-strong); border-radius: var(--radius-md);
      background: var(--bg-surface-2);
    }
    .margine-head {
      display: flex; align-items: center; gap: 8px; margin-right: auto;
      color: var(--text-tertiary);
    }
    .margine-head > mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .margine-head > span {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; white-space: nowrap;
    }
    .margine-stats { display: flex; align-items: stretch; }
    .margine-stat {
      display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
      padding: 2px 22px; border-left: 1px solid var(--border);
    }
    .margine-stat:first-child { border-left: none; padding-left: 0; }
    .margine-stat:last-child { padding-right: 0; }
    .margine-stat-label {
      font-size: 10.5px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-tertiary);
    }
    .margine-stat-value {
      font-size: 15px; font-weight: 700; color: var(--text-primary);
      font-variant-numeric: tabular-nums; line-height: 1.2;
    }
    .margine-warn { font-size: 17px; width: 17px; height: 17px; color: #f59e0b; cursor: help; }
    @media (max-width: 767px) {
      .margine-strip { padding: 10px 14px; gap: 10px; }
      .margine-stats { width: 100%; }
      .margine-stat { flex: 1; padding: 2px 10px; }
      .margine-stat:first-child { align-items: flex-start; }
    }
  `]
})
export class PreventivoDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
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
  private readonly draftTipo = 'preventivi';
  righe: RigaDocumento[] = [];
  noteRapideList: NotaRapida[] = [];
  prodotti: Prodotto[] = [];
  unitaMisura: UnitaMisura[] = [];
  prezziRecenti: any[][] = [];
  prezziRecentiTutti: any[][] = [];
  tuttiCaricati: boolean[] = [];
  readonly isNew: boolean;

  submitted = false;
  get hasCliente(): boolean { const v = this.clienteCtrl.value; return !!(v && typeof v !== 'string'); }
  get hasRighe(): boolean { return this.righe.length > 0 && this.righe.some(r => r.descrizione?.trim()); }
  get canSave(): boolean { return this.form.valid && this.hasCliente && this.hasRighe; }

  get clienteId(): number | null {
    const v = this.clienteCtrl.value;
    return v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
  }

  showNetto = false;
  get imponibile() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0); }
  get ivaTotal() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0); }
  get totale() { return this.imponibile + this.ivaTotal; }

  // ── Margine interno (solo a video, non stampato) ────────────────────────────
  private costoById = new Map<number, number>();
  /** Costo totale (prezzo d'acquisto × quantità) delle righe con prezzo d'acquisto noto. */
  get costoTotale() {
    return this.righe.reduce((s, r) => {
      const c = r.prodottoId != null ? this.costoById.get(r.prodottoId) : undefined;
      return s + (c != null ? c * (r.quantita ?? 0) : 0);
    }, 0);
  }
  /** Quante righe vendibili non hanno un prezzo d'acquisto noto (margine parziale). */
  get righeSenzaCosto() {
    return this.righe.filter(r => (r.quantita ?? 0) > 0 && r.prezzo > 0
      && (r.prodottoId == null || this.costoById.get(r.prodottoId) == null)).length;
  }
  get guadagno() { return this.imponibile - this.costoTotale; }
  get marginePerc(): number | null { return this.imponibile > 0 ? (this.guadagno / this.imponibile) * 100 : null; }
  get guadagnoColor(): string {
    const m = this.marginePerc;
    if (m === null) return 'var(--text-secondary)';
    if (m < 0) return '#dc2626';
    if (m < 15) return '#f97316';
    return '#16a34a';
  }
  rigaTotale(riga: RigaDocumento) {
    return docRigaTotale(riga, this.showNetto);
  }
  setPrezzoFromInput(riga: RigaDocumento, event: Event) {
    const v = +(event.target as HTMLInputElement).value;
    riga.prezzo = prezzoNettoDaInput(v, riga.iva, this.showNetto, this.prezzoFmt.decimali());
  }

  loadPrezziRecenti(index: number) {
    const riga = this.righe[index];
    if (!riga.prodottoId) return;
    this.ds.getPrezziRecenti(riga.prodottoId, this.clienteId).subscribe(prezzi => {
      this.prezziRecenti[index] = prezzi;
    });
  }

  loadTuttiPrezzi(index: number, prodottoId: number | null) {
    if (!prodottoId || this.tuttiCaricati[index]) return;
    this.tuttiCaricati[index] = true;
    this.ds.getPrezziRecenti(prodottoId, null).subscribe({
      next: p => {
        const cid = this.clienteId ?? null;
        this.prezziRecentiTutti[index] = cid ? p.filter((x: any) => x.clienteId !== cid) : p;
      },
      error: () => { this.prezziRecentiTutti[index] = []; }
    });
  }

  usaPrezzo(index: number, prezzo: number, sconto: number) {
    this.righe[index].prezzo = prezzo;
    this.righe[index].sconto = sconto;
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    private snack: MatSnackBar,
    private printSvcDialog: PrintService,
    private docLockSvc: DocLockService,
    public dialogRef: MatDialogRef<PreventivoDialogComponent>,
    private documentDirty: DocumentDirtyService,
    @Inject(MAT_DIALOG_DATA) public data: Preventivo | null
  ) {
    this.isNew = !data?.id;
    this.locked = !!data?.id && this.docLockSvc.enabled;
    this.numeriEsistenti = setNumeriEsistenti((data as any)?.numeriEsistenti);
    this.form = this.fb.group({
      numero: [data?.numero ?? '', [Validators.required, numeroUnivocoValidator(() => this.numeriEsistenti)]],
      dataEmissione: [data?.dataEmissione ?? new Date().toISOString().substring(0, 10), Validators.required],
      validita: [data?.validita ?? 30],
      note: [data?.note ?? ''],
      stampaImmagini: [data?.stampaImmagini ?? true],
    });
    if (data?.id) {
      this.ds.getPreventivoById(data.id).subscribe(p => { this.righe = p.righe ?? []; this.prezziRecenti = new Array(this.righe.length).fill([]); this.prezziRecentiTutti = new Array(this.righe.length).fill([]); this.tuttiCaricati = new Array(this.righe.length).fill(false); this.righe.forEach((r, i) => { if (r.prodottoId) this.loadPrezziRecenti(i); }); });
    } else {
      this.righe = [{ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22 }];
      this.prezziRecenti = [[]];
      this.prezziRecentiTutti = [[]];
      this.tuttiCaricati = [false];
    }
  }

  ngOnInit() {
    this.setupBozza();
    this.clienteCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredClienti = this.clienti.filter(c => c.ragioneSociale.toLowerCase().includes(q));
    });

    this.ds.getClienti().subscribe(c => {
      this.clienti = c;
      this.filteredClienti = c;
      if (this.data?.clienteId) {
        const found = c.find(x => x.id === this.data!.clienteId);
        if (found) this.clienteCtrl.setValue(found, { emitEvent: false });
      }
    });

    this.ds.getProdotti().subscribe(p => {
      this.prodotti = p;
      this.costoById = new Map(p.filter(x => x.id != null && x.prezzoAcquisto != null).map(x => [x.id!, x.prezzoAcquisto!]));
    });
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getNoteRapide().subscribe(n => this.noteRapideList = n);

    if (this.isNew) {
      this.ds.getNextNumero('preventivi').subscribe(n => this.form.patchValue({ numero: String(n.numero) }));
    }
  }

  displayCliente(c: Cliente | string | null): string {
    return c && typeof c !== 'string' ? (c as Cliente).ragioneSociale : '';
  }

  autoSelectCliente() {
    if (this.filteredClienti.length > 0) this.clienteCtrl.setValue(this.filteredClienti[0]);
  }

  private applyListino(index: number) {
    const riga = this.righe[index];
    if (!this.clienteId || !riga.prodottoId) return;
    this.ds.resolvePrezzoCliente(this.clienteId, riga.prodottoId).subscribe(r => {
      if (r.sorgente === 'BASE') return;
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
  // Scorciatoia: Ctrl/Cmd+Invio salva il documento da qualunque campo.
  @HostListener('keydown', ['$event'])
  onDialogKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.save(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.save(); }
  }

  /** Ogni modifica nei campi del dialog marca il documento come "sporco". */
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

  addRiga() {
    this.righe.push({ tipo: 'PRODOTTO', descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22 });
    this.prezziRecenti.push([]);
    this.prezziRecentiTutti.push([]);
    this.tuttiCaricati.push(false);
    scrollFocusLastRiga(this.codiceInputs);
  }
  addNota(testo: string) {
    this.righe.push({ tipo: 'NOTA', descrizione: testo, quantita: 0, prezzo: 0, sconto: 0, iva: 0 });
    this.prezziRecenti.push([]);
    this.prezziRecentiTutti.push([]);
    this.tuttiCaricati.push(false);
  }
  removeRiga(i: number) { this.righe.splice(i, 1); this.prezziRecenti.splice(i, 1); this.prezziRecentiTutti.splice(i, 1); this.tuttiCaricati.splice(i, 1); }
  dropRiga(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.righe, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecenti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.prezziRecentiTutti, event.previousIndex, event.currentIndex);
    moveItemInArray(this.tuttiCaricati, event.previousIndex, event.currentIndex);
  }

  printFromDialog() {
    if (this.data?.id) {
      // Anteprima con il toggle immagini corrente, anche se non ancora salvato.
      this.printSvcDialog.printPreventivo(this.data.id, { stampaImmagini: this.form.value.stampaImmagini });
    }
  }

  save() {
    this.submitted = true;
    if (!this.canSave) return;
    const v = this.clienteCtrl.value;
    const clienteId = v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
    this.draft.clear(this.draftTipo);
    this.dialogRef.close({ ...this.data, ...this.form.value, clienteId, righe: this.righe });
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
  selector: 'app-preventivi',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
            MatSelectModule, MatPaginatorModule, MatMenuModule, EmptyStateComponent, TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './preventivi.html',
  styleUrl: './preventivi.scss'
})
export class PreventiviComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private viewState = inject(ViewStateService);
  private allPreventivi: Preventivo[] = [];
  dataSource = new MatTableDataSource<Preventivo>();
  displayedColumns = ['select', 'numero', 'dataEmissione', 'clienteNome', 'totale', 'stato', 'azioni'];
  selection = new SelectionModel<Preventivo>(true, []);

  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));
  // Filtri multipli: array vuoto = "tutti" (si possono scegliere più anni/mesi/clienti).
  filtroAnni: number[] = [];
  filtroMesi: number[] = [];
  filtroClienti: number[] = [];

  get anni() { return [...new Set(this.allPreventivi.map(p => +p.dataEmissione.substring(0, 4)))].sort().reverse(); }
  get clientiList() {
    const map = new Map<number, string>();
    this.allPreventivi.forEach(p => { if (p.clienteId) map.set(p.clienteId, p.clienteNome ?? ''); });
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  get preventivi() { return this.dataSource.data; }
  /** Somma dei soli documenti selezionati (per la barra totali in fondo alla lista). */
  get totaleSelezione(): number { return this.selection.selected.reduce((s, x) => s + (Number((x as any).totale) || 0), 0); }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, private printSvc: PrintService, public excel: ExcelService) {}

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  ngOnInit() {
    // Ripristino filtri/ordinamento salvati (prima di prefill, così il prefill può sovrascrivere).
    const vs = this.viewState.read<any>('preventivi');
    if (vs) {
      if (Array.isArray(vs.filtroAnni)) this.filtroAnni = vs.filtroAnni;
      if (Array.isArray(vs.filtroMesi)) this.filtroMesi = vs.filtroMesi;
      if (Array.isArray(vs.filtroClienti)) this.filtroClienti = vs.filtroClienti;
    }
    this.load();
    const bozza = consumePrefill('nuovaBozza');
    if (bozza) setTimeout(() => this.open(bozza as Preventivo), 0);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    const vs = this.viewState.read<any>('preventivi');
    if (vs?.sortActive && this.sort) {
      this.sort.active = vs.sortActive;
      this.sort.direction = vs.sortDir ?? '';
      this.dataSource.sort = this.sort;
    }
    this.dataSource.paginator = this.paginator;
    this.dataSource.sortingDataAccessor = (item, prop) => {
      switch (prop) {
        case 'numero': {
          const n = item.numero || '';
          const slash = n.match(/^(\d+)\/(\d+)$/);
          if (slash) return parseInt(slash[1], 10) * 100000 + parseInt(slash[2], 10);
          const plain = n.match(/(\d+)/);
          return plain ? parseInt(plain[1], 10) : 0;
        }
        case 'totale': return item.totale ?? 0;
        case 'dataEmissione': return item.dataEmissione ?? '';
        default: return (item as any)[prop] ?? '';
      }
    };
    this.dataSource.filterPredicate = (data, filter) =>
      [data.numero, data.clienteNome, data.stato].some(v => v?.toLowerCase().includes(filter));
  }

  load() {
    this.ds.getPreventivi().subscribe(p => { this.allPreventivi = p; this.applyFilters(); this.selection.clear(); });
  }

  applyFilters() {
    let data = this.allPreventivi;
    if (this.filtroAnni.length) data = data.filter(p => this.filtroAnni.includes(+p.dataEmissione.substring(0, 4)));
    if (this.filtroMesi.length) data = data.filter(p => this.filtroMesi.includes(+p.dataEmissione.substring(5, 7)));
    if (this.filtroClienti.length) data = data.filter(p => p.clienteId != null && this.filtroClienti.includes(p.clienteId));
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
    this.saveViewState();
  }

  /** Persiste filtri e ordinamento tra le sessioni (sezione 'preventivi'). */
  saveViewState(): void {
    this.viewState.write('preventivi', {
      filtroAnni: this.filtroAnni,
      filtroMesi: this.filtroMesi,
      filtroClienti: this.filtroClienti,
      sortActive: this.sort?.active ?? null,
      sortDir: this.sort?.direction ?? null,
    });
  }

  resetFiltri() {
    this.filtroAnni = []; this.filtroMesi = []; this.filtroClienti = [];
    this.dataSource.filter = ''; this.applyFilters();
    this.saveViewState();
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim().toLowerCase();
  }

  print() {
    const t = (k: string) => this.i18n.t(k);
    const rows = this.selection.hasValue() ? this.selection.selected : this.dataSource.data;
    const d = (s: string) => { const p = (s||'').substring(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:'—'; };
    const e = (n: number|undefined) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n??0);
    const body = rows.map(p=>`<tr><td>${p.numero}</td><td>${d(p.dataEmissione)}</td><td>${p.clienteNome||'—'}</td><td class="r">${e(p.totale)}</td><td>${p.stato}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('preventivi.title')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${t('preventivi.title')}</h1><table><thead><tr><th>${t('preventivi.col.numero')}</th><th>${t('preventivi.col.data')}</th><th>${t('preventivi.col.cliente')}</th><th class="r">${t('preventivi.col.importo')}</th><th>${t('preventivi.col.stato')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('preventivi.col.numero'),  field: 'numero',        width: 14 },
    { header: this.i18n.t('preventivi.col.data'),    field: 'dataEmissione', width: 14 },
    { header: this.i18n.t('preventivi.col.cliente'), field: 'clienteNome',   width: 30 },
    { header: this.i18n.t('preventivi.col.importo'), field: 'totale',        width: 14 },
    { header: this.i18n.t('preventivi.col.stato'),   field: 'stato',         width: 14 },
  ];
  /** Righe da esportare: le selezionate se ce ne sono, altrimenti tutta la lista. */
  get exportRows(): any[] { return this.selection.hasValue() ? this.selection.selected : this.dataSource.data; }

  get totaleLista(): number { return this.dataSource.data.reduce((s, r) => s + (Number((r as any).totale) || 0), 0); }

  isAllSelected() { return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  setStato(p: Preventivo, stato: string) {
    this.ds.setPreventivoStato(p.id!, stato).subscribe({ next: () => this.load(), error: e => this.snack.open(e.message, '', { duration: 3000 }) });
  }
  bulkSetStato(stato: string) {
    const ids = this.selection.selected.map(p => p.id!);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.ds.setPreventivoStato(id, stato))).subscribe({
      next: () => { this.selection.clear(); this.load(); },
      error: e => this.snack.open(e?.error?.error || e?.message || this.i18n.t('preventivi.msg.erroreStato'), '', { duration: 3000 })
    });
  }

  async bulkElimina() {
    const sel = this.selection.selected;
    if (!sel.length) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('preventivi.msg.confermaEliminaBulk', n))) return;
    forkJoin(sel.map(p => this.ds.getPreventivoById(p.id!).pipe(catchError(() => of(null))))).subscribe(fulls => {
      const backups = fulls.filter(Boolean);
      forkJoin(sel.map(p => this.ds.deletePreventivo(p.id!).pipe(catchError(err => of({ __error: err }))))).subscribe(results => {
        const errori = results.filter((r: any) => r && r.__error).length;
        this.selection.clear();
        this.load();
        const msg = errori ? this.i18n.t('preventivi.msg.eliminatiParziali', { ok: n - errori, errori }) : this.i18n.tn('preventivi.msg.eliminatiBulk', n);
        const ref = this.snack.open(msg, this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createPreventivo(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('preventivi.msg.ripristinatiBulk'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      });
    });
  }

  open(p?: Preventivo) {
    const numeriEsistenti = this.allPreventivi.filter(x => x.id !== p?.id).map(x => x.numero);
    const ref = this.dialog.open(PreventivoDialogComponent, {
      data: { ...(p ?? {}), numeriEsistenti }, width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updatePreventivo(result) : this.ds.createPreventivo(result);
      op.subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('preventivi.msg.salvato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' })
      });
    });
  }

  printDoc(p: Preventivo) { this.printSvc.printPreventivo(p.id!); }

  inviaEmail(p: Preventivo) {
    forkJoin({ az: this.ds.getAzienda(), clienti: this.ds.getClienti() }).subscribe(({ az, clienti }) => {
      const cliente = clienti.find(c => c.id === p.clienteId);
      const ref = this.dialog.open(EmailDialogComponent, {
        width: '560px', maxWidth: '95vw',
        data: {
          title: this.i18n.t('preventivi.msg.inviaTitolo', { numero: p.numero }),
          subtitle: cliente?.ragioneSociale ? this.i18n.t('preventivi.msg.aCliente', { nome: cliente.ragioneSociale }) : undefined,
          destinatario: cliente?.email || '',
          testo: az?.emailCorpoDocumento || '',
        },
      });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.sendPreventivoEmail(p.id!, result.destinatario, result.testo || undefined).subscribe({
          next: () => this.snack.open(this.i18n.t('preventivi.msg.emailInviata'), '', { duration: 2000 }),
          error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreEmail', { msg: e.error?.error || e.message }), '', { duration: 4000 })
        });
      });
    });
  }

  async convertiInDdt(p: Preventivo) {
    if (!await this.confirm.ask(this.i18n.t('preventivi.msg.confermaConvertiDdt', { numero: p.numero }))) return;
    this.ds.preventivoToDdt(p.id!).subscribe({
      next: r => { this.load(); this.snack.open(this.i18n.t('preventivi.msg.ddtCreato', { numero: r.numero }), '', { duration: 3000 }); },
      error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
    });
  }

  async convertiInOrdine(p: Preventivo) {
    if (!await this.confirm.ask(this.i18n.t('preventivi.msg.confermaConvertiOrdine', { numero: p.numero }))) return;
    this.ds.preventivoToOrdine(p.id!).subscribe({
      next: r => { this.load(); this.snack.open(this.i18n.t('preventivi.msg.ordineCreato', { numero: r.numero }), '', { duration: 3000 }); },
      error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
    });
  }

  // ── Conversione massiva (multi-selezione) ───────────────────────────────────
  async bulkConvertiInOrdine() {
    const sel = this.selection.selected.slice();
    if (!sel.length) return;
    if (!await this.confirm.ask(this.i18n.t('preventivi.msg.confermaBulkOrdine', { n: sel.length }))) return;
    forkJoin(sel.map(p => this.ds.preventivoToOrdine(p.id!).pipe(catchError(() => of(null)))))
      .subscribe((res: any[]) => this.fineBulk(res, sel.length, 'preventivi.msg.creatiOrdine'));
  }
  async bulkConvertiInDdt() {
    const sel = this.selection.selected.slice();
    if (!sel.length) return;
    if (!await this.confirm.ask(this.i18n.t('preventivi.msg.confermaBulkDdt', { n: sel.length }))) return;
    forkJoin(sel.map(p => this.ds.preventivoToDdt(p.id!).pipe(catchError(() => of(null)))))
      .subscribe((res: any[]) => this.fineBulk(res, sel.length, 'preventivi.msg.creatiDdt'));
  }
  private fineBulk(res: any[], tot: number, keyBase: string) {
    const ok = res.filter(Boolean).length;
    this.selection.clear();
    this.load();
    const falliti = tot - ok;
    const msg = this.i18n.tn(keyBase, ok) + (falliti ? this.i18n.t('preventivi.msg.nonConvertiti', { n: falliti }) : '');
    this.snack.open(msg, '', { duration: 4000 });
  }

  info(p: Preventivo) {
    this.ds.getPreventivoePrint(p.id!).subscribe(doc => {
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      const extra: { label: string; value: string }[] = [
        { label: this.i18n.t('preventivi.info.validitaLabel'), value: this.i18n.tn('preventivi.info.giorni', doc.validita ?? 30) },
      ];
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: 'PREVENTIVO', numero: doc.numero, data: doc.dataEmissione, stato: doc.stato,
          controparteLabel: this.i18n.t('preventivi.info.clienteLabel'),
          controparte: doc.cliente?.ragioneSociale || p.clienteNome || '—',
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

  /** Id dei preventivi in corso di duplicazione: evita un doppio clic rapido sul
   *  kebab → "Duplica" (il menu si chiude subito, quindi non basta disabilitare
   *  il bottone) che creerebbe due copie dello stesso preventivo. */
  private duplicating = new Set<number>();

  duplicate(p: Preventivo) {
    if (!p.id || this.duplicating.has(p.id)) return;
    this.duplicating.add(p.id);
    const fine = () => this.duplicating.delete(p.id!);
    forkJoin({ full: this.ds.getPreventivoById(p.id!), num: this.ds.getNextNumero('preventivi') }).subscribe({
      next: ({ full, num }) => {
        const { id, ...pre } = full as any;
        pre.numero = String(num.numero);
        pre.dataEmissione = new Date().toISOString().substring(0, 10);
        pre.stato = 'INVIATO';
        this.ds.createPreventivo(pre).subscribe({
          next: () => { fine(); this.load(); this.snack.open(this.i18n.t('preventivi.msg.duplicato', { numero: pre.numero }), '', { duration: 2500, panelClass: 'snack-ok' }); },
          error: e => { fine(); this.snack.open(e.message || this.i18n.t('preventivi.msg.erroreDuplicazione'), 'OK', { duration: 4000, panelClass: 'snack-error' }); }
        });
      },
      error: e => { fine(); this.snack.open(this.i18n.t('preventivi.msg.erroreGenerico', { msg: e.message || '' }), 'OK', { duration: 4000 }); }
    });
  }

  async delete(p: Preventivo) {
    if (!await this.confirm.delete(this.i18n.t('preventivi.msg.confermaElimina', { numero: p.numero }))) return;
    this.ds.getPreventivoById(p.id!).subscribe(full => {
      this.ds.deletePreventivo(p.id!).subscribe(() => {
        this.load();
        const ref = this.snack.open(this.i18n.t('preventivi.msg.eliminato', { numero: p.numero }), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          const { id, ...payload } = full as any;
          this.ds.createPreventivo(payload).subscribe({
            next: () => { this.load(); this.snack.open(this.i18n.t('preventivi.msg.ripristinato'), '', { duration: 2000, panelClass: 'snack-ok' }); },
            error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreRipristino', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
          });
        });
      });
    });
  }
}
