/**
 * Rigenera gli screenshot della sezione Aiuto (galleria "Anteprime dell'app").
 *
 * NON tocca dati reali e non richiede backend/SaaS: usa l'harness di anteprima
 * del frontend (`ng serve --configuration preview`), che renderizza ogni rotta
 * con dati interamente inventati serviti da un finto HTTP (`?app=1`).
 *
 * Fa tutto da solo: avvia il server di anteprima, aspetta che risponda,
 * screenshotta le rotte, ferma il server.
 *
 * USO
 *   cd scripts && npm install && npx playwright install chromium
 *   node take-help-screenshots.mjs
 *
 * Se su questa macchina non c'è il Chromium di Playwright puoi usare un browser
 * già installato:
 *   HELP_SHOTS_CHANNEL=msedge node take-help-screenshots.mjs
 *   HELP_SHOTS_CHANNEL=chrome node take-help-screenshots.mjs
 *
 * Altre variabili:
 *   PORT=4301          porta del server di anteprima (default 4300)
 *   KEEP_SERVER=1      non fermare il server alla fine (debug)
 *   DARK=1             cattura in tema scuro
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');
const OUT_DIR = join(FRONTEND, 'public', 'help-shots');

const PORT = process.env.PORT || '4300';
const BASE = `http://localhost:${PORT}`;
const CHANNEL = process.env.HELP_SHOTS_CHANNEL || undefined;
const DARK = process.env.DARK === '1' ? '1' : '0';

/**
 * Le schermate della galleria Aiuto. `file` deve combaciare con l'elenco in
 * frontend/src/app/components/aiuto/aiuto.ts (getter `screenshots`).
 */
const SHOTS = [
  { route: 'dashboard',   file: 'dashboard.png',   delay: 2000 },
  { route: 'prodotti',    file: 'prodotti.png',    delay: 1200 },
  { route: 'fatture',     file: 'fatture.png',     delay: 1200 },
  { route: 'agenda',      file: 'agenda.png',      delay: 1800 },
  { route: 'scadenzario', file: 'scadenzario.png', delay: 1200 },
];

const C = {
  g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`,
};

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

async function serverGiaAttivo() {
  try { await fetch(BASE); return true; } catch { return false; }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(C.b(`Rigenero ${SHOTS.length} screenshot Aiuto → ${OUT_DIR}\n`));

  let server = null;
  if (await serverGiaAttivo()) {
    console.log(C.dim(`Riuso il server di anteprima già in ascolto su ${BASE}.\n`));
  } else {
    console.log(C.dim('Avvio ng serve --configuration preview...'));
    server = spawn('npx', ['ng', 'serve', '--configuration', 'preview', '--port', PORT], {
      cwd: FRONTEND, stdio: 'ignore',
      shell: process.platform === 'win32', detached: process.platform !== 'win32',
    });
    try {
      await aspettaServer(BASE);
    } catch (e) {
      console.error(C.r(`Server non partito: ${e.message}`));
      try { process.kill(-server.pid); } catch { try { server.kill(); } catch {} }
      process.exit(1);
    }
    console.log(C.dim('Server pronto.\n'));
  }

  const killServer = () => {
    if (server && !process.env.KEEP_SERVER) {
      try { process.kill(-server.pid); } catch { try { server.kill(); } catch {} }
    }
  };
  process.on('exit', killServer);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: CHANNEL });
  } catch (e) {
    console.error(C.r(`Impossibile avviare il browser: ${e.message.split('\n')[0]}`));
    console.error(C.dim('Esegui `npx playwright install chromium` oppure passa HELP_SHOTS_CHANNEL=msedge|chrome.'));
    killServer();
    process.exit(1);
  }

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const erroriPagina = [];
  page.on('pageerror', err => erroriPagina.push(String(err)));

  let falliti = 0;
  for (const { route, file, delay } of SHOTS) {
    erroriPagina.length = 0;
    const url = `${BASE}/${route}?app=1&state=full&latency=0&dark=${DARK}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(delay);
      await page.keyboard.press('Escape').catch(() => {}); // chiude eventuali snackbar/menu
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT_DIR, file), fullPage: false });
      if (erroriPagina.length) {
        falliti++;
        console.log(`  [${C.r('WARN')}] ${file} ${C.dim('— eccezione in pagina: ' + erroriPagina[0].slice(0, 120))}`);
      } else {
        console.log(`  [${C.g('OK')}] ${file}`);
      }
    } catch (e) {
      falliti++;
      console.log(`  [${C.r('FAIL')}] ${file} ${C.dim('— ' + e.message.split('\n')[0])}`);
    }
  }

  await browser.close();
  killServer();

  console.log();
  console.log(falliti ? C.r(`${falliti}/${SHOTS.length} screenshot con problemi`) : C.g(`Tutti e ${SHOTS.length} gli screenshot rigenerati`));
  process.exit(falliti ? 1 : 0);
}

main().catch(e => { console.error(C.r(e.stack || e.message)); process.exit(1); });
