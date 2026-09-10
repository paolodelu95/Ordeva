import { Injectable, inject } from '@angular/core';
import { I18nService } from './i18n.service';
import type { Prodotto } from '../models';

/**
 * Stampa di etichette prodotto con codice a barre.
 *
 * Il barcode l'app lo legge già (inventario, vendita al banco, ricerca): senza
 * poterlo stampare, però, restano fuori tutti gli articoli che il fornitore
 * consegna senza etichetta — e sono quelli che poi si cercano a mano.
 *
 * Il foglio è un A4 di etichette adesive nel formato più diffuso in cartoleria
 * (3 colonne × 8 righe, 70×37 mm). Si può partire da una posizione qualsiasi,
 * per riusare un foglio già cominciato invece di sprecarlo.
 */

/** Millimetri: A4 e griglia 3×8, i valori del formato commerciale più comune. */
const PAGINA = { larghezza: 210, altezza: 297 };
const GRIGLIA = { colonne: 3, righe: 8, larghezza: 70, altezza: 37, marginePagina: 0 };
const PADDING = 3;

export interface OpzioniEtichette {
  /** Quante etichette per prodotto (una scatola da 6 pezzi ne vuole 6). */
  copie: number;
  /** Prima casella libera del foglio, contando da 1 in alto a sinistra. */
  inizio: number;
  prezzo: boolean;
  codice: boolean;
}

@Injectable({ providedIn: 'root' })
export class EtichetteService {
  private readonly i18n = inject(I18nService);

  /**
   * Genera il PDF e lo apre nella finestra di stampa.
   * Ritorna quante etichette sono state prodotte, o 0 se non c'era nulla da stampare.
   */
  async stampa(prodotti: Prodotto[], opzioni: OpzioniEtichette): Promise<number> {
    const daStampare = prodotti.flatMap((p) => Array.from({ length: Math.max(1, opzioni.copie) }, () => p));
    if (!daStampare.length) return 0;

    const [{ jsPDF }, JsBarcode] = await Promise.all([
      import('jspdf'),
      import('jsbarcode').then((m) => (m as any).default ?? m),
    ]);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    let posizione = Math.max(1, opzioni.inizio) - 1;
    const perFoglio = GRIGLIA.colonne * GRIGLIA.righe;

    for (const p of daStampare) {
      if (posizione > 0 && posizione % perFoglio === 0) doc.addPage();
      const indice = posizione % perFoglio;
      const x = GRIGLIA.marginePagina + (indice % GRIGLIA.colonne) * GRIGLIA.larghezza;
      const y = GRIGLIA.marginePagina + Math.floor(indice / GRIGLIA.colonne) * GRIGLIA.altezza;
      this.disegna(doc, JsBarcode, p, x, y, opzioni);
      posizione++;
    }

    // Stampa diretta invece di scaricare: si stampa su etichette adesive, il
    // file non serve a nessuno dopo.
    doc.autoPrint();
    const url = doc.output('bloburl');
    window.open(url, '_blank', 'noopener');
    return daStampare.length;
  }

  private disegna(doc: any, JsBarcode: any, p: Prodotto, x: number, y: number, o: OpzioniEtichette): void {
    const larghezzaUtile = GRIGLIA.larghezza - PADDING * 2;

    // Nome: due righe al massimo, troncate con i puntini se non ci sta.
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const righeNome: string[] = doc.splitTextToSize(p.nome ?? '', larghezzaUtile).slice(0, 2);
    righeNome.forEach((riga: string, i: number) => doc.text(riga, x + PADDING, y + 6 + i * 4));

    if (o.codice && p.codice) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(String(p.codice), x + PADDING, y + 6 + righeNome.length * 4 + 1);
    }

    const codiceBarre = (p.barcode ?? '').toString().trim() || (p.codice ?? '').toString().trim();
    if (codiceBarre) {
      const png = this.barcodePng(JsBarcode, codiceBarre);
      if (png) {
        // Il codice sta in basso, dove il lettore lo cerca senza incertezze.
        doc.addImage(png, 'PNG', x + PADDING, y + GRIGLIA.altezza - 16, larghezzaUtile, 11);
      }
    }

    if (o.prezzo && p.prezzo != null) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      const prezzo = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(p.prezzo);
      doc.text(prezzo, x + GRIGLIA.larghezza - PADDING, y + 12, { align: 'right' });
    }
  }

  /**
   * Disegna il codice a barre su un canvas e lo restituisce come immagine.
   * Il formato si sceglie dal contenuto: EAN-13 per i tredici numeri dei
   * prodotti confezionati, Code128 per i codici interni, che possono contenere
   * lettere. Se il codice non è valido per nessuno dei due si lascia perdere:
   * un barcode illeggibile sull'etichetta è peggio di nessun barcode.
   */
  private barcodePng(JsBarcode: any, valore: string): string | null {
    const canvas = document.createElement('canvas');
    const formato = /^\d{13}$/.test(valore) ? 'EAN13' : /^\d{8}$/.test(valore) ? 'EAN8' : 'CODE128';
    try {
      JsBarcode(canvas, valore, {
        format: formato,
        width: 2,
        height: 60,
        displayValue: true,
        fontSize: 16,
        margin: 0,
      });
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
}
