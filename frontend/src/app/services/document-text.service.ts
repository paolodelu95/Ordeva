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
/**
 * Quante pagine leggere. I due percorsi hanno costi diversissimi, quindi hanno
 * limiti diversi: estrarre il layer testuale di una pagina è istantaneo, mentre
 * l'OCR ci mette qualche secondo.
 *
 * Il vecchio limite unico di 3 pagine, pensato per l'OCR, tagliava anche i PDF
 * nativi: su una fattura di corriere di 9 pagine (una riga per spedizione) se ne
 * leggevano 68 righe su 198 e il totale non tornava — senza che niente lo dicesse.
 */
const MAX_PAGINE_TESTO = 60;
const MAX_PAGINE_OCR = 8;
/** Anteprima: quante pagine rendere come immagine da affiancare ai dati. */
const MAX_PAGINE_ANTEPRIMA = 8;
/**
 * Distanza (in unità PDF, ~ punti tipografici) oltre la quale due frammenti
 * sulla stessa riga appartengono a colonne diverse e non alla stessa frase.
 * Una spaziatura normale a 10pt sta sotto i 5 punti; 18 è largo abbastanza da
 * non spezzare le frasi e stretto abbastanza da separare due colonne.
 */
const SEPARAZIONE_COLONNE = 18;
/** Fattore di ingrandimento per l'OCR: sotto i ~150 DPI Tesseract sbaglia molto. */
const SCALA_OCR = 2;
/** Anteprima: abbastanza nitida da confrontare gli importi, senza pesare in memoria. */
const SCALA_ANTEPRIMA = 1.4;

export type FonteTesto = 'pdf' | 'ocr';

export interface TestoEstratto {
  testo: string;
  fonte: FonteTesto;
  /** Pagine effettivamente lette. */
  pagine: number;
  /** Pagine del documento: se sono più di `pagine`, qualcosa è rimasto fuori. */
  pagineTotali: number;
}

/**
 * WebKit (la WebView di macOS, e Safari) non implementa l'iterazione asincrona
 * sui ReadableStream: `ReadableStream.prototype[Symbol.asyncIterator]` non esiste.
 * Chromium — cioè la WebView di Windows — ce l'ha, ed è per questo che la lettura
 * dei documenti funzionava lì e falliva sul Mac.
 *
 * pdf.js legge il contenuto testuale della pagina con un `for await` sullo
 * stream; compilato, quel ciclo prova prima Symbol.asyncIterator e poi ripiega
 * su Symbol.iterator. Su WebKit mancano entrambi e l'errore che arriva in
 * superficie è un opaco "Symbol.iterator is not a function".
 *
 * Il rimedio è il polyfill standard, applicato solo dove serve.
 */
