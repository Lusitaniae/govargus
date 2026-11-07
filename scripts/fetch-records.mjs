// Pulls presidential records that are published as tables rather than APIs into
// src/data/records/:
//   vetoes.json        House Office of the Historian: regular, pocket and overridden vetoes, every president
//   clemency.json      DOJ Office of the Pardon Attorney: pardons and commutations granted, Carter onward
//   deportations.json  DHS Office of Homeland Security Statistics: removals, returns and expulsions by fiscal year
// Run with `make records`. No keys. Each source is independent: a failing one
// keeps its previous file, and the run exits nonzero at the end so it shows.
// (Executive orders come from scripts/fetch-policy.mjs; their pre-1994 order
// numbers are hand-entered in src/data/records/executive-order-ranges.json.)
import { writeFile, mkdir } from 'node:fs/promises';
import { readXlsx } from './lib/xlsx.mjs';

const ROOT = new URL('../src/data/records/', import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'text') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (err.status === 404 || attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await sleep(5000 * attempt);
    }
  }
}

// --- HTML tables ---------------------------------------------------------------

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&rsquo;/g, '’')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const stripScripts = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');

/** Rows of cells, colspans expanded so every cell sits in its column. */
function tableRows(tableHtml) {
  return [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(([tr]) =>
    [...tr.matchAll(/<t([hd])([^>]*)>([\s\S]*?)<\/t[hd]>/g)].flatMap(([, , attrs, inner]) => {
      const span = Number(attrs.match(/colspan="?(\d+)/)?.[1] ?? 1);
      return Array.from({ length: span }, (_, i) => (i === 0 ? text(inner) : ''));
    }));
}

/** "1,234" → 1234; dashes, dots, NA and X (not applicable) → 0. */
function count(s, where) {
  const t = s.replace(/[,\s]/g, '');
  if (/^(\.+|—|–|-|NA|X)?$/i.test(t)) return 0;
  if (!/^\d+$/.test(t)) throw new Error(`${where}: not a count: "${s}"`);
  return Number(t);
}

// --- vetoes --------------------------------------------------------------------

const VETOES_PAGE = 'https://history.house.gov/Institution/Presidential-Vetoes/Presidential-Vetoes/';
// Rows are by Congresses served; a president's first Congress identifies the term.
const FIRST_CONGRESS = { 95: 'carter', 97: 'reagan', 101: 'bush-41', 103: 'clinton', 107: 'bush-43', 111: 'obama', 115: 'trump-2017', 117: 'biden', 119: 'trump-2025' };

async function fetchVetoes() {
  const html = stripScripts(await get(VETOES_PAGE));
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
  if (!table) throw new Error('vetoes: no table');
  const [head, ...body] = tableRows(table);
  const col = (re) => {
    const i = head.findIndex((h) => re.test(h));
    if (i < 0) throw new Error(`vetoes: no column ${re}`);
    return i;
  };
  const c = { congresses: col(/congress/i), president: col(/president/i), regular: col(/regular/i), pocket: col(/pocket/i), total: col(/total/i), overridden: col(/overrid/i) };
  const rows = [];
  let totals = null;
  for (const r of body) {
    const n = (k) => count(r[c[k]], `vetoes ${r[c.president]}`);
    if (/^total/i.test(r[c.congresses])) { totals = { regular: n('regular'), pocket: n('pocket'), total: n('total'), overridden: n('overridden') }; continue; }
    const first = Number(r[c.congresses].match(/^(\d+)/)?.[1]);
    const row = {
      president: r[c.president].replace(/\s+\d+$/, ''), // footnote markers
      congresses: r[c.congresses].replace(/-/g, '–'),
      slug: FIRST_CONGRESS[first] ?? null,
      regular: n('regular'), pocket: n('pocket'), total: n('total'), overridden: n('overridden'),
    };
    if (row.regular + row.pocket !== row.total) throw new Error(`vetoes: ${row.president} regular + pocket ≠ total`);
    rows.push(row);
  }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  if (!totals || ['regular', 'pocket', 'total', 'overridden'].some((k) => sum(k) !== totals[k])) throw new Error('vetoes: rows do not add up to the table total');
  const slugs = rows.map((r) => r.slug).filter(Boolean);
  if (slugs.length !== Object.keys(FIRST_CONGRESS).length) throw new Error(`vetoes: matched ${slugs.length} of ${Object.keys(FIRST_CONGRESS).length} recent terms`);
  return {
    source: { publisher: 'US House of Representatives, Office of the Historian', label: 'Presidential Vetoes', page: VETOES_PAGE },
    fetched: today,
    presidents: rows,
  };
}

// --- clemency ------------------------------------------------------------------

const CLEMENCY_PAGE = 'https://www.justice.gov/pardon/clemency-statistics';
const CURRENT_TERM_PAGE = 'https://www.justice.gov/pardon/clemency-grants-president-donald-j-trump-2025-present';
const CLEMENCY_SLUGS = {
  'Joseph R. Biden': 'biden', 'Donald J. Trump': 'trump-2017', 'Barack H. Obama': 'obama', 'George W. Bush': 'bush-43',
  'William J. Clinton': 'clinton', 'George H.W. Bush': 'bush-41', 'Ronald Reagan': 'reagan', 'Jimmy Carter': 'carter',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "January 20, 2025" → "2025-01-20". */
function isoDate(s) {
  const [, month, day, year] = s.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  const m = MONTHS.indexOf(month) + 1;
  if (!m) throw new Error(`not a date: ${s}`);
  return `${year}-${String(m).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function fetchClemency() {
  const html = stripScripts(await get(CLEMENCY_PAGE));
  const updated = text(html.match(/Updated\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[0] ?? '').replace(/^Updated /, '') || null;
  // Each president's table follows a heading with their name.
  const terms = {};
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const before = html.slice(0, m.index);
    const heading = [...before.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/g)].at(-1);
    const name = heading && text(heading[1]);
    const slug = CLEMENCY_SLUGS[name];
    if (!slug) continue;
    const [h1, h2, ...body] = tableRows(m[0]);
    const g = h1.findIndex((h) => /petitions granted/i.test(h));
    if (g < 0) throw new Error(`clemency ${name}: no "Petitions Granted" column`);
    const sub = h2.slice(g - 1, g + 2).join('/');
    // h2 has no cell for "Fiscal Year", so it is one column to the left of h1.
    const subAt = (letter) => {
      const i = h2.findIndex((s, j) => j >= g - 1 && s.toUpperCase().startsWith(letter));
      if (i < 0) throw new Error(`clemency ${name}: no ${letter} under Petitions Granted (${sub})`);
      return i + 1;
    };
    const total = body.find((r) => /^total/i.test(r[0]));
    if (!total) throw new Error(`clemency ${name}: no total row`);
    terms[slug] = {
      pardons: count(total[subAt('P')], `clemency ${name}`),
      commutations: count(total[subAt('C')], `clemency ${name}`),
      remissions: count(total[subAt('R')], `clemency ${name}`),
      period: total[0].replace(/^Total\s*/i, '').replace(/[()]/g, '').trim(),
    };
  }
  const missing = Object.values(CLEMENCY_SLUGS).filter((s) => !terms[s]);
  if (missing.length) throw new Error(`clemency: no table for ${missing.join(', ')}`);

  // The statistics page stops at January 2025; the current term is a list of grants by date.
  const cur = stripScripts(await get(CURRENT_TERM_PAGE));
  let pardons = 0, commutations = 0, batches = 0;
  const proclamations = [];
  const headings = [...cur.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)];
  headings.forEach((h, i) => {
    const t = text(h[1]);
    const date = t.match(/^([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
    if (!date) return;
    if (t === date) {
      // A bare date heads a proclamation pardoning a whole class of people; its title follows.
      const after = cur.slice(h.index + h[0].length, headings[i + 1]?.index ?? undefined);
      proclamations.push({ date: isoDate(date), title: text(after).slice(0, 200) });
      return;
    }
    // Amended warrants re-list people already counted under an earlier date.
    if (/amended/i.test(t)) return;
    const p = Number(t.match(/(\d+)\s+Pardons?/i)?.[1] ?? 0), c = Number(t.match(/(\d+)\s+Commutations?/i)?.[1] ?? 0);
    if (!p && !c) throw new Error(`clemency current term: can't read "${t}"`);
    pardons += p; commutations += c; batches++;
  });
  if (!batches) throw new Error('clemency current term: no grants found');
  terms['trump-2025'] = { pardons, commutations, remissions: 0, period: `through ${today}`, proclamations };

  return {
    sources: [
      { publisher: 'US Department of Justice, Office of the Pardon Attorney', label: 'Clemency Statistics', page: CLEMENCY_PAGE, updated },
      { publisher: 'US Department of Justice, Office of the Pardon Attorney', label: 'Clemency Grants by President Donald J. Trump (2025-Present)', page: CURRENT_TERM_PAGE },
    ],
    fetched: today,
    terms,
  };
}

// --- deportations ---------------------------------------------------------------

const FIRST_FY = 1977;
const yearbookPage = (y) => `https://ohss.dhs.gov/topics/immigration/yearbook/${y}/table39`;
const KHSM_PAGE = 'https://ohss.dhs.gov/khsm/dhs-repatriations';

async function latestYearbook() {
  for (let y = new Date().getUTCFullYear(); y >= 2023; y--) {
    try {
      const html = stripScripts(await get(yearbookPage(y)));
      const table = html.match(/<table[\s\S]*?<\/table>/)?.[0];
      if (table && /removals/i.test(table)) return { year: y, table };
    } catch (err) {
      if (!/HTTP 404/.test(err.message)) throw err;
    }
  }
  throw new Error('deportations: no yearbook Table 39 found');
}

async function fetchDeportations() {
  const yb = await latestYearbook();
  const [head, ...body] = tableRows(yb.table);
  const col = (re) => {
    const i = head.findIndex((h) => re.test(h));
    if (i < 0) throw new Error(`deportations: no column ${re}`);
    return i;
  };
  const c = { admin: col(/^administrative returns/i), enforcement: col(/^enforcement returns/i), removals: col(/^removals/i), expulsions: col(/^expulsions/i) };
  const years = new Map();
  for (const r of body) {
    const fy = Number(r[0]);
    if (!Number.isInteger(fy) || fy < FIRST_FY) continue;
    const n = (k) => count(r[c[k]], `deportations FY${fy}`);
    years.set(fy, { fy, removals: n('removals'), returns: n('admin') + n('enforcement'), expulsions: n('expulsions'), source: 'yearbook' });
  }
  const lastYearbook = Math.max(...years.keys());
  if (lastYearbook - FIRST_FY < 40) throw new Error(`deportations: yearbook table ends at FY${lastYearbook}`);

  // Fiscal years after the yearbook, from the newest Key Homeland Security Metrics workbook.
  const khsm = await get(KHSM_PAGE);
  const files = [...khsm.matchAll(/href="([^"]*Repatriations%20fy(\d\d)m(\d\d)\.xlsx)"/gi)]
    .map(([, href, fy, m]) => ({ href: new URL(href, KHSM_PAGE).href, fy: 2000 + Number(fy), month: Number(m) }))
    // Fiscal years start in October: month 10 is the first of the year, 9 the last.
    .map((f) => ({ ...f, fyMonth: ((f.month + 2) % 12) + 1 }))
    .sort((a, b) => b.fy - a.fy || b.fyMonth - a.fyMonth);
  let khsmFile = null;
  if (files.length) {
    const f = files[0];
    const lastComplete = f.fyMonth === 12 ? f.fy : f.fy - 1;
    const rows = readXlsx(await get(f.href, 'buffer'), { sheet: 'Annual Repatriation Type' });
    const add = new Map();
    for (const [fyCell, type, qty] of rows.slice(1)) {
      const fy = Number(fyCell);
      if (!(fy > lastYearbook && fy <= lastComplete)) continue;
      const y = add.get(fy) ?? { fy, removals: 0, returns: 0, expulsions: 0, source: 'khsm' };
      const n = Number(qty);
      if (/^removals$/i.test(type)) y.removals += n;
      else if (/returns$/i.test(type)) y.returns += n;
      else if (/expulsions/i.test(type)) y.expulsions += n;
      else throw new Error(`deportations: unknown repatriation type "${type}"`);
      add.set(fy, y);
    }
    for (const [fy, y] of add) years.set(fy, y);
    khsmFile = { ...f, lastComplete };
  }
  const list = [...years.values()].sort((a, b) => a.fy - b.fy);
  list.forEach((y, i) => { if (i && y.fy !== list[i - 1].fy + 1) throw new Error(`deportations: gap before FY${y.fy}`); });

  return {
    sources: [
      { publisher: 'DHS Office of Homeland Security Statistics', label: `Yearbook of Immigration Statistics ${yb.year}, Table 39`, page: yearbookPage(yb.year), years: `FY${FIRST_FY}–FY${lastYearbook}` },
      ...(khsmFile && khsmFile.lastComplete > lastYearbook ? [{
        publisher: 'DHS Office of Homeland Security Statistics', label: 'DHS Repatriations (Key Homeland Security Metrics)',
        page: KHSM_PAGE, file: khsmFile.href, years: lastYearbook + 1 === khsmFile.lastComplete ? `FY${khsmFile.lastComplete}` : `FY${lastYearbook + 1}–FY${khsmFile.lastComplete}`,
      }] : []),
    ],
    fetched: today,
    years: list,
  };
}

// --- main --------------------------------------------------------------------------

await mkdir(ROOT, { recursive: true });
let failed = false;
for (const [name, fn] of [['vetoes', fetchVetoes], ['clemency', fetchClemency], ['deportations', fetchDeportations]]) {
  try {
    const data = await fn();
    await writeFile(new URL(`${name}.json`, ROOT), JSON.stringify(data, null, 1) + '\n');
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed = true;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}
if (failed) process.exit(1);
