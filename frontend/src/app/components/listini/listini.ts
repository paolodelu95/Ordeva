import { inject, Component, OnInit, Inject } from '@angular/core';
import { I18nService } from '../../services/i18n.service';
import { PrezzoFormatService } from '../../services/prezzo-format.service';
import { TPipe } from '../../pipes/t.pipe';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin, of } from 'rxjs';
import { EmptyStateComponent } from '../shared/empty-state';
import { ConfirmService } from '../shared/confirm-dialog';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { ViewChild } from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { Listino, ListinoAlign, ListinoCellaStile, ListinoColonnaCfg,
         ListinoPrezzo, ListinoSezione, ListinoTema, Prodotto,
         LISTINO_STD_KEYS, LISTINI_TEMI, mergeColonneCfg } from '../../models';
import { QuickListinoDialogComponent } from './quick-listino-dialog';

/** Riga del listino nell'editor: prodotto oppure sezione (divisore). */
export interface RigaListino {
  tipo: 'sezione' | 'prezzo';
  sezione?: ListinoSezione;
  prezzo?: ListinoPrezzo;
  /** Numero progressivo del prodotto (solo tipo 'prezzo'). */
  num?: number;
}

// ── Nuovo listino (anagrafica minima, poi si apre l'editor) ──────────────────
@Component({
  selector: 'app-nuovo-listino-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
            MatInputModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'listini.nuovoListino' | t }}</h2>
    <mat-dialog-content style="min-width:420px">
      <div class="dialog-form" style="padding-top:8px">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'listini.nuovoDialog.nome' | t }}</mat-label>
          <input matInput [(ngModel)]="nome" autofocus [placeholder]="'listini.nuovoDialog.nomePh' | t"
                 (keyup.enter)="crea()">
        </mat-form-field>
        <mat-form-field style="width:100%">
          <mat-label>{{ 'listini.nuovoDialog.descrizione' | t }}</mat-label>
          <textarea matInput rows="2" [(ngModel)]="descrizione"
                    [placeholder]="'listini.nuovoDialog.descrizionePh' | t"></textarea>
        </mat-form-field>
        <mat-form-field style="max-width:200px">
          <mat-label>{{ 'listini.nuovoDialog.scontoDefault' | t }}</mat-label>
          <input matInput type="number" step="0.5" min="0" max="100" [(ngModel)]="scontoDefault">
          <mat-icon matSuffix>percent</mat-icon>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="crea()" [disabled]="!nome.trim()">
        <mat-icon>arrow_forward</mat-icon> {{ 'listini.nuovoDialog.creaEApri' | t }}
      </button>
    </mat-dialog-actions>`,
})
export class NuovoListinoDialogComponent {
  nome = '';
  descrizione = '';
  scontoDefault: number | null = null;
  constructor(public dialogRef: MatDialogRef<NuovoListinoDialogComponent>) {}
  crea() {
    if (!this.nome.trim()) return;
    this.dialogRef.close({
      nome: this.nome.trim(), descrizione: this.descrizione,
      scontoDefault: this.scontoDefault || 0, attivo: true,
    } as Listino);
  }
}

// ── Gestione colonne: lista unica (standard + personalizzate), tutte
//    riordinabili col drag, rinominabili e disattivabili ──────────────────────
@Component({
  selector: 'app-colonne-listino-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
            MatInputModule, MatButtonModule, MatIconModule, MatCheckboxModule,
            MatTooltipModule, DragDropModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'listini.colDialog.title' | t }}</h2>
    <mat-dialog-content style="min-width:560px">
      <p class="col-help">
        {{ 'listini.colDialog.help' | t }}
      </p>

      <div cdkDropList (cdkDropListDropped)="riordina($event)">
        @for (c of colonne; track c.key) {
          <div class="col-row" cdkDrag>
            <mat-icon cdkDragHandle class="col-drag" [matTooltip]="'listini.tooltip.trascinaRiordinare' | t">drag_indicator</mat-icon>
            <mat-checkbox [(ngModel)]="c.visibile"></mat-checkbox>
            <input class="col-input" [(ngModel)]="c.label" [placeholder]="placeholderDi(c)"
                   [disabled]="!c.visibile">
            <span class="fmt-group">
              <button type="button" class="fmt-btn" [class.on]="c.bold" [disabled]="!c.visibile"
                      (click)="c.bold = !c.bold" [matTooltip]="'listini.colDialog.grassettoTooltip' | t">
                <mat-icon>format_bold</mat-icon>
              </button>
              <button type="button" class="fmt-btn" [class.on]="c.italic" [disabled]="!c.visibile"
                      (click)="c.italic = !c.italic" [matTooltip]="'listini.colDialog.corsivoTooltip' | t">
                <mat-icon>format_italic</mat-icon>
              </button>
              <button type="button" class="fmt-btn" [class.on]="!!c.align" [disabled]="!c.visibile"
                      (click)="cycleAlign(c)" [matTooltip]="i18n.t('listini.colDialog.allineamento', { label: alignLabel(c) })">
                <mat-icon>{{ alignIcon(c) }}</mat-icon>
              </button>
            </span>
            @if (c.tipo === 'std') {
              <span class="col-key" [matTooltip]="i18n.t('listini.colDialog.colonnaStandard', { label: placeholderDi(c) })">{{ placeholderDi(c) }}</span>
            } @else {
              <span class="col-badge">{{ 'listini.colDialog.personalizzata' | t }}</span>
              <button mat-icon-button type="button" (click)="rimuovi(c)" [matTooltip]="'listini.colDialog.eliminaColonnaTooltip' | t">
                <mat-icon style="color:#dc2626;font-size:18px">delete</mat-icon>
              </button>
            }
          </div>
        }
      </div>

      <div class="col-add">
        <input class="col-input" [(ngModel)]="nuova" [placeholder]="'listini.colDialog.nuovaColonnaPh' | t"
               (keyup.enter)="aggiungi()">
        <button mat-stroked-button color="primary" type="button" (click)="aggiungi()" [disabled]="!nuova.trim()">
          <mat-icon>add</mat-icon> {{ 'listini.colDialog.aggiungi' | t }}
        </button>
      </div>

      <div class="col-suggerimenti">
        <span style="font-size:12px;color:var(--text-tertiary)">{{ 'listini.colDialog.suggerimenti' | t }}</span>
        @for (s of suggerimenti; track s.key) {
          @if (!esiste(i18n.t(s.key))) {
            <button type="button" class="col-chip" (click)="aggiungiNome(i18n.t(s.key))">+ {{ s.key | t }}</button>
          }
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="salva()" [disabled]="!almenoUnaVisibile">{{ 'listini.colDialog.salvaColonne' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .col-help { margin: 4px 0 12px; font-size: 12.5px; color: var(--text-tertiary); }
    .col-key { font-size: 11px; color: var(--text-tertiary); min-width: 86px; text-align: right; }
    .col-badge {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
      color: var(--primary); background: var(--bg-surface-2); border-radius: 99px;
      padding: 2px 8px; white-space: nowrap;
    }
    .col-row {
      display: flex; align-items: center; gap: 8px; padding: 4px 0;
      background: var(--bg-surface);
    }
    .col-drag { color: var(--text-tertiary); cursor: grab; font-size: 20px; flex-shrink: 0; }
    .col-input {
      flex: 1; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px;
      font-size: 13px; background: var(--bg-surface); color: var(--text-primary); min-width: 0;
    }
    .col-input:focus { outline: none; border-color: var(--primary); box-shadow: var(--shadow-focus); }
    .col-input:disabled { color: var(--text-tertiary); background: var(--bg-surface-2); }
    .fmt-group { display: inline-flex; gap: 2px; flex-shrink: 0; }
    .fmt-btn {
      border: 1px solid var(--border); background: var(--bg-surface); border-radius: 6px;
      width: 28px; height: 28px; padding: 0; cursor: pointer; line-height: 0;
      color: var(--text-tertiary); display: inline-flex; align-items: center; justify-content: center;
      mat-icon { font-size: 17px; width: 17px; height: 17px; }
    }
    .fmt-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
    .fmt-btn.on { background: var(--primary); border-color: var(--primary); color: #fff; }
    // Hover su pulsante attivo: resta bianco su blu (senza questa regola l'icona
    // erediterebbe il colore primary dell'hover generico e sparirebbe sul fondo blu)
    .fmt-btn.on:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); color: #fff; }
    .fmt-btn:disabled { opacity: 0.4; cursor: default; }
    .col-add { display: flex; gap: 8px; margin-top: 14px; align-items: center; }
    .col-suggerimenti { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    .col-chip {
      border: 1px dashed var(--border); background: transparent; border-radius: 99px;
      padding: 3px 10px; font-size: 12px; color: var(--text-secondary); cursor: pointer;
    }
    .col-chip:hover { border-color: var(--primary); color: var(--primary); }
    .cdk-drag-preview.col-row { box-shadow: 0 4px 14px rgba(0,0,0,0.18); border-radius: 8px; padding: 4px 8px; }
    .cdk-drag-placeholder { opacity: 0.3; }
  `],
})
export class ColonneListinoDialogComponent {
  i18n = inject(I18nService);
  colonne: ListinoColonnaCfg[] = [];
  nuova = '';
  // Dimensioni e Peso non sono qui: sono colonne standard (dalla scheda prodotto).
  readonly suggerimenti = [
    { key: 'listini.colDialog.suggerimento.qtaPallet' },
    { key: 'listini.colDialog.suggerimento.qtaCartone' },
    { key: 'listini.colDialog.suggerimento.confezione' },
    { key: 'listini.colDialog.suggerimento.colore' },
    { key: 'listini.colDialog.suggerimento.materiale' },
    { key: 'listini.colDialog.suggerimento.note' },
  ];

