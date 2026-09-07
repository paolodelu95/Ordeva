import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  type?: 'string' | 'number' | 'integer';
  defaultValue?: any;
  aliases: string[];
}

export interface ImportMappingData {
  rows: Record<string, string>[];
  fields: FieldDef[];
  entityType: string;
  entityLabel: string;
  /** Per ciascun campo prezzo elencato qui, chiede separatamente se nel file
   *  quel prezzo è IVA inclusa o esclusa. La domanda compare solo se il campo
   *  è effettivamente mappato a una colonna. */
  priceVatFields?: { key: string; label: string }[];
}

export interface MappingResult {
  mapping: Record<string, string>;
  /** Per ciascuna chiave prezzo: true se nel file è IVA inclusa (da convertire in netto). */
  priceVat?: Record<string, boolean>;
}

const STORAGE_KEY = 'import_mapping_';

function autoMap(headers: string[], field: FieldDef): string {
  const lower = headers.map(h => ({ h, l: h.toLowerCase().trim().replace(/\s+/g, ' ') }));
  for (const alias of field.aliases) {
    const aliasLow = alias.toLowerCase().trim().replace(/\s+/g, ' ');
    const match = lower.find(x => x.l === aliasLow);
    if (match) return match.h;
  }
  return '';
}

@Component({
  selector: 'app-import-mapping-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule,
    MatSelectModule, MatButtonModule, MatCheckboxModule, MatRadioModule, MatIconModule, TPipe,
  ],
  styles: [`
    .grid-row {
      display: grid;
      grid-template-columns: 170px 1fr 130px;
      gap: 8px;
      align-items: center;
      padding: 2px 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #eee);
    }
    .grid-header {
      display: grid;
      grid-template-columns: 170px 1fr 130px;
      gap: 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant, #888);
      padding-bottom: 6px;
      border-bottom: 2px solid var(--mat-sys-outline, #ccc);
      margin-bottom: 2px;
    }
    .field-label { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 4px; }
    .req { color: var(--mat-sys-error, #f44336); font-size: 13px; }
    .preview-val {
      font-size: 12px; color: var(--mat-sys-on-surface-variant, #666);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 128px;
    }
    /* Mobile: la griglia 170px/1fr/130px non collassa mai -> stack verticale */
    @media (max-width: 600px) {
      .grid-header { display: none; }
      .grid-row { grid-template-columns: 1fr; gap: 2px; padding: 10px 0; }
      .field-label { font-weight: 700; }
      .preview-val { max-width: 100%; white-space: normal; word-break: break-word; }
    }
    .warn { color: var(--mat-sys-error, #f44336); font-size: 12px; margin-top: 10px; display: flex; align-items: center; gap: 4px; }
  `],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('importMapping.title', { entity: data.entityLabel }) }}</h2>
    <mat-dialog-content style="width:660px;max-width:94vw;max-height:68vh;overflow-y:auto;padding-top:4px">
      <p style="font-size:13px;margin:0 0 14px;color:var(--mat-sys-on-surface-variant,#666)">
        {{ 'importMapping.intro1' | t }}
        {{ 'importMapping.intro2a' | t }} <span style="color:var(--mat-sys-error,#f44336);font-weight:600">*</span> {{ 'importMapping.intro2b' | t }}
      </p>

      @if (visiblePriceVatFields.length) {
        <div style="margin:0 0 16px;padding:12px 14px;border:1px solid var(--mat-sys-outline-variant,#e2e8f0);border-radius:10px;background:var(--mat-sys-surface-container-low,#f8fafc)">
          @for (pf of visiblePriceVatFields; track pf.key) {
            <div [style.margin-top]="$first ? '0' : '12px'">
              <div style="font-size:13px;font-weight:600;margin-bottom:8px">{{ i18n.t('importMapping.pfInFile', { label: pf.label }) }}</div>
              <mat-radio-group [(ngModel)]="priceVat[pf.key]" style="display:flex;gap:20px;flex-wrap:wrap">
                <mat-radio-button [value]="false">{{ 'importMapping.ivaEsclusa' | t }}</mat-radio-button>
                <mat-radio-button [value]="true">{{ 'importMapping.ivaInclusa' | t }}</mat-radio-button>
              </mat-radio-group>
            </div>
          }
          <p style="font-size:12px;color:var(--mat-sys-on-surface-variant,#888);margin:8px 0 0">
            {{ 'importMapping.ivaHint' | t }}
          </p>
        </div>
      }

      <div class="grid-header">
        <span>{{ 'importMapping.colCampo' | t }}</span>
        <span>{{ 'importMapping.colColonna' | t }}</span>
        <span>{{ 'importMapping.colAnteprima' | t }}</span>
      </div>
      @for (f of data.fields; track f.key) {
        <div class="grid-row">
          <span class="field-label">
            {{ f.label }}
            @if (f.required) { <span class="req">*</span> }
          </span>
          <mat-form-field style="width:100%" subscriptSizing="dynamic">
            <mat-select [(ngModel)]="mapping[f.key]">
              <mat-option value="">{{ 'importMapping.nessuna' | t }}</mat-option>
              @for (h of headers; track h) {
                <mat-option [value]="h">{{ h }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <span class="preview-val" [title]="getPreview(f.key)">{{ getPreview(f.key) }}</span>
        </div>
      }
      @if (missingRequired.length > 0) {
        <div class="warn">
          <mat-icon style="font-size:16px;width:16px;height:16px">warning</mat-icon>
          {{ i18n.t('importMapping.campiMancanti', { campi: missingRequired.join(', ') }) }}
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" style="gap:8px;padding:12px 24px">
      <mat-checkbox [(ngModel)]="saveMapping" style="font-size:13px;margin-right:auto">
        {{ 'importMapping.ricordaMapping' | t }}
      </mat-checkbox>
      <button mat-button (click)="dialogRef.close(null)">{{ 'fatture.dialog.annulla' | t }}</button>
      <button mat-flat-button color="primary" [disabled]="missingRequired.length > 0" (click)="confirm()">
        {{ 'importMapping.importa' | t }}
      </button>
    </mat-dialog-actions>
  `
})
export class ImportMappingDialogComponent {
  i18n = inject(I18nService);
  headers: string[] = [];
  mapping: Record<string, string> = {};
  saveMapping = false;
  /** Per ciascun campo prezzo: true = nel file è IVA inclusa. */
  priceVat: Record<string, boolean> = {};
  private firstRow: Record<string, string> = {};

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ImportMappingData,
    public dialogRef: MatDialogRef<ImportMappingDialogComponent>
  ) {
    this.firstRow = data.rows[0] ?? {};
    this.headers = Object.keys(this.firstRow);

    const saved = this.loadSaved();
    for (const f of data.fields) {
      const savedCol = saved[f.key];
      if (savedCol && this.headers.includes(savedCol)) {
        this.mapping[f.key] = savedCol;
      } else {
        this.mapping[f.key] = autoMap(this.headers, f);
      }
    }
    for (const pf of data.priceVatFields ?? []) this.priceVat[pf.key] = false;
  }

  /** Campi prezzo per cui chiedere IVA: solo quelli effettivamente mappati. */
  get visiblePriceVatFields(): { key: string; label: string }[] {
    return (this.data.priceVatFields ?? []).filter(pf => !!this.mapping[pf.key]);
  }

  get missingRequired(): string[] {
    return this.data.fields
      .filter(f => f.required && !this.mapping[f.key])
      .map(f => f.label);
  }

  getPreview(key: string): string {
    const col = this.mapping[key];
    if (!col) return '—';
    const v = String(this.firstRow[col] ?? '');
    return v || '—';
  }

  confirm() {
    if (this.saveMapping) {
      localStorage.setItem(STORAGE_KEY + this.data.entityType, JSON.stringify(this.mapping));
    }
    this.dialogRef.close({ mapping: { ...this.mapping }, priceVat: { ...this.priceVat } } satisfies MappingResult);
  }

  private loadSaved(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY + this.data.entityType) ?? '{}');
    } catch { return {}; }
  }
}
