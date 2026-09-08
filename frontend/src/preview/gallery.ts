/**
 * GALLERIA SCHERMATE — chrome esterno dell'harness di anteprima.
 *
 * È volutamente DOM puro, senza Angular: gira nella pagina esterna e mostra l'app
 * vera dentro un `<iframe>`. L'iframe serve a due cose:
 *   1. le media query rispondono alla larghezza dell'iframe → le anteprime mobile
 *      e tablet sono reali, non simulate con un contenitore stretto;
 *   2. la galleria non può interferire con il change detection dell'app sotto test.
 *
 * Compilata solo dalla configurazione `preview` (vedi angular.json).
 */
import { routes } from '../app/app.routes';

interface Voce { label: string; path: string; }
interface Gruppo { titolo: string; voci: Voce[]; }

/** Raggruppamento speculare alla navigazione dell'app (app.ts). */
const GRUPPI: Gruppo[] = [
  { titolo: 'Quotidiano', voci: [
    { label: 'Dashboard', path: 'dashboard' },
    { label: 'Vendita al banco', path: 'vendita-banco' },
    { label: 'Agenda', path: 'agenda' },
    { label: 'Lavagna', path: 'lavagna' },
  ]},
  { titolo: 'Anagrafiche', voci: [
    { label: 'Clienti', path: 'clienti' },
    { label: 'Fornitori', path: 'fornitori' },
    { label: 'Prodotti', path: 'prodotti' },
    { label: 'Agenti', path: 'agenti' },
  ]},
  { titolo: 'Vendite', voci: [
    { label: 'Preventivi', path: 'preventivi' },
    { label: 'Ordini cliente', path: 'ordini' },
    { label: 'Documenti di trasporto', path: 'ddt' },
    { label: 'Fatture', path: 'fatture' },
    { label: 'Note di credito', path: 'note-credito' },
    { label: 'Ricorrenti', path: 'fatture-ricorrenti' },
    { label: 'Marketplace', path: 'marketplace' },
    { label: 'Listini', path: 'listini' },
  ]},
  { titolo: 'Acquisti e magazzino', voci: [
    { label: 'Acquisti', path: 'acquisti' },
    { label: 'Ordini fornitore', path: 'ordini-fornitore' },
    { label: 'Arrivi merce', path: 'arrivi-merce' },
    { label: 'Movimenti magazzino', path: 'magazzino' },
    { label: 'OCR fatture', path: 'ocr-fatture' },
  ]},
  { titolo: 'Fatture elettroniche', voci: [
    { label: 'Emesse (SDI)', path: 'fatture-elettroniche' },
    { label: 'Ricevute (SDI)', path: 'sdi-passive' },
  ]},
  { titolo: 'Contabilità', voci: [
    { label: 'Pagamenti', path: 'pagamenti' },
    { label: 'Scadenzario', path: 'scadenzario' },
    { label: 'Scadenze fiscali', path: 'scadenze-fiscali' },
    { label: 'Prima nota', path: 'prima-nota' },
    { label: 'Riconciliazione', path: 'riconciliazione' },
    { label: 'Compliance', path: 'compliance' },
  ]},
  { titolo: 'Report e sistema', voci: [
    { label: 'Andamento', path: 'report' },
    { label: 'Report tabellari', path: 'reports' },
    { label: 'Impostazioni', path: 'impostazioni' },
    { label: 'Archivi', path: 'archivi' },
    { label: 'Storico', path: 'storico' },
    { label: 'Aiuto', path: 'aiuto' },
  ]},
  { titolo: 'Accesso e pubbliche', voci: [
    // NB: `login` non ha una rotta in app.routes.ts — il componente esiste ma non è
    // raggiungibile. Al suo posto una rotta inesistente, che mostra il vuoto lasciato
    // dalla mancanza di una rotta jolly `**` (nessuna pagina "non trovata").
    { label: 'Rotta inesistente (404)', path: 'rotta-inesistente' },
    { label: 'Reset password', path: 'reset-password' },
    { label: 'Verifica email', path: 'verify-email' },
    { label: 'Account', path: 'account' },
    { label: 'Abbonamento', path: 'billing' },
    { label: 'Trial scaduto', path: 'trial-expired' },
    { label: 'FAQ', path: 'faq' },
    { label: 'Termini', path: 'termini' },
    { label: 'Privacy', path: 'privacy' },
  ]},
  { titolo: 'Amministrazione', voci: [
    { label: 'Admin', path: 'admin' },
    { label: 'Console SaaS', path: 'super-admin' },
  ]},
];

/** Dialog documento serviti dal vecchio harness (`?doc=`), tenuto intatto. */
const DIALOG = ['fatture', 'ddt', 'note-credito', 'preventivi', 'ordini', 'ordini-fornitore', 'acquisti', 'fatture-ricorrenti'];