  constructor(
    public dialogRef: MatDialogRef<ColonneListinoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: ListinoColonnaCfg[] | null,
  ) {
    this.colonne = (data?.length ? data : mergeColonneCfg()).map(c => ({ ...c }));
  }

  get almenoUnaVisibile(): boolean { return this.colonne.some(c => c.visibile); }

  private static readonly STD_KEY_I18N: Record<string, string> = {
    num: 'listini.colStd.num', codice: 'listini.colStd.codice', prodotto: 'listini.colStd.prodotto',
    dimensioni: 'listini.colStd.dimensioni', peso: 'listini.colStd.peso',
    prezzoBase: 'listini.colStd.prezzoBase', sconto: 'listini.colStd.sconto', prezzo: 'listini.colStd.prezzo',
  };

  placeholderDi(c: ListinoColonnaCfg): string {
    return c.tipo === 'std'
      ? this.i18n.t(ColonneListinoDialogComponent.STD_KEY_I18N[c.key] || c.key)
      : c.label || 'Colonna';
  }

  /** Allineamento a rotazione: automatico → sinistra → centro → destra. */
  cycleAlign(c: ListinoColonnaCfg) {
    const next: Record<string, ListinoAlign | undefined> =
      { undefined: 'left', left: 'center', center: 'right', right: undefined } as any;
    const nuovo = next[String(c.align)];
    if (nuovo) c.align = nuovo; else delete c.align;
  }

