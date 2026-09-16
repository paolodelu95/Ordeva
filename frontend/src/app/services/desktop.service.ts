import { Injectable } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { open as openShell } from '@tauri-apps/plugin-shell';

/**
 * Ponte verso le funzionalità desktop. Nell'edizione offline gira su Tauri e usa
 * i dialoghi/sistema nativi (plugin-dialog / plugin-shell). Su web `isDesktop` è
 * false e i metodi degradano a no-op, così l'UI nasconde i pulsanti che servono
 * solo nell'app desktop (es. "Sfoglia" cartella di backup).
 *
 * NB: storicamente questo ponte usava `window.ordevaDesktop` (preload Electron).
 * Con la migrazione a Tauri quel bridge non esiste più: i percorsi nativi qui
 * sotto lo sostituiscono; il vecchio ramo resta solo come fallback difensivo.
 */
@Injectable({ providedIn: 'root' })
export class DesktopService {
  private get legacy(): any {
    return (window as any).ordevaDesktop || null;
  }

  get isDesktop(): boolean {
    return isTauri() || !!this.legacy?.isDesktop;
  }

  /** Apre il selettore cartelle del sistema; ritorna il percorso scelto o null. */
  async pickFolder(): Promise<string | null> {
    if (isTauri()) {
      try {
        const sel = await openDialog({ directory: true, multiple: false });
        return typeof sel === 'string' ? sel : null;
      } catch { return null; }
    }
    if (!this.legacy?.pickFolder) return null;
    try { return await this.legacy.pickFolder(); } catch { return null; }
  }

  /** Apre il selettore di un file di backup (.db / .db.enc); ritorna il percorso o null. */
  async pickBackupFile(): Promise<string | null> {
    if (isTauri()) {
      try {
        const sel = await openDialog({
          multiple: false,
          filters: [{ name: 'Backup Ordeva', extensions: ['db', 'enc'] }],
        });
        return typeof sel === 'string' ? sel : null;
      } catch { return null; }
    }
    if (!this.legacy?.pickBackupFile) return null;
    try { return await this.legacy.pickBackupFile(); } catch { return null; }
  }

  /** Selettore "salva con nome" per esportare un archivio; ritorna il percorso o null. */
  async pickSaveDb(nomeSuggerito: string): Promise<string | null> {
    if (!isTauri()) return null;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const sel = await save({
        defaultPath: nomeSuggerito,
        filters: [{ name: 'Archivio Ordeva', extensions: ['db', 'enc'] }],
      });
      return sel || null;
    } catch { return null; }
  }

  /**
   * Apre un URL (http/https/mailto) con il gestore di sistema.
   * Ritorna `false` se non c'è un programma associato: il chiamante può dirlo
   * all'utente invece di lasciare un clic senza alcun effetto.
   */
  async openExternal(url: string): Promise<boolean> {
    if (isTauri()) {
      try { await openShell(url); return true; } catch { return false; }
    }
    try { return !!window.open(url, '_blank'); } catch { return false; }
  }

  /** Apre una cartella nel file manager del sistema. */
  async openPath(path: string): Promise<void> {
    if (!path) return;
    if (isTauri()) {
      try { await openShell(path); } catch { /* no-op */ }
      return;
    }
    if (!this.legacy?.openPath) return;
    try { await this.legacy.openPath(path); } catch { /* no-op */ }
  }

  /** Riavvia l'app (es. dopo aver spostato la cartella dati). No-op fuori da Tauri. */
  async relaunch(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch { /* no-op */ }
  }

  /** Chiude l'app. Usato dopo il flush per la "chiusura sicura" (sync Dropbox). */
  async exit(code = 0): Promise<void> {
    if (!isTauri()) return;
    try {
      const { exit } = await import('@tauri-apps/plugin-process');
      await exit(code);
    } catch { /* no-op */ }
  }

  /** True se Ordeva è impostata per avviarsi col login del sistema. */
  async isAutostart(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      const { isEnabled } = await import('@tauri-apps/plugin-autostart');
      return await isEnabled();
    } catch { return false; }
  }

  /** Abilita/disabilita l'avvio automatico col computer. */
  async setAutostart(on: boolean): Promise<void> {
    if (!isTauri()) return;
    try {
      const m = await import('@tauri-apps/plugin-autostart');
      if (on) await m.enable(); else await m.disable();
    } catch { /* no-op */ }
  }
}
