import { inject, Component, OnInit, AfterViewInit, Inject, ViewChild, HostListener } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SelectionModel } from '@angular/cdk/collections';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { LoadingSkeletonComponent } from '../shared/loading-skeleton';
import { FieldHelpComponent } from '../shared/field-help';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { DataService } from '../../services/data.service';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { Prodotto, CategoriaProdotto, UnitaMisura, AliquotaIva, Fornitore, ProdottoFornitore, CodiceAlias } from '../../models';
import { consumePrefill } from '../../utils/nav-prefill';
import { ImportMappingDialogComponent, FieldDef, MappingResult } from '../shared/import-mapping-dialog';
import { ColumnPickerComponent, ColDef } from '../shared/column-picker';
import { InfoDialogComponent, InfoDialogData } from '../shared/info-dialog';
import { QuickAddProdottoDialogComponent } from './quick-add-prodotto-dialog';
import { ImportListinoDialogComponent } from './import-listino-dialog';
import { BarcodeScannerDialogComponent } from '../shared/barcode-scanner-dialog';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { unitaFrazionabile, stepPerUnita, arrotondaPerUnita } from '../../utils/unita';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';
import { TnPipe } from '../../pipes/tn.pipe';

function buildProdottiFields(i18n: I18nService): FieldDef[] { return [
  { key: 'nome', label: i18n.t('prodotti.field.nome'), required: true, aliases: [
    'Nome', 'nome', 'Prodotto', 'Articolo', 'Descrizione Articolo', 'Product Name',
    'Item Name', 'Denominazione', 'Name', 'Desc.', 'Descrizione Breve',
  ]},
  { key: 'categoria', label: i18n.t('prodotti.field.categoria'), aliases: [
    'Categoria', 'categoria', 'Categoria Merceologica', 'Category', 'Gruppo',
    'Tipo', 'Famiglia', 'Linea',
  ]},
  { key: 'descrizione', label: i18n.t('prodotti.field.descrizione'), aliases: [
    'Descrizione', 'descrizione', 'Descrizione Estesa', 'Note', 'Description',
    'Note Prodotto', 'Annotazioni',
  ]},
  { key: 'codice', label: i18n.t('prodotti.field.codice'), aliases: [
    'Codice', 'codice', 'Codice Articolo', 'Cod. Articolo', 'SKU', 'Cod.',
    'Item Code', 'Codice Prodotto', 'Art.', 'Articolo', 'Riferimento',
  ]},
  { key: 'codiceFornitore', label: i18n.t('prodotti.field.codiceFornitore'), aliases: [
    'Codice Fornitore', 'codiceFornitore', 'Cod. Fornitore', 'Supplier Code',
    'Codice Interno Fornitore', 'Ref. Fornitore',
  ]},
  { key: 'barcode', label: i18n.t('prodotti.field.barcode'), aliases: [
    'Barcode', 'barcode', 'EAN', 'EAN13', 'Codice a Barre', 'UPC', 'GTIN',
    'Cod. Barre', 'EAN-13',
  ]},
  { key: 'prezzo', label: i18n.t('prodotti.field.prezzo'), type: 'number', aliases: [
    'Prezzo vendita', 'Prezzo', 'prezzo', 'Prezzo di Vendita', 'Prezzo Vendita',
    'Selling Price', 'Price', 'Listino', 'Prezzo al pubblico', 'Prezzo Cliente',
  ]},
  { key: 'prezzoAcquisto', label: i18n.t('prodotti.field.prezzoAcquisto'), type: 'number', aliases: [
    'Prezzo acquisto', 'prezzoAcquisto', 'Prezzo di Acquisto', 'Costo',
    'Purchase Price', 'Cost', 'Costo Acquisto', 'Prezzo Fornitore',
  ]},
  { key: 'iva', label: i18n.t('prodotti.field.iva'), type: 'number', defaultValue: 22, aliases: [
    'IVA', 'iva', 'Aliquota IVA', 'VAT Rate', 'IVA %', 'IVA%', 'Aliquota',
  ]},
  { key: 'quantita', label: i18n.t('prodotti.field.quantita'), type: 'integer', defaultValue: 0, aliases: [
    'Quantità', 'quantita', 'Qty', 'Quantity', 'Giacenza', 'Stock',
    'Disponibile', 'Qtà', 'Qta', 'Scorta',
  ]},
  { key: 'sogliaMinima', label: i18n.t('prodotti.field.sogliaMinima'), type: 'integer', defaultValue: 0, aliases: [
    'Soglia Minima', 'sogliaMinima', 'Riordino', 'Min Stock', 'Minimo',
    'Stock Minimo', 'Soglia di Riordino', 'Scorta Minima',
  ]},
  { key: 'unitaMisura', label: i18n.t('prodotti.field.unitaMisura'), defaultValue: 'pz', aliases: [
    'Unità Misura', 'unitaMisura', 'U.M.', 'UM', 'UdM', 'Unit',
    'Unit of Measure', 'Unita di Misura', 'Unità di misura',
  ]},
]; }

