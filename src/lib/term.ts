// One indicator during one presidential term: the pages at
// /presidents/<slug>/<indicator>, for searches like "gas prices under Biden".
// A pilot for the indicators people search for most; the rest stay on the
// president and indicator pages.
import {
  type Indicator, type President, type Point, type TermStat, indicators, presidents, events, seriesFor, termStat,
  termEnd, periodEnd, formatValue, formatPeriod, formatHeadline, CHART_FROM,
} from './data';
import { subject } from './summary';
import { termYears } from './seo';

/** Indicator id → the phrase people search with. Order is the order pages are listed in. */
export const TERM_PAGES: Record<string, string> = {
  'gas-price': 'Gas prices',
  inflation: 'Inflation',
  unemployment: 'Unemployment',
  jobs: 'Jobs',
  debt: 'National debt',
};

const shown = () => presidents.filter((p) => termEnd(p) > CHART_FROM);

/** Every president × pilot indicator with data for the term. */
export function termPages(): { p: President; ind: Indicator }[] {
  return shown().flatMap((p) => Object.keys(TERM_PAGES)
    .map((id) => indicators.find((i) => i.id === id)!)
    .filter((ind) => termStat(ind, seriesFor(ind.id).points, p) !== null)
    .map((ind) => ({ p, ind })));
}

export const hasTermPage = (p: President, ind: Indicator) =>
  ind.id in TERM_PAGES && termEnd(p) > CHART_FROM && termStat(ind, seriesFor(ind.id).points, p) !== null;

export const termPath = (p: President, ind: Indicator) => `/presidents/${p.slug}/${ind.id}`;
export const termHeading = (p: President, ind: Indicator) => `${TERM_PAGES[ind.id]} under ${p.name}`;
export const termTitle = (p: President, ind: Indicator) => `${termHeading(p, ind)}, ${termYears(p)}`;

/** "2.6 pts", "$1.34", "10.6 million jobs": a magnitude without its sign. */
const magnitude = (v: number, ind: Indicator) => formatValue(Math.abs(v), ind, { signed: true }).replace(/^\+/, '');
const relative = (ind: Indicator) => !ind.unit.startsWith('%');
const ordinal = (n: number) => (n === 1 ? '' : `${n}${n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}-`);

export const headline = (s: TermStat) => (s.kind === 'average' ? s.mean! : s.perYear!);

/** Completed terms with data, for ranking. */
export function completedTerms(ind: Indicator) {
  const points = seriesFor(ind.id).points;
  return shown()
    .map((p) => ({ p, stat: termStat(ind, points, p) }))
    .filter((t): t is { p: President; stat: TermStat } => t.stat !== null && !t.stat.partial);
}

/** "the 2nd-fastest fall of the 8 completed terms", or null for a term still running. */
export function rankPhrase(ind: Indicator, p: President): string | null {
  const done = completedTerms(ind);
  const i = done.findIndex((t) => t.p.slug === p.slug);
  if (i < 0 || done.length < 2) return null;
  const v = headline(done[i].stat);
  const desc = done.filter((t) => headline(t.stat) > v).length + 1;
  const asc = done.filter((t) => headline(t.stat) < v).length + 1;
  const of = `of the ${done.length} completed terms since ${shown()[0].start.slice(0, 4)}`;
  if (ind.summary === 'average') {
    return desc <= asc ? `the ${ordinal(desc)}highest average ${of}` : `the ${ordinal(asc)}lowest average ${of}`;
  }
  if (v > 0 && desc <= asc) return `the ${ordinal(desc)}fastest rise ${of}`;
  if (v < 0 && asc <= desc) return `the ${ordinal(asc)}fastest fall ${of}`;
  return `${ordinal(desc).replace(/-$/, '') || '1st'} ${of}, counting from the fastest rise`;
}

