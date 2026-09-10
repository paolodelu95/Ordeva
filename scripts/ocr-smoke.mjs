/**
 * Smoke test della lettura documenti (percorso "PDF con testo").
 *
 * Perché esiste: la pipeline vive nel frontend (pdf.js) e il suo esito arriva
 * all'utente come un messaggio unico — "impossibile leggere il documento" —
 * che non distingue un PDF illeggibile da una chiamata API sbagliata. È già
 * successo: `doc.destroy()` non esiste in pdf.js v6 (il metodo sta sul loading
 * task) e ogni lettura falliva DOPO aver estratto il testo correttamente.
 *
 * Qui la stessa sequenza del servizio viene eseguita in Node: si genera una
 * fattura PDF con jsPDF, la si rilegge con pdf.js ricomponendo le righe come fa
 * DocumentTextService, e si verifica che i campi attesi ci siano.
 *
 * USO
 *   node scripts/ocr-smoke.mjs
 *
 * Exit code 0 se il testo estratto contiene tutto, 1 altrimenti.
 * Richiede le dipendenze del frontend (`npm install --prefix frontend`).
 */
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, '..', 'frontend');
const require = createRequire(join(FRONTEND, 'package.json'));

const { jsPDF } = require('jspdf');
// L'entry "legacy" è quella che gira in Node; l'app usa quella standard, ma le
// API esercitate qui (getDocument, getTextContent, destroy) sono le stesse.
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  ko: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

/** Fattura di prova: intestazione, due righe, totali — come un PDF di gestionale. */
function fatturaDiProva() {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('ACME FORNITURE S.R.L.', 20, 20);
  doc.setFontSize(10);
  doc.text('Via Roma 12 - 20100 Milano (MI)', 20, 27);
  doc.text('P.IVA 00743110157', 20, 33);
  doc.setFontSize(12);
  doc.text('Fattura n. 2026/145 del 03/09/2026', 20, 48);
  doc.setFontSize(10);
  doc.text('Spett.le', 20, 60);
  doc.text('STUDIO ROSSI SNC', 20, 66);
  doc.text('P.IVA 00950501007', 20, 72);
  doc.text('Descrizione', 20, 90); doc.text('Q.ta', 110, 90);
  doc.text('Prezzo', 130, 90); doc.text('IVA', 155, 90); doc.text('Totale', 175, 90);
  doc.text('Toner nero HP 26A', 20, 98); doc.text('2', 110, 98);
  doc.text('78,50', 130, 98); doc.text('22', 155, 98); doc.text('157,00', 175, 98);
  doc.text('Risma carta A4 80gr', 20, 105); doc.text('10', 110, 105);
  doc.text('3,90', 130, 105); doc.text('22', 155, 105); doc.text('39,00', 175, 105);
  doc.text('Totale imponibile', 130, 125); doc.text('196,00', 175, 125);
  doc.text('Totale IVA', 130, 132); doc.text('43,12', 175, 132);
  doc.text('Totale documento', 130, 139); doc.text('239,12', 175, 139);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** Copia di ricomponiRighe() del servizio: i frammenti tornano in righe. */
function ricomponiRighe(items) {
  const righe = new Map();
  for (const it of items) {
    const str = typeof it?.str === 'string' ? it.str : '';
    if (!str.trim()) continue;
    const tr = it.transform ?? [1, 0, 0, 1, 0, 0];
    const y = Math.round((tr[5] ?? 0) / 2) * 2;
    const riga = righe.get(y) ?? [];
    riga.push({ x: tr[4] ?? 0, s: str });
    righe.set(y, riga);
  }
  return [...righe.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, f]) => f.sort((a, b) => a.x - b.x).map((v) => v.s).join(' ').replace(/\s{2,}/g, ' ').trim())
    .filter((r) => r.length > 0)
    .join('\n');
}

async function testoDelPdf(dati) {
  // `data` riceve una copia: pdf.js trasferisce il buffer al worker e lo svuota.
  const task = pdfjs.getDocument({ data: new Uint8Array(dati.slice(0)) });
  const doc = await task.promise;
  try {
    const parti = [];
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const pagina = await doc.getPage(p);
      parti.push(ricomponiRighe((await pagina.getTextContent()).items));
    }
    return parti.join('\n');
  } finally {
    // destroy() sta sul loading task: PDFDocumentProxy non ce l'ha.
    await task.destroy();
  }
}

const pdf = fatturaDiProva();
let testo;
try {
  testo = await testoDelPdf(pdf);
  // Seconda lettura dello stesso buffer: è ciò che fa il servizio quando un PDF
  // risulta una scansione e va rasterizzato per l'OCR. Se il buffer non fosse
  // copiato, qui arriverebbero zero byte.
  await testoDelPdf(pdf);
} catch (e) {
  console.error(C.ko('✗ la lettura del PDF ha sollevato un errore:'), e?.message ?? e);
  process.exit(1);
}

const attesi = [
  ['ragione sociale', /ACME FORNITURE/i],
  ['P.IVA fornitore', /00743110157/],
  ['numero e data', /Fattura n\. 2026\/145 del 03\/09\/2026/],
  ['riga 1', /Toner nero HP 26A 2 78,50 22 157,00/],
  ['riga 2', /Risma carta A4 80gr 10 3,90 22 39,00/],
  ['imponibile', /Totale imponibile 196,00/],
  ['totale documento', /Totale documento 239,12/],
];

let falliti = 0;
for (const [nome, re] of attesi) {
  if (re.test(testo)) {
    console.log(C.ok('  ✓'), nome);
  } else {
    console.log(C.ko('  ✗'), nome, C.dim(`— atteso ${re}`));
    falliti++;
  }
}

if (falliti) {
  console.log('\n' + C.ko(`${falliti} controlli falliti`) + '\nTesto estratto:\n' + C.dim(testo));
  process.exit(1);
}
console.log('\n' + C.ok('lettura documenti: OK') + C.dim(' (PDF con testo, estrazione e rilascio del documento)'));
