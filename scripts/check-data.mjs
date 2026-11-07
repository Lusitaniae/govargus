// Sanity checks for the hand-curated data. Offline; exits nonzero on any error.
import { readFile, access } from 'node:fs/promises';

const ROOT = new URL('../src/data/', import.meta.url);
const load = async (f) => JSON.parse(await readFile(new URL(f, ROOT), 'utf8'));
const errors = [];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const { groups, indicators } = await load('indicators.json');
const presidents = await load('presidents.json');
const events = await load('events.json');

const groupIds = new Set(groups.map((g) => g.id));
const ids = new Set();
for (const ind of indicators) {
  if (ids.has(ind.id)) errors.push(`duplicate indicator ${ind.id}`);
  ids.add(ind.id);
  if (!groupIds.has(ind.group)) errors.push(`${ind.id}: unknown group ${ind.group}`);
  // Provisional rolling 12-month windows overlap each other, so averaging them
  // would count the same months several times.
  if (ind.source.provisional && ind.summary !== 'change') errors.push(`${ind.id}: provisional data needs summary "change"`);
  try {
    await access(new URL(`series/${ind.id}.json`, ROOT));
  } catch {
    errors.push(`${ind.id}: no series file (run make data)`);
  }
}

presidents.forEach((p, i) => {
  if (!isDate(p.start)) errors.push(`${p.slug}: bad start`);
  if (p.end !== null && !isDate(p.end)) errors.push(`${p.slug}: bad end`);
  const next = presidents[i + 1];
  if (next && p.end !== next.start) errors.push(`${p.slug}: term does not end where ${next.slug} begins`);
  if (!next && p.end !== null) errors.push(`${p.slug}: last president should have end: null`);
});

const KINDS = new Set(['law', 'trade', 'fed', 'shock', 'order']);
for (const e of events) {
  const where = `event ${e.date} "${e.title}"`;
  if (!isDate(e.date)) errors.push(`${where}: bad date`);
  if (!KINDS.has(e.kind)) errors.push(`${where}: unknown kind ${e.kind}`);
  if (!e.link?.startsWith('https://')) errors.push(`${where}: link must be https`);
  for (const id of e.indicators) if (!ids.has(id)) errors.push(`${where}: unknown indicator ${id}`);
}
const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
if (sorted.some((e, i) => e !== events[i])) errors.push('events.json is not sorted by date');

for (const ind of indicators) if (!ind.keyword || ind.keyword !== ind.keyword.trim()) errors.push(`${ind.id}: needs a "keyword" (the search phrase)`);

// --- presidential records (scripts/fetch-records.mjs, plus hand-entered EO ranges) ---
const slugs = new Set(presidents.map((p) => p.slug));
const isCount = (v) => Number.isInteger(v) && v >= 0;
const loadIf = async (f) => { try { return await load(f); } catch { errors.push(`${f}: missing (run make records)`); return null; } };

const vetoes = await loadIf('records/vetoes.json');
if (vetoes) {
  for (const r of vetoes.presidents) {
    if (r.slug && !slugs.has(r.slug)) errors.push(`vetoes: unknown president ${r.slug}`);
    if (![r.regular, r.pocket, r.overridden].every(isCount) || r.regular + r.pocket !== r.total) errors.push(`vetoes: bad counts for ${r.president}`);
  }
}
const clemency = await loadIf('records/clemency.json');
if (clemency) {
  for (const [slug, t] of Object.entries(clemency.terms)) {
    if (!slugs.has(slug)) errors.push(`clemency: unknown president ${slug}`);
    if (![t.pardons, t.commutations, t.remissions].every(isCount)) errors.push(`clemency: bad counts for ${slug}`);
  }
}
const deport = await loadIf('records/deportations.json');
if (deport) {
  deport.years.forEach((y, i) => {
    if (i && y.fy !== deport.years[i - 1].fy + 1) errors.push(`deportations: gap before FY${y.fy}`);
    if (![y.removals, y.returns, y.expulsions].every(isCount)) errors.push(`deportations: bad counts for FY${y.fy}`);
  });
}
// Order-number ranges must agree with the order-by-order count wherever both exist.
const ranges = await loadIf('records/executive-order-ranges.json');
if (ranges) {
  const orders = await load('policy/executive-orders.json');
  for (const [slug, [lo, hi]] of Object.entries(ranges.ranges)) {
    const p = presidents.find((x) => x.slug === slug);
    if (!p) { errors.push(`executive-order-ranges: unknown president ${slug}`); continue; }
    if (!(hi >= lo)) errors.push(`executive-order-ranges: ${slug} range is backwards`);
    if (orders[0] && orders[0].date <= p.start) {
      const n = orders.filter((o) => o.date >= p.start && o.date < (p.end ?? '9999')).length;
      if (n !== hi - lo + 1) errors.push(`executive-order-ranges: ${slug} spans ${hi - lo + 1} numbers but the Federal Register lists ${n} orders`);
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${indicators.length} indicators, ${presidents.length} presidents, ${events.length} events`);
