import { Component, OnInit, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { DataService } from '../../services/data.service';
import { PrintService } from '../../services/print.service';
import { ConfirmService } from '../shared/confirm-dialog';
import { EmptyStateComponent } from '../shared/empty-state';
import { OrdineDialogComponent } from '../ordini/ordini';
import { Ordine, Acquisto } from '../../models';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';
import { ordinaPer } from '../../utils/ordina';

// ── Dialog: collega fattura ricevuta (acquisto) ──────────────────────────────
@Component({
  selector: 'app-collega-fattura-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatSelectModule, MatButtonModule, TPipe],
  template: `
    <h2 mat-dialog-title>{{ 'ordiniFornitore.collegaFattura.title' | t }}</h2>
    <mat-dialog-content style="min-width:380px">
      @if (acquisti.length) {
        <mat-form-field appearance="outline" style="width:100%">
          <mat-label>{{ 'ordiniFornitore.collegaFattura.label' | t }}</mat-label>
          <mat-select [(ngModel)]="acquistoId">
            <mat-option [value]="null">{{ 'ordiniFornitore.collegaFattura.nessuna' | t }}</mat-option>
            @for (a of acquisti; track a.id) {
              <mat-option [value]="a.id">{{ a.numero }} — {{ a.dataEmissione | date:'dd/MM/yyyy' }} ({{ a.totale | currency:'EUR':'symbol':'1.2-2':'it' }})</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <p style="font-size:12px;color:var(--text-tertiary);margin:0">{{ i18n.t('ordiniFornitore.collegaFattura.hint', { nome: data.ordine.fornitoreNome || i18n.t('ordiniFornitore.collegaFattura.fornitoreDefault') }) }}</p>
      } @else {
        <p style="font-size:13px;color:var(--text-secondary);margin:0">{{ 'ordiniFornitore.collegaFattura.nessunaTrovata' | t }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="{ acquistoId }">{{ 'ordiniFornitore.collegaFattura.collega' | t }}</button>
    </mat-dialog-actions>`,
})
export class CollegaFatturaDialogComponent {
  i18n = inject(I18nService);
  acquistoId: number | null;
  acquisti: Acquisto[];
  constructor(
    public dialogRef: MatDialogRef<CollegaFatturaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { ordine: Ordine; acquisti: Acquisto[] },
  ) {
    this.acquistoId = data.ordine.acquistoId ?? null;
    this.acquisti = (data.acquisti || []).filter(a => a.fornitoreId === data.ordine.fornitoreId);
  }
}

// ── Componente principale ────────────────────────────────────────────────────
@Component({
  selector: 'app-ordini-fornitore',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule, MatMenuModule,
            MatTooltipModule, MatSnackBarModule, MatDialogModule, EmptyStateComponent,
            MatPaginatorModule, MatSortModule, TPipe],
  templateUrl: './ordini-fornitore.html',
})
export class OrdiniFornitoreComponent implements OnInit {
  i18n = inject(I18nService);
  private confirm = inject(ConfirmService);
  ordini: Ordine[] = [];
  acquisti: Acquisto[] = [];
  cols = ['numero', 'data', 'fornitore', 'stato', 'fattura', 'totale', 'azioni'];

  constructor(private ds: DataService, private dialog: MatDialog,
              private snack: MatSnackBar, private printSvc: PrintService) {}

  ngOnInit() { this.load(); this.ds.getAcquisti().subscribe(a => this.acquisti = a); }

  load() {
    this.ds.getOrdini().subscribe(o => this.ordini = o.filter(x => x.tipo === 'FORNITORE'));
  }

  ordPageIndex = 0;
  ordPageSize = 25;
  onOrdPage(e: PageEvent) { this.ordPageIndex = e.pageIndex; this.ordPageSize = e.pageSize; }

  /** Colonna scelta cliccando l'intestazione (null = ordine del server); si riparte da pagina 1. */
  ordSort: Sort | null = null;
  onOrdSort(s: Sort) { this.ordSort = s; this.ordPageIndex = 0; }

