/**
 * Audit di COERENZA di tutte le schermate (workflow UI/UX, lente "Coerenza").
 *
 * Apre ogni rotta nella galleria di anteprima (backend finto, dati
 * deterministici) su desktop e misura sul DOM vero gli stessi elementi in
 * tutte le schermate: intestazione, bottoni, tabelle, campi, card, tipografia,
 * colori, icone, e i dialog "Nuovo…". Per ogni elemento ricava lo STANDARD
 * (il valore più usato) e segnala le schermate che se ne discostano. Misura
 * anche l'usabilità di base: contrasto, bersagli piccoli, testo tagliato,
 * overflow, stati vuoti.
 *
 * Solo desktop: Ordeva gira su PC (1280, 1440, 1920). Niente mobile/tablet.
 *
 * USO (da scripts/, dopo `npm install`)
 *   node coerenza-audit.mjs                   # avvia da solo il server di anteprima
 *   BASE=http://localhost:4300 node coerenza-audit.mjs   # riusa un server già avviato
 *   ROTTE=fatture,clienti node coerenza-audit.mjs        # solo alcune rotte
 *   SENZA_DIALOG=1 node coerenza-audit.mjs               # salta l'apertura dei dialog
 *
 * OUTPUT in docs/audit/coerenza/
 *   report.md            riepilogo leggibile: standard, deviazioni, usabilità
 *   report.json          tutte le misure, per confronti prima/dopo
 *   screenshot/<rotta>-{light,dark}-{1440,1280,1920}.png, dialog-<rotta>.png
 *                        (ignorati da git: si rigenerano)
 *
 * Exit code: sempre 0 — è una misura, non un cancello. Il cancello binario è
 * ui-guard.sh.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = join(ROOT, 'frontend');
const OUT = join(ROOT, 'docs/audit/coerenza');
const SHOTS = join(OUT, 'screenshot');

const PORT = process.env.PORT || '4300';
const BASE = process.env.BASE || `http://localhost:${PORT}`;
const SOLO = process.env.ROTTE ? process.env.ROTTE.split(',') : null;
const SENZA_DIALOG = !!process.env.SENZA_DIALOG;

/** Stessa lettura di preview-smoke.mjs: ogni path dichiarato, niente redirect. */
function leggiRotte() {
  const src = readFileSync(join(FRONTEND, 'src/app/app.routes.ts'), 'utf8');
  const rotte = [];
  const re = /\{\s*path:\s*'([^']*)'([^}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const [, path, resto] = m;
    if (path === '' || path === '**' || /redirectTo:|soloOnline/.test(resto)) continue;
    rotte.push(path);
  }
  return rotte;
}

/** Fuori perimetro: auth pubblica con layout proprio. Si misurano ma restano
 *  fuori dagli standard. (Le pagine del sito SaaS, marcate `soloOnline` nelle
 *  rotte, non esistono nell'edizione desktop e non si aprono nemmeno.) */
const FUORI_GUSCIO = new Set(['reset-password', 'verify-email']);

async function serverAttivo(url) {
  try { await fetch(url); return true; } catch { return false; }
}

async function avviaServer() {
  if (await serverAttivo(BASE)) return () => {};
  const server = spawn('npx', ['ng', 'serve', '--configuration', 'preview', '--port', PORT], {
    cwd: FRONTEND, stdio: 'ignore', detached: true,
  });
  const stop = () => { try { process.kill(-server.pid); } catch {} };
  process.on('exit', stop);
  const t0 = Date.now();
  while (!(await serverAttivo(BASE))) {
    if (Date.now() - t0 > 180000) throw new Error('server di anteprima non partito');
    await new Promise(r => setTimeout(r, 500));
  }
  return stop;
}

// ── Misure in pagina ─────────────────────────────────────────────────────────
// Tutto quello che segue gira DENTRO il browser: niente import, niente closure.

