import { effect, inject, Injector, runInInjectionContext } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { I18nService } from './services/i18n.service';

/**
 * Etichette del paginatore nella lingua dell'interfaccia.
 *
 * Erano fisse in italiano: con la UI in inglese o tedesco ogni elenco mostrava
 * comunque "Elementi per pagina" e "1–25 di 200". Qui seguono `I18nService` e,
 * grazie a `changes`, si aggiornano subito quando la lingua cambia — senza
 * riavviare l'app.
 */
export function localizedPaginatorIntl(): MatPaginatorIntl {
  const intl = new MatPaginatorIntl();
  const i18n = inject(I18nService);
  const injector = inject(Injector);

  const applica = () => {
    intl.itemsPerPageLabel = i18n.t('paginator.itemsPerPage');
    intl.nextPageLabel = i18n.t('paginator.next');
    intl.previousPageLabel = i18n.t('paginator.previous');
    intl.firstPageLabel = i18n.t('paginator.first');
    intl.lastPageLabel = i18n.t('paginator.last');
    intl.getRangeLabel = (page: number, pageSize: number, length: number): string => {
      if (length === 0 || pageSize === 0) return i18n.t('paginator.rangeZero', { total: length });
      const start = page * pageSize;
      const end = Math.min(start + pageSize, length);
      return i18n.t('paginator.range', { start: start + 1, end, total: length });
    };
  };

  runInInjectionContext(injector, () => {
    effect(() => {
      i18n.lang();          // dipendenza: rilegge a ogni cambio lingua
      applica();
      intl.changes.next();  // i paginatori già montati ridisegnano le etichette
    });
  });

  return intl;
}

/** Nome storico, mantenuto per non toccare gli import esistenti. */
export const italianPaginatorIntl = localizedPaginatorIntl;