const STATI: { id: string; label: string; nota: string }[] = [
  { id: 'full', label: 'Pieni', nota: '~200 righe, nomi lunghi, importi enormi' },
  { id: 'empty', label: 'Vuoti', nota: 'nessun dato: mostra gli empty state' },
  { id: 'error', label: 'Scritture KO', nota: 'ogni salvataggio fallisce: la schermata lo dice?' },
  { id: 'error-load', label: 'Letture KO', nota: 'ogni caricamento fallisce' },
];

const VIEWPORT: { id: string; label: string; w: number | null; h: number }[] = [
  { id: 'desktop', label: 'Desktop 1440', w: 1440, h: 900 },
  { id: 'laptop', label: 'Laptop 1280', w: 1280, h: 800 },
  { id: 'tablet', label: 'Tablet 768', w: 768, h: 1024 },
  { id: 'mobile', label: 'Mobile 375', w: 375, h: 812 },
  { id: 'fluid', label: 'Adatta', w: null, h: 0 },
];

/** Ogni rotta dichiarata in app.routes.ts che non compare nei gruppi qui sopra. */
function rotteOrfane(): Voce[] {
  const noti = new Set(GRUPPI.flatMap((g) => g.voci.map((v) => v.path)));
  return routes
    .map((r) => r.path ?? '')
    .filter((p) => p && p !== '**' && !noti.has(p))
    .map((p) => ({ label: p, path: p }));
}