function assicuraStreamAsyncIterator(): void {
  const proto = typeof ReadableStream !== 'undefined' ? (ReadableStream.prototype as any) : null;
  if (!proto || proto[Symbol.asyncIterator]) return;
  proto[Symbol.asyncIterator] = function (this: ReadableStream) {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      async return(valore?: unknown) {
        await reader.cancel();
        return { done: true as const, value: valore };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

/**
 * Il core di Tesseract esiste in due varianti: con e senza istruzioni SIMD.
 * Questo è il modulo di prova usato da wasm-feature-detect: se il motore lo
 * accetta, le istruzioni SIMD ci sono e conviene la variante veloce.
 */
function supportaSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class DocumentTextService {
  /** Avanzamento leggibile (0-1) durante l'OCR, per la barra di progresso. */
  readonly progresso = signal(0);
  /** Fase corrente, per l'etichetta sotto la barra. */
  readonly fase = signal<'' | 'lettura' | 'ocr'>('');
  /** Ultimo stato riportato dal motore OCR: serve a capire dove si è fermato. */
  readonly ultimaFaseOcr = signal<string>('');

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
      return { testo, fonte: 'ocr', pagine: 1, pagineTotali: 1 };
    } finally {
      this.fase.set('');
      this.progresso.set(0);
    }
  }

  /**
   * Immagini del documento per l'anteprima affiancata ai dati estratti: così si
   * confronta a colpo d'occhio quello che il programma ha capito con quello che
   * c'è scritto sulla fattura.
   *
   * Per un PDF rende le pagine su canvas (a bassa risoluzione: è una miniatura
   * da guardare, non da leggere in stampa); per una foto restituisce il file
   * stesso. Se il rendering fallisce non è un errore che vale la pena mostrare:
   * l'anteprima è un aiuto, non il lavoro — si restituisce una lista vuota.
   */
  async anteprima(file: File, maxPagine = MAX_PAGINE_ANTEPRIMA): Promise<string[]> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return [URL.createObjectURL(file)];
    }
    try {
      const dati = await file.arrayBuffer();
      const lib = await this.caricaPdfJs();
      const task = lib.getDocument(this.opzioniDocumento(dati));
      const doc = await task.promise;
      try {
        const pagine: string[] = [];
        for (let p = 1; p <= Math.min(doc.numPages, maxPagine); p++) {
          const pagina = await doc.getPage(p);
          const viewport = pagina.getViewport({ scale: SCALA_ANTEPRIMA });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await pagina.render({ canvas, viewport }).promise;
          pagine.push(canvas.toDataURL('image/jpeg', 0.72));
          canvas.width = 0;
          canvas.height = 0;
        }
        return pagine;
      } finally {
        await task.destroy();
      }
    } catch {
      return [];
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
    assicuraStreamAsyncIterator();
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
      const pagine = Math.min(doc.numPages, MAX_PAGINE_TESTO);
      const parti: string[] = [];
      for (let p = 1; p <= pagine; p++) {
        const pagina = await doc.getPage(p);
        const contenuto = await pagina.getTextContent();
        parti.push(this.ricomponiRighe(contenuto.items));
        this.progresso.set(p / pagine);
      }
      return { testo: parti.join('\n'), fonte: 'pdf', pagine, pagineTotali: doc.numPages };
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
    const righe = new Map<number, { x: number; w: number; s: string }[]>();
    for (const it of items) {
      const str = typeof it?.str === 'string' ? it.str : '';
      if (!str.trim()) continue;
      const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
      const x = tr[4] ?? 0;
      // Arrotondamento a 2 punti: frammenti della stessa riga hanno y quasi uguali.
      const y = Math.round((tr[5] ?? 0) / 2) * 2;
      const riga = righe.get(y) ?? [];
      riga.push({ x, w: typeof it?.width === 'number' ? it.width : 0, s: str });
      righe.set(y, riga);
    }
    return [...righe.entries()]
      .sort((a, b) => b[0] - a[0]) // y cresce verso l'alto nei PDF
      .map(([, frammenti]) => {
        const ordinati = frammenti.sort((a, b) => a.x - b.x);
        let riga = '';
        for (let k = 0; k < ordinati.length; k++) {
          if (k > 0) {
            // Stacco largo fra due frammenti: non è una spaziatura, sono due
            // COLONNE diverse. Sulle fatture che mettono emittente e cliente
            // affiancati, fondere le colonne faceva leggere come fornitore
            // "AUCTANE S.L.U CCTECH", cioè i due nomi appiccicati. Il tabulatore
            // conserva quel confine per chi legge il testo dopo.
            const prec = ordinati[k - 1];
            const stacco = ordinati[k].x - (prec.x + prec.w);
            riga += stacco > SEPARAZIONE_COLONNE ? '\t' : ' ';
          }
          riga += ordinati[k].s;
        }
        // Si comprimono solo gli spazi: i tabulatori sono informazione.
        return riga.replace(/ {2,}/g, ' ').replace(/\t+/g, '\t').trim();
      })
      .filter(r => r.length > 0)
      .join('\n');
  }

  // ── tesseract.js ──────────────────────────────────────────────────────────

  private async caricaWorker(): Promise<any> {
    if (this.worker) return this.worker;
    // tesseract.js è un pacchetto CommonJS: a seconda di come il bundler lo
    // interpreta, createWorker sta sull'oggetto modulo oppure sotto `default`.
    // Prenderne solo uno dei due significa ritrovarsi "t is not a function"
    // nella build impacchettata, dove l'interop è diversa che in sviluppo.
    const mod: any = await import('tesseract.js');
    const createWorker = mod.createWorker ?? mod.default?.createWorker;
    if (typeof createWorker !== 'function') {
      throw new Error('tesseract.js: createWorker non disponibile nel modulo caricato');
    }
    // Percorsi ASSOLUTI, non relativi: tesseract avvia il proprio worker da un
    // blob, e dentro un blob i percorsi relativi non hanno una base su cui
    // risolversi — la WebView di macOS risponde "NetworkError: Load failed".
    const asset = (p: string) => new URL(p, document.baseURI).href;
    this.worker = await createWorker('ita', 1, {
      // Tutto dagli asset locali: in offline non c'è nessuna CDN da interrogare.
      workerBlobURL: false,
      workerPath: asset('assets/tesseract/worker.min.js'),
      // corePath punta a un FILE, non alla cartella. Con una cartella tesseract
      // sceglie da sé la variante e cerca i file `.wasm.js` (che incorporano il
      // wasm in base64, 3,7 MB l'uno) — inclusa quella "relaxed SIMD". Indicando
      // il file scegliamo noi: il loader `.js` con il `.wasm` affiancato, che
      // pesa la metà ed è quello che l'app impacchetta.
      corePath: asset(`assets/tesseract/tesseract-core${supportaSimd() ? '-simd' : ''}-lstm.js`),
      langPath: asset('tessdata'),
      gzip: true,
      logger: (m: any) => {
        if (m?.status) this.ultimaFaseOcr.set(String(m.status));
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
      const pagine = Math.min(doc.numPages, MAX_PAGINE_OCR);
      const parti: string[] = [];
      for (let p = 1; p <= pagine; p++) {
        this.progresso.set((p - 1) / pagine);
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
      return { testo: parti.join('\n'), fonte: 'ocr', pagine, pagineTotali: doc.numPages };
    } finally {
      await task.destroy();
    }
  }
}