  get ordPageIndexClamped(): number {
    const maxIndex = Math.max(0, Math.ceil(this.ordini.length / this.ordPageSize) - 1);
    return Math.min(this.ordPageIndex, maxIndex);
  }

  /** Pagina corrente di `ordini` per la tabella (B.8): con dati reali supera le 200 righe. */
  get ordiniPagina(): Ordine[] {
    // Le colonne della tabella hanno nomi brevi: qui il campo dell'ordine da cui leggono.
    const campo: Record<string, string> = { data: 'dataOrdine', fornitore: 'fornitoreNome', fattura: 'acquistoNumero' };
    const ordinati = ordinaPer(this.ordini, this.ordSort, (o, col) => (o as any)[campo[col] ?? col]);
    return ordinati.slice(this.ordPageIndexClamped * this.ordPageSize, (this.ordPageIndexClamped + 1) * this.ordPageSize);
  }

  private nextNumero(): string {
    const nums = this.ordini.map(o => { const m = /^RO-(\d+)$/.exec(o.numero || ''); return m ? +m[1] : 0; });
    return `RO-${Math.max(0, ...nums) + 1}`;
  }

  nuovo() {
    const numeriEsistenti = this.ordini.map(x => x.numero);
    this.dialog.open(OrdineDialogComponent, {
      data: { tipo: 'FORNITORE', numero: this.nextNumero(), numeriEsistenti }, width: '90vw', maxWidth: '1200px', maxHeight: '95vh',
    }).afterClosed().subscribe(result => {
      if (!result) return;
      result.tipo = 'FORNITORE';
      result.stato = result.stato || 'BOZZA';
      this.ds.createOrdine(result).subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('ordiniFornitore.msg.ordineCreato'), '', { duration: 2000, panelClass: 'snack-ok' }); },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }),
      });
    });
  }

  modifica(o: Ordine) {
    const numeriEsistenti = this.ordini.filter(x => x.id !== o.id).map(x => x.numero);
    this.dialog.open(OrdineDialogComponent, {
      data: { ...o, numeriEsistenti }, width: '90vw', maxWidth: '1200px', maxHeight: '95vh',
    }).afterClosed().subscribe(result => {
      if (!result) return;
      result.tipo = 'FORNITORE';
      this.ds.updateOrdine({ ...o, ...result }).subscribe({
        next: () => { this.load(); this.snack.open(this.i18n.t('ordini.msg.salvato'), '', { duration: 2000 }); },
        error: e => this.snack.open(e.error?.error || e.message, 'OK', { duration: 4000, panelClass: 'snack-error' }),
      });
    });
  }

  setStato(o: Ordine, stato: string) {
    this.ds.setOrdineStato(o.id!, stato).subscribe(() => { o.stato = stato; this.snack.open(this.i18n.t('ordiniFornitore.msg.statoAggiornato'), '', { duration: 1800 }); });
  }

  collegaFattura(o: Ordine) {
    this.dialog.open(CollegaFatturaDialogComponent, { data: { ordine: o, acquisti: this.acquisti }, width: '440px' })
      .afterClosed().subscribe(res => {
        if (res === undefined) return;
        this.ds.collegaAcquistoOrdine(o.id!, res.acquistoId).subscribe(() => {
          this.load();
          this.snack.open(this.i18n.t(res.acquistoId ? 'ordiniFornitore.msg.fatturaCollegata' : 'ordiniFornitore.msg.fatturaScollegata'), '', { duration: 1800 });
        });
      });
  }

  stampa(o: Ordine) { this.printSvc.printOrdine(o.id!); }

  async elimina(o: Ordine) {
    if (!await this.confirm.delete(this.i18n.t('ordiniFornitore.msg.confermaElimina', { numero: o.numero }))) return;
    this.ds.deleteOrdine(o.id!).subscribe(() => { this.load(); this.snack.open(this.i18n.t('ordiniFornitore.msg.eliminato'), '', { duration: 2000 }); });
  }
}
