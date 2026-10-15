// Pulls every indicator in src/data/indicators.json from its source and writes
// one JSON file per indicator to src/data/series/, plus NBER recession ranges.
// Run with `make data`. No API keys: FRED's public CSV endpoint is used.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ROOT = new URL('../src/data/', import.meta.url);
const SERIES_DIR = new URL('series/', ROOT);
// Keep a few years before the charts start so the first president's
// "inherited trend" can be computed.
const KEEP_FROM = '1972-01-01';

async function fredCsv(series, transformation) {
  const url = new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
  url.searchParams.set('id', series);
  if (transformation) url.searchParams.set('transformation', transformation);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { url: url.toString(), text: await res.text() };
    } catch (err) {
      if (attempt >= 3) throw new Error(`${series}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function parseCsv(text) {
  const [, ...rows] = text.trim().split('\n');
  return rows
    .map((row) => row.split(','))
    .filter(([, v]) => v !== '' && v !== '.' && Number.isFinite(Number(v)))
    .map(([d, v]) => [d, Number(v)]);
}

const config = JSON.parse(await readFile(new URL('indicators.json', ROOT), 'utf8'));
await mkdir(SERIES_DIR, { recursive: true });

let failed = 0;
for (const ind of config.indicators) {
  try {
    const { series, transformation } = ind.source;
    const { url, text } = await fredCsv(series, transformation);
    const points = parseCsv(text).filter(([d]) => d >= KEEP_FROM);
    if (points.length < 10) throw new Error(`only ${points.length} points`);
    const out = { id: ind.id, source: url, fetched: new Date().toISOString().slice(0, 10), points };
    await writeFile(new URL(`${ind.id}.json`, SERIES_DIR), JSON.stringify(out) + '\n');
    console.log(`${ind.id.padEnd(26)} ${points.length} pts, latest ${points.at(-1).join(' = ')}`);
  } catch (err) {
    failed++;
    console.error(`FAILED ${ind.id}: ${err.message}`);
  }
}

// NBER recession indicator (monthly 0/1) -> [start, end] ranges.
const rec = parseCsv((await fredCsv('USREC')).text).filter(([d]) => d >= KEEP_FROM);
const ranges = [];
for (const [d, v] of rec) {
  if (v === 1 && (!ranges.length || ranges.at(-1).end)) ranges.push({ start: d, end: null });
  if (v === 0 && ranges.length && !ranges.at(-1).end) ranges.at(-1).end = d;
}
await writeFile(new URL('recessions.json', ROOT), JSON.stringify(ranges, null, 2) + '\n');
console.log(`recessions: ${ranges.length}`);

if (failed) process.exit(1);
