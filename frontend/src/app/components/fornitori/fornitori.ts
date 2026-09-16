import { inject, Component, OnInit, AfterViewInit, Inject, ViewChild, HostListener, ElementRef } from '@angular/core';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Observable, of, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, switchMap, map, catchError } from 'rxjs/operators';
import { DataService } from '../../services/data.service';
import { CityService, CityResult } from '../../services/city.service';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { ExportMenuComponent } from '../shared/export-menu';
import { Fornitore } from '../../models';
import { Router } from '@angular/router';
import { consumePrefill } from '../../utils/nav-prefill';
import { pIvaValidator, telefonoValidator, capValidator, normalizePiva } from '../../validators/italian-validators';
import { ImportMappingDialogComponent, FieldDef, MappingResult } from '../shared/import-mapping-dialog';
import { ColumnPickerComponent, ColDef } from '../shared/column-picker';
import { InfoDialogComponent, InfoDialogData } from '../shared/info-dialog';
import { TableKeyboardNavDirective } from '../shared/table-keyboard-nav.directive';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { focusPrimoInvalido } from '../../utils/focus-invalido';

function buildFornitoriFields(i18n: I18nService): FieldDef[] { return [
  { key: 'ragioneSociale', label: i18n.t('fornitori.field.ragioneSociale'), required: true, aliases: [
    'Ragione Sociale', 'ragioneSociale', 'Denominazione', 'Azienda', 'Nome Azienda',
    'Ragione sociale', 'Company', 'Company Name', 'Fornitore', 'Supplier', 'Nome',
    'Intestazione', 'Intestatario',
  ]},
  { key: 'email', label: i18n.t('fornitori.field.email'), aliases: [
    'Email', 'email', 'E-mail', 'E_mail', 'Email Address', 'Indirizzo Email',
    'Posta Elettronica', 'Mail',
  ]},
  { key: 'telefono', label: i18n.t('fornitori.field.telefono'), aliases: [
    'Telefono', 'telefono', 'Tel', 'Tel.', 'Telefono 1', 'Telefono fisso',
    'Cell', 'Cellulare', 'Phone', 'Mobile', 'Phone Number', 'Numero di telefono',
  ]},
  { key: 'cellulare', label: i18n.t('fornitori.field.cellulare'), aliases: [
    'Cellulare', 'cellulare', 'Cell', 'Mobile', 'Telefono Mobile', 'Cell.', 'Tel. Mobile',
  ]},
  { key: 'via', label: i18n.t('fornitori.field.via'), aliases: [
    'Via', 'via', 'Indirizzo', 'Indirizzo 1', 'Street', 'Address',
    'Indirizzo stradale', 'Sede', 'Via e numero',
  ]},
  { key: 'cap', label: i18n.t('fornitori.field.cap'), aliases: [
    'CAP', 'cap', 'Codice Postale', 'ZIP', 'Postal Code', 'ZIP Code', 'C.A.P.',
  ]},
  { key: 'citta', label: i18n.t('fornitori.field.citta'), aliases: [
    'Città', 'Citta', 'citta', 'Comune', 'City', 'Town', 'Localita', 'Località',
  ]},
  { key: 'provincia', label: i18n.t('fornitori.field.provincia'), aliases: [
    'Provincia', 'provincia', 'Prov', 'Prov.', 'Province', 'Sigla Provincia',
  ]},
  { key: 'stato', label: i18n.t('fornitori.field.stato'), aliases: [
    'Stato', 'stato', 'Country', 'Nazione', 'Paese', 'Naz.',
  ]},
  { key: 'pIva', label: i18n.t('fornitori.field.pIva'), aliases: [
    'P. IVA', 'pIva', 'P.IVA', 'Partita IVA', 'Partita_IVA', 'VAT',
    'VAT Number', 'P IVA', 'PIVA', 'CF/PIVA', 'Partita iva',
  ]},
  { key: 'sdi', label: i18n.t('fornitori.field.sdi'), aliases: [
    'SDI', 'sdi', 'Codice SDI', 'Codice Destinatario', 'Destinatario SDI',
    'Codice Univoco', 'Cod. Destinatario',
  ]},
  { key: 'pec', label: i18n.t('fornitori.field.pec'), aliases: [
    'PEC', 'pec', 'Posta Certificata', 'PEC Address', 'Indirizzo PEC',
  ]},
]; }

