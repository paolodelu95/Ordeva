import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { map } from 'rxjs/operators';

export interface CityResult {
  name: string;
  /** CAP da scrivere nel campo: vuoto se il comune ne ha più d'uno (va scelto) o nessuno noto. */
  cap: string;
  /** Tutti i CAP noti del comune o della località. */
  caps: string[];
  provincia: string;
  /** Frazione o località, non un comune. */
  localita: boolean;
}

interface Voce extends CityResult {
  chiave: string;
  chiaveAlt: string;
  attaccata: string;
  ridotta: string;
}

/** Particelle che nell'uso si omettono: "Reggio Emilia" per "Reggio nell'Emilia". */
const PARTICELLE = new Set(['di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'd', 'de', 'nel', 'nell', 'nella',
  'sul', 'sull', 'sulla', 'in', 'e', 'ed', 'con', 'al', 'all', 'allo', 'alla', 'a', 'da', 'dal', 'dalla']);
const senzaParticelle = (chiave: string) => chiave.split(' ').filter(w => !PARTICELLE.has(w)).join(' ');

/** Minuscole, senza accenti né apostrofi: "Forlì" = "forli", "Sant'Elpidio" = "sant elpidio". */
export function normalizzaComune(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’`.]/g, ' ').replace(/[-/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function voci(testo: string, localita: boolean): Voce[] {
  return testo.split('\n').map(riga => {
    const [nome, provincia, capTesto, alt = ''] = riga.split('|');
    const caps = capTesto ? capTesto.split(',') : [];
    const chiave = normalizzaComune(nome);
    return {
      name: nome, provincia, caps, localita,
      cap: caps.length === 1 ? caps[0] : '',
      chiave, chiaveAlt: normalizzaComune(alt), attaccata: chiave.replace(/ /g, ''),
      ridotta: senzaParticelle(chiave),
    };
  });
}

/** Il risultato "pubblico", senza le chiavi di ricerca. */
function risultato(v: Voce): CityResult {
  return { name: v.name, cap: v.cap, caps: v.caps, provincia: v.provincia, localita: v.localita };
}

/**
 * Comuni italiani con CAP e provincia, da un elenco locale (ISTAT + GeoNames,
 * vedi data/comuni-cap.ts): funziona senza internet e non manda a terzi quello
 * che l'utente scrive. Prima si interrogavano OpenStreetMap e zippopotam, che per
 * molti comuni non restituivano il CAP e fuori rete non rispondevano affatto.
 *
 * L'elenco (~400 KB) si carica alla prima ricerca, in un pezzo separato del
 * bundle: chi non apre mai un'anagrafica non lo scarica.
 */
@Injectable({ providedIn: 'root' })
export class CityService {
  private indice: Promise<Voce[]> | null = null;

  private carica(): Promise<Voce[]> {
    this.indice ??= import('../data/comuni-cap').then(m => [...voci(m.COMUNI, false), ...voci(m.LOCALITA, true)]);
    return this.indice;
  }

  /**
   * Comuni (poi località) il cui nome contiene il testo, i più pertinenti prima:
   * nome identico, poi che inizia così, poi con una parola che inizia così.
   */
  searchCities(query: string, max = 10): Observable<CityResult[]> {
    const q = normalizzaComune(query);
    if (q.length < 2) return of([]);
    const qa = q.replace(/ /g, '');
    const qr = senzaParticelle(q);
    return from(this.carica()).pipe(map(tutte => {
      const trovate: { v: Voce; punti: number }[] = [];
      for (const v of tutte) {
        const p = Math.min(this.punteggio(v.chiave, q), this.punteggio(v.chiaveAlt, q),
          v.attaccata.startsWith(qa) ? 1.5 : 9, qr && v.ridotta.startsWith(qr) ? 1.5 : 9);
        if (p < 9) trovate.push({ v, punti: p + (v.localita ? 0.5 : 0) });
      }
      trovate.sort((a, b) => a.punti - b.punti || a.v.name.length - b.v.name.length
        || a.v.name.localeCompare(b.v.name, 'it'));
      return trovate.slice(0, max).map(t => risultato(t.v));
    }));
  }

  private punteggio(chiave: string, q: string): number {
    if (!chiave) return 9;
    if (chiave === q) return 0;
    if (chiave.startsWith(q)) return 1;
    if ((' ' + chiave).includes(' ' + q)) return 2;
    if (chiave.includes(q)) return 3;
    return 9;
  }

  /** Comuni (e poi località) che usano questo CAP. */
  lookupByCap(cap: string): Observable<CityResult[]> {
    if (!/^\d{5}$/.test(cap ?? '')) return of([]);
    return from(this.carica()).pipe(map(tutte => {
      const trovate = tutte.filter(v => v.caps.includes(cap));
      return [...trovate.filter(v => !v.localita), ...trovate.filter(v => v.localita)].map(risultato);
    }));
  }

  /**
   * Voci con questo nome, a meno di maiuscole, accenti, apostrofi, spazi e
   * particelle. Prima i nomi identici: solo se non ce ne sono si accettano
   * quelli "ridotti", che possono unire comuni diversi.
   */
  trova(nome: string): Observable<CityResult[]> {
    const q = normalizzaComune(nome);
    if (!q) return of([]);
    const qa = q.replace(/ /g, '');
    const qr = senzaParticelle(q);
    return from(this.carica()).pipe(map(tutte => {
      const esatte = tutte.filter(v => v.chiave === q || v.chiaveAlt === q || v.attaccata === qa);
      return (esatte.length ? esatte : tutte.filter(v => qr && v.ridotta === qr)).map(risultato);
    }));
  }
}
