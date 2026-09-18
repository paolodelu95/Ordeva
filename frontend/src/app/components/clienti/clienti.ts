import { inject, Component, OnInit, AfterViewInit, Inject, ViewChild, HostListener, ElementRef } from '@angular/core';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { LoadingSkeletonComponent } from '../shared/loading-skeleton';
import { FieldHelpComponent } from '../shared/field-help';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators,
         AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Observable, of, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap, map, catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { CityService, CityResult } from '../../services/city.service';
import { CitySearchDialogComponent } from '../shared/city-search-dialog';
import { clienteMatch } from '../../utils/cliente-match';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { SchedaClienteDialogComponent } from './scheda-cliente-dialog';
import { Cliente, ClienteIndirizzo, TipoPagamento, Listino, AliquotaIva, Agente } from '../../models';
import { Router } from '@angular/router';
import { consumePrefill } from '../../utils/nav-prefill';
import { pIvaValidator, codiceFiscaleValidator, telefonoValidator, capValidator, normalizePiva } from '../../validators/italian-validators';
import { ImportMappingDialogComponent, FieldDef, MappingResult } from '../shared/import-mapping-dialog';
import { ColumnPickerComponent, ColDef } from '../shared/column-picker';
import { InfoDialogComponent, InfoDialogData } from '../shared/info-dialog';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { focusPrimoInvalido } from '../../utils/focus-invalido';

function buildClientiFields(i18n: I18nService): FieldDef[] { return [
  { key: 'ragioneSociale', label: i18n.t('clienti.field.ragioneSociale'), required: true, aliases: [
    'Ragione Sociale', 'ragioneSociale', 'Denominazione', 'Azienda', 'Nome Azienda',
    'Ragione sociale', 'Company', 'Company Name', 'Nominativo', 'Nome Cliente',
    'Cliente', 'Intestazione', 'Intestatario',
  ]},
  { key: 'email', label: i18n.t('clienti.field.email'), aliases: [
    'Email', 'email', 'E-mail', 'E_mail', 'Email Address', 'Indirizzo Email',
    'Posta Elettronica', 'Mail',
  ]},
  { key: 'telefono', label: i18n.t('clienti.field.telefono'), aliases: [
    'Telefono', 'telefono', 'Tel', 'Tel.', 'Telefono 1', 'Telefono fisso',
    'Cell', 'Cellulare', 'Phone', 'Mobile', 'Phone Number', 'Numero di telefono',
  ]},
  { key: 'cellulare', label: i18n.t('clienti.field.cellulare'), aliases: [
    'Cellulare', 'cellulare', 'Cell', 'Mobile', 'Telefono Mobile', 'Cell.', 'Tel. Mobile',
  ]},
  { key: 'via', label: i18n.t('clienti.field.via'), aliases: [
    'Via', 'via', 'Indirizzo', 'Indirizzo 1', 'Street', 'Address',
    'Indirizzo stradale', 'Sede', 'Via e numero',
  ]},
  { key: 'cap', label: i18n.t('clienti.field.cap'), aliases: [
    'CAP', 'cap', 'Codice Postale', 'ZIP', 'Postal Code', 'ZIP Code', 'C.A.P.',
  ]},
  { key: 'citta', label: i18n.t('clienti.field.citta'), aliases: [
    'Città', 'Citta', 'citta', 'Comune', 'City', 'Town', 'Localita', 'Località',
  ]},
  { key: 'provincia', label: i18n.t('clienti.field.provincia'), aliases: [
    'Provincia', 'provincia', 'Prov', 'Prov.', 'Province', 'Sigla Provincia',
  ]},
  { key: 'stato', label: i18n.t('clienti.field.stato'), aliases: [
    'Stato', 'stato', 'Country', 'Nazione', 'Paese', 'Naz.',
  ]},
  { key: 'codiceFiscale', label: i18n.t('clienti.field.codiceFiscale'), aliases: [
    'Codice Fiscale', 'codiceFiscale', 'C.F.', 'CF', 'Cod. Fiscale',
    'Tax Code', 'Fiscal Code', 'Cod.Fiscale',
  ]},
  { key: 'pIva', label: i18n.t('clienti.field.pIva'), aliases: [
    'P. IVA', 'pIva', 'P.IVA', 'Partita IVA', 'Partita_IVA', 'VAT',
    'VAT Number', 'P IVA', 'PIVA', 'CF/PIVA', 'Partita iva',
  ]},
  { key: 'sdi', label: i18n.t('clienti.field.sdi'), aliases: [
    'SDI', 'sdi', 'Codice SDI', 'Codice Destinatario', 'Destinatario SDI',
    'Codice Univoco', 'Cod. Destinatario',
  ]},
  { key: 'pec', label: i18n.t('clienti.field.pec'), aliases: [
    'PEC', 'pec', 'Posta Certificata', 'PEC Address', 'Indirizzo PEC',
  ]},
]; }