function misuraPagina() {
  const vivo = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const px = v => Math.round(parseFloat(v) * 10) / 10;
  const outlet = document.querySelector('router-outlet');
  const radice = outlet?.nextElementSibling || document.body;

  // Palette: ogni variabile CSS dichiarata (anche dentro @media e regole annidate),
  // risolta sull'elemento della pagina — così vale il tema attivo, che in scuro
  // ridefinisce i token più in basso di :root.
  const nomi = new Set();
  const raccogli = regole => {
    for (const r of regole) {
      if (r.style) for (let i = 0; i < r.style.length; i++) if (r.style[i].startsWith('--')) nomi.add(r.style[i]);
      if (r.cssRules) raccogli(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) { try { raccogli(sheet.cssRules); } catch {} }
  const sonda = document.createElement('div');
  radice.appendChild(sonda);
  const palette = new Set(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
  const stileRadice = getComputedStyle(sonda);
  for (const nome of nomi) {
    const v = stileRadice.getPropertyValue(nome).trim();
    if (!v || /^-?[\d.]+(px|ms|s|em|rem|%)?$/.test(v)) continue;
    sonda.style.color = '';
    sonda.style.color = v;
    if (sonda.style.color) palette.add(getComputedStyle(sonda).color);
  }
  sonda.remove();

  const tutti = [...radice.querySelectorAll('*')].filter(vivo);

  // Intestazione
  const header = radice.querySelector('.page-header');
  const titolo = radice.querySelector('.page-title') || radice.querySelector('h1, h2');
  const contenuto = radice.closest('.mat-sidenav-content, mat-sidenav-content, main') || radice.parentElement;
  const bc = contenuto.getBoundingClientRect();
  const intestazione = titolo && vivo(titolo) ? {
    classeStandard: titolo.classList.contains('page-title'),
    tag: titolo.tagName.toLowerCase(),
    fontSize: px(getComputedStyle(titolo).fontSize),
    fontWeight: getComputedStyle(titolo).fontWeight,
    colore: getComputedStyle(titolo).color,
    sinistra: Math.round(titolo.getBoundingClientRect().left - bc.left),
    alto: Math.round(titolo.getBoundingClientRect().top - bc.top),
    dentroPageHeader: !!titolo.closest('.page-header'),
  } : null;

  // Bottoni, per variante
  const variante = b => {
    const c = b.classList;
    if (c.contains('mat-mdc-icon-button')) return 'icona';
    if (c.contains('mat-mdc-unelevated-button')) return 'pieno';
    if (c.contains('mat-mdc-outlined-button')) return 'contorno';
    if (c.contains('mat-mdc-raised-button')) return 'rilievo';
    if (c.contains('mat-mdc-fab') || c.contains('mat-mdc-mini-fab')) return 'fab';
    if (c.contains('mat-mdc-button')) return 'testo';
    if (b.closest('mat-button-toggle')) return 'toggle';
    return 'custom';
  };
  const bottoni = tutti.filter(e => e.matches('button, a.mat-mdc-button-base, [role="button"]'));
  const perVariante = {};
  const custom = [];
  for (const b of bottoni) {
    const v = variante(b);
    const s = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    (perVariante[v] ||= []).push({
      h: Math.round(r.height), raggio: s.borderRadius, fs: px(s.fontSize), fw: s.fontWeight,
      maiuscolo: s.textTransform === 'uppercase',
    });
    if (v === 'custom' && !b.closest('mat-paginator, .mat-mdc-paginator, .mat-sort-header-container, .mdc-switch, mat-calendar, .mat-calendar, mat-option, .mat-mdc-tab, mat-expansion-panel-header, .mat-mdc-chip')) {
      custom.push((b.className && typeof b.className === 'string' ? '.' + b.className.trim().split(/\s+/).slice(0, 2).join('.') : b.tagName.toLowerCase()) + ` "${(b.innerText || '').trim().slice(0, 24)}"`);
    }
  }
  const primaria = header?.querySelector('.mat-mdc-unelevated-button, .mat-mdc-raised-button');
  const azionePrimaria = primaria && vivo(primaria) ? (() => {
    const s = getComputedStyle(primaria);
    return { testo: primaria.innerText.trim().slice(0, 30), h: Math.round(primaria.getBoundingClientRect().height), raggio: s.borderRadius, fs: px(s.fontSize), sfondo: s.backgroundColor };
  })() : null;

  // Tabelle
  const tabelle = tutti.filter(e => e.matches('table, mat-table'));
  const tab = tabelle.map(t => {
    const th = t.querySelector('th, mat-header-cell');
    const tr = t.querySelector('tbody tr, mat-row');
    const td = t.querySelector('tbody td, mat-cell');
    const sth = th && getComputedStyle(th);
    // Importi: celle con "€" allineate a destra?
    const celleEuro = [...t.querySelectorAll('td, mat-cell')].filter(c => /€\s?[\d.,-]|[\d.,]+\s?€/.test(c.innerText));
    const euroNonADestra = celleEuro.filter(c => !['right', 'end'].includes(getComputedStyle(c).textAlign) && getComputedStyle(c).justifyContent !== 'flex-end').length;
    return {
      material: t.classList.contains('mat-mdc-table'),
      thFs: sth ? px(sth.fontSize) : null, thFw: sth?.fontWeight, thColore: sth?.color, thMaiuscolo: sth?.textTransform === 'uppercase',
      thH: th ? Math.round(th.getBoundingClientRect().height) : null,
      rigaH: tr ? Math.round(tr.getBoundingClientRect().height) : null,
      tdFs: td ? px(getComputedStyle(td).fontSize) : null,
      celleEuro: celleEuro.length, euroNonADestra,
    };
  });

  // Campi
  const campiMat = tutti.filter(e => e.matches('mat-form-field'));
  const aspetto = campiMat.map(f => f.classList.contains('mat-form-field-appearance-outline') ? 'outline' : 'fill');
  const nativi = tutti.filter(e => e.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, textarea') && !e.closest('mat-form-field'));
  const altezzaCampi = [...campiMat.map(f => Math.round((f.querySelector('.mat-mdc-text-field-wrapper') || f).getBoundingClientRect().height)),
    ...nativi.map(e => Math.round(e.getBoundingClientRect().height))];

  // Contenitori
  const card = tutti.filter(e => e.matches('.card, mat-card, .mat-mdc-card'));
  const raggiCard = card.map(c => getComputedStyle(c).borderRadius);

  // Tipografia e icone
  const conTesto = tutti.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const famiglie = new Set(conTesto.map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()));
  const dimensioni = {};
  for (const e of conTesto) { const f = px(getComputedStyle(e).fontSize); dimensioni[f] = (dimensioni[f] || 0) + 1; }
  const icone = {};
  for (const i of tutti.filter(e => e.matches('mat-icon'))) { const f = px(getComputedStyle(i).fontSize); icone[f] = (icone[f] || 0) + 1; }

  // Colori fuori token (testo e sfondi)
  const fuoriToken = {};
  for (const e of tutti) {
    const s = getComputedStyle(e);
    for (const [prop, v] of [['testo', s.color], ['sfondo', s.backgroundColor], ['bordo', s.borderTopWidth !== '0px' ? s.borderTopColor : null]]) {
      // color(srgb …): colori interni di Material (stati disabilitati), non dell'app.
      if (!v || palette.has(v) || v.startsWith('color(')) continue;
      const k = `${prop} ${v}`;
      if (!fuoriToken[k]) fuoriToken[k] = { n: 0, esempio: (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : e.tagName.toLowerCase()) };
      fuoriToken[k].n++;
    }
  }

  // ── Usabilità ──
  const lum = rgb => {
    const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = c => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 1]; };
  const sfondoEffettivo = el => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if ((c[3] ?? 1) > 0.5) return c.slice(0, 3);
      if (getComputedStyle(e).backgroundImage !== 'none') return null; // gradiente/immagine: non misurabile
    }
    return [255, 255, 255];
  };
  const contrastoBasso = [];
  for (const e of conTesto) {
    if (e.closest('[disabled], .mat-mdc-button-disabled, [aria-disabled="true"]')) continue;
    const s = getComputedStyle(e);
    const fg = parse(s.color);
    if ((fg[3] ?? 1) < 0.99) continue; // testo semitrasparente: stima inaffidabile
    const bg = sfondoEffettivo(e);
    if (!bg) continue;
    const l1 = lum(fg.slice(0, 3)), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const grande = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    if (ratio < (grande ? 3 : 4.5)) contrastoBasso.push(`${Math.round(ratio * 10) / 10}:1 "${e.innerText.trim().slice(0, 30)}"`);
  }
  const piccoli = bottoni.filter(b => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
    .map(b => `"${(b.getAttribute('aria-label') || b.innerText || b.title || '').trim().slice(0, 24)}" ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`);
  const minuscolo = conTesto.filter(e => parseFloat(getComputedStyle(e).fontSize) < 12).map(e => `${px(getComputedStyle(e).fontSize)}px "${e.innerText.trim().slice(0, 24)}"`);
  const tagliati = conTesto.filter(e => {
    const s = getComputedStyle(e);
    return (s.overflow === 'hidden' || s.overflowX === 'hidden') && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 2;
  }).map(e => `"${e.innerText.trim().slice(0, 30)}"`);
  const overflowPagina = document.scrollingElement.scrollWidth > window.innerWidth + 1;

  return {
    componente: radice.tagName.toLowerCase(),
    haPageHeader: !!header,
    haCard: card.length > 0,
    haFilterBar: !!radice.querySelector('.filter-bar'),
    haEmptyState: !!radice.querySelector('app-empty-state'),
    intestazione, azionePrimaria,
    bottoni: perVariante, bottoniCustom: [...new Set(custom)],
    tabelle: tab,
    campi: { outline: aspetto.filter(a => a === 'outline').length, fill: aspetto.filter(a => a === 'fill').length, nativi: nativi.length, altezze: altezzaCampi },
    raggiCard,
    famiglie: [...famiglie], dimensioni, icone,
    fuoriToken,
    usabilita: { contrastoBasso, piccoli, minuscolo, tagliati, overflowPagina },
  };
}

function misuraDialog() {
  const d = document.querySelector('.mat-mdc-dialog-container');
  if (!d) return null;
  // Testo del bottone senza il nome delle icone (mat-icon rende "save", "print"…).
  const etichetta = b => {
    const c = b.cloneNode(true);
    c.querySelectorAll('mat-icon').forEach(i => i.remove());
    return c.textContent.replace(/\s+/g, ' ').trim().slice(0, 24);
  };
  const px = v => Math.round(parseFloat(v) * 10) / 10;
  const t = d.querySelector('.dialog-hero-title, [mat-dialog-title], .mat-mdc-dialog-title, h2, h1');
  const schema = !t ? 'nessuno' : t.matches('.dialog-hero-title') ? 'dialog-hero' : t.matches('[mat-dialog-title], .mat-mdc-dialog-title') ? 'mat-dialog-title' : t.tagName.toLowerCase();
  const azioni = d.querySelector('mat-dialog-actions, .mat-mdc-dialog-actions, [mat-dialog-actions]');
  const bottoniAzioni = azioni ? [...azioni.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0) : [];
  const primarioIdx = bottoniAzioni.findIndex(b => b.matches('.mat-mdc-unelevated-button, .mat-mdc-raised-button'));
  const r = d.getBoundingClientRect();
  return {
    larghezza: Math.round(r.width), altezza: Math.round(r.height),
    schemaTitolo: schema,
    titolo: t ? { fs: px(getComputedStyle(t).fontSize), fw: getComputedStyle(t).fontWeight, testo: t.innerText.trim().slice(0, 40) } : null,
    azioni: azioni ? {
      giustificazione: getComputedStyle(azioni).justifyContent,
      n: bottoniAzioni.length,
      primarioUltimo: primarioIdx >= 0 ? primarioIdx === bottoniAzioni.length - 1 : null,
      etichette: bottoniAzioni.map(etichetta),
      conIcona: bottoniAzioni.filter(b => b.querySelector('mat-icon')).length,
    } : null,
    raggio: getComputedStyle(d.querySelector('.mat-mdc-dialog-surface') || d).borderRadius,
    scrollOrizzontale: d.scrollWidth > d.clientWidth + 1,
  };
}

// ── Aggregazione: standard e deviazioni ─────────────────────────────────────

function moda(valori) {
  const c = new Map();
  for (const v of valori) if (v != null) c.set(JSON.stringify(v), (c.get(JSON.stringify(v)) || 0) + 1);
  const [k, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  return k === undefined ? null : { valore: JSON.parse(k), su: n, totale: valori.filter(v => v != null).length };
}

function confrontaCon(nome, righe, estrai) {
  const valori = righe.map(r => ({ rotta: r.rotta, v: estrai(r) }));
  const std = moda(valori.map(x => x.v));
  if (!std) return null;
  const deviano = valori.filter(x => x.v != null && JSON.stringify(x.v) !== JSON.stringify(std.valore));
  return { nome, standard: std.valore, adesione: `${std.su}/${std.totale}`, deviano };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const rotte = leggiRotte().filter(r => !SOLO || SOLO.includes(r));
  const stop = await avviaServer();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const url = (rotta, { stato = 'full', dark = 0 } = {}) => `${BASE}/${rotta}?app=1&state=${stato}&latency=0&dark=${dark}`;
  const apri = async (rotta, opz) => {
    await page.goto(url(rotta, opz), { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1000);
  };

  const righe = [];
  for (const rotta of rotte) {
    process.stdout.write(`  /${rotta} `);
    const riga = { rotta, fuoriGuscio: FUORI_GUSCIO.has(rotta) };
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await apri(rotta);
      riga.chiaro = await page.evaluate(misuraPagina);
      await page.screenshot({ path: join(SHOTS, `${rotta}-light-1440.png`) });

      await apri(rotta, { dark: 1 });
      const scuro = await page.evaluate(misuraPagina);
      riga.scuro = { usabilita: scuro.usabilita, fuoriToken: scuro.fuoriToken };
      await page.screenshot({ path: join(SHOTS, `${rotta}-dark-1440.png`) });

      for (const w of [1280, 1920]) {
        await page.setViewportSize({ width: w, height: w === 1280 ? 800 : 1080 });
        await apri(rotta);
        riga[`w${w}`] = await page.evaluate(() => ({
          overflowPagina: document.scrollingElement.scrollWidth > window.innerWidth + 1,
          larghezzaUsata: Math.round((document.querySelector('router-outlet')?.nextElementSibling || document.body).getBoundingClientRect().width),
        }));
        await page.screenshot({ path: join(SHOTS, `${rotta}-light-${w}.png`) });
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      await apri(rotta, { stato: 'empty' });
      riga.vuoto = await page.evaluate(() => {
        const r = document.querySelector('router-outlet')?.nextElementSibling || document.body;
        return { emptyState: !!r.querySelector('app-empty-state, .empty-state, .section-empty, .rif-empty'), testo: r.innerText.trim().length };
      });

      // Dialog "Nuovo…": l'azione primaria nell'intestazione.
      if (!SENZA_DIALOG && riga.chiaro.azionePrimaria) {
        await apri(rotta);
        const b = page.locator('.page-header .mat-mdc-unelevated-button, .page-header .mat-mdc-raised-button').first();
        await b.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(900);
        riga.dialog = await page.evaluate(misuraDialog);
        if (riga.dialog) await page.screenshot({ path: join(SHOTS, `dialog-${rotta}.png`) });
        await page.keyboard.press('Escape');
      }
      console.log('✓');
    } catch (e) {
      riga.errore = e.message.split('\n')[0];
      console.log(`✗ ${riga.errore}`);
    }
    righe.push(riga);
  }
  await browser.close();
  stop();

  const ok = righe.filter(r => r.chiaro && !r.fuoriGuscio);
  const conTab = ok.filter(r => r.chiaro.tabelle.length);
  const conDialog = ok.filter(r => r.dialog);
  const regole = [
    confrontaCon('Intestazione: usa .page-header', ok, r => r.chiaro.haPageHeader),
    confrontaCon('Titolo: classe .page-title', ok, r => r.chiaro.intestazione?.classeStandard ?? false),
    confrontaCon('Titolo: dimensione/peso', ok, r => r.chiaro.intestazione && `${r.chiaro.intestazione.fontSize}px/${r.chiaro.intestazione.fontWeight}`),
    confrontaCon('Titolo: posizione nel contenuto (sx,alto)', ok, r => r.chiaro.intestazione && `${r.chiaro.intestazione.sinistra},${r.chiaro.intestazione.alto}`),
    confrontaCon('Azione primaria: altezza/raggio/font', ok.filter(r => r.chiaro.azionePrimaria), r => `${r.chiaro.azionePrimaria.h}px r${r.chiaro.azionePrimaria.raggio} ${r.chiaro.azionePrimaria.fs}px`),
    confrontaCon('Contenuto in .card', ok, r => r.chiaro.haCard),
    confrontaCon('Raggio card', ok.filter(r => r.chiaro.raggiCard.length), r => r.chiaro.raggiCard[0]),
    confrontaCon('Tabella: Material', conTab, r => r.chiaro.tabelle.every(t => t.material)),
    confrontaCon('Tabella: intestazione colonne (font/peso/maiusc.)', conTab, r => { const t = r.chiaro.tabelle[0]; return `${t.thFs}px/${t.thFw}${t.thMaiuscolo ? '/MAIUSC' : ''}`; }),
    confrontaCon('Tabella: altezza intestazione', conTab, r => r.chiaro.tabelle[0].thH),
    confrontaCon('Tabella: altezza riga', conTab.filter(r => r.chiaro.tabelle[0].rigaH), r => r.chiaro.tabelle[0].rigaH),
    confrontaCon('Tabella: font celle', conTab.filter(r => r.chiaro.tabelle[0].tdFs), r => r.chiaro.tabelle[0].tdFs),
    confrontaCon('Campi: aspetto Material', ok.filter(r => r.chiaro.campi.outline + r.chiaro.campi.fill), r => r.chiaro.campi.outline >= r.chiaro.campi.fill ? 'outline' : 'fill'),
    confrontaCon('Font: famiglia unica', ok, r => r.chiaro.famiglie.filter(f => !/Material/.test(f)).join('+')),
    confrontaCon('Liste: stato vuoto dedicato', conTab, r => r.vuoto?.emptyState ?? null),
    confrontaCon('Dialog: schema intestazione', conDialog, r => r.dialog.schemaTitolo),
    confrontaCon('Dialog: titolo font/peso', conDialog.filter(r => r.dialog.titolo), r => `${r.dialog.titolo.fs}px/${r.dialog.titolo.fw}`),
    confrontaCon('Dialog: azioni allineate', conDialog.filter(r => r.dialog.azioni), r => r.dialog.azioni.giustificazione),
    confrontaCon('Dialog: bottone principale per ultimo', conDialog.filter(r => r.dialog.azioni?.primarioUltimo != null), r => r.dialog.azioni.primarioUltimo),
    confrontaCon('Dialog: raggio', conDialog, r => r.dialog.raggio),
  ].filter(Boolean);

  // Varianti di bottone: quante combinazioni altezza/raggio per variante, in tutta l'app.
  const bottoni = {};
  for (const r of ok) for (const [v, lista] of Object.entries(r.chiaro.bottoni)) {
    bottoni[v] ||= new Map();
    for (const b of lista) { const k = `${b.h}px r${b.raggio} ${b.fs}px/${b.fw}${b.maiuscolo ? ' MAIUSC' : ''}`; bottoni[v].set(k, (bottoni[v].get(k) || new Set()).add(r.rotta)); }
  }
  const icone = new Map(), dimensioni = new Map(), fuoriToken = new Map();
  for (const r of ok) {
    for (const [f, n] of Object.entries(r.chiaro.icone)) icone.set(f, (icone.get(f) || 0) + n);
    for (const [f, n] of Object.entries(r.chiaro.dimensioni)) dimensioni.set(f, (dimensioni.get(f) || 0) + n);
    for (const tema of ['chiaro', 'scuro']) for (const [k, v] of Object.entries(r[tema]?.fuoriToken || {})) {
      const x = fuoriToken.get(`${tema} ${k}`) || { n: 0, rotte: new Set(), esempio: v.esempio };
      x.n += v.n; x.rotte.add(r.rotta); fuoriToken.set(`${tema} ${k}`, x);
    }
  }

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ data: new Date().toISOString(), righe }, null, 1));

  // ── report.md ──
  const L = [];
  const lista = (arr, n = 6) => arr.slice(0, n).join(', ') + (arr.length > n ? ` … (+${arr.length - n})` : '');
  L.push('# Audit di coerenza delle schermate', '');
  L.push(`Generato da \`scripts/coerenza-audit.mjs\` il ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — ${righe.length} rotte, desktop 1280/1440/1920, chiaro e scuro, dati pieni e vuoti.`, '');
  const fuori = righe.filter(r => r.fuoriGuscio).map(r => '/' + r.rotta);
  if (fuori.length) L.push(`Fuori perimetro (misurate, escluse dagli standard): ${fuori.join(', ')}.`, '');
  const errori = righe.filter(r => r.errore);
  if (errori.length) L.push(`**Rotte non misurate:** ${errori.map(r => `/${r.rotta} (${r.errore})`).join('; ')}`, '');
  L.push('## Standard e deviazioni', '', '| Elemento | Standard (più usato) | Adesione | Schermate che deviano |', '|---|---|---|---|');
  for (const g of regole) L.push(`| ${g.nome} | \`${JSON.stringify(g.standard)}\` | ${g.adesione} | ${g.deviano.length ? lista(g.deviano.map(d => `/${d.rotta} \`${JSON.stringify(d.v)}\``)) : '—'} |`);
  L.push('', '## Bottoni: combinazioni per variante', '', 'Una variante coerente ha **una** combinazione (due al massimo: normale e compatta).', '');
  for (const [v, m] of Object.entries(bottoni)) {
    L.push(`- **${v}** — ${m.size} combinazioni: ${[...m.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 8).map(([k, s]) => `\`${k}\` (${s.size} schermate)`).join(' · ')}`);
  }
  const custom = ok.filter(r => r.chiaro.bottoniCustom.length);
  L.push('', `**Bottoni fuori da Material** (stile fatto a mano): ${custom.length} schermate — ${lista(custom.map(r => `/${r.rotta} (${r.chiaro.bottoniCustom.length})`), 12)}`);
  L.push('', '## Tipografia e icone', '');
  L.push(`- Dimensioni di testo in uso: ${[...dimensioni.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}px×${n}`).join(', ')}`);
  L.push(`- Dimensioni icone in uso: ${[...icone.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}px×${n}`).join(', ')}`);
  L.push('', '## Colori fuori dai token', '', 'Colori calcolati che non corrispondono a nessuna variabile di `:root` (per tema).', '');
  L.push('| Tema, proprietà, colore | Occorrenze | Schermate | Esempio |', '|---|---|---|---|');
  for (const [k, v] of [...fuoriToken.entries()].sort((a, b) => b[1].rotte.size - a[1].rotte.size).slice(0, 40)) L.push(`| ${k} | ${v.n} | ${v.rotte.size} | \`${v.esempio}\` |`);
  L.push('', '## Usabilità', '', '| Schermata | Contrasto basso (chiaro / scuro) | Bersagli < 24px | Testo < 12px | Testo tagliato | Overflow 1280 | Stato vuoto | Importi non a destra |', '|---|---|---|---|---|---|---|---|');
  for (const r of ok) {
    const u = r.chiaro.usabilita, s = r.scuro?.usabilita;
    const euro = r.chiaro.tabelle.reduce((a, t) => a + t.euroNonADestra, 0);
    L.push(`| /${r.rotta} | ${u.contrastoBasso.length} / ${s?.contrastoBasso.length ?? '?'} | ${u.piccoli.length} | ${u.minuscolo.length} | ${u.tagliati.length} | ${r.w1280?.overflowPagina ? '**sì**' : '—'} | ${r.vuoto?.emptyState ? 'sì' : '**no**'} | ${euro || '—'} |`);
  }
  L.push('', '### Dettaglio contrasto (primi casi)', '');
  for (const r of ok) {
    const c = [...r.chiaro.usabilita.contrastoBasso.map(x => `chiaro ${x}`), ...(r.scuro?.usabilita.contrastoBasso || []).map(x => `scuro ${x}`)];
    if (c.length) L.push(`- /${r.rotta}: ${lista(c, 5)}`);
  }
  L.push('', '### Dettaglio bersagli piccoli e testo tagliato', '');
  for (const r of ok) {
    const u = r.chiaro.usabilita;
    if (u.piccoli.length || u.tagliati.length) L.push(`- /${r.rotta}: ${lista([...u.piccoli, ...u.tagliati.map(t => `tagliato ${t}`)], 5)}`);
  }
  L.push('', '## Dialog "Nuovo…"', '', '| Schermata | Larghezza | Titolo | Azioni | Etichette |', '|---|---|---|---|---|');
  for (const r of conDialog) L.push(`| /${r.rotta} | ${r.dialog.larghezza}px | ${r.dialog.titolo ? `${r.dialog.schemaTitolo} ${r.dialog.titolo.fs}px/${r.dialog.titolo.fw}` : '**nessuno**'} | ${r.dialog.azioni ? `${r.dialog.azioni.giustificazione}, primario ${r.dialog.azioni.primarioUltimo ? 'ultimo' : r.dialog.azioni.primarioUltimo === false ? '**non ultimo**' : '—'}` : '**nessuna barra azioni**'} | ${r.dialog.azioni?.etichette.join(' · ') || ''} |`);
  writeFileSync(join(OUT, 'report.md'), L.join('\n') + '\n');
  console.log(`\nReport: ${join(OUT, 'report.md')}`);
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
