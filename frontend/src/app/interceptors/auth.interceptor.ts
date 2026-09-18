import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { OfflineService } from '../services/offline.service';
import { environment } from '../../environments/environment';

/**
 * Richiesta verso un servizio di terzi (URL assoluto su un'altra origine, che
 * non è la nostra API): non deve ricevere il token di sessione, né contare per
 * lo stato "backend raggiungibile". Prima il token partiva con qualsiasi
 * richiesta, e a chi non gestisce il preflight CORS la chiamata falliva.
 */
function esterna(url: string): boolean {
  if (!/^https?:\/\//i.test(url) || url.startsWith(environment.apiUrl)) return false;
  try { return new URL(url).origin !== window.location.origin; } catch { return false; }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (esterna(req.url)) return next(req);
  const auth = inject(AuthService);
  const offlineSvc = inject(OfflineService);
  const token = auth.getToken();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    tap(() => offlineSvc.reportReachable()),
    catchError(err => {
      // status 0 = errore di rete (backend irraggiungibile o richiesta annullata):
      // segnalo con soglia anti falsi-positivi. Qualsiasi risposta del server (anche
      // di errore) significa invece che è raggiungibile.
      if (err.status === 0) offlineSvc.reportNetworkError();
      else offlineSvc.reportReachable();
      // Sessione scaduta/revocata sul nostro backend: logout + reset pulito allo
      // stato di login. Solo se c'era davvero un token (evita loop al bootstrap)
      // e non sui login falliti (/auth/), che gestisce la pagina di accesso.
      if (err.status === 401 && token && !req.url.includes('/auth/')) {
        auth.logout();
        if (typeof window !== 'undefined') window.location.assign('/');
      }
      return throwError(() => err);
    })
  );
};
