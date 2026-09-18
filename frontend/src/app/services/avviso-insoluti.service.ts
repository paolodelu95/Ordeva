import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, map, of, shareReplay, take } from 'rxjs';
import { DataService } from './data.service';
import { I18nService } from './i18n.service';
import { Cliente, FatturaInsoluta, NotificheConfig } from '../models';
import {
  FattureInsoluteDialogComponent,
  SceltaAvvisoInsoluti,
} from '../components/shared/fatture-insolute-dialog';

export type TipoDocumentoAvviso = 'FATTURA' | 'DDT';

/** Default: avvisi accesi finché l'utente non li spegne. */
export function normalizzaNotifiche(cfg?: NotificheConfig | null): NotificheConfig {
  return {
    ...(cfg ?? {}),
    avvisoInsolutiDdt: cfg?.avvisoInsolutiDdt !== false,
    avvisoInsolutiFattura: cfg?.avvisoInsolutiFattura !== false,
  };
}

/**
 * Avviso "il cliente ha fatture da saldare" su nuove fatture e nuovi DDT.
 *
 * Un solo punto per le tre regole che decidono se mostrarlo:
 *  1. interruttore globale per tipo di documento (Impostazioni → Avvisi);
 *  2. esclusione del singolo cliente (`cliente.avvisoInsoluti === false`);
 *  3. almeno una fattura con residuo da incassare.
 * E per le due uscite dal dialog: spegnerlo per il cliente o per tutti.
 */
@Injectable({ providedIn: 'root' })
export class AvvisoInsolutiService {
  private ds = inject(DataService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private i18n = inject(I18nService);

  private config$?: Observable<NotificheConfig>;

  /** Configurazione avvisi dell'archivio, letta una volta e tenuta in cache. */
  config(): Observable<NotificheConfig> {
    this.config$ ??= this.ds.getAzienda().pipe(
      map(a => normalizzaNotifiche(a?.notificheConfig)),
      shareReplay(1),
    );
    return this.config$;
  }

  /** Da chiamare dopo aver cambiato la configurazione altrove (Impostazioni). */
  aggiornaCache(cfg: NotificheConfig) {
    this.config$ = of(normalizzaNotifiche(cfg));
  }

  /**
   * Mostra l'avviso se serve. Non blocca e non restituisce nulla: chi lo chiama
   * prosegue comunque, l'avviso è un'informazione, non una conferma.
   */
  controlla(tipo: TipoDocumentoAvviso, cliente: Cliente | null | undefined): void {
    if (!cliente?.id || cliente.avvisoInsoluti === false) return;
    this.config().pipe(take(1)).subscribe(cfg => {
      const acceso = tipo === 'DDT' ? cfg.avvisoInsolutiDdt : cfg.avvisoInsolutiFattura;
      if (!acceso) return;
      this.ds.getFattureInsoluteCliente(cliente.id!).subscribe({
        next: fatture => { if (fatture?.length) this.apri(cliente, fatture, cfg); },
        // Un errore di lettura non deve impedire di fare il documento.
        error: () => {},
      });
    });
  }

  private apri(cliente: Cliente, fatture: FatturaInsoluta[], cfg: NotificheConfig) {
    this.dialog
      .open<FattureInsoluteDialogComponent, unknown, SceltaAvvisoInsoluti>(FattureInsoluteDialogComponent, {
        data: { clienteNome: cliente.ragioneSociale || '', fatture },
        width: '600px',
        maxWidth: '98vw',
        panelClass: 'dialog-compact',
      })
      .afterClosed()
      .subscribe(scelta => {
        if (scelta === 'cliente') this.spegniPerCliente(cliente);
        else if (scelta === 'tutti') this.spegniPerTutti(cfg);
      });
  }

  /** Spegne l'avviso per un cliente (e aggiorna l'oggetto, così non riparte). */
  spegniPerCliente(cliente: Cliente) {
    if (!cliente.id) return;
    this.ds.setAvvisoInsolutiCliente(cliente.id, false).subscribe({
      next: () => {
        cliente.avvisoInsoluti = false;
        this.snack.open(
          this.i18n.t('shared.fattureInsolute.msg.spentoCliente', { nome: cliente.ragioneSociale }),
          'OK', { duration: 6000 },
        );
      },
      error: () => this.snack.open(this.i18n.t('shared.fattureInsolute.msg.errore'), '', { duration: 3500 }),
    });
  }

  /** Spegne l'avviso per tutti i clienti, su fatture e DDT insieme. */
  spegniPerTutti(cfg: NotificheConfig) {
    const nuovo: NotificheConfig = { ...cfg, avvisoInsolutiDdt: false, avvisoInsolutiFattura: false };
    this.ds.saveNotificheConfig(nuovo).subscribe({
      next: () => {
        this.aggiornaCache(nuovo);
        this.snack.open(this.i18n.t('shared.fattureInsolute.msg.spentoTutti'), 'OK', { duration: 6000 });
      },
      error: () => this.snack.open(this.i18n.t('shared.fattureInsolute.msg.errore'), '', { duration: 3500 }),
    });
  }
}
