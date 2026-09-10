import { Injectable, inject, signal } from '@angular/core';
import { DataService } from './data.service';

/**
 * Costo d'acquisto dei prodotti, per accorgersi di una vendita in perdita
 * mentre la si sta scrivendo.
 *
 * Il margine complessivo di un documento può restare positivo mentre una singola
 * riga è sottocosto — succede con gli sconti fatti a mente su un articolo solo.
 * Qui il confronto è per riga, che è dove nasce l'errore.
 *
 * I costi si caricano una volta per sessione e restano in memoria: sono già
 * nell'elenco prodotti, quindi non c'è una chiamata in più da fare.
 */
@Injectable({ providedIn: 'root' })
export class CostiService {
  private readonly ds = inject(DataService);
  private readonly costi = signal<Map<number, number>>(new Map());
  private caricamento: Promise<void> | null = null;

  /** Carica i costi se non sono già in memoria. Chiamabile più volte senza costo. */
  assicura(): Promise<void> {
    if (!this.caricamento) {
      this.caricamento = new Promise<void>((risolvi) => {
        this.ds.getProdotti().subscribe({
          next: (prodotti) => {
            const m = new Map<number, number>();
            for (const p of prodotti) {
              if (p.id != null && p.prezzoAcquisto != null && p.prezzoAcquisto > 0) {
                m.set(p.id, p.prezzoAcquisto);
              }
            }
            this.costi.set(m);
            risolvi();
          },
          error: () => risolvi(),
        });
      });
    }
    return this.caricamento;
  }

  /** Costo d'acquisto registrato, o null se il prodotto non ce l'ha. */
  costo(prodottoId: number | null | undefined): number | null {
    if (prodottoId == null) return null;
    return this.costi().get(prodottoId) ?? null;
  }

  /**
   * Vero se il prezzo di vendita (già al netto dello sconto di riga) non copre
   * il costo. Serve un margine di tolleranza: vendere esattamente al costo è
   * una scelta legittima, venderci sotto quasi mai.
   */
  sottocosto(prodottoId: number | null | undefined, prezzoNetto: number): boolean {
    const c = this.costo(prodottoId);
    return c != null && prezzoNetto > 0 && prezzoNetto < c - 0.005;
  }

  /** Perdita unitaria, per dirla nel messaggio invece di lasciarla indovinare. */
  perdita(prodottoId: number | null | undefined, prezzoNetto: number): number {
    const c = this.costo(prodottoId);
    return c == null ? 0 : Math.max(0, c - prezzoNetto);
  }

  /** Dopo un documento che cambia i costi (arrivo merce, fattura letta). */
  invalida(): void {
    this.caricamento = null;
    this.costi.set(new Map());
  }
}