const css = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 Inter, system-ui, sans-serif; background: #11151b; color: #cbd5e1; }
  .g-wrap { display: flex; height: 100vh; }
  .g-side { width: 236px; flex: 0 0 236px; background: #161b23; border-right: 1px solid #232b36;
            display: flex; flex-direction: column; }
  .g-brand { padding: 14px 16px 10px; font-weight: 700; color: #e2e8f0; letter-spacing: .2px;
             border-bottom: 1px solid #232b36; }
  .g-brand small { display: block; font-weight: 400; color: #64748b; font-size: 11px; margin-top: 2px; }
  .g-filter { margin: 10px 12px; }
  .g-filter input { width: 100%; padding: 7px 9px; border-radius: 7px; border: 1px solid #2b3542;
                    background: #0f141a; color: #e2e8f0; font: inherit; }
  .g-filter input::placeholder { color: #55627a; }
  .g-list { overflow-y: auto; flex: 1; padding: 0 8px 16px; }
  .g-grp { margin-top: 12px; padding: 0 6px; font-size: 10.5px; text-transform: uppercase;
           letter-spacing: .09em; color: #64748b; font-weight: 700; }
  .g-item { display: block; width: 100%; text-align: left; padding: 6px 8px; margin: 1px 0;
            border: 0; border-radius: 6px; background: transparent; color: #b6c2d2; font: inherit;
            cursor: pointer; }
  .g-item:hover { background: #1e2530; color: #e2e8f0; }
  .g-item.on { background: #1d4ed8; color: #fff; font-weight: 600; }
  .g-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .g-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 9px 14px;
           background: #161b23; border-bottom: 1px solid #232b36; }
  .g-seg { display: inline-flex; border: 1px solid #2b3542; border-radius: 8px; overflow: hidden; }
  .g-seg button { border: 0; background: #0f141a; color: #93a3b8; padding: 5px 10px; font: inherit;
                  cursor: pointer; border-right: 1px solid #2b3542; }
  .g-seg button:last-child { border-right: 0; }
  .g-seg button.on { background: #1d4ed8; color: #fff; font-weight: 600; }
  .g-lbl { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; }
  .g-note { color: #64748b; font-size: 11.5px; flex: 1; min-width: 160px; }
  .g-link { color: #7dd3fc; text-decoration: none; font-size: 11.5px; }
  .g-link:hover { text-decoration: underline; }
  .g-stage { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start;
             padding: 16px; background: #0d1116; }
  .g-frame { background: #fff; border: 0; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,.55);
             width: 100%; height: 100%; }
  .g-stage.fluid { padding: 0; }
  .g-stage.fluid .g-frame { border-radius: 0; box-shadow: none; }
`;

interface Stato { screen: string; doc: string | null; state: string; latency: number; dark: boolean; vp: string; }

function leggiStato(): Stato {
  const p = new URLSearchParams(location.search);
  return {
    screen: p.get('screen') || 'dashboard',
    doc: p.get('gdoc'),
    state: p.get('state') || 'full',
    latency: Number(p.get('latency') ?? 200),
    dark: p.get('dark') === '1',
    vp: p.get('vp') || 'desktop',
  };
}

function scriviStato(s: Stato) {
  const p = new URLSearchParams();
  if (s.doc) p.set('gdoc', s.doc); else p.set('screen', s.screen);
  p.set('state', s.state);
  p.set('latency', String(s.latency));
  p.set('dark', s.dark ? '1' : '0');
  p.set('vp', s.vp);
  history.replaceState(null, '', location.pathname + '?' + p.toString());
}

/** URL caricato nell'iframe: la stessa build, ma in modalità "app". */
function urlIframe(s: Stato): string {
  const q = `app=1&state=${s.state}&latency=${s.latency}&dark=${s.dark ? '1' : '0'}`;
  return s.doc ? `/?doc=${s.doc}&${q}` : `/${s.screen}?${q}`;
}

export function montaGalleria(): void {
  document.title = 'Ordeva — Galleria schermate';
  const stile = document.createElement('style');
  stile.textContent = css;
  document.head.appendChild(stile);

  const s = leggiStato();
  const gruppi: Gruppo[] = [
    ...GRUPPI,
    { titolo: 'Dialog documento', voci: DIALOG.map((d) => ({ label: d, path: 'doc:' + d })) },
  ];
  const orfane = rotteOrfane();
  if (orfane.length) gruppi.push({ titolo: 'Altre rotte', voci: orfane });

  document.body.innerHTML = `
    <div class="g-wrap">
      <aside class="g-side">
        <div class="g-brand">Galleria schermate<small>anteprima con dati finti — nessun backend</small></div>
        <div class="g-filter"><input id="g-q" type="search" placeholder="Filtra schermate…" autocomplete="off"></div>
        <nav class="g-list" id="g-list"></nav>
      </aside>
      <main class="g-main">
        <div class="g-bar">
          <span class="g-lbl">Dati</span><span class="g-seg" id="g-state"></span>
          <span class="g-lbl">Schermo</span><span class="g-seg" id="g-vp"></span>
          <span class="g-lbl">Tema</span><span class="g-seg" id="g-theme"></span>
          <span class="g-lbl">Attesa</span><span class="g-seg" id="g-lat"></span>
          <span class="g-note" id="g-note"></span>
          <a class="g-link" id="g-open" target="_blank" rel="noopener">Apri a tutto schermo ↗</a>
        </div>
        <div class="g-stage" id="g-stage"><iframe class="g-frame" id="g-frame" title="Anteprima"></iframe></div>
      </main>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;
  const frame = $('g-frame') as HTMLIFrameElement;
  const stage = $('g-stage');

  function segmento(host: HTMLElement, opzioni: { id: string; label: string }[], attivo: () => string, onClick: (id: string) => void) {
    host.innerHTML = '';
    for (const o of opzioni) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.className = o.id === attivo() ? 'on' : '';
      b.onclick = () => { onClick(o.id); render(); };
      host.appendChild(b);
    }
  }

  function renderLista() {
    const q = ($('g-q') as HTMLInputElement).value.trim().toLowerCase();
    const host = $('g-list');
    host.innerHTML = '';
    for (const g of gruppi) {
      const voci = g.voci.filter((v) => !q || v.label.toLowerCase().includes(q) || v.path.toLowerCase().includes(q));
      if (!voci.length) continue;
      const h = document.createElement('div');
      h.className = 'g-grp';
      h.textContent = g.titolo;
      host.appendChild(h);
      for (const v of voci) {
        const b = document.createElement('button');
        b.className = 'g-item';
        b.textContent = v.label;
        const isDoc = v.path.startsWith('doc:');
        const selezionata = isDoc ? s.doc === v.path.slice(4) : (!s.doc && s.screen === v.path);
        if (selezionata) b.classList.add('on');
        b.onclick = () => {
          if (isDoc) { s.doc = v.path.slice(4); } else { s.doc = null; s.screen = v.path; }
          render();
        };
        host.appendChild(b);
      }
    }
  }

  function render() {
    scriviStato(s);
    segmento($('g-state'), STATI, () => s.state, (id) => { s.state = id; });
    segmento($('g-vp'), VIEWPORT, () => s.vp, (id) => { s.vp = id; });
    segmento($('g-theme'), [{ id: '0', label: 'Chiaro' }, { id: '1', label: 'Scuro' }], () => (s.dark ? '1' : '0'), (id) => { s.dark = id === '1'; });
    segmento($('g-lat'), [{ id: '0', label: 'nessuna' }, { id: '200', label: '200 ms' }, { id: '1500', label: '1,5 s' }], () => String(s.latency), (id) => { s.latency = Number(id); });

    $('g-note').textContent = STATI.find((x) => x.id === s.state)?.nota ?? '';
    const vp = VIEWPORT.find((v) => v.id === s.vp)!;
    stage.classList.toggle('fluid', vp.w === null);
    frame.style.width = vp.w ? vp.w + 'px' : '100%';
    frame.style.height = vp.w ? vp.h + 'px' : '100%';
    frame.style.flex = vp.w ? '0 0 auto' : '1 1 auto';

    const url = urlIframe(s);
    ($('g-open') as HTMLAnchorElement).href = url;
    if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
    renderLista();
  }

  ($('g-q') as HTMLInputElement).addEventListener('input', renderLista);
  render();
}