  alignIcon(c: ListinoColonnaCfg): string {
    switch (c.align) {
      case 'left': return 'format_align_left';
      case 'center': return 'format_align_center';
      case 'right': return 'format_align_right';
      default: return 'format_align_justify';
    }
  }

  alignLabel(c: ListinoColonnaCfg): string {
    switch (c.align) {
      case 'left': return this.i18n.t('listini.colDialog.align.sinistra');
      case 'center': return this.i18n.t('listini.colDialog.align.centro');
      case 'right': return this.i18n.t('listini.colDialog.align.destra');
      default: return this.i18n.t('listini.colDialog.align.automatico');
    }
  }

  esiste(label: string): boolean {
    return this.colonne.some(c => c.label.toLowerCase() === label.toLowerCase());
  }

  private slug(label: string): string {
    const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
    let key = base, i = 2;
    // Evita collisioni sia con le colonne esistenti che con le chiavi standard riservate
    while (this.colonne.some(c => c.key === key) || (LISTINO_STD_KEYS as string[]).includes(key)) {
      key = `${base}_${i++}`;
    }
    return key;
  }

  aggiungi() { this.aggiungiNome(this.nuova); this.nuova = ''; }

  aggiungiNome(label: string) {
    const l = label.trim();
    if (!l || this.esiste(l) || this.colonne.length >= 18) return;
    this.colonne.push({ key: this.slug(l), label: l, visibile: true, tipo: 'extra' });
  }

  rimuovi(c: ListinoColonnaCfg) {
    if (c.tipo !== 'extra') return;
    this.colonne = this.colonne.filter(x => x !== c);
  }

  riordina(e: CdkDragDrop<ListinoColonnaCfg[]>) {
    moveItemInArray(this.colonne, e.previousIndex, e.currentIndex);
  }

  salva() {
    if (!this.almenoUnaVisibile) return;
    this.dialogRef.close(this.colonne.map(c => ({
      ...c,
      label: c.label.trim() || this.placeholderDi(c),
    })));
  }
}

