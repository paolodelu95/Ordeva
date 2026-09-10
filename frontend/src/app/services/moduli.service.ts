import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { DataService } from './data.service';
import { ModuloDto } from '../models';
import { environment } from '../../environments/environment';

/**
 * Stato globale dei moduli attivi per il tenant corrente.
 * Caricato al login (post-app init) e ricaricato dopo modifiche in Impostazioni.
 *
 * Mappa route → modulo:
 *   /preventivi /ordini /ddt /fatture /note-credito             → 'vendite' (core)
 *   /fatture-ricorrenti                                         → 'fatture_ricorrenti'
 *   /vendita-banco                                              → 'vendita_banco'
 *   /acquisti /arrivi-merce                                     → 'acquisti' (core)
 *   /prodotti /magazzino                                        → 'magazzino' (core)
 *   /clienti /fornitori                                         → 'anagrafica' (core)
 *   /pagamenti /scadenzario /prima-nota                         → 'contabilita' (core)
 *   /riconciliazione                                            → 'riconciliazione'
 *   /compliance                                                 → 'compliance'
 */
@Injectable({ providedIn: 'root' })
export class ModuliService {
  private readonly _attivi$ = new BehaviorSubject<Set<string>>(new Set());
  readonly attivi$ = this._attivi$.asObservable();

  constructor(private ds: DataService) {}

  /** Carica moduli dal backend e popola il set. */
  load(force = false): Observable<ModuloDto[]> {
    return this.ds.getModuli(force).pipe(
      tap(list => {
        const s = new Set<string>();
        for (const m of list) if (m.attivo) s.add(m.slug);
        this._attivi$.next(s);
      }),
      catchError(() => of([])),
    );
  }

  /** Reset (es. al logout). */
  reset() { this._attivi$.next(new Set()); }

  /** Snapshot sincrono dei moduli attivi. Offline: tutto sbloccato (single-user). */
  isAttivo(slug: string): boolean { return environment.offline || this._attivi$.value.has(slug); }

  /** Mappa route → modulo slug. Restituisce '' se la route non è gestita (= sempre visibile). */
  routeModulo(route: string): string {
    const map: Record<string, string> = {
      '/preventivi': 'vendite', '/ordini': 'vendite', '/ddt': 'vendite',
      '/fatture': 'vendite', '/note-credito': 'vendite',
      '/fatture-elettroniche': 'vendite', '/listini': 'vendite',
      '/fatture-ricorrenti': 'fatture_ricorrenti',
      '/vendita-banco': 'vendita_banco',
      '/acquisti': 'acquisti', '/arrivi-merce': 'acquisti', '/ordini-fornitore': 'acquisti',
      '/ocr-fatture': 'acquisti', '/sdi-passive': 'acquisti', '/autofatture': 'acquisti',
      '/prodotti': 'magazzino', '/magazzino': 'magazzino',
      '/clienti': 'anagrafica', '/fornitori': 'anagrafica',
      '/pagamenti': 'contabilita', '/scadenzario': 'contabilita', '/prima-nota': 'contabilita',
      '/riconciliazione': 'riconciliazione',
      '/compliance': 'compliance',
      '/agenda': 'agenda',
    };
    return map[route] || '';
  }

  /** Helper: una route è abilitata? (true se non mappata o se il modulo è attivo) */
  routeAbilitata(route: string): boolean {
    const m = this.routeModulo(route);
    return !m || this.isAttivo(m);
  }
}
