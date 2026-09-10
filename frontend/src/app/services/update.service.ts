import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export interface UpdateInfo {
  /** Versione disponibile (es. "1.2.0"). */
  version: string;
  /** Pagina della release su GitHub (fallback "scarica a mano"). */
  url: string;
}

const REPO = 'paolodelu95/Ordeva';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** Frequenza del controllo automatico aggiornamenti. */
export type UpdateInterval = 'avvio' | 'giorno' | 'settimana' | 'mai';

interface UpdatePrefs {
  intervallo: UpdateInterval;
  autoInstall: boolean;
  lastCheck: number;
}

const PREFS_KEY = 'ordeva-update-prefs';
const GIORNO_MS = 24 * 60 * 60 * 1000;

/**
 * Controllo + installazione aggiornamenti per l'edizione offline (Tauri).
 *
 * Usa il plugin updater di Tauri: `check()` legge `latest.json` dalla release più
 * recente (endpoint in tauri.conf.json), verifica la firma con la chiave pubblica
 * e, se c'è una versione più nuova, permette `downloadAndInstall()` + riavvio —
 * l'app si aggiorna da sola. Se non siamo in Tauri (es. dev su browser) o manca
 * la rete, fallisce in silenzio e resta il link "scarica a mano".
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  /** Aggiornamento disponibile (null = nessuno / non ancora controllato). */
  readonly disponibile = signal<UpdateInfo | null>(null);
  /** Versione attualmente installata (per il messaggio). */
  readonly corrente = signal<string>('');
  /** Download/installazione in corso. */
  readonly inCorso = signal(false);
  /** Dettaglio tecnico dell'ultimo errore di controllo (per diagnosi in UI). */
  readonly ultimoErrore = signal<string>('');

  /** Preferenze (persistite in localStorage): frequenza controllo + auto-installazione. */
  readonly intervallo = signal<UpdateInterval>('avvio');
  readonly autoInstall = signal(false);
  private lastCheck = 0;

  /**
   * Gestore esterno degli aggiornamenti ('snap', 'flatpak', 'pacchetto') quando
   * l'app è installata da uno store: lì il binario è di sola lettura e
   * l'aggiornamento non lo fa Ordeva. Vuoto = ci pensa l'updater interno.
   */
  readonly gestoreEsterno = signal<string>('');
  private gestoreLetto: Promise<string> | null = null;

  /** Oggetto Update di Tauri tenuto da parte tra check e install. */
  private pending: { version: string; currentVersion?: string; downloadAndInstall: (cb?: unknown) => Promise<void> } | null = null;

  constructor() {
    this.loadPrefs();
  }

  /**
   * Chiede al backend chi gestisce gli aggiornamenti. Una sola volta per sessione:
   * la risposta dipende dall'ambiente di esecuzione, che non cambia in corsa.
   */
  private async leggiGestore(): Promise<string> {
    if (!this.gestoreLetto) {
      this.gestoreLetto = fetch(`${environment.apiUrl}/sistema/aggiornamenti`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          const g = typeof j?.gestore === 'string' ? j.gestore : '';
          this.gestoreEsterno.set(g);
          return g;
        })
        .catch(() => '');
    }
    return this.gestoreLetto;
  }

  private loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<UpdatePrefs>;
      if (p.intervallo) this.intervallo.set(p.intervallo);
      this.autoInstall.set(!!p.autoInstall);
      this.lastCheck = typeof p.lastCheck === 'number' ? p.lastCheck : 0;
    } catch {
      /* preferenze illeggibili: si resta sui default */
    }
  }

  private savePrefs() {
    try {
      const prefs: UpdatePrefs = { intervallo: this.intervallo(), autoInstall: this.autoInstall(), lastCheck: this.lastCheck };
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* localStorage non disponibile: amen, le preferenze non persistono */
    }
  }

  setIntervallo(v: UpdateInterval) { this.intervallo.set(v); this.savePrefs(); }
  setAutoInstall(v: boolean) { this.autoInstall.set(v); this.savePrefs(); }

  /**
   * Controllo all'avvio dell'app: rispetta la frequenza scelta e, se trova una
   * versione nuova, mostra SOLO l'avviso col bottone "Aggiorna ora" (mai
   * installazione automatica all'avvio: aggiornarsi da soli mentre si lavora di
   * fretta è scomodo). L'aggiornamento parte quando lo decide l'utente.
   */
  async checkAuto(): Promise<void> {
    if (!environment.offline) return;
    if (await this.leggiGestore()) return;   // ci pensa lo store
    this.corrente.set(await this.versioneCorrente());
    if (!this.dovrebbeControllare()) return;
    await this.check();   // popola "disponibile" → compare il banner con il bottone
    this.lastCheck = Date.now();
    this.savePrefs();
  }

  /** Vero se è scaduto l'intervallo scelto dall'ultimo controllo automatico. */
  private dovrebbeControllare(): boolean {
    const trascorso = Date.now() - this.lastCheck;
    switch (this.intervallo()) {
      case 'mai':       return false;
      case 'giorno':    return trascorso >= GIORNO_MS;
      case 'settimana': return trascorso >= 7 * GIORNO_MS;
      case 'avvio':
      default:          return true;
    }
  }

  /**
   * Controllo aggiornamenti. No-op fuori dall'edizione offline.
   * Ritorna l'esito così la UI (es. il tasto "Verifica aggiornamenti" nella Home)
   * può dare un riscontro anche quando non c'è nulla da scaricare.
   */
  async check(): Promise<'disponibile' | 'aggiornato' | 'non-disponibile'> {
    if (!environment.offline) return 'non-disponibile';
    if (await this.leggiGestore()) {
      // Installata da uno store: proporre un aggiornamento che poi non può
      // riuscire (binario di sola lettura) sarebbe peggio che tacere.
      this.corrente.set(await this.versioneCorrente());
      return 'non-disponibile';
    }
    this.ultimoErrore.set('');
    this.corrente.set(await this.versioneCorrente());
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        this.pending = update as any;
        if (update.currentVersion) this.corrente.set(update.currentVersion);
        this.disponibile.set({ version: update.version, url: RELEASES_URL });
        return 'disponibile';
      }
      return 'aggiornato';
    } catch (e) {
      /* non in Tauri / updater non configurato / nessuna rete: nessun avviso in-app,
         ma teniamo il dettaglio tecnico per mostrarlo a richiesta (diagnosi). */
      this.ultimoErrore.set(String((e as { message?: string })?.message ?? e));
      return 'non-disponibile';
    }
  }

  /** Scarica e installa l'aggiornamento, poi riavvia l'app. */
  async installaERiavvia(): Promise<void> {
    if (!this.pending || this.inCorso()) return;
    this.inCorso.set(true);
    try {
      await this.pending.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      // Fallito (es. macOS non firmato): l'utente usa il link "scarica a mano".
      this.inCorso.set(false);
    }
  }

  /** Versione installata, letta da /healthz del backend locale. */
  private async versioneCorrente(): Promise<string> {
    try {
      const base = environment.apiUrl.replace(/\/api\/?$/, '');
      const res = await fetch(`${base}/healthz`);
      if (!res.ok) return '';
      const h = await res.json();
      return (h?.version ?? '').toString();
    } catch {
      return '';
    }
  }
}