// ── Multi-picker prodotti (flag rapidi + filtro per categoria) ───────────────
@Component({
  selector: 'app-selezione-prodotti-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
            MatSelectModule, MatButtonModule, MatIconModule, MatCheckboxModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'listini.selDialog.title' | t }}</h2>
    <mat-dialog-content class="sp-content">
      <div class="sp-filters">
        <mat-form-field style="flex:2" subscriptSizing="dynamic">
          <mat-label>{{ 'listini.selDialog.cerca' | t }}</mat-label>
          <input matInput [(ngModel)]="query" (ngModelChange)="filtra()" autofocus>
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>
        <mat-form-field style="flex:1;min-width:170px" subscriptSizing="dynamic">
          <mat-label>{{ 'listini.selDialog.categoria' | t }}</mat-label>
          <mat-select [(ngModel)]="categoria" (selectionChange)="filtra()">
            <mat-option [value]="''">{{ 'listini.selDialog.tutteCategorie' | t }}</mat-option>
            @for (c of categorie; track c) {
              <mat-option [value]="c">{{ c }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <div class="sp-toolbar">
        <mat-checkbox [checked]="tuttiFiltratiSelezionati()"
                      [indeterminate]="alcuniFiltratiSelezionati()"
                      (change)="toggleTutti($event.checked)">
          {{ i18n.t('listini.selDialog.selezionaTutti', { n: filtrati.length }) }}
        </mat-checkbox>
        <span class="totals-spacer" style="flex:1"></span>
        <span class="sp-count" [class.has-sel]="selezione.size">{{ i18n.t('listini.selDialog.selezionatiCount', { n: selezione.size }) }}</span>
      </div>

      <div class="sp-list">
        @for (p of filtrati; track p.id) {
          <div class="sp-row" (click)="toggle(p)">
            <mat-checkbox [checked]="selezione.has(p.id!)" (click)="$event.preventDefault()"></mat-checkbox>
            <span class="sp-code">{{ p.codice || '—' }}</span>
            <span class="sp-nome">{{ p.nome }}</span>
            <span class="sp-cat">{{ p.categoria }}</span>
            <span class="sp-price">{{ p.prezzo | currency:'EUR':'symbol':prezzoFmt.digitsInfo():'it' }}</span>
          </div>
        }
        @if (!filtrati.length) {
          <p class="sp-empty">{{ 'listini.selDialog.nessunProdotto' | t }}{{ esistenti.size ? ('listini.selDialog.giaNelListino' | t) : '' }}.</p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="!selezione.size" (click)="conferma()">
        <mat-icon>playlist_add</mat-icon> {{ i18n.t('listini.selDialog.aggiungiBtn', { n: selezione.size || '' }) }}
      </button>
    </mat-dialog-actions>`,
  styles: [`
    .sp-content { width: 720px; max-width: 100%; }
    .sp-filters { display: flex; gap: 12px; flex-wrap: wrap; padding-top: 6px; }
    .sp-toolbar { display: flex; align-items: center; margin: 8px 0 6px; }
    .sp-count { font-size: 13px; color: var(--text-tertiary); }
    .sp-count.has-sel { color: var(--primary); font-weight: 700; }
    .sp-list { border: 1px solid var(--border); border-radius: var(--radius-md); max-height: 46vh; overflow-y: auto; }
    .sp-row {
      display: flex; align-items: center; gap: 10px; padding: 6px 10px; cursor: pointer;
      border-bottom: 1px solid var(--border-subtle);
    }
    .sp-row:hover { background: var(--bg-surface-2); }
    .sp-code { font-family: monospace; font-size: 12px; color: #0e6480; min-width: 84px; }
    .sp-nome { flex: 1; font-weight: 500; font-size: 13px; }
    .sp-cat { color: var(--text-tertiary); font-size: 12px; min-width: 90px; }
    .sp-price { color: #059669; font-weight: 600; font-size: 13px; min-width: 80px; text-align: right;
                font-variant-numeric: tabular-nums; }
    .sp-empty { text-align: center; color: var(--text-tertiary); padding: 22px; font-size: 13px; margin: 0; }
    @media (max-width: 767px) {
      .sp-content { width: 100%; }
      /* Filtri impilati: la ricerca prende tutta la larghezza (niente
         collisione tra placeholder e icona) e la categoria va sotto. */
      .sp-filters { flex-direction: column; gap: 4px; }
      .sp-filters mat-form-field { width: 100%; flex: none; min-width: 0; }
      /* Il touch-target della checkbox sborda di pochi px: niente scroll oriz. */
      .sp-list { overflow-x: hidden; }
      /* Riga prodotto compatta: codice e prezzo essenziali, categoria nascosta,
         nome che si tronca. Evita overflow e prezzo tagliato. */
      .sp-row { gap: 8px; }
      .sp-cat { display: none; }
      .sp-code { min-width: 0; flex: 0 0 auto; }
      .sp-nome { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sp-price { min-width: 0; flex: 0 0 auto; }
    }
  `],
})
export class SelezioneProdottiDialogComponent implements OnInit {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  prodotti: Prodotto[] = [];
  filtrati: Prodotto[] = [];
  categorie: string[] = [];
  esistenti = new Set<number>();
  selezione = new Set<number>();
  query = '';
  categoria = '';

  constructor(
    private ds: DataService,
    public dialogRef: MatDialogRef<SelezioneProdottiDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: { esistenti?: number[] } | null,
  ) {
    this.esistenti = new Set(data?.esistenti || []);
  }

  ngOnInit() {
    this.ds.getProdotti().subscribe(p => {
      this.prodotti = p.filter(x => !this.esistenti.has(x.id!));
      this.categorie = [...new Set(this.prodotti.map(x => x.categoria).filter(Boolean))].sort();
      this.filtra();
    });
  }

  filtra() {
    const tokens = this.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    this.filtrati = this.prodotti
      .filter(p => !this.categoria || p.categoria === this.categoria)
      .filter(p => {
        if (!tokens.length) return true;
        const hay = `${p.codice ?? ''} ${p.nome ?? ''} ${p.categoria ?? ''}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
      });
  }

  toggle(p: Prodotto) {
    if (this.selezione.has(p.id!)) this.selezione.delete(p.id!);
    else this.selezione.add(p.id!);
  }

  tuttiFiltratiSelezionati(): boolean {
    return this.filtrati.length > 0 && this.filtrati.every(p => this.selezione.has(p.id!));
  }
  alcuniFiltratiSelezionati(): boolean {
    return !this.tuttiFiltratiSelezionati() && this.filtrati.some(p => this.selezione.has(p.id!));
  }
  toggleTutti(checked: boolean) {
    for (const p of this.filtrati) {
      if (checked) this.selezione.add(p.id!);
      else this.selezione.delete(p.id!);
    }
  }

  conferma() { this.dialogRef.close([...this.selezione]); }
}

// ── Pagina Listini (Vendite → Listini): elenco + editor ─────────────────────
@Component({
  selector: 'app-listini',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatMenuModule,
            MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule,
            MatTooltipModule, MatDialogModule, MatDividerModule, MatSnackBarModule,
            DragDropModule, EmptyStateComponent, TPipe],
  templateUrl: './listini.html',
  styleUrl: './listini.scss',
})
export class ListiniComponent implements OnInit {
  i18n = inject(I18nService);
  prezzoFmt = inject(PrezzoFormatService);
  private confirm = inject(ConfirmService);

  // ── elenco ──
  listini: Listino[] = [];

  // ── editor ──
  sel: Listino | null = null;
  prezzi: ListinoPrezzo[] = [];
  sezioni: ListinoSezione[] = [];
  /** Sequenza visuale: prodotti e sezioni interleavati per ordine. */
  righe: RigaListino[] = [];
  filtro = '';
  scontoBulk: number | null = null;
  prodotti: Prodotto[] = [];
  readonly temi = LISTINI_TEMI;
  private anagraficaSnapshot = '';

