import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DataService } from '../../services/data.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

@Component({
  selector: 'app-bug-report-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatSnackBarModule, TPipe,
  ],
  template: `
    <h2 mat-dialog-title style="display:flex;align-items:center;gap:8px">
      <mat-icon style="color:#dc2626">bug_report</mat-icon>
      {{ 'bugReport.title' | t }}
    </h2>
    <mat-dialog-content style="min-width:480px;padding-top:8px">
      <div style="display:flex;flex-direction:column;gap:12px">
        <mat-form-field style="width:100%">
          <mat-label>{{ 'bugReport.titoloLabel' | t }}</mat-label>
          <input matInput [(ngModel)]="titolo" [placeholder]="'bugReport.titoloPlaceholder' | t" autofocus>
        </mat-form-field>
        <div style="display:flex;gap:12px">
          <mat-form-field style="flex:1">
            <mat-label>{{ 'bugReport.prioritaLabel' | t }}</mat-label>
            <mat-select [(ngModel)]="priorita">
              <mat-option value="BASSA">{{ 'bugReport.bassa' | t }}</mat-option>
              <mat-option value="MEDIA">{{ 'bugReport.media' | t }}</mat-option>
              <mat-option value="ALTA">{{ 'bugReport.alta' | t }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field style="flex:2">
            <mat-label>{{ 'bugReport.paginaLabel' | t }}</mat-label>
            <input matInput [(ngModel)]="pagina" [placeholder]="data?.pagina || ('bugReport.paginaPlaceholder' | t)">
          </mat-form-field>
        </div>
        <mat-form-field style="width:100%">
          <mat-label>{{ 'bugReport.descrizioneLabel' | t }}</mat-label>
          <textarea matInput [(ngModel)]="descrizione" rows="5"
            [placeholder]="'bugReport.descrizionePlaceholder' | t"></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="warn" (click)="send()" [disabled]="!titolo.trim() || !descrizione.trim() || sending">
        <mat-icon>send</mat-icon>
        {{ (sending ? 'bugReport.invio' : 'bugReport.inviaSegnalazione') | t }}
      </button>
    </mat-dialog-actions>`,
})
export class BugReportDialogComponent {
  private i18n = inject(I18nService);
  titolo = '';
  descrizione = '';
  priorita = 'MEDIA';
  pagina = '';
  sending = false;

  constructor(
    public dialogRef: MatDialogRef<BugReportDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { pagina?: string } | null,
    private ds: DataService,
    private snack: MatSnackBar,
  ) {
    this.pagina = data?.pagina ?? '';
  }

  send() {
    if (!this.titolo.trim() || !this.descrizione.trim()) return;
    this.sending = true;
    this.ds.createBugReport({
      titolo: this.titolo.trim(),
      descrizione: this.descrizione.trim(),
      pagina: this.pagina.trim(),
      priorita: this.priorita,
    }).subscribe({
      next: () => {
        this.snack.open(this.i18n.t('bugReport.msg.inviata'), '', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: () => {
        this.sending = false;
        this.snack.open(this.i18n.t('bugReport.msg.errore'), '', { duration: 3000 });
      },
    });
  }
}
