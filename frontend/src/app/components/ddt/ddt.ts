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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatTabsModule } from '@angular/material/tabs';
import { SelectionModel } from '@angular/cdk/collections';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { ViewStateService } from '../../services/view-state.service';

import { Ddt, Fattura, Cliente, Fornitore, ClienteIndirizzo, Prodotto, RigaDocumento, UnitaMisura, NotaRapida, NotificheConfig } from '../../models';
import { consumePrefill } from '../../utils/nav-prefill';
import { findProdottoByCodice } from '../../utils/prodotto-match';
import { scrollFocusLastRiga } from '../../utils/scroll';
import { numeroUnivocoValidator, setNumeriEsistenti } from '../../utils/numero-univoco';
import { docRigaTotale, prezzoNettoDaInput } from '../../utils/doc-calc';
import { ProdottoPickerComponent, ProdottoPick } from '../shared/prodotto-picker';
import { creaProdottoDaRiga } from '../../utils/crea-prodotto-da-riga';
import { FatturaDialogComponent } from '../fatture/fatture';
import { DocInfoDialogComponent, DocInfoData } from '../shared/doc-info-dialog';
import { FattureInsoluteDialogComponent } from '../shared/fatture-insolute-dialog';
import { EmailDialogComponent } from '../shared/email-dialog';
import { CopiaRigheDialogComponent, CopiaRigheDialogData } from '../shared/copia-righe-dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocLockService } from '../../services/doc-lock.service';
import { DocumentDirtyService } from '../../services/document-dirty.service';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