  // ── menu contestuale stile cella (tasto destro) ──
  @ViewChild('ctxTrigger') ctxTrigger?: MatMenuTrigger;
  ctxX = 0;
  ctxY = 0;
  ctxCell: { p: ListinoPrezzo; key: string } | null = null;

  constructor(
    private ds: DataService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private printSvc: PrintService,
  ) {}

  ngOnInit() { this.loadListini(); }

  loadListini() { this.ds.getListini().subscribe(l => this.listini = l); }

  /** Colonne personalizzate di un listino (per i chip nell'elenco). */
  colonneExtraDi(l: Listino): ListinoColonnaCfg[] {
    return mergeColonneCfg(l).filter(c => c.tipo === 'extra' && c.visibile);
  }

  // ── Elenco: creazione / apertura / eliminazione ────────────────────────────

  nuovoListino() {
    this.dialog.open(NuovoListinoDialogComponent, { width: '480px', maxWidth: '96vw' })
      .afterClosed().subscribe((l: Listino | undefined) => {
        if (!l) return;
        this.ds.createListino(l).subscribe({
          next: (r: any) => { this.loadListini(); if (r?.id) this.apri(r.id); },
          error: (e) => this.snack.open(e.error?.error || this.i18n.t('listini.msg.erroreCreazione'), 'OK', { duration: 4000 }),
        });
      });
  }

  openQuickListino() {
    this.dialog.open(QuickListinoDialogComponent, { width: '860px', maxWidth: '96vw' })
      .afterClosed().subscribe((id) => {
        this.loadListini();
        if (typeof id === 'number') this.apri(id);
      });
  }

  apri(id: number) {
    forkJoin({
      listino: this.ds.getListino(id),
      prezzi: this.ds.getListinoPrezzi(id),
      sezioni: this.ds.getListinoSezioni(id),
    }).subscribe(({ listino, prezzi, sezioni }) => {
      this.sel = {
        ...listino,
        colonneConfig: mergeColonneCfg(listino),
        stampaDueColonne: !!listino.stampaDueColonne,
        griglia: !!listino.griglia,
        tema: listino.tema || '',
      };
      this.prezzi = prezzi;
      this.sezioni = sezioni;
      this.filtro = '';
      this.scontoBulk = null;
      this.rebuildRighe();
      this.anagraficaSnapshot = this.snapshot();
      if (!this.prodotti.length) this.ds.getProdotti().subscribe(p => this.prodotti = p);
    });
  }

  chiudiEditor() {
    this.sel = null;
    this.prezzi = [];
    this.sezioni = [];
    this.righe = [];
    this.loadListini();
  }

  async deleteListino(l: Listino) {
    if (!await this.confirm.delete(this.i18n.t('listini.msg.confermaElimina', { nome: l.nome }))) return;
    this.ds.deleteListino(l.id!).subscribe({
      next: () => {
        if (this.sel?.id === l.id) this.chiudiEditor();
        this.loadListini();
        this.snack.open(this.i18n.t('listini.msg.eliminato'), '', { duration: 2000 });
      },
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreEliminazione'), '', { duration: 3000 }),
    });
  }

  // ── Editor: anagrafica (salvataggio automatico su blur/toggle) ─────────────

  private snapshot(): string {
    const s = this.sel!;
    return JSON.stringify([s.nome, s.descrizione, s.scontoDefault, s.attivo,
                           s.colonneConfig, s.stampaDueColonne, s.griglia, s.tema]);
  }

  salvaAnagrafica() {
    if (!this.sel?.id || !this.sel.nome?.trim()) return;
    if (this.snapshot() === this.anagraficaSnapshot) return;
    this.ds.updateListino(this.sel).subscribe({
      next: () => { this.anagraficaSnapshot = this.snapshot(); },
      error: (e) => this.snack.open(e.error?.error || this.i18n.t('listini.msg.erroreSalvataggio'), 'OK', { duration: 4000 }),
    });
  }

  // ── Editor: colonne ─────────────────────────────────────────────────────────

  get colonneVisibili(): ListinoColonnaCfg[] {
    return (this.sel?.colonneConfig || []).filter(c => c.visibile);
  }

  /** Tipo di cella da renderizzare per una colonna. */
  cellType(c: ListinoColonnaCfg): string {
    return c.tipo === 'extra' ? 'extra' : c.key;
  }

  gestisciColonne() {
    this.dialog.open(ColonneListinoDialogComponent, {
      data: this.sel!.colonneConfig || [],
      width: '620px', maxWidth: '96vw',
    }).afterClosed().subscribe((cols: ListinoColonnaCfg[] | undefined) => {
      if (!cols) return;
      this.sel!.colonneConfig = cols;
      this.salvaAnagrafica();
    });
  }

  // ── Editor: aggiunta prodotti e sezioni ─────────────────────────────────────

  apriPicker() {
    this.dialog.open(SelezioneProdottiDialogComponent, {
      data: { esistenti: this.prezzi.map(p => p.prodottoId) },
      width: '760px', maxWidth: '96vw',
    }).afterClosed().subscribe((ids: number[] | undefined) => {
      if (ids?.length) this.bulkAdd(ids);
    });
  }