/** The answer in two or three sentences: where it started and ended, the inherited trend, the rank. */
export function termLead(p: President, ind: Indicator): string {
  const s = termStat(ind, seriesFor(ind.id).points, p)!;
  const subj = subject(ind);
  const rank = rankPhrase(ind, p);
  if (s.kind === 'average') {
    const prior = s.priorMean !== undefined ? `, against ${formatValue(s.priorMean, ind)} in the four years before` : '';
    return `${s.partial ? `So far under ${p.name}, ${subj} has averaged` : `Under ${p.name}, ${subj} averaged`} ${formatValue(s.mean!, ind)}${prior}.` +
      (rank ? ` That is ${rank}.` : '');
  }
  const [d0, v0] = s.start!, [d1, v1] = s.end!;
  const delta = v1 - v0;
  const pct = relative(ind) && v0 !== 0 ? ` (${delta >= 0 ? '+' : '−'}${Math.abs((delta / v0) * 100).toFixed(1)}%)` : '';
  const move = Number(formatValue(delta, ind).replace(/[^\d.]/g, '')) === 0 ? 'little changed' : `${delta > 0 ? 'up' : 'down'} ${magnitude(delta, ind)}${pct}`;
  const from = `${formatValue(v0, ind)} in ${formatPeriod(d0, ind.frequency)}`;
  const to = `${formatValue(v1, ind)} in ${formatPeriod(d1, ind.frequency)}`;
  const opening = s.partial
    ? `So far under ${p.name}, ${subj} has gone from ${from} to ${to}, ${move}.`
    : `Under ${p.name}, ${subj} went from ${from} to ${to}, ${move}.`;
  const pace = ` That is ${formatHeadline(s.perYear!, ind)}${s.priorPerYear !== undefined ? `, against ${formatHeadline(s.priorPerYear, ind)} in the four years before` : ''}.`;
  return opening + pace + (rank ? ` Ranked by yearly change, it is ${rank}.` : '');
}

export function termDescription(p: President, ind: Indicator): string {
  const s = termStat(ind, seriesFor(ind.id).points, p)!;
  const fig = s.kind === 'average'
    ? `averaged ${formatValue(s.mean!, ind)}${s.partial ? ' so far' : ''}`
    : `${formatValue(s.start![1], ind)} to ${formatValue(s.end![1], ind)}${s.partial ? ' so far' : ''}`;
  return `${termHeading(p, ind)} (${termYears(p)}): ${fig}. Year by year, against the trend inherited and other terms.`;
}

/** Observations the term figure is built from. */
function termPoints(ind: Indicator, p: President, s: TermStat): Point[] {
  const points = seriesFor(ind.id).points;
  if (s.kind === 'average') return points.filter(([d]) => d >= p.start && periodEnd(d, ind.frequency) <= termEnd(p));
  return points.filter(([d]) => d >= s.start![0] && d <= s.end![0]);
}

export interface YearRow { label: string; value: number; change?: number }

/**
 * Year by year. 'change' indicators: the value before inauguration, then the
 * last value of each year, with the change from the row before. 'average'
 * indicators: the mean of each year's periods inside the term.
 */
export function termYearsTable(ind: Indicator, p: President): YearRow[] {
  const s = termStat(ind, seriesFor(ind.id).points, p)!;
  const pts = termPoints(ind, p, s);
  const byYear = new Map<string, Point[]>();
  for (const pt of pts) byYear.set(pt[0].slice(0, 4), [...(byYear.get(pt[0].slice(0, 4)) ?? []), pt]);
  const perYear = { monthly: 12, quarterly: 4, annual: 1 }[ind.frequency];

  if (s.kind === 'average') {
    return [...byYear].map(([y, ps]) => ({
      label: ps.length < perYear ? `${y} (${formatPeriod(ps[0][0], ind.frequency).replace(` ${y}`, '')}–${formatPeriod(ps.at(-1)![0], ind.frequency).replace(` ${y}`, '')})` : y,
      value: ps.reduce((a, b) => a + b[1], 0) / ps.length,
    }));
  }
  const rows: YearRow[] = [{ label: `${formatPeriod(s.start![0], ind.frequency)}, before inauguration`, value: s.start![1] }];
  for (const [y, ps] of byYear) {
    const last = ps.at(-1)!;
    if (last[0] === s.start![0]) continue;
    rows.push({ label: formatPeriod(last[0], ind.frequency), value: last[1], change: last[1] - rows.at(-1)!.value });
  }
  return rows;
}

/** Highest and lowest single reading during the term. */
export function termExtremes(ind: Indicator, p: President): { hi: Point; lo: Point } {
  const pts = termPoints(ind, p, termStat(ind, seriesFor(ind.id).points, p)!);
  return {
    hi: pts.reduce((a, b) => (b[1] > a[1] ? b : a)),
    lo: pts.reduce((a, b) => (b[1] < a[1] ? b : a)),
  };
}

export const termEvents = (ind: Indicator, p: President) =>
  events.filter((e) => e.indicators.includes(ind.id) && e.date >= p.start && e.date < termEnd(p));

/** Every term, current one included, sorted by the headline figure, highest first. */
export function rankedTerms(ind: Indicator) {
  const points = seriesFor(ind.id).points;
  return shown()
    .map((p) => ({ p, stat: termStat(ind, points, p) }))
    .filter((t): t is { p: President; stat: TermStat } => t.stat !== null)
    .sort((a, b) => headline(b.stat) - headline(a.stat));
}
