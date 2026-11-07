// Presidential records counted per term: executive orders, vetoes, pardons and
// commutations, and deportations. Executive orders come from the Federal
// Register record (scripts/fetch-policy.mjs) plus hand-checked order-number
// ranges for earlier terms; the rest from scripts/fetch-records.mjs. Each JSON
// file names its source.
import vetoesJson from '../data/records/vetoes.json';
import clemencyJson from '../data/records/clemency.json';
import deportationsJson from '../data/records/deportations.json';
import rangesJson from '../data/records/executive-order-ranges.json';
import { type President, presidents, termEnd, today, CHART_FROM } from './data';
import { executiveOrders, coverage } from './policy';

export interface Source { publisher: string; label: string; page: string; [k: string]: unknown }

/** The terms the site covers, oldest first. */
export const recordTerms = () => presidents.filter((p) => termEnd(p) > CHART_FROM);
export const isCurrent = (p: President) => p.end === null;
/** Years in office, to today for the current term. */
export const yearsInOffice = (p: President) => (Date.parse(termEnd(p)) - Date.parse(p.start)) / (365.25 * 864e5);
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * 864e5).toISOString().slice(0, 10);

export const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** "eight years", or "so far" wording for the current term. */
export const termLength = (p: President) => {
  const y = Math.round(yearsInOffice(p));
  return `${WORDS[y] ?? y} year${y === 1 ? '' : 's'}`;
};
export const n = (v: number) => v.toLocaleString('en-US');

// --- executive orders -------------------------------------------------------------

export const orderRanges = rangesJson as { source: Source; checked: string; ranges: Record<string, [number, number]> };

export interface OrderStat {
  p: President;
  count: number;
  perYear: number;
  /** Orders signed in the first 100 days; only where the Federal Register record covers the whole term. */
  first100: number | null;
  numbers: [number, number] | null;
  /** Counted order by order from the Federal Register, not from the number range. */
  fromRecord: boolean;
}

export function orderStats(): OrderStat[] {
  return recordTerms().flatMap((p) => {
    const inTerm = executiveOrders.filter((o) => o.date >= p.start && o.date < termEnd(p));
    const fromRecord = coverage.orders !== null && coverage.orders <= p.start;
    const range = orderRanges.ranges[p.slug];
    if (!fromRecord && !range) return [];
    const nums = inTerm.map((o) => o.n).filter(Boolean);
    const count = fromRecord ? inTerm.length : range[1] - range[0] + 1;
    const cutoff = addDays(p.start, 100);
    return [{
      p, count,
      perYear: count / yearsInOffice(p),
      first100: fromRecord && cutoff <= today() ? inTerm.filter((o) => o.date < cutoff).length : null,
      numbers: fromRecord ? (nums.length ? [Math.min(...nums), Math.max(...nums)] : null) : range,
      fromRecord,
    }];
  });
}

// --- vetoes -------------------------------------------------------------------------

export interface VetoRow { president: string; congresses: string; slug: string | null; regular: number; pocket: number; total: number; overridden: number }
export const vetoes = vetoesJson as { source: Source; fetched: string; presidents: VetoRow[] };

// --- clemency -------------------------------------------------------------------------

export interface ClemencyTerm {
  pardons: number; commutations: number; remissions: number; period: string;
  proclamations?: { date: string; title: string }[];
}
export const clemency = clemencyJson as { sources: (Source & { updated?: string | null })[]; fetched: string; terms: Record<string, ClemencyTerm> };

// --- deportations -----------------------------------------------------------------------

export interface FiscalYear { fy: number; removals: number; returns: number; expulsions: number; source: string }
export const deportations = deportationsJson as { sources: (Source & { years: string; file?: string })[]; fetched: string; years: FiscalYear[] };

/**
 * A fiscal year (October to September) belongs to whoever was in office for
 * most of it: FY2009 ran from October 2008 to September 2009, so it is Obama's.
 */
export const presidentOfFiscalYear = (fy: number) =>
  presidents.find((p) => p.start <= `${fy}-04-01` && `${fy}-04-01` < termEnd(p)) ?? null;

/** Fiscal years a term owns: from its first to the one in progress or last before it ended. */
function fiscalYearsOf(p: President): number[] {
  const out: number[] = [];
  for (let fy = Number(p.start.slice(0, 4)); fy <= Number(termEnd(p).slice(0, 4)) + 1; fy++) {
    if (presidentOfFiscalYear(fy)?.slug === p.slug && `${fy - 1}-10-01` < termEnd(p)) out.push(fy);
  }
  return out;
}

export interface DeportationTerm {
  p: President;
  years: FiscalYear[];
  /** Fiscal years the term owns that have no published data yet. */
  missing: number[];
  removals: number;
  returns: number;
  expulsions: number;
}

export function deportationTerms(): DeportationTerm[] {
  const byFy = new Map(deportations.years.map((y) => [y.fy, y]));
  return recordTerms().map((p) => {
    const fys = fiscalYearsOf(p);
    const years = fys.map((fy) => byFy.get(fy)).filter((y): y is FiscalYear => y !== undefined);
    const sum = (k: 'removals' | 'returns' | 'expulsions') => years.reduce((a, y) => a + y[k], 0);
    return { p, years, missing: fys.filter((fy) => !byFy.has(fy)), removals: sum('removals'), returns: sum('returns'), expulsions: sum('expulsions') };
  });
}

/** The other record pages, for cross-links. */
export const RECORD_PAGES = [
  { path: '/executive-orders', label: 'Executive orders by president' },
  { path: '/vetoes', label: 'Vetoes by president' },
  { path: '/pardons', label: 'Pardons by president' },
  { path: '/deportations', label: 'Deportations by president' },
];