// ── Dialog ──────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-prodotto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatSelectModule, MatAutocompleteModule, MatButtonModule,
            MatIconModule, MatCheckboxModule, MatButtonToggleModule, MatTooltipModule, FieldHelpComponent, TPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon" style="background:linear-gradient(135deg,#10b981 0%,#059669 100%);box-shadow:0 4px 12px -2px rgba(16,185,129,0.35)">
          <mat-icon>inventory_2</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ data ? data.nome : (('prodotti.dialog.new') | t) }}</span>
          <span class="dialog-hero-sub">{{ (data ? 'prodotti.dialog.editSub' : 'prodotti.dialog.newSub') | t }}</span>
        </div>
      </div>

      <form [formGroup]="form" class="dialog-form">

        <!-- ── Identità prodotto ────────────────────────── -->
        <div class="form-section is-primary">
          <div class="form-section-header">
            <mat-icon>label</mat-icon>
            <span>{{ 'prodotti.form.identita' | t }}</span>
            <span class="section-hint">{{ 'prodotti.form.identitaHint' | t }}</span>
          </div>
          <mat-form-field style="width:100%"><mat-label>{{ 'prodotti.form.nome' | t }}</mat-label>
            <input matInput formControlName="nome" [placeholder]="'prodotti.form.nomePlaceholder' | t"></mat-form-field>
          <div class="form-row">
            <mat-form-field><mat-label>{{ 'prodotti.form.codiceInterno' | t }}</mat-label>
              <input matInput formControlName="codice"></mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'prodotti.form.categoria' | t }}</mat-label>
              <mat-select formControlName="categoria">
                <mat-option value="">{{ 'prodotti.form.nessunaCategoria' | t }}</mat-option>
                @for (c of categorie; track c.id) {
                  <mat-option [value]="c.nome">{{ c.nome }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div class="form-row">
            <div class="input-with-action" style="flex:1">
              <mat-form-field>
                <mat-label>{{ 'prodotti.form.barcode' | t }}</mat-label>
                <input matInput formControlName="barcode" [placeholder]="'prodotti.form.barcodePlaceholder' | t">
              </mat-form-field>
              <button mat-icon-button type="button" [matTooltip]="'prodotti.form.scansionaBarcode' | t"
                      (click)="scannerBarcode()">
                <mat-icon>qr_code_scanner</mat-icon>
              </button>
            </div>
          </div>
        </div>

        <!-- ── Prezzi & IVA ─────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>sell</mat-icon>
            <span>{{ 'prodotti.form.prezziIva' | t }}</span>
            <span class="section-hint">
              <mat-button-toggle-group [value]="prezzoMode" (change)="onPrezzoModeChange($event.value)"
                                      [hideSingleSelectionIndicator]="true" class="prezzo-mode-toggle">
                <mat-button-toggle value="netto">{{ 'prodotti.netto' | t }}</mat-button-toggle>
                <mat-button-toggle value="ivato">{{ 'prodotti.ivato' | t }}</mat-button-toggle>
              </mat-button-toggle-group>
            </span>
          </div>
          <div class="form-row">
            <mat-form-field>
              <mat-label>{{ 'prodotti.form.iva' | t }}</mat-label>
              <mat-select formControlName="iva">
                @for (a of aliquoteIva; track a.id) {
                  <mat-option [value]="a.valore">{{ a.nome }} – {{ a.valore }}%</mat-option>
                }
              </mat-select>
              <app-field-help matSuffix term="aliquotaIva" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'prodotti.form.unitaMisura' | t }}</mat-label>
              <mat-select formControlName="unitaMisura">
                @for (u of unitaMisura; track u.id) {
                  <mat-option [value]="u.simbolo">{{ u.nome }} ({{ u.simbolo }})</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div class="form-row" style="align-items:flex-start">
            <mat-form-field>
              <mat-label>{{ 'prodotti.form.prezzoVendita' | t:{ mode: (prezzoMode === 'ivato' ? ('prodotti.ivato' | t) : ('prodotti.netto' | t)) } }}</mat-label>
              <input matInput type="number" [step]="prezzoFmt.step()" min="0"
                     [(ngModel)]="prezzoInput" [ngModelOptions]="{standalone:true}"
                     (ngModelChange)="onPrezzoModelChange('prezzo', $event)">
              <mat-icon matSuffix>euro</mat-icon>
              @if (prezzoMode === 'ivato') {
                <mat-hint>{{ 'prodotti.form.hintNetto' | t:{ v: (form.value.prezzo | number:'1.4-4') || '' } }}</mat-hint>
              } @else {
                <mat-hint>{{ 'prodotti.form.hintIvato' | t:{ v: (prezzoIvato('prezzo') | number:prezzoFmt.digitsInfo()) || '' } }}</mat-hint>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'prodotti.form.prezzoAcquisto' | t:{ mode: (prezzoMode === 'ivato' ? ('prodotti.ivato' | t) : ('prodotti.netto' | t)) } }}</mat-label>
              <input matInput type="number" [step]="prezzoFmt.step()" min="0"
                     [(ngModel)]="prezzoAcquistoInput" [ngModelOptions]="{standalone:true}"
                     (ngModelChange)="onPrezzoModelChange('prezzoAcquisto', $event)">
              <mat-icon matSuffix>shopping_cart</mat-icon>
              @if (margine !== null) {
                <mat-hint>{{ 'prodotti.form.margine' | t }} <b [style.color]="margine >= 0 ? '#10b981' : '#ef4444'">{{ margine | number:'1.1-1' }}%</b></mat-hint>
              } @else {
                <mat-hint>{{ 'prodotti.form.margineHint' | t }}</mat-hint>
              }
            </mat-form-field>
          </div>
        </div>

        <!-- ── Fornitori ────────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>local_shipping</mat-icon>
            <span>{{ 'prodotti.form.fornitori' | t }}</span>
            <span class="section-hint">{{ 'prodotti.form.fornitoriHint' | t }}</span>
          </div>
          @for (f of fornitori; track $index) {
            <div class="form-row" style="align-items:flex-start;gap:8px">
              <mat-form-field style="flex:2">
                <mat-label>{{ 'prodotti.form.fornitore' | t }}</mat-label>
                <input matInput [matAutocomplete]="autoForn"
                       [(ngModel)]="f.cercaFornitore" [ngModelOptions]="{ standalone: true }"
                       (focus)="$any($event.target).select()" (blur)="syncFornitoreText(f)"
                       [placeholder]="'prodotti.form.fornitorePlaceholder' | t">
                <mat-icon matSuffix>search</mat-icon>
                <mat-autocomplete #autoForn="matAutocomplete"
                                  (optionSelected)="onFornitorePick(f, $event.option.value)">
                  @for (fo of filtraFornitori(f.cercaFornitore); track fo.id) {
                    <mat-option [value]="fo">
                      <span style="font-weight:600">{{ fo.ragioneSociale }}</span>
                      @if (fo.citta) { <span style="color:#94a3b8;margin-left:8px;font-size:12px">{{ fo.citta }}</span> }
                    </mat-option>
                  }
                </mat-autocomplete>
              </mat-form-field>
              <mat-form-field style="flex:1">
                <mat-label>{{ 'prodotti.form.codiceFornitore' | t }}</mat-label>
                <input matInput [(ngModel)]="f.codiceFornitore" [ngModelOptions]="{ standalone: true }" [placeholder]="'prodotti.form.codiceFornitorePlaceholder' | t">
              </mat-form-field>
              <mat-form-field style="flex:1">
                <mat-label>{{ 'prodotti.form.prezzoNettoEuro' | t }}</mat-label>
                <input matInput type="number" [step]="prezzoFmt.step()" min="0" [(ngModel)]="f.prezzoAcquisto" [ngModelOptions]="{ standalone: true }">
              </mat-form-field>
              <button mat-icon-button type="button" style="margin-top:6px"
                      [color]="f.predefinito ? 'primary' : undefined"
                      [title]="(f.predefinito ? 'prodotti.form.fornitorePredefinito' : 'prodotti.form.impostaPredefinito') | t"
                      (click)="setPredefinito($index)">
                <mat-icon>{{ f.predefinito ? 'star' : 'star_border' }}</mat-icon>
              </button>
              <button mat-icon-button type="button" style="margin-top:6px" [title]="'prodotti.form.rimuoviFornitore' | t" (click)="removeFornitore($index)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
          <button mat-stroked-button type="button" (click)="addFornitore()">
            <mat-icon>add</mat-icon> {{ 'prodotti.form.aggiungiFornitore' | t }}
          </button>
          @if (!fornitori.length) {
            <div style="font-size:12px;color:var(--text-tertiary);margin-top:6px">
              {{ 'prodotti.form.aggiungiFornitoriHint' | t }}
            </div>
          }

          @if (codiciAlias.length) {
            <div style="margin-top:14px">
              <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.4px;display:flex;align-items:center;gap:6px">
                <mat-icon style="font-size:15px;width:15px;height:15px">bookmark</mat-icon> {{ 'prodotti.form.codiciMemorizzati' | t }}
              </div>
              <div style="font-size:11px;color:var(--text-tertiary);margin:2px 0 8px">
                {{ 'prodotti.form.codiciMemorizzatiHint' | t }}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                @for (a of codiciAlias; track a.id) {
                  <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:99px;padding:3px 6px 3px 10px;font-size:12px;background:var(--surface-2, transparent)">
                    <span style="font-family:monospace;font-weight:700;color:var(--primary)">{{ a.codice }}</span>
                    @if (a.fornitoreNome) { <span style="color:var(--text-tertiary)">· {{ a.fornitoreNome }}</span> }
                    <button mat-icon-button type="button" [title]="'prodotti.form.rimuoviCodiceMemorizzato' | t"
                            style="width:22px;height:22px;line-height:22px" (click)="removeCodiceAlias(a)">
                      <mat-icon style="font-size:15px;width:15px;height:15px">close</mat-icon>
                    </button>
                  </span>
                }
              </div>
            </div>
          }
        </div>

        <!-- ── Magazzino ────────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>warehouse</mat-icon>
            <span>{{ 'prodotti.form.magazzino' | t }}</span>
            <span class="section-hint">{{ 'prodotti.form.magazzinoHint' | t }}</span>
          </div>
          <div>
            <mat-checkbox formControlName="haVarianti">{{ 'prodotti.form.gestisciVarianti' | t }}</mat-checkbox>
            <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;padding-left:32px">{{ 'prodotti.form.gestisciVariantiHint' | t }}</div>
          </div>
          @if (!form.value.haVarianti) {
            <div class="form-row">
              <mat-form-field><mat-label>{{ 'prodotti.form.quantita' | t }}</mat-label>
                <input matInput type="number" formControlName="quantita">
                <mat-icon matSuffix>inventory</mat-icon>
              </mat-form-field>
              <mat-form-field><mat-label>{{ 'prodotti.form.sogliaMinima' | t }}</mat-label>
                <input matInput type="number" min="0" step="1" formControlName="sogliaMinima"
                       [placeholder]="'prodotti.form.sogliaMinimaPlaceholder' | t">
                <mat-icon matSuffix>warning</mat-icon>
                <mat-hint>{{ 'prodotti.form.sogliaMinimaHint' | t }}</mat-hint>
              </mat-form-field>
            </div>
          }
        </div>

        <!-- ── Logistica & immagine ─────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>straighten</mat-icon>
            <span>{{ 'prodotti.form.logistica' | t }}</span>
            <span class="section-hint">{{ 'prodotti.form.logisticaHint' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>{{ 'prodotti.form.pesoUnitario' | t }}</mat-label>
              <input matInput type="number" min="0" step="0.001" formControlName="peso" [placeholder]="'prodotti.form.pesoPlaceholder' | t">
              <mat-icon matSuffix>scale</mat-icon>
              <mat-hint>{{ 'prodotti.form.pesoHint' | t }}</mat-hint>
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>{{ 'prodotti.form.dimensioni' | t }}</mat-label>
              <input matInput formControlName="dimensioni" [placeholder]="'prodotti.form.dimensioniPlaceholder' | t">
              <mat-icon matSuffix>straighten</mat-icon>
              <mat-hint>{{ 'prodotti.form.dimensioniHint' | t }}</mat-hint>
            </mat-form-field>
          </div>
          <div class="img-row">
            @if (immagine) {
              <img [src]="immagine" [alt]="'prodotti.form.immagineAlt' | t" class="img-preview">
              <div class="img-actions">
                <button mat-stroked-button type="button" (click)="imgInput.click()">
                  <mat-icon>swap_horiz</mat-icon> {{ 'prodotti.form.sostituisci' | t }}
                </button>
                <button mat-stroked-button type="button" color="warn" (click)="rimuoviImmagine()">
                  <mat-icon>delete</mat-icon> {{ 'prodotti.form.rimuovi' | t }}
                </button>
              </div>
            } @else {
              <button mat-stroked-button type="button" (click)="imgInput.click()" [disabled]="immagineLoading">
                <mat-icon>add_photo_alternate</mat-icon>
                {{ (immagineLoading ? 'prodotti.form.caricamento' : 'prodotti.form.caricaImmagine') | t }}
              </button>
              <span class="img-hint">{{ 'prodotti.form.immagineHint' | t }}</span>
            }
            <input #imgInput type="file" accept="image/*" class="hidden-input" (change)="onImmagineSelected($event)">
          </div>
        </div>

        <!-- ── Descrizione ──────────────────────────────── -->
        <div class="form-section is-flat">
          <div class="form-section-header">
            <mat-icon>description</mat-icon>
            <span>{{ 'prodotti.form.descrizione' | t }}</span>
          </div>
          <mat-form-field style="width:100%"><mat-label>{{ 'prodotti.form.descrizione' | t }}</mat-label>
            <textarea matInput rows="2" formControlName="descrizione" [placeholder]="'prodotti.form.descrizionePlaceholder' | t"></textarea></mat-form-field>
        </div>

        @if (form.value.haVarianti) {
          <div class="varianti-box">
            <div class="varianti-header">
              <span class="varianti-title">{{ 'prodotti.form.varianti' | t }}</span>
              <button mat-stroked-button type="button" (click)="addVariante()">
                <mat-icon>add</mat-icon> {{ 'prodotti.form.aggiungiVariante' | t }}
              </button>
            </div>
            <div class="var-table-wrap">
            <table class="var-table">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0">{{ 'prodotti.form.colTaglia' | t }}</th>
                  <th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0">{{ 'prodotti.form.colColore' | t }}</th>
                  <th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0">{{ 'prodotti.form.colQta' | t }}</th>
                  <th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;border-bottom:2px solid #e2e8f0">{{ 'prodotti.form.colBarcodeVariante' | t }}</th>
                  <th style="width:44px;border-bottom:2px solid #e2e8f0"></th>
                </tr>
              </thead>
              <tbody>
                @for (v of varianti; track $index; let i = $index) {
                  <tr>
                    <td style="padding:4px 4px">
                      <input class="var-input" [(ngModel)]="v.taglia" [ngModelOptions]="{standalone:true}" [placeholder]="'prodotti.form.tagliaPh' | t">
                    </td>
                    <td style="padding:4px 4px">
                      <input class="var-input" [(ngModel)]="v.colore" [ngModelOptions]="{standalone:true}" [placeholder]="'prodotti.form.colorePh' | t">
                    </td>
                    <td style="padding:4px 4px">
                      <input class="var-input num" type="number" min="0" step="1"
                             [(ngModel)]="v.quantita" [ngModelOptions]="{standalone:true}">
                    </td>
                    <td style="padding:4px 4px">
                      <input class="var-input" [(ngModel)]="v.barcode" [ngModelOptions]="{standalone:true}" [placeholder]="'prodotti.form.barcodeVariantePh' | t">
                    </td>
                    <td style="padding:4px 4px">
                      <button mat-icon-button type="button" color="warn" (click)="removeVariante(i)">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </td>
                  </tr>
                }
                @if (!varianti.length) {
                  <tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;font-size:13px">
                    {{ 'prodotti.form.nessunaVariante' | t }}
                  </td></tr>
                }
              </tbody>
            </table>
            </div>
            @if (varianti.length) {
              <div style="text-align:right;padding-top:8px;font-size:12px;color:#64748b">
                {{ 'prodotti.form.totaleQuantita' | t }} <b style="color:#1e293b">{{ totaleVarianti }}</b>
              </div>
            }
          </div>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'prodotti.form.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.invalid">{{ 'prodotti.form.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .var-input { border:1px solid #e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;width:100%;box-sizing:border-box; }
    .var-input:focus { outline:none;border-color:#0e6480; }
    .var-input.num { width:70px;text-align:right; }
    .varianti-box { margin-top:12px;border:1px solid #e2e8f0;border-radius:10px;padding:16px; }
    .varianti-header { display:flex;justify-content:space-between;align-items:center;margin-bottom:10px; }
    .varianti-title { font-size:12px;font-weight:700;color:#0e6480;text-transform:uppercase;letter-spacing:.5px; }
    .var-table-wrap { overflow-x:auto; }
    .var-table { width:100%;border-collapse:collapse;min-width:420px; }
    .prezzo-mode-toggle ::ng-deep .mat-button-toggle { font-size:11px; }
    .prezzo-mode-toggle ::ng-deep .mat-button-toggle-button { height:24px; padding:0 10px; line-height:24px; }
    .prezzo-mode-toggle ::ng-deep .mat-button-toggle-label-content { line-height:24px; padding:0; font-weight:600; }
    .img-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:4px; }
    .img-preview {
      max-width:160px; max-height:120px; border-radius:10px;
      border:1px solid var(--border, #e2e8f0); object-fit:contain; background:#fff;
      box-shadow: var(--shadow-xs, 0 1px 2px rgba(0,0,0,0.06));
    }
    .img-actions { display:flex; flex-direction:column; gap:8px; }
    .img-hint { font-size:11px; color:var(--text-tertiary, #94a3b8); max-width:260px; }
    @media (max-width: 600px) {
      .img-row { flex-direction:column; align-items:stretch; gap:10px; }
      .img-preview { max-width:100%; max-height:200px; }
      .img-actions { flex-direction:row; }
      .img-actions button { flex:1; }
      .img-hint { max-width:100%; }
    }
  `]
})
export class ProdottoDialogComponent implements OnInit {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  form: FormGroup;
  categorie: CategoriaProdotto[] = [];
  unitaMisura: UnitaMisura[] = [];
  aliquoteIva: AliquotaIva[] = [];
  varianti: { id?: number; taglia: string; colore: string; quantita: number; barcode: string }[] = [];
  fornitori: (ProdottoFornitore & { cercaFornitore?: string })[] = [];
  fornitoriList: Fornitore[] = [];
  codiciAlias: CodiceAlias[] = [];

  /** Immagine prodotto (data URL). Caricata a parte: la lista non la include. */
  immagine = '';
  immagineLoading = false;
  /** False finché l'immagine del prodotto in modifica non è arrivata dal server:
   *  evita che un salvataggio "veloce" la sovrascriva con il valore vuoto. */
  private immaginePronta = true;

  prezzoMode: 'netto' | 'ivato' = (localStorage.getItem('prodotto-prezzo-mode') as 'netto' | 'ivato') ?? 'netto';
  // Valori MOSTRATI nei campi prezzo (nella modalità corrente). Sono campi a sé,
  // legati con [(ngModel)]: così digitando non vengono riscritti a ogni tasto (il
  // vecchio [value]=getter su un input type=number rimangiava i decimali e di
  // fatto impediva di cambiare il prezzo). Il form tiene sempre il NETTO.
  prezzoInput: number | null = null;
  prezzoAcquistoInput: number | null = null;

  get totaleVarianti() { return this.varianti.reduce((s, v) => s + (v.quantita || 0), 0); }

  get margine(): number | null {
    const v = +(this.form.get('prezzo')?.value ?? 0);
    const a = +(this.form.get('prezzoAcquisto')?.value ?? 0);
    if (!v || !a) return null;
    return ((v - a) / v) * 100;
  }

  prezzoIvato(field: 'prezzo' | 'prezzoAcquisto'): number {
    const net = +(this.form.get(field)?.value ?? 0);
    const iva = +(this.form.get('iva')?.value ?? 0);
    return +(net * (1 + iva / 100)).toFixed(this.prezzoFmt.decimali());
  }

  /** Riallinea i campi visibili (prezzoInput/prezzoAcquistoInput) al netto salvato
   *  nel form, secondo la modalità corrente. Da chiamare quando cambiano modalità
   *  o IVA, NON a ogni tasto (altrimenti il cursore salterebbe). */
  private syncPrezziDisplay() {
    const iva = +(this.form.get('iva')?.value ?? 0);
    const dec = this.prezzoFmt.decimali();
    const toDisplay = (net: any): number | null => {
      if (net == null || net === '') return null;
      const n = +net;
      return this.prezzoMode === 'ivato' ? +(n * (1 + iva / 100)).toFixed(dec) : +n.toFixed(dec);
    };
    this.prezzoInput = toDisplay(this.form.get('prezzo')?.value);
    this.prezzoAcquistoInput = toDisplay(this.form.get('prezzoAcquisto')?.value);
  }

  /** L'utente ha digitato un prezzo (nella modalità corrente): lo riporto a netto
   *  e lo salvo nel form, senza ritoccare il campo visibile (niente salti cursore). */
  onPrezzoModelChange(field: 'prezzo' | 'prezzoAcquisto', val: number | null) {
    if (val == null || isNaN(+val)) {
      this.form.get(field)?.setValue(field === 'prezzo' ? 0 : null);
      return;
    }
    const iva = +(this.form.get('iva')?.value ?? 0);
    const net = this.prezzoMode === 'ivato' ? +val / (1 + iva / 100) : +val;
    this.form.get(field)?.setValue(+net.toFixed(this.prezzoMode === 'ivato' ? 4 : this.prezzoFmt.decimali()));
  }

  onPrezzoModeChange(mode: 'netto' | 'ivato') {
    this.prezzoMode = mode;
    localStorage.setItem('prodotto-prezzo-mode', mode);
    this.syncPrezziDisplay();
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private dialog: MatDialog,
    private confirm: ConfirmService,
    public dialogRef: MatDialogRef<ProdottoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Prodotto | null
  ) {
    this.form = this.fb.group({
      nome:         [data?.nome ?? '', Validators.required],
      categoria:    [data?.categoria ?? ''],
      codice:          [data?.codice ?? ''],
      barcode:         [data?.barcode ?? ''],
      unitaMisura:  [data?.unitaMisura ?? 'pz'],
      prezzo:         [data?.prezzo ?? 0, [Validators.min(0)]],
      prezzoAcquisto: [data?.prezzoAcquisto ?? null, [Validators.min(0)]],
      iva:            [data?.iva ?? 22, [Validators.min(0), Validators.max(100)]],
      // Giacenza: ammessi valori negativi (sotto scorta / venduto in attesa di
      // carico). Nessun min(0), altrimenti un prodotto già negativo non si salva.
      quantita:     [data?.quantita ?? 0],
      sogliaMinima: [data?.sogliaMinima || null, [Validators.min(0)]],
      descrizione:  [data?.descrizione ?? ''],
      haVarianti:   [data?.haVarianti ?? false],
      peso:         [data?.peso ?? null, [Validators.min(0)]],
      dimensioni:   [data?.dimensioni ?? ''],
    });
    this.immagine = data?.immagine ?? '';
    this.immaginePronta = !data?.id || data?.immagine !== undefined;
    // Inizializza i campi prezzo mostrati (modalità netto/ivato corrente).
    this.syncPrezziDisplay();
  }

  ngOnInit() {
    // Se cambia l'IVA (anche per scelta categoria) il prezzo ivato mostrato cambia:
    // riallineo i campi visibili. Il netto salvato nel form resta lo stesso.
    this.form.get('iva')?.valueChanges.subscribe(() => this.syncPrezziDisplay());
    this.ds.getCategorieProdotto().subscribe(c => {
      this.categorie = c;
      this.form.get('categoria')?.valueChanges.subscribe(catNome => {
        if (!catNome) return;
        const cat = this.categorie.find(x => x.nome === catNome);
        if (cat?.aliquotaIvaId) {
          const aliq = this.aliquoteIva.find(a => a.id === cat.aliquotaIvaId);
          if (aliq) this.form.get('iva')?.setValue(aliq.valore);
        }
      });
    });
    this.ds.getUnitaMisura().subscribe(u => this.unitaMisura = u);
    this.ds.getAliquoteIva().subscribe(a => this.aliquoteIva = a.filter(x => x.attiva));
    this.ds.getFornitori().subscribe(f => this.fornitoriList = f);
    if (this.data?.id && this.data.haVarianti) {
      this.ds.getProdottoVarianti(this.data.id).subscribe(v => this.varianti = v);
    } else if (this.data?.varianti?.length) {
      // Duplicazione: precarico le varianti del prodotto sorgente (come nuove, senza id/barcode).
      this.varianti = this.data.varianti.map(v => ({ taglia: v.taglia, colore: v.colore, quantita: v.quantita, barcode: '' }));
    }
    if (this.data?.id && !this.immaginePronta) {
      if (this.data.haImmagine === false) {
        this.immaginePronta = true;   // il prodotto non ha immagine: niente da scaricare
      } else {
        // L'immagine non viaggia nella lista: la recupero dal dettaglio.
        this.ds.getProdotto(this.data.id).subscribe({
          next: p => { this.immagine = p.immagine || ''; this.immaginePronta = true; },
          error: () => { this.immaginePronta = true; },
        });
      }
    }
    if (this.data?.id) {
      this.ds.getProdottoFornitori(this.data.id).subscribe(f =>
        this.fornitori = f.map(x => ({ ...x, cercaFornitore: x.fornitoreNome ?? '' })));
      this.ds.getCodiciAlias(this.data.id).subscribe(a => this.codiciAlias = a);
    } else if (this.data?.fornitori?.length) {
      // Duplicazione: precarico i fornitori del prodotto sorgente (come nuovi, senza id).
      this.fornitori = this.data.fornitori.map(x => ({
        fornitoreId: x.fornitoreId, codiceFornitore: x.codiceFornitore ?? '',
        prezzoAcquisto: x.prezzoAcquisto ?? null, predefinito: x.predefinito,
        cercaFornitore: x.fornitoreNome ?? '',
      }));
    }
  }

  /** Ricerca "a token" tra i fornitori: ogni parola deve comparire in nome, P.IVA o città. */
  filtraFornitori(text?: string): Fornitore[] {
    const tokens = (text ?? '').toString().toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return this.fornitoriList;
    return this.fornitoriList.filter(f => {
      const hay = `${f.ragioneSociale ?? ''} ${f.pIva ?? ''} ${f.citta ?? ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  onFornitorePick(f: ProdottoFornitore & { cercaFornitore?: string }, fo: Fornitore) {
    f.fornitoreId = fo.id ?? null;
    f.cercaFornitore = fo.ragioneSociale;
  }

  /** Al blur riallinea il testo mostrato al fornitore effettivamente selezionato (evita testo "orfano"). */
  syncFornitoreText(f: ProdottoFornitore & { cercaFornitore?: string }) {
    setTimeout(() => {
      const fo = this.fornitoriList.find(x => x.id === f.fornitoreId);
      f.cercaFornitore = fo?.ragioneSociale ?? '';
    }, 200);
  }

  async removeCodiceAlias(a: CodiceAlias) {
    const msg = a.fornitoreNome
      ? this.i18n.t('prodotti.msg.confermaRimuoviAliasConFornitore', { codice: a.codice, fornitore: a.fornitoreNome })
      : this.i18n.t('prodotti.msg.confermaRimuoviAliasSenzaFornitore', { codice: a.codice });
    if (!await this.confirm.delete(msg)) return;
    this.ds.deleteCodiceAlias(a.id).subscribe(() => {
      this.codiciAlias = this.codiciAlias.filter(x => x.id !== a.id);
    });
  }

  addVariante() { this.varianti.push({ taglia: '', colore: '', quantita: 0, barcode: '' }); }
  removeVariante(i: number) { this.varianti.splice(i, 1); }

  addFornitore() {
    this.fornitori.push({ fornitoreId: null, codiceFornitore: '', prezzoAcquisto: null, predefinito: this.fornitori.length === 0, cercaFornitore: '' });
  }
  removeFornitore(i: number) {
    const wasPref = this.fornitori[i]?.predefinito;
    this.fornitori.splice(i, 1);
    if (wasPref && this.fornitori.length) this.fornitori[0].predefinito = true;
  }
  setPredefinito(i: number) { this.fornitori.forEach((f, idx) => f.predefinito = idx === i); }

  scannerBarcode() {
    const ref = this.dialog.open(BarcodeScannerDialogComponent, { width: '480px', maxWidth: '95vw' });
    ref.afterClosed().subscribe((code: string | null | undefined) => {
      if (code) this.form.patchValue({ barcode: code });
    });
  }

  // ── Immagine prodotto ─────────────────────────────────────────────────────
  onImmagineSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.immagineLoading = true;
    const reader = new FileReader();
    reader.onload = () => this.ridimensionaImmagine(reader.result as string);
    reader.onerror = () => { this.immagineLoading = false; };
    reader.readAsDataURL(file);
  }

  /** Ridimensiona a max 900px sul lato lungo e comprime in JPEG su fondo bianco
   *  (le foto originali da fotocamera sarebbero troppo pesanti per il DB). */
  private ridimensionaImmagine(dataUrl: string) {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      this.immagine = canvas.toDataURL('image/jpeg', 0.85);
      this.immaginePronta = true;
      this.immagineLoading = false;
    };
    img.onerror = () => { this.immagineLoading = false; };
    img.src = dataUrl;
  }

  rimuoviImmagine() { this.immagine = ''; this.immaginePronta = true; }

  save() {
    if (this.form.valid) {
      const fornitori = this.fornitori.map(({ cercaFornitore, ...rest }) => rest);
      this.dialogRef.close({
        ...this.data, ...this.form.value, varianti: this.varianti, fornitori,
        // Inclusa solo quando è nota: se il fetch non è ancora arrivato il
        // backend la lascia invariata (undefined = non toccare).
        ...(this.immaginePronta ? { immagine: this.immagine } : {}),
      });
    }
  }
}

// ── Rettifica giacenza (rapida) ──────────────────────────────────────────────
@Component({
  selector: 'app-rettifica-giacenza-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'prodotti.rettifica.title' | t }}</h2>
    <mat-dialog-content style="min-width:360px">
      <p style="margin:0 0 4px;font-weight:600">{{ data.prodotto.nome }}</p>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-tertiary,#94a3b8)">
        {{ 'prodotti.rettifica.giacenzaAttuale' | t:{ q: data.prodotto.quantita ?? 0, um: data.prodotto.unitaMisura || '' } }}
      </p>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>{{ 'prodotti.rettifica.nuovaGiacenza' | t }}</mat-label>
        <input matInput type="number" [step]="step" [min]="0" [(ngModel)]="nuova"
               (keyup.enter)="save()" autofocus>
        <span matTextSuffix>{{ data.prodotto.unitaMisura || 'pz' }}</span>
      </mat-form-field>
      @if (nuova !== null && delta !== 0) {
        <p style="margin:-6px 0 12px;font-size:13px" [style.color]="delta > 0 ? '#16a34a' : '#dc2626'">
          <mat-icon style="font-size:16px;width:16px;height:16px;vertical-align:middle">{{ delta > 0 ? 'arrow_upward' : 'arrow_downward' }}</mat-icon>
          {{ 'prodotti.rettifica.deltaNote' | t:{ sign: (delta > 0 ? '+' : ''), delta } }}
        </p>
      }
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>{{ 'prodotti.rettifica.motivo' | t }}</mat-label>
        <input matInput [(ngModel)]="note" [placeholder]="'prodotti.rettifica.motivoPlaceholder' | t">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'prodotti.rettifica.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="nuova === null">{{ 'prodotti.rettifica.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class RettificaGiacenzaDialogComponent {
  nuova: number | null = null;
  note = '';
  constructor(
    public dialogRef: MatDialogRef<RettificaGiacenzaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { prodotto: Prodotto }
  ) { this.nuova = data.prodotto.quantita ?? 0; }
  /** L'unità del prodotto è frazionabile (kg, lt…)? Determina lo step dell'input. */
  get frazionabile(): boolean { return unitaFrazionabile(this.data.prodotto.unitaMisura); }
  get step(): number { return stepPerUnita(this.data.prodotto.unitaMisura); }
  get delta(): number { return (this.nuova ?? 0) - (this.data.prodotto.quantita ?? 0); }
  save() {
    if (this.nuova === null) return;
    // Arrotonda in modo coerente con l'unità: per i pezzi niente decimali.
    const q = arrotondaPerUnita(this.nuova, this.data.prodotto.unitaMisura);
    this.dialogRef.close({ quantita: q, note: this.note });
  }
}

// ── Component ────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-prodotti',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatFormFieldModule, MatInputModule,
            MatSortModule, MatSelectModule, MatPaginatorModule, MatTooltipModule, MatMenuModule,
            MatCheckboxModule, MatButtonToggleModule, ColumnPickerComponent, EmptyStateComponent,
            LoadingSkeletonComponent, TableKeyboardNavDirective, ExportMenuComponent, TPipe, TnPipe],
  templateUrl: './prodotti.html',
  styleUrl: './prodotti.scss'
})
export class ProdottiComponent implements OnInit, AfterViewInit {
  private confirm = inject(ConfirmService);
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  private allProdotti: Prodotto[] = [];
  loading = true;
  dataSource = new MatTableDataSource<Prodotto>([]);
  displayedColumns: string[] = ['select', 'nome', 'categoria', 'prezzo', 'margine', 'quantita', 'sogliaMinima'];
  /** Selezione multipla per la cancellazione in blocco (es. annullare un import). */
  selection = new SelectionModel<Prodotto>(true, []);
  busyBulk = false;

  readonly allCols: ColDef[] = [
    { key: 'nome', label: this.i18n.t('prodotti.col.nome') },
    { key: 'categoria', label: this.i18n.t('prodotti.col.categoria') },
    { key: 'codice', label: this.i18n.t('prodotti.col.codice'), defaultVisible: false },
    { key: 'codiceFornitore', label: this.i18n.t('prodotti.col.codiceFornitore'), defaultVisible: false },
    { key: 'barcode', label: this.i18n.t('prodotti.col.barcode'), defaultVisible: false },
    { key: 'prezzo', label: this.i18n.t('prodotti.col.prezzoNetto') },
    { key: 'prezzoAcquisto', label: this.i18n.t('prodotti.field.prezzoAcquisto'), defaultVisible: false },
    { key: 'margine', label: this.i18n.t('prodotti.col.margine') + ' %' },
    { key: 'quantita', label: this.i18n.t('prodotti.col.quantita') },
    { key: 'sogliaMinima', label: this.i18n.t('prodotti.col.sogliaMinima') },
    { key: 'iva', label: this.i18n.t('prodotti.col.iva'), defaultVisible: false },
    { key: 'unitaMisura', label: this.i18n.t('prodotti.col.unitaMisura'), defaultVisible: false },
    { key: 'id', label: this.i18n.t('prodotti.col.id'), defaultVisible: false },
  ];

  filtroCategoria: string | null = null;
  filtroSottoSoglia = false;
  filtroMargineBasso = false;
  /** Vista prezzi nella lista: netto (come salvati) o ivato (con IVA del prodotto). */
  prezzoVista: 'netto' | 'ivato' = (localStorage.getItem('prodotti-prezzi-vista') as 'netto' | 'ivato') ?? 'netto';
  setPrezzoVista(v: 'netto' | 'ivato') { this.prezzoVista = v; localStorage.setItem('prodotti-prezzi-vista', v); }
  /** Prezzo da mostrare in lista secondo la vista scelta (l'ivato usa l'IVA del prodotto). */
  prezzoVisualizzato(p: Prodotto, field: 'prezzo' | 'prezzoAcquisto'): number | null {
    const net = (p as any)[field];
    if (net == null || net === '') return null;
    return this.prezzoVista === 'ivato' ? +net * (1 + (p.iva ?? 0) / 100) : +net;
  }
  marginePerc(p: any): number | null {
    const v = +(p?.prezzo ?? 0), a = +(p?.prezzoAcquisto ?? 0);
    if (!v || !a) return null;
    return Math.round(((v - a) / v) * 1000) / 10;
  }
  get categorieList() { return [...new Set(this.allProdotti.map(p => p.categoria).filter(Boolean))].sort() as string[]; }
  // "Sotto soglia" = SOLO i prodotti con una soglia minima configurata (> 0) e
  // sotto di essa. Senza soglia (0/vuota) niente avviso, nemmeno a 0: così gli
  // articoli su ordinazione non generano notifiche perenni.
  isSottoSoglia(p: Prodotto): boolean {
    const q = p.quantita ?? 0;
    const soglia = p.sogliaMinima ?? 0;
    return soglia > 0 && q < soglia;
  }
  get sottoSogliaCount() {
    return this.allProdotti.filter(p => this.isSottoSoglia(p)).length;
  }
  get prodotti() { return this.dataSource.data; }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, public excel: ExcelService) {}

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  private pendingOpenId: number | null = null;

  ngOnInit() {
    this.pendingOpenId = consumePrefill<number>('openId');
    this.load();
    const pf = consumePrefill('prefill');
    if (pf) setTimeout(() => this.open(pf as Prodotto), 0);
  }

  private openPending(list: Prodotto[]) {
    if (this.pendingOpenId == null) return;
    const it = list.find(x => x.id === this.pendingOpenId);
    this.pendingOpenId = null;
    if (it) setTimeout(() => this.open(it), 0);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sortingDataAccessor = (item, col) => {
      switch (col) {
        case 'id': return item.id ?? 0;
        case 'prezzo': return item.prezzo ?? 0;
        case 'quantita': return item.quantita ?? 0;
        case 'sogliaMinima': return item.sogliaMinima ?? 0;
        case 'iva': return item.iva ?? 0;
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) => {
      const s = filter.toLowerCase();
      return (item.nome ?? '').toLowerCase().includes(s)
          || (item.codice ?? '').toLowerCase().includes(s)
          || (item.barcode ?? '').toLowerCase().includes(s)
          || (item.categoria ?? '').toLowerCase().includes(s)
          || (item.descrizione ?? '').toLowerCase().includes(s);
    };
  }

  load() {
    this.loading = true;
    this.ds.getProdotti().subscribe({
      next: p => { this.allProdotti = p; this.applyFilters(); this.selection.clear(); this.openPending(p); this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  applyFilters() {
    let data = this.allProdotti;
    if (this.filtroCategoria) data = data.filter(p => p.categoria === this.filtroCategoria);
    if (this.filtroSottoSoglia) data = data.filter(p => this.isSottoSoglia(p));
    if (this.filtroMargineBasso) data = data.filter(p => { const m = this.marginePerc(p); return m !== null && m < 15; });
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
  }

  resetFiltri() { this.filtroCategoria = null; this.filtroSottoSoglia = false; this.filtroMargineBasso = false; this.dataSource.filter = ''; this.applyFilters(); }

  onColsChange(cols: string[]) { this.displayedColumns = ['select', ...cols, 'azioni']; }

  // ── Selezione multipla + cancellazione in blocco ─────────────────────────────
  isAllSelected(): boolean {
    return this.dataSource.data.length > 0 && this.selection.selected.length === this.dataSource.data.length;
  }
  toggleAll() {
    this.isAllSelected() ? this.selection.clear() : this.dataSource.data.forEach(r => this.selection.select(r));
  }

  async bulkDelete() {
    const sel = this.selection.selected;
    if (!sel.length || this.busyBulk) return;
    const n = sel.length;
    if (!await this.confirm.delete(this.i18n.tn('prodotti.msg.bulkDeleteConfirm', n))) return;
    this.busyBulk = true;
    const backups = sel.map(p => ({ ...p }));   // righe già complete: ricreabili così com'è
    forkJoin(sel.map(p =>
      this.ds.deleteProdotto(p.id!).pipe(catchError(err => of({ __error: err })))
    )).subscribe(results => {
      this.busyBulk = false;
      const errori = results.filter((r: any) => r && r.__error).length;
      this.selection.clear();
      this.load();
      if (errori) {
        this.snack.open(
          `${this.i18n.tn('prodotti.msg.bulkDeleted', n - errori)}, ${this.i18n.tn('prodotti.msg.bulkFailed', errori)}`,
          'OK', { duration: 6000, panelClass: 'snack-error' });
      } else {
        const ref = this.snack.open(this.i18n.tn('prodotti.msg.bulkDeleted', n), this.i18n.t('prodotti.msg.annullaAzione'), { duration: 6000, panelClass: 'snack-ok' });
        ref.onAction().subscribe(() => {
          forkJoin(backups.map((full: any) => { const { id, ...p } = full; return this.ds.createProdotto(p).pipe(catchError(() => of(null))); }))
            .subscribe(() => { this.load(); this.snack.open(this.i18n.t('prodotti.msg.prodottiRipristinati'), '', { duration: 2000, panelClass: 'snack-ok' }); });
        });
      }
    });
  }

  print() {
    const t = (k: string) => this.i18n.t(k);
    const rows = this.dataSource.data;
    const e = (n: number|undefined) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(n??0);
    const body = rows.map(p=>`<tr><td>${p.nome}</td><td>${p.categoria||'—'}</td><td>${p.codice||'—'}</td><td>${p.barcode||'—'}</td><td class="r">${e(p.prezzo)}</td><td class="r">${p.quantita??0}</td><td class="r">${p.sogliaMinima??0}</td><td class="r">${p.iva??0}%</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('prodotti.entityLabel')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}.r{text-align:right}</style></head><body><h1>${t('prodotti.entityLabel')}</h1><table><thead><tr><th>${t('prodotti.field.nome')}</th><th>${t('prodotti.field.categoria')}</th><th>${t('prodotti.field.codice')}</th><th>${t('prodotti.field.barcode')}</th><th class="r">${t('prodotti.col.prezzoNetto')}</th><th class="r">${t('prodotti.col.quantita')}</th><th class="r">${t('prodotti.col.sogliaMinima')}</th><th class="r">${t('prodotti.col.iva')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim();
  }

  open(p?: Prodotto) {
    const ref = this.dialog.open(ProdottoDialogComponent, { data: p ?? null, width: '95vw', maxWidth: '900px' });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateProdotto(result) : this.ds.createProdotto(result);
      op.subscribe({ next: () => { this.load(); this.snack.open(this.i18n.t('prodotti.msg.salvato'), '', { duration: 2000 }); },
                     error: e => this.snack.open(e.message, '', { duration: 3000 }) });
    });
  }

  /** Duplica un prodotto: apre la scheda precompilata col nome + " (copia)" (e fornitori/varianti/immagine copiati). */
  duplica(p: Prodotto) {
    forkJoin({
      fornitori: this.ds.getProdottoFornitori(p.id!),
      dettaglio: this.ds.getProdotto(p.id!),
    }).subscribe(({ fornitori, dettaglio }) => {
      const clone: Prodotto = {
        ...p,
        id: undefined,
        nome: `${p.nome} (copia)`,
        barcode: '',
        quantita: 0,
        fornitori,
        immagine: dettaglio.immagine || '',
        varianti: (p.varianti ?? []).map(v => ({ taglia: v.taglia, colore: v.colore, quantita: 0, barcode: '' })),
      };
      const ref = this.dialog.open(ProdottoDialogComponent, { data: clone, width: '95vw', maxWidth: '900px' });
      ref.afterClosed().subscribe(result => {
        if (!result) return;
        this.ds.createProdotto(result).subscribe({
          next: () => { this.load(); this.snack.open(this.i18n.t('prodotti.msg.prodottoDuplicato'), '', { duration: 2000 }); },
          error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 }),
        });
      });
    });
  }

  openImportListino() {
    this.dialog.open(ImportListinoDialogComponent, { width: '600px', maxWidth: '96vw' })
      .afterClosed().subscribe(() => this.load());
  }

  quickAdd() {
    const ref = this.dialog.open(QuickAddProdottoDialogComponent, {
      width: '95vw', maxWidth: '640px', autoFocus: false,
    });
    ref.afterClosed().subscribe((count: number) => {
      if (count && count > 0) {
        this.load();
        this.snack.open(this.i18n.tn('prodotti.msg.quickAddResult', count), '', { duration: 2500 });
      }
    });
  }

  info(p: Prodotto) {
    const t = (k: string, params?: Record<string, string | number>) => this.i18n.t(k, params);
    const fmt = (n: number | undefined) => n != null ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n) : undefined;
    const data: InfoDialogData = {
      title: p.nome,
      subtitle: p.categoria || undefined,
      sections: [
        {
          title: t('prodotti.info.identificazione'),
          rows: [
            { label: t('prodotti.info.codice'),         value: p.codice,          mono: true },
            { label: t('prodotti.info.barcode'),        value: p.barcode,         mono: true },
            { label: t('prodotti.info.codFornitore'),   value: p.codiceFornitore, mono: true },
            { label: t('prodotti.info.descrizione'),    value: p.descrizione },
          ],
        },
        {
          title: t('prodotti.info.prezzi'),
          rows: [
            { label: t('prodotti.info.prezzoVendita'),  value: fmt(p.prezzo) },
            { label: t('prodotti.info.prezzoAcquisto'), value: fmt(p.prezzoAcquisto) },
            { label: t('prodotti.info.iva'),            value: p.iva != null ? `${p.iva}%` : undefined },
          ],
        },
        {
          title: t('prodotti.info.magazzino'),
          rows: [
            { label: t('prodotti.info.quantita'),       value: p.quantita != null ? String(p.quantita) + (p.unitaMisura ? ' ' + p.unitaMisura : '') : undefined },
            { label: t('prodotti.info.sogliaMinima'),   value: p.sogliaMinima != null ? String(p.sogliaMinima) : undefined },
            { label: t('prodotti.info.unitaMisura'),    value: p.unitaMisura },
            { label: t('prodotti.info.conVarianti'),    value: p.haVarianti ? t('prodotti.info.si') : undefined },
          ],
        },
        {
          title: t('prodotti.info.logistica'),
          rows: [
            { label: t('prodotti.info.pesoUnitario'),   value: p.peso != null ? `${p.peso} kg` : undefined },
            { label: t('prodotti.info.dimensioni'),     value: p.dimensioni || undefined },
            { label: t('prodotti.info.immagine'),       value: p.haImmagine ? t('prodotti.info.si') : undefined },
          ],
        },
      ],
    };
    if (p.haVarianti && p.varianti?.length) {
      data.sections.push({
        title: t('prodotti.info.varianti'),
        rows: p.varianti.map(v => ({
          label: [v.taglia, v.colore].filter(x => !!x).join(' / ') || `#${v.id}`,
          value: t('prodotti.info.qtaLabel', { q: v.quantita }) + (v.barcode ? ' · ' + v.barcode : ''),
        })),
      });
    }
    this.dialog.open(InfoDialogComponent, { data, width: '520px', maxWidth: '95vw' });
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('prodotti.field.nome'),            field: 'nome',            width: 30 },
    { header: this.i18n.t('prodotti.field.categoria'),       field: 'categoria',       width: 18 },
    { header: this.i18n.t('prodotti.field.descrizione'),     field: 'descrizione',     width: 32 },
    { header: this.i18n.t('prodotti.field.codice'),          field: 'codice',          width: 14 },
    { header: this.i18n.t('prodotti.field.codiceFornitore'), field: 'codiceFornitore', width: 16 },
    { header: this.i18n.t('prodotti.field.barcode'),         field: 'barcode',         width: 16 },
    { header: this.i18n.t('prodotti.field.prezzo'),          field: 'prezzo',          width: 12 },
    { header: this.i18n.t('prodotti.field.prezzoAcquisto'),  field: 'prezzoAcquisto',  width: 14 },
    { header: this.i18n.t('prodotti.field.iva'),             field: 'iva',             width: 8  },
    { header: this.i18n.t('prodotti.field.quantita'),        field: 'quantita',        width: 10 },
    { header: this.i18n.t('prodotti.field.sogliaMinima'),    field: 'sogliaMinima',    width: 12 },
    { header: this.i18n.t('prodotti.field.unitaMisura'),     field: 'unitaMisura',     width: 12 },
  ];

  importExcel(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';
    this.excel.readFile(file).then(rows => {
      if (!rows.length) { this.snack.open(this.i18n.t('prodotti.msg.fileVuoto'), '', { duration: 3000 }); return; }
      this.dialog.open(ImportMappingDialogComponent, {
        data: { rows, fields: buildProdottiFields(this.i18n), entityType: 'prodotti', entityLabel: this.i18n.t('prodotti.entityLabel'),
                priceVatFields: [
                  { key: 'prezzo', label: this.i18n.t('prodotti.field.prezzoVenditaLabel') },
                  { key: 'prezzoAcquisto', label: this.i18n.t('prodotti.field.prezzoAcquistoLabel') },
                ] },
        disableClose: true,
      }).afterClosed().subscribe((result: MappingResult | null) => {
        if (!result) return;
        const toNum = (s: any) => parseFloat(String(s ?? '').replace(',', '.') || '0') || 0;
        const toInt = (s: any) => parseInt(String(s ?? '').replace(',', '.') || '0', 10) || 0;
        const v = (key: string, row: Record<string, any>) => row[result.mapping[key]] ?? '';
        // L'utente indica per ogni prezzo se nel file è IVA inclusa: in tal caso
        // lo converto in netto (lo storage tiene sempre il netto) usando l'aliquota
        // della riga. Vendita e acquisto sono indipendenti.
        const venditaIvato  = !!result.priceVat?.['prezzo'];
        const acquistoIvato = !!result.priceVat?.['prezzoAcquisto'];
        const aNetto = (lordo: number, ivaPerc: number, ivato: boolean) =>
          ivato && ivaPerc > 0 ? Math.round((lordo / (1 + ivaPerc / 100)) * 100) / 100 : lordo;
        const records = rows.map(r => {
          const iva = toNum(v('iva', r)) || 22;
          const prezzo = toNum(v('prezzo', r));
          const prezzoAcquisto = toNum(v('prezzoAcquisto', r));
          return {
            nome:            String(v('nome', r)).trim(),
            categoria:       String(v('categoria', r)).trim(),
            descrizione:     String(v('descrizione', r)).trim(),
            codice:          String(v('codice', r)).trim(),
            codiceFornitore: String(v('codiceFornitore', r)).trim(),
            barcode:         String(v('barcode', r)).trim(),
            prezzo:          aNetto(prezzo, iva, venditaIvato),
            prezzoAcquisto:  prezzoAcquisto ? aNetto(prezzoAcquisto, iva, acquistoIvato) : null,
            iva,
            quantita:        toInt(v('quantita', r)),
            sogliaMinima:    toInt(v('sogliaMinima', r)),
            unitaMisura:     String(v('unitaMisura', r)).trim() || 'pz',
          };
        }).filter(p => p.nome.length > 0);
        if (!records.length) {
          this.snack.open(this.i18n.t('prodotti.msg.nessunProdottoValido'), '', { duration: 5000 });
          return;
        }
        this.ds.importProdotti(records).subscribe({
          next: (res: any) => {
            this.load();
            this.snack.open(this.i18n.t('prodotti.msg.importResult', { created: res.created, updated: res.updated, skipped: res.skipped }), '', { duration: 5000 });
          },
          error: (err: any) => {
            this.snack.open(this.i18n.t('prodotti.msg.erroreImport', { msg: err?.error?.message || err?.message || JSON.stringify(err?.error) || this.i18n.t('prodotti.msg.erroreSconosciuto') }), '', { duration: 6000 });
          }
        });
      });
    }).catch(() => {
      this.snack.open(this.i18n.t('prodotti.msg.fileNonLeggibile'), '', { duration: 3000 });
    });
  }

  openRettifica(p: Prodotto) {
    this.dialog.open(RettificaGiacenzaDialogComponent, { data: { prodotto: p }, width: '420px' })
      .afterClosed().subscribe(res => {
        if (!res) return;
        this.ds.rettificaGiacenza(p.id!, res.quantita, res.note).subscribe({
          next: () => { this.load(); this.snack.open(this.i18n.t('prodotti.msg.giacenzaAggiornata'), '', { duration: 2000 }); },
          error: e => this.snack.open(e.error?.error || this.i18n.t('prodotti.msg.erroreRettifica'), '', { duration: 3000 })
        });
      });
  }

  async delete(p: Prodotto) {
    if (!await this.confirm.delete(this.i18n.t('prodotti.msg.confirmDelete', { nome: p.nome }))) return;
    this.ds.deleteProdotto(p.id!).subscribe(() => { this.load(); this.snack.open(this.i18n.t('prodotti.msg.eliminato'), '', { duration: 2000 }); });
  }
}