  get categorieDisponibili(): { nome: string; count: number }[] {
    const inListino = new Set(this.prezzi.map(p => p.prodottoId));
    const map = new Map<string, number>();
    for (const p of this.prodotti) {
      if (!p.categoria || inListino.has(p.id!)) continue;
      map.set(p.categoria, (map.get(p.categoria) || 0) + 1);
    }
    return [...map.entries()].map(([nome, count]) => ({ nome, count }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }

  aggiungiCategoria(categoria: string) {
    const inListino = new Set(this.prezzi.map(p => p.prodottoId));
    const ids = this.prodotti
      .filter(p => p.categoria === categoria && !inListino.has(p.id!))
      .map(p => p.id!);
    if (ids.length) this.bulkAdd(ids);
  }

  private bulkAdd(ids: number[]) {
    this.ds.bulkAddListinoPrezzi(this.sel!.id!, ids).subscribe({
      next: (r) => {
        this.reloadRighe();
        this.snack.open(this.i18n.t('listini.msg.prodottiAggiunti', { n: r.aggiunti }), '', { duration: 2500 });
      },
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreAggiuntaProdotti'), '', { duration: 3000 }),
    });
  }

  aggiungiSezione() {
    this.ds.createListinoSezione(this.sel!.id!, this.i18n.t('listini.nuovaSezione')).subscribe({
      next: () => this.reloadRighe(),
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreCreazioneSezione'), '', { duration: 3000 }),
    });
  }

  /** Crea automaticamente le sezioni dalle categorie dei prodotti già nel listino
   *  e riordina le righe raggruppandole; le sezioni omonime esistenti vengono riusate. */
  async sezioniDaCategorie() {
    const cats: string[] = [];
    for (const p of this.prezzi) {
      const c = (p.prodottoCategoria || '').trim();
      if (c && !cats.includes(c)) cats.push(c);
    }
    if (!cats.length) {
      this.snack.open(this.i18n.t('listini.msg.noCategorieProdotti'), '', { duration: 3000 });
      return;
    }
    if (!await this.confirm.ask(this.i18n.t('listini.msg.confermaSezioniDaCategorie', { n: cats.length }))) return;

    const daCreare = cats.filter(c => !this.sezioni.some(s => s.nome.toLowerCase() === c.toLowerCase()));
    const creazioni = daCreare.length
      ? forkJoin(daCreare.map(c => this.ds.createListinoSezione(this.sel!.id!, c)))
      : of([]);
    creazioni.subscribe({
      next: () => {
        this.ds.getListinoSezioni(this.sel!.id!).subscribe(sezioni => {
          this.sezioni = sezioni;
          const items: { tipo: 'sezione' | 'prezzo'; id: number }[] = [];
          // Prodotti senza categoria in testa (prima di ogni sezione)
          for (const p of this.prezzi) {
            if (!(p.prodottoCategoria || '').trim()) items.push({ tipo: 'prezzo', id: p.id! });
          }
          const usate = new Set<number>();
          for (const cat of cats) {
            const sez = sezioni.find(s => s.nome.toLowerCase() === cat.toLowerCase());
            if (sez) { items.push({ tipo: 'sezione', id: sez.id! }); usate.add(sez.id!); }
            for (const p of this.prezzi) {
              if ((p.prodottoCategoria || '').trim().toLowerCase() === cat.toLowerCase()) {
                items.push({ tipo: 'prezzo', id: p.id! });
              }
            }
          }
          // Eventuali sezioni preesistenti non legate a categorie: in coda
          for (const s of sezioni) {
            if (!usate.has(s.id!)) items.push({ tipo: 'sezione', id: s.id! });
          }
          this.ds.riordinaListino(this.sel!.id!, items).subscribe({
            next: () => { this.reloadRighe(); this.snack.open(this.i18n.t('listini.msg.prodottiRaggruppati'), '', { duration: 2500 }); },
            error: () => { this.snack.open(this.i18n.t('listini.msg.erroreRiordino'), '', { duration: 3000 }); this.reloadRighe(); },
          });
        });
      },
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreCreazioneSezioni'), '', { duration: 3000 }),
    });
  }

  updateSezione(s: ListinoSezione, e: Event) {
    const v = (e.target as HTMLInputElement).value.trim();
    if (!v || v === s.nome) return;
    s.nome = v;
    this.ds.updateListinoSezione(this.sel!.id!, s.id!, v).subscribe({
      error: () => { this.snack.open(this.i18n.t('listini.msg.erroreRinominaSezione'), '', { duration: 3000 }); this.reloadRighe(); },
    });
  }

  deleteSezione(s: ListinoSezione) {
    this.ds.deleteListinoSezione(this.sel!.id!, s.id!).subscribe({
      next: () => {
        this.sezioni = this.sezioni.filter(x => x.id !== s.id);
        this.rebuildRighe();
      },
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreEliminazioneSezione'), '', { duration: 3000 }),
    });
  }

  // ── Editor: righe (merge, filtro, modifica inline, drag, rimozione) ─────────

  private reloadRighe() {
    forkJoin({
      prezzi: this.ds.getListinoPrezzi(this.sel!.id!),
      sezioni: this.ds.getListinoSezioni(this.sel!.id!),
    }).subscribe(({ prezzi, sezioni }) => {
      this.prezzi = prezzi;
      this.sezioni = sezioni;
      this.rebuildRighe();
    });
  }

  /** Ricostruisce la sequenza visuale (prodotti + sezioni per ordine condiviso). */
  private rebuildRighe() {
    const items: RigaListino[] = [
      ...this.sezioni.map(s => ({ tipo: 'sezione' as const, sezione: s })),
      ...this.prezzi.map(p => ({ tipo: 'prezzo' as const, prezzo: p })),
    ];
    items.sort((a, b) => {
      const oa = (a.tipo === 'sezione' ? a.sezione!.ordine : a.prezzo!.ordine) || 0;
      const ob = (b.tipo === 'sezione' ? b.sezione!.ordine : b.prezzo!.ordine) || 0;
      if (oa !== ob) return oa - ob;
      // ordine legacy a parità: sezioni prima, poi per id
      if (a.tipo !== b.tipo) return a.tipo === 'sezione' ? -1 : 1;
      const ia = (a.tipo === 'sezione' ? a.sezione!.id : a.prezzo!.id) || 0;
      const ib = (b.tipo === 'sezione' ? b.sezione!.id : b.prezzo!.id) || 0;
      return ia - ib;
    });
    let n = 0;
    for (const it of items) if (it.tipo === 'prezzo') it.num = ++n;
    this.righe = items;
  }

  get righeVisibili(): RigaListino[] {
    const tokens = this.filtro.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return this.righe;
    // Con filtro attivo si mostrano solo i prodotti corrispondenti (niente sezioni)
    return this.righe.filter(r => {
      if (r.tipo !== 'prezzo') return false;
      const p = r.prezzo!;
      const hay = `${p.prodottoCodice ?? ''} ${p.prodottoNome ?? ''} ${p.prodottoCategoria ?? ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  get prodottiCount(): number { return this.prezzi.length; }

  private upsertRiga(p: ListinoPrezzo, includeExtra = false, includeStili = false) {
    this.ds.upsertListinoPrezzo(this.sel!.id!, {
      prodottoId: p.prodottoId,
      prezzo: p.prezzo ?? null,
      sconto: p.sconto ?? null,
      ...(includeExtra ? { datiExtra: p.datiExtra || {} } : {}),
      ...(includeStili ? { stili: p.stili || {} } : {}),
    }).subscribe({
      error: () => { this.snack.open(this.i18n.t('listini.msg.erroreSalvataggioRiga'), '', { duration: 3000 }); this.reloadRighe(); },
    });
  }

  // ── Stili cella (menu tasto destro) e stili colonna ─────────────────────────

  apriMenuCella(e: MouseEvent, p: ListinoPrezzo, key: string) {
    e.preventDefault();
    this.ctxX = e.clientX;
    this.ctxY = e.clientY;
    this.ctxCell = { p, key };
    setTimeout(() => this.ctxTrigger?.openMenu());
  }

  stileCellaAttivo(flag: 'b' | 'i' | 's'): boolean {
    const c = this.ctxCell;
    return !!(c && c.p.stili?.[c.key]?.[flag]);
  }

  alignCellaAttivo(al: ListinoAlign): boolean {
    const c = this.ctxCell;
    return !!(c && c.p.stili?.[c.key]?.al === al);
  }

  toggleStileCella(flag: 'b' | 'i' | 's') {
    const c = this.ctxCell;
    if (!c) return;
    const st: ListinoCellaStile = { ...(c.p.stili?.[c.key] || {}) };
    if (st[flag]) delete st[flag]; else st[flag] = true;
    this.salvaStileCella(c, st);
  }

  setAlignCella(al: ListinoAlign | null) {
    const c = this.ctxCell;
    if (!c) return;
    const st: ListinoCellaStile = { ...(c.p.stili?.[c.key] || {}) };
    if (al && st.al !== al) st.al = al; else delete st.al;
    this.salvaStileCella(c, st);
  }

  clearStileCella() {
    const c = this.ctxCell;
    if (!c) return;
    this.salvaStileCella(c, {});
  }

  private salvaStileCella(c: { p: ListinoPrezzo; key: string }, st: ListinoCellaStile) {
    if (!c.p.stili) c.p.stili = {};
    if (Object.keys(st).length) c.p.stili[c.key] = st;
    else delete c.p.stili[c.key];
    this.upsertRiga(c.p, false, true);
  }

  /** Stile effettivo di una cella: colonna (grassetto/corsivo/allineamento) + override cella. */
  cellNgStyle(p: ListinoPrezzo, c: ListinoColonnaCfg): Record<string, string | null> {
    const st = p.stili?.[c.key] || {};
    return {
      'font-weight': (st.b || c.bold) ? '700' : null,
      'font-style': (st.i || c.italic) ? 'italic' : null,
      'text-decoration': st.s ? 'line-through' : null,
      'text-align': st.al || c.align || null,
    };
  }

  /** Allineamento dell'intestazione colonna (solo se configurato). */
  thAlign(c: ListinoColonnaCfg): string | null { return c.align || null; }

  /** Modifica diretta del prezzo finale: scrivere un valore lo fissa come prezzo
   *  manuale (override); svuotare la cella torna al calcolo da sconto. */
  updatePrezzoFinale(p: ListinoPrezzo, e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') {
      if (p.prezzo == null) return;
      p.prezzo = null;
      this.upsertRiga(p);
      return;
    }
    const n = +v;
    if (isNaN(n)) return;
    // Tab/blur senza modifiche: il valore calcolato non deve diventare un override
    if (p.prezzo == null && Math.abs(n - this.prezzoFinale(p)) < 0.005) return;
    if (p.prezzo != null && Math.abs(n - p.prezzo) < 0.005) return;
    p.prezzo = n;
    this.upsertRiga(p);
  }

  /** Toglie il prezzo manuale dalla riga (torna allo sconto). */
  rimuoviOverride(p: ListinoPrezzo) {
    if (p.prezzo == null) return;
    p.prezzo = null;
    this.upsertRiga(p);
  }

  updateSconto(p: ListinoPrezzo, e: Event) {
    const v = (e.target as HTMLInputElement).value;
    p.sconto = v === '' ? null : +v;
    this.upsertRiga(p);
  }

  updateExtra(p: ListinoPrezzo, key: string, e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (!p.datiExtra) p.datiExtra = {};
    if ((p.datiExtra[key] || '') === v) return;
    p.datiExtra[key] = v;
    this.upsertRiga(p, true);
  }

  removeRiga(p: ListinoPrezzo) {
    if (!p.id) return;
    this.ds.deleteListinoPrezzo(this.sel!.id!, p.id).subscribe(() => {
      this.prezzi = this.prezzi.filter(x => x.id !== p.id);
      this.rebuildRighe();
    });
  }

  async svuotaListino() {
    if (!this.prezzi.length && !this.sezioni.length) return;
    if (!await this.confirm.delete(this.i18n.t('listini.msg.confermaSvuota'))) return;
    const ops = [
      ...this.prezzi.map(p => this.ds.deleteListinoPrezzo(this.sel!.id!, p.id!)),
      ...this.sezioni.map(s => this.ds.deleteListinoSezione(this.sel!.id!, s.id!)),
    ];
    forkJoin(ops.length ? ops : [of(null)]).subscribe(() => {
      this.prezzi = []; this.sezioni = []; this.righe = [];
      this.snack.open(this.i18n.t('listini.msg.listinoSvuotato'), '', { duration: 2000 });
    });
  }

  dropRiga(e: CdkDragDrop<RigaListino[]>) {
    if (this.filtro) return; // con filtro attivo il riordino è disabilitato
    moveItemInArray(this.righe, e.previousIndex, e.currentIndex);
    // Allinea gli "ordine" locali e la numerazione alla nuova sequenza
    this.righe.forEach((r, i) => {
      if (r.tipo === 'sezione') r.sezione!.ordine = i + 1;
      else r.prezzo!.ordine = i + 1;
    });
    let n = 0;
    for (const r of this.righe) if (r.tipo === 'prezzo') r.num = ++n;
    const items = this.righe.map(r => ({
      tipo: r.tipo,
      id: (r.tipo === 'sezione' ? r.sezione!.id : r.prezzo!.id)!,
    }));
    this.ds.riordinaListino(this.sel!.id!, items).subscribe({
      error: () => this.snack.open(this.i18n.t('listini.msg.erroreSalvataggioOrdine'), '', { duration: 3000 }),
    });
  }

  applicaScontoBulk() {
    const s = this.scontoBulk;
    if (s == null || isNaN(+s) || !this.prezzi.length) return;
    const ops = this.prezzi.map(p => {
      p.sconto = +s; p.prezzo = null;
      return this.ds.upsertListinoPrezzo(this.sel!.id!, { prodottoId: p.prodottoId, prezzo: null, sconto: +s });
    });
    forkJoin(ops.length ? ops : [of(null)]).subscribe({
      next: () => this.snack.open(this.i18n.t('listini.msg.scontoApplicato', { s, n: ops.length }), '', { duration: 2500 }),
      error: () => { this.snack.open(this.i18n.t('listini.msg.erroreApplicazioneSconto'), '', { duration: 3000 }); this.reloadRighe(); },
    });
  }

  prezzoFinale(p: ListinoPrezzo): number {
    if (p.prezzo != null) return p.prezzo;
    const base = p.prodottoPrezzoBase || 0;
    const sconto = p.sconto != null ? p.sconto : (this.sel?.scontoDefault || 0);
    return +(base * (1 - sconto / 100)).toFixed(this.prezzoFmt.decimali());
  }

  /** Invio su una cella: passa alla stessa colonna della prossima riga prodotto
   *  (saltando le righe sezione, stile foglio di calcolo). */
  focusNext(e: Event, col: string) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const row = +(input.getAttribute('data-row') || 0);
    const candidates = Array.from(
      input.closest('table')?.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`) || []
    ).filter(x => +(x.getAttribute('data-row') || 0) > row)
     .sort((a, b) => +(a.getAttribute('data-row') || 0) - +(b.getAttribute('data-row') || 0));
    if (candidates[0]) { candidates[0].focus(); candidates[0].select(); }
  }

  /** Colore del pallino mostrato accanto al nome del tema nella select. */
  temaDot(t: ListinoTema): string {
    return `rgb(${t.accent[0]},${t.accent[1]},${t.accent[2]})`;
  }

  stampa() {
    if (!this.sel) return;
    this.printSvc.printListino(this.sel, this.prezzi, this.sezioni);
  }
}
