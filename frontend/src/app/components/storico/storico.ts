import { Component, OnInit, inject } from '@angular/core';
import { EmptyStateComponent } from '../shared/empty-state';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { ApiService } from '../../services/api.service';
import { I18nService } from '../../services/i18n.service';
import { TPipe } from '../../pipes/t.pipe';

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  createdAt: string;
}

@Component({
  selector: 'app-storico',
  standalone: true,
  imports: [CommonModule, FormsModule, MatSelectModule, MatIconModule, MatButtonModule, MatTableModule, EmptyStateComponent, TPipe],
  template: `
    <div class="page">
      <div class="page-header">
        <h1 class="page-title">{{ 'storico.title' | t }}</h1>
        <button mat-stroked-button type="button" (click)="load()"><mat-icon>refresh</mat-icon> {{ 'storico.aggiorna' | t }}</button>
      </div>

      <div class="filter-bar">
        <mat-select [(ngModel)]="filtroEntity" (selectionChange)="applyFilter()" [placeholder]="'storico.tipoEntitaPlaceholder' | t">
          <mat-option [value]="null">{{ 'storico.tutti' | t }}</mat-option>
          @for (t of tipi; track t) { <mat-option [value]="t">{{ t }}</mat-option> }
        </mat-select>
        <mat-select [(ngModel)]="filtroAction" (selectionChange)="applyFilter()" [placeholder]="'storico.azionePlaceholder' | t">
          <mat-option [value]="null">{{ 'storico.tutte' | t }}</mat-option>
          <mat-option value="CREATE">{{ 'storico.azione.create' | t }}</mat-option>
          <mat-option value="UPDATE">{{ 'storico.azione.update' | t }}</mat-option>
          <mat-option value="DELETE">{{ 'storico.azione.delete' | t }}</mat-option>
        </mat-select>
      </div>

      <div class="card">
        @if (!filtered.length) {
          <app-empty-state compact icon="history" [title]="'storico.nessunaModifica' | t" />
        } @else {
          <table class="audit-table">
            <thead>
              <tr>
                <th>{{ 'storico.colQuando' | t }}</th>
                <th>{{ 'storico.colEntita' | t }}</th>
                <th>{{ 'storico.colId' | t }}</th>
                <th>{{ 'storico.colAzione' | t }}</th>
                <th>{{ 'storico.colDettaglio' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (e of filtered; track e.id) {
                <tr>
                  <td class="when">{{ formatDate(e.createdAt) }}</td>
                  <td><b>{{ e.entityType }}</b></td>
                  <td>#{{ e.entityId }}</td>
                  <td>
                    <span class="action-chip" [class]="'action-' + e.action.toLowerCase()">{{ azioneLabel(e.action) }}</span>
                  </td>
                  <td class="payload">{{ summarizePayload(e) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
  styles: [`
    .audit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .audit-table th { background: var(--bg-surface-2); padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-tertiary); border-bottom: 1px solid var(--border-subtle); }
    .audit-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
    .when { white-space: nowrap; color: var(--text-secondary); font-size: 12px; }
    .payload { color: var(--text-secondary); font-size: 12px; max-width: 480px; word-break: break-word; }
    .action-chip { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; }
    .action-create { background: #dcfce7; color: #15803d; }
    .action-update { background: #dbeafe; color: #2563eb; }
    .action-delete { background: #fee2e2; color: #b91c1c; }
    @media (max-width: 600px) {
      .audit-table th, .audit-table td { padding: 8px 6px; }
      .payload { display: none; }
    }
  `]
})
export class StoricoComponent implements OnInit {
  private i18n = inject(I18nService);
  entries: AuditEntry[] = [];
  filtered: AuditEntry[] = [];
  filtroEntity: string | null = null;
  filtroAction: string | null = null;
  get tipi(): string[] { return [...new Set(this.entries.map(e => e.entityType))].sort(); }

  constructor(private api: ApiService) {}

  ngOnInit() { this.load(); }

  load() {
    this.api.get<AuditEntry[]>('audit/recent?limit=200').subscribe({
      next: rows => { this.entries = rows || []; this.applyFilter(); },
      error: () => { this.entries = []; this.filtered = []; }
    });
  }

  applyFilter() {
    let data = this.entries;
    if (this.filtroEntity) data = data.filter(e => e.entityType === this.filtroEntity);
    if (this.filtroAction) data = data.filter(e => e.action === this.filtroAction);
    this.filtered = data;
  }

  private readonly LOCALE_MAP: Record<string, string> = { it: 'it-IT', en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

  formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    const locale = this.LOCALE_MAP[this.i18n.lang() ?? 'it'] || 'it-IT';
    return d.toLocaleString(locale, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  azioneLabel(action: string): string {
    const key = `storico.azione.${action.toLowerCase()}`;
    const label = this.i18n.t(key);
    return label === key ? action : label;
  }

  summarizePayload(e: AuditEntry): string {
    const p = e.payload || {};
    const parts: string[] = [];
    if (p.numero) parts.push(`n. ${p.numero}`);
    if (p.stato) parts.push(`stato ${p.stato}`);
    if (p.before && p.after) {
      const changes: string[] = [];
      for (const k of Object.keys(p.after)) {
        if (p.before[k] !== p.after[k]) changes.push(`${k}: ${JSON.stringify(p.before[k])} -> ${JSON.stringify(p.after[k])}`);
      }
      if (changes.length) parts.push(changes.join(', '));
    }
    if (!parts.length) return JSON.stringify(p);
    return parts.join(' · ');
  }
}
