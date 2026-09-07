import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TPipe } from '../../pipes/t.pipe';

export interface InfoRow {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  chip?: string;
  chipColor?: string;
}

export interface InfoSection {
  title?: string;
  rows: InfoRow[];
}

export interface InfoDialogData {
  title: string;
  subtitle?: string;
  sections: InfoSection[];
}

@Component({
  selector: 'app-info-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TPipe],
  template: `
    <div mat-dialog-title style="display:flex;align-items:center;gap:10px;padding-bottom:4px">
      <mat-icon style="color:#3b82f6;font-size:22px;width:22px;height:22px;flex-shrink:0">info</mat-icon>
      <span style="font-size:17px;font-weight:700;color:#0f172a;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ data.title }}</span>
    </div>
    @if (data.subtitle) {
      <div style="padding:0 24px 8px;font-size:12px;color:#64748b;margin-top:-8px">{{ data.subtitle }}</div>
    }
    <mat-dialog-content style="min-width:340px;max-width:480px">
      @for (section of data.sections; track $index) {
        @if (section.title) {
          <div class="section-title">{{ section.title }}</div>
        }
        @for (row of section.rows; track row.label) {
          @if (row.value !== null && row.value !== undefined && row.value !== '') {
            <div class="info-row">
              <div class="info-label">{{ row.label }}</div>
              <div class="info-value" [class.mono]="row.mono">
                {{ row.value }}
                @if (row.chip) {
                  <span class="chip" [style.background]="row.chipColor || '#cde3ec'" [style.color]="row.chipColor ? '#fff' : '#0b5066'">{{ row.chip }}</span>
                }
              </div>
            </div>
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'shared.docInfo.chiudi' | t }}</button>
    </mat-dialog-actions>`,
  styles: [`
    .section-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.6px; color: #94a3b8; margin: 16px 0 6px;
    }
    .section-title:first-child { margin-top: 4px; }
    .info-row {
      display: flex; gap: 12px; padding: 5px 0;
      border-bottom: 1px solid #f1f5f9;
      align-items: baseline;
    }
    .info-row:last-child { border-bottom: none; }
    .info-label {
      font-size: 12px; color: #64748b; font-weight: 500;
      min-width: 130px; flex-shrink: 0;
    }
    .info-value {
      font-size: 13px; color: #0f172a; word-break: break-word;
    }
    .info-value.mono { font-family: monospace; font-size: 12px; }
    .chip {
      font-size: 10px; font-weight: 700; padding: 1px 6px;
      border-radius: 99px; margin-left: 6px; vertical-align: middle;
    }
  `]
})
export class InfoDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: InfoDialogData) {}
}