// ── Dialog ────────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-cliente-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatAutocompleteModule, MatSelectModule,
            MatSnackBarModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MatTabsModule,
            MatSlideToggleModule, FieldHelpComponent, TPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon"><mat-icon>person</mat-icon></div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ data ? data.ragioneSociale : (('clienti.dialog.new') | t) }}</span>
          <span class="dialog-hero-sub">{{ (data ? 'clienti.dialog.editSub' : 'clienti.dialog.newSub') | t }}</span>
        </div>
      </div>

      <mat-tab-group>
        <mat-tab [label]="'clienti.tab.anagrafica' | t">
      <form [formGroup]="form" class="dialog-form" style="padding-top:16px">

        <!-- ── Identità ─────────────────────────────────── -->
        <div class="form-section is-primary">
          <div class="form-section-header">
            <mat-icon>badge</mat-icon>
            <span>{{ 'clienti.form.identita' | t }}</span>
            <span class="section-hint">{{ 'clienti.form.identitaHint' | t }}</span>
          </div>
          <mat-form-field style="width:100%">
            <mat-label>{{ 'clienti.form.ragioneSociale' | t }}</mat-label>
            <input matInput formControlName="ragioneSociale">
            @if (form.get('ragioneSociale')?.hasError('required') && form.get('ragioneSociale')?.touched) {
              <mat-error>{{ 'comune.campoObbligatorio' | t }}</mat-error>
            }
          </mat-form-field>
          <div class="form-row">
            <div class="input-with-action" style="flex:1">
              <mat-form-field>
                <mat-label>{{ 'clienti.form.piva' | t }}</mat-label>
                <input matInput formControlName="pIva" [placeholder]="'clienti.form.pivaPlaceholder' | t">
                <app-field-help matSuffix term="piva" />
                @if (form.get('pIva')?.hasError('pIva')) {
                  <mat-error>{{ 'clienti.form.pivaInvalid' | t }}</mat-error>
                }
                @if (form.get('pIva')?.hasError('pivaEsiste')) {
                  <mat-error>{{ 'clienti.form.pivaEsiste' | t }}</mat-error>
                }
                @if (form.get('pIva')?.pending) {
                  <mat-hint>{{ 'clienti.form.pivaVerifica' | t }}</mat-hint>
                }
              </mat-form-field>
              <button mat-icon-button type="button"
                      [matTooltip]="'clienti.form.caricaDaPiva' | t"
                      [disabled]="lookupLoading || !canLookupPiva"
                      (click)="lookupPiva()">
                @if (lookupLoading) {
                  <mat-spinner diameter="20"></mat-spinner>
                } @else {
                  <mat-icon>cloud_download</mat-icon>
                }
              </button>
            </div>
            <mat-form-field>
              <mat-label>{{ 'clienti.form.codiceFiscale' | t }}</mat-label>
              <input matInput formControlName="codiceFiscale" style="text-transform:uppercase">
              <app-field-help matSuffix term="codiceFiscale" />
              @if (form.get('codiceFiscale')?.hasError('codiceFiscale')) {
                <mat-error>{{ 'clienti.form.codiceFiscaleInvalid' | t }}</mat-error>
              }
            </mat-form-field>
          </div>
        </div>

        <!-- ── Fatturazione elettronica ─────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>receipt_long</mat-icon>
            <span>{{ 'clienti.form.fatturazioneElettronica' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field style="max-width:180px">
              <mat-label>{{ 'clienti.form.tipoSoggetto' | t }}</mat-label>
              <mat-select formControlName="tipoSoggetto">
                <mat-option value="PRIVATO">{{ 'clienti.form.tipoSoggettoPrivato' | t }}</mat-option>
                <mat-option value="PA">{{ 'clienti.form.tipoSoggettoPA' | t }}</mat-option>
                <mat-option value="PROFESSIONISTA">{{ 'clienti.form.tipoSoggettoProfessionista' | t }}</mat-option>
              </mat-select>
            </mat-form-field>
            <mat-form-field><mat-label>{{ 'clienti.form.sdi' | t }}</mat-label>
              <input matInput formControlName="sdi" style="text-transform:uppercase" maxlength="7" [placeholder]="'clienti.form.sdiPlaceholder' | t">
              <app-field-help matSuffix term="sdi" />
            </mat-form-field>
            <mat-form-field style="flex:2"><mat-label>{{ 'clienti.form.pec' | t }}</mat-label>
              <input matInput formControlName="pec" [placeholder]="'clienti.form.pecPlaceholder' | t">
              <app-field-help matSuffix term="pec" />
            </mat-form-field>
          </div>
          @if (form.get('tipoSoggetto')?.value === 'PA') {
            <div class="form-row" style="margin-top:4px">
              <mat-form-field>
                <mat-label>{{ 'clienti.form.cig' | t }}</mat-label>
                <input matInput formControlName="cig" placeholder="es. Z123456789" style="text-transform:uppercase">
                <mat-hint>{{ 'clienti.form.cigHint' | t }}</mat-hint>
              </mat-form-field>
              <mat-form-field>
                <mat-label>{{ 'clienti.form.cup' | t }}</mat-label>
                <input matInput formControlName="cup" placeholder="es. C57I18000050006" style="text-transform:uppercase">
                <mat-hint>{{ 'clienti.form.cupHint' | t }}</mat-hint>
              </mat-form-field>
            </div>
          }
        </div>

        <!-- ── Sede / Indirizzo ─────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>location_on</mat-icon>
            <span>{{ 'clienti.form.sedeLegale' | t }}</span>
          </div>
          <mat-form-field style="width:100%"><mat-label>{{ 'clienti.form.via' | t }}</mat-label>
            <input matInput formControlName="via"></mat-form-field>
          <div class="form-row">
            <mat-form-field style="max-width:120px"><mat-label>{{ 'clienti.form.cap' | t }}</mat-label>
              <input matInput formControlName="cap" maxlength="5">
              @if (form.get('cap')?.hasError('cap') && form.get('cap')?.dirty) {
                <mat-error>{{ 'clienti.form.capInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'clienti.form.citta' | t }}</mat-label>
              <input matInput formControlName="citta" [matAutocomplete]="auto">
              <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onCitySelected($event.option.value)">
                @for (c of filteredCities; track c.name) {
                  <mat-option [value]="c.name">{{ c.name }}</mat-option>
                }
              </mat-autocomplete>
              <button mat-icon-button matSuffix type="button" [matTooltip]="'shared.citySearch.tooltip' | t" (click)="cercaComune()">
                <mat-icon>search</mat-icon>
              </button>
            </mat-form-field>
            <mat-form-field style="max-width:80px"><mat-label>{{ 'clienti.form.provincia' | t }}</mat-label>
              <input matInput formControlName="provincia" maxlength="2" style="text-transform:uppercase">
              <mat-hint>{{ 'clienti.form.provinciaHint' | t }}</mat-hint></mat-form-field>
            <mat-form-field style="max-width:120px"><mat-label>{{ 'clienti.form.stato' | t }}</mat-label>
              <input matInput formControlName="stato"></mat-form-field>
          </div>
        </div>

        <!-- ── Contatti ─────────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>contact_phone</mat-icon>
            <span>{{ 'clienti.form.contatti' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field>
              <mat-label>{{ 'clienti.form.email' | t }}</mat-label>
              <input matInput formControlName="email" type="email">
              <mat-icon matSuffix>alternate_email</mat-icon>
              @if (form.get('email')?.hasError('email') && form.get('email')?.dirty) {
                <mat-error>{{ 'clienti.form.emailInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'clienti.form.telefono' | t }}</mat-label>
              <input matInput formControlName="telefono">
              <mat-icon matSuffix>call</mat-icon>
              @if (form.get('telefono')?.hasError('telefono') && form.get('telefono')?.dirty) {
                <mat-error>{{ 'clienti.form.telefonoInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'clienti.form.cellulare' | t }}</mat-label>
              <input matInput formControlName="cellulare">
              <mat-icon matSuffix>smartphone</mat-icon>
            </mat-form-field>
          </div>
        </div>

        <!-- ── Preferenze ───────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>tune</mat-icon>
            <span>{{ 'clienti.form.preferenze' | t }}</span>
            <span class="section-hint">{{ 'clienti.form.preferenzeHint' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field>
              <mat-label>{{ 'clienti.form.metodoPagamento' | t }}</mat-label>
              <mat-select formControlName="tipoPagamentoId">
                <mat-option [value]="null">{{ 'clienti.form.nessuno' | t }}</mat-option>
                @for (t of tipiPagamento; track t.id) {
                  <mat-option [value]="t.id">{{ t.nome }}</mat-option>
                }
              </mat-select>
              <mat-icon matSuffix>payments</mat-icon>
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'clienti.form.aliquotaIva' | t }}</mat-label>
              <mat-select formControlName="aliquotaIvaId">
                <mat-option [value]="null">{{ 'clienti.form.aliquotaDefault' | t }}</mat-option>
                @for (a of aliquoteIva; track a.id) {
                  <mat-option [value]="a.id">
                    {{ a.valore }}% {{ a.codice ? '(' + a.codice + ')' : '' }} — {{ a.nome }}
                  </mat-option>
                }
              </mat-select>
              <mat-icon matSuffix>percent</mat-icon>
              <mat-hint>{{ 'clienti.form.aliquotaHint' | t }}</mat-hint>
            </mat-form-field>
          </div>
          <div class="form-row">
            <mat-form-field>
              <mat-label>{{ 'clienti.form.listino' | t }}</mat-label>
              <mat-select formControlName="listinoId">
                <mat-option [value]="null">{{ 'clienti.form.prezzoBase' | t }}</mat-option>
                @for (l of listini; track l.id) {
                  <mat-option [value]="l.id">
                    {{ l.nome }}
                    @if (l.scontoDefault) { <span style="color:#94a3b8">&nbsp;(-{{ l.scontoDefault }}%)</span> }
                  </mat-option>
                }
              </mat-select>
              <mat-icon matSuffix>price_change</mat-icon>
              @if (form.value.listinoId) {
                <mat-hint>{{ 'clienti.form.listinoHint' | t }}</mat-hint>
              }
            </mat-form-field>
          </div>
          @if (agenti.length) {
            <div class="form-row">
              <mat-form-field>
                <mat-label>{{ 'clienti.form.agente' | t }}</mat-label>
                <mat-select formControlName="agenteId">
                  <mat-option [value]="null">{{ 'clienti.form.nessuno' | t }}</mat-option>
                  @for (ag of agenti; track ag.id) { <mat-option [value]="ag.id">{{ ag.nome }}</mat-option> }
                </mat-select>
                <mat-icon matSuffix>support_agent</mat-icon>
              </mat-form-field>
              @if (form.value.agenteId) {
                <mat-form-field>
                  <mat-label>{{ 'clienti.form.provvigione' | t }}</mat-label>
                  <input matInput type="number" min="0" max="100" step="0.5" formControlName="provvigione" [placeholder]="'clienti.form.provvigionePlaceholder' | t">
                  <span matSuffix>%</span>
                </mat-form-field>
              }
            </div>
          }
          <div class="form-row" style="align-items:flex-start">
            <div>
              <mat-slide-toggle formControlName="ancheFornitore">{{ 'clienti.form.ancheFornitore' | t }}</mat-slide-toggle>
              <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;max-width:520px">
                {{ 'clienti.form.ancheFornitoreHint' | t }}
              </div>
            </div>
          </div>
          <div class="form-row" style="align-items:flex-start">
            <div>
              <mat-slide-toggle formControlName="avvisoInsoluti">{{ 'clienti.form.avvisoInsoluti' | t }}</mat-slide-toggle>
              <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;max-width:520px">
                {{ 'clienti.form.avvisoInsolutiHint' | t }}
              </div>
            </div>
          </div>
        </div>
      </form>
        </mat-tab>

        <!-- ── Tab Indirizzi ──────────────────────────────────── -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon style="font-size:18px;margin-right:4px;vertical-align:middle">place</mat-icon>
            {{ 'clienti.tab.indirizzi' | t }}
          </ng-template>
          <div style="padding-top:16px;min-height:200px">
            @if (!data?.id) {
              <div style="color:#94a3b8;text-align:center;padding:32px 0;font-size:14px">
                <mat-icon style="font-size:40px;width:40px;height:40px;display:block;margin:0 auto 8px">info_outline</mat-icon>
                {{ 'clienti.form.salvaPrimaIndirizzi' | t }}
              </div>
            } @else {
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <span style="font-size:13px;color:#64748b">{{ 'clienti.form.destinazioniSalvate' | t }}</span>
                <button mat-stroked-button type="button" (click)="addIndirizzo()">
                  <mat-icon>add</mat-icon> {{ 'clienti.form.aggiungi' | t }}
                </button>
              </div>
              @if (!indirizzi.length) {
                <div style="color:#94a3b8;text-align:center;padding:24px 0;font-size:13px">{{ 'clienti.form.nessunIndirizzo' | t }}</div>
              }
              @for (addr of indirizzi; track addr.id ?? $index) {
                @if (editingId === addr.id) {
                  <div class="addr-card addr-card--editing">
                    <div class="addr-edit-row">
                      <mat-form-field style="flex:1">
                        <mat-label>{{ 'clienti.form.nomeEtichetta' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.nome" [placeholder]="'clienti.form.nomeEtichettaPh1' | t">
                      </mat-form-field>
                    </div>
                    <div class="addr-edit-row">
                      <mat-form-field style="flex:2">
                        <mat-label>{{ 'clienti.form.via' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.via">
                      </mat-form-field>
                      <mat-form-field style="max-width:90px">
                        <mat-label>{{ 'clienti.form.cap' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.cap" maxlength="5">
                      </mat-form-field>
                    </div>
                    <div class="addr-edit-row">
                      <mat-form-field style="flex:2">
                        <mat-label>{{ 'clienti.form.citta' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.citta">
                      </mat-form-field>
                      <mat-form-field style="max-width:70px">
                        <mat-label>{{ 'clienti.form.provincia' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.provincia" maxlength="2" style="text-transform:uppercase">
                      </mat-form-field>
                      <mat-form-field style="max-width:100px">
                        <mat-label>{{ 'clienti.form.stato' | t }}</mat-label>
                        <input matInput [(ngModel)]="editBuf.stato">
                      </mat-form-field>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
                      <button mat-button type="button" (click)="cancelEdit()">{{ 'clienti.form.annulla' | t }}</button>
                      <button mat-flat-button type="button" (click)="saveIndirizzo(addr)">{{ 'clienti.form.salva' | t }}</button>
                    </div>
                  </div>
                } @else {
                  <div class="addr-card">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
                      <div>
                        <div style="font-weight:600;font-size:13px;color:#1e293b">{{ addr.nome }}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px">
                          {{ [addr.via, addr.cap, addr.citta, addr.provincia].filter(v => !!v).join(', ') }}
                        </div>
                      </div>
                      <div style="display:flex;gap:2px">
                        <button mat-icon-button type="button" (click)="startEdit(addr)" [title]="'clienti.form.modificaIndirizzo' | t">
                          <mat-icon style="font-size:18px">edit</mat-icon>
                        </button>
                        <button mat-icon-button color="warn" type="button" (click)="deleteIndirizzo(addr)" [title]="'clienti.form.eliminaIndirizzo' | t">
                          <mat-icon style="font-size:18px">delete</mat-icon>
                        </button>
                      </div>
                    </div>
                  </div>
                }
              }
              @if (editingId === 'new') {
                <div class="addr-card addr-card--editing" style="margin-top:8px">
                  <div class="addr-edit-row">
                    <mat-form-field style="flex:1">
                      <mat-label>{{ 'clienti.form.nomeEtichettaReq' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.nome" [placeholder]="'clienti.form.nomeEtichettaPh2' | t">
                    </mat-form-field>
                  </div>
                  <div class="addr-edit-row">
                    <mat-form-field style="flex:2">
                      <mat-label>{{ 'clienti.form.via' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.via">
                    </mat-form-field>
                    <mat-form-field style="max-width:90px">
                      <mat-label>{{ 'clienti.form.cap' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.cap" maxlength="5">
                    </mat-form-field>
                  </div>
                  <div class="addr-edit-row">
                    <mat-form-field style="flex:2">
                      <mat-label>{{ 'clienti.form.citta' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.citta">
                    </mat-form-field>
                    <mat-form-field style="max-width:70px">
                      <mat-label>{{ 'clienti.form.provincia' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.provincia" maxlength="2" style="text-transform:uppercase">
                    </mat-form-field>
                    <mat-form-field style="max-width:100px">
                      <mat-label>{{ 'clienti.form.stato' | t }}</mat-label>
                      <input matInput [(ngModel)]="editBuf.stato">
                    </mat-form-field>
                  </div>
                  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
                    <button mat-button type="button" (click)="cancelEdit()">{{ 'clienti.form.annulla' | t }}</button>
                    <button mat-flat-button type="button" (click)="createIndirizzo()">{{ 'clienti.form.aggiungi' | t }}</button>
                  </div>
                </div>
              }
            }
          </div>
        </mat-tab>

      </mat-tab-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'clienti.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="form.pending">{{ 'clienti.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .addr-card {
      border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px;
      margin-bottom: 8px; background: #fff;
    }
    .addr-card--editing { background: #f8fafc; border-color: #3b82f6; }
    .addr-edit-row { display:flex; gap:8px; }
  `]
})
export class ClienteDialogComponent implements OnInit {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  i18n = inject(I18nService);
  form: FormGroup;
  filteredCities: CityResult[] = [];
  tipiPagamento: TipoPagamento[] = [];
  listini: Listino[] = [];
  aliquoteIva: AliquotaIva[] = [];
  agenti: Agente[] = [];
  lookupLoading = false;
  get canLookupPiva(): boolean { return normalizePiva(this.form.get('pIva')?.value ?? '').length === 11; }
  private cityMap = new Map<string, CityResult>();

  // Address management
  indirizzi: ClienteIndirizzo[] = [];
  editingId: number | 'new' | null = null;
  editBuf: ClienteIndirizzo = { nome: '', via: '', cap: '', citta: '', provincia: '', stato: 'Italia' };

  addIndirizzo() {
    this.editingId = 'new';
    this.editBuf = { nome: '', via: '', cap: '', citta: '', provincia: '', stato: 'Italia' };
  }

  startEdit(addr: ClienteIndirizzo) {
    this.editingId = addr.id!;
    this.editBuf = { ...addr };
  }

  cancelEdit() {
    this.editingId = null;
    this.editBuf = { nome: '', via: '', cap: '', citta: '', provincia: '', stato: 'Italia' };
  }

  createIndirizzo() {
    if (!this.data?.id || !this.editBuf.nome.trim()) return;
    this.ds.createClienteIndirizzo(this.data.id, this.editBuf).subscribe({
      next: () => { this.loadIndirizzi(); this.cancelEdit(); },
      error: () => this.snack.open(this.i18n.t('clienti.msg.erroreSalvataggioIndirizzo'), '', { duration: 3000 }),
    });
  }

  saveIndirizzo(addr: ClienteIndirizzo) {
    if (!this.data?.id) return;
    this.ds.updateClienteIndirizzo(this.data.id, { ...this.editBuf, id: addr.id }).subscribe({
      next: () => { this.loadIndirizzi(); this.cancelEdit(); },
      error: () => this.snack.open(this.i18n.t('clienti.msg.erroreAggiornamentoIndirizzo'), '', { duration: 3000 }),
    });
  }

  deleteIndirizzo(addr: ClienteIndirizzo) {
    if (!this.data?.id || !addr.id) return;
    this.ds.deleteClienteIndirizzo(this.data.id, addr.id).subscribe({
      next: () => this.loadIndirizzi(),
      error: () => this.snack.open(this.i18n.t('clienti.msg.erroreEliminazioneIndirizzo'), '', { duration: 3000 }),
    });
  }

  private loadIndirizzi() {
    if (!this.data?.id) return;
    this.ds.getClienteIndirizzi(this.data.id).subscribe(a => this.indirizzi = a);
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private dialog: MatDialog,
    private cityService: CityService,
    private snack: MatSnackBar,
    public dialogRef: MatDialogRef<ClienteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Cliente | null
  ) {
    this.form = this.fb.group({
      ragioneSociale: [data?.ragioneSociale ?? '', Validators.required],
      email:          [data?.email ?? '', Validators.email],
      telefono:       [data?.telefono ?? '', telefonoValidator],
      cellulare:      [data?.cellulare ?? ''],
      via:            [data?.via ?? ''],
      cap:            [data?.cap ?? '', capValidator],
      citta:          [data?.citta ?? ''],
      provincia:      [data?.provincia ?? ''],
      stato:          [data?.stato ?? 'Italia'],
      codiceFiscale:  [data?.codiceFiscale ?? '', codiceFiscaleValidator],
      pIva:           [data?.pIva ?? '', pIvaValidator, this.pivaAsyncValidator('clienti', data?.id)],
      sdi:            [data?.sdi ?? ''],
      pec:            [data?.pec ?? ''],
      tipoPagamentoId:[data?.tipoPagamentoId ?? null],
      listinoId:      [data?.listinoId ?? null],
      tipoSoggetto:   [data?.tipoSoggetto ?? 'PRIVATO'],
      cig:            [data?.cig ?? ''],
      cup:            [data?.cup ?? ''],
      aliquotaIvaId:  [data?.aliquotaIvaId ?? null],
      ancheFornitore: [data?.ancheFornitore ?? false],
      // Avviso fatture da saldare su nuove fatture/DDT: acceso salvo esclusione.
      avvisoInsoluti: [data?.avvisoInsoluti !== false],
      agenteId:       [data?.agenteId ?? null],
      provvigione:    [data?.provvigione ?? null],
    });
    this.ds.getAgenti().subscribe(a => this.agenti = a.filter(x => x.attivo));
  }

  private pivaAsyncValidator(tipo: 'clienti' | 'fornitori', excludeId?: number): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      const piva = normalizePiva(control.value ?? '');
      if (!piva || piva.length !== 11) return of(null);
      return timer(500).pipe(
        switchMap(() => this.ds.checkPivaDuplicate(piva, tipo, excludeId)),
        map((r: any) => r.exists ? { pivaEsiste: true } : null),
        catchError(() => of(null))
      );
    };
  }

  ngOnInit() {
    this.ds.getTipiPagamento().subscribe(t => this.tipiPagamento = t.filter(x => x.attivo));
    this.ds.getListini().subscribe(l => this.listini = l.filter(x => x.attivo));
    this.ds.getAliquoteIva().subscribe(a => this.aliquoteIva = a.filter(x => x.attiva));
    this.loadIndirizzi();

    this.form.get('citta')!.valueChanges.pipe(
      debounceTime(300), distinctUntilChanged(),
      switchMap(v => this.cityService.searchCities(v ?? ''))
    ).subscribe(results => {
      this.filteredCities = results;
      results.forEach(r => this.cityMap.set(r.name, r));
    });

    this.form.get('cap')!.valueChanges.pipe(
      debounceTime(400), distinctUntilChanged(),
      filter(cap => cap?.length === 5),
      switchMap(cap => this.cityService.lookupByCap(cap))
    ).subscribe(result => {
      if (result) {
        this.form.patchValue({ citta: result.name, provincia: result.provincia, stato: 'Italia' }, { emitEvent: false });
        this.cityMap.set(result.name, result);
      }
    });
  }

  onCitySelected(name: string) {
    const r = this.cityMap.get(name);
    if (r) this.form.patchValue({ cap: r.cap, provincia: r.provincia, stato: 'Italia' }, { emitEvent: false });
  }

  /** Apre l'elenco completo dei comuni corrispondenti — utile quando il nome è
   *  parziale o ci sono più comuni omonimi e il dropdown dell'autocomplete non basta. */
  cercaComune() {
    const ref = this.dialog.open(CitySearchDialogComponent, { width: '480px', maxWidth: '95vw' });
    ref.afterClosed().subscribe((r: CityResult | undefined) => {
      if (r) this.form.patchValue({ citta: r.name, cap: r.cap, provincia: r.provincia, stato: 'Italia' });
    });
  }

  lookupPiva() {
    const piva = normalizePiva(this.form.get('pIva')?.value ?? '');
    if (!piva || piva.length !== 11) return;
    this.lookupLoading = true;
    this.ds.lookupPiva(piva).subscribe({
      next: result => {
        this.lookupLoading = false;
        const patch: any = {};
        if (result.ragioneSociale) patch.ragioneSociale = result.ragioneSociale;
        if (result.via)            patch.via = result.via;
        if (result.cap)            patch.cap = result.cap;
        if (result.citta)          patch.citta = result.citta;
        if (result.provincia)      patch.provincia = result.provincia;
        if (result.stato)          patch.stato = result.stato;
        this.form.patchValue(patch);
        this.snack.open(this.i18n.t('clienti.msg.datiCaricati'), '', { duration: 2500 });
      },
      error: () => {
        this.lookupLoading = false;
        this.snack.open(this.i18n.t('clienti.msg.pivaNonTrovata'), '', { duration: 3000 });
      }
    });
  }

  save() {
    this.form.markAllAsTouched();
    if (this.form.pending) return;
    if (!this.form.valid) {
      this.snack.open(this.i18n.t('clienti.msg.correggiCampi'), '', { duration: 3000 });
      // Il solo bordo rosso non basta: porta il fuoco sul campo da correggere.
      focusPrimoInvalido(this.host.nativeElement);
      return;
    }
    this.dialogRef.close({ ...this.data, ...this.form.value });
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
@Component({
  selector: 'app-clienti',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatFormFieldModule, MatInputModule, MatSortModule, MatPaginatorModule,
            MatTooltipModule, MatMenuModule, ColumnPickerComponent, EmptyStateComponent,
            LoadingSkeletonComponent, TableKeyboardNavDirective, ExportMenuComponent, TPipe],
  templateUrl: './clienti.html',
  styleUrl: './clienti.scss'
})
export class ClientiComponent implements OnInit, AfterViewInit {
  private confirm = inject(ConfirmService);
  i18n = inject(I18nService);
  print() {
    const t = (k: string) => this.i18n.t(k);
    const rows = this.dataSource.data;
    const body = rows.map(c=>`<tr><td>${c.ragioneSociale}</td><td>${c.email||'—'}</td><td>${c.telefono||'—'}</td><td>${this.indirizzo(c)||'—'}</td><td>${c.codiceFiscale||'—'}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><title>${t('clienti.entityLabel')}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}h1{font-size:16px;margin:0 0 12px}table{width:100%;border-collapse:collapse}th{background:#f8fafc;padding:8px;text-align:left;border-bottom:2px solid #ddd;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #f0f0f0}</style></head><body><h1>${t('clienti.entityLabel')}</h1><table><thead><tr><th>${t('clienti.field.ragioneSociale')}</th><th>${t('clienti.field.email')}</th><th>${t('clienti.field.telefono')}</th><th>${t('clienti.col.citta')}</th><th>${t('clienti.col.codiceFiscale')}</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
    const w = window.open('','_blank'); if(w){w.document.write(html);w.document.close();w.print();}
  }
  clienti: Cliente[] = [];
  loading = true;
  /** Ultima lettura fallita: distingue "non caricato" da "vuoto". */
  caricamentoKo = false;
  dataSource = new MatTableDataSource<Cliente>([]);
  displayedColumns: string[] = ['ragioneSociale', 'pIva', 'telefono', 'indirizzo', 'azioni'];

  readonly allCols: ColDef[] = [
    { key: 'ragioneSociale', label: this.i18n.t('clienti.col.ragioneSociale') },
    { key: 'pIva', label: this.i18n.t('clienti.col.piva') },
    { key: 'telefono', label: this.i18n.t('clienti.col.telefono') },
    { key: 'indirizzo', label: this.i18n.t('clienti.col.citta') },
    { key: 'fatturatoAnno', label: this.i18n.t('clienti.col.fatturatoAnno'), defaultVisible: false },
    { key: 'ultimoAcquisto', label: this.i18n.t('clienti.col.ultimoAcquisto'), defaultVisible: false },
    { key: 'fattureInsolute', label: this.i18n.t('clienti.col.insoluti'), defaultVisible: false },
    { key: 'email', label: this.i18n.t('clienti.col.email'), defaultVisible: false },
    { key: 'cellulare', label: this.i18n.t('clienti.col.cellulare'), defaultVisible: false },
    { key: 'codiceFiscale', label: this.i18n.t('clienti.col.codiceFiscale'), defaultVisible: false },
    { key: 'sdi', label: this.i18n.t('clienti.col.sdi'), defaultVisible: false },
    { key: 'pec', label: this.i18n.t('clienti.col.pec'), defaultVisible: false },
    { key: 'id', label: this.i18n.t('clienti.col.id'), defaultVisible: false },
  ];

  filtroDormienti = false;
  filtroInsoluti = false;
  /** Mostra anche le anagrafiche nascoste (di norma escluse dall'elenco). */
  mostraNascosti = false;
  nascostiCount = 0;
  giorniDormienza(c: any): number | null {
    if (!c?.ultimoAcquisto) return null;
    const d = new Date(c.ultimoAcquisto);
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private ds: DataService, private dialog: MatDialog, private snack: MatSnackBar, public excel: ExcelService, private router: Router) {}

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      if (this.dialog.openDialogs.length) return;
      e.preventDefault();
      this.open();
    }
  }

  /** Id elemento da aprire dopo il caricamento (apertura scheda da ricerca globale). */
  private pendingOpenId: number | null = null;

  /** Va alle fatture già filtrate su questo cliente. */
  apriFatture(c: Cliente) {
    if (!c.id) return;
    this.router.navigate(['/fatture'], { state: { filtroCliente: c.id } });
  }

  ngOnInit() {
    this.pendingOpenId = consumePrefill<number>('openId');
    this.load();
    const pf = consumePrefill('prefill');
    if (pf) setTimeout(() => this.open(pf as Cliente), 0);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sortingDataAccessor = (item, col) => {
      switch (col) {
        case 'id': return item.id ?? 0;
        case 'indirizzo': return this.indirizzo(item);
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) =>
      clienteMatch(item, this.indirizzo(item), filter) || (item.telefono ?? '').toLowerCase().includes(filter.toLowerCase());
  }

  load() {
    this.loading = true;
    this.caricamentoKo = false;
    this.ds.getClienti().subscribe({
      next: c => {
        this.clienti = c;
        this.nascostiCount = c.filter(x => x.nascosto).length;
        this.applyInsightFilter();
        this.openPending(c);
        this.loading = false;
      },
      // Una lettura fallita NON è un elenco vuoto (vedi app-empty-state error).
      error: () => { this.loading = false; this.caricamentoKo = true; },
    });
  }

  private openPending(list: Cliente[]) {
    if (this.pendingOpenId == null) return;
    const it = list.find(x => x.id === this.pendingOpenId);
    this.pendingOpenId = null;
    if (it) setTimeout(() => this.open(it), 0);
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim();
  }

  applyInsightFilter() {
    let data = this.mostraNascosti ? this.clienti : this.clienti.filter(c => !c.nascosto);
    if (this.filtroDormienti) {
      data = data.filter((c: any) => { const g = this.giorniDormienza(c); return g === null || g > 90; });
    }
    if (this.filtroInsoluti) {
      data = data.filter((c: any) => (c.fattureInsolute ?? 0) > 0);
    }
    this.dataSource.data = data;
    if (this.paginator) this.dataSource.paginator = this.paginator;
  }

  toggleDormienti() { this.filtroDormienti = !this.filtroDormienti; this.applyInsightFilter(); }
  toggleInsoluti() { this.filtroInsoluti = !this.filtroInsoluti; this.applyInsightFilter(); }
  toggleNascosti() { this.mostraNascosti = !this.mostraNascosti; this.applyInsightFilter(); }

  /**
   * Nasconde (o ripristina) il cliente. È l'alternativa all'eliminazione per chi
   * ha già documenti collegati: sparisce dalla scelta sui documenti nuovi, ma
   * resta nello storico e si ritrova qui col filtro "Nascosti".
   */
  setNascosto(c: Cliente, nascosto: boolean) {
    if (!c.id) return;
    this.ds.setClienteNascosto(c.id, nascosto).subscribe({
      next: () => {
        this.load();
        this.snack.open(this.i18n.t(nascosto ? 'clienti.msg.nascosto' : 'clienti.msg.ripristinato', { nome: c.ragioneSociale }), '', { duration: 3000 });
      },
      error: () => this.snack.open(this.i18n.t('clienti.msg.erroreNascondi'), '', { duration: 3000 }),
    });
  }

  indirizzo(c: Cliente): string {
    return [c.via, c.cap, c.citta, c.provincia, c.stato].filter(Boolean).join(', ');
  }

  onColsChange(cols: string[]) { this.displayedColumns = cols.includes('azioni') ? cols : [...cols, 'azioni']; }

  open(c?: Cliente) {
    const ref = this.dialog.open(ClienteDialogComponent, { data: c ?? null, width: '95vw', maxWidth: '860px' });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      // L'avviso fatture da saldare ha un endpoint suo (non passa dall'update
      // dell'anagrafica): lo si chiama solo se l'interruttore è cambiato.
      const primaAcceso = c?.avvisoInsoluti !== false;
      const oraAcceso = result.avvisoInsoluti !== false;
      const op = result.id ? this.ds.updateCliente(result) : this.ds.createCliente(result);
      op.subscribe({
        next: (res: any) => {
          const fine = () => { this.load(); this.snack.open(this.i18n.t('clienti.msg.salvato'), '', { duration: 2000 }); };
          const id = result.id ?? res?.id;
          if (id && primaAcceso !== oraAcceso) {
            this.ds.setAvvisoInsolutiCliente(id, oraAcceso).subscribe({ next: fine, error: fine });
          } else {
            fine();
          }
        },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }),
      });
    });
  }

  info(c: Cliente) {
    const fmtCurrency = (n: number) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
    const fmtDate = (s: string) => { const p = s.substring(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
    const t = (k: string, params?: Record<string, string | number>) => this.i18n.t(k, params);
    const baseData: InfoDialogData = {
      title: c.ragioneSociale,
      sections: [
        {
          title: t('clienti.info.attivitaCommerciale'),
          rows: [
            { label: t('clienti.info.ultimoAcquisto'), value: c.ultimoAcquisto ? fmtDate(c.ultimoAcquisto) : t('clienti.info.mai') },
            { label: t('clienti.info.fatturatoAnno'),  value: c.fatturatoAnno != null ? fmtCurrency(c.fatturatoAnno) : null },
            { label: t('clienti.info.insoluti'),        value: (c.fattureInsolute ?? 0) > 0 ? t('clienti.info.insolutiValue', { n: c.fattureInsolute! }) : null },
          ],
        },
        {
          title: t('clienti.info.contatti'),
          rows: [
            { label: t('clienti.info.email'),     value: c.email },
            { label: t('clienti.info.telefono'),  value: c.telefono },
            { label: t('clienti.info.cellulare'), value: c.cellulare },
            { label: t('clienti.info.pec'),       value: c.pec },
          ],
        },
        {
          title: t('clienti.info.sedeLegale'),
          rows: [
            { label: t('clienti.info.via'),      value: c.via },
            { label: t('clienti.info.cap'),      value: c.cap },
            { label: t('clienti.info.citta'),    value: c.citta },
            { label: t('clienti.info.provincia'),value: c.provincia },
            { label: t('clienti.info.stato'),    value: c.stato },
          ],
        },
        {
          title: t('clienti.info.datiFiscali'),
          rows: [
            { label: t('clienti.info.partitaIva'),    value: c.pIva, mono: true },
            { label: t('clienti.info.codiceFiscale'), value: c.codiceFiscale, mono: true },
            { label: t('clienti.info.codiceSdi'),     value: c.sdi, mono: true },
          ],
        },
      ],
    };
    if (c.id) {
      this.ds.getClienteIndirizzi(c.id).subscribe(addrs => {
        if (addrs.length) {
          baseData.sections.push({
            title: t('clienti.info.destinazioniSalvate'),
            rows: addrs.map(a => ({
              label: a.nome,
              value: [a.via, a.cap, a.citta, a.provincia].filter(v => !!v).join(', '),
            })),
          });
        }
        this.dialog.open(InfoDialogComponent, { data: baseData, width: '520px', maxWidth: '95vw', panelClass: 'dialog-compact' });
      });
    } else {
      this.dialog.open(InfoDialogComponent, { data: baseData, width: '520px', maxWidth: '95vw', panelClass: 'dialog-compact' });
    }
  }

  /** Apre la scheda riassuntiva del cliente (dati, fatturato, da incassare, top prodotti). */
  apriScheda(c: Cliente) {
    this.dialog.open(SchedaClienteDialogComponent, { data: c, width: '660px', maxWidth: '96vw', autoFocus: false });
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('clienti.field.ragioneSociale'), field: 'ragioneSociale', width: 30 },
    { header: this.i18n.t('clienti.field.email'),          field: 'email',          width: 28 },
    { header: this.i18n.t('clienti.field.telefono'),       field: 'telefono',       width: 16 },
    { header: this.i18n.t('clienti.field.cellulare'),      field: 'cellulare',      width: 16 },
    { header: this.i18n.t('clienti.field.via'),            field: 'via',            width: 28 },
    { header: this.i18n.t('clienti.field.cap'),            field: 'cap',            width: 8  },
    { header: this.i18n.t('clienti.field.citta'),          field: 'citta',          width: 18 },
    { header: this.i18n.t('clienti.field.provincia'),      field: 'provincia',      width: 10 },
    { header: this.i18n.t('clienti.field.stato'),          field: 'stato',          width: 12 },
    { header: this.i18n.t('clienti.field.codiceFiscale'),  field: 'codiceFiscale',  width: 18 },
    { header: this.i18n.t('clienti.field.pIva'),           field: 'pIva',           width: 14 },
    { header: this.i18n.t('clienti.field.sdi'),            field: 'sdi',            width: 10 },
    { header: this.i18n.t('clienti.field.pec'),            field: 'pec',            width: 28 },
  ];

  importExcel(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';
    this.excel.readFile(file).then(rows => {
      if (!rows.length) { this.snack.open(this.i18n.t('clienti.msg.fileVuoto'), '', { duration: 3000 }); return; }
      this.dialog.open(ImportMappingDialogComponent, {
        data: { rows, fields: buildClientiFields(this.i18n), entityType: 'clienti', entityLabel: this.i18n.t('clienti.entityLabel') },
        disableClose: true,
      }).afterClosed().subscribe((result: MappingResult | null) => {
        if (!result) return;
        const v = (key: string, row: Record<string, any>) => String(row[result.mapping[key]] ?? '').trim();
        const records = rows.map(r => ({
          ragioneSociale: v('ragioneSociale', r),
          email:          v('email', r),
          telefono:       v('telefono', r),
          cellulare:      v('cellulare', r),
          via:            v('via', r),
          cap:            v('cap', r),
          citta:          v('citta', r),
          provincia:      v('provincia', r),
          stato:          v('stato', r) || 'Italia',
          codiceFiscale:  v('codiceFiscale', r),
          pIva:           v('pIva', r),
          sdi:            v('sdi', r),
          pec:            v('pec', r),
        })).filter(c => c.ragioneSociale.length > 0);
        if (!records.length) { this.snack.open(this.i18n.t('clienti.msg.nessunClienteValido'), '', { duration: 5000 }); return; }
        this.ds.importClienti(records).subscribe({
          next: (res: any) => {
            this.load();
            this.snack.open(this.i18n.t('clienti.msg.importResult', { created: res.created, updated: res.updated, skipped: res.skipped }), '', { duration: 5000 });
          },
          error: (err: any) => {
            this.snack.open(this.i18n.t('clienti.msg.erroreImport', { msg: err?.error?.message || err?.message || this.i18n.t('clienti.msg.erroreSconosciuto') }), '', { duration: 6000 });
          }
        });
      });
    }).catch(() => {
      this.snack.open(this.i18n.t('clienti.msg.fileNonLeggibile'), '', { duration: 3000 });
    });
  }

  async delete(c: Cliente) {
    if (!await this.confirm.delete(this.i18n.t('clienti.msg.confirmDelete', { nome: c.ragioneSociale }))) return;
    this.ds.deleteCliente(c.id!).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('clienti.msg.eliminato'), '', { duration: 2000 }); },
      error: (err) => {
        if (err.status === 409 && err.error?.counts) {
          const { fatture, ddt, preventivi, ordini, noteCredito } = err.error.counts;
          const parts: string[] = [];
          if (fatture > 0)     parts.push(this.i18n.tn('clienti.msg.part.fatture', fatture));
          if (ddt > 0)         parts.push(this.i18n.tn('clienti.msg.part.ddt', ddt));
          if (preventivi > 0)  parts.push(this.i18n.tn('clienti.msg.part.preventivi', preventivi));
          if (ordini > 0)      parts.push(this.i18n.tn('clienti.msg.part.ordini', ordini));
          if (noteCredito > 0) parts.push(this.i18n.tn('clienti.msg.part.noteCredito', noteCredito));
          this.snack.open(
            this.i18n.t('clienti.msg.impossibileEliminare', { nome: c.ragioneSociale!, parts: parts.join(', ') }),
            this.i18n.t('clienti.menu.nascondi'), { duration: 10000 }
          ).onAction().subscribe(() => this.setNascosto(c, true));
        } else {
          this.snack.open(this.i18n.t('clienti.msg.erroreEliminazione'), '', { duration: 3000 });
        }
      }
    });
  }
}
