import { MatDialog } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { ProdottoDialogComponent } from '../components/prodotti/prodotti';
import { DataService } from '../services/data.service';
import { Prodotto } from '../models';

/** Dati minimi della riga del documento usati per precompilare il nuovo prodotto. */
export interface RigaProdottoPrefill {
  codiceProdotto?: string | null;
  descrizione?: string | null;
  prezzo?: number | null;
  iva?: number | null;
  unitaMisura?: string | null;
}

/**
 * Apre il dialog di creazione prodotto — lo stesso usato nella schermata Prodotti —
 * precompilato coi dati digitati nella riga del documento, senza chiudere il documento.
 *
 * Se l'utente conferma, crea il prodotto e restituisce l'oggetto creato (con `id`);
 * se annulla, emette `null`. Eventuali errori di salvataggio propagano al subscriber.
 */
export function creaProdottoDaRiga(
  dialog: MatDialog,
  ds: DataService,
  riga: RigaProdottoPrefill,
): Observable<Prodotto | null> {
  const descr = (riga.descrizione ?? '').toString().trim();
  const codice = (riga.codiceProdotto ?? '').toString().trim();
  const prefill: Partial<Prodotto> = {
    // Il codice è obbligatorio: se la riga non ne porta uno resta la descrizione,
    // che è comunque quello che l'utente ha digitato per identificare l'articolo.
    codice: codice || descr,
    descrizione: descr,
    prezzo: riga.prezzo ?? 0,
    iva: riga.iva ?? 22,
    unitaMisura: riga.unitaMisura || 'pz',
  };
  return dialog.open(ProdottoDialogComponent, { data: prefill, width: '95vw', maxWidth: '900px' })
    .afterClosed()
    .pipe(
      switchMap((result: any) => {
        if (!result) return of(null);
        return ds.createProdotto(result).pipe(map((r: any) => ({ ...result, id: r.id }) as Prodotto));
      }),
    );
}
