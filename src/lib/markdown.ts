// Markdown versions of the indicator and president pages, for AI assistants
// and agents: the same figures and summaries as the HTML, without the charts.
// Served at /indicators/<id>.md and /presidents/<slug>.md, and concatenated
// into /llms-full.txt.
import {
  type Indicator, type President, type TermStat, groups, indicators, presidents, events, seriesFor, termStat,
  termEnd, chartFrom, formatValue, formatPeriod, formatDate, perYearDecimals, KIND_LABEL, CHART_FROM,
} from './data';
import { policyRecord } from './policy';
import { abs, indicatorTitle, presidentTitle, termYears } from './seo';
import { extremes, termRange, currentTerm } from './summary';

export const presidentsShown = () => presidents.filter((p) => termEnd(p) > CHART_FROM);

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** One table cell: the plain-text twin of components/TermStat.astro. */
function stat(ind: Indicator, s: TermStat | null, part: 'during' | 'before'): string {
  if (!s) return 'no data';
  const perYear = (v: number) => `${formatValue(v, ind, { signed: true, decimals: perYearDecimals(ind) })}/yr`;
  if (s.kind === 'average') {
    if (part === 'during') return `avg ${formatValue(s.mean!, ind)}${s.partial ? ' so far' : ''}`;
    return s.priorMean !== undefined ? `avg ${formatValue(s.priorMean, ind)}` : '—';
  }
  if (part === 'during') {
    const through = s.partial ? `, through ${formatPeriod(s.end![0], ind.frequency).replace(/^12 mo\. to /, '')}` : '';
    return `${formatValue(s.start![1], ind)} → ${formatValue(s.end![1], ind)} (${perYear(s.perYear!)}${through})`;
  }
  return s.priorPerYear !== undefined ? perYear(s.priorPerYear) : '—';
}

const method = (ind: Indicator) =>
  ind.summary === 'average'
    ? 'Each row is the average during the term, next to the average over the four years before it.'
    : 'Each row is the value at the last full period before inauguration and at the end of the term, with the yearly rate of change, next to the rate of change over the four years before the term (the trend it inherited).';

const caveat = "A term's first year mostly reflects the previous administration's policies, and Congress, the Federal Reserve and the world economy move these numbers too. Govargus describes; it does not score presidents.";

export function indicatorMarkdown(ind: Indicator): string {
  const series = seriesFor(ind.id);
  const [lastDate, lastValue] = series.points.at(-1)!;
  const facts = [extremes(ind, series), termRange(ind, series), currentTerm(ind, series)].filter(Boolean);
  const rows = presidentsShown().map((p) => ({ p, s: termStat(ind, series.points, p) })).reverse();
  const relevant = events.filter((e) => e.indicators.includes(ind.id) && e.date >= chartFrom(series.points));
  return [
    `# ${indicatorTitle(ind, series)}`,
    '',
    `Source page: ${abs(`/indicators/${ind.id}`)}`,
    '',
    ind.description,
    '',
    `Latest: ${formatValue(lastValue, ind)} (${formatPeriod(lastDate, ind.frequency)}${series.provisionalFrom ? ', provisional' : ''}).`,
    `Source: ${ind.source.publisher}, via ${ind.source.label} (${ind.source.page}). ${ind.frequency[0].toUpperCase() + ind.frequency.slice(1)} data, fetched ${formatDate(series.fetched)}.`,
    '',
    facts.join(' '),
    '',
    '## By presidential term',
    '',
    `${method(ind)} ${caveat}`,
    '',
    '| President | Term | During term | 4 years before |',
    '| --- | --- | --- | --- |',
    ...rows.map(({ p, s }) => `| ${cell(p.name)} | ${termYears(p)} | ${cell(stat(ind, s, 'during'))} | ${cell(stat(ind, s, 'before'))} |`),
    ...(relevant.length ? [
      '',
      '## Events that bear on this indicator',
      '',
      ...relevant.map((e) => `- ${formatDate(e.date)}, ${KIND_LABEL[e.kind].toLowerCase()}: ${e.title}. ${e.summary}`),
    ] : []),
    '',
  ].join('\n');
}

export function presidentMarkdown(p: President): string {
  const rec = policyRecord(p);
  const termEvents = events.filter((e) => e.date >= p.start && e.date < termEnd(p));
  return [
    `# ${presidentTitle(p)}`,
    '',
    `Source page: ${abs(`/presidents/${p.slug}`)}`,
    '',
    `${p.party} · ${formatDate(p.start)} – ${p.end ? formatDate(p.end) : 'present'}`,
    '',
    `Each indicator shows how it changed during the term next to the four years before it. ${caveat}`,
    ...groups.flatMap((g) => [
      '',
      `## ${g.name}`,
      '',
      '| Indicator | During term | 4 years before |',
      '| --- | --- | --- |',
      ...indicators.filter((ind) => ind.group === g.id).map((ind) => {
        const s = termStat(ind, seriesFor(ind.id).points, p);
        return `| ${cell(ind.name)} | ${cell(stat(ind, s, 'during'))} | ${cell(stat(ind, s, 'before'))} |`;
      }),
    ]),
    '',
    '## Policy record',
    '',
    rec.lawsAny ? `- Substantive public laws signed: ${rec.substantive}${rec.lawsComplete ? '' : ' (partial record)'}; plus ${rec.ceremonial} naming or commemorative` : '- Public laws: not yet in the record',
    rec.ordersAny ? `- Executive orders signed: ${rec.orders.length}${rec.ordersComplete ? '' : ' (partial: the Federal Register record starts in 1994)'}` : '- Executive orders: not in the Federal Register record, which starts in 1994',
    ...(termEvents.length ? [
      '',
      '## Tracked events during the term',
      '',
      ...termEvents.map((e) => `- ${formatDate(e.date)}, ${KIND_LABEL[e.kind].toLowerCase()}: ${e.title}. ${e.summary}`),
    ] : []),
    '',
  ].join('\n');
}

export const markdownResponse = (body: string, type = 'text/markdown') =>
  new Response(body, { headers: { 'Content-Type': `${type}; charset=utf-8` } });
