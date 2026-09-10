import { Injectable, signal } from '@angular/core';

/**
 * Estrazione del testo da un documento (fattura, scontrino), interamente sul
 * computer dell'utente: nessun servizio esterno, nessuna chiave API, nessun dato
 * che esce dal PC. Sostituisce le chiamate a Mindee dell'edizione SaaS.
 *
 * Due percorsi, in ordine di preferenza:
 *
 *  1. **Layer testuale del PDF** (pdf.js). Le fatture emesse da un gestionale
 *     sono PDF nativi: il testo è già dentro, si legge esatto e in un istante.
 *     È il caso più frequente ed è anche il più preciso — nessun errore di
 *     riconoscimento, a differenza dell'OCR.
 *  2. **OCR locale** (tesseract.js, WebAssembly) per foto e PDF scansionati,
 *     dove il testo non esiste e va ricostruito dai pixel. Più lento (qualche
 *     secondo a pagina) e meno preciso: l'esito va sempre riletto dall'utente.
 *
 * I file pesanti (worker di pdf.js, core WASM di Tesseract, modello linguistico
 * italiano) sono impacchettati in `assets/` e caricati da lì: l'app funziona
 * anche senza connessione. Le librerie si importano dinamicamente, così il loro
 * peso si paga solo quando si legge davvero un documento.
 */

/** Sotto questa soglia di caratteri il PDF si considera una scansione. */
const MIN_CARATTERI_PDF = 180;
/** Pagine da leggere: una fattura sta quasi sempre nelle prime. */
const MAX_PAGINE = 3;
/** Fattore di ingrandimento per l'OCR: sotto i ~150 DPI Tesseract sbaglia molto. */
const SCALA_OCR = 2;

export type FonteTesto = 'pdf' | 'ocr';

export interface TestoEstratto {
  testo: string;
  fonte: FonteTesto;
  pagine: number;
}

@Injectable({ providedIn: 'root' })
export class DocumentTextService {
  /** Avanzamento leggibile (0-1) durante l'OCR, per la barra di progresso. */
  readonly progresso = signal(0);
  /** Fase corrente, per l'etichetta sotto la barra. */
  readonly fase = signal<'' | 'lettura' | 'ocr'>('');

  private pdfjs: any = null;
  private worker: any = null;

  /** Formati che sappiamo leggere: PDF e le immagini comuni da fotocamera/scanner. */
  static accetta(file: File): boolean {
    const n = file.name.toLowerCase();
    return /\.(pdf|png|jpg|jpeg|webp|bmp)$/.test(n);
  }

