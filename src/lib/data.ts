import indicatorConfig from '../data/indicators.json';
import presidentsJson from '../data/presidents.json';
import eventsJson from '../data/events.json';
import recessionsJson from '../data/recessions.json';
import { MONTHS, formatValue } from './format';

export { formatPeriod, formatValue } from './format';

export type Point = [string, number];
export type Frequency = 'monthly' | 'quarterly' | 'annual';

export interface Indicator {
  id: string;
  group: string;
  name: string;
  unit: string;
  decimals: number;
  frequency: Frequency;
  summary: 'change' | 'average';
  description: string;
  source: { kind: string; publisher: string; page: string; label: string; [k: string]: unknown };
}
export interface Series { id: string; fetched: string; points: Point[]; provisionalFrom?: string }
export interface President { slug: string; name: string; short: string; party: string; start: string; end: string | null }
export interface PolicyEvent { date: string; kind: string; title: string; summary: string; indicators: string[]; link: string }
export interface Recession { start: string; end: string | null }

export const CHART_FROM = '1980-01-01';

export const groups = indicatorConfig.groups;
export const indicators = indicatorConfig.indicators as Indicator[];
export const presidents = presidentsJson as President[];
export const events = eventsJson as PolicyEvent[];
export const recessions = recessionsJson as Recession[];

const seriesFiles = import.meta.glob<Series>('../data/series/*.json', { eager: true, import: 'default' });
const seriesById = new Map(Object.values(seriesFiles).map((s) => [s.id, s]));

export function seriesFor(id: string): Series {
  const s = seriesById.get(id);
  if (!s) throw new Error(`No series data for ${id} — run make data`);
  return s;
}

/** Charts start in 1980, or later where a series does. */
export const chartFrom = (points: Point[]) => (points[0][0] > CHART_FROM ? points[0][0] : CHART_FROM);

export const today = () => new Date().toISOString().slice(0, 10);
export const termEnd = (p: President) => p.end ?? today();
export const presidentAt = (date: string) =>
  presidents.find((p) => p.start <= date && date < termEnd(p)) ?? null;

export const KIND_LABEL: Record<string, string> = {
  law: 'Law',
  order: 'Executive action',
  trade: 'Trade',
  fed: 'Federal Reserve',
  shock: 'Shock',
};

// --- dates ------------------------------------------------------------------

/** Observations are dated at the start of their period; this is when it ends. */
export function periodEnd(date: string, freq: Frequency): string {
  const d = new Date(date + 'T00:00:00Z');
  const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 12;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function addYears(date: string, years: number): string {
  const [y, rest] = [Number(date.slice(0, 4)), date.slice(4)];
  return `${y + years}${rest}`;
}

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);

// --- values -------------------------------------------------------------------

/** Last observation whose whole period was complete by `date`. */
export function valueAsOf(points: Point[], date: string, freq: Frequency): Point | null {
  let found: Point | null = null;
  for (const p of points) {
    if (periodEnd(p[0], freq) <= date) found = p;
    else break;
  }
  return found;
}

/** Mean of observations whose period falls entirely within [from, to). */
function meanBetween(points: Point[], from: string, to: string, freq: Frequency): { mean: number; n: number; last: string } | null {
  const inside = points.filter((p) => p[0] >= from && periodEnd(p[0], freq) <= to);
  if (!inside.length) return null;
  return { mean: inside.reduce((s, p) => s + p[1], 0) / inside.length, n: inside.length, last: inside.at(-1)![0] };
}

export interface TermStat {
  kind: 'change' | 'average';
  /** 'change': value when the term began and when it ended (or latest). */
  start?: Point;
  end?: Point;
  perYear?: number;
  priorPerYear?: number;
  /** 'average': mean during the term vs the four years before it. */
  mean?: number;
  priorMean?: number;
  /** Term not over yet, or data not published through its end. */
  partial: boolean;
}

export function termStat(ind: Indicator, points: Point[], p: President): TermStat | null {
  const from = p.start;
  const to = termEnd(p);
  const priorFrom = addYears(from, -4);
  // Partial if a whole period ending inside the term hasn't been published yet.
  const nextUnpublishedEnd = periodEnd(periodEnd(points.at(-1)![0], ind.frequency), ind.frequency);
  const partial = p.end === null || nextUnpublishedEnd <= to;

  if (ind.summary === 'average') {
    const during = meanBetween(points, from, to, ind.frequency);
    if (!during) return null;
    const prior = meanBetween(points, priorFrom, from, ind.frequency);
    return { kind: 'average', mean: during.mean, priorMean: prior?.mean, partial };
  }

  const start = valueAsOf(points, from, ind.frequency);
  const end = valueAsOf(points, to, ind.frequency);
  if (!start || !end || end[0] <= start[0]) return null;
  const prior = valueAsOf(points, priorFrom, ind.frequency);
  const perYear = (end[1] - start[1]) / yearsBetween(start[0], end[0]);
  const priorPerYear = prior && prior[0] < start[0] ? (start[1] - prior[1]) / yearsBetween(prior[0], start[0]) : undefined;
  return { kind: 'change', start, end, perYear, priorPerYear, partial };
}

