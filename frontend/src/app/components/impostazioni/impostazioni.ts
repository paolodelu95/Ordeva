import { inject, Component, OnInit, OnDestroy, Inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { EmptyStateComponent } from '../shared/empty-state';
import { ConfirmService } from '../shared/confirm-dialog';
import { LayoutService, NavLayout, Density } from '../../services/layout.service';
import { I18nService, Lang, LANGS } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatRadioModule } from '@angular/material/radio';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDialogModule, MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PrintService } from '../../services/print.service';
import { TEMPLATE_PRESETS, TemplatePreset } from '../../services/template-presets';
import { SectionKey, ColumnKey } from '../../models';
import { debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs/operators';
import { Observable, forkJoin } from 'rxjs';
import { DataService } from '../../services/data.service';
import { UpdateService } from '../../services/update.service';
import { CityService, CityResult } from '../../services/city.service';
import { Azienda, TipoPagamento, CategoriaProdotto, CausalePagamento, UnitaMisura, AliquotaIva, Utente, NotaRapida, TemplateConfig, NotificheConfig, ModuloDto, BackupConfig, GoogleSyncConfig, GoogleSyncResult } from '../../models';
import { DesktopService } from '../../services/desktop.service';
import { ModuliService } from '../../services/moduli.service';
import { DocLockService } from '../../services/doc-lock.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { pIvaValidator, codiceFiscaleValidator, ibanValidator } from '../../validators/italian-validators';

// ── Tipo Pagamento Dialog ────────────────────────────────────────────────────
@Component({
  selector: 'app-tipo-pagamento-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatDialogModule,
            MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, MatCheckboxModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.tipoPagamento.modifica' : 'impostazioni.dialog.tipoPagamento.nuovo') | t }}</h2>
    <mat-dialog-content style="min-width:480px">
      <div class="dialog-form">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'impostazioni.dialog.tipoPagamento.nomeLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="tp.nome">
        </mat-form-field>
        <div class="form-row">
          <mat-form-field>
            <mat-label>{{ 'impostazioni.dialog.tipoPagamento.contoLabel' | t }}</mat-label>
            <mat-select [(ngModel)]="tp.conto">
              <mat-option value="BANCA">{{ 'impostazioni.dialog.tipoPagamento.banca' | t }}</mat-option>
              <mat-option value="CASSA">{{ 'impostazioni.dialog.tipoPagamento.cassa' | t }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>{{ 'impostazioni.dialog.tipoPagamento.giorniScadenza' | t }}</mat-label>
            <input matInput type="number" min="0" [(ngModel)]="tp.giorniScadenza" [disabled]="tp.immediato">
          </mat-form-field>
        </div>
        <div style="display:flex; gap:24px; padding:8px 0">
          <mat-checkbox [(ngModel)]="tp.immediato" (change)="onImmediatoChange()">{{ 'impostazioni.dialog.tipoPagamento.pagamentoImmediato' | t }}</mat-checkbox>
          <mat-checkbox [(ngModel)]="tp.fineMese" [disabled]="tp.immediato || tp.giorniScadenza === 0">{{ 'impostazioni.dialog.tipoPagamento.fineMese' | t }}</mat-checkbox>
          <mat-checkbox [(ngModel)]="tp.attivo">{{ 'impostazioni.dialog.tipoPagamento.attivo' | t }}</mat-checkbox>
        </div>
        @if (tp.immediato) {
          <p style="color:#11769b;font-size:13px;margin:0">
            {{ 'impostazioni.dialog.tipoPagamento.immediatoHint' | t }}
          </p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="!tp.nome">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`,
})
export class TipoPagamentoDialogComponent {
  tp: TipoPagamento;
  constructor(
    public dialogRef: MatDialogRef<TipoPagamentoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TipoPagamento | null
  ) {
    this.tp = data ? { ...data } : {
      nome: '', conto: 'BANCA', giorniScadenza: 0, fineMese: false, immediato: false, attivo: true
    };
  }
  onImmediatoChange() { if (this.tp.immediato) { this.tp.giorniScadenza = 0; this.tp.fineMese = false; } }
  save() { if (this.tp.nome) this.dialogRef.close(this.tp); }
}

// ── Categoria Prodotto Dialog ────────────────────────────────────────────────
@Component({
  selector: 'app-categoria-prodotto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatSelectModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.categoria.modifica' : 'impostazioni.dialog.categoria.nuova') | t }}</h2>
    <mat-dialog-content style="min-width:340px">
      <mat-form-field style="width:100%; margin-top:8px">
        <mat-label>{{ 'impostazioni.dialog.categoria.nomeLabel' | t }}</mat-label>
        <input matInput [(ngModel)]="nome" autofocus [placeholder]="'impostazioni.dialog.categoria.nomePlaceholder' | t">
      </mat-form-field>
      <mat-form-field style="width:100%; margin-top:4px">
        <mat-label>{{ 'impostazioni.dialog.categoria.ivaLabel' | t }}</mat-label>
        <mat-select [(ngModel)]="aliquotaIvaId">
          <mat-option [value]="null">{{ 'impostazioni.dialog.categoria.ivaNessuna' | t }}</mat-option>
          @for (a of aliquoteIva; track a.id) {
            @if (a.categoria === 'Imponibile') {
              <mat-option [value]="a.id">{{ a.valore }}% — {{ a.nome }}</mat-option>
            }
          }
        </mat-select>
        <mat-hint>{{ 'impostazioni.dialog.categoria.ivaHint' | t }}</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="!nome.trim()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class CategoriaProdottoDialogComponent implements OnInit {
  nome = '';
  aliquotaIvaId: number | null = null;
  aliquoteIva: AliquotaIva[] = [];
  constructor(
    private ds: DataService,
    public dialogRef: MatDialogRef<CategoriaProdottoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CategoriaProdotto | null
  ) {
    this.nome = data?.nome ?? '';
    this.aliquotaIvaId = data?.aliquotaIvaId ?? null;
  }
  ngOnInit() { this.ds.getAliquoteIva().subscribe(a => this.aliquoteIva = a.filter(x => x.attiva)); }
  save() { if (this.nome.trim()) this.dialogRef.close({ ...this.data, nome: this.nome.trim(), aliquotaIvaId: this.aliquotaIvaId }); }
}

// ── Unità di Misura Dialog ───────────────────────────────────────────────────
@Component({
  selector: 'app-unita-misura-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.unita.modifica' : 'impostazioni.dialog.unita.nuova') | t }}</h2>
    <mat-dialog-content style="min-width:360px">
      <div class="dialog-form" style="padding-top:8px">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'impostazioni.dialog.unita.nomeLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="nome" autofocus [placeholder]="'impostazioni.dialog.unita.nomePlaceholder' | t">
        </mat-form-field>
        <mat-form-field style="width:100%">
          <mat-label>{{ 'impostazioni.dialog.unita.simboloLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="simbolo" [placeholder]="'impostazioni.dialog.unita.simboloPlaceholder' | t">
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="!nome.trim()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class UnitaMisuraDialogComponent {
  nome = '';
  simbolo = '';
  constructor(
    public dialogRef: MatDialogRef<UnitaMisuraDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: UnitaMisura | null
  ) { this.nome = data?.nome ?? ''; this.simbolo = data?.simbolo ?? ''; }
  save() {
    if (this.nome.trim()) {
      this.dialogRef.close({ ...this.data, nome: this.nome.trim(), simbolo: this.simbolo.trim() || this.nome.trim() });
    }
  }
}

// ── Aliquota IVA Dialog ──────────────────────────────────────────────────────
@Component({
  selector: 'app-aliquota-iva-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatCheckboxModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.aliquota.modifica' : 'impostazioni.dialog.aliquota.nuova') | t }}</h2>
    <mat-dialog-content style="min-width:340px">
      <div class="dialog-form" style="padding-top:8px">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'impostazioni.dialog.aliquota.nomeLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="nome" autofocus [placeholder]="'impostazioni.dialog.aliquota.nomePlaceholder' | t">
        </mat-form-field>
        <mat-form-field style="width:100%">
          <mat-label>{{ 'impostazioni.dialog.aliquota.valoreLabel' | t }}</mat-label>
          <input matInput type="number" min="0" max="100" step="0.01" [(ngModel)]="valore">
        </mat-form-field>
        <mat-checkbox [(ngModel)]="attiva" style="margin-top:4px">{{ 'impostazioni.dialog.aliquota.attiva' | t }}</mat-checkbox>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="!nome.trim() || valore == null">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class AliquotaIvaDialogComponent {
  nome = '';
  valore: number = 22;
  attiva = true;
  constructor(
    public dialogRef: MatDialogRef<AliquotaIvaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: AliquotaIva | null
  ) {
    this.nome = data?.nome ?? '';
    this.valore = data?.valore ?? 22;
    this.attiva = data?.attiva ?? true;
  }
  save() {
    if (this.nome.trim() && this.valore != null) {
      this.dialogRef.close({ ...this.data, nome: this.nome.trim(), valore: this.valore, attiva: this.attiva });
    }
  }
}

// ── Utente Dialog ────────────────────────────────────────────────────────────
@Component({
  selector: 'app-utente-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
            MatButtonModule, MatSelectModule, MatCheckboxModule],
  template: `
    <h2 mat-dialog-title>{{ data?.id ? 'Modifica utente' : 'Nuovo utente' }}</h2>
    <mat-dialog-content style="min-width:440px">
      <div class="dialog-form" style="padding-top:8px">
        <mat-form-field style="width:100%">
          <mat-label>Username *</mat-label>
          <input matInput [(ngModel)]="u.username" autocomplete="off">
        </mat-form-field>
        <mat-form-field style="width:100%">
          <mat-label>{{ data?.id ? 'Nuova password (lascia vuoto per non cambiare)' : 'Password *' }}</mat-label>
          <input matInput type="password" [(ngModel)]="u.password" autocomplete="new-password">
        </mat-form-field>
        <div class="form-row">
          <mat-form-field style="flex:2">
            <mat-label>Nome</mat-label>
            <input matInput [(ngModel)]="u.nome">
          </mat-form-field>
          <mat-form-field style="flex:1">
            <mat-label>Ruolo</mat-label>
            <mat-select [(ngModel)]="u.ruolo">
              <mat-option value="ADMIN">Admin</mat-option>
              <mat-option value="COMMERCIALE">Commerciale</mat-option>
              <mat-option value="MAGAZZINIERE">Magazziniere</mat-option>
              <mat-option value="CONTABILE">Contabile</mat-option>
              <mat-option value="OPERATORE">Operatore</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
        <mat-form-field style="width:100%">
          <mat-label>Email</mat-label>
          <input matInput type="email" [(ngModel)]="u.email">
        </mat-form-field>
        @if (data?.id) {
          <mat-checkbox [(ngModel)]="u.attivo">Utente attivo</mat-checkbox>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Annulla</button>
      <button mat-flat-button (click)="save()" [disabled]="!u.username || (!data?.id && !u.password)">Salva</button>
    </mat-dialog-actions>`
})
export class UtenteDialogComponent {
  u: Utente & { password?: string };
  constructor(
    public dialogRef: MatDialogRef<UtenteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Utente | null
  ) {
    this.u = data ? { ...data, password: '' } : { username: '', password: '', nome: '', email: '', ruolo: 'OPERATORE', attivo: true };
  }
  save() {
    if (this.u.username && (this.data?.id || this.u.password))
      this.dialogRef.close(this.u);
  }
}

// ── Nota Rapida Dialog ───────────────────────────────────────────────────────
@Component({
  selector: 'app-nota-rapida-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.notaRapida.modifica' : 'impostazioni.dialog.notaRapida.nuova') | t }}</h2>
    <mat-dialog-content style="min-width:400px">
      <mat-form-field style="width:100%; margin-top:8px">
        <mat-label>{{ 'impostazioni.dialog.notaRapida.testoLabel' | t }}</mat-label>
        <input matInput [(ngModel)]="testo" autofocus [placeholder]="'impostazioni.dialog.notaRapida.testoPlaceholder' | t">
      </mat-form-field>
      <mat-form-field style="width:120px; margin-top:4px">
        <mat-label>{{ 'impostazioni.dialog.notaRapida.ordineLabel' | t }}</mat-label>
        <input matInput type="number" [(ngModel)]="ordine" min="0">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="!testo.trim()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class NotaRapidaDialogComponent {
  testo = '';
  ordine = 0;
  constructor(
    public dialogRef: MatDialogRef<NotaRapidaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: NotaRapida | null
  ) { this.testo = data?.testo ?? ''; this.ordine = data?.ordine ?? 0; }
  save() { if (this.testo.trim()) this.dialogRef.close({ ...this.data, testo: this.testo.trim(), ordine: this.ordine }); }
}

// ── Causale Pagamento Dialog ─────────────────────────────────────────────────
@Component({
  selector: 'app-causale-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (data?.id ? 'impostazioni.dialog.causale.modifica' : 'impostazioni.dialog.causale.nuova') | t }}</h2>
    <mat-dialog-content style="min-width:400px">
      <mat-form-field style="width:100%; margin-top:8px">
        <mat-label>{{ 'impostazioni.dialog.causale.label' | t }}</mat-label>
        <input matInput [(ngModel)]="nome" autofocus [placeholder]="'impostazioni.dialog.causale.placeholder' | t"
               (keyup.enter)="save()">
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="save()" [disabled]="!nome.trim()">{{ 'fatture.dialog.salva' | t }}</button>
    </mat-dialog-actions>`
})
export class CausaleDialogComponent {
  nome = '';
  constructor(
    public dialogRef: MatDialogRef<CausaleDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CausalePagamento | null
  ) { this.nome = data?.nome ?? ''; }
  save() { if (this.nome.trim()) this.dialogRef.close({ ...this.data, nome: this.nome.trim() }); }
}

// ── Prefisso Conferma Dialog ─────────────────────────────────────────────────
interface PrefissoCambiato { documento: string; da: string; a: string; }

@Component({
  selector: 'app-prefisso-conferma-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title style="display:flex;align-items:center;gap:8px">
      <mat-icon style="color:#f59e0b">warning</mat-icon> {{ 'impostazioni.dialog.prefisso.title' | t }}
    </h2>
    <mat-dialog-content style="min-width:420px;max-width:560px">
      <p style="margin:0 0 12px">
        {{ 'impostazioni.dialog.prefisso.intro' | t }}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:6px 10px;text-align:left;font-weight:600">{{ 'impostazioni.dialog.prefisso.colDocumento' | t }}</th>
            <th style="padding:6px 10px;text-align:left;font-weight:600">{{ 'impostazioni.dialog.prefisso.colPrefissoAttuale' | t }}</th>
            <th style="padding:6px 10px;text-align:left;font-weight:600">{{ 'impostazioni.dialog.prefisso.colNuovoPrefisso' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (c of data; track c.documento) {
            <tr style="border-top:1px solid #e2e8f0">
              <td style="padding:6px 10px">{{ documentoLabel(c.documento) }}</td>
              <td style="padding:6px 10px;color:#64748b;font-family:monospace">{{ c.da || ('impostazioni.dialog.prefisso.nessuno' | t) }}</td>
              <td style="padding:6px 10px;color:#0f172a;font-family:monospace;font-weight:600">{{ c.a || ('impostazioni.dialog.prefisso.nessuno' | t) }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p style="margin:0;font-size:13px;color:#64748b">
        {{ 'impostazioni.dialog.prefisso.footer' | t }}
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="true">{{ 'shared.confirmDialog.conferma' | t }}</button>
    </mat-dialog-actions>`
})
export class PrefissoConfermaDialogComponent {
  private i18n = inject(I18nService);
  private readonly DOC_KEYS: Record<string, string> = {
    'Documenti di trasporto': 'impostazioni.dialog.prefisso.docTrasporto',
    'Fatture': 'impostazioni.dialog.prefisso.docFatture',
    'Ordini': 'impostazioni.dialog.prefisso.docOrdini',
    'Preventivi': 'impostazioni.dialog.prefisso.docPreventivi',
    'Note di credito': 'impostazioni.dialog.prefisso.docNoteCredito',
    'Acquisti': 'impostazioni.dialog.prefisso.docAcquisti',
    'Vendite al banco': 'impostazioni.dialog.prefisso.docVenditeBanco',
    'Arrivi merce': 'impostazioni.dialog.prefisso.docArriviMerce',
  };
  documentoLabel(documento: string): string {
    const key = this.DOC_KEYS[documento];
    return key ? this.i18n.t(key) : documento;
  }
  constructor(
    public dialogRef: MatDialogRef<PrefissoConfermaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PrefissoCambiato[]
  ) {}
}

// ── Main Component ───────────────────────────────────────────────────────────
@Component({
  selector: 'app-impostazioni',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule,
            MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule,
            MatTableModule, MatTabsModule, MatDialogModule, MatSnackBarModule,
            MatAutocompleteModule, MatSelectModule, MatCheckboxModule,
            MatSlideToggleModule, MatProgressSpinnerModule, MatRadioModule, MatMenuModule,
            MatExpansionModule, MatButtonToggleModule, MatSliderModule, MatTooltipModule, DragDropModule,
            EmptyStateComponent, TPipe],
  templateUrl: './impostazioni.html',
  styleUrl: './impostazioni.scss'
})
export class ImpostazioniComponent implements OnInit, OnDestroy {
  private confirm = inject(ConfirmService);
  private layout = inject(LayoutService);
  i18n = inject(I18nService);
  readonly langs = LANGS;
  private desktop = inject(DesktopService);
  readonly update = inject(UpdateService);

  /** Verifica manuale aggiornamenti (sezione Impostazioni → Aggiornamenti). */
  verificaInCorso = false;
  async verificaAggiornamenti() {
    if (this.verificaInCorso) return;
    this.verificaInCorso = true;
    try {
      const esito = await this.update.check();
      if (esito === 'disponibile') {
        this.snack.open(this.i18n.t('impostazioni.msg.aggiornamentoDisponibile', { v: this.update.disponibile()?.version ?? '' }), 'OK', { duration: 6000 });
      } else if (esito === 'aggiornato') {
        this.snack.open(this.i18n.t('impostazioni.msg.giaAllUltima'), '', { duration: 3500 });
      } else {
        const dett = this.update.ultimoErrore();
        const suffix = dett ? this.i18n.t('impostazioni.msg.impossibileVerificareDett', { dett }) : this.i18n.t('impostazioni.msg.controllaConnessione');
        this.snack.open(this.i18n.t('impostazioni.msg.impossibileVerificare', { dett: suffix }), '', { duration: 6000 });
      }
    } finally {
      this.verificaInCorso = false;
    }
  }

  /** Edizione offline: nasconde le schede SaaS (Email/SMTP, Moduli, Utenti, Amministrazione, Console SaaS). */
  readonly offline = environment.offline;

  /** Sezione attiva del menu laterale delle impostazioni. */
  sezione = 'azienda';

  /** Anteprima del prossimo numero per ciascun tipo di documento (sezione Avanzate).
   *  Riflette le impostazioni SALVATE (prefisso + numerazione annuale); si aggiorna
   *  dopo il salvataggio. */
  nextNumeri: Record<string, string> = {};
  get numeriPreviewTipi(): { tipo: string; label: string }[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { tipo: 'fatture', label: t('impostazioni.avanzate.fatture') },
      { tipo: 'ddt', label: t('impostazioni.avanzate.docTrasporto') },
      { tipo: 'ordini', label: t('impostazioni.avanzate.ordini') },
      { tipo: 'preventivi', label: t('impostazioni.avanzate.preventivi') },
      { tipo: 'note-credito', label: t('impostazioni.avanzate.noteCredito') },
      { tipo: 'acquisti', label: t('impostazioni.avanzate.acquisti') },
      { tipo: 'vendite-banco', label: t('impostazioni.avanzate.venditaBanco') },
      { tipo: 'arrivi-merce', label: t('impostazioni.avanzate.arriviMerce') },
    ];
  }

  /**
   * Voci del menu laterale, raggruppate per area. La visibilità delle voci che
   * dipendono dall'edizione/ruolo è filtrata qui, così il menu mostra solo ciò
   * che è davvero disponibile (i gruppi vuoti spariscono).
   */
  get navGroups(): { label: string; items: { id: string; label: string; icon: string }[] }[] {
    const t = (k: string) => this.i18n.t(k);
    const groups = [
      { label: t('impostazioni.nav.groupAzienda'), items: [
        { id: 'azienda',  label: t('impostazioni.nav.azienda'), icon: 'business' },
        { id: 'aspetto',  label: t('impostazioni.nav.aspetto'), icon: 'palette' },
        { id: 'avanzate', label: t('impostazioni.nav.avanzate'), icon: 'tune' },
      ] },
      { label: t('impostazioni.nav.groupDocumenti'), items: [
        { id: 'grafica', label: t('impostazioni.nav.grafica'), icon: 'auto_awesome' },
        { id: 'sdi',     label: t('impostazioni.nav.sdi'),   icon: 'cloud_upload' },
        { id: 'avvisi',  label: t('impostazioni.nav.avvisi'),  icon: 'notifications' },
      ] },
      { label: t('impostazioni.nav.groupAnagrafiche'), items: [
        { id: 'pagamenti', label: t('impostazioni.nav.pagamenti'),  icon: 'payments' },
        { id: 'causali',   label: t('impostazioni.nav.causali'),  icon: 'receipt_long' },
        { id: 'categorie', label: t('impostazioni.nav.categorie'), icon: 'category' },
        { id: 'unita',     label: t('impostazioni.nav.unita'),    icon: 'straighten' },
        { id: 'iva',       label: t('impostazioni.nav.iva'),       icon: 'percent' },
        { id: 'note',      label: t('impostazioni.nav.note'),        icon: 'sticky_note_2' },
      ] },
      { label: t('impostazioni.nav.groupSistema'), items: [
        ...(!this.offline ? [{ id: 'moduli', label: 'Moduli', icon: 'extension' }] : []),
        ...(!this.offline ? [{ id: 'email',  label: 'Email', icon: 'mail' }] : []),
        ...(!this.offline ? [{ id: 'utenti', label: 'Utenti', icon: 'group' }] : []),
        ...(this.offline && this.backupCfg ? [{ id: 'backup', label: t('impostazioni.nav.backup'), icon: 'backup' }] : []),
        ...(this.offline && this.isDesktop ? [{ id: 'dati', label: t('impostazioni.nav.dati'), icon: 'folder' }] : []),
        ...(this.offline ? [{ id: 'aggiornamenti', label: t('impostazioni.nav.aggiornamenti'), icon: 'system_update' }] : []),
      ] },
    ];
    return groups.filter(g => g.items.length > 0);
  }

  // ── Backup (offline) ──────────────────────────────────────────────────────
  backupCfg: BackupConfig | null = null;
  backupFiles: { name: string; encrypted: boolean; size: number; mtime: string }[] = [];
  backupBusy = false;
  get isDesktop(): boolean { return this.desktop.isDesktop; }

  // ── Dati e sincronizzazione (offline) ───────────────────────────────────────
  dataDir = '';
  dataFiles: { nome: string; esiste: boolean; bytes: number }[] = [];
  dataBusy = false;
  /** Avvio automatico col computer (plugin Tauri autostart). */
  autostart = false;
  /** Cronologia versioni (snapshot) ripristinabili. */
  snapshots: { name: string; size: number; mtime: string }[] = [];
  snapBusy = false;
  /** Cifratura del database a riposo. */
  cifraturaAttiva = false;
  cifraturaPasswordImpostata = false;
  cifraturaBusy = false;

  /** Layout di navigazione corrente (barra laterale / superiore). */
  get navLayout(): NavLayout { return this.layout.navLayout(); }
  setNavLayout(v: NavLayout) { this.layout.setNavLayout(v); }

  /** Densità dell'interfaccia (compatta desktop / comoda). */
  get density(): Density { return this.layout.density(); }
  setDensity(v: Density) { this.layout.setDensity(v); }

  /** Tema chiaro/scuro (spostato qui dall'icona in topbar). */
  get darkMode(): boolean { return this.layout.darkMode(); }
  setDarkMode(v: boolean) { this.layout.setDarkMode(v); }

  /** Lingua dell'interfaccia (scelta anche al primo avvio). */
  get language(): Lang { return this.i18n.lang() ?? 'it'; }
  setLanguage(v: Lang) { this.i18n.setLang(v); }
  form: FormGroup;
  filteredCities: CityResult[] = [];
  private cityMap = new Map<string, CityResult>();
  logoPreview: string = '';
  private prefissiOriginali: Record<string, string> = {};

  private readonly PREFISSI_MAP = [
    { field: 'prefissoDdt',        documento: 'Documenti di trasporto' },
    { field: 'prefissoFatture',    documento: 'Fatture' },
    { field: 'prefissoOrdini',     documento: 'Ordini' },
    { field: 'prefissoPreventivi', documento: 'Preventivi' },
    { field: 'prefissoNoteCredito',documento: 'Note di credito' },
    { field: 'prefissoAcquisti',   documento: 'Acquisti' },
    { field: 'prefissoVenditeBanco',documento: 'Vendite al banco' },
    { field: 'prefissoArriviMerce',documento: 'Arrivi merce' },
  ];

  tipiPagamento: TipoPagamento[] = [];
  tpColumns = ['nome', 'conto', 'scadenza', 'immediato', 'attivo', 'azioni'];

  categorie: CategoriaProdotto[] = [];
  catColumns = ['nome', 'azioni'];

  unitaMisura: UnitaMisura[] = [];
  umColumns = ['nome', 'simbolo', 'azioni'];

  aliquoteIva: AliquotaIva[] = [];
  ivaColumns = ['nome', 'valore', 'attiva', 'azioni'];

  utenti: Utente[] = [];
  utenteColumns = ['username', 'nome', 'ruolo', 'attivo', 'azioni'];

  noteRapide: NotaRapida[] = [];
  causali: CausalePagamento[] = [];
  notaRapidaColumns = ['testo', 'ordine', 'azioni'];
  causaliColumns = ['nome', 'azioni'];


  emailTesting = false;

  moduli: ModuloDto[] = [];
  moduliSaving = false;

  templateConfig: TemplateConfig = { stile: 'classico' };
  notificheConfig: NotificheConfig = { avvisoInsolutiDdt: true, avvisoInsolutiFattura: true };
  get templateBlocks(): { key: string; label: string }[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { key: 'parti', label: t('impostazioni.grafica.blocco.parti') },
      { key: 'tabella', label: t('impostazioni.grafica.blocco.tabella') },
      { key: 'totali', label: t('impostazioni.grafica.blocco.totali') },
      { key: 'pagamento', label: t('impostazioni.grafica.blocco.pagamento') },
      { key: 'trasporto', label: t('impostazioni.grafica.blocco.trasporto') },
      { key: 'firme', label: t('impostazioni.grafica.blocco.firme') },
      { key: 'note', label: t('impostazioni.grafica.blocco.note') },
      { key: 'immaginiPreventivo', label: t('impostazioni.grafica.blocco.immaginiPreventivo') },
      { key: 'footer', label: t('impostazioni.grafica.blocco.footer') },
    ];
  }

  constructor(
    private fb: FormBuilder,
    private ds: DataService,
    private cityService: CityService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private moduliSvc: ModuliService,
    private docLockSvc: DocLockService,
    private printSvc: PrintService,
    private sanitizer: DomSanitizer,
    private prezzoFmt: PrezzoFormatService,
  ) {
    this.form = this.fb.group({
      ragioneSociale: [''], pIva: ['', pIvaValidator], codFiscale: ['', codiceFiscaleValidator],
      indirizzo: [''], cap: [''], citta: [''], provincia: [''], stato: [''],
      telefono: [''], email: [''], pec: [''], sdi: [''],
      iban: ['', ibanValidator], banca: [''], logo: [''],
      smtpHost: [''], smtpPort: [587, [Validators.min(1), Validators.max(65535)]], smtpUser: [''], smtpPass: [''], smtpFrom: [''], smtpSecure: [false],
      emailCorpoDocumento: [''],
      emailMode: ['SMTP'],
      sdiProvider: ['GENERICO'], sdiApiUrl: [''], sdiApiKey: [''],
      riordinoAutomatico: [false], multiUtenteAttivo: [false],
      numerazioneAnnuale: [true],
      lockDocumentiDefault: [true],
      decimaliPrezzo: [2],
      // Fiscale: regime + default precompilati nei nuovi documenti
      regimeFiscale: ['RF01'],
      ritenutaAliquotaDefault: [0], ritenutaCausaleDefault: [''], ritenutaTipoDefault: ['RT02'],
      cassaTipoDefault: [''], cassaAliquotaDefault: [0], cassaIvaDefault: [0],
      prefissoDdt: [''], prefissoFatture: [''], prefissoOrdini: [''],
      prefissoPreventivi: [''], prefissoNoteCredito: [''], prefissoAcquisti: [''],
      prefissoVenditeBanco: [''], prefissoArriviMerce: [''],
    });
  }

  ngOnDestroy() {
    clearInterval(this.googlePollTimer);
  }

  ngOnInit() {
    if (this.offline) this.loadBackupConfig();
    if (this.offline && this.isDesktop) this.loadSistemaPercorsi();
    this.loadNextNumeri();
    this.ds.getAzienda().subscribe(a => {
      if (a) {
        this.form.patchValue(a);
        this.logoPreview = a.logo || '';
        const p = a.numeroPrefissi || {};
        const prefissiCaricati = {
          prefissoDdt: p['ddt'] || '', prefissoFatture: p['fatture'] || '',
          prefissoOrdini: p['ordini'] || '', prefissoPreventivi: p['preventivi'] || '',
          prefissoNoteCredito: p['note_credito'] || '', prefissoAcquisti: p['acquisti'] || '',
          prefissoVenditeBanco: p['vendite_banco'] || '', prefissoArriviMerce: p['arrivi_merce'] || '',
        };
        this.form.patchValue(prefissiCaricati);
        this.prefissiOriginali = { ...prefissiCaricati };
        this.templateConfig = a.templateConfig
          ? { ...a.templateConfig, blocks: { ...a.templateConfig.blocks } }
          : { stile: 'classico' };
        if (!this.templateConfig.blocks) this.templateConfig.blocks = {};
        this.initGraficaEditor();
        this.notificheConfig = a.notificheConfig
          ? { ...a.notificheConfig }
          : { avvisoInsolutiDdt: true, avvisoInsolutiFattura: true };
      }
    });

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

    this.loadTipiPagamento();
    this.loadCategorie();
    this.loadUnitaMisura();
    this.loadAliquoteIva();
    this.loadUtenti();
    this.loadNoteRapide();
    this.loadCausali();
    this.loadModuli();
    this.loadGoogle();
  }

  // ── Moduli (Livello 2) ──────────────────────────────────────────────────────
  loadModuli() {
    this.ds.getModuli(true).subscribe(m => this.moduli = m);
  }

  // ── Google (Calendar + Tasks) ─────────────────────────────────────────────────
  googleConfig: GoogleSyncConfig | null = null;
  googleConnettendoInCorso = false;
  googleSyncInCorso = false;

  loadGoogle() {
    this.ds.getGoogleConfig().subscribe(c => this.googleConfig = c);
  }

  private googlePollTimer?: ReturnType<typeof setInterval>;

  /**
   * Avvia il collegamento e poi fa polling su GET /config finché non risulta
   * connesso o in errore — NON resta in attesa di un'unica chiamata bloccante:
   * il consenso su Google può richiedere decine di secondi, più del timeout
   * che il canale interno di Ordeva (scheme custom, non una vera rete)
   * tollera per una singola richiesta. Vedi il commento su connetti() in
   * src-tauri/src/routes/google_sync.rs per il dettaglio del problema.
   */
  connettiGoogle() {
    if (this.googleConnettendoInCorso) return;
    this.googleConnettendoInCorso = true;
    this.ds.connettiGoogle().subscribe({
      next: () => this.avviaPollingGoogle(),
      error: e => {
        this.googleConnettendoInCorso = false;
        this.snack.open(e.error?.error || this.i18n.t('impostazioni.google.msg.erroreConnetti'), '', { duration: 4500 });
      },
    });
  }

  private avviaPollingGoogle() {
    clearInterval(this.googlePollTimer);
    let tentativi = 0;
    const MAX_TENTATIVI = 90; // ~3 minuti a 2s l'uno
    this.googlePollTimer = setInterval(() => {
      tentativi++;
      this.ds.getGoogleConfig().subscribe(c => {
        this.googleConfig = c;
        if (c.connesso) {
          clearInterval(this.googlePollTimer);
          this.googleConnettendoInCorso = false;
          this.snack.open(this.i18n.t('impostazioni.google.msg.collegato'), '', { duration: 3000 });
        } else if (c.ultimoErrore) {
          clearInterval(this.googlePollTimer);
          this.googleConnettendoInCorso = false;
          this.snack.open(c.ultimoErrore, '', { duration: 5000 });
        } else if (tentativi >= MAX_TENTATIVI) {
          clearInterval(this.googlePollTimer);
          this.googleConnettendoInCorso = false;
          this.snack.open(this.i18n.t('impostazioni.google.msg.erroreConnetti'), '', { duration: 4500 });
        }
      });
    }, 2000);
  }

  toggleGoogleCalendar() {
    this.ds.toggleGoogleCalendar().subscribe({
      next: () => this.loadGoogle(),
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.google.msg.erroreGenerico'), '', { duration: 3500 }),
    });
  }

  toggleGoogleTasks() {
    this.ds.toggleGoogleTasks().subscribe({
      next: () => this.loadGoogle(),
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.google.msg.erroreGenerico'), '', { duration: 3500 }),
    });
  }

  async disconnettiGoogle() {
    const ok = await this.confirm.delete(this.i18n.t('impostazioni.google.msg.confermaScollega'));
    if (!ok) return;
    this.ds.disconnettiGoogle().subscribe({
      next: () => { this.loadGoogle(); this.snack.open(this.i18n.t('impostazioni.google.msg.scollegato'), '', { duration: 2500 }); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.google.msg.erroreGenerico'), '', { duration: 3500 }),
    });
  }

  sincronizzaGoogle() {
    if (this.googleSyncInCorso || !this.googleConfig) return;
    const chiamate: Observable<GoogleSyncResult>[] = [];
    if (this.googleConfig.calendarAttivo) chiamate.push(this.ds.syncGoogleCalendar());
    if (this.googleConfig.tasksAttivo) chiamate.push(this.ds.syncGoogleTasks());
    if (!chiamate.length) return;
    this.googleSyncInCorso = true;
    forkJoin(chiamate).subscribe({
      next: risultati => {
        this.googleSyncInCorso = false;
        this.loadGoogle();
        const importati = risultati.reduce((s, r) => s + r.importati, 0);
        const creati = risultati.reduce((s, r) => s + r.creati, 0);
        const aggiornati = risultati.reduce((s, r) => s + r.aggiornati, 0);
        this.snack.open(
          this.i18n.t('impostazioni.google.msg.syncRiepilogo', { creati, aggiornati, importati }),
          '', { duration: 3500 },
        );
      },
      error: e => {
        this.googleSyncInCorso = false;
        this.snack.open(e.error?.error || this.i18n.t('impostazioni.google.msg.erroreSync'), '', { duration: 4000 });
      },
    });
  }

  categorieModuli(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of this.moduli) {
      if (!seen.has(m.categoria)) { seen.add(m.categoria); out.push(m.categoria); }
    }
    return out;
  }

  moduliPerCategoria(cat: string): ModuloDto[] {
    return this.moduli.filter(m => m.categoria === cat);
  }

  toggleModulo(m: ModuloDto, attivo: boolean) {
    if (m.core) return;
    this.moduliSaving = true;
    this.ds.setModulo(m.slug, attivo).subscribe({
      next: updated => {
        const i = this.moduli.findIndex(x => x.slug === m.slug);
        if (i >= 0) this.moduli[i] = updated;
        // Aggiorna lo stato globale così il menu filtra subito
        this.ds.invalidateModuli();
        this.moduliSvc.load(true).subscribe();
        this.moduliSaving = false;
        this.snack.open(attivo ? `Modulo "${m.nome}" attivato` : `Modulo "${m.nome}" disattivato`, '', { duration: 2200 });
      },
      error: e => {
        this.moduliSaving = false;
        this.snack.open(e.error?.error || e.message, '', { duration: 3000 });
        this.loadModuli();
      },
    });
  }

  onCitySelected(name: string) {
    const r = this.cityMap.get(name);
    if (r) this.form.patchValue({ cap: r.cap, provincia: r.provincia, stato: 'Italia' }, { emitEvent: false });
  }

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.logoPreview = reader.result as string;
      this.form.patchValue({ logo: this.logoPreview });
    };
    reader.readAsDataURL(file);
  }

  removeLogo() {
    this.logoPreview = '';
    this.form.patchValue({ logo: '' });
  }

  /** Endpoint suggerito per i provider noti (l'utente può comunque modificarlo). */
  private readonly SDI_ENDPOINT: Record<string, string> = {
    ARUBA: 'https://ws.fatturazioneelettronica.aruba.it',
    FIC:   'https://api-v2.fattureincloud.it',
  };

  /** True quando url+chiave sono compilati: la guida lascia il posto al form una volta fatto. */
  get sdiConfigured(): boolean {
    const url = (this.form.get('sdiApiUrl')?.value || '').trim();
    const key = (this.form.get('sdiApiKey')?.value || '').trim();
    return !!url && !!key;
  }

  /** Al cambio provider, precompila l'URL noto se il campo è vuoto o standard. */
  onSdiProviderChange(provider: string) {
    const known = Object.values(this.SDI_ENDPOINT);
    const cur = (this.form.get('sdiApiUrl')?.value || '').trim();
    if (provider === 'GENERICO') return;            // URL libero: non tocco
    if (!cur || known.includes(cur)) {
      this.form.patchValue({ sdiApiUrl: this.SDI_ENDPOINT[provider] || '' });
    }
  }

  save() {
    const v = this.form.value;
    const cambiati: PrefissoCambiato[] = this.PREFISSI_MAP
      .filter(({ field }) => (this.prefissiOriginali[field] ?? '') !== (v[field] || ''))
      .map(({ field, documento }) => ({
        documento,
        da: this.prefissiOriginali[field] ?? '',
        a: v[field] || '',
      }));

    if (cambiati.length > 0) {
      const ref = this.dialog.open(PrefissoConfermaDialogComponent, { data: cambiati, width: '560px' });
      ref.afterClosed().subscribe(confirmed => {
        if (confirmed) {
          this.doSave();
        } else {
          this.form.patchValue(this.prefissiOriginali, { emitEvent: false });
        }
      });
    } else {
      this.doSave();
    }
  }

  private doSave() {
    const v = this.form.value;
    const numeroPrefissi = {
      ddt: v.prefissoDdt || '', fatture: v.prefissoFatture || '',
      ordini: v.prefissoOrdini || '', preventivi: v.prefissoPreventivi || '',
      note_credito: v.prefissoNoteCredito || '', acquisti: v.prefissoAcquisti || '',
      vendite_banco: v.prefissoVenditeBanco || '', arrivi_merce: v.prefissoArriviMerce || '',
    };
    this.ds.saveAzienda({ ...v, logo: this.logoPreview, numeroPrefissi, templateConfig: this.templateConfig, notificheConfig: this.notificheConfig } as Azienda).subscribe({
      next: () => {
        this.prefissiOriginali = {
          prefissoDdt: v.prefissoDdt || '', prefissoFatture: v.prefissoFatture || '',
          prefissoOrdini: v.prefissoOrdini || '', prefissoPreventivi: v.prefissoPreventivi || '',
          prefissoNoteCredito: v.prefissoNoteCredito || '', prefissoAcquisti: v.prefissoAcquisti || '',
          prefissoVenditeBanco: v.prefissoVenditeBanco || '', prefissoArriviMerce: v.prefissoArriviMerce || '',
        };
        this.ds.invalidateEmailMode();
        this.prezzoFmt.invalidate();
        this.docLockSvc.setEnabled(v.lockDocumentiDefault !== false);
        this.loadNextNumeri();   // prefissi/annuale cambiati → aggiorna l'anteprima
        this.snack.open(this.i18n.t('impostazioni.msg.datiSalvati'), '', { duration: 2000 });
      },
      error: e => this.snack.open(e.message, '', { duration: 3000 }),
    });
  }

  /** Carica l'anteprima del prossimo numero per ogni tipo di documento. */
  loadNextNumeri() {
    for (const { tipo } of this.numeriPreviewTipi) {
      this.ds.getNextNumero(tipo).subscribe({
        next: r => { this.nextNumeri[tipo] = String((r as any).numero ?? ''); },
        error: () => {},
      });
    }
  }

  saveNotificheConfig() {
    const v = this.form.value;
    const numeroPrefissi = {
      ddt: v.prefissoDdt || '', fatture: v.prefissoFatture || '',
      ordini: v.prefissoOrdini || '', preventivi: v.prefissoPreventivi || '',
      note_credito: v.prefissoNoteCredito || '', acquisti: v.prefissoAcquisti || '',
      vendite_banco: v.prefissoVenditeBanco || '', arrivi_merce: v.prefissoArriviMerce || '',
    };
    this.ds.saveAzienda({ ...v, logo: this.logoPreview, numeroPrefissi, templateConfig: this.templateConfig, notificheConfig: this.notificheConfig } as Azienda).subscribe({
      next: () => this.snack.open(this.i18n.t('impostazioni.msg.avvisiSalvati'), '', { duration: 2000 }),
      error: e => this.snack.open(e.message, '', { duration: 3000 }),
    });
  }

  // ── Editor grafica documenti ──────────────────────────────────────────────
  private readonly PRESET_I18N_KEYS: Record<string, string> = {
    classico: 'impostazioni.grafica.preset.classico',
    moderno: 'impostazioni.grafica.preset.moderno',
    minimal: 'impostazioni.grafica.preset.minimal',
    ordeva: 'impostazioni.grafica.preset.ordeva',
    elegante: 'impostazioni.grafica.preset.elegante',
    compatto: 'impostazioni.grafica.preset.compatto',
    professionale: 'impostazioni.grafica.preset.professionale',
    colorato: 'impostazioni.grafica.preset.colorato',
    'bn-essenziale': 'impostazioni.grafica.preset.bnEssenziale',
  };
  get presets(): TemplatePreset[] {
    return TEMPLATE_PRESETS.map(p => {
      const key = this.PRESET_I18N_KEYS[p.id];
      return key ? { ...p, label: this.i18n.t(`${key}.label`), descr: this.i18n.t(`${key}.descr`) } : p;
    });
  }
  get fontOptions(): { value: 'helvetica' | 'times' | 'courier'; label: string }[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { value: 'helvetica', label: t('impostazioni.grafica.fontHelvetica') },
      { value: 'times', label: t('impostazioni.grafica.fontTimes') },
      { value: 'courier', label: t('impostazioni.grafica.fontCourier') },
    ];
  }
  get colorFields(): { key: string; label: string; def: string }[] {
    const t = (k: string) => this.i18n.t(k);
    return [
      { key: 'accent', label: t('impostazioni.grafica.colorePrincipale'), def: '#0e6480' },
      { key: 'text', label: t('impostazioni.grafica.coloreTesto'), def: '#1a1a2e' },
      { key: 'muted', label: t('impostazioni.grafica.coloreTestoSecondario'), def: '#64748b' },
      { key: 'rowAlt', label: t('impostazioni.grafica.coloreRigheAlternate'), def: '#f8fafc' },
      { key: 'lightBg', label: t('impostazioni.grafica.coloreSfondiTenui'), def: '#f0f2f8' },
    ];
  }
  get footerFields(): { key: string; label: string }[] {
    const t = (k: string) => this.i18n.t(k);
    return [
    { key: 'showRagioneSociale', label: t('impostazioni.grafica.footerField.showRagioneSociale') },
    { key: 'showPiva', label: t('impostazioni.grafica.footerField.showPiva') },
    { key: 'showCodFiscale', label: t('impostazioni.grafica.footerField.showCodFiscale') },
    { key: 'showPec', label: t('impostazioni.grafica.footerField.showPec') },
    { key: 'showSdi', label: t('impostazioni.grafica.footerField.showSdi') },
    { key: 'showPageNumber', label: t('impostazioni.grafica.footerField.showPageNumber') },
    ];
  }
  get sectionLabels(): Record<string, string> {
    const t = (k: string) => this.i18n.t(k);
    return {
      parti: t('impostazioni.grafica.blocco.parti'), tabella: t('impostazioni.grafica.blocco.tabella'),
      totali: t('impostazioni.grafica.blocco.totali'), pagamento: t('impostazioni.grafica.sectionLabel.pagamento'), note: t('impostazioni.grafica.blocco.note'),
    };
  }
  get columnLabels(): Record<string, string> {
    const t = (k: string) => this.i18n.t(k);
    return {
      num: t('impostazioni.grafica.col.num'), codiceDescrizione: t('impostazioni.grafica.col.codiceDescrizione'), quantita: t('impostazioni.grafica.col.quantita'),
      um: t('impostazioni.grafica.col.um'), prezzo: t('impostazioni.grafica.col.prezzo'), sconto: t('impostazioni.grafica.col.sconto'), iva: t('impostazioni.grafica.col.iva'), importo: t('impostazioni.grafica.col.importo'),
    };
  }
  // Il numero riga (#) NON è più forzato: si può togliere dalla stampa.
  readonly forcedColumns: string[] = ['codiceDescrizione', 'importo'];

  sectionsOrderList: SectionKey[] = ['parti', 'tabella', 'totali', 'pagamento', 'note'];
  columnsList: { key: ColumnKey; visible: boolean }[] = [];

  previewSafeUrl?: SafeResourceUrl;
  previewLoading = false;
  private previewBlobUrl?: string;
  private previewTimer?: any;

  private initGraficaEditor() {
    const tc = this.templateConfig;
    const baseSections: SectionKey[] = ['parti', 'tabella', 'totali', 'pagamento', 'note'];
    if (tc.sectionsOrder && tc.sectionsOrder.length) {
      const known = tc.sectionsOrder.filter(k => baseSections.includes(k));
      this.sectionsOrderList = [...known, ...baseSections.filter(k => !known.includes(k))];
    } else {
      this.sectionsOrderList = [...baseSections];
    }
    const allCols: ColumnKey[] = ['num', 'codiceDescrizione', 'quantita', 'um', 'prezzo', 'sconto', 'iva', 'importo'];
    if (tc.columns && tc.columns.length) {
      const present = tc.columns.map(c => c.key);
      this.columnsList = [
        ...tc.columns.filter(c => allCols.includes(c.key)).map(c => ({ key: c.key, visible: c.visible !== false })),
        ...allCols.filter(k => !present.includes(k)).map(k => ({ key: k, visible: true })),
      ];
    } else {
      this.columnsList = allCols.map(k => ({ key: k, visible: true }));
    }
    this.schedulePreview();
  }

  private touch() {
    this.templateConfig = { ...this.templateConfig };
    this.schedulePreview();
  }

  private schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.refreshPreview(), 250);
  }

  refreshPreview() {
    this.previewLoading = true;
    const az = { ...this.form.value, logo: this.logoPreview };
    this.printSvc.buildSampleBlobUrl(this.templateConfig, az as any).then(url => {
      if (this.previewBlobUrl) { try { URL.revokeObjectURL(this.previewBlobUrl); } catch (_) {} }
      this.previewBlobUrl = url;
      this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
      this.previewLoading = false;
    }).catch(() => { this.previewLoading = false; });
  }

  // Preset
  applyPreset(p: TemplatePreset) {
    this.templateConfig = JSON.parse(JSON.stringify(p.config));
    if (!this.templateConfig.blocks) this.templateConfig.blocks = {};
    this.initGraficaEditor();
  }
  isPresetActive(p: TemplatePreset): boolean {
    return this.templateConfig.stile === p.config.stile &&
      JSON.stringify(this.templateConfig.colors || null) === JSON.stringify(p.config.colors || null) &&
      (this.templateConfig.typography?.fontFamily || 'helvetica') === (p.config.typography?.fontFamily || 'helvetica');
  }

  // Stile / blocchi (compat con handler esistenti)
  setTemplateStile(stile: 'classico' | 'moderno' | 'minimal') {
    this.templateConfig = { ...this.templateConfig, stile };
    this.schedulePreview();
  }
  isBlockVisible(key: string): boolean {
    return this.templateConfig.blocks?.[key] !== false;
  }
  toggleBlock(key: string, checked: boolean) {
    if (!this.templateConfig.blocks) this.templateConfig.blocks = {};
    this.templateConfig.blocks[key] = checked;
    this.touch();
  }

  // Colori
  colorValue(key: string): string {
    const c = (this.templateConfig.colors as any)?.[key];
    if (c) return c;
    if (key === 'accent' && this.templateConfig.accentColor) return this.templateConfig.accentColor;
    return this.colorFields.find(f => f.key === key)?.def || '#000000';
  }
  onColorChange(key: string, event: Event) { this.setColor(key, (event.target as HTMLInputElement).value); }
  setColor(key: string, val: string) {
    this.templateConfig.colors = { ...(this.templateConfig.colors || {}), [key]: val };
    if (key === 'accent') this.templateConfig.accentColor = val; // mantieni il campo legacy allineato
    this.touch();
  }
  resetColor(key: string) {
    const colors: any = { ...(this.templateConfig.colors || {}) };
    delete colors[key];
    this.templateConfig.colors = colors;
    if (key === 'accent') this.templateConfig.accentColor = undefined;
    this.touch();
  }
  onAccentColorChange(event: Event) { this.setColor('accent', (event.target as HTMLInputElement).value); }
  resetAccentColor() { this.resetColor('accent'); }

  // Tipografia
  get fontFamily(): string { return this.templateConfig.typography?.fontFamily || 'helvetica'; }
  setFontFamily(v: 'helvetica' | 'times' | 'courier') {
    this.templateConfig.typography = { ...(this.templateConfig.typography || {}), fontFamily: v };
    this.touch();
  }
  get fontScale(): number { return this.templateConfig.typography?.fontScale ?? 1; }
  setFontScale(v: number | null) {
    this.templateConfig.typography = { ...(this.templateConfig.typography || {}), fontScale: v ?? 1 };
    this.touch();
  }
  get uppercaseTitles(): boolean { return this.templateConfig.typography?.uppercaseSectionTitles !== false; }
  setUppercaseTitles(v: boolean) {
    this.templateConfig.typography = { ...(this.templateConfig.typography || {}), uppercaseSectionTitles: v };
    this.touch();
  }

  // Logo
  get logoShow(): boolean { return this.templateConfig.logo?.show !== false; }
  setLogoShow(v: boolean) { this.templateConfig.logo = { ...(this.templateConfig.logo || {}), show: v }; this.touch(); }
  get logoAlign(): string { return this.templateConfig.logo?.align || 'left'; }
  setLogoAlign(v: 'left' | 'center' | 'right') { this.templateConfig.logo = { ...(this.templateConfig.logo || {}), align: v }; this.touch(); }
  get logoSize(): string { return this.templateConfig.logo?.size || 'M'; }
  setLogoSize(v: 'S' | 'M' | 'L') { this.templateConfig.logo = { ...(this.templateConfig.logo || {}), size: v }; this.touch(); }

  // Margini
  get marginLeft(): number { return this.templateConfig.margins?.left ?? 14; }
  setMarginLeft(v: number | null) { this.templateConfig.margins = { ...(this.templateConfig.margins || {}), left: v ?? 14 }; this.touch(); }
  get marginRight(): number { return this.templateConfig.margins?.right ?? 14; }
  setMarginRight(v: number | null) { this.templateConfig.margins = { ...(this.templateConfig.margins || {}), right: v ?? 14 }; this.touch(); }

  // Footer
  footerVal(key: string): boolean { return (this.templateConfig.footer as any)?.[key] !== false; }
  setFooter(key: string, val: boolean) { this.templateConfig.footer = { ...(this.templateConfig.footer || {}), [key]: val }; this.touch(); }
  get footerCustomText(): string { return this.templateConfig.footer?.customText || ''; }
  setFooterCustomText(v: string) { this.templateConfig.footer = { ...(this.templateConfig.footer || {}), customText: v }; this.touch(); }

  // Pagamento / visibilità
  get showIban(): boolean { return this.templateConfig.visibility?.showIban !== false; }
  setShowIban(v: boolean) { this.templateConfig.visibility = { ...(this.templateConfig.visibility || {}), showIban: v }; this.touch(); }

  // Riordino sezioni
  dropSection(e: CdkDragDrop<SectionKey[]>) {
    moveItemInArray(this.sectionsOrderList, e.previousIndex, e.currentIndex);
    this.templateConfig.sectionsOrder = [...this.sectionsOrderList];
    this.touch();
  }

  // Colonne tabella
  dropColumn(e: CdkDragDrop<any[]>) {
    moveItemInArray(this.columnsList, e.previousIndex, e.currentIndex);
    this.syncColumns();
  }
  isColumnForced(key: string): boolean { return this.forcedColumns.includes(key); }
  toggleColumn(key: ColumnKey, visible: boolean) {
    const c = this.columnsList.find(x => x.key === key);
    if (c) c.visible = visible;
    this.syncColumns();
  }
  private syncColumns() {
    this.templateConfig.columns = this.columnsList.map(c => ({
      key: c.key, visible: this.forcedColumns.includes(c.key) ? true : c.visible,
    }));
    this.touch();
  }

  testSmtp() {
    this.emailTesting = true;
    this.ds.saveAzienda({ ...this.form.value, logo: this.logoPreview } as Azienda).subscribe({
      next: () => this.ds.testSmtp().subscribe({
        next: () => { this.emailTesting = false; this.snack.open('Connessione SMTP riuscita!', '', { duration: 3000 }); },
        error: e => { this.emailTesting = false; this.snack.open('Errore SMTP: ' + e.error?.error, '', { duration: 5000 }); }
      }),
      error: () => { this.emailTesting = false; }
    });
  }

  // ── Tipi Pagamento ──────────────────────────────────────────────────────────
  loadTipiPagamento() { this.ds.getTipiPagamento().subscribe(t => { this.tipiPagamento = t; }); }

  openTipoPagamento(t?: TipoPagamento) {
    this.dialog.open(TipoPagamentoDialogComponent, { data: t ?? null, width: '520px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateTipoPagamento(result) : this.ds.createTipoPagamento(result);
        op.subscribe({ next: () => { this.loadTipiPagamento(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
                       error: e => this.snack.open(e.message, '', { duration: 3000 }) });
      });
  }

  async deleteTipoPagamento(t: TipoPagamento) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaTipoPagamento', { nome: t.nome }))) return;
    this.ds.deleteTipoPagamento(t.id!).subscribe({
      next: () => { this.loadTipiPagamento(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  scadenzaLabel(t: TipoPagamento): string {
    if (t.immediato) return this.i18n.t('impostazioni.pagamenti.immediatoLabel');
    if (t.giorniScadenza === 0) return this.i18n.t('impostazioni.pagamenti.vistaFattura');
    const gg = this.i18n.t('impostazioni.pagamenti.ggAbbrev');
    const fm = t.fineMese ? ` ${this.i18n.t('impostazioni.pagamenti.fmAbbrev')}` : '';
    return `${t.giorniScadenza}${gg}${fm}`;
  }

  // ── Categorie Prodotto ──────────────────────────────────────────────────────
  loadCategorie() { this.ds.getCategorieProdotto().subscribe(c => { this.categorie = c; }); }

  openCategoria(c?: CategoriaProdotto) {
    this.dialog.open(CategoriaProdottoDialogComponent, { data: c ?? null, width: '400px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateCategoriaProdotto(result) : this.ds.createCategoriaProdotto(result);
        op.subscribe({ next: () => { this.loadCategorie(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
                       error: e => this.snack.open(e.message, '', { duration: 3000 }) });
      });
  }

  async deleteCategoria(c: CategoriaProdotto) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaCategoria', { nome: c.nome }))) return;
    this.ds.deleteCategoriaProdotto(c.id!).subscribe({
      next: () => { this.loadCategorie(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  // ── Unità di Misura ─────────────────────────────────────────────────────────
  loadUnitaMisura() { this.ds.getUnitaMisura().subscribe(u => { this.unitaMisura = u; }); }

  openUnitaMisura(u?: UnitaMisura) {
    this.dialog.open(UnitaMisuraDialogComponent, { data: u ?? null, width: '400px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateUnitaMisura(result) : this.ds.createUnitaMisura(result);
        op.subscribe({ next: () => { this.loadUnitaMisura(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
                       error: e => this.snack.open(e.message, '', { duration: 3000 }) });
      });
  }

  async deleteUnitaMisura(u: UnitaMisura) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaUnitaMisura', { nome: u.nome }))) return;
    this.ds.deleteUnitaMisura(u.id!).subscribe({
      next: () => { this.loadUnitaMisura(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  // ── Aliquote IVA ────────────────────────────────────────────────────────────
  loadAliquoteIva() { this.ds.getAliquoteIva().subscribe(a => { this.aliquoteIva = a; }); }

  openAliquotaIva(a?: AliquotaIva) {
    this.dialog.open(AliquotaIvaDialogComponent, { data: a ?? null, width: '400px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateAliquotaIva(result) : this.ds.createAliquotaIva(result);
        op.subscribe({ next: () => { this.loadAliquoteIva(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
                       error: e => this.snack.open(e.message, '', { duration: 3000 }) });
      });
  }

  async deleteAliquotaIva(a: AliquotaIva) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaAliquotaIva', { nome: a.nome }))) return;
    this.ds.deleteAliquotaIva(a.id!).subscribe({
      next: () => { this.loadAliquoteIva(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  // ── Utenti ──────────────────────────────────────────────────────────────────
  loadUtenti() { this.ds.getUtenti().subscribe(u => { this.utenti = u; }); }

  openUtente(u?: Utente) {
    this.dialog.open(UtenteDialogComponent, { data: u ?? null, width: '480px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateUtente(result) : this.ds.createUtente(result);
        op.subscribe({
          next: () => { this.loadUtenti(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
          error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
        });
      });
  }

  async deleteUtente(u: Utente) {
    if (!await this.confirm.delete(`Eliminare l'utente "${u.username}"?`)) return;
    this.ds.deleteUtente(u.id!).subscribe({
      next: () => { this.loadUtenti(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
    });
  }

  ruoloLabel(ruolo: string): string {
    const map: Record<string, string> = {
      ADMIN: 'Admin', COMMERCIALE: 'Commerciale',
      MAGAZZINIERE: 'Magazziniere', CONTABILE: 'Contabile', OPERATORE: 'Operatore'
    };
    return map[ruolo] ?? ruolo;
  }

  // ── Note Rapide ─────────────────────────────────────────────────────────────
  loadNoteRapide() { this.ds.getNoteRapide().subscribe(n => { this.noteRapide = n; }); }

  openNotaRapida(n?: NotaRapida) {
    this.dialog.open(NotaRapidaDialogComponent, { data: n ?? null, width: '440px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateNotaRapida(result) : this.ds.createNotaRapida(result);
        op.subscribe({
          next: () => { this.loadNoteRapide(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
          error: e => this.snack.open(e.message, '', { duration: 3000 })
        });
      });
  }

  async deleteNotaRapida(n: NotaRapida) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaNotaRapida', { testo: n.testo }))) return;
    this.ds.deleteNotaRapida(n.id!).subscribe({
      next: () => { this.loadNoteRapide(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  // ── Causali pagamento ───────────────────────────────────────────────────────
  loadCausali() { this.ds.getCausali().subscribe(c => { this.causali = c; }); }

  openCausale(c?: CausalePagamento) {
    this.dialog.open(CausaleDialogComponent, { data: c ?? null, width: '440px' })
      .afterClosed().subscribe(result => {
        if (!result) return;
        const op = result.id ? this.ds.updateCausale(result) : this.ds.createCausale(result);
        op.subscribe({
          next: () => { this.loadCausali(); this.snack.open(this.i18n.t('impostazioni.msg.salvato'), '', { duration: 2000 }); },
          error: e => this.snack.open(e.error?.error || e.message, '', { duration: 3000 })
        });
      });
  }

  async deleteCausale(c: CausalePagamento) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaCausale', { nome: c.nome }))) return;
    this.ds.deleteCausale(c.id!).subscribe({
      next: () => { this.loadCausali(); this.snack.open(this.i18n.t('impostazioni.msg.eliminato'), '', { duration: 2000 }); },
      error: e => this.snack.open(e.message, '', { duration: 3000 })
    });
  }

  // ── Backup (offline) ──────────────────────────────────────────────────────
  loadBackupConfig() {
    this.ds.getBackupConfig().subscribe({ next: c => { this.backupCfg = c; this.loadBackupFiles(); }, error: () => {} });
  }
  private loadBackupFiles() {
    this.ds.listBackups().subscribe({ next: r => this.backupFiles = r.files, error: () => this.backupFiles = [] });
  }
  private saveBackup(patch: Partial<BackupConfig>) {
    this.ds.saveBackupConfig(patch).subscribe({ next: c => this.backupCfg = c, error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.errore'), '', { duration: 3000 }) });
  }

  async pickBackupFolder() {
    const dir = await this.desktop.pickFolder();
    if (dir) this.saveBackup({ dir });
  }
  openBackupFolder() { if (this.backupCfg?.dir) this.desktop.openPath(this.backupCfg.dir); }
  setBackupEnabled(v: boolean) { this.saveBackup({ enabled: v }); }
  setBackupEncrypt(v: boolean) { this.saveBackup({ encrypt: v }); }
  setBackupAlertDays(v: number) { if (Number.isFinite(v)) this.saveBackup({ alertDays: v }); }
  /** Riattiva gli avvisi di backup disattivati con "non mostrare più". */
  reenableBackupAlert() { this.saveBackup({ alertDisabled: false }); }
  /** Giorni di conservazione dei backup (0 = conservali tutti). */
  setBackupRetentionDays(v: number) {
    if (Number.isFinite(v)) this.saveBackup({ retentionDays: Math.max(0, Math.min(365, Math.round(v))) });
  }
  /** Elimina subito i backup più vecchi dei giorni di conservazione impostati. */
  async pruneOldBackups() {
    const days = this.backupCfg?.retentionDays || 0;
    if (!days) return;
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.eliminaBackupVecchi', { giorni: days }))) return;
    this.ds.pruneOldBackups().subscribe({
      next: r => {
        this.backupFiles = r.files;
        this.snack.open(r.removed ? this.i18n.t('impostazioni.msg.backupEliminati', { n: r.removed }) : this.i18n.t('impostazioni.msg.nessunBackupDaEliminare'), '', { duration: 3000 });
      },
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.operazioneNonRiuscita'), '', { duration: 4000 }),
    });
  }

  runBackupNow() {
    if (this.backupBusy) return;
    this.backupBusy = true;
    this.ds.runBackup().subscribe({
      next: c => { this.backupCfg = c; this.backupBusy = false; this.loadBackupFiles(); this.snack.open(this.i18n.t('impostazioni.msg.backupEseguito'), '', { duration: 2500 }); },
      error: e => { this.backupBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.backupNonRiuscito'), '', { duration: 4000 }); },
    });
  }

  async restoreBackup(name: string) {
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.ripristinareBackup', { nome: name }))) return;
    this.ds.restoreBackup(name).subscribe({
      next: () => { this.snack.open(this.i18n.t('impostazioni.msg.ripristinoCompletato'), '', { duration: 2500 }); setTimeout(() => location.reload(), 1200); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.ripristinoNonRiuscito'), '', { duration: 5000 }),
    });
  }

  /** Ripristina da un file scelto dall'utente (anche fuori dalla cartella di backup). */
  async restoreBackupFromFile() {
    const filePath = await this.desktop.pickBackupFile();
    if (!filePath) return;
    const nome = filePath.split(/[\\/]/).pop() || filePath;
    // Se il file è cifrato (.enc) chiedo la password usata per crearlo.
    const password = /\.enc$/i.test(filePath)
      ? (await this.confirm.prompt({ message: this.i18n.t('impostazioni.msg.backupCifratoPassword'), label: this.i18n.t('impostazioni.msg.passwordLabel'), password: true }) || '')
      : undefined;
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.ripristinareDaFile', { nome }))) return;
    this.ds.restoreBackupFromFile(filePath, password).subscribe({
      next: () => { this.snack.open(this.i18n.t('impostazioni.msg.ripristinoCompletato'), '', { duration: 2500 }); setTimeout(() => location.reload(), 1200); },
      error: e => this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.ripristinoNonRiuscito'), '', { duration: 5000 }),
    });
  }

  fmtBytes(n: number): string {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  }

  // ── Dati e sincronizzazione (offline) ───────────────────────────────────────
  loadSistemaPercorsi() {
    this.ds.getSistemaPercorsi().subscribe({
      next: r => { this.dataDir = r.dataDir; this.dataFiles = r.files; },
      error: () => {},
    });
    this.desktop.isAutostart().then(v => this.autostart = v);
    this.loadSnapshots();
    this.ds.getCifratura().subscribe({ next: c => { this.cifraturaAttiva = c.attiva; this.cifraturaPasswordImpostata = c.passwordImpostata; }, error: () => {} });
  }

  /** Attiva/disattiva la cifratura del database a riposo. */
  async toggleCifratura(on: boolean) {
    if (this.cifraturaBusy) return;
    if (on) {
      if (!this.cifraturaPasswordImpostata) {
        this.snack.open(this.i18n.t('impostazioni.msg.impostaPwPrima'), '', { duration: 4000 });
        return;
      }
      const pw = await this.confirm.prompt({
        message: this.i18n.t('impostazioni.msg.confermaPwPrompt'),
        label: this.i18n.t('impostazioni.msg.passwordLabel'), password: true,
      });
      if (!pw) return;
      this.cifraturaBusy = true;
      this.ds.setCifratura(true, pw).subscribe({
        next: r => { this.cifraturaBusy = false; this.cifraturaAttiva = r.attiva; this.snack.open(this.i18n.t('impostazioni.msg.cifraturaAttivata'), '', { duration: 4000 }); },
        error: e => { this.cifraturaBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.errore'), '', { duration: 4000 }); },
      });
    } else {
      if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.disattivareCifratura'))) return;
      this.cifraturaBusy = true;
      this.ds.setCifratura(false).subscribe({
        next: r => { this.cifraturaBusy = false; this.cifraturaAttiva = r.attiva; this.snack.open(this.i18n.t('impostazioni.msg.cifraturaDisattivata'), '', { duration: 3000 }); },
        error: e => { this.cifraturaBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.errore'), '', { duration: 4000 }); },
      });
    }
  }

  loadSnapshots() {
    this.ds.getSnapshots().subscribe({
      next: r => this.snapshots = r.snapshots,
      error: () => this.snapshots = [],
    });
  }

  /** Crea ora uno snapshot (punto di ripristino) dei dati. */
  createSnapshot() {
    if (this.snapBusy) return;
    this.snapBusy = true;
    this.ds.createSnapshot().subscribe({
      next: () => { this.snapBusy = false; this.loadSnapshots(); this.snack.open(this.i18n.t('impostazioni.msg.snapshotCreato'), '', { duration: 2000 }); },
      error: e => { this.snapBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.snapshotNonRiuscito'), '', { duration: 4000 }); },
    });
  }

  /** Ripristina i dati da uno snapshot (con copia di sicurezza dell'attuale). */
  async restoreSnapshot(s: { name: string; mtime: string }) {
    const quando = new Date(s.mtime).toLocaleString('it-IT');
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.riportareSnapshot', { quando }))) return;
    this.snapBusy = true;
    this.ds.restoreSnapshot(s.name).subscribe({
      next: () => { this.snack.open(this.i18n.t('impostazioni.msg.ripristinoCompletato'), '', { duration: 2500 }); setTimeout(() => location.reload(), 1200); },
      error: e => { this.snapBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.ripristinoNonRiuscito'), '', { duration: 5000 }); },
    });
  }

  /** Abilita/disabilita l'avvio di Ordeva all'accensione del computer. */
  async setAutostart(on: boolean) {
    await this.desktop.setAutostart(on);
    this.autostart = await this.desktop.isAutostart();
  }

  /** Apre la cartella dati nel file manager del sistema. */
  openDataFolder() { if (this.dataDir) this.desktop.openPath(this.dataDir); }

  /** Sposta i dati in un'altra cartella (es. dentro Dropbox) e riavvia l'app. */
  async changeDataFolder() {
    const dir = await this.desktop.pickFolder();
    if (!dir) return;
    if (!await this.confirm.delete(this.i18n.t('impostazioni.msg.spostareCartella', { dir }))) return;
    this.dataBusy = true;
    this.ds.setSistemaDataDir(dir).subscribe({
      next: () => { this.snack.open(this.i18n.t('impostazioni.msg.cartellaAggiornata'), '', { duration: 2500 }); setTimeout(() => this.desktop.relaunch(), 1200); },
      error: e => { this.dataBusy = false; this.snack.open(e.error?.error || this.i18n.t('impostazioni.msg.spostamentoNonRiuscito'), '', { duration: 5000 }); },
    });
  }

  /** Chiusura sicura: checkpoint + rilascio lock, poi chiude (così Dropbox sincronizza). */
  async chiudiSicuro() {
    if (this.dataBusy) return;
    this.dataBusy = true;
    this.ds.sistemaFlush().subscribe({
      next: () => this.desktop.exit(0),
      error: () => this.desktop.exit(0),
    });
  }
}
