// Plain-language facts about one indicator, generated from its data: the
// highs and lows since the chart starts, and how terms compare against the
// trend each inherited. Descriptive only; the method page explains why
// nothing here is a score.
import {
  type Indicator, type Series, type TermStat, presidents, presidentAt, termStat, termEnd, chartFrom,
  formatValue, formatPeriod, formatHeadline, periodEnd, CHART_FROM,
} from './data';
import { shortName } from './seo';

/** Sentence subject: 'the unemployment rate', or the indicator's own `phrase` where that reads wrong. */
export const subject = (ind: Indicator) => ind.phrase ?? `the ${shortName(ind)}`;

// A period belongs to whoever held office for most of it: 2025 is Trump's, though it starts under Biden.
const at = (d: string, ind: Indicator) => {
  const mid = new Date((Date.parse(d) + Date.parse(periodEnd(d, ind.frequency))) / 2).toISOString().slice(0, 10);
  const p = presidentAt(mid);
  return `${formatPeriod(d, ind.frequency)}${p ? ` under ${p.name}` : ''}`;
};

/** "Since 1980, the unemployment rate ranged from 3.4% in Apr 2023 under Joe Biden to ..." */
export function extremes(ind: Indicator, series: Series): string {
  const from = chartFrom(series.points);
  const pts = series.points.filter(([d]) => d >= from);
  // First occurrence of each extreme.
  const hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  return `Since ${from.slice(0, 4)}, ${subject(ind)} ranged from ${formatValue(lo[1], ind)} in ${at(lo[0], ind)} ` +
    `to ${formatValue(hi[1], ind)} in ${at(hi[0], ind)}.`;
}

/** Fastest rise and fall (or highest and lowest average) among completed terms, each next to its inherited trend. */
export function termRange(ind: Indicator, series: Series): string | null {
  const done = presidents
    .filter((p) => p.end !== null && termEnd(p) > CHART_FROM)
    .map((p) => ({ p, stat: termStat(ind, series.points, p) }))
    .filter((t): t is { p: typeof t.p; stat: TermStat } => t.stat !== null && !t.stat.partial);
  if (done.length < 2) return null;
  const val = (s: TermStat) => (s.kind === 'average' ? s.mean! : s.perYear!);
  const prior = (s: TermStat) => (s.kind === 'average' ? s.priorMean : s.priorPerYear);
  const sorted = [...done].sort((a, b) => val(b.stat) - val(a.stat));
  const top = sorted[0], bottom = sorted.at(-1)!;
  const fig = ({ stat }: { stat: TermStat }) => {
    const before = prior(stat);
    return `${formatHeadline(val(stat), ind)}${before !== undefined ? ` against ${formatHeadline(before, ind)} in the four years before` : ''}`;
  };
  const lead = `Of the ${done.length} completed terms with data, ${subject(ind)}`;

  if (ind.summary === 'average') {
    return `${lead} averaged highest under ${top.p.name}, at ${fig(top)}, and lowest under ${bottom.p.name}, at ${fig(bottom)}.`;
  }
  const [a, b] = [val(top.stat), val(bottom.stat)];
  // Fastest rise and fastest fall; when every term moved the same way, fastest and slowest.
  const [first, second] = a > 0 ? [top, bottom] : [bottom, top];
  const verbs = a > 0 && b < 0 ? ['rose fastest', 'fell fastest'] : a > 0 ? ['rose fastest', 'slowest'] : ['fell fastest', 'slowest'];
  return `${lead} ${verbs[0]} under ${first.p.name}, at ${fig(first)}, and ${verbs[1]} under ${second.p.name}, at ${fig(second)}.`;
}

/** Where the current term stands, from the last period before inauguration to the latest data. */
export function currentTerm(ind: Indicator, series: Series): string | null {
  const p = presidents.at(-1)!;
  if (p.end !== null) return null;
  const stat = termStat(ind, series.points, p);
  if (!stat) return null;
  if (stat.kind === 'average') return `So far under ${p.name}, it has averaged ${formatValue(stat.mean!, ind)}.`;
  return `So far under ${p.name}, it has gone from ${formatValue(stat.start![1], ind)} in ${formatPeriod(stat.start![0], ind.frequency)} ` +
    `to ${formatValue(stat.end![1], ind)} in ${formatPeriod(stat.end![0], ind.frequency)}.`;
}
