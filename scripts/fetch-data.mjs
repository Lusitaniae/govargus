// Pulls every indicator in src/data/indicators.json from its source and writes
// one JSON file per indicator to src/data/series/, plus NBER recession ranges.
// Run with `make data`. No API keys needed. Sources, by `source.kind`:
//   fred         FRED's public CSV endpoint
//   fbi          FBI Crime Data Explorer estimated-crimes file (SRS, 1979+)
//   cdc-socrata  data.cdc.gov datasets, spliced across `parts`
//   cdc-wonder   CDC WONDER XML query API, spliced across `requests`
//   census-xlsx  Census time-series spreadsheets (a row x the Percent columns)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readXlsx } from './lib/xlsx.mjs';

const ROOT = new URL('../src/data/', import.meta.url);
const SERIES_DIR = new URL('series/', ROOT);
// Keep a few years before the charts start so the first president's
// "inherited trend" can be computed.
const KEEP_FROM = '1972-01-01';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { as = 'text', ...init } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000), ...init });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (as === 'json') return await res.json();
      if (as === 'buffer') return Buffer.from(await res.arrayBuffer());
      return await res.text();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${String(url).slice(0, 120)}: ${err.message}`);
      await sleep(5000 * attempt);
    }
  }
}

const annual = (year, value) => [`${year}-01-01`, Math.round(value * 1000) / 1000];

/** Joins parts in order; a later part wins where they overlap, and overlaps are checked. */
function splice(id, parts) {
  const byDate = new Map();
  for (const part of parts) {
    for (const [d, v] of part) {
      const prev = byDate.get(d);
      if (prev !== undefined && Math.abs(prev - v) > Math.max(0.15, Math.abs(v) * 0.02)) {
        console.warn(`  ${id}: sources disagree for ${d.slice(0, 4)} (${prev} vs ${v}); using the later source`);
      }
      byDate.set(d, v);
    }
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b));
}

// --- FRED --------------------------------------------------------------------

function parseFredCsv(text) {
  const [, ...rows] = text.trim().split('\n');
  return rows
    .map((row) => row.split(','))
    .filter(([, v]) => v !== '' && v !== '.' && Number.isFinite(Number(v)))
    .map(([d, v]) => [d, Number(v)]);
}

async function fred({ series, transformation }) {
  const url = new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
  url.searchParams.set('id', series);
  if (transformation) url.searchParams.set('transformation', transformation);
  return parseFredCsv(await get(url));
}

// --- FBI ---------------------------------------------------------------------

// One spreadsheet holds every crime series, so it is downloaded once.
let fbiRows;
async function fbiTable() {
  if (fbiRows) return fbiRows;
  const CDE = 'https://cde.ucr.cjis.gov/LATEST';
  const downloads = await get(`${CDE}/webapp/assets/JSON/downloads/downloads.json`, { as: 'json' });
  // The file name changes with every annual release, so look it up.
  const key = JSON.stringify(downloads).match(/"awsFile"\s*:\s*"([^"]*estimated_crimes_[^"]*)"/)?.[1];
  if (!key) throw new Error('estimated-crimes file not found in downloads.json');
  const signed = await get(`${CDE}/s3/signedurl?key=${encodeURIComponent(key)}`, { as: 'json' });
  const buf = await get(Object.values(signed)[0], { as: 'buffer' });
  // Named .csv, but the payload has been an xlsx; accept either.
  const rows = buf.readUInt32LE(0) === 0x04034b50
    ? readXlsx(buf)
    : buf.toString('utf8').trim().split('\n').map((l) => l.split(',').map((c) => c.trim()));
  const header = rows[0].map((h) => h.toLowerCase());
  fbiRows = rows.slice(1).filter((r) => /^\d{4}$/.test(r[0])).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return fbiRows;
}

async function fbi({ field }) {
  const rows = await fbiTable();
  const points = [];
  for (const year of [...new Set(rows.map((r) => r.year))].sort()) {
    const inYear = rows.filter((r) => r.year === year);
    // National rows have no state; some years (2017–2020) have none, and there
    // the 50 states plus DC sum exactly to what the national row would be.
    let rowsToSum = inYear.filter((r) => !r.state_abbr);
    if (!rowsToSum.length) rowsToSum = inYear.filter((r) => r.state_abbr && r.state_abbr !== 'PR');
    const pop = rowsToSum.reduce((s, r) => s + Number(r.population), 0);
    const count = rowsToSum.reduce((s, r) => s + Number(r[field]), 0);
    if (pop > 0 && Number.isFinite(count)) points.push(annual(year, (count / pop) * 100_000));
  }
  return points;
}

// --- CDC data.cdc.gov (Socrata) ----------------------------------------------

async function cdcSocrata({ parts }, id) {
  const loaded = [];
  for (const part of parts) {
    const url = new URL(`https://data.cdc.gov/resource/${part.dataset}.json`);
    for (const [k, v] of Object.entries(part.where)) url.searchParams.set(k, v);
    url.searchParams.set('$limit', '5000');
    const rows = await get(url, { as: 'json' });
    loaded.push(rows
      .filter((r) => r[part.value] !== undefined && r[part.value] !== '')
      .map((r) => annual(String(r[part.year]).trim().slice(0, 4), Number(r[part.value])))
      .filter(([, v]) => Number.isFinite(v)));
  }
  return splice(id, loaded);
}

