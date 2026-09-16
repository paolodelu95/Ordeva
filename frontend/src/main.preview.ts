/**
 * Bootstrap SEPARATO dell'HARNESS DI ANTEPRIMA. Non fa parte dell'app di produzione:
 * lo compila solo la configurazione `preview` (vedi angular.json).
 *
 * Tre modalità, decise dai parametri dell'URL:
 *
 *   (nessun parametro)  → GALLERIA: chrome esterno con l'elenco di tutte le schermate,
 *                         i selettori dati/schermo/tema e l'app vera dentro un iframe.
 *   ?app=1              → APP REALE con l'HTTP finto: tutte le chiamate `/api/…`
 *                         rispondono dalle fixture, così ogni rotta è ispezionabile
 *                         senza il backend Rust.
 *   ?doc=<tipo>         → vecchio harness dei dialog documento (invariato).
 *
 * Avvio: `npm start -- --configuration preview` oppure la voce "frontend-preview"
 * di .claude/launch.json (porta 4300).
 */
import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { ErrorHandler, LOCALE_ID, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localeIt from '@angular/common/locales/it';
import localeEn from '@angular/common/locales/en-GB';
import localeDe from '@angular/common/locales/de';
import localeEs from '@angular/common/locales/es';
import localeFr from '@angular/common/locales/fr';
import { linguaSalvata, localeMateriale } from './app/utils/locale-avvio';

import { PreviewHostComponent } from './preview/preview-host';
import { DataService } from './app/services/data.service';
import { createMockDataService } from './preview/mock-data';
import { creaMockHttpInterceptor, opzioniDaUrl } from './preview/mock-http.interceptor';
import { montaGalleria } from './preview/gallery';
import { App } from './app/app';
import { routes } from './app/app.routes';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { localizedPaginatorIntl } from './app/it-paginator-intl';
import { GlobalErrorHandler } from './app/services/global-error-handler';

registerLocaleData(localeIt);
registerLocaleData(localeEn, 'en-GB');
registerLocaleData(localeDe, 'de');
registerLocaleData(localeEs, 'es');
registerLocaleData(localeFr, 'fr');
const LINGUA = linguaSalvata();
const LOCALE_ANGULAR: Record<string, string> = { it: 'it', en: 'en-GB', de: 'de', es: 'es', fr: 'fr' };

const params = new URLSearchParams(location.search);
const opzioni = opzioniDaUrl(location.search);
const mock = creaMockHttpInterceptor(opzioni);

/** Provider comuni alle due modalità Angular (specchio di app.config, senza service worker). */
const comuni = [
  provideBrowserGlobalErrorListeners(),
  // Come in produzione: lo stato dati "Scritture KO" serve proprio a verificarlo.
  { provide: ErrorHandler, useClass: GlobalErrorHandler },
  provideZoneChangeDetection({ eventCoalescing: true }),
  provideHttpClient(withInterceptors([authInterceptor, mock])),
  provideAnimationsAsync(),
  provideNativeDateAdapter(),
  { provide: LOCALE_ID, useValue: LOCALE_ANGULAR[LINGUA] },
  { provide: MAT_DATE_LOCALE, useValue: localeMateriale(LINGUA) },
  { provide: MatPaginatorIntl, useFactory: localizedPaginatorIntl },
  { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
  // Disabilitato, ma il provider serve: `App` inietta `SwUpdate` e senza questo
  // il bootstrap fallisce con NG0201 e la pagina resta bianca.
  provideServiceWorker('ngsw-worker.js', { enabled: false }),
];

/** Il tema lo decide la galleria, ma passa dalla chiave che usa l'app stessa. */
function applicaTema() {
  const scuro = params.get('dark') === '1';
  try { localStorage.setItem('dark-mode', scuro ? '1' : '0'); } catch { /* storage bloccato */ }
  document.body.classList.toggle('dark-mode', scuro);
}

if (params.has('doc')) {
  // ── Modalità 1: harness dei dialog documento (comportamento storico) ────────
  applicaTema();
  bootstrapApplication(PreviewHostComponent, {
    providers: [
      ...comuni,
      { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { maxWidth: '95vw', autoFocus: false } },
      { provide: DataService, useFactory: createMockDataService },
    ],
  }).catch((err) => console.error(err));
} else if (params.get('app') === '1') {
  // ── Modalità 2: l'app vera, con il backend finto ───────────────────────────
  applicaTema();
  bootstrapApplication(App, {
    providers: [
      ...comuni,
      provideRouter(routes),
      { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { maxWidth: '95vw', autoFocus: 'dialog', restoreFocus: true } },
    ],
  }).catch((err) => console.error(err));
} else {
  // ── Modalità 3: la galleria (DOM puro, l'app vive nell'iframe) ─────────────
  montaGalleria();
}
