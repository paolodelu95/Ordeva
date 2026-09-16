import { ApplicationConfig, ErrorHandler, LOCALE_ID, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { localizedPaginatorIntl } from './it-paginator-intl';
import { GlobalErrorHandler } from './services/global-error-handler';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import localeEn from '@angular/common/locales/en-GB';
import localeDe from '@angular/common/locales/de';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import { linguaSalvata, localeMateriale } from './utils/locale-avvio';

// Tutte le lingue dell'interfaccia: senza registrarle, `LOCALE_ID` diverso da
// "it" farebbe esplodere le pipe date/number a runtime.
registerLocaleData(localeIt);
registerLocaleData(localeEn, 'en-GB');
registerLocaleData(localeDe, 'de');
registerLocaleData(localeEs, 'es');
registerLocaleData(localeFr, 'fr');

const LINGUA = linguaSalvata();
const LOCALE_ANGULAR: Record<string, string> = { it: 'it', en: 'en-GB', de: 'de', es: 'es', fr: 'fr' };

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Fa emergere gli errori HTTP che nessuno gestisce: senza, una scrittura
    // rifiutata dal server non produce alcun segnale a schermo.
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    // Seguono la lingua scelta in Impostazioni (erano fissi su italiano).
    { provide: LOCALE_ID, useValue: LOCALE_ANGULAR[LINGUA] },
    { provide: MAT_DATE_LOCALE, useValue: localeMateriale(LINGUA) },
    provideNativeDateAdapter(),
    // Tetto del 95vw a TUTTI i dialog: evita overflow orizzontale su mobile/tablet
    // anche per i dialog aperti con width fissa in px (senza toccarne le chiamate).
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { maxWidth: '95vw', autoFocus: 'dialog', restoreFocus: true } },
    // "outline" invece del default "fill": bordo sottile con l'etichetta incastonata
    // nel notch, non un riquadro a sfondo pieno — permette campi più bassi perché
    // l'etichetta non deve stare dentro l'altezza del riquadro (vedi styles.scss,
    // densità compatta desktop).
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
    { provide: MatPaginatorIntl, useFactory: localizedPaginatorIntl },
    provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          })
  ]
};
