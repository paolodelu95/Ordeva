import { inject, Component, OnInit, OnDestroy, AfterViewInit, Inject, ChangeDetectorRef, ViewChild, ViewChildren, QueryList, ElementRef, HostListener, DestroyRef } from '@angular/core';
import { DraftService } from '../../services/draft.service';
import { environment } from '../../../environments/environment';
import { RIGHE_STYLES } from '../shared/righe-styles';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { LoadingSkeletonComponent } from '../shared/loading-skeleton';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { Fattura, FatturaRiferimento, Cliente, Ddt, Prodotto, ProdottoVariante, RigaDocumento, TipoPagamento, UnitaMisura, Pagamento, NotaRapida, AliquotaIva, NotificheConfig, Agente } from '../../models';
import { findProdottoByCodice } from '../../utils/prodotto-match';
import { scrollFocusLastRiga } from '../../utils/scroll';
import { numeroUnivocoValidator, setNumeriEsistenti } from '../../utils/numero-univoco';
import { consumePrefill } from '../../utils/nav-prefill';
import { ViewStateService } from '../../services/view-state.service';
import { docRigaTotale, prezzoNettoDaInput } from '../../utils/doc-calc';
import { ProdottoPickerComponent, ProdottoPick } from '../shared/prodotto-picker';
import { creaProdottoDaRiga } from '../../utils/crea-prodotto-da-riga';
import { AllegatiComponent } from '../shared/allegati/allegati';
import { DocInfoDialogComponent, DocInfoData } from '../shared/doc-info-dialog';
import { FattureInsoluteDialogComponent } from '../shared/fatture-insolute-dialog';
import { EmailDialogComponent } from '../shared/email-dialog';
import { CopiaRigheDialogComponent, CopiaRigheDialogData } from '../shared/copia-righe-dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DocLockService } from '../../services/doc-lock.service';
import { DocumentDirtyService } from '../../services/document-dirty.service';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

interface DdtItem { ddt: any; checked: boolean; }
interface ClienteGroup { clienteId: number | null; clienteNome: string; items: DdtItem[]; tipoPagamentoId: number | null; }

@Component({
  selector: 'app-genera-fatture-da-ddt-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
            MatCheckboxModule, MatProgressSpinnerModule, MatSnackBarModule, MatSelectModule, TPipe, TnPipe],
  template: `
    <mat-dialog-content style="min-width:560px;max-width:700px">
      <div class="dialog-hero">
        <div class="dialog-hero-icon" style="background:linear-gradient(135deg,#0ea5e9 0%,#38bdf8 100%)">
          <mat-icon>receipt_long</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ 'fatture.generaDdt.title' | t }}</span>
          <span class="dialog-hero-sub">{{ 'fatture.generaDdt.subtitle' | t }}</span>
        </div>
      </div>

      @if (loading) {
        <div style="text-align:center;padding:40px">
          <mat-spinner diameter="40" style="margin:0 auto"></mat-spinner>
        </div>
      } @else if (!groups.length) {
        <div style="text-align:center;padding:40px;color:#94a3b8">
          <mat-icon style="font-size:48px;width:48px;height:48px;display:block;margin:0 auto 12px">check_circle_outline</mat-icon>
          <p style="margin:0;font-size:14px">{{ 'fatture.generaDdt.nessunDdt' | t }}</p>
        </div>
      } @else {
        <div class="gd-groups">
          @for (g of groups; track g.clienteId) {
            <div class="gd-group">
              <div class="gd-group-header">
                <mat-checkbox
                  [checked]="isGroupAllChecked(g)"
                  [indeterminate]="isGroupIndeterminate(g)"
                  (change)="toggleGroup(g, $event.checked)">
                </mat-checkbox>
                <mat-icon style="color:#11769b;font-size:18px;width:18px;height:18px">person</mat-icon>
                <span class="gd-cliente">{{ g.clienteNome }}</span>
                <mat-select [(ngModel)]="g.tipoPagamentoId" class="gd-pagamento-select"
                            [placeholder]="'fatture.generaDdt.tipoPagamentoPh' | t">
                  <mat-option [value]="null">{{ 'fatture.generaDdt.nonSpecificato' | t }}</mat-option>
                  @for (t of tipiPagamento; track t.id) {
                    <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                  }
                </mat-select>
                <span class="gd-group-total">{{ groupSelectedTotal(g) | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
              </div>
              @for (item of g.items; track item.ddt.id) {
                <div class="gd-ddt-row" [class.gd-unchecked]="!item.checked">
                  <mat-checkbox [(ngModel)]="item.checked"></mat-checkbox>
                  <mat-icon style="font-size:15px;width:15px;height:15px;color:#64748b">local_shipping</mat-icon>
                  <span class="gd-ddt-num">{{ 'fatture.generaDdt.docTrasportoN' | t }}&nbsp;{{ item.ddt.numero }}</span>
                  <span class="gd-ddt-data">{{ item.ddt.dataEmissione | date:'dd/MM/yyyy' }}</span>
                  <span class="gd-ddt-tot">{{ item.ddt.totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span>
                </div>
              }
            </div>
          }
        </div>
        <div class="gd-summary">
          <mat-icon>info_outline</mat-icon>
          @if (selectedGroups.length) {
            {{ 'fatture.generaDdt.summary' | t:{ fatture: (selectedGroups.length | tn:'fatture.generaDdt.fattureCount'), ddt: (selectedCount | tn:'fatture.generaDdt.ddtCount') } }}
          } @else {
            {{ 'fatture.generaDdt.nessunSelezionato' | t }}
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="generating">{{ 'fatture.generaDdt.annulla' | t }}</button>
      <button mat-flat-button (click)="generate()"
              [disabled]="!selectedCount || generating || loading">
        @if (generating) {
          <mat-spinner diameter="16" style="display:inline-block;vertical-align:middle;margin-right:6px"></mat-spinner>
        }
        {{ selectedGroups.length ? (selectedGroups.length | tn:'fatture.generaDdt.generaN') : ('fatture.generaDdt.genera' | t) }}
      </button>
    </mat-dialog-actions>`,
  styles: [`
    .gd-groups { display:flex; flex-direction:column; gap:8px; margin:16px 0 8px; }
    .gd-group { border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .gd-group-header { display:flex; align-items:center; gap:10px; padding:8px 14px; background:#f8fafc; font-weight:600; font-size:14px; }
    .gd-pagamento-select { font-size:12px; min-width:190px; max-width:220px; }
    .gd-cliente { flex:1; color:#1e293b; }
    .gd-group-total { font-size:13px; color:#374151; font-weight:700; }
    .gd-ddt-row { display:flex; align-items:center; gap:10px; padding:8px 14px 8px 28px; border-top:1px solid #f1f5f9; font-size:13px; transition:background 0.15s; }
    .gd-ddt-row:hover { background:#f8fafc; }
    .gd-unchecked { opacity:0.5; }
    .gd-ddt-num { font-weight:500; color:#374151; min-width:110px; }
    .gd-ddt-data { color:#64748b; flex:1; }
    .gd-ddt-tot { font-weight:600; color:#1e293b; }
    .gd-summary { display:flex; align-items:center; gap:8px; padding:10px 14px; background:#f0f9ff; border-radius:8px; font-size:13px; color:#0369a1; margin-top:8px; }
    .gd-summary mat-icon { font-size:18px; width:18px; height:18px; }
  `]
})
export class GeneraFattureDaDdtDialogComponent implements OnInit {
  private i18n = inject(I18nService);
  groups: ClienteGroup[] = [];
  tipiPagamento: TipoPagamento[] = [];
  loading = true;
  generating = false;

  constructor(
    private ds: DataService,
    private snack: MatSnackBar,
    public dialogRef: MatDialogRef<GeneraFattureDaDdtDialogComponent>
  ) {}

  ngOnInit() {
    this.ds.getTipiPagamento().subscribe(t => {
      this.tipiPagamento = t.filter(x => x.attivo);
      if (!this.loading) this.applyDefaults();
    });
    this.ds.getDdtNonFatturati().subscribe({
      next: ddts => {
        const map = new Map<string, ClienteGroup>();
        for (const ddt of ddts) {
          const key = String(ddt.clienteId ?? 0);
          if (!map.has(key)) map.set(key, {
            clienteId: ddt.clienteId ?? null,
            clienteNome: (ddt as any).clienteNome ?? 'Senza cliente',
            items: [],
            tipoPagamentoId: (ddt as any).clienteTipoPagamentoId ?? null
          });
          map.get(key)!.items.push({ ddt, checked: true });
        }
        this.groups = [...map.values()];
        this.loading = false;
        if (this.tipiPagamento.length) this.applyDefaults();
      },
      error: () => { this.loading = false; }
    });
  }

  private applyDefaults() {
    for (const g of this.groups) {
      const preferred = g.tipoPagamentoId
        ? this.tipiPagamento.find(t => t.id === g.tipoPagamentoId)
        : null;
      // Se il cliente non ha preferenza o la preferenza è immediata (contanti/POS)
      // → cerchiamo "vista fattura": non immediato, giorni_scadenza = 0
      if (!preferred || preferred.immediato) {
        const vistaFattura = this.tipiPagamento.find(t => !t.immediato && t.giorniScadenza === 0);
        g.tipoPagamentoId = vistaFattura?.id ?? g.tipoPagamentoId;
      }
      // altrimenti manteniamo la preferenza del cliente (bonifico dilazionato, ecc.)
    }
  }

  isGroupAllChecked(g: ClienteGroup): boolean { return g.items.every(i => i.checked); }
  isGroupIndeterminate(g: ClienteGroup): boolean { const n = g.items.filter(i => i.checked).length; return n > 0 && n < g.items.length; }
  toggleGroup(g: ClienteGroup, checked: boolean) { g.items.forEach(i => i.checked = checked); }
  groupSelectedTotal(g: ClienteGroup): number { return g.items.filter(i => i.checked).reduce((s, i) => s + (i.ddt.totale ?? 0), 0); }
  get selectedGroups(): ClienteGroup[] { return this.groups.filter(g => g.items.some(i => i.checked)); }
  get selectedCount(): number { return this.groups.reduce((s, g) => s + g.items.filter(i => i.checked).length, 0); }

  generate() {
    const items = this.selectedGroups.map(g => ({
      clienteId: g.clienteId,
      ddtIds: g.items.filter(i => i.checked).map(i => i.ddt.id),
      tipoPagamentoId: g.tipoPagamentoId
    }));
    if (!items.length) return;
    this.generating = true;
    this.ds.generaFattureDaDdt(items).subscribe({
      next: result => { this.generating = false; this.dialogRef.close(result.fatture); },
      error: e => { this.generating = false; this.snack.open(e.error?.error || this.i18n.t('fatture.generaDdt.msg.erroreGenerazione'), '', { duration: 3500 }); }
    });
  }
}

