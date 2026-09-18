/**
 * Genera frontend/src/app/data/comuni-cap.ts: l'elenco dei comuni italiani con
 * sigla di provincia e CAP, usato da CityService per compilare CAP e provincia
 * mentre si scrive la città — senza internet e senza servizi esterni.
 *
 * FONTI (entrambe CC BY 4.0, attribuzione nel file generato e nel README)
 *   · ISTAT, "Elenco dei codici e delle denominazioni delle unità territoriali":
 *     l'elenco ufficiale e aggiornato dei comuni, con la sigla automobilistica.
 *   · GeoNames, postal codes IT (download.geonames.org/export/zip/IT.zip): i CAP.
 * Il dataset "comuni-json", molto diffuso, NON si usa: i suoi CAP non hanno una
 * licenza e non si possono ridistribuire.
 *
 * I nomi dei comuni vengono da ISTAT, i CAP da GeoNames, abbinati per nome e
 * sigla (senza accenti, apostrofi e particelle: "Reggio nell'Emilia" = "Reggio
 * Emilia"). Un comune nato da una fusione recente può non avere CAP in GeoNames:
 * resta nell'elenco con la sola provincia. Le località di GeoNames che non sono
 * comuni (frazioni, vecchi comuni fusi) finiscono in un secondo elenco.
 *
 * USO (una volta l'anno, o quando cambiano i comuni):
 *   node scripts/genera-comuni-cap.mjs
 */
import { writeFileSync } from 'fs';
import { inflateRawSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'frontend', 'src', 'app', 'data', 'comuni-cap.ts');
const URL_ISTAT = 'https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv';
const URL_GEONAMES = 'https://download.geonames.org/export/zip/IT.zip';

async function scarica(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Estrae un file da uno zip (quanto basta per IT.zip: deflate o stored). */
function daZip(zip, nome) {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip non valido');
  let p = zip.readUInt32LE(eocd + 16);
  const n = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const metodo = zip.readUInt16LE(p + 10);
    const compresso = zip.readUInt32LE(p + 20);
    const lNome = zip.readUInt16LE(p + 28), lExtra = zip.readUInt16LE(p + 30), lComm = zip.readUInt16LE(p + 32);
    const locale = zip.readUInt32LE(p + 42);
    const nomeFile = zip.toString('utf8', p + 46, p + 46 + lNome);
    if (nomeFile === nome) {
      const inizio = locale + 30 + zip.readUInt16LE(locale + 26) + zip.readUInt16LE(locale + 28);
      const dati = zip.subarray(inizio, inizio + compresso);
      return metodo === 0 ? dati : inflateRawSync(dati);
    }
    p += 46 + lNome + lExtra + lComm;
  }
  throw new Error(`${nome} non trovato nello zip`);
}

/** CSV con ';', campi tra virgolette che possono contenere a-capo. */
function leggiCsv(testo) {
  const righe = [];
  let riga = [], campo = '', q = false;
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i];
    if (q) {
      if (ch === '"' && testo[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') q = false;
      else campo += ch;
    } else if (ch === '"') q = true;
    else if (ch === ';') { riga.push(campo); campo = ''; }
    else if (ch === '\n') { riga.push(campo.replace(/\r$/, '')); righe.push(riga); riga = []; campo = ''; }
    else campo += ch;
  }
  if (campo || riga.length) { riga.push(campo); righe.push(riga); }
  return righe.filter(r => r.some(c => c.trim()));
}

const PARTICELLE = new Set(['di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'd', 'de', 'nel', 'nell', 'nella',
  'sul', 'sull', 'sulla', 'in', 'e', 'ed', 'con', 'al', 'all', 'allo', 'alla', 'a', 'da', 'dal', 'dalla']);