// --- comparing terms ------------------------------------------------------------

export interface Trajectory { slug: string; points: [number, number][]; partial: boolean }

/**
 * One term as [years since inauguration, value] pairs. 'change' indicators are
 * shown relative to the last full period before inauguration, so every term
 * starts at zero; 'average' indicators (rates) keep their actual values.
 */
export function termTrajectory(ind: Indicator, points: Point[], p: President): Trajectory | null {
  const base = valueAsOf(points, p.start, ind.frequency);
  if (!base) return null;
  const end = termEnd(p);
  const rel = ind.summary === 'change';
  const out: [number, number][] = [];
  for (const [d, v] of points) {
    if (d < base[0] || d >= end) continue;
    // Place each observation at the end of its period: that's when it was known.
    const t = yearsBetween(p.start, periodEnd(d, ind.frequency));
    out.push([+t.toFixed(3), rel ? v - base[1] : v]);
  }
  if (out.length < 2) return null;
  return { slug: p.slug, points: out, partial: p.end === null };
}

/** Per-term headline number used in the comparison grid. */
export function termHeadline(stat: TermStat | null): { during: number; before?: number } | null {
  if (!stat) return null;
  return stat.kind === 'average'
    ? { during: stat.mean!, before: stat.priorMean }
    : { during: stat.perYear!, before: stat.priorPerYear };
}

/** Per-year changes are small, so they get one more decimal than levels (whole numbers stay whole). */
export const perYearDecimals = (ind: Indicator) => (ind.decimals === 0 ? 0 : Math.min(2, ind.decimals + 1));

/** "+0.32 pts/yr" for change indicators, "2.4%" for averaged rates. */
export function formatHeadline(v: number, ind: Indicator): string {
  if (ind.summary === 'average') return formatValue(v, ind);
  return `${formatValue(v, ind, { signed: true, decimals: perYearDecimals(ind) })}/yr`;
}

// --- the current term so far ------------------------------------------------------

export interface SoFar {
  kind: 'change' | 'average';
  /** Change since the last full period before inauguration, or the mean so far. */
  value: number;
  /** The previous president's figure at the same point in their term. */
  prev?: number;
  /** 'change' only: relative changes in %, for indicators that aren't already percentages. */
  pct?: number;
  prevPct?: number;
}

/**
 * How an indicator has moved since `p` took office, and how it had moved by the
 * same point in `prev`'s term: the like-for-like comparison for a term in progress.
 */
export function termSoFar(ind: Indicator, points: Point[], p: President, prev?: President): SoFar | null {
  const lastEnd = periodEnd(points.at(-1)![0], ind.frequency);
  if (lastEnd <= p.start) return null;
  const elapsed = Date.parse(lastEnd) - Date.parse(p.start);
  const samePoint = (start: string) => new Date(Date.parse(start) + elapsed).toISOString().slice(0, 10);

  if (ind.summary === 'average') {
    const now = meanBetween(points, p.start, lastEnd, ind.frequency);
    if (!now) return null;
    const before = prev && meanBetween(points, prev.start, samePoint(prev.start), ind.frequency);
    return { kind: 'average', value: now.mean, prev: before?.mean };
  }

  const base = valueAsOf(points, p.start, ind.frequency);
  if (!base) return null;
  // A percent change of a percentage ("unemployment +2%") reads as points; keep those in points.
  const relative = !ind.unit.startsWith('%') && base[1] !== 0;
  let prevChange: number | undefined, prevPct: number | undefined;
  if (prev) {
    const pb = valueAsOf(points, prev.start, ind.frequency);
    const pa = valueAsOf(points, samePoint(prev.start), ind.frequency);
    if (pb && pa && pa[0] > pb[0]) {
      prevChange = pa[1] - pb[1];
      if (relative) prevPct = (prevChange / Math.abs(pb[1])) * 100;
    }
  }
  const value = points.at(-1)![1] - base[1];
  return { kind: 'change', value, prev: prevChange, pct: relative ? (value / Math.abs(base[1])) * 100 : undefined, prevPct };
}

export const monthYear = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