// --- CDC WONDER ----------------------------------------------------------------

// WONDER takes a saved request as XML via POST and asks for 15s between queries.
async function cdcWonder({ requests }, id) {
  const loaded = [];
  for (const [i, req] of requests.entries()) {
    if (i > 0) await sleep(16_000);
    const xml = await readFile(new URL(`wonder/${req.file}`, import.meta.url), 'utf8');
    const body = new URLSearchParams({ request_xml: xml, accept_datause_restrictions: 'true' });
    const res = await get(`https://wonder.cdc.gov/controller/datarequest/${req.dataset}`, {
      method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const points = [];
    for (const [, row] of res.matchAll(/<r>([\s\S]*?)<\/r>/g)) {
      const cells = [...row.matchAll(/<c\s([^>]*?)\/?>/g)].map((m) => m[1]);
      const year = cells[0]?.match(/\bl="\s*(\d{4})\s*"/)?.[1];
      // Last cell is the age-adjusted rate.
      const rate = Number(cells.at(-1)?.match(/\bv="([^"]*)"/)?.[1]?.replace(/,/g, ''));
      if (year && Number.isFinite(rate)) points.push(annual(year, rate));
    }
    if (!points.length) throw new Error(`WONDER ${req.dataset} returned no rows`);
    loaded.push(points);
  }
  return splice(id, loaded);
}

// --- Census spreadsheets -------------------------------------------------------

async function censusXlsx({ url, match }) {
  const rows = readXlsx(await get(url, { as: 'buffer' }));
  const headerAt = rows.findIndex((r) => r.some((c) => /^\d{4}\b/.test(c)) && r[0]);
  const header = rows[headerAt], sub = rows[headerAt + 1];
  const row = rows.find((r) => Object.entries(match).every(([i, v]) => r[i] === v));
  if (!row) throw new Error(`no row matching ${JSON.stringify(match)}`);
  const points = [];
  header.forEach((cell, col) => {
    const year = cell.match(/^(\d{4})\b/)?.[1];
    if (!year) return;
    // Each year spans Estimate | MOE | Percent | MOE; find its Percent column.
    let pc = col;
    while (pc < col + 4 && sub[pc] !== 'Percent') pc++;
    const v = Number(row[pc]);
    if (sub[pc] === 'Percent' && row[pc] !== '' && Number.isFinite(v)) points.push(annual(year, v));
  });
  return points.sort(([a], [b]) => a.localeCompare(b));
}

const FETCHERS = { fred, fbi, 'cdc-socrata': cdcSocrata, 'cdc-wonder': cdcWonder, 'census-xlsx': censusXlsx };

// --- run -----------------------------------------------------------------------

const config = JSON.parse(await readFile(new URL('indicators.json', ROOT), 'utf8'));
await mkdir(SERIES_DIR, { recursive: true });
const only = process.argv[2];

let failed = 0;
for (const ind of config.indicators) {
  if (only && ind.id !== only) continue;
  try {
    const fetcher = FETCHERS[ind.source.kind];
    if (!fetcher) throw new Error(`unknown source kind ${ind.source.kind}`);
    const points = (await fetcher(ind.source, ind.id)).filter(([d]) => d >= KEEP_FROM);
    if (points.length < 8) throw new Error(`only ${points.length} points`);
    const out = { id: ind.id, fetched: new Date().toISOString().slice(0, 10), points };
    await writeFile(new URL(`${ind.id}.json`, SERIES_DIR), JSON.stringify(out) + '\n');
    console.log(`${ind.id.padEnd(26)} ${points.length} pts, ${points[0][0].slice(0, 4)}–, latest ${points.at(-1).join(' = ')}`);
  } catch (err) {
    failed++;
    console.error(`FAILED ${ind.id}: ${err.message}`);
  }
}

if (!only) {
  // NBER recession indicator (monthly 0/1) -> [start, end] ranges.
  const rec = (await fred({ series: 'USREC' })).filter(([d]) => d >= KEEP_FROM);
  const ranges = [];
  for (const [d, v] of rec) {
    if (v === 1 && (!ranges.length || ranges.at(-1).end)) ranges.push({ start: d, end: null });
    if (v === 0 && ranges.length && !ranges.at(-1).end) ranges.at(-1).end = d;
  }
  await writeFile(new URL('recessions.json', ROOT), JSON.stringify(ranges, null, 2) + '\n');
  console.log(`recessions: ${ranges.length}`);
}

if (failed) process.exit(1);
