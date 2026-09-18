import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CityService, CityResult } from '../../services/city.service';
import { TPipe } from '../../pipes/t.pipe';
import { OpzioneComuneComponent } from './opzione-comune';

/**
 * Dialog di ricerca comune (nome parziale o con più omonimi in Italia): mostra
 * l'elenco completo dei risultati di `CityService.searchCities`, non solo le
 * prime voci del dropdown dell'autocomplete inline.
 */
@Component({
  selector: 'app-city-search-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
            MatButtonModule, MatIconModule, MatProgressSpinnerModule, OpzioneComuneComponent, TPipe],
  styles: [`
    .city-result {
      padding: 10px 12px; cursor: pointer; border-radius: 6px;
      border-bottom: 1px solid var(--mat-sys-outline-variant, #e0e0e0);
      transition: background 0.15s;
    }
    .city-result:hover { background: var(--mat-sys-secondary-container, #f0f4ff); }
    .city-result app-opzione-comune { font-size: 14px; }
    .no-results { text-align: center; color: var(--mat-sys-on-surface-variant, #888);
                  padding: 24px 0; font-size: 14px; }
    .fonte { font-size: 11px; color: var(--text-tertiary); margin: 10px 0 0; }
  `],
  template: `
    <h2 mat-dialog-title>{{ 'shared.citySearch.title' | t }}</h2>
    <mat-dialog-content style="width:420px;max-width:90vw;min-height:120px">
      <mat-form-field style="width:100%">
        <mat-label>{{ 'shared.citySearch.comune' | t }}</mat-label>
        <input matInput [(ngModel)]="query" (ngModelChange)="onQueryChange($event)"
               [placeholder]="'shared.citySearch.placeholder' | t" autofocus>
        <span matSuffix style="margin-right:8px">
          @if (loading) { <mat-spinner diameter="18"></mat-spinner> }
          @else { <mat-icon>search</mat-icon> }
        </span>
      </mat-form-field>

      @if (results.length > 0) {
        <div style="max-height:320px;overflow-y:auto">
          @for (r of results; track r.name + r.provincia) {
            <div class="city-result" role="button" tabindex="0" (click)="select(r)" (keydown.enter)="select(r)">
              <app-opzione-comune [c]="r" />
            </div>
          }
        </div>
      } @else if (searched && !loading) {
        <div class="no-results">{{ 'shared.citySearch.noResults' | t:{ query } }}</div>
      }
      <p class="fonte">{{ 'shared.comune.fonte' | t }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'shared.citySearch.chiudi' | t }}</button>
    </mat-dialog-actions>`
})
export class CitySearchDialogComponent {
  query = '';
  results: CityResult[] = [];
  loading = false;
  searched = false;
  private searchTimer: any;

  constructor(private cityService: CityService, public dialogRef: MatDialogRef<CitySearchDialogComponent>) {}

  onQueryChange(q: string) {
    clearTimeout(this.searchTimer);
    if (q.length < 2) { this.results = []; this.searched = false; return; }
    this.loading = true;
    this.searchTimer = setTimeout(() => this.doSearch(q), 150);
  }

  private doSearch(q: string) {
    this.cityService.searchCities(q, 50).subscribe(results => {
      this.loading = false;
      this.searched = true;
      this.results = results;
    });
  }

  select(r: CityResult) { this.dialogRef.close(r); }
}
