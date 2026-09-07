import { Injectable, inject, signal, computed } from '@angular/core';
import { DataService } from './data.service';

/**
 * Cifre decimali del prezzo unitario (2 o 3), configurabili in Impostazioni →
 * Avanzate. Riguarda SOLO il prezzo unitario sui documenti "vivi" (preventivi,
 * ordini, DDT, acquisti, fatture ricorrenti) e nel catalogo prodotti/listini —
 * Fatture e Note di Credito restano sempre a 2 decimali (documenti fiscali già
 * trasmessi allo SDI) e non usano questo servizio.
 */
@Injectable({ providedIn: 'root' })
export class PrezzoFormatService {
  private ds = inject(DataService);

  readonly decimali = signal(2);
  /** Per le pipe `currency`/`number`, es. '1.2-2' o '1.3-3'. */
  readonly digitsInfo = computed(() => (this.decimali() === 3 ? '1.3-3' : '1.2-2'));
  /** Per l'attributo `step` degli input prezzo. */
  readonly step = computed(() => (this.decimali() === 3 ? '0.001' : '0.01'));

  constructor() {
    this.load();
  }

  private load(): void {
    this.ds.getAzienda().subscribe({
      next: a => this.decimali.set(a?.decimaliPrezzo === 3 ? 3 : 2),
      error: () => this.decimali.set(2),
    });
  }

  /** Da richiamare dopo il salvataggio dell'impostazione in Impostazioni. */
  invalidate(): void {
    this.load();
  }
}
