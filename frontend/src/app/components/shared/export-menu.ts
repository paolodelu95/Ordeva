import { Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ExcelService, ExcelColumn } from '../../services/excel.service';
import { TPipe } from '../../pipes/t.pipe';

/**
 * Pulsante "Esporta" con menu Excel / CSV / PDF, riutilizzabile in tutte le liste.
 * Passa gli stessi `data` e `columns` che useresti per l'export Excel.
 */
@Component({
  selector: 'app-export-menu',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TPipe],
  template: `
    <button mat-stroked-button type="button" [matMenuTriggerFor]="menu" [disabled]="!data.length">
      <mat-icon>download</mat-icon> {{ label ?? ('shared.exportMenu.esporta' | t) }}
    </button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" (click)="esporta('xlsx')">
        <mat-icon>grid_on</mat-icon> {{ 'shared.exportMenu.excel' | t }}
      </button>
      <button mat-menu-item type="button" (click)="esporta('csv')">
        <mat-icon>description</mat-icon> {{ 'shared.exportMenu.csv' | t }}
      </button>
      <button mat-menu-item type="button" (click)="esporta('pdf')">
        <mat-icon>picture_as_pdf</mat-icon> {{ 'shared.exportMenu.pdf' | t }}
      </button>
    </mat-menu>
  `,
})
export class ExportMenuComponent {
  @Input() data: any[] = [];
  @Input() columns: ExcelColumn<any>[] = [];
  @Input() filename = 'export';
  @Input() title?: string;
  @Input() label?: string;

  constructor(private excel: ExcelService) {}

  esporta(fmt: 'xlsx' | 'csv' | 'pdf') {
    if (fmt === 'csv') this.excel.exportCsv(this.data, this.columns, this.filename);
    else if (fmt === 'pdf') this.excel.exportPdf(this.data, this.columns, this.filename, this.title);
    else this.excel.export(this.data, this.columns, this.filename);
  }
}
