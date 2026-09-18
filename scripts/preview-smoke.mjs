/**
 * Smoke test automatico sulla galleria schermate (B.10 del workflow UI/UX).
 *
 * Sostituisce la sonda manuale da incollare nella console (vedi HANDOFF-UI-UX.md):
 * stessa idea — carica ogni rotta con backend finto e verifica che monti, abbia
 * contenuto e non spari snackbar/errori inattesi — ma automatica e ripetibile.
 *
 * Avvia da solo il server di anteprima (ng serve --configuration preview) e lo
 * ferma alla fine. Richiede `npm install` in questa cartella (playwright).
 *
 * USO
 *   node scripts/preview-smoke.mjs                  # stato "full", porta 4300
 *   STATE=empty node scripts/preview-smoke.mjs       # anche: error, error-load
 *   PORT=4301 node scripts/preview-smoke.mjs
 *   KEEP_SERVER=1 node scripts/preview-smoke.mjs     # non killa il server (debug)
 *
 * Exit code 0 se tutte le rotte passano, 1 se almeno una fallisce.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');

const PORT = process.env.PORT || '4300';
const STATE = process.env.STATE || 'full';
const BASE = `http://localhost:${PORT}`;
const MIN_CHARS = 400;

/** Rotte pubbliche che richiedono un `?token=` nell'URL vero: senza, mostrano
 *  legittimamente un messaggio d'errore breve ("Manca il token nel link"). */
const MIN_CHARS_OVERRIDE = { 'reset-password': 100, 'verify-email': 100 };

/** Messaggi di console da ignorare in ogni stato. Vuoto: CAP e comuni non
 *  interrogano più servizi esterni (zippopotam, OpenStreetMap) ma un elenco
 *  locale, quindi un errore di rete verso l'esterno ora è una regressione. */
const RUMORE_CONSOLE = [];

/** Negli stati "error"/"error-load" ogni chiamata fallisce di proposito: un
 *  componente che fa `error: e => console.error(e)` oltre a mostrare un messaggio
 *  logga l'HttpErrorResponse grezzo — diagnostica attesa, non un difetto. Un vero
 *  crash (TypeError, RuntimeError/NG0..., "Cannot read properties"…) resta un FAIL. */
const RUMORE_CONSOLE_SOLO_ERRORE = [/^HttpErrorResponse\b/, /^\[object (Object|ErrorEvent)\]$/];

const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` };

/** Ogni `path: '...'` dichiarato in app.routes.ts, esclusi wildcard e redirect. */
function leggiRotte() {
  const src = readFileSync(join(FRONTEND, 'src/app/app.routes.ts'), 'utf8');
  const rotte = [];
  const re = /\{\s*path:\s*'([^']*)'([^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const [, path, resto] = m;
    if (path === '' || path === '**') continue;
    if (/redirectTo:/.test(resto)) continue;
    rotte.push(path);
  }
  return rotte;
}

function aspettaServer(url, timeoutMs = 120000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tenta = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error('Timeout in attesa del server di anteprima'));
        else setTimeout(tenta, 500);
      });
    };
    tenta();
  });
}

async function main() {
  const rotte = leggiRotte();
  console.log(C.b(`Smoke test su ${rotte.length} rotte — stato "${STATE}", porta ${PORT}\n`));

  console.log(C.dim('Avvio ng serve --configuration preview...'));
  const server = spawn('npx', ['ng', 'serve', '--configuration', 'preview', '--port', PORT], {
    cwd: FRONTEND, stdio: 'ignore', shell: process.platform === 'win32', detached: process.platform !== 'win32',
  });
  const killServer = () => { if (!process.env.KEEP_SERVER) { try { process.kill(-server.pid); } catch { try { server.kill(); } catch {} } } };
  process.on('exit', killServer);

  try {
    await aspettaServer(BASE);
  } catch (e) {
    console.error(C.r(`Server non partito: ${e.message}`));
    killServer();
    process.exit(1);
  }
  console.log(C.dim('Server pronto.\n'));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Eccezioni non gestite (crash veri): sempre un difetto, in ogni stato.
  const erroriNonGestiti = [];
  page.on('pageerror', err => erroriNonGestiti.push(String(err)));
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    consoleErrors.push(`${msg.text()} ${msg.location()?.url || ''}`);
  });

  const risultati = [];
  for (const rotta of rotte) {
    erroriNonGestiti.length = 0;
    consoleErrors.length = 0;
    const url = `${BASE}/${rotta}?app=1&state=${STATE}&latency=0&dark=0`;
    let problema = null;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(900);

      const componente = await page.evaluate(() => {
        const outlet = document.querySelector('router-outlet');
        const v = outlet?.nextElementSibling;
        return v ? v.tagName.toLowerCase() : null;
      });
      const testo = await page.evaluate(() => document.body.innerText || '');
      const caratteri = testo.length;
      const snackbar = await page.locator('.mat-mdc-snack-bar-container').count();
      const sogliaChars = MIN_CHARS_OVERRIDE[rotta] ?? MIN_CHARS;
      const filtri = STATE === 'full' ? RUMORE_CONSOLE : [...RUMORE_CONSOLE, ...RUMORE_CONSOLE_SOLO_ERRORE];
      const erroriConsoleRilevanti = consoleErrors.filter(e => !filtri.some(re => re.test(e)));

      if (!componente) problema = 'nessun componente montato sotto <router-outlet>';
      else if (caratteri < sogliaChars) problema = `contenuto troppo scarno (${caratteri} caratteri, minimo ${sogliaChars})`;
      // Fixture con la forma sbagliata (oggetto invece di numero/stringa attesi):
      // il binding non lancia un errore, stampa solo "[object Object]" a schermo.
      else if (testo.includes('[object Object]')) problema = `"[object Object]" reso a schermo (fixture con forma sbagliata)`;
      // Con stato "full" nessuna operazione dovrebbe fallire: una snackbar è un difetto (B1).
      // Con "error"/"error-load" è vero il contrario: un errore silenzioso sarebbe la regressione.
      else if (snackbar > 0 && STATE === 'full') problema = `${snackbar} snackbar inattesa/e all'apertura`;
      else if (erroriNonGestiti.length) problema = `eccezione non gestita: ${erroriNonGestiti[0].slice(0, 140)}`;
      else if (erroriConsoleRilevanti.length) problema = `${erroriConsoleRilevanti.length} errore/i in console: ${erroriConsoleRilevanti[0].slice(0, 140)}`;
    } catch (e) {
      problema = `navigazione fallita: ${e.message.split('\n')[0]}`;
    }

    risultati.push({ rotta, problema });
    console.log(`  [${problema ? C.r('FAIL') : C.g('PASS')}] /${rotta}${problema ? C.dim(' — ' + problema) : ''}`);
  }

  await browser.close();
  killServer();

  const falliti = risultati.filter(r => r.problema);
  console.log();
  console.log(falliti.length
    ? C.r(`${falliti.length}/${risultati.length} rotte con problemi`)
    : C.g(`Tutte e ${risultati.length} le rotte ok`));
  process.exit(falliti.length ? 1 : 0);
}

main().catch(e => { console.error(C.r(e.stack || e.message)); process.exit(1); });
