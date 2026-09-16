import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Indicatore di caricamento coerente per le liste (B.7 del workflow UI/UX).
 * Va mostrato AL POSTO del contenuto mentre il fetch è in corso, così "vuoto" e
 * "sto caricando" restano distinguibili — oggi 105 componenti su 126 non hanno
 * alcun indicatore e la lista appare vuota anche mentre sta ancora arrivando.
 *
 * Uso (dentro il container che normalmente ospita tabella/empty-state):
 *   @if (loading) { <app-loading-skeleton [rows]="6" /> }
 *   @else if (!dataSource.data.length) { <app-empty-state ... /> }
 *   @else { <table mat-table ...> }
 */
@Component({
  selector: 'app-loading-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="skel" role="status" aria-label="Caricamento in corso">
      @for (r of righe; track r.i) {
        <div class="skel-row">
          <div class="skel-bar" [style.width.%]="r.w"></div>
          <div class="skel-bar skel-bar-sm"></div>
          <div class="skel-bar skel-bar-sm"></div>
        </div>
      }
    </div>`,
  styles: [`
    :host { display: block; width: 100%; }
    .skel { display: flex; flex-direction: column; gap: 14px; padding: 20px 4px; }
    .skel-row { display: flex; align-items: center; gap: 16px; }
    .skel-bar {
      height: 14px; border-radius: var(--radius-sm, 6px);
      background: linear-gradient(90deg, var(--bg-subtle) 25%, var(--border-subtle) 37%, var(--bg-subtle) 63%);
      background-size: 400% 100%;
      animation: skel-shimmer 1.4s ease infinite;
    }
    .skel-bar-sm { flex: 1; max-width: 120px; }
    .skel-bar:first-child { flex: 2; max-width: 320px; }
    @keyframes skel-shimmer {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .skel-bar { animation: none; }
    }
  `],
})
export class LoadingSkeletonComponent {
  /**
   * Le righe sono precalcolate, non un getter: il getter creava un array nuovo
   * a ogni giro di change detection e il `track` sulla sola larghezza (55/40
   * alternate) produceva chiavi duplicate — NG0955 a raffica in console e DOM
   * ricostruito di continuo, con l'animazione che ripartiva da capo.
   */
  righe: { i: number; w: number }[] = LoadingSkeletonComponent.calcola(6);

  @Input() set rows(n: number) {
    this.righe = LoadingSkeletonComponent.calcola(n);
  }

  /** Larghezza (%) della prima barra di ogni riga, alternata per non sembrare un muro uniforme. */
  private static calcola(n: number): { i: number; w: number }[] {
    return Array.from({ length: Math.max(0, n) }, (_, i) => ({ i, w: i % 2 === 0 ? 55 : 40 }));
  }
}
