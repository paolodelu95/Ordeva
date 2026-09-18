import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { lsGet, lsSet } from '../utils/safe-storage';

/**
 * Preferenze dell'interfaccia che devono sopravvivere a un cambio di PC.
 *
 * Stanno nel localStorage della WebView, cioè fuori dal database e quindi
 * fuori dal backup: ripristinando su un computer nuovo l'app tornava con tema,
 * lingua, menu, colonne e widget di fabbrica. Qui se ne tiene una copia nella
 * tabella `preferenze_ui` dell'archivio (che il backup include) e, dopo un
 * ripristino, la si riapplica.
 *
 * Restano fuori di proposito: token di accesso, consenso cookie, bozze dei
 * documenti (appunti del momento) e i flag del primo avvio, che su un PC nuovo
 * devono ripartire da zero.
 */
const CHIAVI: readonly string[] = [
  'ui-lang',                    // lingua dell'interfaccia
  'nav-layout',                 // barra laterale / superiore / fluttuante
  'ui-density',                 // compatta / comoda
  'dark-mode',                  // tema
  'dashboard-widgets-v3',       // widget della dashboard: quali e in che ordine
  'prodotto-prezzo-mode',       // prezzi netti o ivati nella scheda prodotto
  'prodotti-prezzi-vista',      // e nell'elenco prodotti
  'ordeva-update-prefs',        // preferenze aggiornamenti
  'ordeva_onboarding_done',     // checklist iniziale completata
  'ordeva_onboarding_dismissed',
  'sdi-passive-seen',           // fatture passive già lette
  'agenda-promemoria-fired',    // promemoria già scattati…
  'agenda-promemoria-dismessi', // …e già chiusi: non devono ripartire
];
const PREFISSI: readonly string[] = [
  'cols_',                      // colonne scelte in ogni tabella
  'import_mapping_',            // mappature delle colonne di import da Excel
  'view-state:',                // filtri e ordinamenti ricordati per sezione
];

/** Risposta di POST backup/restore. */
export interface RispostaRipristino {
  success: boolean;
  /** Allegati rimessi su disco dal backup (0 per i backup meno recenti). */
  allegati?: number;
  /** La cartella di backup del PC di provenienza qui non esiste: backup automatico in pausa. */
  cartellaBackupMancante?: boolean;
}

/** Riepilogo del ripristino da mostrare dopo il ricaricamento. */
export interface EsitoRipristino {
  allegati: number;
  preferenze: number;
  cartellaBackupMancante: boolean;
}

/** sessionStorage: sopravvive al ricaricamento che segue il ripristino. */
const CHIAVE_ESITO = 'ordeva-esito-ripristino';

/** True se la chiave è una preferenza che segue l'archivio nel backup. */
export function preferenzaGestita(chiave: string): boolean {
  return CHIAVI.includes(chiave) || PREFISSI.some(p => chiave.startsWith(p));
}

@Injectable({ providedIn: 'root' })
export class PreferenzeSyncService {
  private api = inject(ApiService);

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Ultimo stato mandato al server (JSON), per mandare solo le differenze. */
  private ultimoInviato: Record<string, string> | null = null;
  private inVolo: Promise<void> | null = null;
  private sospeso = false;

  /**
   * Avvia il mirroring: allineamento subito, poi un controllo ogni 30 secondi
   * (costa una lettura del localStorage; la rete si usa solo se qualcosa è
   * cambiato). Le scritture sono sparse in tutta l'app, alcune dirette su
   * localStorage: controllare lo stato è più robusto che inseguirle una a una.
   */
  avvia() {
    if (this.timer) return;
    void this.invia(true);
    this.timer = setInterval(() => void this.invia(), 30_000);
  }

