import { Component, Input, Output, EventEmitter, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { TPipe } from '../../pipes/t.pipe';

export interface ColDef { key: string; label: string; defaultVisible?: boolean; }

@Component({
  selector: 'app-column-picker',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatCheckboxModule, MatTooltipModule, DragDropModule, TPipe],
  styles: [`
    :host { position: relative; display: inline-block; }
    .picker-panel {
      position: absolute; right: 0; top: 40px; z-index: 9999;
      background: white; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.16);
      padding: 12px 0; min-width: 220px; max-height: 420px; overflow-y: auto;
    }
    .picker-title {
      font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;
      letter-spacing: .5px; padding: 0 16px 10px;
      border-bottom: 1px solid #f1f5f9; margin-bottom: 4px;
    }
    .col-row {
      display: flex; align-items: center; gap: 2px; padding: 4px 12px;
    }
    .col-row:hover { background: #f8fafc; }
    .drag-handle { color: #cbd5e1; font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; cursor: grab; }
    .col-row.cdk-drag-placeholder { opacity: .3; background: #cde3ec; }
    .cdk-drop-list-dragging .col-row:not(.cdk-drag-placeholder) { transition: transform 200ms; }
  `],
  template: `
    <!-- matTooltip non dà un nome accessibile al bottone: senza aria-label
         questo bottone risultava privo di etichetta in tutte le liste. -->
    <button mat-icon-button type="button" (click)="toggle($event)" [attr.aria-label]="'columnPicker.personalizza' | t"
            [matTooltip]="'columnPicker.personalizza' | t" matTooltipPosition="left">
      <mat-icon>view_column</mat-icon>
    </button>
    @if (open) {
      <div class="picker-panel" (click)="$event.stopPropagation()">
        <div class="picker-title">{{ 'columnPicker.colonneVisibili' | t }}</div>
        <div cdkDropList (cdkDropListDropped)="drop($event)">
          @for (col of cols; track col.key) {
            <div cdkDrag class="col-row">
              <mat-icon cdkDragHandle class="drag-handle">drag_indicator</mat-icon>
              <mat-checkbox [checked]="col.visible" (change)="toggleCol(col, $event.checked)">{{ col.label }}</mat-checkbox>
            </div>
          }
        </div>
      </div>
    }
  `
})
export class ColumnPickerComponent implements OnInit {
  @Input() storageKey!: string;
  @Input() allCols!: ColDef[];
  @Output() colsChange = new EventEmitter<string[]>();

  cols: (ColDef & { visible: boolean })[] = [];
  open = false;

  ngOnInit() {
    const saved: { key: string; visible: boolean }[] | null = (() => {
      try { return JSON.parse(localStorage.getItem('cols_' + this.storageKey) ?? 'null'); } catch { return null; }
    })();
    if (saved) {
      this.cols = saved
        .filter(s => this.allCols.some(a => a.key === s.key))
        .map(s => ({ key: s.key, label: this.allCols.find(a => a.key === s.key)!.label, visible: s.visible }));
      for (const a of this.allCols) {
        if (!this.cols.some(c => c.key === a.key)) this.cols.push({ ...a, visible: true });
      }
    } else {
      this.cols = this.allCols.map(a => ({ ...a, visible: a.defaultVisible !== false }));
    }
    this.emit();
  }

  toggle(e: Event) { e.stopPropagation(); this.open = !this.open; }

  toggleCol(col: ColDef & { visible: boolean }, checked: boolean) {
    col.visible = checked; this.save();
  }

  drop(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.cols, event.previousIndex, event.currentIndex); this.save();
  }

  save() {
    localStorage.setItem('cols_' + this.storageKey, JSON.stringify(this.cols.map(c => ({ key: c.key, visible: c.visible }))));
    this.emit();
  }

  emit() { this.colsChange.emit(this.cols.filter(c => c.visible).map(c => c.key)); }

  @HostListener('document:click') closePanel() { this.open = false; }
}