@Component({
  selector: 'app-ddt-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule,
    MatAutocompleteModule, MatTableModule, MatIconModule,
    MatButtonToggleModule, MatMenuModule, MatTabsModule, MatTooltipModule, MatProgressSpinnerModule, DragDropModule, TPipe, TnPipe,
  ],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon is-info">
          <mat-icon>local_shipping</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">
            {{ data?.id ? i18n.t('ddt.dialog.titoloEsistente', { numero: data?.numero || '' }) : ('ddt.nuovo' | t) }}
            @if (data?.id && locked) {
              <span class="dialog-lock-chip"><mat-icon>lock</mat-icon>{{ 'fatture.dialog.bloccato' | t }}</span>
            }
          </span>
          <span class="dialog-hero-sub">{{ (data?.id ? 'ddt.dialog.subEsistente' : 'ddt.dialog.subNuovo') | t }}</span>
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

        <!-- ── TAB 1: Documento ──────────────────────────────────── -->
        <mat-tab [label]="'fatture.dialog.tabDocumento' | t">
          <div class="doc-form">

            <div class="form-section is-primary">
              <div class="form-section-header"><mat-icon>person</mat-icon><span>{{ 'fatture.dialog.intestazione' | t }}</span></div>
              <mat-button-toggle-group [value]="tipoControparte" (change)="setTipoControparte($event.value)"
                                       [hideSingleSelectionIndicator]="true" class="tipo-controparte-toggle"
                                       [disabled]="locked || !isNew" style="margin-bottom:12px">
                <mat-button-toggle value="CLIENTE"><mat-icon>person</mat-icon> {{ 'ddt.dialog.toggleCliente' | t }}</mat-button-toggle>
                <mat-button-toggle value="FORNITORE"><mat-icon>local_shipping</mat-icon> {{ 'ddt.dialog.toggleFornitoreReso' | t }}</mat-button-toggle>
              </mat-button-toggle-group>
              <div class="doc-field-grid" [formGroup]="documentoForm">
                @if (tipoControparte === 'CLIENTE') {
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
                } @else {
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.fornitoreReq' | t }}</mat-label>
                    <input matInput [matAutocomplete]="autoFornitore" [formControl]="fornitoreCtrl"
                           (keyup.enter)="autoSelectFornitore()" [placeholder]="'ddt.dialog.cercaFornitorePh' | t"
                           [class.input-error]="submitted && !hasFornitore">
                    <mat-icon matSuffix>search</mat-icon>
                    <mat-autocomplete #autoFornitore="matAutocomplete" [displayWith]="displayFornitore">
                      @for (f of filteredFornitori; track f.id) {
                        <mat-option [value]="f">{{ f.ragioneSociale }}</mat-option>
                      }
                    </mat-autocomplete>
                    @if (submitted && !hasFornitore) {
                      <mat-error>{{ 'ddt.dialog.selezionaFornitore' | t }}</mat-error>
                    }
                  </mat-form-field>
                }
                <mat-form-field>
                  <mat-label>{{ 'fatture.dialog.numero' | t }}</mat-label>
                  <input matInput formControlName="numero">
                  @if (documentoForm.get('numero')?.hasError('numeroDuplicato')) {
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

            <div class="doc-totals-strip">
              <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.imponibile' | t }}</span><span class="totals-value">{{ imponibile | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              <div class="totals-item"><span class="totals-label">{{ 'fatture.dialog.iva' | t }}</span><span class="totals-value">{{ ivaTotal | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
              <span class="totals-spacer"></span>
              <div class="totals-grand"><span class="totals-label">{{ 'fatture.dialog.totale' | t }}</span><span class="totals-value">{{ totale | currency:'EUR':'symbol':'1.2-2':'it' }}</span></div>
            </div>

            <div class="form-section is-flat" [formGroup]="documentoForm">
              <div class="form-section-header"><mat-icon>notes</mat-icon><span>{{ 'fatture.dialog.noteInterne' | t }}</span></div>
              <mat-form-field>
                <mat-label>{{ 'fatture.dialog.annotazioniInterne' | t }}</mat-label>
                <textarea matInput rows="2" formControlName="note"></textarea>
              </mat-form-field>
            </div>
          </div>
        </mat-tab>

        <!-- ── TAB 2: Dati Trasporto ─────────────────────────────── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-lead-icon">local_shipping</mat-icon>
            {{ 'ddt.dialog.tabDatiTrasporto' | t }}
            @if (!trasportoForm.get('dataOraInizioTrasporto')?.value) {
              <mat-icon class="tab-status-icon icon-warning">warning_amber</mat-icon>
            } @else {
              <mat-icon class="tab-status-icon icon-success">check_circle</mat-icon>
            }
          </ng-template>
          <div class="doc-form">
            <form [formGroup]="trasportoForm">

              <div class="form-section is-primary">
                <div class="form-section-header"><mat-icon>local_shipping</mat-icon><span>{{ 'ddt.dialog.sectionTrasporto' | t }}</span></div>
                <div class="doc-field-grid has-2-extra">
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.dataOraInizioTrasporto' | t }}</mat-label>
                    <input matInput type="datetime-local" formControlName="dataOraInizioTrasporto">
                    @if (trasportoForm.get('dataOraInizioTrasporto')?.invalid && trasportoForm.get('dataOraInizioTrasporto')?.touched) {
                      <mat-error>{{ 'ddt.dialog.campoObbligatorio' | t }}</mat-error>
                    }
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.causale' | t }}</mat-label>
                    <mat-select formControlName="causaleTrasporto">
                      <mat-option value="Vendita">{{ 'ddt.dialog.causaleOpt.vendita' | t }}</mat-option>
                      <mat-option value="Reso">{{ 'ddt.dialog.causaleOpt.reso' | t }}</mat-option>
                      <mat-option value="C/Riparazione">{{ 'ddt.dialog.causaleOpt.cRiparazione' | t }}</mat-option>
                      <mat-option value="C/Conto lavoro">{{ 'ddt.dialog.causaleOpt.cContoLavoro' | t }}</mat-option>
                      <mat-option value="C/Conto visione">{{ 'ddt.dialog.causaleOpt.cContoVisione' | t }}</mat-option>
                      <mat-option value="Omaggio">{{ 'ddt.dialog.causaleOpt.omaggio' | t }}</mat-option>
                      <mat-option value="Campioni">{{ 'ddt.dialog.causaleOpt.campioni' | t }}</mat-option>
                      <mat-option value="Esposizione">{{ 'ddt.dialog.causaleOpt.esposizione' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.porto' | t }}</mat-label>
                    <mat-select formControlName="porto">
                      <mat-option value="Franco">{{ 'ddt.dialog.portoOpt.franco' | t }}</mat-option>
                      <mat-option value="Assegnato">{{ 'ddt.dialog.portoOpt.assegnato' | t }}</mat-option>
                      <mat-option value="Reso">{{ 'ddt.dialog.portoOpt.reso' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.aspettoBeni' | t }}</mat-label>
                    <mat-select formControlName="aspettoBeni">
                      <mat-option value="">{{ 'fatture.dialog.nonSpecificato' | t }}</mat-option>
                      <mat-option value="A vista">{{ 'ddt.dialog.aspettoOpt.aVista' | t }}</mat-option>
                      <mat-option value="Scatole">{{ 'ddt.dialog.aspettoOpt.scatole' | t }}</mat-option>
                      <mat-option value="Bancali">{{ 'ddt.dialog.aspettoOpt.bancali' | t }}</mat-option>
                      <mat-option value="Pallet">{{ 'ddt.dialog.aspettoOpt.pallet' | t }}</mat-option>
                      <mat-option value="Sacchi">{{ 'ddt.dialog.aspettoOpt.sacchi' | t }}</mat-option>
                      <mat-option value="Rotoli">{{ 'ddt.dialog.aspettoOpt.rotoli' | t }}</mat-option>
                      <mat-option value="Fusti">{{ 'ddt.dialog.aspettoOpt.fusti' | t }}</mat-option>
                      <mat-option value="Colli">{{ 'ddt.dialog.aspettoOpt.colli' | t }}</mat-option>
                      <mat-option value="Sfuso">{{ 'ddt.dialog.aspettoOpt.sfuso' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
              </div>

              <div class="form-section">
                <div class="form-section-header"><mat-icon>inventory_2</mat-icon><span>{{ 'ddt.dialog.sectionColliPeso' | t }}</span></div>
                <div class="form-row colli-row">
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.numeroColli' | t }}</mat-label>
                    <input matInput type="number" min="0" formControlName="numeroColli">
                    <mat-hint>{{ i18n.t('ddt.dialog.hintSommaQuantita', { n: totalQuantita }) }}</mat-hint>
                  </mat-form-field>
                  <button mat-stroked-button type="button" class="colli-calc-btn" (click)="calcolaColli()"
                          [matTooltip]="'ddt.dialog.calcolaDaRigheTooltip' | t">
                    <mat-icon>calculate</mat-icon> {{ 'ddt.dialog.calcolaDaRighe' | t }}
                  </button>
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.pesoLordo' | t }}</mat-label>
                    <input matInput type="number" min="0" step="0.01" formControlName="pesoLordo">
                    @if (pesoCalcolato !== null) {
                      <mat-hint>{{ i18n.t('ddt.dialog.hintDaiPesiProdotto', { n: (pesoCalcolato | number:'1.0-2') ?? '' }) }}</mat-hint>
                    }
                  </mat-form-field>
                  <button mat-stroked-button type="button" class="colli-calc-btn" (click)="calcolaPeso()"
                          [matTooltip]="'ddt.dialog.calcolaDaiPesiTooltip' | t">
                    <mat-icon>scale</mat-icon> {{ 'ddt.dialog.calcolaDaiPesi' | t }}
                  </button>
                </div>
              </div>

              <div class="form-section">
                <div class="form-section-header"><mat-icon>place</mat-icon><span>{{ 'ddt.dialog.sectionDestinazione' | t }}</span></div>
                <div class="form-row">
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.incaricatoTrasporto' | t }}</mat-label>
                    <mat-select formControlName="incaricatoTrasporto">
                      <mat-option value="Mittente">{{ 'ddt.dialog.incaricatoOpt.mittente' | t }}</mat-option>
                      <mat-option value="Destinatario">{{ 'ddt.dialog.incaricatoOpt.destinatario' | t }}</mat-option>
                      <mat-option value="Corriere">{{ 'ddt.dialog.incaricatoOpt.corriere' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                  @if (trasportoForm.get('incaricatoTrasporto')?.value === 'Corriere') {
                    <mat-form-field>
                      <mat-label>{{ 'ddt.dialog.nomeCorriere' | t }}</mat-label>
                      <input matInput formControlName="vettore" [placeholder]="'ddt.dialog.nomeCorrierePh' | t">
                    </mat-form-field>
                  }
                </div>

                @if (indirizziCliente.length) {
                  <mat-form-field>
                    <mat-label>{{ 'ddt.dialog.destinazioneSalvata' | t }}</mat-label>
                    <mat-select [(ngModel)]="destinazioneId" [ngModelOptions]="{standalone:true}" (ngModelChange)="onDestinazioneChange($event)">
                      <mat-option [value]="null">{{ 'ddt.dialog.indirizzoPrincipale' | t }}</mat-option>
                      @for (addr of indirizziCliente; track addr.id) {
                        <mat-option [value]="addr.id">{{ addr.nome }} — {{ [addr.via, addr.cap, addr.citta].filter(v => !!v).join(', ') }}</mat-option>
                      }
                      <mat-option [value]="-1">{{ 'ddt.dialog.altraDestinazione' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                }
                <mat-form-field>
                  <mat-label>{{ 'ddt.dialog.destinazioneDiversa' | t }}</mat-label>
                  <input matInput formControlName="destinazioneDiversa" [placeholder]="'ddt.dialog.destinazioneDiversaPh' | t">
                </mat-form-field>

                <mat-form-field>
                  <mat-label>{{ 'ddt.dialog.noteTrasporto' | t }}</mat-label>
                  <textarea matInput rows="2" formControlName="noteTrasporto"></textarea>
                </mat-form-field>
              </div>
            </form>
          </div>
        </mat-tab>

      </mat-tab-group>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-stroked-button type="button" (click)="salvaEStampa()"
              [disabled]="locked || documentoForm.get('numero')?.hasError('numeroDuplicato') || salvandoEStampando"
              [matTooltip]="documentoForm.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : (locked ? ('fatture.dialog.sbloccaTooltip' | t) : '')">
        @if (salvandoEStampando) { <mat-spinner diameter="16" style="display:inline-block;vertical-align:middle;margin-right:6px"></mat-spinner> }
        <mat-icon>print</mat-icon> {{ 'fatture.dialog.salvaEStampa' | t }}</button>
      <button mat-flat-button type="button" (click)="save()"
              [disabled]="locked || documentoForm.get('numero')?.hasError('numeroDuplicato')"
              [matTooltip]="documentoForm.get('numero')?.hasError('numeroDuplicato') ? ('fatture.dialog.numeroEsistente' | t) : (locked ? ('fatture.dialog.sbloccaTooltip' | t) : '')">
        <mat-icon>save</mat-icon> {{ 'fatture.dialog.salva' | t }}
      </button>
    </mat-dialog-actions>`,
  styles: [RIGHE_STYLES]
})
export class DdtDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);

  private documentDirty = inject(DocumentDirtyService);

  /** Ogni modifica utente nel dialog (gli eventi input/change bubblano dai campi figli) marca il documento come "sporco". */
  @HostListener('input')
  @HostListener('change')
  onAnyEdit(): void {
    this.documentDirty.setDirty(true);
  }

  ngOnDestroy(): void {
    this.documentDirty.setDirty(false);
  }

  locked = false;
  salvandoEStampando = false;
  toggleLock() { this.locked = !this.locked; }
  onLockedClick(ev: MouseEvent) {
    if (!this.locked) return;
    const target = ev.target as HTMLElement;
    if (target.closest('.dialog-lock-btn')) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.snack.open(this.i18n.t('fatture.dialog.msgDocBloccato'), 'OK', { duration: 2600 });
  }

  documentoForm: FormGroup;
  trasportoForm: FormGroup;
  clienti: Cliente[] = [];
  filteredClienti: Cliente[] = [];
  clienteCtrl = new FormControl<Cliente | string | null>('');
  private draft = inject(DraftService);
  private destroyRef = inject(DestroyRef);
  private confirmDraft = inject(ConfirmService);
  private readonly draftTipo = 'ddt';
  // Reso a fornitore: controparte fornitore al posto del cliente.
  tipoControparte: 'CLIENTE' | 'FORNITORE' = 'CLIENTE';
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
  indirizziCliente: ClienteIndirizzo[] = [];
  destinazioneId: number | null = null;
  /** Numeri documento già esistenti (lowercase, escluso quello corrente) per la validazione. */
  numeriEsistenti = new Set<string>();
  readonly isNew: boolean;

  submitted = false;
  get hasCliente(): boolean { const v = this.clienteCtrl.value; return !!(v && typeof v !== 'string'); }
  get hasFornitore(): boolean { const v = this.fornitoreCtrl.value; return !!(v && typeof v !== 'string'); }
  /** Controparte selezionata, qualunque sia il tipo. */
  get hasControparte(): boolean { return this.tipoControparte === 'FORNITORE' ? this.hasFornitore : this.hasCliente; }
  get hasRighe(): boolean { return this.righe.length > 0 && this.righe.some(r => r.descrizione?.trim()); }
  get totalQuantita(): number { return this.righe.reduce((s, r) => s + (r.quantita ?? 0), 0); }

  get clienteId(): number | null {
    const v = this.clienteCtrl.value;
    return v && typeof v !== 'string' ? (v as Cliente).id ?? null : null;
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

  calcolaColli() {
    this.trasportoForm.patchValue({ numeroColli: Math.ceil(this.totalQuantita) });
  }

  /** Peso totale teorico delle righe: somma quantità × peso unitario del prodotto.
   *  Null se nessuna riga ha un prodotto con peso configurato. */
  get pesoCalcolato(): number | null {
    let tot = 0, conPeso = 0;
    for (const r of this.righe) {
      if (r.tipo === 'NOTA' || !r.prodottoId) continue;
      const p = this.prodotti.find(x => x.id === r.prodottoId);
      if (p?.peso == null) continue;
      tot += (r.quantita ?? 0) * p.peso;
      conPeso++;
    }
    return conPeso ? +tot.toFixed(2) : null;
  }

  /** Compila "Peso lordo" sommando quantità × peso unitario dei prodotti in riga. */
  calcolaPeso() {
    const righeProdotto = this.righe.filter(r => r.tipo !== 'NOTA' && (r.descrizione?.trim() || r.prodottoId));
    const senzaPeso = righeProdotto.filter(r => {
      const p = r.prodottoId ? this.prodotti.find(x => x.id === r.prodottoId) : null;
      return !p || p.peso == null;
    }).length;
    const peso = this.pesoCalcolato;
    if (peso === null) {
      this.snack.open(this.i18n.t('ddt.msg.nessunPesoConfigurato'), '', { duration: 3500 });
      return;
    }
    this.trasportoForm.patchValue({ pesoLordo: peso });
    if (senzaPeso > 0) {
      this.snack.open(this.i18n.t('ddt.msg.pesoParziale', { n: senzaPeso }), '', { duration: 3000 });
    }
  }

  private defaultDataOra(): string {
    const now = new Date();
    return now.toISOString().substring(0, 16);
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private matDialog: MatDialog,
    private snack: MatSnackBar,
    private printSvcDialog: PrintService,
    private docLockSvc: DocLockService,
    public dialogRef: MatDialogRef<DdtDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Ddt | null
  ) {
    this.isNew = !data?.id;
    this.locked = !!data?.id && this.docLockSvc.enabled;
    this.tipoControparte = data?.tipo === 'FORNITORE' ? 'FORNITORE' : 'CLIENTE';
    this.destinazioneId = (data as any)?.destinazioneId ?? null;
    this.numeriEsistenti = setNumeriEsistenti((data as any)?.numeriEsistenti);

    this.documentoForm = this.fb.group({
      numero: [data?.numero ?? '', [Validators.required, numeroUnivocoValidator(() => this.numeriEsistenti)]],
      dataEmissione: [data?.dataEmissione ?? new Date().toISOString().substring(0, 10), Validators.required],
      note: [data?.note ?? ''],
    });

    this.trasportoForm = this.fb.group({
      dataOraInizioTrasporto: [data?.dataOraInizioTrasporto || this.defaultDataOra(), Validators.required],
      causaleTrasporto: [data?.causaleTrasporto || 'Vendita'],
      aspettoBeni: [data?.aspettoBeni || ''],
      porto: [data?.porto || 'Franco'],
      numeroColli: [data?.numeroColli ?? null],
      pesoLordo: [data?.pesoLordo ?? null],
      incaricatoTrasporto: [data?.incaricatoTrasporto || 'Mittente'],
      vettore: [data?.vettore || ''],
      destinazioneDiversa: [data?.destinazioneDiversa || ''],
      noteTrasporto: [data?.noteTrasporto || ''],
    });

    if (data?.id) {
      this.ds.getDdtById(data.id).subscribe(d => {
        this.righe = this.normalizeRighe(d.righe ?? []);
        this.prezziRecenti = new Array(this.righe.length).fill([]);
        this.prezziRecentiTutti = new Array(this.righe.length).fill([]);
        this.tuttiCaricati = new Array(this.righe.length).fill(false);
        this.righe.forEach((r, i) => { if (r.prodottoId) this.loadPrezziRecenti(i); });
      });
    } else {
      this.righe = [{ descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22 }];
      this.prezziRecenti = [[]];
      this.prezziRecentiTutti = [[]];
      this.tuttiCaricati = [false];
    }
  }

  onDestinazioneChange(id: number | null) {
    if (id === null) {
      this.trasportoForm.patchValue({ destinazioneDiversa: '' });
    } else if (id === -1) {
      // manual: leave destinazioneDiversa as-is
    } else {
      const addr = this.indirizziCliente.find(a => a.id === id);
      if (addr) {
        const formatted = [addr.via, addr.cap, addr.citta, addr.provincia, addr.stato !== 'Italia' ? addr.stato : ''].filter(Boolean).join(', ');
        this.trasportoForm.patchValue({ destinazioneDiversa: formatted });
      }
    }
  }

  private loadIndirizziCliente(clienteId: number | null) {
    if (!clienteId) { this.indirizziCliente = []; return; }
    this.ds.getClienteIndirizzi(clienteId).subscribe({
      next: a => this.indirizziCliente = a,
      error: () => this.indirizziCliente = [],
    });
  }

  ngOnInit() {
    this.setupBozza();
    this.clienteCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredClienti = this.clienti.filter(c => c.ragioneSociale.toLowerCase().includes(q));
      if (v && typeof v !== 'string') {
        this.loadIndirizziCliente((v as Cliente).id ?? null);
      }
    });

    this.ds.getClienti().subscribe(c => {
      this.clienti = c;
      this.filteredClienti = c;
      if (this.data?.clienteId) {
        const found = c.find(x => x.id === this.data!.clienteId);
        if (found) {
          this.clienteCtrl.setValue(found, { emitEvent: false });
          this.loadIndirizziCliente(found.id ?? null);
        }
      }
    });

    this.fornitoreCtrl.valueChanges.subscribe(v => {
      const q = typeof v === 'string' ? v.toLowerCase() : '';
      this.filteredFornitori = this.fornitori.filter(f => f.ragioneSociale.toLowerCase().includes(q));
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
      this.ds.getNextNumero('ddt').subscribe(n => this.documentoForm.patchValue({ numero: String(n.numero) }));
    }
  }

  displayCliente(c: Cliente | string | null): string {
    return c && typeof c !== 'string' ? (c as Cliente).ragioneSociale : '';
  }

  autoSelectCliente() {
    if (this.filteredClienti.length > 0) this.clienteCtrl.setValue(this.filteredClienti[0]);
  }

  displayFornitore(f: Fornitore | string | null): string {
    return f && typeof f !== 'string' ? (f as Fornitore).ragioneSociale : '';
  }

  autoSelectFornitore() {
    if (this.filteredFornitori.length > 0) this.fornitoreCtrl.setValue(this.filteredFornitori[0]);
  }

  /** Cambia controparte tra Cliente e Fornitore (reso). Per i nuovi documenti
   *  precompila una causale di reso quando si passa a Fornitore. */
  setTipoControparte(tipo: 'CLIENTE' | 'FORNITORE') {
    if (this.tipoControparte === tipo) return;
    this.tipoControparte = tipo;
    if (tipo === 'FORNITORE') {
      this.clienteCtrl.setValue('', { emitEvent: false });
      this.indirizziCliente = [];
      this.destinazioneId = null;
      if (this.isNew && !this.trasportoForm.get('causaleTrasporto')?.value)
        this.trasportoForm.patchValue({ causaleTrasporto: 'Reso a fornitore' });
    } else {
      this.fornitoreCtrl.setValue('', { emitEvent: false });
    }
  }

  @ViewChildren('rigaCodice') private codiceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  ngAfterViewInit() {
    // "Entrando" nel documento il focus va subito sul codice della prima riga.
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
    const cv = this.clienteCtrl.value;
    const clienteId = cv && typeof cv !== 'string' ? (cv as Cliente).id : null;
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

  /** Le righe prodotto senza il flag definito ereditano scaricaMagazzino=true (default storico). */
  private normalizeRighe(righe: RigaDocumento[]): RigaDocumento[] {
    return righe.map(r => (r.tipo !== 'NOTA' && r.prodottoId && r.scaricaMagazzino === undefined)
      ? { ...r, scaricaMagazzino: true } : r);
  }
  addRiga() {
    this.righe.push({ tipo: 'PRODOTTO', descrizione: '', quantita: 1, unitaMisura: '', prezzo: 0, sconto: 0, iva: 22, scaricaMagazzino: true });
    this.prezziRecenti.push([]);
    this.prezziRecentiTutti.push([]);
    this.tuttiCaricati.push(false);
    scrollFocusLastRiga(this.codiceInputs);
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

  printFromDialog() { if (this.data?.id) this.printSvcDialog.printDdt(this.data.id); }

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
            const d = { ...(bozza.doc || {}) }; delete d.numero;
            this.documentoForm.patchValue(d);
            this.trasportoForm.patchValue(bozza.trasp || {});
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
        this.draft.save(this.draftTipo, {
          doc: this.documentoForm.getRawValue(),
          trasp: this.trasportoForm.getRawValue(),
          righe,
        });
      } catch { /* ignora */ }
    }, 3000);
    this.destroyRef.onDestroy(() => clearInterval(t));
  }

  /** true se il form è valido e pronto per essere salvato (usato sia da `save()`
   *  sia da `salvaEStampa()`). Marca i campi toccati per mostrare gli errori. */
  private validaPerSalvataggio(): boolean {
    if (!this.documentoForm.valid || !this.hasControparte || !this.hasRighe) return false;
    this.trasportoForm.markAllAsTouched();
    return this.trasportoForm.valid;
  }

  /** Costruisce l'oggetto DDT da form+stato del dialog. Riusato sia da `save()`
   *  (chiude il dialog, salva la lista) sia da `salvaEStampa()` (senza chiudere). */
  private buildResult(): any {
    const isForn = this.tipoControparte === 'FORNITORE';
    const cv = this.clienteCtrl.value;
    const clienteNome = !isForn && cv && typeof cv !== 'string' ? (cv as Cliente).ragioneSociale : '';
    const fv = this.fornitoreCtrl.value;
    const fornitore = isForn && fv && typeof fv !== 'string' ? (fv as Fornitore) : null;
    return {
      ...this.data,
      ...this.documentoForm.value,
      ...this.trasportoForm.value,
      tipo: this.tipoControparte,
      clienteId: isForn ? null : this.clienteId,
      clienteNome,
      fornitoreId: fornitore?.id ?? null,
      fornitoreNome: fornitore?.ragioneSociale ?? null,
      destinazioneId: !isForn && this.destinazioneId && this.destinazioneId > 0 ? this.destinazioneId : null,
      stato: this.data?.stato ?? 'EMESSO',
      righe: this.righe,
    };
  }

  save() {
    this.submitted = true;
    if (!this.validaPerSalvataggio()) return;
    this.draft.clear(this.draftTipo);
    this.dialogRef.close(this.buildResult());
  }

  /** Salva (con gli stessi controlli insoluti del salvataggio da lista) SENZA
   *  chiudere il dialog, poi stampa e blocca il documento. */
  salvaEStampa() {
    this.submitted = true;
    if (!this.validaPerSalvataggio() || this.salvandoEStampando) return;
    this.salvandoEStampando = true;
    const result = this.buildResult();
    salvaDdtConControlli({
      result,
      notificheConfig: (this.data as any)?._notificheConfig ?? {},
      ds: this.ds, dialog: this.matDialog, i18n: this.i18n, snack: this.snack,
      onAnnullato: () => { this.salvandoEStampando = false; },
      onSalvato: (id) => {
        this.salvandoEStampando = false;
        this.draft.clear(this.draftTipo);
        this.data = { ...this.data, ...result, id };
        this.locked = true;
        this.printSvcDialog.printDdt(id);
        this.snack.open(this.i18n.t('ddt.msg.salvato'), '', { duration: 2000 });
      },
    });
  }
}

/** Controlli "morbidi" (fatture insolute) + salvataggio, condivisi tra il
 *  salvataggio da lista (chiude il dialog) e "Salva e stampa" dal dialog stesso
 *  (non lo chiude) — stesso comportamento, cambia solo chi la chiama. */
function salvaDdtConControlli(ctx: {
  result: any;
  notificheConfig: NotificheConfig;
  ds: DataService;
  dialog: MatDialog;
  i18n: I18nService;
  snack: MatSnackBar;
  onSalvato: (id: number) => void;
  onAnnullato?: () => void;
}) {
  const { result, notificheConfig, ds, dialog, snack, onSalvato, onAnnullato } = ctx;
  const salva = () => {
    const op = result.id ? ds.updateDdt(result) : ds.createDdt(result);
    op.subscribe({
      next: (res: any) => onSalvato(result.id ?? res?.id),
      error: (e: any) => { snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }); onAnnullato?.(); },
    });
  };
  if (!result.id && notificheConfig.avvisoInsolutiDdt && result.clienteId) {
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
}

@Component({
  selector: 'app-ddt',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatSortModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
            MatSelectModule, MatPaginatorModule, MatMenuModule, EmptyStateComponent, TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './ddt.html',
  styleUrl: './ddt.scss'
})
export class DdtComponent implements OnInit, AfterViewInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  private allDdt: Ddt[] = [];
  dataSource = new MatTableDataSource<Ddt>();
  displayedColumns = ['select', 'numero', 'dataEmissione', 'clienteNome', 'totale', 'stato', 'fattura', 'azioni'];
  selection = new SelectionModel<Ddt>(true, []);

  readonly mesi = [1,2,3,4,5,6,7,8,9,10,11,12].map(v => ({ v, l: this.i18n.t('fatture.mese.' + v) }));
  // Filtri multipli: array vuoto = "tutti" (si possono scegliere più anni/mesi/clienti).
  filtroAnni: number[] = [];
  filtroMesi: number[] = [];
  filtroClienti: number[] = [];
  filtroDaFatturare = false;

  get anni() { return [...new Set(this.allDdt.map(d => +d.dataEmissione.substring(0, 4)))].sort().reverse(); }
  get daFatturareCount() { return this.allDdt.filter(d => !d.fatturaId && d.stato !== 'ANNULLATO').length; }
  get clientiList() {
    const map = new Map<number, string>();
    this.allDdt.forEach(d => { if (d.clienteId) map.set(d.clienteId, d.clienteNome ?? ''); });
    return [...map.entries()].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  get ddt() { return this.dataSource.data; }
  /** Somma dei soli documenti selezionati (per la barra totali in fondo alla lista). */
  get totaleSelezione(): number { return this.selection.selected.reduce((s, x) => s + (Number((x as any).totale) || 0), 0); }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  notificheConfig: NotificheConfig = {};

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, private printSvc: PrintService, public excel: ExcelService, private viewState: ViewStateService) {}

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  get totaleLista(): number { return this.dataSource.data.reduce((s, r) => s + (Number((r as any).totale) || 0), 0); }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('ddt.col.numero'),           field: 'numero',        width: 14 },
    { header: this.i18n.t('ddt.col.data'),             field: 'dataEmissione', width: 14 },
    { header: this.i18n.t('ddt.col.clienteFornitore'), field: 'clienteNome',   width: 30 },
    { header: this.i18n.t('ddt.col.importo'),          field: 'totale',        width: 14 },
    { header: this.i18n.t('ddt.col.stato'),            field: 'stato',         width: 14 },
  ];
  /** Righe da esportare: le selezionate se ce ne sono, altrimenti tutta la lista. */
  get exportRows(): any[] { return this.selection.hasValue() ? this.selection.selected : this.dataSource.data; }

  ngOnInit() {
    // Ripristino filtri/ordinamento salvati (prima del prefill, che può sovrascrivere).
    const vs = this.viewState.read<any>('ddt');
    if (vs) {
      if (Array.isArray(vs.filtroAnni)) this.filtroAnni = vs.filtroAnni;
      if (Array.isArray(vs.filtroMesi)) this.filtroMesi = vs.filtroMesi;
      if (Array.isArray(vs.filtroClienti)) this.filtroClienti = vs.filtroClienti;
      if (typeof vs.filtroDaFatturare === 'boolean') this.filtroDaFatturare = vs.filtroDaFatturare;
    }
    this.load();
    this.ds.getAzienda().subscribe(a => {
      this.notificheConfig = a.notificheConfig ?? { avvisoInsolutiDdt: true, avvisoInsolutiFattura: true };
    });
    const bozza = consumePrefill('nuovaBozza');
    if (bozza) setTimeout(() => this.open(bozza as Ddt), 0);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    const vs = this.viewState.read<any>('ddt');
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
      [data.numero, data.clienteNome, data.controparteNome, data.fornitoreNome, data.stato].some(v => v?.toLowerCase().includes(filter));
  }

  load() {
    this.ds.getDdt().subscribe(d => { this.allDdt = d; this.applyFilters(); this.selection.clear(); });
  }

  applyFilters() {
    let data = this.allDdt;
    if (this.filtroAnni.length) data = data.filter(d => this.filtroAnni.includes(+d.dataEmissione.substring(0, 4)));
    if (this.filtroMesi.length) data = data.filter(d => this.filtroMesi.includes(+d.dataEmissione.substring(5, 7)));
    if (this.filtroClienti.length) data = data.filter(d => d.clienteId != null && this.filtroClienti.includes(d.clienteId));
    if (this.filtroDaFatturare) data = data.filter(d => !d.fatturaId && d.stato !== 'ANNULLATO');
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
    this.saveViewState();
  }

  /** Persiste filtri e ordinamento correnti per la sezione 'ddt'. */
  saveViewState(): void {
    this.viewState.write('ddt', {
      filtroAnni: this.filtroAnni,
      filtroMesi: this.filtroMesi,
      filtroClienti: this.filtroClienti,
      filtroDaFatturare: this.filtroDaFatturare,
      sortActive: this.sort?.active ?? null,
      sortDir: this.sort?.direction ?? null,
    });
  }

  resetFiltri() {
    this.filtroAnni = []; this.filtroMesi = []; this.filtroClienti = []; this.filtroDaFatturare = false;
    this.dataSource.filter = ''; this.applyFilters();
    this.saveViewState();
  }

  print() {
    const t = (k: string) => this.i18n.t(k);
    const rows = this.selection.hasValue() ? this.selection.selected : this.dataSource.data;
    const d = (s: string) => { const p = (s||'').substring(0,10).split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:'—'; };
    const e = (n: number|undefined) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n??0);
    const body = rows.map(r=>`<tr><td>${r.numero}</td><td>${d(r.dataEmissione)}</td><td>${r.clienteNome||'—'}</td><td class="r">${e(r.totale)}</td><td>${r.stato}</td><td>${r.fatturaNumero||'—'}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('ddt.title')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right;font-weight:600}</style></head><body><h1>${t('ddt.title')}</h1><table><thead><tr><th>${t('ddt.col.numero')}</th><th>${t('ddt.col.data')}</th><th>${t('ddt.filtri.cliente')}</th><th class="r">${t('ddt.col.importo')}</th><th>${t('ddt.col.stato')}</th><th>${t('ddt.col.fattura')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim().toLowerCase();
  }

  isAllSelected() { return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length; }
  toggleAll() { this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r)); }

  setStato(d: Ddt, stato: string) {
    this.ds.setDdtStato(d.id!, stato).subscribe({ next: () => this.load(), error: e => this.snack.open(e.message, '', { duration: 3000 }) });
  }
  bulkSetStato(stato: string) {
    const ids = this.selection.selected.map(d => d.id!);
    if (!ids.length) return;
    forkJoin(ids.map(id => this.ds.setDdtStato(id, stato))).subscribe({
      next: () => { this.selection.clear(); this.load(); },
      error: e => this.snack.open(e?.error?.error || e?.message || this.i18n.t('ddt.msg.erroreStato'), '', { duration: 3000 })
    });
  }

  async bulkElimina() {
    const sel = this.selection.selected;
    if (!sel.length) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('ddt.msg.confermaEliminaBulk', n))) return;
    forkJoin(sel.map(d => this.ds.getDdtById(d.id!).pipe(catchError(() => of(null))))).subscribe(fulls => {
      const backups = fulls.filter(Boolean);
      forkJoin(sel.map(d => this.ds.deleteDdt(d.id!).pipe(catchError(err => of({ __error: err }))))).subscribe(results => {
        const errori = results.filter((r: any) => r && r.__error).length;
        this.selection.clear();
        this.load();
        const msg = errori ? this.i18n.t('ddt.msg.eliminatiParziali', { ok: n - errori, errori }) : this.i18n.tn('ddt.msg.eliminatiBulk', n);
        const ref = this.snack.open(msg, this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createDdt(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('ddt.msg.ripristinatiBulk'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      });
    });
  }

  printDoc(d: Ddt) { this.printSvc.printDdt(d.id!); }

  inviaEmail(d: Ddt) {
    forkJoin({ az: this.ds.getAzienda(), clienti: this.ds.getClienti() }).subscribe(({ az, clienti }) => {
      const cliente = clienti.find(c => c.id === d.clienteId);
      const ref = this.dialog.open(EmailDialogComponent, {
        width: '560px', maxWidth: '95vw',
        data: {
          title: this.i18n.t('ddt.msg.inviaTitolo', { numero: d.numero }),
          subtitle: cliente?.ragioneSociale ? this.i18n.t('preventivi.msg.aCliente', { nome: cliente.ragioneSociale }) : undefined,
          destinatario: cliente?.email || '',
          testo: az?.emailCorpoDocumento || '',
        },
      });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.sendDdtEmail(d.id!, result.destinatario, result.testo || undefined).subscribe({
          next: () => this.snack.open(this.i18n.t('preventivi.msg.emailInviata'), '', { duration: 2000 }),
          error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreEmail', { msg: e.error?.error || e.message }), '', { duration: 4000 })
        });
      });
    });
  }

  generaFattura(ddt: Ddt) {
    forkJoin({ full: this.ds.getDdtById(ddt.id!), num: this.ds.getNextNumero('fatture') }).subscribe({
      next: ({ full, num }) => {
        if (!full) { this.snack.open(this.i18n.t('ddt.msg.documentoNonDisponibile'), 'OK', { duration: 3000, panelClass: 'snack-error' }); return; }
        const pre: Fattura = {
          numero: String(num.numero),
          dataEmissione: new Date().toISOString().substring(0, 10),
          clienteId: ddt.clienteId, ddtIds: [ddt.id!],
          stato: 'EMESSA', righe: full.righe,
        } as Fattura;
        this.dialog.open(FatturaDialogComponent, { data: pre, width: '90vw', maxWidth: '1400px', maxHeight: '95vh' })
          .afterClosed().subscribe(result => {
            if (!result) return;
            this.ds.createFattura(result).subscribe({
              next: () => { this.load(); this.snack.open(this.i18n.t('ddt.msg.fatturaCreata'), '', { duration: 2000, panelClass: 'snack-ok' }); },
              error: e => this.snack.open(e.message || this.i18n.t('ddt.msg.erroreCreazioneFattura'), 'OK', { duration: 4000, panelClass: 'snack-error' })
            });
          });
      },
      error: e => this.snack.open(this.i18n.t('ddt.msg.erroreCaricamento', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
    });
  }

  apriImpostazioniFattura(fatturaId: number) {
    this.ds.getFatturaById(fatturaId).subscribe(f => this.dialog.open(FatturaDialogComponent, {
      data: f, width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    }).afterClosed().subscribe(result => {
      if (!result) return;
      this.ds.updateFattura(result).subscribe({ next: () => this.snack.open(this.i18n.t('ddt.msg.salvato'), '', { duration: 2000 }) });
    }));
  }

  open(d?: Ddt) {
    const numeriEsistenti = this.allDdt.filter(x => x.id !== d?.id).map(x => x.numero);
    const ref = this.dialog.open(DdtDialogComponent, {
      data: {
        ...(d ?? {}), numeriEsistenti,
        // Contesto per i controlli di "Salva e stampa" dentro il dialog stesso
        // (stessi controlli del salvataggio da lista, vedi salvaDdtConControlli).
        _notificheConfig: this.notificheConfig,
      },
      width: '90vw', maxWidth: '1400px', maxHeight: '95vh'
    });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      salvaDdtConControlli({
        result,
        notificheConfig: this.notificheConfig,
        ds: this.ds, dialog: this.dialog, i18n: this.i18n, snack: this.snack,
        onSalvato: () => { this.load(); this.snack.open(this.i18n.t('ddt.msg.salvato'), '', { duration: 2000 }); },
      });
    });
  }

  info(d: Ddt) {
    this.ds.getDdtPrint(d.id!).subscribe(doc => {
      const righe = doc.righe ?? [];
      const imponibile = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100), 0);
      const ivaT = righe.reduce((s: number, r: any) => s + r.quantita * r.prezzo * (1 - (r.sconto ?? 0) / 100) * r.iva / 100, 0);
      const extra: { label: string; value: string }[] = [];
      if (doc.causaleTrasporto) extra.push({ label: this.i18n.t('ddt.dialog.causale'), value: doc.causaleTrasporto });
      if (doc.porto) extra.push({ label: this.i18n.t('ddt.dialog.porto'), value: doc.porto });
      if (doc.fatturaNumero) extra.push({ label: this.i18n.t('ddt.col.fattura'), value: doc.fatturaNumero });
      this.dialog.open(DocInfoDialogComponent, {
        data: {
          tipo: 'DDT', sottotitolo: this.i18n.t('ddt.info.sottotitolo'),
          numero: doc.numero, data: doc.dataEmissione, stato: doc.stato,
          controparteLabel: this.i18n.t('ddt.info.destinatarioLabel'),
          controparte: doc.cliente?.ragioneSociale || d.clienteNome || '—',
          controparteInfo: [
            [doc.cliente?.via, [doc.cliente?.cap, doc.cliente?.citta].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            doc.cliente?.pIva ? `P.IVA: ${doc.cliente.pIva}` : '',
          ].filter(Boolean) as string[],
          totale: imponibile + ivaT, imponibile, righe, extraFields: extra, note: doc.note,
        } as DocInfoData,
        width: '720px', maxWidth: '98vw', maxHeight: '92vh',
      });
    });
  }

  /** Id dei DDT in corso di duplicazione: evita un doppio clic rapido sul kebab →
   *  "Duplica" (il menu si chiude subito, quindi non basta disabilitare il
   *  bottone) che creerebbe due copie dello stesso documento. */
  private duplicating = new Set<number>();

  duplicate(d: Ddt) {
    if (!d.id || this.duplicating.has(d.id)) return;
    this.duplicating.add(d.id);
    const fine = () => this.duplicating.delete(d.id!);
    forkJoin({ full: this.ds.getDdtById(d.id!), num: this.ds.getNextNumero('ddt') }).subscribe({
      next: ({ full, num }) => {
        const { id, ...pre } = full as any;
        pre.numero = String(num.numero);
        pre.dataEmissione = new Date().toISOString().substring(0, 10);
        pre.stato = 'EMESSO';
        this.ds.createDdt(pre).subscribe({
          next: () => { fine(); this.load(); this.snack.open(this.i18n.t('ddt.msg.duplicato', { numero: pre.numero }), '', { duration: 2500, panelClass: 'snack-ok' }); },
          error: e => { fine(); this.snack.open(e.message || this.i18n.t('preventivi.msg.erroreDuplicazione'), 'OK', { duration: 4000, panelClass: 'snack-error' }); }
        });
      },
      error: e => { fine(); this.snack.open(this.i18n.t('preventivi.msg.erroreGenerico', { msg: e.message || '' }), 'OK', { duration: 4000 }); }
    });
  }

  async delete(d: Ddt) {
    if (!await this.confirm.delete(this.i18n.t('ddt.msg.confermaElimina', { numero: d.numero }))) return;
    this.ds.getDdtById(d.id!).subscribe(full => {
      this.ds.deleteDdt(d.id!).subscribe(() => {
        this.load();
        const ref = this.snack.open(this.i18n.t('ddt.msg.eliminato', { numero: d.numero }), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          const { id, ...payload } = full as any;
          this.ds.createDdt(payload).subscribe({
            next: () => { this.load(); this.snack.open(this.i18n.t('ddt.msg.ripristinato'), '', { duration: 2000, panelClass: 'snack-ok' }); },
            error: e => this.snack.open(this.i18n.t('preventivi.msg.erroreRipristino', { msg: e.message || '' }), 'OK', { duration: 4000, panelClass: 'snack-error' })
          });
        });
      });
    });
  }
}