@Component({
  selector: 'app-fattura-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule,
            MatAutocompleteModule, MatTableModule, MatIconModule, MatTabsModule,
            MatButtonToggleModule, MatSnackBarModule, MatMenuModule, MatTooltipModule,
            MatCheckboxModule, MatProgressSpinnerModule, AllegatiComponent, DragDropModule, TPipe, TnPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon">
          <mat-icon>receipt</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">
            {{ data?.id ? ('fatture.dialog.fatturaN' | t:{ numero: (data?.numero || '') }) : ('fatture.dialog.nuovaFattura' | t) }}
            @if (data?.id && locked) {
              <span class="dialog-lock-chip"><mat-icon>lock</mat-icon>{{ 'fatture.dialog.bloccato' | t }}</span>
            }
          </span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'fatture.dialog.editaRigheEcc' : 'fatture.dialog.selezionaClienteEcc') | t }}</span>
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

      <mat-tab-group>
        <mat-tab [label]="'fatture.dialog.tabDocumento' | t">
          <div class="doc-form">

            <div class="form-section is-primary">
              <div class="form-section-header"><mat-icon>person</mat-icon><span>{{ 'fatture.dialog.intestazione' | t }}</span></div>
              <div class="doc-field-grid" [formGroup]="form">
                <mat-form-field>
                  <mat-label>{{ 'fatture.dialog.cliente' | t }}</mat-label>
                  <input matInput [matAutocomplete]="autoCliente" [formControl]="clienteCtrl"
                         (keyup.enter)="autoSelectCliente()" [placeholder]="'fatture.dialog.clientePh' | t"
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
              </div>
            </div>

            <!-- DDT collegati (visibile solo dopo aver selezionato il cliente) -->
            @if (hasCliente) {
            <div class="form-section">
              <div class="form-section-header">
                <mat-icon>local_shipping</mat-icon><span>{{ 'fatture.dialog.ddtCollegati' | t }}</span>
                <select class="riga-input" [(ngModel)]="ddtSelezione" (change)="addDdt()">
                  <option [ngValue]="null">{{ 'fatture.dialog.collegaDdtPh' | t }}</option>
                  @for (d of ddtDisponibili; track d.id) {
                    <option [ngValue]="d.id">{{ 'fatture.dialog.docTrasportoN' | t:{ n: d.numero, data: (d.dataEmissione | date:'dd/MM/yy') ?? '' } }}</option>
                  }
                </select>
              </div>
              @if (linkedDdts.length) {
                <div class="chip-row">
                  @for (d of linkedDdts; track d.id) {
                    <span class="doc-chip is-info">
                      <mat-icon>local_shipping</mat-icon>
                      {{ 'fatture.dialog.docTrasportoDelN' | t:{ n: d.numero, data: (d.dataEmissione | date:'dd/MM/yyyy') ?? '' } }}
                      <button type="button" class="chip-remove" (click)="removeDdt(d.id!)" [title]="'fatture.dialog.scollegaDdt' | t">×</button>
                    </span>
                  }
                </div>
              } @else {
                <p class="section-empty">{{ 'fatture.dialog.nessunDdtCollegato' | t }}</p>
              }
            </div>
            }

            <div class="form-section">
              @if (suggerimenti.length) {
                <div class="suggeriti-bar">
                  <mat-icon class="icon-primary">auto_awesome</mat-icon>
                  <span class="suggeriti-label">{{ 'fatture.dialog.suggeritiPerCliente' | t }}</span>
                  @for (s of suggerimenti; track s.id) {
                    <button type="button" class="sugg-chip" (click)="addRigaDaSuggerimento(s)">
                      <mat-icon>add</mat-icon>{{ s.nome }}<span class="sugg-count">·{{ s.occorrenze }}</span>
                    </button>
                  }
                </div>
              }
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
                    <mat-icon>sticky_note_2</mat-icon> {{ 'fatture.dialog.nota' | t }}
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
                    <th class="td-iva">{{ 'fatture.dialog.colIva' | t }}</th>
                    <th class="td-totale">{{ (showNetto ? 'fatture.dialog.colTotaleNetto' : 'fatture.dialog.colTotaleIvato') | t }}</th>
                    <th class="td-scarico" [title]="'fatture.dialog.scaricoTooltip' | t">{{ 'fatture.dialog.colScarico' | t }}</th>
                    <th class="td-actions"></th>
                  </tr>
                </thead>
                <tbody cdkDropList (cdkDropListDropped)="dropRiga($event)">
                  @for (riga of righe; track $index; let rowIdx = $index) {
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
                          <input class="riga-input riga-codice" #rigaCodice [(ngModel)]="riga.codiceProdotto" [placeholder]="'fatture.dialog.codicePh' | t"
                            (keydown.enter)="risolviCodiceRiga(rowIdx, $event)" (keydown.f2)="searchProdotto(rowIdx)"
                            (keydown.arrowdown)="focusSiblingCodice($event, 1)" (keydown.arrowup)="focusSiblingCodice($event, -1)" (keydown.backspace)="onCodiceBackspace(rowIdx, $event)">
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
                      <td class="td-prezzo" [attr.data-label]="(showNetto ? 'fatture.dialog.colPrezzoNetto' : 'fatture.dialog.colPrezzoIvato') | t"><input class="riga-input" type="number" min="0" step="0.01"
                        [value]="showNetto ? riga.prezzo : +(riga.prezzo * (1 + riga.iva/100)).toFixed(2)"
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
                                <b class="pr-value">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
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
                                  <b class="pr-value" style="margin-left:0">{{ pr.prezzoEffettivo | currency:'EUR':'symbol':'1.2-2':'it' }}</b>
                                  @if (pr.sconto) { <span class="pr-discount">(-{{ pr.sconto }}%)</span> }
                                </div>
                              </button>
                            }
                          </mat-menu>
                        }
                      </td>
                      <td class="td-sconto" [attr.data-label]="'fatture.dialog.colSconto' | t"><input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.sconto" (change)="clampSconto(riga)" placeholder="0"></td>
                      <td class="td-iva" [attr.data-label]="'fatture.dialog.colIva' | t">
                        @if (aliquoteIva.length) {
                          <select class="riga-input"
                                  [ngModel]="riga.codiceIva || resolveAliquotaCodice(riga.iva)"
                                  (ngModelChange)="onAliquotaChange(riga, $event)">
                            @for (a of aliquoteIva; track a.id) {
                              <option [value]="a.codice">{{ a.valore }}% {{ a.codice ? '(' + a.codice + ')' : '' }}</option>
                            }
                          </select>
                        } @else {
                          <input class="riga-input" type="number" min="0" max="100" step="0.1" [(ngModel)]="riga.iva">
                        }
                      </td>
                      <td class="td-totale" [attr.data-label]="'fatture.dialog.totale' | t">
                        {{ rigaTotale(riga) | currency:'EUR':'symbol':'1.2-2':'it' }}
                      </td>
                      <td class="td-scarico" [attr.data-label]="'fatture.dialog.colScarico' | t">
                        @if (riga.prodottoId) {
                          <input type="checkbox" class="riga-check" [(ngModel)]="riga.scaricaMagazzino"
                                 [title]="'fatture.dialog.scaricoTooltip' | t">
                        } @else {
                          <input type="checkbox" class="riga-check riga-check--crea" [checked]="false"
                                 (click)="creaProdottoPerRiga($index, $event)"
                                 [matTooltip]="'fatture.dialog.creaProdottoTooltip' | t">
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
            </div>

            <div class="form-section is-flat">
              <div class="form-section-header" style="cursor:pointer" (click)="showFiscale = !showFiscale">
                <mat-icon>receipt_long</mat-icon>
                <span>{{ 'fatture.dialog.ritenutaCassaBollo' | t }}</span>
                @if (hasFiscaleAttivo) {
                  <span style="margin-left:8px;font-size:11px;font-weight:700;color:var(--primary);background:var(--primary-soft);padding:2px 8px;border-radius:999px">{{ 'fatture.dialog.attivo' | t }}</span>
                }
                <span style="flex:1"></span>
                <mat-icon>{{ showFiscale ? 'expand_less' : 'expand_more' }}</mat-icon>
              </div>
              @if (showFiscale) {
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px 14px;align-items:center;padding-top:6px">
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.cassaPrevidenziale' | t }}</mat-label>
                    <mat-select [(ngModel)]="fisc.cassaTipo" [ngModelOptions]="{standalone:true}">
                      <mat-option [value]="''">{{ 'fatture.dialog.nessuna' | t }}</mat-option>
                      @for (t of CASSA_TIPI; track t.v) { <mat-option [value]="t.v">{{ t.l }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.percCassa' | t }}</mat-label>
                    <input matInput type="number" min="0" step="0.01" [(ngModel)]="fisc.cassaAliquota" [ngModelOptions]="{standalone:true}" (ngModelChange)="onCassaAttiva()">
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.ivaSuCassa' | t }}</mat-label>
                    <input matInput type="number" min="0" step="0.01" [(ngModel)]="fisc.cassaIva" [ngModelOptions]="{standalone:true}">
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.percRitenuta' | t }}</mat-label>
                    <input matInput type="number" min="0" step="0.01" [(ngModel)]="fisc.ritenutaAliquota" [ngModelOptions]="{standalone:true}">
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.tipoRitenuta' | t }}</mat-label>
                    <mat-select [(ngModel)]="fisc.ritenutaTipo" [ngModelOptions]="{standalone:true}">
                      @for (t of RITENUTA_TIPI; track t.v) { <mat-option [value]="t.v">{{ t.l }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'fatture.dialog.causaleRitenuta' | t }}</mat-label>
                    <mat-select [(ngModel)]="fisc.ritenutaCausale" [ngModelOptions]="{standalone:true}">
                      <mat-option [value]="''">—</mat-option>
                      @for (c of RITENUTA_CAUSALI; track c.v) { <mat-option [value]="c.v">{{ c.l }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  <mat-checkbox [(ngModel)]="fisc.bollo" [ngModelOptions]="{standalone:true}">{{ 'fatture.dialog.bollo' | t }}</mat-checkbox>
                </div>
              }
            </div>

            <div class="doc-totals-strip">
              <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              @if (cassaImporto > 0) {
                <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.cassa' | t }}</span><span class="totals-value">{{ cassaImporto | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              }
              <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              @if (bolloImporto > 0) {
                <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.bolloLabel' | t }}</span><span class="totals-value">{{ bolloImporto | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              }
              <span class="totals-spacer"></span>
              @if (ritenutaImporto > 0) {
                <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
                <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.ritenuta' | t }}</span><span class="totals-value">−{{ ritenutaImporto | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
                <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.nettoAPagare' | t }}</span><span class="totals-value">{{ nettoAPagare | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              } @else {
                <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              }
            </div>

            <div class="form-section is-flat" [formGroup]="form">
              <div class="form-section-header"><mat-icon>notes</mat-icon><span>{{ 'fatture.dialog.noteInterne' | t }}</span></div>
              <mat-form-field>
                <mat-label>{{ 'fatture.dialog.annotazioniInterne' | t }}</mat-label>
                <textarea matInput rows="2" formControlName="note"></textarea>
              </mat-form-field>
              @if (agenti.length) {
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
                  <mat-form-field style="flex:1;min-width:200px">
                    <mat-label>{{ 'fatture.dialog.agente' | t }}</mat-label>
                    <mat-select formControlName="agenteId">
                      <mat-option [value]="null">{{ 'fatture.dialog.nessunoAgente' | t }}</mat-option>
                      @for (ag of agenti; track ag.id) { <mat-option [value]="ag.id">{{ ag.nome }}</mat-option> }
                    </mat-select>
                  </mat-form-field>
                  @if (form.get('agenteId')?.value) {
                    <mat-form-field style="width:160px">
                      <mat-label>{{ 'fatture.dialog.provvigione' | t }}</mat-label>
                      <input matInput type="number" min="0" max="100" step="0.5" formControlName="provvigione" [placeholder]="'fatture.dialog.provvigionePh' | t">
                      <span matSuffix>%</span>
                    </mat-form-field>
                  }
                </div>
              }
            </div>
          </div>
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-lead-icon">payment</mat-icon>
            {{ 'fatture.dialog.tabPagamento' | t }}
            @if (!selectedTipoPagamentoId) {
              <mat-icon class="tab-status-icon icon-warning">warning_amber</mat-icon>
            } @else {
              <mat-icon class="tab-status-icon icon-success">check_circle</mat-icon>
            }
          </ng-template>
          <div class="doc-form">
            <div class="pagamento-grid">
              <div class="form-section is-primary">
                <div class="form-section-header"><mat-icon>payment</mat-icon><span>{{ 'fatture.dialog.modalitaPagamento' | t }}</span></div>
                <mat-form-field>
                  <mat-label>{{ 'fatture.dialog.tipoPagamento' | t }}</mat-label>
                  <mat-select [(ngModel)]="selectedTipoPagamentoId" (ngModelChange)="onTipoPagamentoChange()">
                    <mat-option [value]="null">{{ 'fatture.dialog.nonSpecificato' | t }}</mat-option>
                    @for (t of tipiPagamento; track t.id) {
                      <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (tipoPagamentoSelezionato) {
                  <div class="pagamento-info">
                    <div class="info-row">
                      <mat-icon>{{ tipoPagamentoSelezionato.conto === 'CASSA' ? 'account_balance_wallet' : 'account_balance' }}</mat-icon>
                      <span>{{ 'fatture.dialog.conto' | t }} <b>{{ tipoPagamentoSelezionato.conto }}</b></span>
                    </div>
                    <div class="info-row">
                      <mat-icon>{{ tipoPagamentoSelezionato.immediato ? 'flash_on' : 'schedule' }}</mat-icon>
                      <span>
                        @if (tipoPagamentoSelezionato.immediato) {
                          <b>{{ 'fatture.dialog.pagamentoImmediato' | t }}</b> {{ 'fatture.dialog.registratoAutomatic' | t }}
                        } @else if (tipoPagamentoSelezionato.giorniScadenza === 0) {
                          <b>{{ 'fatture.dialog.vistaFattura' | t }}</b> {{ 'fatture.dialog.inseritoScadenzario' | t }}
                        } @else {
                          {{ 'fatture.dialog.scadenza' | t }} <b>{{ tipoPagamentoSelezionato.giorniScadenza }} {{ 'fatture.dialog.giorni' | t }}{{ tipoPagamentoSelezionato.fineMese ? ' ' + ('fatture.dialog.fineMese' | t) : '' }}</b>
                        }
                      </span>
                    </div>
                  </div>
                }
              </div>
              <div class="form-section">
                <div class="form-section-header"><mat-icon>savings</mat-icon><span>{{ 'fatture.dialog.accontiVersati' | t }}</span></div>
                @if (!data?.id) {
                  <p class="section-empty">{{ 'fatture.dialog.salvaPrimaAcconti' | t }}</p>
                } @else {
                  @if (pagamenti.length > 0) {
                    <table class="acconto-table">
                      <thead><tr><th>{{ 'fatture.dialog.colData' | t }}</th><th>{{ 'fatture.dialog.colMetodo' | t }}</th><th>{{ 'fatture.dialog.colImporto' | t }}</th><th>{{ 'fatture.dialog.colTipo' | t }}</th><th></th></tr></thead>
                      <tbody>
                        @for (p of pagamenti; track p.id) {
                          <tr>
                            <td>{{ p.dataPagamento | date:'dd/MM/yyyy' }}</td>
                            <td>{{ p.metodo }}</td>
                            <td class="acconto-importo">{{ p.importo | currency:'EUR':'symbol':'1.2-2':'it' }}</td>
                            <td><span [class]="'tipo-badge tipo-' + (p.tipo ?? 'acconto').toLowerCase()">{{ p.tipo ?? 'ACCONTO' }}</span></td>
                            <td>
                              <button mat-icon-button color="warn" type="button" (click)="deleteAcconto(p.id!)">
                                <mat-icon>delete</mat-icon>
                              </button>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  } @else {
                    <p class="section-empty" style="margin-bottom:12px">{{ 'fatture.dialog.nessunAcconto' | t }}</p>
                  }
                  <div class="acconto-summary">
                    <span>{{ 'fatture.dialog.totaleFattura' | t }} <b>{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</b></span>
                    <span>{{ 'fatture.dialog.accontiLabel' | t }} <b>{{ totalePagato | currency:'EUR':'symbol':'1.2-2':'it' }}</b></span>
                    <span [style.color]="rimanente > 0.005 ? 'var(--danger)' : 'var(--success)'">{{ 'fatture.dialog.rimanente' | t }} <b>{{ rimanente | currency:'EUR':'symbol':'1.2-2':'it' }}</b></span>
                  </div>
                  <div class="acconto-form">
                    <input class="riga-input" type="date" [(ngModel)]="nuovoAcconto.dataPagamento">
                    <input class="riga-input num" type="number" step="0.01" min="0" [(ngModel)]="nuovoAcconto.importo" [placeholder]="'fatture.dialog.importoPh' | t">
                    <select class="riga-input" style="width:auto" [(ngModel)]="nuovoAcconto.metodo">
                      <option value="Contanti">{{ 'fatture.dialog.metodo.contanti' | t }}</option>
                      <option value="Bonifico">{{ 'fatture.dialog.metodo.bonifico' | t }}</option>
                      <option value="Carta">{{ 'fatture.dialog.metodo.carta' | t }}</option>
                      <option value="Assegno">{{ 'fatture.dialog.metodo.assegno' | t }}</option>
                      <option value="RID">{{ 'fatture.dialog.metodo.rid' | t }}</option>
                      <option value="Altro">{{ 'fatture.dialog.metodo.altro' | t }}</option>
                    </select>
                    <button mat-stroked-button type="button" (click)="addAcconto()">
                      <mat-icon>add</mat-icon> {{ 'fatture.dialog.aggiungi' | t }}
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>
        </mat-tab>

        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-lead-icon">account_balance</mat-icon>
            {{ 'fatture.dialog.tabRiferimenti' | t }}
            @if (riferimenti.length) {
              <span class="tab-badge">{{ riferimenti.length }}</span>
            }
          </ng-template>
          <div class="doc-form">
            <div class="rif-intro">
              <div>
                <div class="rif-intro-title">{{ 'fatture.dialog.docEmessoInSeguito' | t }}</div>
                <p class="section-empty">{{ 'fatture.dialog.perFatturaPaHint' | t }}</p>
              </div>
              <button mat-flat-button color="primary" type="button" (click)="addRiferimento()">
                <mat-icon>add</mat-icon> {{ 'fatture.dialog.aggiungiRiferimento' | t }}
              </button>
            </div>

            @if (!riferimenti.length) {
              <div class="rif-empty">
                <mat-icon>link</mat-icon>
                {{ 'fatture.dialog.nessunRiferimento' | t }}
              </div>
            }

            @for (rif of riferimenti; track $index) {
              <div class="form-section">
                <div class="form-section-header">
                  <mat-icon>link</mat-icon><span>{{ 'fatture.dialog.riferimentoN' | t:{ n: $index + 1 } }}</span>
                  <button mat-icon-button color="warn" type="button" class="header-action" (click)="removeRiferimento($index)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
                <div class="rif-grid">
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.tipoDocumento' | t }}</label>
                    <select class="riga-input" [(ngModel)]="rif.tipo">
                      @for (t of TIPI_RIF; track t.value) {
                        <option [value]="t.value">{{ t.label }}</option>
                      }
                    </select>
                  </div>
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.numeroReq' | t }}</label>
                    <input class="riga-input" [(ngModel)]="rif.numero" [placeholder]="'fatture.dialog.numeroPh' | t">
                  </div>
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.data' | t }}</label>
                    <input class="riga-input" type="date" [(ngModel)]="rif.data">
                  </div>
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.cig' | t }}</label>
                    <input class="riga-input input-upper" [(ngModel)]="rif.cig" [placeholder]="'fatture.dialog.cigPh' | t" (input)="rif.cig = rif.cig?.toUpperCase() ?? ''">
                  </div>
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.cup' | t }}</label>
                    <input class="riga-input input-upper" [(ngModel)]="rif.cup" [placeholder]="'fatture.dialog.cupPh' | t" (input)="rif.cup = rif.cup?.toUpperCase() ?? ''">
                  </div>
                  <div class="rif-field">
                    <label class="rif-label">{{ 'fatture.dialog.commessa' | t }}</label>
                    <input class="riga-input" [(ngModel)]="rif.commessa" [placeholder]="'fatture.dialog.commessaPh' | t">
                  </div>
                </div>
              </div>
            }
          </div>
        </mat-tab>
        @if (data?.id) {
          <mat-tab>
            <ng-template mat-tab-label>
              <mat-icon class="tab-lead-icon">attach_file</mat-icon>
              {{ 'fatture.dialog.tabAllegati' | t }}
            </ng-template>
            <div class="doc-form">
              <app-allegati [documentoTipo]="'fattura'" [documentoId]="data?.id ?? null"></app-allegati>
            </div>
          </mat-tab>
        }
      </mat-tab-group>

      </div>

      @if (avvisiAntiErrore.length) {
        <div class="avvisi-box">
          @for (a of avvisiAntiErrore; track a) {
            <div class="avviso-item"><mat-icon>warning_amber</mat-icon><span>{{ a }}</span></div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-stroked-button type="button" (click)="salvaEStampa()"
              [disabled]="locked || form.get('numero')?.hasError('numeroDuplicato') || salvandoEStampando"
              [matTooltip]="form.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : (locked ? ('fatture.dialog.sbloccaTooltip' | t) : '')">
        @if (salvandoEStampando) { <mat-spinner diameter="16" style="display:inline-block;vertical-align:middle;margin-right:6px"></mat-spinner> }
        <mat-icon>print</mat-icon> {{ 'fatture.dialog.salvaEStampa' | t }}</button>
      <button mat-flat-button (click)="save()"
              [disabled]="locked || form.get('numero')?.hasError('numeroDuplicato')"
              [matTooltip]="form.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : (locked ? ('fatture.dialog.sbloccaTooltip' | t) : '')">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [RIGHE_STYLES + `
    .pagamento-info { background:var(--bg-subtle); border-radius:var(--radius-md); padding:var(--sp-4); margin-top:var(--sp-2); display:flex; flex-direction:column; gap:var(--sp-3); }
    .info-row { display:flex; align-items:center; gap:var(--sp-2); color:var(--text-secondary); font-size:13px; }
    .info-row mat-icon { color:var(--primary); font-size:20px; width:20px; height:20px; }
    .avvisi-box { display:flex; flex-direction:column; gap:var(--sp-1); background:var(--warning-soft); border:1px solid var(--warning); border-radius:var(--radius-md); padding:var(--sp-2) var(--sp-3); margin-top:var(--sp-1); }
    .avviso-item { display:flex; align-items:center; gap:var(--sp-2); font-size:13px; color:var(--warning-on); font-weight:500; }
    .avviso-item mat-icon { font-size:18px; width:18px; height:18px; flex-shrink:0; }
    .acconto-table { width:100%; border-collapse:collapse; margin-bottom:var(--sp-2); font-size:13px; }
    .acconto-table th { background:var(--bg-surface-2); padding:6px 8px; text-align:left; border-bottom:1px solid var(--border); font-size:12px; color:var(--text-tertiary); }
    .acconto-table td { padding:var(--sp-1) var(--sp-2); border-bottom:1px solid var(--border-subtle); }
    .acconto-importo { font-weight:600; white-space:nowrap; }
    .acconto-summary { display:flex; gap:var(--sp-4); flex-wrap:wrap; padding:var(--sp-2) 0; font-size:13px; color:var(--text-secondary); margin-bottom:var(--sp-3); }
    .acconto-form { display:flex; gap:var(--sp-2); align-items:center; flex-wrap:wrap; margin-top:var(--sp-1); }
    .tipo-badge { font-size:11px; padding:2px 6px; border-radius:var(--radius-xs); font-weight:600; background:var(--bg-subtle); color:var(--text-secondary); }
    .tipo-automatico { background:var(--info-soft); color:var(--info-on); }
    .tipo-acconto { background:var(--success-soft); color:var(--success-on); }
  `]
})
export class FatturaDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  form: FormGroup;
  locked = false;
  salvandoEStampando = false;
  numeriEsistenti = new Set<string>();
  clienti: Cliente[] = [];
  filteredClienti: Cliente[] = [];
  clienteCtrl = new FormControl<Cliente | string | null>('');
  agenti: Agente[] = [];
  private draft = inject(DraftService);
  private destroyRef = inject(DestroyRef);
  private confirmDraft = inject(ConfirmService);
  private confirm = inject(ConfirmService);
  private readonly draftTipo = 'fatture';

  toggleLock() { this.locked = !this.locked; }
  onLockedClick(ev: MouseEvent) {
    if (!this.locked) return;
    const target = ev.target as HTMLElement;
    // Lascia passare i click sul pulsante del lucchetto (vive nell'hero, fuori dal wrapper)
    if (target.closest('.dialog-lock-btn')) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.snack.open(this.i18n.t('fatture.dialog.msgDocBloccato'), 'OK', { duration: 2600 });
  }
  suggerimenti: { id: number; nome: string; codice?: string; prezzo: number; iva: number; unitaMisura?: string; occorrenze: number }[] = [];

  loadSuggerimentiCliente(clienteId: number) {
    this.ds.getTopProdottiCliente(clienteId, 5).subscribe({
      next: items => { this.suggerimenti = items || []; },
      error: () => { this.suggerimenti = []; }
    });
  }

  addRigaDaSuggerimento(s: { id: number; nome: string; codice?: string; prezzo: number; iva: number; unitaMisura?: string }) {
    this.righe.push({
      prodottoId: s.id,
      descrizione: s.nome,
      quantita: 1,
      prezzo: s.prezzo,
      sconto: 0,
      iva: s.iva,
      codiceIva: this.resolveAliquotaCodice(s.iva),
      unitaMisura: s.unitaMisura || 'pz',
      tipo: 'PRODOTTO',
      scaricaMagazzino: true,
    } as RigaDocumento);
    this.applyListino(this.righe.length - 1);
  }
  ddts: Ddt[] = [];
  linkedDdts: Ddt[] = [];
  ddtSelezione: number | null = null;
  righe: RigaDocumento[] = [];
  noteRapideList: NotaRapida[] = [];
  prodotti: Prodotto[] = [];
  unitaMisura: UnitaMisura[] = [];
  tipiPagamento: TipoPagamento[] = [];
  aliquoteIva: AliquotaIva[] = [];
  riferimenti: FatturaRiferimento[] = [];

  readonly TIPI_RIF = [
    { value: 'ORDINE_ACQUISTO', label: this.i18n.t('fatture.dialog.tipoRif.ordineAcquisto') },
    { value: 'CONTRATTO',       label: this.i18n.t('fatture.dialog.tipoRif.contratto') },
    { value: 'CONVENZIONE',     label: this.i18n.t('fatture.dialog.tipoRif.convenzione') },
    { value: 'RICEZIONE',       label: this.i18n.t('fatture.dialog.tipoRif.ricezione') },
    { value: 'FATTURA_COLLEGATA', label: this.i18n.t('fatture.dialog.tipoRif.fatturaCollegata') },
    { value: 'DDT',             label: this.i18n.t('fatture.dialog.tipoRif.ddt') },
  ];
  selectedTipoPagamentoId: number | null = null;
  pagamenti: Pagamento[] = [];
  prezziRecenti: any[][] = [];
  prezziRecentiTutti: any[][] = [];
  tuttiCaricati: boolean[] = [];
  nuovoAcconto = { dataPagamento: new Date().toISOString().substring(0, 10), importo: 0, metodo: 'Bonifico', note: '' };
  readonly isNew: boolean;

  submitted = false;

  get hasCliente(): boolean {
    const v = this.clienteCtrl.value;
    return !!(v && typeof v !== 'string');
  }
  get clienteSelezionato(): Cliente | null {
    const v = this.clienteCtrl.value;
    return v && typeof v === 'object' ? (v as Cliente) : null;
  }
  /** Avvisi anti-errore (non bloccanti): cliente con insoluti, righe sotto il costo d'acquisto. */
  get avvisiAntiErrore(): string[] {
    const out: string[] = [];
    const cli = this.clienteSelezionato;
    if (cli && (cli.fattureInsolute ?? 0) > 0) {
      const n = cli.fattureInsolute!;
      out.push(this.i18n.tn('fatture.dialog.avviso.insoluti', n, { nome: cli.ragioneSociale }));
    }
    const sottoCosto: string[] = [];
    for (const r of this.righe) {
      if (r.tipo === 'NOTA' || !r.prodottoId) continue;
      const costo = this.prodotti.find(p => p.id === r.prodottoId)?.prezzoAcquisto;
      if (costo == null || costo <= 0) continue;
      const netto = (r.prezzo ?? 0) * (1 - (r.sconto ?? 0) / 100);
      if (netto < costo) sottoCosto.push(r.descrizione || 'riga');
    }
    if (sottoCosto.length) {
      out.push(this.i18n.t('fatture.dialog.avviso.sottoCosto', { elenco: sottoCosto.join(', ') }));
    }
    return out;
  }
  get hasRighe(): boolean {
    return this.righe.length > 0 && this.righe.some(r => r.descrizione?.trim());
  }
  get canSave(): boolean {
    return this.form.valid && this.hasCliente && this.hasRighe;
  }

  get clienteId(): number | null {
    const v = this.clienteCtrl.value;
    return v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
  }

  get ddtsFiltrati(): Ddt[] {
    const cid = this.clienteId;
    return cid ? this.ddts.filter(d => d.clienteId === cid) : [];
  }

  get ddtDisponibili(): Ddt[] {
    const linkedIds = new Set(this.linkedDdts.map(d => d.id));
    const currentFatturaId = this.data?.id;
    return this.ddtsFiltrati.filter(d =>
      !linkedIds.has(d.id) && (!d.fatturaId || d.fatturaId === currentFatturaId)
    );
  }

  showNetto = false;

  // ── Dati fiscali (ritenuta d'acconto / cassa previdenziale / bollo) ──────────
  fisc = {
    ritenutaAliquota: 0, ritenutaCausale: '', ritenutaTipo: 'RT02',
    cassaTipo: '', cassaAliquota: 0, cassaIva: 0, bollo: false,
  };
  showFiscale = false;
  readonly RITENUTA_TIPI = [
    { v: 'RT02', l: this.i18n.t('fatture.dialog.ritenutaTipoOpt.rt02') },
    { v: 'RT01', l: this.i18n.t('fatture.dialog.ritenutaTipoOpt.rt01') },
  ];
  readonly RITENUTA_CAUSALI = [
    { v: 'A', l: this.i18n.t('fatture.dialog.ritenutaCausaleOpt.a') },
    { v: 'B', l: this.i18n.t('fatture.dialog.ritenutaCausaleOpt.b') },
    { v: 'V', l: this.i18n.t('fatture.dialog.ritenutaCausaleOpt.v') },
    { v: 'W', l: this.i18n.t('fatture.dialog.ritenutaCausaleOpt.w') },
  ];
  readonly CASSA_TIPI = [
    { v: 'TC22', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc22') },
    { v: 'TC01', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc01') },
    { v: 'TC02', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc02') },
    { v: 'TC04', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc04') },
    { v: 'TC07', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc07') },
    { v: 'TC18', l: this.i18n.t('fatture.dialog.cassaTipoOpt.tc18') },
  ];

  private r2(n: number) { return Math.round((n || 0) * 100) / 100; }

  applyFiscFrom(src: any) {
    if (!src) return;
    this.fisc = {
      ritenutaAliquota: Number(src.ritenutaAliquota) || 0,
      ritenutaCausale: src.ritenutaCausale || '',
      ritenutaTipo: src.ritenutaTipo || 'RT02',
      cassaTipo: src.cassaTipo || '',
      cassaAliquota: Number(src.cassaAliquota) || 0,
      cassaIva: Number(src.cassaIva) || 0,
      bollo: !!src.bollo,
    };
    if (this.r2(this.fisc.ritenutaAliquota) > 0 || this.fisc.cassaAliquota > 0 || this.fisc.bollo) {
      this.showFiscale = true;
    }
  }

  get imponibile() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0); }
  get ivaRighe() { return this.righe.reduce((s, r) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0); }
  get cassaImporto() { return this.fisc.cassaAliquota ? this.r2(this.imponibile * this.fisc.cassaAliquota / 100) : 0; }
  get ivaCassa() { return this.cassaImporto ? this.r2(this.cassaImporto * (this.fisc.cassaIva || 0) / 100) : 0; }
  /** IVA totale mostrata (righe + cassa). */
  get ivaTotal() { return this.r2(this.ivaRighe + this.ivaCassa); }
  get ritenutaImporto() { return this.fisc.ritenutaAliquota ? this.r2(this.imponibile * this.fisc.ritenutaAliquota / 100) : 0; }
  get bolloImporto() { return this.fisc.bollo ? 2 : 0; }
  get totale() { return this.r2(this.imponibile + this.cassaImporto + this.ivaTotal + this.bolloImporto); }
  get nettoAPagare() { return this.r2(this.totale - this.ritenutaImporto); }
  get hasFiscaleAttivo() { return this.ritenutaImporto > 0 || this.cassaImporto > 0 || this.bolloImporto > 0; }

  /** Quando si attiva la cassa, propone l'IVA della prima riga come default. */
  onCassaAttiva() {
    if (this.fisc.cassaAliquota && !this.fisc.cassaIva) {
      this.fisc.cassaIva = this.righe.find(r => r.iva > 0)?.iva ?? 22;
    }
  }
  rigaTotale(riga: RigaDocumento) {
    return docRigaTotale(riga, this.showNetto);
  }
  isRigaNota(riga: RigaDocumento) {
    return riga.tipo === 'NOTA';
  }

  get tipoPagamentoSelezionato(): TipoPagamento | null {
    return this.tipiPagamento.find(t => t.id === this.selectedTipoPagamentoId) ?? null;
  }
  get totalePagato() { return this.pagamenti.reduce((s, p) => s + p.importo, 0); }
  get rimanente() { return this.r2(this.nettoAPagare - this.totalePagato); }

  onTipoPagamentoChange() { /* handled by ngModel */ }

  loadPagamenti() {
    if (!this.data?.id) return;
    this.ds.getPagamenti().subscribe(ps => {
      this.pagamenti = ps.filter(p => p.fatturaId === this.data!.id);
    });
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

  addAcconto() {
    if (!this.data?.id || !this.nuovoAcconto.importo) return;
    const p: Pagamento = {
      fatturaId: this.data.id,
      dataPagamento: this.nuovoAcconto.dataPagamento,
      importo: this.nuovoAcconto.importo,
      metodo: this.nuovoAcconto.metodo,
      note: this.nuovoAcconto.note,
      tipo: 'ACCONTO',
      conto: this.tipoPagamentoSelezionato?.conto,
      tipoPagamentoId: this.selectedTipoPagamentoId,
    };
    this.ds.createPagamento(p).subscribe({
      next: () => { this.nuovoAcconto.importo = 0; this.loadPagamenti(); },
      error: e => this.snack.open(e.message || this.i18n.t('fatture.dialog.msg.errore'), '', { duration: 3000 })
    });
  }

  deleteAcconto(id: number) {
    this.ds.deletePagamento(id).subscribe({
      next: () => this.loadPagamenti(),
      error: e => this.snack.open(e.message || this.i18n.t('fatture.dialog.msg.errore'), '', { duration: 3000 })
    });
  }

  @ViewChildren('rigaCodice') private codiceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  ngAfterViewInit() {
    this.cdr.detectChanges();
    // "Entrando" nel documento il focus va subito sul codice della prima riga:
    // si digita il codice e si preme Invio per inserire il prodotto, senza mouse.
    setTimeout(() => this.codiceInputs?.first?.nativeElement.focus(), 0);
  }

  // Scorciatoia: Ctrl/Cmd+Invio salva il documento da qualunque campo.
  @HostListener('keydown', ['$event'])
  onDialogKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.save(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); this.save(); }
  }

  @HostListener('input')
  @HostListener('change')
  onAnyEdit(): void { this.documentDirty.setDirty(true); }

  ngOnDestroy(): void { this.documentDirty.setDirty(false); }

  setPrezzoFromInput(riga: RigaDocumento, event: Event) {
    const v = +(event.target as HTMLInputElement).value;
    riga.prezzo = prezzoNettoDaInput(v, riga.iva, this.showNetto);
  }

  addDdt() {
    const id = this.ddtSelezione;
    if (!id) return;
    this.ddtSelezione = null;
    if (this.linkedDdts.some(d => d.id === id)) return;

    this.ds.getDdtById(id).subscribe(ddt => {
      this.linkedDdts.push(ddt);

      // Rimuove la riga placeholder vuota iniziale
      if (this.righe.length === 1) {
        const r = this.righe[0];
        if (!r.descrizione?.trim() && !r.prodottoId) {
          this.righe.splice(0, 1);
          this.prezziRecenti.splice(0, 1);
          this.prezziRecentiTutti.splice(0, 1);
          this.tuttiCaricati.splice(0, 1);
        }
      }

      const [year, month, day] = ddt.dataEmissione.split('T')[0].split('-');
      const dataFmt = `${day}/${month}/${year}`;

      // Riga di intestazione con il riferimento al DDT
      this.righe.push({ descrizione: `Riferimento documento di trasporto n. ${ddt.numero} del ${dataFmt}`, quantita: 0, prezzo: 0, sconto: 0, iva: 0, unitaMisura: '' });
      this.prezziRecenti.push([]);
      this.prezziRecentiTutti.push([]);
      this.tuttiCaricati.push(false);

      // Righe prodotti del DDT
      if (ddt.righe?.length) {
        this.righe.push(...ddt.righe.map(r => ({ ...r, id: undefined })));
        this.prezziRecenti.push(...new Array(ddt.righe.length).fill([]));
        this.prezziRecentiTutti.push(...new Array(ddt.righe.length).fill([]));
        this.tuttiCaricati.push(...new Array(ddt.righe.length).fill(false));
      }
    });
  }

  removeDdt(ddtId: number) {
    this.linkedDdts = this.linkedDdts.filter(d => d.id !== ddtId);
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

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private snack: MatSnackBar,
    private printSvcDialog: PrintService,
    private docLockSvc: DocLockService,
    private documentDirty: DocumentDirtyService,
    public dialogRef: MatDialogRef<FatturaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Fattura | null
  ) {
    this.isNew = !data?.id;
    this.locked = !!data?.id && this.docLockSvc.enabled;
    this.selectedTipoPagamentoId = data?.tipoPagamentoId ?? null;
    this.applyFiscFrom(data);
    this.numeriEsistenti = setNumeriEsistenti((data as any)?.numeriEsistenti);
    this.form = this.fb.group({
      numero: [data?.numero ?? '', [Validators.required, numeroUnivocoValidator(() => this.numeriEsistenti)]],
      dataEmissione: [data?.dataEmissione ?? new Date().toISOString().substring(0, 10), Validators.required],
      note: [data?.note ?? ''],
      agenteId: [data?.agenteId ?? null],
      provvigione: [data?.provvigione ?? null],
    });
    this.ds.getAgenti().subscribe(a => this.agenti = a.filter(x => x.attivo));
    if (data?.id) {
      this.ds.getFatturaById(data.id).subscribe(f => {
        this.righe = this.normalizeRighe(f.righe ?? []);
        this.applyFiscFrom(f);
        this.riferimenti = f.riferimenti ?? [];
        this.prezziRecenti = new Array(this.righe.length).fill([]);
        this.prezziRecentiTutti = new Array(this.righe.length).fill([]);
        this.tuttiCaricati = new Array(this.righe.length).fill(false);
        // Carica i prezzi recenti per le righe già esistenti, così il bottone
        // "history" appare anche quando si riapre un documento salvato.
        this.righe.forEach((r, i) => { if (r.prodottoId) this.loadPrezziRecenti(i); });
        if (f.ddtIds?.length) {
          f.ddtIds.forEach(ddtId => {
            this.ds.getDdtById(ddtId).subscribe(ddt => this.linkedDdts.push(ddt));
          });
        }
      });
    } else if (data?.righe?.length) {
      this.righe = this.normalizeRighe([...data.righe]);
      this.prezziRecenti = new Array(this.righe.length).fill([]);
      this.prezziRecentiTutti = new Array(this.righe.length).fill([]);
      this.tuttiCaricati = new Array(this.righe.length).fill(false);
      const preIds: number[] = data.ddtIds?.length ? data.ddtIds : (data.ddtId ? [data.ddtId] : []);
      preIds.forEach(id => this.ds.getDdtById(id).subscribe(ddt => this.linkedDdts.push(ddt)));
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
      if (v && typeof v !== 'string' && this.isNew) {
        const c = v as Cliente;
        if (!this.selectedTipoPagamentoId && c.tipoPagamentoId)
          this.selectedTipoPagamentoId = c.tipoPagamentoId;
        // Eredita l'agente del cliente se non già impostato sulla fattura.
        if (!this.form.get('agenteId')?.value && c.agenteId)
          this.form.patchValue({ agenteId: c.agenteId, provvigione: c.provvigione ?? null });
        // Se c'è una sola riga vuota, aggiorna l'IVA con quella del cliente
        if (c.aliquotaIvaId && this.aliquoteIva.length) {
          const aliq = this.aliquoteIva.find(a => a.id === c.aliquotaIvaId);
          if (aliq && this.righe.length === 1 && !this.righe[0].descrizione?.trim() && !this.righe[0].prodottoId) {
            this.righe[0].iva = aliq.valore;
            this.righe[0].codiceIva = aliq.codice ?? '';
          }
        }
        // Suggerisce prodotti basati sullo storico per questo cliente
        if (c.id) this.loadSuggerimentiCliente(c.id);
      } else {
        this.suggerimenti = [];
      }
    });

    // Nuovo documento: precompila i dati fiscali dai default azienda (se l'utente
    // non li ha già toccati).
    if (this.isNew) {
      this.ds.getAzienda().subscribe(az => {
        if (!az || this.fisc.ritenutaAliquota || this.fisc.cassaAliquota || this.fisc.bollo) return;
        this.fisc.ritenutaAliquota = Number(az.ritenutaAliquotaDefault) || 0;
        this.fisc.ritenutaCausale = az.ritenutaCausaleDefault || '';
        this.fisc.ritenutaTipo = az.ritenutaTipoDefault || 'RT02';
        this.fisc.cassaTipo = az.cassaTipoDefault || '';
        this.fisc.cassaAliquota = Number(az.cassaAliquotaDefault) || 0;
        this.fisc.cassaIva = Number(az.cassaIvaDefault) || 0;
        if (this.fisc.ritenutaAliquota || this.fisc.cassaAliquota) this.showFiscale = true;
      });
    }

    this.ds.getClienti().subscribe(c => {
      this.clienti = c;
      this.filteredClienti = c;
      if (this.data?.clienteId) {
        const found = c.find(x => x.id === this.data!.clienteId);
        if (found) {
          this.clienteCtrl.setValue(found, { emitEvent: false });
          if (this.isNew && found.id) this.loadSuggerimentiCliente(found.id);
        }
      }
    });

    this.ds.getDdt().subscribe(d => this.ddts = d);
    this.ds.getProdotti().subscribe(p => this.prodotti = p);
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getTipiPagamento().subscribe(t => this.tipiPagamento = t.filter(x => x.attivo));
    this.ds.getAliquoteIva().subscribe(a => this.aliquoteIva = a.filter(x => x.attiva));
    this.ds.getNoteRapide().subscribe(n => this.noteRapideList = n);
    this.loadPagamenti();

    if (this.isNew && !this.data?.numero) {
      this.ds.getNextNumero('fatture').subscribe(n => this.form.patchValue({ numero: String(n.numero) }));
    }
  }

  displayCliente(c: Cliente | string | null): string {
    return c && typeof c !== 'string' ? (c as Cliente).ragioneSociale : '';
  }

  autoSelectCliente() {
    if (this.filteredClienti.length > 0) this.clienteCtrl.setValue(this.filteredClienti[0]);
  }

  searchProdotto(index: number, lista?: Prodotto[]) {
    const query = (this.righe[index]?.codiceProdotto ?? '').toString().trim();
    this.matDialog.open(ProdottoPickerComponent, { width: '650px', data: { prodotti: lista ?? this.prodotti, query } })
      .afterClosed().subscribe((pick: ProdottoPick) => {
        if (!pick) return;
        this.applyProdottoToRiga(index, pick.prodotto, pick.variante);
      });
  }

  /** Riempie la riga coi dati del prodotto. Riusato dal selettore e dall'inserimento via codice. */
  private applyProdottoToRiga(index: number, p: Prodotto, v?: ProdottoVariante) {
    const varSuffix = v ? ` (${[v.taglia, v.colore].filter(Boolean).join(' / ')})` : '';
    const { iva, codiceIva } = this.resolveIvaPerProdotto(p.iva ?? 22);
    this.righe[index].codiceProdotto = p.codice ?? '';
    this.righe[index].descrizione = (p.descrizione || p.nome) + varSuffix;
    this.righe[index].prezzo = p.prezzo ?? 0;
    this.righe[index].iva = iva;
    this.righe[index].codiceIva = codiceIva;
    this.righe[index].unitaMisura = p.unitaMisura ?? '';
    this.righe[index].prodottoId = p.id ?? null;
    this.righe[index].varianteId = v?.id ?? null;
    this.righe[index].varianteTaglia = v?.taglia ?? '';
    this.righe[index].varianteColore = v?.colore ?? '';
    // Di default una riga prodotto scarica il magazzino (se non già impostato).
    if (this.righe[index].scaricaMagazzino === undefined) this.righe[index].scaricaMagazzino = true;
    this.applyListino(index);
    this.loadPrezziRecenti(index);
  }

  /** Crea al volo un prodotto non a catalogo a partire dai dati della riga, poi lo collega. */
  creaProdottoPerRiga(index: number, event?: Event) {
    event?.preventDefault();
    const riga = this.righe[index];
    if (!riga || riga.prodottoId) return;
    creaProdottoDaRiga(this.matDialog, this.ds, riga).subscribe({
      next: nuovo => {
        if (!nuovo) return;
        this.prodotti = [...this.prodotti, nuovo];
        this.applyProdottoToRiga(index, nuovo);
        this.righe[index].scaricaMagazzino = true;
        this.snack.open(this.i18n.t('fatture.dialog.msg.prodottoCreatoCollegato', { nome: nuovo.nome }), '', { duration: 2500 });
      },
      error: e => this.snack.open(e?.error?.error || e?.message || this.i18n.t('fatture.dialog.msg.erroreCreazioneProdotto'), '', { duration: 3500 }),
    });
  }

  /**
   * Inserimento rapido da tastiera: si digita il codice (o parte) e si preme Invio.
   *  - match esatto su codice/barcode → inserisce e passa alla riga successiva
   *  - un solo match parziale → inserisce quel prodotto
   *  - più match → apre il selettore già filtrato
   *  - nessun match → avviso, resta sulla riga
   */
  risolviCodiceRiga(index: number, event: Event) {
    const ke = event as KeyboardEvent;
    if (ke.ctrlKey || ke.metaKey) return;   // Ctrl/Cmd+Invio = salva (gestito da onDialogKeydown)
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
    if (next) {
      setTimeout(() => { next.nativeElement.focus(); next.nativeElement.select(); }, 0);
    } else {
      this.addRiga();
      this.cdr.detectChanges();
      setTimeout(() => {
        const arr = this.codiceInputs.toArray();
        const el = arr[arr.length - 1]?.nativeElement;
        if (el) { el.focus(); el.select(); }
      }, 0);
    }
  }

  /** Risolve il prezzo del prodotto secondo il listino del cliente */
  private applyListino(index: number) {
    const riga = this.righe[index];
    const v = this.clienteCtrl.value;
    const clienteId = v && typeof v !== 'string' ? (v as Cliente).id : null;
    if (!clienteId || !riga.prodottoId) return;
    this.ds.resolvePrezzoCliente(clienteId, riga.prodottoId).subscribe(r => {
      if (r.sorgente === 'BASE') return;
      riga.prezzo = r.prezzo;
      riga.sconto = r.sconto;
      if (r.listinoNome) {
        this.snack.open(this.i18n.t('fatture.dialog.msg.prezzoListinoApplicato', { nome: r.listinoNome }), '', { duration: 2200 });
      }
    });
  }

  roundIfPz(riga: RigaDocumento) {
    if (riga.unitaMisura === 'pz') riga.quantita = Math.max(1, Math.round(riga.quantita || 1));
    else riga.quantita = Math.max(0.001, riga.quantita || 0.001);
  }
  clampSconto(riga: RigaDocumento) {
    riga.sconto = Math.min(100, Math.max(0, riga.sconto ?? 0));
  }

  resolveAliquotaCodice(iva: number): string {
    const match = this.aliquoteIva.find(a => a.valore === iva && a.categoria === 'Imponibile');
    return match?.codice ?? this.aliquoteIva.find(a => a.valore === iva)?.codice ?? '';
  }

  onAliquotaChange(riga: RigaDocumento, codice: string) {
    const a = this.aliquoteIva.find(x => x.codice === codice);
    if (a) { riga.iva = a.valore; riga.codiceIva = a.codice; }
  }

  private getClienteAliquota(): AliquotaIva | null {
    const v = this.clienteCtrl.value;
    const cliente = v && typeof v !== 'string' ? v as Cliente : null;
    if (cliente?.aliquotaIvaId && this.aliquoteIva.length) {
      return this.aliquoteIva.find(x => x.id === cliente.aliquotaIvaId) ?? null;
    }
    return null;
  }

  private resolveIvaPerProdotto(productIva: number): { iva: number; codiceIva: string } {
    const clienteAliq = this.getClienteAliquota();

    if (!clienteAliq) {
      return { iva: productIva, codiceIva: this.resolveAliquotaCodice(productIva) };
    }

    if (clienteAliq.categoria === 'Split payment') {
      const spVariant = this.aliquoteIva.find(
        a => a.categoria === 'Split payment' && a.valore === productIva
      );
      if (spVariant) return { iva: spVariant.valore, codiceIva: spVariant.codice ?? '' };
      // variante split payment non disponibile per questo valore: usa l'aliquota del cliente
      return { iva: clienteAliq.valore, codiceIva: clienteAliq.codice ?? '' };
    }

    // cliente con aliquota non-split payment: applica l'override cliente (comportamento attuale)
    return { iva: clienteAliq.valore, codiceIva: clienteAliq.codice ?? '' };
  }

  private getClienteDefaultIva(): { iva: number; codiceIva: string } {
    const clienteAliq = this.getClienteAliquota();
    if (clienteAliq) return { iva: clienteAliq.valore, codiceIva: clienteAliq.codice ?? '' };
    return { iva: 22, codiceIva: this.resolveAliquotaCodice(22) };
  }

  addRiferimento() {
    this.riferimenti.push({ tipo: 'ORDINE_ACQUISTO', numero: '', data: '', cig: '', cup: '', commessa: '' });
  }
  removeRiferimento(i: number) { this.riferimenti.splice(i, 1); }

  /** Le righe prodotto senza il flag definito ereditano scaricaMagazzino=true (default storico). */
  private normalizeRighe(righe: RigaDocumento[]): RigaDocumento[] {
    return righe.map(r => (r.tipo !== 'NOTA' && r.prodottoId && r.scaricaMagazzino === undefined)
      ? { ...r, scaricaMagazzino: true } : r);
  }
  addRiga() {
    const { iva, codiceIva } = this.getClienteDefaultIva();
    this.righe.push({ tipo: 'PRODOTTO', descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva, codiceIva, scaricaMagazzino: true });
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

  printFromDialog() { if (this.data?.id) this.printSvcDialog.printFattura(this.data.id); }

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

  /** Costruisce l'oggetto fattura da form+stato del dialog. Riusato sia da `save()`
   *  (chiude il dialog, salva la lista) sia da `salvaEStampa()` (salva senza chiudere). */
  private buildResult(): any {
    const v = this.clienteCtrl.value;
    const clienteId = v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
    const clienteNome = v && typeof v !== 'string' ? (v as Cliente).ragioneSociale : (this.data?.clienteNome ?? '');
    return {
      ...this.data, ...this.form.value, clienteId, clienteNome,
      stato: this.data?.stato ?? 'EMESSA',
      tipoPagamentoId: this.selectedTipoPagamentoId,
      ddtIds: this.linkedDdts.map(d => d.id).filter(Boolean),
      righe: this.righe,
      riferimenti: this.riferimenti.filter(r => r.numero.trim()),
      // Dati fiscali (ritenuta / cassa / bollo)
      ritenutaAliquota: this.fisc.ritenutaAliquota || 0,
      ritenutaCausale: this.fisc.ritenutaCausale || '',
      ritenutaTipo: this.fisc.ritenutaTipo || 'RT02',
      cassaTipo: this.fisc.cassaTipo || '',
      cassaAliquota: this.fisc.cassaAliquota || 0,
      cassaIva: this.fisc.cassaIva || 0,
      bollo: this.fisc.bollo,
    };
  }

  save() {
    this.submitted = true;
    if (!this.canSave) return;
    this.draft.clear(this.draftTipo);
    this.dialogRef.close(this.buildResult());
  }

  /** Salva (con gli stessi controlli di duplicato/insoluti del salvataggio da
   *  lista) SENZA chiudere il dialog, poi stampa e blocca il documento. */
  salvaEStampa() {
    this.submitted = true;
    if (!this.canSave || this.salvandoEStampando) return;
    this.salvandoEStampando = true;
    const result = this.buildResult();
    salvaFatturaConControlli({
      result,
      esistenti: (this.data as any)?._fattureEsistenti ?? [],
      notificheConfig: (this.data as any)?._notificheConfig ?? {},
      ds: this.ds, dialog: this.matDialog, confirm: this.confirm, i18n: this.i18n, snack: this.snack,
      onAnnullato: () => { this.salvandoEStampando = false; },
      onSalvato: (id) => {
        this.salvandoEStampando = false;
        this.draft.clear(this.draftTipo);
        this.data = { ...this.data, ...result, id };
        this.locked = true;
        this.printSvcDialog.printFattura(id);
        this.snack.open(this.i18n.t('fatture.msg.salvato'), '', { duration: 2000 });
      },
    });
  }
}

/** Controlli "morbidi" (anti-duplicato, fatture insolute) + salvataggio, condivisi
 *  tra il salvataggio da lista (chiude il dialog) e "Salva e stampa" dal dialog
 *  stesso (non lo chiude) — stesso comportamento, cambia solo chi la chiama. */
function salvaFatturaConControlli(ctx: {
  result: any;
  esistenti: Fattura[];
  notificheConfig: NotificheConfig;
  ds: DataService;
  dialog: MatDialog;
  confirm: ConfirmService;
  i18n: I18nService;
  snack: MatSnackBar;
  onSalvato: (id: number) => void;
  onAnnullato?: () => void;
}) {
  const { result, esistenti, notificheConfig, ds, dialog, confirm, i18n, snack, onSalvato, onAnnullato } = ctx;
  const salva = () => {
    const op = result.id ? ds.updateFattura(result) : ds.createFattura(result);
    op.subscribe({
      next: (res: any) => onSalvato(result.id ?? res?.id),
      error: (e: any) => { snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }); onAnnullato?.(); },
    });
  };
  const conInsoluti = () => {
    if (!result.id && notificheConfig.avvisoInsolutiFattura && result.clienteId) {
      ds.getFattureInsoluteCliente(result.clienteId).subscribe({
        next: (fatture: any[]) => {
          if (fatture.length > 0) {
            dialog.open(FattureInsoluteDialogComponent, {
              data: { clienteNome: result.clienteNome || '', fatture },
              width: '560px', maxWidth: '98vw',
            }).afterClosed().subscribe((procedi: boolean) => { if (procedi) salva(); else onAnnullato?.(); });
          } else {
            salva();
          }
        },
        error: () => salva(),
      });
    } else {
      salva();
    }
  };
  if (!result.id && result.clienteId) {
    const tot = (result.righe || []).reduce((s: number, r: any) =>
      s + (r.quantita || 0) * (r.prezzo || 0) * (1 - (r.sconto || 0) / 100) * (1 + (r.iva || 0) / 100), 0);
    const dup = esistenti.find(f =>
      f.stato !== 'ANNULLATA' && f.clienteId === result.clienteId &&
      f.dataEmissione === result.dataEmissione && Math.abs((f.totale ?? 0) - tot) < 0.01);
    if (dup) {
      confirm.ask({
        title: i18n.t('fatture.msg.possibileDuplicatoTitle'),
        message: i18n.t('fatture.msg.possibileDuplicatoMessage', { numero: dup.numero!, importo: tot.toFixed(2) }),
        confirmText: i18n.t('fatture.msg.creaComunque'), danger: true,
      }).then((ok: boolean) => { if (ok) conInsoluti(); else onAnnullato?.(); });
      return;
    }
  }
  conInsoluti();
}

@Component({
  selector: 'app-fatture',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
            MatSelectModule, MatPaginatorModule, MatMenuModule, MatDividerModule, EmptyStateComponent,
            LoadingSkeletonComponent, TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './fatture.html',
  styleUrl: './fatture.scss'
})
export class FattureComponent implements OnInit, AfterViewInit {
  private confirm = inject(ConfirmService);
  private viewState = inject(ViewStateService);
  i18n = inject(I18nService);
  private allFatture: Fattura[] = [];
  loading = true;
  dataSource = new MatTableDataSource<Fattura>();
  displayedColumns = ['select', 'numero', 'dataEmissione', 'clienteNome', 'totale', 'stato', 'azioni'];
  selection = new SelectionModel<Fattura>(true, []);

  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));
  // Filtri multipli: ogni select tiene una lista di valori (array vuoto = "tutti").
  // Così si possono vedere insieme più clienti, più anni, più stati, ecc.
  filtroAnni: number[] = [];
  filtroMesi: number[] = [];
  filtroClienti: number[] = [];
  filtroStati: string[] = [];
  filtroDaPagare = false;
  busy = false;

  get anni() { return [...new Set(this.allFatture.map(f => +f.dataEmissione.substring(0, 4)))].sort().reverse(); }
  get daPagareCount() { return this.allFatture.filter(f => f.stato === 'EMESSA').length; }
  get clientiList() {
    const map = new Map<number, string>();
    this.allFatture.forEach(f => { if (f.clienteId) map.set(f.clienteId, f.clienteNome ?? ''); });
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  notificheConfig: NotificheConfig = {};

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
    // Ripristino filtri/ordinamento dalla sessione precedente (prima del prefill,
    // così un'eventuale apertura "filtrata da cliente" prevale sullo stato salvato).
    const vs = this.viewState.read<any>('fatture');
    if (vs) {
      if (Array.isArray(vs.filtroAnni)) this.filtroAnni = vs.filtroAnni;
      if (Array.isArray(vs.filtroMesi)) this.filtroMesi = vs.filtroMesi;
      if (Array.isArray(vs.filtroClienti)) this.filtroClienti = vs.filtroClienti;
      if (Array.isArray(vs.filtroStati)) this.filtroStati = vs.filtroStati;
      if (typeof vs.filtroDaPagare === 'boolean') this.filtroDaPagare = vs.filtroDaPagare;
    }
    // Apertura da scheda cliente ("Fatture" nel kebab): filtra subito su quel cliente.
    const fc = consumePrefill<number>('filtroCliente');
    if (fc) { this.filtroAnni = []; this.filtroMesi = []; this.filtroStati = []; this.filtroDaPagare = false; this.filtroClienti = [fc]; }
    this.load();
    this.ds.getAzienda().subscribe(a => {
      this.notificheConfig = a.notificheConfig ?? { avvisoInsolutiDdt: true, avvisoInsolutiFattura: true };
    });
    const bozza = consumePrefill('nuovaBozza');
    if (bozza) setTimeout(() => this.open(bozza as Fattura), 0);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    const vs = this.viewState.read<any>('fatture');
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
    this.loading = true;
    this.ds.getFatture().subscribe({
      next: f => {
        this.allFatture = f;
        this.applyFilters();
        this.selection.clear();
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  applyFilters() {
    let data = this.allFatture;
    if (this.filtroAnni.length) data = data.filter(f => this.filtroAnni.includes(+f.dataEmissione.substring(0, 4)));
    if (this.filtroMesi.length) data = data.filter(f => this.filtroMesi.includes(+f.dataEmissione.substring(5, 7)));
    if (this.filtroClienti.length) data = data.filter(f => f.clienteId != null && this.filtroClienti.includes(f.clienteId));
    if (this.filtroStati.length) data = data.filter(f => this.filtroStati.includes(f.stato));
    if (this.filtroDaPagare) data = data.filter(f => f.stato === 'EMESSA');
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
    this.saveViewState();
  }

  /** Persiste filtri e ordinamento correnti per ritrovarli alla riapertura. */
  saveViewState(): void {
    this.viewState.write('fatture', {
      filtroAnni: this.filtroAnni,
      filtroMesi: this.filtroMesi,
      filtroClienti: this.filtroClienti,
      filtroStati: this.filtroStati,
      filtroDaPagare: this.filtroDaPagare,
      sortActive: this.sort?.active ?? null,
      sortDir: this.sort?.direction ?? null,
    });
  }

  resetFiltri() {
    this.filtroAnni = []; this.filtroMesi = []; this.filtroClienti = []; this.filtroStati = []; this.filtroDaPagare = false;
    this.dataSource.filter = '';
    this.applyFilters();
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
    const body = rows.map(f=>`<tr><td>${f.numero}</td><td>${d(f.dataEmissione)}</td><td>${f.clienteNome||'—'}</td><td class="r">${e(f.totale)}</td><td>${f.stato}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('nav.fatture')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${t('nav.fatture')}</h1><table><thead><tr><th>${t('fatture.col.numero')}</th><th>${t('fatture.col.data')}</th><th>${t('fatture.col.cliente')}</th><th class="r">${t('fatture.col.importo')}</th><th>${t('fatture.col.stato')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('fatture.col.numero'),     field: 'numero',        width: 16 },
    { header: this.i18n.t('fatture.col.data'),       field: 'dataEmissione', width: 14 },
    { header: this.i18n.t('fatture.col.cliente'),    field: 'clienteNome',   width: 30 },
    { header: this.i18n.t('fatture.col.imponibile'), field: 'imponibile',    width: 14 },
    { header: this.i18n.t('fatture.col.importo'),    field: 'totale',        width: 14 },
    { header: this.i18n.t('fatture.col.stato'),      field: 'stato',         width: 14 },
  ];
  /** Righe da esportare: le selezionate se ce ne sono, altrimenti tutta la lista. */
  get exportRows(): any[] { return this.selection.hasValue() ? this.selection.selected : this.dataSource.data; }

  get totaleLista(): number {
    return this.dataSource.data.reduce((s, r) => s + (Number(r.totale) || 0), 0);
  }

  get fatture() { return this.dataSource.data; }
  /** Somma dei soli documenti selezionati (per la barra totali in fondo alla lista). */
  get totaleSelezione(): number { return this.selection.selected.reduce((s, x) => s + (Number((x as any).totale) || 0), 0); }
  hasActiveFilters() { return !!(this.filtroAnni.length || this.filtroMesi.length || this.filtroClienti.length || this.filtroStati.length || this.filtroDaPagare || this.dataSource.filter); }
  isAllSelected() { return this.allFatture.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  setStato(f: Fattura, stato: string) {
    this.busy = true;
    this.ds.setFatturaStato(f.id!, stato).subscribe({
      next: () => { this.busy = false; this.load(); },
      error: e => { this.busy = false; this.snack.open(e.message || this.i18n.t('fatture.msg.erroreAggiornamentoStato'), 'OK', { duration: 4000, panelClass: 'snack-error' }); }
    });
  }
  bulkSetStato(stato: string) {
    const selezionate = this.selection.selected;
    if (!selezionate.length || this.busy) return;
    this.busy = true;
    forkJoin(selezionate.map(f =>
      this.ds.setFatturaStato(f.id!, stato).pipe(catchError(err => of({ __error: err, fattura: f })))
    )).subscribe(results => {
      this.busy = false;
      const errori = results.filter((r: any) => r && r.__error);
      if (errori.length) {
        this.snack.open(this.i18n.tn('fatture.msg.nonAggiornate', errori.length), 'OK', { duration: 5000, panelClass: 'snack-error' });
      } else {
        this.snack.open(this.i18n.tn('fatture.msg.aggiornate', selezionate.length), '', { duration: 2500, panelClass: 'snack-ok' });
      }
      this.selection.clear();
      this.load();
    });
  }

  async bulkElimina() {
    const sel = this.selection.selected;
    if (!sel.length || this.busy) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('fatture.msg.confirmBulkDelete', n))) return;
    this.busy = true;
    // Cattura i documenti completi PRIMA di eliminarli, così "ANNULLA" può ricrearli.
    forkJoin(sel.map(f => this.ds.getFatturaById(f.id!).pipe(catchError(() => of(null))))).subscribe(fulls => {
      const backups = fulls.filter(Boolean);
      forkJoin(sel.map(f => this.ds.deleteFattura(f.id!).pipe(catchError(err => of({ __error: err }))))).subscribe(results => {
        this.busy = false;
        const errori = results.filter((r: any) => r && r.__error).length;
        this.selection.clear();
        this.load();
        const msg = errori
          ? `${this.i18n.tn('fatture.msg.eliminate', n - errori)}, ${this.i18n.tn('fatture.msg.nonEliminabili', errori)}`
          : this.i18n.tn('fatture.msg.eliminate', n);
        const ref = this.snack.open(msg, this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createFattura(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('fatture.msg.fattureRipristinate'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      });
    });
  }

  openGeneraDaDdt() {
    const ref = this.dialog.open(GeneraFattureDaDdtDialogComponent, {
      width: '700px', maxWidth: '98vw', maxHeight: '92vh'
    });
    ref.afterClosed().subscribe((result: any[]) => {
      if (!result?.length) return;
      this.load();
      this.snack.open(this.i18n.tn('fatture.msg.fattureGenerate', result.length), '', { duration: 3000 });
    });
  }

  open(f?: Fattura) {
    const numeriEsistenti = this.allFatture.filter(x => x.id !== f?.id).map(x => x.numero);
    const ref = this.dialog.open(FatturaDialogComponent, {
      data: {
        ...(f ?? {}), numeriEsistenti,
        // Contesto per i controlli di "Salva e stampa" dentro il dialog stesso
        // (stessi controlli del salvataggio da lista, vedi salvaFatturaConControlli).
        _fattureEsistenti: this.dataSource.data,
        _notificheConfig: this.notificheConfig,
      },
      width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      salvaFatturaConControlli({
        result,
        esistenti: this.dataSource.data,
        notificheConfig: this.notificheConfig,
        ds: this.ds, dialog: this.dialog, confirm: this.confirm, i18n: this.i18n, snack: this.snack,
        onSalvato: () => { this.load(); this.snack.open(this.i18n.t('fatture.msg.salvato'), '', { duration: 2000 }); },
      });
    });
  }

  printDoc(f: Fattura) { this.printSvc.printFattura(f.id!); }

  downloadXml(f: Fattura) {
    const a = document.createElement('a');
    a.href = `${environment.apiUrl}/fattura-xml/${f.id}`;
    a.download = `FatturaPA_${f.numero}.xml`;
    a.click();
  }

  inviaEmail(f: Fattura) {
    forkJoin({ az: this.ds.getAzienda(), clienti: this.ds.getClienti() }).subscribe(({ az, clienti }) => {
      const cliente = clienti.find(c => c.id === f.clienteId);
      const ref = this.dialog.open(EmailDialogComponent, {
        width: '560px', maxWidth: '95vw',
        data: {
          title: this.i18n.t('fatture.msg.inviaEmailTitle', { numero: f.numero! }),
          subtitle: cliente?.ragioneSociale ? this.i18n.t('fatture.msg.inviaEmailA', { nome: cliente.ragioneSociale }) : undefined,
          destinatario: cliente?.email || '',
          testo: az?.emailCorpoDocumento || '',
        },
      });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.sendFatturaEmail(f.id!, result.destinatario, result.testo || undefined).subscribe({
          next: () => this.snack.open(this.i18n.t('fatture.msg.emailInviata'), '', { duration: 2000 }),
          error: e => this.snack.open(this.i18n.t('fatture.msg.erroreEmail', { msg: e.error?.error || e.message }), '', { duration: 4000 })
        });
      });
    });
  }


  inviaSdi(f: Fattura) {
    this.ds.validateFatturaXml(f.id!).subscribe({
      next: async v => {
        if (!v.ok) {
          await this.confirm.alert({
            title: this.i18n.t('fatture.msg.fatturaNonInviabileTitle'),
            message: this.i18n.t('fatture.msg.fatturaNonInviabileMsg') + '\n\n' +
                     v.errors.map(e => '• ' + e).join('\n') +
                     (v.warnings.length ? '\n\n' + this.i18n.t('fatture.msg.avvisiLabel') + '\n' + v.warnings.map(w => '• ' + w).join('\n') : ''),
          });
          return;
        }
        const prefix = v.warnings.length
          ? `${this.i18n.t('fatture.msg.avvisiLabel')}\n${v.warnings.map(w => '• ' + w).join('\n')}\n\n`
          : '';
        if (!await this.confirm.ask(`${prefix}${this.i18n.t('fatture.msg.confermaInvioSdi', { numero: f.numero! })}`)) return;
        this.ds.inviaFatturaSdi(f.id!).subscribe({
          next: r => { this.load(); this.snack.open(this.i18n.t('fatture.msg.inviataSdi', { id: r.idTrasmissione }), '', { duration: 4000, panelClass: 'snack-ok' }); },
          error: e => {
            const msg = e.error?.error || e.message || '';
            if (msg.includes('SDI non configurata')) {
              // Nessun intermediario configurato (Impostazioni → SDI): non è un
              // errore da far scomparire in un toast, è il fallback previsto —
              // scaricare l'XML e caricarlo a mano resta sempre possibile.
              const ref = this.snack.open(
                this.i18n.t('fatture.msg.sdiNonConfigurato'),
                this.i18n.t('fatture.msg.scaricaXmlBtn'), { duration: 9000, panelClass: 'snack-error' }
              );
              ref.onAction().subscribe(() => this.downloadXml(f));
            } else {
              this.snack.open(this.i18n.t('fatture.msg.erroreSdi', { msg }), '', { duration: 5000, panelClass: 'snack-error' });
            }
          }
        });
      },
      error: () => this.snack.open(this.i18n.t('fatture.msg.erroreControlloFattura'), 'OK',
                                   { duration: 5000, panelClass: 'snack-error' })
    });
  }

  info(f: Fattura) {
    this.ds.getFatturaPrint(f.id!).subscribe(doc => {
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      const extra: { label: string; value: string }[] = [];
      if (doc.tipoPagamentoNome) extra.push({ label: this.i18n.t('fatture.info.pagamento'), value: doc.tipoPagamentoNome });
      if (doc.statoSdi) extra.push({ label: this.i18n.t('fatture.info.sdi'), value: doc.statoSdi });
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: 'FATTURA', numero: doc.numero, data: doc.dataEmissione, stato: doc.stato,
          controparteLabel: this.i18n.t('fatture.info.cliente'),
          controparte: doc.cliente?.ragioneSociale || f.clienteNome || '—',
          controparteInfo: [
            [doc.cliente?.via, [doc.cliente?.cap, doc.cliente?.citta].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            doc.cliente?.pIva ? `P.IVA: ${doc.cliente.pIva}` : '',
            doc.cliente?.email ?? '',
          ].filter(Boolean) as string[],
          totale: imponibile + ivaT,
          imponibile,
          righe,
          extraFields: extra,
          note: doc.note,
        } as DocInfoData,
        width: '720px', maxWidth: '98vw', maxHeight: '92vh',
      });
    });
  }

  /** Id delle fatture in corso di duplicazione: evita un doppio clic rapido sul
   *  kebab → "Duplica" (il menu si chiude subito, quindi non basta disabilitare
   *  il bottone) che creerebbe due copie della stessa fattura. */
  private duplicating = new Set<number>();

  duplicate(f: Fattura) {
    if (!f.id || this.duplicating.has(f.id)) return;
    this.duplicating.add(f.id);
    const fine = () => this.duplicating.delete(f.id!);
    forkJoin({ full: this.ds.getFatturaById(f.id!), num: this.ds.getNextNumero('fatture') }).subscribe({
      next: ({ full, num }) => {
        const { id, ...pre } = full as any;
        pre.numero = String(num.numero);
        pre.dataEmissione = new Date().toISOString().substring(0, 10);
        pre.stato = 'EMESSA';
        pre.ddtIds = [];
        this.ds.createFattura(pre).subscribe({
          next: () => { fine(); this.load(); this.snack.open(this.i18n.t('fatture.msg.fatturaDuplicata', { numero: pre.numero! }), '', { duration: 2500, panelClass: 'snack-ok' }); },
          error: e => { fine(); this.snack.open(e.message || this.i18n.t('fatture.msg.erroreDuplicazione'), 'OK', { duration: 4000, panelClass: 'snack-error' }); }
        });
      },
      error: e => { fine(); this.snack.open(this.i18n.t('fatture.msg.errore', { msg: e.message || '' }), 'OK', { duration: 4000 }); }
    });
  }

  async delete(f: Fattura) {
    if (!await this.confirm.delete(this.i18n.t('fatture.msg.confirmDelete', { numero: f.numero! }))) return;
    this.ds.getFatturaById(f.id!).subscribe(full => {
      this.ds.deleteFattura(f.id!).subscribe(() => {
        this.load();
        const ref = this.snack.open(this.i18n.t('fatture.msg.fatturaEliminata', { numero: f.numero! }), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          const { id, ...payload } = full as any;
          this.ds.createFattura(payload).subscribe({
            next: () => { this.load(); this.snack.open(this.i18n.t('fatture.msg.fatturaRipristinata'), '', { duration: 2000, panelClass: 'snack-ok' }); },
            error: e => this.snack.open(this.i18n.t('fatture.msg.ripristinoFallito', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
          });
        });
      });
    });
  }
}