  /** Istantanea delle preferenze gestite presenti nel localStorage. */
  private istantanea(): Record<string, string> {
    const out: Record<string, string> = {};
    let chiavi: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && preferenzaGestita(k)) chiavi.push(k);
      }
    } catch {
      // Storage non accessibile: si ripiega sulle chiavi note (lsGet ha il fallback in memoria).
      chiavi = [...CHIAVI];
    }
    for (const k of chiavi) {
      const v = lsGet(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  /**
   * Manda al server le preferenze cambiate. `completo` (all'avvio) confronta con
   * quanto c'è sul server, così vengono tolte anche le chiavi eliminate qui
   * mentre l'app era chiusa; altrimenti si confronta con l'ultimo invio.
   */
  invia(completo = false): Promise<void> {
    if (this.sospeso) return Promise.resolve();
    if (this.inVolo) return this.inVolo;
    // Il rilascio sta in un .finally() sulla promessa già assegnata: se il giro
    // non trova differenze finisce senza mai attendere, e un finally interno
    // azzererebbe `inVolo` PRIMA dell'assegnazione, lasciandolo occupato per
    // sempre da una promessa risolta (e il mirroring fermo).
    const giro: Promise<void> = this.allinea(completo)
      .finally(() => { if (this.inVolo === giro) this.inVolo = null; });
    this.inVolo = giro;
    return giro;
  }

  private async allinea(completo: boolean): Promise<void> {
    try {
      const ora = this.istantanea();
      let riferimento = this.ultimoInviato;
      if (completo || !riferimento) {
        riferimento = await firstValueFrom(this.api.get<Record<string, string>>('preferenze'));
      }
      const corpo: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(ora)) {
        if (riferimento?.[k] !== v) corpo[k] = v;
      }
      for (const k of Object.keys(riferimento ?? {})) {
        if (preferenzaGestita(k) && !(k in ora)) corpo[k] = null;
      }
      // Ricontrollo: un ripristino può essere partito mentre si leggeva.
      if (this.sospeso) return;
      if (Object.keys(corpo).length) {
        await firstValueFrom(this.api.put('preferenze', corpo));
      }
      this.ultimoInviato = ora;
    } catch {
      // Riproverà al prossimo giro: una preferenza non salvata non è un errore da mostrare.
    }
  }

  /**
   * Da chiamare PRIMA di un ripristino: ferma il mirroring e aspetta un
   * eventuale invio in corso, che altrimenti potrebbe arrivare dopo e scrivere
   * le preferenze di questo PC sopra quelle appena ripristinate.
   */
  async sospendi(): Promise<void> {
    this.sospeso = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.inVolo) { try { await this.inVolo; } catch { /* già gestito */ } }
  }

  /** Riprende il mirroring dopo un ripristino fallito (il database non è cambiato). */
  riprendi() {
    this.sospeso = false;
    this.avvia();
  }

  /**
   * Da chiamare DOPO un ripristino riuscito e prima di ricaricare: le preferenze
   * del backup vincono su quelle di questo PC, così l'app riparte identica.
   * Ritorna il numero di preferenze riapplicate.
   */
  async applicaDaRipristino(): Promise<number> {
    await this.sospendi();
    try {
      const dalBackup = await firstValueFrom(this.api.get<Record<string, string>>('preferenze'));
      let n = 0;
      for (const [k, v] of Object.entries(dalBackup ?? {})) {
        if (!preferenzaGestita(k) || typeof v !== 'string') continue;
        lsSet(k, v);
        n++;
      }
      return n;
    } catch {
      // Backup anteriore alla copia delle preferenze: resta l'aspetto attuale.
      return 0;
    }
  }

  /**
   * Chiude un ripristino riuscito: riapplica le preferenze del backup e lascia
   * il riepilogo per dopo il ricaricamento (vedi `prendiEsitoRipristino`).
   * Il chiamante ricarica subito dopo.
   */
  async concludiRipristino(r: RispostaRipristino): Promise<void> {
    const preferenze = await this.applicaDaRipristino();
    const esito: EsitoRipristino = {
      allegati: r?.allegati ?? 0,
      preferenze,
      cartellaBackupMancante: !!r?.cartellaBackupMancante,
    };
    try { sessionStorage.setItem(CHIAVE_ESITO, JSON.stringify(esito)); } catch { /* niente riepilogo */ }
  }

  /** Riepilogo dell'ultimo ripristino, restituito una volta sola. */
  prendiEsitoRipristino(): EsitoRipristino | null {
    try {
      const s = sessionStorage.getItem(CHIAVE_ESITO);
      if (!s) return null;
      sessionStorage.removeItem(CHIAVE_ESITO);
      return JSON.parse(s) as EsitoRipristino;
    } catch {
      return null;
    }
  }
}
