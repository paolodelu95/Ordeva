import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { OfflineService } from '../services/offline.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
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
