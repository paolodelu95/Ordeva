import { DestroyRef } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CityResult, CityService, normalizzaComune } from './city.service';

/** I campi indirizzo che il compilatore legge e scrive (anche assenti o null). */
export interface CampiIndirizzo {
  citta?: string | null;
  cap?: string | null;
  provincia?: string | null;
  stato?: string | null;
}

/**
 * Compila CAP e provincia dalla città, e la città dal CAP, per un modulo
 * indirizzo qualsiasi (reactive form o ngModel: si passano due funzioni per
 * leggere e scrivere i campi). Un'istanza per modulo.
 *
 *  · scrivendo la città: `suggerimenti` per la tendina;
 *  · scegliendo un comune (tendina o ricerca): CAP e provincia. Se il comune ha
 *    più CAP (Roma, Milano…) il CAP non si inventa: `capSuggeriti` li propone;
 *  · uscendo dalla città senza scegliere: se il nome è esattamente un comune,
 *    compila lo stesso — chi scrive "Bergamo" e va avanti non deve cercarlo;
 *  · scrivendo il CAP: se è di un comune solo e la città è vuota, la compila;
 *    se è condiviso, i comuni che lo usano diventano i suggerimenti della città.
 */
export class CompilatoreComune {
  suggerimenti: CityResult[] = [];
  capSuggeriti: string[] = [];

  private citta$ = new Subject<string>();
  private cap$ = new Subject<string>();

  constructor(
    private city: CityService,
    private leggi: () => CampiIndirizzo,
    private scrivi: (patch: Partial<CampiIndirizzo>) => void,
    destroyRef: DestroyRef,
  ) {
    this.citta$.pipe(
      debounceTime(150), distinctUntilChanged(),
      switchMap(v => this.city.searchCities(v)),
      takeUntilDestroyed(destroyRef),
    ).subscribe(r => this.suggerimenti = r);

    this.cap$.pipe(
      debounceTime(250), distinctUntilChanged(),
      switchMap(v => this.city.lookupByCap(v)),
      takeUntilDestroyed(destroyRef),
    ).subscribe(r => this.daCap(r));
  }

  /** I CAP del comune scelto che iniziano con quanto già scritto nel campo. */
  capFiltrati(scritto: string | null | undefined): string[] {
    const s = (scritto ?? '').trim();
    return s ? this.capSuggeriti.filter(c => c.startsWith(s)) : this.capSuggeriti;
  }

  /** Da chiamare a ogni modifica del campo città. */
  cittaCambiata(v: string | null) { this.citta$.next((v ?? '').trim()); }

  /** Da chiamare a ogni modifica del campo CAP. */
  capCambiato(v: string | null) { this.cap$.next((v ?? '').trim()); }

  /** Comune scelto: città, CAP (se è uno) e provincia. */
  scegli(r: CityResult) {
    const attuali = this.leggi();
    this.capSuggeriti = r.caps.length > 1 ? r.caps : [];
    // Un CAP già scritto e valido per quel comune resta: magari è quello della via.
    const scritto = (attuali.cap ?? '').trim();
    const cap = r.caps.includes(scritto) ? scritto : (r.cap || (r.caps.length > 1 ? '' : scritto));
    this.applica({ citta: r.name, cap, provincia: r.provincia, stato: 'Italia' });
  }

  /** Uscita dal campo città: se il testo è esattamente un comune, compila. */
  async completa() {
    const citta = this.leggi().citta ?? '';
    if (!normalizzaComune(citta)) return;
    const trovati = await firstValueFrom(this.city.trova(citta));
    const comuni = trovati.filter(r => !r.localita);
    const candidati = comuni.length ? comuni : trovati;
    // Omonimi in province diverse: meglio lasciar scegliere dalla tendina.
    if (candidati.length === 1) this.scegli(candidati[0]);
  }

  private daCap(trovati: CityResult[]) {
    if (!trovati.length) return;
    const attuali = this.leggi();
    const citta = normalizzaComune(attuali.citta);
    const stessa = trovati.find(r => normalizzaComune(r.name) === citta);
    if (stessa) {
      // Città già giusta: al più si completa la provincia, senza correggere
      // quella scritta a mano (e senza "sporcare" un modulo appena caricato).
      if (!attuali.provincia) this.applica({ provincia: stessa.provincia });
      return;
    }
    const comuni = trovati.filter(r => !r.localita);
    const candidati = comuni.length ? comuni : trovati;
    if (!citta && candidati.length === 1) {
      this.applica({ citta: candidati[0].name, provincia: candidati[0].provincia, stato: 'Italia' });
      return;
    }
    // CAP di più comuni, o città già scritta diversa: la si lascia com'è e si
    // propongono i comuni del CAP nella tendina della città.
    this.suggerimenti = candidati.slice(0, 10);
    const province = new Set(candidati.map(r => r.provincia));
    if (!attuali.provincia && province.size === 1) this.applica({ provincia: candidati[0].provincia });
  }

  /** Scrive solo i campi che cambiano davvero (niente modulo "modificato" per nulla). */
  private applica(patch: Partial<CampiIndirizzo>) {
    const attuali = this.leggi() as unknown as Record<string, unknown>;
    const diff: Partial<CampiIndirizzo> = {};
    for (const [k, v] of Object.entries(patch) as [keyof CampiIndirizzo, string][]) {
      if (v !== undefined && (attuali[k] ?? '') !== v) diff[k] = v;
    }
    if (Object.keys(diff).length) this.scrivi(diff);
  }
}
