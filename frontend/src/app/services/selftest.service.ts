import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { DocumentTextService } from './document-text.service';

/**
 * Autotest della lettura documenti, eseguito DENTRO l'app.
 *
 * La pipeline (pdf.js, Tesseract, i loro Web Worker) vive nella WebView, e ogni
 * sistema ne usa una diversa: WKWebView su macOS, WebView2 su Windows,
 * WebKitGTK su Linux. Un errore che si vede solo su uno dei tre non si riproduce
 * né in un browser né in un test Node — l'unico modo di conoscerlo è farlo
 * accadere nel motore vero e farselo raccontare.
 *
 * Si attiva avviando l'app con ORDEVA_SELFTEST=ocr: legge un documento di prova
 * dagli asset e manda l'esito al backend, che lo scrive nei log. Spento (il
 * caso normale) non fa nulla e non costa niente.
 */
@Injectable({ providedIn: 'root' })
export class SelftestService {
  private readonly docText = inject(DocumentTextService);

  async eseguiSeRichiesto(): Promise<void> {
    if (!environment.offline) return;
    let selftest = '';
    try {
      const r = await fetch(`${environment.apiUrl}/sistema/diagnostica`);
      selftest = r.ok ? ((await r.json())?.selftest ?? '') : '';
    } catch {
      return;
    }
    if (selftest !== 'ocr') return;

    await this.provaAmbiente();
    await this.provaPdf();
    await this.provaAnteprima();
    await this.provaOcr();
  }

  private async provaAmbiente(): Promise<void> {
    const streamIterabile =
      typeof ReadableStream !== 'undefined' && !!(ReadableStream.prototype as any)[Symbol.asyncIterator];
    await this.riporta(
      'ambiente',
      'ok',
      `ReadableStream asyncIterator nativo=${streamIterabile} · ${navigator.userAgent}`,
    );
  }

  /** L'anteprima affiancata ai dati: se non rende nulla, il confronto sparisce. */
  private async provaAnteprima(): Promise<void> {
    try {
      const r = await fetch('diagnostica/fattura-test.pdf');
      const file = new File([await r.blob()], 'fattura-test.pdf', { type: 'application/pdf' });
      const pagine = await this.docText.anteprima(file);
      await this.riporta('anteprima', pagine.length ? 'ok' : 'ko', `pagine rese: ${pagine.length}`);
    } catch (e) {
      await this.riporta('anteprima', 'ko', this.descrivi(e));
    }
  }

  /**
   * OCR di un'immagine generata al volo: verifica la strada che prendono foto e
   * scansioni (tesseract.js, il suo core WASM e il modello italiano), che è
   * diversa da quella dei PDF con testo.
   */
  private async provaOcr(): Promise<void> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas non disponibile');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.font = '48px sans-serif';
      ctx.fillText('TOTALE 239,12', 40, 120);

      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      const file = new File([blob], 'scontrino-test.png', { type: 'image/png' });
      const estratto = await this.docText.estrai(file);
      const testo = estratto.testo.replace(/\s+/g, ' ').trim();
      const riconosciuto = /239[.,]12/.test(testo);
      await this.riporta('ocr-immagine', riconosciuto ? 'ok' : 'ko', `letto: "${testo.slice(0, 80)}"`);
    } catch (e) {
      await this.riporta('ocr-immagine', 'ko', `${this.descrivi(e)} — ultima fase: "${this.docText.ultimaFaseOcr()}"`);
    } finally {
      await this.docText.rilascia();
    }
  }

  /** Lettura completa di un PDF di prova, con la stessa strada dell'uso reale. */
  private async provaPdf(): Promise<void> {
    try {
      const risposta = await fetch('diagnostica/fattura-test.pdf');
      if (!risposta.ok) {
        await this.riporta('pdf', 'ko', `il PDF di prova non si scarica: HTTP ${risposta.status}`);
        return;
      }
      const file = new File([await risposta.blob()], 'fattura-test.pdf', { type: 'application/pdf' });
      const estratto = await this.docText.estrai(file);
      const righe = estratto.testo.split('\n').filter((r) => r.trim()).length;
      await this.riporta('pdf', 'ok', `fonte=${estratto.fonte} righe=${righe} caratteri=${estratto.testo.length}`);
    } catch (e) {
      await this.riporta('pdf', 'ko', this.descrivi(e));
    }
  }

  private descrivi(e: unknown): string {
    if (e instanceof Error) {
      const stack = (e.stack ?? '').split('\n').slice(0, 3).join(' | ');
      return `${e.name}: ${e.message} — ${stack}`;
    }
    return String(e);
  }

  private async riporta(contesto: string, esito: 'ok' | 'ko', dettaglio: string): Promise<void> {
    try {
      await fetch(`${environment.apiUrl}/sistema/diagnostica`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contesto, esito, dettaglio }),
      });
    } catch {
      /* la diagnostica non deve mai rompere l'avvio */
    }
  }
}