// ── Azienda Search Dialog ──────────────────────────────────────────────────────
@Component({
  selector: 'app-azienda-search-dialog-f',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
            MatButtonModule, MatIconModule, MatProgressSpinnerModule, TPipe],
  styles: [`
    .azienda-result {
      padding: 10px 12px; cursor: pointer; border-radius: 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
      transition: background 0.15s;
    }
    .azienda-result:hover { background: var(--mat-sys-secondary-container, #f0f4ff); }
    .azienda-nome { font-weight: 500; font-size: 14px; }
    .azienda-dettagli { font-size: 12px; color: var(--mat-sys-on-surface-variant, #666); margin-top: 2px; }
    .no-results { text-align: center; color: var(--mat-sys-on-surface-variant, #888);
                  padding: 24px 0; font-size: 14px; }
  `],
  template: `
    <h2 mat-dialog-title>{{ 'clienti.aziendaSearch.title' | t }}</h2>
    <mat-dialog-content style="width:520px;max-width:90vw;min-height:120px">
      <mat-form-field style="width:100%">
        <mat-label>{{ 'clienti.aziendaSearch.nomeAzienda' | t }}</mat-label>
        <input matInput [(ngModel)]="query" (ngModelChange)="onQueryChange($event)"
               [placeholder]="'clienti.aziendaSearch.placeholder' | t" autofocus>
        <span matSuffix style="margin-right:8px">
          @if (loading) { <mat-spinner diameter="18"></mat-spinner> }
          @else { <mat-icon>search</mat-icon> }
        </span>
      </mat-form-field>

      @if (results.length > 0) {
        <div style="max-height:320px;overflow-y:auto">
          @for (r of results; track r.pIva || r.ragioneSociale) {
            <div class="azienda-result" (click)="select(r)">
              <div class="azienda-nome">{{ r.ragioneSociale }}</div>
              <div class="azienda-dettagli">
                @if (r.pIva) { <span>P.IVA: {{ r.pIva }}</span> }
                @if (r.citta) { <span>{{ r.pIva ? ' · ' : '' }}{{ r.citta }}{{ r.provincia ? ' (' + r.provincia + ')' : '' }}</span> }
              </div>
            </div>
          }
        </div>
      } @else if (searched && !loading) {
        <div class="no-results">
          @if (serviceUnavailable) {
            <mat-icon style="vertical-align:middle;margin-right:6px;opacity:.5">cloud_off</mat-icon>
            {{ 'clienti.aziendaSearch.serviceUnavailable' | t }}<br>
            <small>{{ 'clienti.aziendaSearch.serviceUnavailableHint' | t }}</small>
          } @else {
            {{ 'clienti.aziendaSearch.noResults' | t:{ query } }}
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'clienti.aziendaSearch.chiudi' | t }}</button>
    </mat-dialog-actions>`
})
export class AziendaSearchDialogFComponent {
  query = '';
  results: any[] = [];
  loading = false;
  searched = false;
  serviceUnavailable = false;
  private searchTimer: any;

  constructor(private ds: DataService, public dialogRef: MatDialogRef<AziendaSearchDialogFComponent>) {}

  onQueryChange(q: string) {
    clearTimeout(this.searchTimer);
    if (q.length < 2) { this.results = []; this.searched = false; return; }
    this.loading = true;
    this.searchTimer = setTimeout(() => this.doSearch(q), 400);
  }

  private doSearch(q: string) {
    this.ds.searchAziendaByName(q).subscribe({
      next: results => {
        this.loading = false;
        this.searched = true;
        this.serviceUnavailable = false;
        this.results = results;
      },
      error: () => {
        this.loading = false;
        this.searched = true;
        this.serviceUnavailable = true;
        this.results = [];
      }
    });
  }

  select(r: any) { this.dialogRef.close(r); }
}

