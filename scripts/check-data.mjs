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

if (errors.length) {
  console.error(errors.map((e) => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${indicators.length} indicators, ${presidents.length} presidents, ${events.length} events`);