const norm = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/['’`.]/g, ' ').replace(/[-/]+/g, ' ').replace(/\s+/g, ' ').trim();
const senzaParticelle = s => norm(s).split(' ').filter(w => !PARTICELLE.has(w)).join(' ');

const [csvIstat, zipGeo] = await Promise.all([scarica(URL_ISTAT), scarica(URL_GEONAMES)]);

// ── ISTAT ────────────────────────────────────────────────────────────────────
const istat = leggiCsv(new TextDecoder('windows-1252').decode(csvIstat));
const testa = istat[0];
const col = re => { const i = testa.findIndex(h => re.test(h)); if (i < 0) throw new Error(`colonna ${re}`); return i; };
const iNome = col(/^Denominazione in italiano/i);
const iAltro = col(/^Denominazione altra lingua/i);
const iSigla = col(/^Sigla automobilistica/i);
const comuni = istat.slice(1).map(r => ({
  nome: r[iNome].trim(),
  alt: r[iAltro].trim(),
  sigla: r[iSigla].trim().toUpperCase(),
  cap: new Set(),
}));

// ── GeoNames ─────────────────────────────────────────────────────────────────
const geo = daZip(zipGeo, 'IT.txt').toString('utf8').split('\n').filter(Boolean).map(l => {
  const c = l.split('\t');
  return { cap: c[1], nome: c[2], sigla: (c[6] || '').toUpperCase() };
}).filter(g => /^\d{5}$/.test(g.cap) && g.nome && g.sigla);

const perChiave = new Map();   // "nome normalizzato|SIGLA" → righe GeoNames
const aggiungi = (mappa, k, g) => { if (!mappa.has(k)) mappa.set(k, []); mappa.get(k).push(g); };
// Tre chiavi per riga: nome normalizzato, senza particelle e tutto attaccato
// ("Montecompatri" in GeoNames, "Monte Compatri" per ISTAT).
const attaccato = s => norm(s).replace(/ /g, '');
for (const g of geo) {
  aggiungi(perChiave, norm(g.nome) + '|' + g.sigla, g);
  aggiungi(perChiave, senzaParticelle(g.nome) + '|' + g.sigla, g);
  aggiungi(perChiave, '=' + attaccato(g.nome) + '|' + g.sigla, g);
}
const usate = new Set();       // righe GeoNames assegnate a un comune
let perPrefisso = 0;
for (const c of comuni) {
  const nomi = [c.nome, ...(c.alt ? c.alt.split('/') : [])];
  let trovate = null;
  for (const n of nomi) {
    trovate = perChiave.get(norm(n) + '|' + c.sigla) || perChiave.get(senzaParticelle(n) + '|' + c.sigla)
      || perChiave.get('=' + attaccato(n) + '|' + c.sigla);
    if (trovate) break;
  }
  for (const g of trovate || []) { c.cap.add(g.cap); usate.add(g); }
}

// Nome allungato o accorciato ("Lonato" → "Lonato del Garda", "Gattico" →
// "Gattico-Veruno"). Si accetta solo se il candidato nella provincia è uno, non è
// già di un altro comune, lo reclama un comune solo e non è una parola generica
// ("Borgo" in provincia di Trento combacerebbe con tre comuni diversi):
// meglio nessun CAP che uno sbagliato.
const GENERICHE = new Set(['borgo', 'casali', 'villa', 'castello', 'castel', 'monte', 'san', 'santa', 'santo', 'porto',
  'marina', 'valle', 'val', 'ponte', 'torre', 'rocca', 'colle', 'piano', 'pieve', 'terme', 'lido', 'bagni', 'case']);
const reclami = new Map();     // "nome GeoNames|SIGLA" → comuni che lo reclamano
for (const c of comuni) {
  if (c.cap.size) continue;
  const n = norm(c.nome);
  const candidati = new Set(geo.filter(g => g.sigla === c.sigla && !usate.has(g))
    .map(g => norm(g.nome))
    .filter(g => !GENERICHE.has(g) && (n.startsWith(g + ' ') || g.startsWith(n + ' '))));
  if (candidati.size === 1) aggiungi(reclami, [...candidati][0] + '|' + c.sigla, c);
}
for (const [k, chi] of reclami) {
  if (chi.length !== 1) continue;
  for (const g of perChiave.get(k)) { chi[0].cap.add(g.cap); usate.add(g); }
  perPrefisso++;
  if (process.env.DEBUG) console.log('per prefisso:', chi[0].nome, '←', k);
}

// Secondo giro, solo per chi è rimasto senza CAP: la provincia può essere
// cambiata dopo i dati di GeoNames (in Sardegna molti comuni hanno ancora la
// vecchia sigla). Si accetta il nome da solo quando è univoco da entrambe le
// parti e la riga GeoNames non è già di un altro comune: mai un CAP a caso.
const nomiIstat = new Map();
for (const c of comuni) aggiungi(nomiIstat, norm(c.nome), c);
const liberePerNome = new Map();
for (const g of geo) if (!usate.has(g)) aggiungi(liberePerNome, norm(g.nome), g);
let perNome = 0;
for (const c of comuni) {
  if (c.cap.size) continue;
  const k = norm(c.nome);
  const libere = liberePerNome.get(k);
  if (!libere || nomiIstat.get(k).length !== 1) continue;
  if (new Set(libere.map(g => g.sigla)).size !== 1) continue;
  for (const g of libere) { c.cap.add(g.cap); usate.add(g); }
  perNome++;
}

// Località che non sono comuni (frazioni, comuni fusi): utili, ma in coda.
const localita = new Map();
for (const g of geo) {
  if (usate.has(g)) continue;
  const k = g.nome + '|' + g.sigla;
  if (!localita.has(k)) localita.set(k, { nome: g.nome, sigla: g.sigla, cap: new Set() });
  localita.get(k).cap.add(g.cap);
}

const riga = (x, alt) => [x.nome, x.sigla, [...x.cap].sort().join(','), ...(alt ? [alt] : [])].join('|');
const ordina = (a, b) => a.nome.localeCompare(b.nome, 'it') || a.sigla.localeCompare(b.sigla);
const testoComuni = comuni.sort(ordina).map(c => riga(c, c.alt)).join('\n');
const testoLocalita = [...localita.values()].sort(ordina).map(l => riga(l)).join('\n');

const senzaCap = comuni.filter(c => !c.cap.size);
const oggi = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, `// FILE GENERATO da scripts/genera-comuni-cap.mjs il ${oggi}: non modificarlo a mano.
//
// Comuni italiani: ISTAT, "Elenco dei codici e delle denominazioni delle unità
// territoriali" (https://www.istat.it), licenza CC BY 4.0.
// CAP e località: GeoNames (https://www.geonames.org), licenza CC BY 4.0.
// Abbinamento per nome e sigla di provincia; dati forniti "così come sono".
//
// Una riga per voce: nome|SIGLA|cap,cap,…|nome in altra lingua (se c'è).
// ${comuni.length} comuni (${senzaCap.length} senza CAP noto), ${localita.size} località.

/** Comuni ufficiali. */
export const COMUNI = ${JSON.stringify(testoComuni)};

/** Località che non sono comuni: frazioni e comuni soppressi. */
export const LOCALITA = ${JSON.stringify(testoLocalita)};
`);

console.log(`comuni ${comuni.length}, con CAP ${comuni.length - senzaCap.length} (per prefisso ${perPrefisso}, per solo nome ${perNome}), senza CAP ${senzaCap.length}`);
console.log(`località ${localita.size}`);
console.log('senza CAP:', senzaCap.map(c => `${c.nome} (${c.sigla})`).join(', '));
console.log(`scritto ${OUT}`);
