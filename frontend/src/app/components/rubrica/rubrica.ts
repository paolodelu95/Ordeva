import { Component, ElementRef, Inject, OnInit, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DataService } from '../../services/data.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { Cliente, ContattoRubrica, Fornitore, TipoContatto } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { ordinaPer } from '../../utils/ordina';
import { selezionabili } from '../../utils/anagrafiche';
import { focusPrimoInvalido } from '../../utils/focus-invalido';

/** Tipi di contatto, nell'ordine in cui si presentano. Combacia con TIPI in routes/rubrica.rs. */
const TIPI: TipoContatto[] = [
  'AMMINISTRAZIONE', 'CONTABILITA', 'COMMERCIALE', 'ACQUISTI',
  'MAGAZZINO', 'DIREZIONE', 'ASSISTENZA', 'ALTRO',
];

function etichettaTipo(i18n: I18nService, t?: string): string {
  return i18n.t('rubrica.tipo.' + (t || 'ALTRO').toLowerCase());
}

// ── Dialog nuovo/modifica contatto ──────────────────────────────────────────────
@Component({
  selector: 'app-contatto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ (c.id ? 'rubrica.dialog.modifica' : 'rubrica.dialog.nuovo') | t }}</h2>
    <mat-dialog-content class="rb-dialog">
      <div class="rb-row">
        <mat-form-field class="rb-grow">
          <mat-label>{{ 'rubrica.dialog.nome' | t }}</mat-label>
          <input matInput [(ngModel)]="c.nome" name="nome" required autocomplete="off" cdkFocusInitial>
        </mat-form-field>
        <mat-form-field class="rb-tipo">
          <mat-label>{{ 'rubrica.dialog.tipo' | t }}</mat-label>
          <mat-select [(ngModel)]="c.tipo" name="tipo">
            @for (t of tipi; track t) { <mat-option [value]="t">{{ etichetta(t) }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>

      <div class="rb-row">
        <mat-form-field class="rb-grow">
          <mat-label>{{ 'rubrica.dialog.telefono' | t }}</mat-label>
          <input matInput [(ngModel)]="c.telefono" name="telefono" type="tel" autocomplete="off">
        </mat-form-field>
        <mat-form-field class="rb-grow">
          <mat-label>{{ 'rubrica.dialog.email' | t }}</mat-label>
          <input matInput [(ngModel)]="c.email" name="email" type="email" autocomplete="off">
        </mat-form-field>
      </div>
      <!-- Messaggi fuori da <mat-error>: quello di Material compare solo quando il
           campo è in "errorState" (toccato o form inviato) e con ngModel sciolto
           resterebbe invisibile proprio quando serve. -->
      @if (inviato && !c.nome?.trim()) {
        <p class="rb-err">{{ 'rubrica.dialog.serveNome' | t }}</p>
      }
      <!-- Un contatto senza recapiti non serve a niente: ne basta uno dei due. -->
      @if (inviato && !c.telefono?.trim() && !c.email?.trim()) {
        <p class="rb-err">{{ 'rubrica.dialog.serveRecapito' | t }}</p>
      }

      <mat-form-field class="rb-full">
        <mat-label>{{ 'rubrica.dialog.ruolo' | t }}</mat-label>
        <input matInput [(ngModel)]="c.ruolo" name="ruolo" autocomplete="off"
               [placeholder]="'rubrica.dialog.ruoloPh' | t">
      </mat-form-field>

      <div class="rb-sezione">{{ 'rubrica.dialog.collegamento' | t }}</div>
      <p class="rb-hint">{{ 'rubrica.dialog.collegamentoHint' | t }}</p>
      <div class="rb-row">
        <mat-form-field class="rb-grow">
          <mat-label>{{ 'rubrica.dialog.cliente' | t }}</mat-label>
          <mat-select [(ngModel)]="c.clienteId" name="clienteId" (selectionChange)="c.fornitoreId = null">
            <mat-option [value]="null">{{ 'rubrica.dialog.nessuno' | t }}</mat-option>
            @for (x of clienti; track x.id) { <mat-option [value]="x.id">{{ x.ragioneSociale }}</mat-option> }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="rb-grow">
          <mat-label>{{ 'rubrica.dialog.fornitore' | t }}</mat-label>
          <mat-select [(ngModel)]="c.fornitoreId" name="fornitoreId" (selectionChange)="c.clienteId = null">
            <mat-option [value]="null">{{ 'rubrica.dialog.nessuno' | t }}</mat-option>
            @for (x of fornitori; track x.id) { <mat-option [value]="x.id">{{ x.ragioneSociale }}</mat-option> }
          </mat-select>
        </mat-form-field>
      </div>

      <mat-form-field class="rb-full">
        <mat-label>{{ 'rubrica.dialog.note' | t }}</mat-label>
        <textarea matInput rows="2" [(ngModel)]="c.note" name="note"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close()">{{ 'comune.annulla' | t }}</button>
      <button mat-flat-button color="primary" (click)="salva()">{{ 'comune.salva' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .rb-dialog { min-width: 520px; max-width: 100%; }
    .rb-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .rb-grow { flex: 1 1 200px; }
    .rb-tipo { flex: 0 0 200px; }
    .rb-full { width: 100%; }
    .rb-sezione {
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
      color: var(--text-tertiary); margin: 6px 0 2px;
    }
    .rb-hint { font-size: 12.5px; color: var(--text-tertiary); margin: 0 0 10px; }
    .rb-err { color: var(--danger-on); font-size: 12.5px; margin: -6px 0 10px; }
    @media (max-width: 600px) { .rb-dialog { min-width: 0; } .rb-tipo { flex: 1 1 100%; } }
  `],
})
export class ContattoDialogComponent {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private i18n = inject(I18nService);
  readonly tipi = TIPI;
  c: ContattoRubrica;
  clienti: Cliente[] = [];
  fornitori: Fornitore[] = [];
  inviato = false;

  constructor(
    public ref: MatDialogRef<ContattoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) data: { contatto: ContattoRubrica | null; clienti: Cliente[]; fornitori: Fornitore[] },
  ) {
    this.c = { nome: '', telefono: '', tipo: 'ALTRO', ruolo: '', email: '', note: '', clienteId: null, fornitoreId: null, ...(data?.contatto || {}) };
    // Un'anagrafica nascosta resta selezionabile se è quella già collegata,
    // altrimenti riaprendo il contatto il collegamento sparirebbe dall'elenco.
    this.clienti = selezionabili(data?.clienti ?? [], this.c.clienteId);
    this.fornitori = selezionabili(data?.fornitori ?? [], this.c.fornitoreId);
  }

  etichetta(t: string) { return etichettaTipo(this.i18n, t); }

  salva() {
    this.inviato = true;
    const senzaRecapito = !this.c.telefono?.trim() && !this.c.email?.trim();
    if (!this.c.nome?.trim() || senzaRecapito) {
      focusPrimoInvalido(this.host.nativeElement);
      return;
    }
    this.ref.close(this.c);
  }
}

// ── Pagina Rubrica ──────────────────────────────────────────────────────────────
@Component({
  selector: 'app-rubrica',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatButtonToggleModule, MatSnackBarModule, MatSortModule,
    MatTooltipModule, EmptyStateComponent, TPipe],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">{{ 'rubrica.title' | t }}</h1>
        <button mat-flat-button color="primary" (click)="nuovo()">
          <mat-icon>person_add</mat-icon> {{ 'rubrica.nuovo' | t }}
        </button>
      </div>

      <div class="card">
        <div class="rb-filtri">
          <mat-form-field class="rb-cerca" subscriptSizing="dynamic">
            <mat-label>{{ 'rubrica.cerca' | t }}</mat-label>
            <input matInput [(ngModel)]="q" (ngModelChange)="filtra()" autocomplete="off">
            <mat-icon matSuffix>search</mat-icon>
          </mat-form-field>
          <mat-form-field class="rb-filtro-tipo" subscriptSizing="dynamic">
            <mat-label>{{ 'rubrica.filtroTipo' | t }}</mat-label>
            <mat-select [(ngModel)]="tipo" (selectionChange)="filtra()">
              <mat-option value="">{{ 'rubrica.tutti' | t }}</mat-option>
              @for (t of tipi; track t) { <mat-option [value]="t">{{ etichetta(t) }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <span class="rb-conteggio">{{ 'rubrica.conteggio' | t: { n: contatti.length } }}</span>
        </div>

        @if (caricamentoKo) {
          <app-empty-state error icon="cloud_off"
            [title]="'comune.erroreCaricamento.titolo' | t"
            [message]="'comune.erroreCaricamento.messaggio' | t" />
        } @else if (!contatti.length) {
          @if (q || tipo) {
            <app-empty-state compact icon="search_off" [title]="'rubrica.empty.ricercaTitolo' | t"
              [message]="'rubrica.empty.ricercaMessaggio' | t" />
          } @else {
            <app-empty-state icon="contact_phone" [title]="'rubrica.empty.titolo' | t"
              [message]="'rubrica.empty.messaggio' | t">
              <button mat-flat-button color="primary" (click)="nuovo()">
                <mat-icon>person_add</mat-icon> {{ 'rubrica.nuovo' | t }}
              </button>
            </app-empty-state>
          }
        } @else {
          <table class="rb-table">
            <thead>
              <tr matSort (matSortChange)="sort = $event">
                <th mat-sort-header="nome">{{ 'rubrica.col.nome' | t }}</th>
                <th mat-sort-header="tipo">{{ 'rubrica.col.tipo' | t }}</th>
                <th mat-sort-header="telefono">{{ 'rubrica.col.telefono' | t }}</th>
                <th mat-sort-header="controparteNome" class="hide-tablet">{{ 'rubrica.col.collegatoA' | t }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of ordinati; track c.id) {
                <tr (dblclick)="modifica(c)">
                  <td>
                    <b>{{ c.nome }}</b>
                    @if (c.ruolo) { <span class="rb-ruolo">{{ c.ruolo }}</span> }
                    @if (c.email) { <div class="rb-muted">{{ c.email }}</div> }
                  </td>
                  <td><span class="rb-chip" [attr.data-tipo]="c.tipo">{{ etichetta(c.tipo) }}</span></td>
                  <td>
                    @if (c.telefono) {
                      <a class="rb-tel" [href]="'tel:' + c.telefono">{{ c.telefono }}</a>
                    } @else { <span class="rb-muted">—</span> }
                  </td>
                  <td class="hide-tablet">
                    @if (c.controparteNome) {
                      <span class="rb-controparte">
                        <mat-icon>{{ c.controparteTipo === 'FORNITORE' ? 'local_shipping' : 'people' }}</mat-icon>
                        {{ c.controparteNome }}
                      </span>
                    } @else { <span class="rb-muted">—</span> }
                  </td>
                  <td class="rb-azioni">
                    <button mat-icon-button (click)="modifica(c)" [matTooltip]="'comune.modifica' | t">
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button mat-icon-button (click)="elimina(c)" [matTooltip]="'comune.elimina' | t">
                      <mat-icon class="rb-del">delete</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
  styles: [`
    .rb-filtri { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
    .rb-cerca { flex: 1 1 260px; }
    .rb-filtro-tipo { flex: 0 0 200px; }
    .rb-conteggio { margin-left: auto; font-size: 12.5px; color: var(--text-tertiary); }

    .rb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .rb-table th {
      text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .04em; color: var(--text-tertiary);
      padding: 10px 12px; border-bottom: 1px solid var(--border);
    }
    .rb-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
    .rb-table tbody tr { cursor: pointer; }
    .rb-table tbody tr:hover { background: color-mix(in srgb, var(--primary) 8%, var(--bg-surface)); }
    .rb-muted { color: var(--text-tertiary); font-size: 12px; }
    .rb-ruolo { margin-left: 8px; font-size: 12px; color: var(--text-secondary); }
    /* Il numero non deve mai spezzarsi a metà: è la cosa che si legge per chiamare. */
    .rb-table td:nth-child(3) { white-space: nowrap; }
    .rb-table th:nth-child(2), .rb-table td:nth-child(2) { width: 1%; white-space: nowrap; }
    .rb-tel { color: var(--primary); text-decoration: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rb-tel:hover { text-decoration: underline; }
    .rb-controparte { display: inline-flex; align-items: center; gap: 6px; }
    .rb-controparte mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--text-tertiary); }
    .rb-azioni { text-align: right; white-space: nowrap; }
    .rb-del { color: var(--danger-on); }

    /* Chip del tipo: colori dai token, così seguono chiaro/scuro da soli. */
    .rb-chip {
      display: inline-block; padding: 2px 9px; border-radius: 99px;
      font-size: 11.5px; font-weight: 600; white-space: nowrap;
      background: var(--bg-subtle); color: var(--text-secondary);
    }
    .rb-chip[data-tipo="AMMINISTRAZIONE"] { background: var(--info-soft); color: var(--info-on); }
    .rb-chip[data-tipo="CONTABILITA"]     { background: var(--success-soft); color: var(--success-on); }
    .rb-chip[data-tipo="COMMERCIALE"]     { background: var(--primary-soft); color: var(--primary); }
    .rb-chip[data-tipo="DIREZIONE"]       { background: var(--warning-soft); color: var(--warning-on); }
    .rb-chip[data-tipo="ASSISTENZA"]      { background: var(--danger-soft); color: var(--danger-on); }

    @media (max-width: 1023.98px) { .hide-tablet { display: none; } }
  `],
})
export class RubricaComponent implements OnInit {
  private ds = inject(DataService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private confirm = inject(ConfirmService);
  private i18n = inject(I18nService);

  readonly tipi = TIPI;
  contatti: ContattoRubrica[] = [];
  clienti: Cliente[] = [];
  fornitori: Fornitore[] = [];
  q = '';
  tipo = '';
  sort: Sort | null = null;
  /** Ultima lettura fallita: distingue "non caricato" da "vuoto". */
  caricamentoKo = false;
  private timerFiltro: any;

  get ordinati(): ContattoRubrica[] {
    return ordinaPer(this.contatti, this.sort, (c, col) =>
      col === 'tipo' ? this.etichetta((c as any).tipo) : (c as any)[col]);
  }

  ngOnInit() {
    this.load();
    // Servono solo per il selettore del dialog: si caricano una volta sola.
    this.ds.getClienti().subscribe({ next: c => this.clienti = c, error: () => {} });
    this.ds.getFornitori().subscribe({ next: f => this.fornitori = f, error: () => {} });
  }

  etichetta(t?: string) { return etichettaTipo(this.i18n, t); }

  /** Ricerca lato server con un minimo di attesa: l'elenco può essere lungo. */
  filtra() {
    clearTimeout(this.timerFiltro);
    this.timerFiltro = setTimeout(() => this.load(), 250);
  }

  load() {
    this.caricamentoKo = false;
    this.ds.getRubrica(this.q.trim(), this.tipo).subscribe({
      next: c => this.contatti = c ?? [],
      error: () => { this.contatti = []; this.caricamentoKo = true; },
    });
  }

  nuovo() { this.apri(null); }
  modifica(c: ContattoRubrica) { this.apri(c); }

  private apri(contatto: ContattoRubrica | null) {
    this.dialog
      .open(ContattoDialogComponent, {
        data: { contatto, clienti: this.clienti, fornitori: this.fornitori },
        autoFocus: false,
        panelClass: 'dialog-compact',
      })
      .afterClosed()
      .subscribe((res: ContattoRubrica | undefined) => {
        if (!res) return;
        const obs: Observable<any> = res.id
          ? this.ds.aggiornaContatto(res.id, res)
          : this.ds.creaContatto(res);
        obs.subscribe({
          next: () => {
            this.load();
            this.snack.open(this.i18n.t('rubrica.msg.salvato'), '', { duration: 2000 });
          },
          error: e => this.snack.open(e.error?.error || this.i18n.t('rubrica.msg.errore'), '', { duration: 3500 }),
        });
      });
  }

  async elimina(c: ContattoRubrica) {
    if (!await this.confirm.delete(this.i18n.t('rubrica.msg.confermaElimina', { nome: c.nome }))) return;
    this.ds.eliminaContatto(c.id!).subscribe({
      next: () => {
        this.load();
        this.snack.open(this.i18n.t('rubrica.msg.eliminato'), '', { duration: 2000 });
      },
      error: e => this.snack.open(e.error?.error || this.i18n.t('rubrica.msg.errore'), '', { duration: 3500 }),
    });
  }
}