  /**
   * Estrae il testo dal documento. Per i PDF prova prima il layer testuale e
   * ripiega sull'OCR solo se il documento è una scansione.
   */
  async estrai(file: File): Promise<TestoEstratto> {
    this.progresso.set(0);
    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const dati = await file.arrayBuffer();
        this.fase.set('lettura');
        const diretto = await this.testoDelPdf(dati);
        if (diretto.testo.trim().length >= MIN_CARATTERI_PDF) return diretto;
        // PDF senza testo: è una scansione, si passa all'OCR delle pagine.
        this.fase.set('ocr');
        return await this.ocrDelPdf(dati);
      }
      this.fase.set('ocr');
      const testo = await this.ocrImmagine(file);
      return { testo, fonte: 'ocr', pagine: 1 };
    } finally {
      this.fase.set('');
      this.progresso.set(0);
    }
  }

  /** Libera il worker OCR (qualche decina di MB di RAM) quando non serve più. */
  async rilascia(): Promise<void> {
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    try { await w.terminate(); } catch { /* già chiuso */ }
  }

  // ── pdf.js ────────────────────────────────────────────────────────────────

  private async caricaPdfJs(): Promise<any> {
    if (this.pdfjs) return this.pdfjs;
    const lib = await import('pdfjs-dist');
    // Worker servito dagli asset locali: senza questo pdf.js lo cercherebbe su
    // una CDN e in offline fallirebbe.
    lib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';
    this.pdfjs = lib;
    return lib;
  }

  /**
   * Opzioni di apertura di un PDF.
   *
   * `data` riceve sempre una COPIA del buffer: pdf.js lo trasferisce al proprio
   * worker, e il trasferimento svuota (detach) l'ArrayBuffer di partenza. Senza
   * copia la seconda apertura — quella che serve a rasterizzare le scansioni per
   * l'OCR — riceverebbe zero byte e fallirebbe.
   *
   * I font "standard" (Helvetica, Times…) spesso non sono incorporati nel PDF:
   * senza la loro copia locale pdf.js li cercherebbe su una CDN, e in offline la
   * pagina verrebbe letta o disegnata male.
   */
  private opzioniDocumento(dati: ArrayBuffer) {
    return { data: new Uint8Array(dati.slice(0)), standardFontDataUrl: 'assets/pdfjs/standard_fonts/' };
  }

  private async testoDelPdf(dati: ArrayBuffer): Promise<TestoEstratto> {
    const lib = await this.caricaPdfJs();
    // Il documento si rilascia dal loading task: PDFDocumentProxy non ha destroy().
    const task = lib.getDocument(this.opzioniDocumento(dati));
    const doc = await task.promise;
    try {
      const pagine = Math.min(doc.numPages, MAX_PAGINE);
      const parti: string[] = [];
      for (let p = 1; p <= pagine; p++) {
        const pagina = await doc.getPage(p);
        const contenuto = await pagina.getTextContent();
        parti.push(this.ricomponiRighe(contenuto.items));
        this.progresso.set(p / pagine);
      }
      return { testo: parti.join('\n'), fonte: 'pdf', pagine };
    } finally {
      await task.destroy();
    }
  }

  /**
   * pdf.js restituisce frammenti sparsi con le loro coordinate. Il parser dei
   * campi ragiona per righe (descrizione a sinistra, importi a destra), quindi i
   * frammenti vanno rimessi in riga: si raggruppano per coordinata verticale e
   * si ordinano da sinistra a destra.
   */
  private ricomponiRighe(items: any[]): string {
    const righe = new Map<number, { x: number; s: string }[]>();
    for (const it of items) {
      const str = typeof it?.str === 'string' ? it.str : '';
      if (!str.trim()) continue;
      const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
      const x = tr[4] ?? 0;
      // Arrotondamento a 2 punti: frammenti della stessa riga hanno y quasi uguali.
      const y = Math.round((tr[5] ?? 0) / 2) * 2;
      const riga = righe.get(y) ?? [];
      riga.push({ x, s: str });
      righe.set(y, riga);
    }
    return [...righe.entries()]
      .sort((a, b) => b[0] - a[0]) // y cresce verso l'alto nei PDF
      .map(([, frammenti]) =>
        frammenti
          .sort((a, b) => a.x - b.x)
          .map(f => f.s)
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim(),
      )
      .filter(r => r.length > 0)
      .join('\n');
  }

  // ── tesseract.js ──────────────────────────────────────────────────────────

  private async caricaWorker(): Promise<any> {
    if (this.worker) return this.worker;
    const { createWorker } = await import('tesseract.js');
    this.worker = await createWorker('ita', 1, {
      // Tutto dagli asset locali: in offline non c'è nessuna CDN da interrogare.
      workerPath: 'assets/tesseract/worker.min.js',
      corePath: 'assets/tesseract',
      langPath: 'tessdata',
      gzip: true,
      logger: (m: any) => {
        if (m?.status === 'recognizing text' && typeof m.progress === 'number') {
          this.progresso.set(m.progress);
        }
      },
    });
    return this.worker;
  }

  private async ocrImmagine(sorgente: File | HTMLCanvasElement): Promise<string> {
    const worker = await this.caricaWorker();
    const { data } = await worker.recognize(sorgente);
    return data?.text ?? '';
  }

  /** Rasterizza le prime pagine del PDF e le passa all'OCR. */
  private async ocrDelPdf(dati: ArrayBuffer): Promise<TestoEstratto> {
    const lib = await this.caricaPdfJs();
    const task = lib.getDocument(this.opzioniDocumento(dati));
    const doc = await task.promise;
    try {
      const pagine = Math.min(doc.numPages, MAX_PAGINE);
      const parti: string[] = [];
      for (let p = 1; p <= pagine; p++) {
        const pagina = await doc.getPage(p);
        const viewport = pagina.getViewport({ scale: SCALA_OCR });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas non disponibile');
        await pagina.render({ canvas, viewport }).promise;
        parti.push(await this.ocrImmagine(canvas));
        // Libera subito i pixel: una pagina A4 a 2x sono ~11 milioni di byte.
        canvas.width = 0;
        canvas.height = 0;
      }
      return { testo: parti.join('\n'), fonte: 'ocr', pagine };
    } finally {
      await task.destroy();
    }
  }
}