@Component({
  selector: 'app-fornitore-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatAutocompleteModule,
            MatSnackBarModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
            MatCheckboxModule, FieldHelpComponent, TPipe],
  template: `
    <mat-dialog-content>
      <div class="dialog-hero">
        <div class="dialog-hero-icon" style="background:linear-gradient(135deg,#0ea5e9 0%,#06b6d4 100%);box-shadow:0 4px 12px -2px rgba(14,165,233,0.35)">
          <mat-icon>local_shipping</mat-icon>
        </div>
        <div class="dialog-hero-text">
          <span class="dialog-hero-title">{{ data ? data.ragioneSociale : (('fornitori.dialog.new') | t) }}</span>
          <span class="dialog-hero-sub">{{ (data ? 'fornitori.dialog.editSub' : 'fornitori.dialog.newSub') | t }}</span>
        </div>
      </div>

      <form [formGroup]="form" class="dialog-form">

        <!-- ── Identità ─────────────────────────────────── -->
        <div class="form-section is-primary">
          <div class="form-section-header">
            <mat-icon>badge</mat-icon>
            <span>{{ 'fornitori.form.identita' | t }}</span>
            <span class="section-hint">{{ 'fornitori.form.identitaHint' | t }}</span>
          </div>
          <div class="input-with-action">
            <mat-form-field>
              <mat-label>{{ 'fornitori.form.ragioneSociale' | t }}</mat-label>
              <input matInput formControlName="ragioneSociale">
            </mat-form-field>
            <button mat-icon-button type="button"
                    [matTooltip]="'fornitori.form.cercaAzienda' | t" (click)="cercaAzienda()">
              <mat-icon>business_center</mat-icon>
            </button>
          </div>
          <div class="form-row">
            <div class="input-with-action" style="flex:1">
              <mat-form-field>
                <mat-label>{{ 'fornitori.form.piva' | t }}</mat-label>
                <input matInput formControlName="pIva" [placeholder]="'fornitori.form.pivaPlaceholder' | t">
                <app-field-help matSuffix term="piva" />
                @if (form.get('pIva')?.hasError('pIva')) {
                  <mat-error>{{ 'fornitori.form.pivaInvalid' | t }}</mat-error>
                }
                @if (form.get('pIva')?.hasError('pivaEsiste')) {
                  <mat-error>{{ 'fornitori.form.pivaEsiste' | t }}</mat-error>
                }
                @if (form.get('pIva')?.pending) {
                  <mat-hint>{{ 'fornitori.form.pivaVerifica' | t }}</mat-hint>
                }
              </mat-form-field>
              <button mat-icon-button type="button"
                      [matTooltip]="'fornitori.form.caricaDaPiva' | t"
                      [disabled]="lookupLoading || !canLookupPiva"
                      (click)="lookupPiva()">
                @if (lookupLoading) {
                  <mat-spinner diameter="20"></mat-spinner>
                } @else {
                  <mat-icon>cloud_download</mat-icon>
                }
              </button>
            </div>
          </div>
        </div>

        <!-- ── Fatturazione elettronica ─────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>receipt_long</mat-icon>
            <span>{{ 'fornitori.form.fatturazioneElettronica' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field><mat-label>{{ 'fornitori.form.sdi' | t }}</mat-label>
              <input matInput formControlName="sdi" style="text-transform:uppercase" maxlength="7" [placeholder]="'fornitori.form.sdiPlaceholder' | t">
              <app-field-help matSuffix term="sdi" />
            </mat-form-field>
            <mat-form-field style="flex:2"><mat-label>{{ 'fornitori.form.pec' | t }}</mat-label>
              <input matInput formControlName="pec" [placeholder]="'fornitori.form.pecPlaceholder' | t">
              <app-field-help matSuffix term="pec" />
            </mat-form-field>
          </div>
          <div class="form-row">
            <mat-checkbox formControlName="estero">
              {{ 'fornitori.form.estero' | t }}
            </mat-checkbox>
          </div>
          <div class="form-row" style="align-items:flex-start">
            <div>
              <mat-checkbox formControlName="ancheCliente">{{ 'fornitori.form.ancheCliente' | t }}</mat-checkbox>
              <div style="font-size:12px;color:var(--text-tertiary);margin-top:4px;max-width:520px">
                {{ 'fornitori.form.ancheClienteHint' | t }}
              </div>
            </div>
          </div>
        </div>

        <!-- ── Sede ─────────────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>location_on</mat-icon>
            <span>{{ 'fornitori.form.sedeLegale' | t }}</span>
          </div>
          <mat-form-field style="width:100%"><mat-label>{{ 'fornitori.form.via' | t }}</mat-label><input matInput formControlName="via"></mat-form-field>
          <div class="form-row">
            <mat-form-field style="max-width:120px"><mat-label>{{ 'fornitori.form.cap' | t }}</mat-label>
              <input matInput formControlName="cap" maxlength="5">
              @if (form.get('cap')?.hasError('cap') && form.get('cap')?.dirty) {
                <mat-error>{{ 'fornitori.form.capInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fornitori.form.citta' | t }}</mat-label>
              <input matInput formControlName="citta" [matAutocomplete]="auto">
              <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onCitySelected($event.option.value)">
                @for (c of filteredCities; track c.name) { <mat-option [value]="c.name">{{ c.name }}</mat-option> }
              </mat-autocomplete>
            </mat-form-field>
            <mat-form-field style="max-width:80px"><mat-label>{{ 'fornitori.form.provincia' | t }}</mat-label>
              <input matInput formControlName="provincia" maxlength="2" style="text-transform:uppercase">
              <mat-hint>{{ 'fornitori.form.provinciaHint' | t }}</mat-hint></mat-form-field>
            <mat-form-field style="max-width:120px"><mat-label>{{ 'fornitori.form.stato' | t }}</mat-label>
              <input matInput formControlName="stato"></mat-form-field>
          </div>
        </div>

        <!-- ── Contatti ─────────────────────────────────── -->
        <div class="form-section">
          <div class="form-section-header">
            <mat-icon>contact_phone</mat-icon>
            <span>{{ 'fornitori.form.contatti' | t }}</span>
          </div>
          <div class="form-row">
            <mat-form-field>
              <mat-label>{{ 'fornitori.form.email' | t }}</mat-label>
              <input matInput formControlName="email" type="email">
              <mat-icon matSuffix>alternate_email</mat-icon>
              @if (form.get('email')?.hasError('email') && form.get('email')?.dirty) {
                <mat-error>{{ 'fornitori.form.emailInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fornitori.form.telefono' | t }}</mat-label>
              <input matInput formControlName="telefono">
              <mat-icon matSuffix>call</mat-icon>
              @if (form.get('telefono')?.hasError('telefono') && form.get('telefono')?.dirty) {
                <mat-error>{{ 'fornitori.form.telefonoInvalid' | t }}</mat-error>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>{{ 'fornitori.form.cellulare' | t }}</mat-label>
              <input matInput formControlName="cellulare">
              <mat-icon matSuffix>smartphone</mat-icon>
            </mat-form-field>
          </div>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fornitori.form.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="!form.get('ragioneSociale')?.valid || form.pending">{{ 'fornitori.form.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class FornitoreDialogComponent implements OnInit {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  i18n = inject(I18nService);
  form: FormGroup;
  filteredCities: CityResult[] = [];
  lookupLoading = false;
  private cityMap = new Map<string, CityResult>();

  constructor(private fb: FormBuilder,
              private ds: DataService,
              private dialog: MatDialog,
              private cityService: CityService,
              private snack: MatSnackBar,
              public dialogRef: MatDialogRef<FornitoreDialogComponent>,
              @Inject(MAT_DIALOG_DATA) public data: Fornitore | null) {
    this.form = this.fb.group({
      ragioneSociale: [data?.ragioneSociale ?? '', Validators.required],
      email: [data?.email ?? '', Validators.email],
      telefono: [data?.telefono ?? '', telefonoValidator],
      cellulare: [data?.cellulare ?? ''],
      via: [data?.via ?? ''], cap: [data?.cap ?? '', capValidator],
      citta: [data?.citta ?? ''], provincia: [data?.provincia ?? ''],
      stato: [data?.stato ?? 'Italia'], pIva: [data?.pIva ?? '', pIvaValidator, this.pivaAsyncValidator('fornitori', data?.id)],
      sdi: [data?.sdi ?? ''], pec: [data?.pec ?? ''],
      estero: [data?.estero ?? false],
      ancheCliente: [data?.ancheCliente ?? false],
    });
  }

  get canLookupPiva(): boolean { return normalizePiva(this.form.get('pIva')?.value ?? '').length === 11; }

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

  cercaAzienda() {
    const ref = this.dialog.open(AziendaSearchDialogFComponent, { width: '580px', maxWidth: '95vw' });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const patch: any = {};
      if (result.ragioneSociale) patch.ragioneSociale = result.ragioneSociale;
      if (result.pIva)           patch.pIva = result.pIva;
      if (result.via)            patch.via = result.via;
      if (result.cap)            patch.cap = result.cap;
      if (result.citta)          patch.citta = result.citta;
      if (result.provincia)      patch.provincia = result.provincia;
      if (result.stato)          patch.stato = result.stato;
      this.form.patchValue(patch);
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
        this.snack.open(this.i18n.t('fornitori.msg.datiCaricati'), '', { duration: 2500 });
      },
      error: () => {
        this.lookupLoading = false;
        this.snack.open(this.i18n.t('fornitori.msg.pivaNonTrovata'), '', { duration: 3000 });
      }
    });
  }

  save() {
    this.form.markAllAsTouched();
    if (this.form.pending) return;
    if (!this.form.valid) {
      // Prima il clic su Salva non produceva NULLA: niente errori, niente
      // messaggio, il dialog restava aperto senza spiegare il perché.
      this.snack.open(this.i18n.t('fornitori.msg.correggiCampi'), '', { duration: 3000 });
      focusPrimoInvalido(this.host.nativeElement);
      return;
    }
    this.dialogRef.close({ ...this.data, ...this.form.value });
  }
}

@Component({
  selector: 'app-fornitori',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule,
            MatDialogModule, MatSnackBarModule, MatFormFieldModule, MatInputModule, MatSortModule, MatPaginatorModule,
            MatTooltipModule, MatMenuModule, ColumnPickerComponent, EmptyStateComponent,
            TableKeyboardNavDirective, ExportMenuComponent, TPipe],
  templateUrl: './fornitori.html',
  styleUrl: './fornitori.scss'
})
export class FornitoriComponent implements OnInit, AfterViewInit {
  private confirm = inject(ConfirmService);
  i18n = inject(I18nService);
  fornitori: Fornitore[] = [];
  /** Ultima lettura fallita: distingue "non caricato" da "vuoto". */
  caricamentoKo = false;
  /** Mostra anche le anagrafiche nascoste (di norma escluse dall'elenco). */
  mostraNascosti = false;
  nascostiCount = 0;
  dataSource = new MatTableDataSource<Fornitore>([]);
  displayedColumns: string[] = ['ragioneSociale', 'pIva', 'telefono', 'indirizzo', 'azioni'];

  readonly allCols: ColDef[] = [
    { key: 'ragioneSociale', label: this.i18n.t('fornitori.col.ragioneSociale') },
    { key: 'pIva', label: this.i18n.t('fornitori.col.piva') },
    { key: 'telefono', label: this.i18n.t('fornitori.col.telefono') },
    { key: 'indirizzo', label: this.i18n.t('fornitori.col.citta') },
    { key: 'email', label: this.i18n.t('fornitori.col.email'), defaultVisible: false },
    { key: 'cellulare', label: this.i18n.t('fornitori.col.cellulare'), defaultVisible: false },
    { key: 'sdi', label: this.i18n.t('fornitori.col.sdi'), defaultVisible: false },
    { key: 'pec', label: this.i18n.t('fornitori.col.pec'), defaultVisible: false },
    { key: 'id', label: this.i18n.t('fornitori.col.id'), defaultVisible: false },
  ];

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

  /** Va agli acquisti già filtrati su questo fornitore. */
  apriAcquisti(f: Fornitore) {
    if (!f.id) return;
    this.router.navigate(['/acquisti'], { state: { filtroFornitore: f.id } });
  }

  private pendingOpenId: number | null = null;

  ngOnInit() {
    this.pendingOpenId = consumePrefill<number>('openId');
    this.load();
  }

  private openPending(list: Fornitore[]) {
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
        case 'indirizzo': return this.indirizzo(item);
        default: return (item as any)[col] ?? '';
      }
    };
    this.dataSource.filterPredicate = (item, filter) => {
      const s = filter.toLowerCase();
      return (item.ragioneSociale ?? '').toLowerCase().includes(s)
          || (item.email ?? '').toLowerCase().includes(s)
          || (item.telefono ?? '').toLowerCase().includes(s)
          || (item.pIva ?? '').toLowerCase().includes(s)
          || this.indirizzo(item).toLowerCase().includes(s);
    };
  }

  load() {
    this.caricamentoKo = false;
    this.ds.getFornitori().subscribe({
      next: f => {
        this.fornitori = f;
        this.nascostiCount = f.filter(x => x.nascosto).length;
        this.applyNascostiFilter();
        this.openPending(f);
      },
      // Mancava del tutto il ramo d'errore: la lettura fallita finiva nel nulla
      // e l'elenco appariva semplicemente vuoto.
      error: () => { this.caricamentoKo = true; },
    });
  }

  private applyNascostiFilter() {
    this.dataSource.data = this.mostraNascosti ? this.fornitori : this.fornitori.filter(f => !f.nascosto);
    if (this.paginator) this.dataSource.paginator = this.paginator;
  }

  toggleNascosti() { this.mostraNascosti = !this.mostraNascosti; this.applyNascostiFilter(); }

  /**
   * Nasconde (o ripristina) il fornitore: sparisce dalla scelta sui documenti
   * nuovi ma resta nello storico, e si ritrova qui col filtro "Nascosti".
   */
  setNascosto(f: Fornitore, nascosto: boolean) {
    if (!f.id) return;
    this.ds.setFornitoreNascosto(f.id, nascosto).subscribe({
      next: () => {
        this.load();
        this.snack.open(this.i18n.t(nascosto ? 'fornitori.msg.nascosto' : 'fornitori.msg.ripristinato', { nome: f.ragioneSociale }), '', { duration: 3000 });
      },
      error: () => this.snack.open(this.i18n.t('fornitori.msg.erroreNascondi'), '', { duration: 3000 }),
    });
  }

  applyFilter(event: Event) {
    this.dataSource.filter = (event.target as HTMLInputElement).value.trim();
  }

  indirizzo(f: Fornitore) {
    return [f.via, f.cap, f.citta, f.provincia, f.stato].filter(Boolean).join(', ');
  }

  onColsChange(cols: string[]) { this.displayedColumns = cols.includes('azioni') ? cols : [...cols, 'azioni']; }

  open(f?: Fornitore) {
    const ref = this.dialog.open(FornitoreDialogComponent, { data: f ?? null, width: '95vw', maxWidth: '860px' });
    ref.afterClosed().subscribe(result => {
      if (!result) return;
      const op = result.id ? this.ds.updateFornitore(result) : this.ds.createFornitore(result);
      op.subscribe({ next: () => { this.load(); this.snack.open(this.i18n.t('fornitori.msg.salvato'), '', { duration: 2000 }); },
                     error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }) });
    });
  }

  info(f: Fornitore) {
    const t = (k: string) => this.i18n.t(k);
    const data: InfoDialogData = {
      title: f.ragioneSociale,
      sections: [
        {
          title: t('fornitori.info.contatti'),
          rows: [
            { label: t('fornitori.info.email'),     value: f.email },
            { label: t('fornitori.info.telefono'),  value: f.telefono },
            { label: t('fornitori.info.cellulare'), value: f.cellulare },
            { label: t('fornitori.info.pec'),       value: f.pec },
          ],
        },
        {
          title: t('fornitori.info.sede'),
          rows: [
            { label: t('fornitori.info.via'),       value: f.via },
            { label: t('fornitori.info.cap'),       value: f.cap },
            { label: t('fornitori.info.citta'),     value: f.citta },
            { label: t('fornitori.info.provincia'), value: f.provincia },
            { label: t('fornitori.info.stato'),     value: f.stato },
          ],
        },
        {
          title: t('fornitori.info.datiFiscali'),
          rows: [
            { label: t('fornitori.info.partitaIva'),  value: f.pIva, mono: true },
            { label: t('fornitori.info.codiceSdi'),   value: f.sdi, mono: true },
          ],
        },
      ],
    };
    this.dialog.open(InfoDialogComponent, { data, width: '520px', maxWidth: '95vw', panelClass: 'dialog-compact' });
  }

  readonly exportCols: ExcelColumn<any>[] = [
    { header: this.i18n.t('fornitori.field.ragioneSociale'), field: 'ragioneSociale', width: 30 },
    { header: this.i18n.t('fornitori.field.email'),          field: 'email',          width: 28 },
    { header: this.i18n.t('fornitori.field.telefono'),       field: 'telefono',       width: 16 },
    { header: this.i18n.t('fornitori.field.cellulare'),      field: 'cellulare',      width: 16 },
    { header: this.i18n.t('fornitori.field.via'),            field: 'via',            width: 28 },
    { header: this.i18n.t('fornitori.field.cap'),            field: 'cap',            width: 8  },
    { header: this.i18n.t('fornitori.field.citta'),          field: 'citta',          width: 18 },
    { header: this.i18n.t('fornitori.field.provincia'),      field: 'provincia',      width: 10 },
    { header: this.i18n.t('fornitori.field.stato'),          field: 'stato',          width: 12 },
    { header: this.i18n.t('fornitori.field.pIva'),           field: 'pIva',           width: 14 },
    { header: this.i18n.t('fornitori.field.sdi'),            field: 'sdi',            width: 10 },
    { header: this.i18n.t('fornitori.field.pec'),            field: 'pec',            width: 28 },
  ];

  importExcel(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    (event.target as HTMLInputElement).value = '';
    this.excel.readFile(file).then(rows => {
      if (!rows.length) { this.snack.open(this.i18n.t('fornitori.msg.fileVuoto'), '', { duration: 3000 }); return; }
      this.dialog.open(ImportMappingDialogComponent, {
        data: { rows, fields: buildFornitoriFields(this.i18n), entityType: 'fornitori', entityLabel: this.i18n.t('fornitori.entityLabel') },
        disableClose: true,
      }).afterClosed().subscribe((result: MappingResult | null) => {
        if (!result) return;
        const v = (key: string, row: Record<string, any>) => String(row[result.mapping[key]] ?? '').trim();
        const records = rows.map(r => ({
          ragioneSociale: v('ragioneSociale', r),
          email:     v('email', r),
          telefono:  v('telefono', r),
          cellulare: v('cellulare', r),
          via:       v('via', r),
          cap:       v('cap', r),
          citta:     v('citta', r),
          provincia: v('provincia', r),
          stato:     v('stato', r) || 'Italia',
          pIva:      v('pIva', r),
          sdi:       v('sdi', r),
          pec:       v('pec', r),
        })).filter(f => f.ragioneSociale.length > 0);
        if (!records.length) { this.snack.open(this.i18n.t('fornitori.msg.nessunFornitoreValido'), '', { duration: 5000 }); return; }
        this.ds.importFornitori(records).subscribe({
          next: (res: any) => {
            this.load();
            this.snack.open(this.i18n.t('fornitori.msg.importResult', { created: res.created, updated: res.updated, skipped: res.skipped }), '', { duration: 5000 });
          },
          error: (err: any) => {
            this.snack.open(this.i18n.t('fornitori.msg.erroreImport', { msg: err?.error?.message || err?.message || this.i18n.t('fornitori.msg.erroreSconosciuto') }), '', { duration: 6000 });
          }
        });
      });
    }).catch(() => {
      this.snack.open(this.i18n.t('fornitori.msg.fileNonLeggibile'), '', { duration: 3000 });
    });
  }

  async delete(f: Fornitore) {
    if (!await this.confirm.delete(this.i18n.t('fornitori.msg.confirmDelete', { nome: f.ragioneSociale }))) return;
    this.ds.deleteFornitore(f.id!).subscribe({
      next: () => { this.load(); this.snack.open(this.i18n.t('fornitori.msg.eliminato'), '', { duration: 2000 }); },
      error: err => {
        // Con documenti collegati il backend rifiuta: l'alternativa è nasconderlo.
        if (err.status === 409 && err.error?.counts) {
          const { acquisti, ordini, ddt, arrivi, autofatture } = err.error.counts;
          const parts: string[] = [];
          if (acquisti > 0)    parts.push(this.i18n.tn('fornitori.msg.part.acquisti', acquisti));
          if (ordini > 0)      parts.push(this.i18n.tn('fornitori.msg.part.ordini', ordini));
          if (ddt > 0)         parts.push(this.i18n.tn('fornitori.msg.part.ddt', ddt));
          if (arrivi > 0)      parts.push(this.i18n.tn('fornitori.msg.part.arrivi', arrivi));
          if (autofatture > 0) parts.push(this.i18n.tn('fornitori.msg.part.autofatture', autofatture));
          this.snack.open(
            this.i18n.t('fornitori.msg.impossibileEliminare', { nome: f.ragioneSociale!, parts: parts.join(', ') }),
            this.i18n.t('fornitori.menu.nascondi'), { duration: 10000 }
          ).onAction().subscribe(() => this.setNascosto(f, true));
        } else {
          this.snack.open(this.i18n.t('fornitori.msg.erroreEliminazione'), '', { duration: 3000 });
        }
      },
    });
  }
}
