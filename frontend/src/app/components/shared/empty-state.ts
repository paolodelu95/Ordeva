import { Component, Input, booleanAttribute, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { I18nService } from '../../services/i18n.service';

/**
 * Stato vuoto coerente per liste e sezioni.
 * Sostituisce i `<p class="empty-msg">Nessun…</p>` testuali: invece di un vicolo
 * cieco, mostra icona + titolo + spiegazione + (opzionale) azione primaria.
 *
 * Uso:
 *   <app-empty-state icon="people" title="Ancora nessun cliente"
 *                    message="Crea il primo cliente per iniziare a fatturare.">
 *     <button mat-flat-button color="primary" (click)="nuovo()">
 *       <mat-icon>add</mat-icon> Nuovo cliente
 *     </button>
 *   </app-empty-state>
 *
 * Variante compatta (per sotto-liste dentro card/tab):
 *   <app-empty-state compact icon="receipt" title="Nessun pagamento" />
 *
 * Variante ERRORE: quando il caricamento fallisce la lista NON è vuota, è
 * sconosciuta. Mostrare lo stato vuoto in quel caso è peggio che non mostrare
 * nulla — l'utente legge "Ancora nessuna fattura" e crede di aver perso i dati.
 *   <app-empty-state error icon="cloud_off" [title]="…" [message]="…" />
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="empty-state" [class.compact]="compact" [class.errore]="error">
      <div class="es-icon"><mat-icon>{{ icon }}</mat-icon></div>
      <div class="es-title">{{ title }}</div>
      @if (message) { <div class="es-message">{{ message }}</div> }
      <div class="es-actions">
        <ng-content></ng-content>
        @if (error) {
          <button mat-stroked-button type="button" (click)="riprova()">
            <mat-icon>refresh</mat-icon> {{ i18n.t('comune.riprova') }}
          </button>
        }
      </div>
    </div>`,
  styles: [`
    :host { display: block; width: 100%; }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      padding: 48px 24px; gap: 6px;
      /* Riempie verticalmente quando la lista è vuota, restando responsive:
         su schermi alti occupa lo spazio disponibile, su schermi bassi/mobile ha un minimo. */
      min-height: max(260px, calc(100dvh - 420px));
    }
    .es-icon {
      width: 64px; height: 64px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--primary-soft); color: var(--primary);
      margin-bottom: 10px;
    }
    /* L'errore non è un vuoto: colore d'allerta, così non si confondono. */
    .empty-state.errore .es-icon { background: var(--danger-soft); color: var(--danger-on); }
    .empty-state.errore .es-message { color: var(--text-secondary); }
    .es-icon mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .es-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .es-message {
      font-size: 13.5px; color: var(--text-tertiary); max-width: 340px; line-height: 1.5;
    }
    .es-actions:empty { display: none; }
    .es-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

    /* Variante compatta per sotto-liste / widget: resta piccola */
    .empty-state.compact { padding: 28px 16px; min-height: 0; }
    /* Su mobile riduco un po' l'altezza minima per evitare scroll eccessivo */
    @media (max-width: 767px) {
      .empty-state:not(.compact) { min-height: max(220px, calc(100dvh - 320px)); }
    }
    .empty-state.compact .es-icon { width: 44px; height: 44px; margin-bottom: 6px; }
    .empty-state.compact .es-icon mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .empty-state.compact .es-title { font-size: 14px; }
    .empty-state.compact .es-message { font-size: 12.5px; }
  `],
})
export class EmptyStateComponent {
  readonly i18n = inject(I18nService);
  @Input() icon = 'inbox';
  @Input() title = '';
  @Input() message = '';
  @Input({ transform: booleanAttribute }) compact = false;
  /** Stato di ERRORE di caricamento, non di elenco vuoto. */
  @Input({ transform: booleanAttribute }) error = false;

  /** Ricarica la SPA: è il modo più semplice per ritentare tutte le letture. */
  riprova() { location.reload(); }
}
