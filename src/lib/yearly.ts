// Calendar-year tables for the "by year" indicator pages: one row per year,
// newest first, with the president in office for most of that year.
import { type Indicator, type President, type Series, type Point, presidents, presidentAt, termEnd, CHART_FROM } from './data';
import { MONTHS } from './format';

/** Tables start with the first term the site covers (Carter, 1977), or where a series starts. */
const FIRST_TERM_YEAR = Number(presidents.find((p) => termEnd(p) > CHART_FROM)!.start.slice(0, 4));

export interface YearRow {
  year: number;
  /** "2026 (Jan–Sep)" for a year not complete yet; "12 mo. to Jun 2025" for a provisional rolling window. */
  label: string;
  /** Mean of the year's observations; sub-annual series only. */
  avg?: number;
  /** The year's last observation (December, Q4), or the annual value. */
  end: number;
  /** Change in `end` from the row before; 'change' indicators only. */
  change?: number;
  /** The same change relative to the earlier value, in %, where that reads sensibly. */
  pct?: number;
  president: President | null;
  partial: boolean;
  provisional: boolean;
}

/** First year with a full year of data, no earlier than the first term. */
export function tableFromYear(series: Series): number {
  const [d] = series.points[0];
  const first = Number(d.slice(0, 4)) + (d.slice(5) === '01-01' ? 0 : 1);
  return Math.max(first, FIRST_TERM_YEAR);
}

// The president in office for most of a calendar year: inauguration is January 20.
const presidentOfYear = (y: number) => presidentAt(`${y}-07-01`);

const monthName = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
const quarterName = (d: string) => `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

/** The heading for the `end` column: "December", "Q4", or "Value" for annual series. */
export const endLabel = (ind: Indicator) => ({ monthly: 'December', quarterly: 'Q4', annual: 'Value' })[ind.frequency];

export function yearlyRows(ind: Indicator, series: Series): YearRow[] {
  const from = tableFromYear(series);
  const relative = !ind.unit.startsWith('%');
  const withChange = (rows: Omit<YearRow, 'change' | 'pct'>[], before?: number): YearRow[] =>
    rows.map((r, i) => {
      const prev = i === 0 ? before : rows[i - 1].end;
      if (ind.summary !== 'change' || prev === undefined) return r;
      const change = r.end - prev;
      return { ...r, change, pct: relative && prev !== 0 ? (change / Math.abs(prev)) * 100 : undefined };
    });

  if (ind.frequency === 'annual') {
    // Calendar-year points, then at most one provisional rolling 12-month window after them.
    const calendar = series.points.filter(([d]) => d.slice(5) === '01-01');
    const rolling = series.points.filter(([d]) => d.slice(5) !== '01-01' && d > calendar.at(-1)![0]).at(-1);
    const before = calendar.find(([d]) => Number(d.slice(0, 4)) === from - 1)?.[1];
    const rows = calendar
      .filter(([d]) => Number(d.slice(0, 4)) >= from)
      .map(([d, v]) => ({
        year: Number(d.slice(0, 4)), label: d.slice(0, 4), end: v,
        president: presidentOfYear(Number(d.slice(0, 4))), partial: false,
        provisional: series.provisionalFrom !== undefined && d >= series.provisionalFrom,
      }));
    const out = withChange(rows, before);
    if (rolling) {
      const [d, v] = rolling;
      const [y, m] = d.split('-').map(Number);
      // A window dated Jul 2024 covers Jul 2024 to Jun 2025.
      const endYear = y + 1, endMonth = MONTHS[(m + 10) % 12];
      const mid = `${m <= 6 ? y : y + 1}-${String(((m + 5) % 12) + 1).padStart(2, '0')}-01`;
      out.push({ year: endYear, label: `12 mo. to ${endMonth} ${endYear}`, end: v, president: presidentAt(mid), partial: true, provisional: true });
    }
    return out.reverse();
  }

  const byYear = new Map<number, Point[]>();
  for (const pt of series.points) {
    const y = Number(pt[0].slice(0, 4));
    if (y >= from - 1) byYear.set(y, [...(byYear.get(y) ?? []), pt]);
  }
  const perYear = ind.frequency === 'monthly' ? 12 : 4;
  const name = ind.frequency === 'monthly' ? monthName : quarterName;
  const before = byYear.get(from - 1)?.at(-1)?.[1];
  const rows = [...byYear]
    .filter(([y]) => y >= from)
    .map(([y, pts]) => {
      const partial = pts.length < perYear;
      return {
        year: y,
        label: partial ? `${y} (${name(pts[0][0])}–${name(pts.at(-1)![0])})` : String(y),
        avg: pts.reduce((a, p) => a + p[1], 0) / pts.length,
        end: pts.at(-1)![1],
        president: presidentOfYear(y),
        partial,
        provisional: series.provisionalFrom !== undefined && pts.at(-1)![0] >= series.provisionalFrom,
      };
    });
  return withChange(rows, before).reverse();
}
