// llms.txt (https://llmstxt.org): what the site is and where its pages are,
// pointing at the Markdown versions of each page.
import { groups, indicators, seriesFor, formatValue, formatPeriod, formatDate } from '../lib/data';
import { abs, indicatorTitle, presidentTitle } from '../lib/seo';
import { presidentsShown, markdownResponse } from '../lib/markdown';

export function GET() {
  const refreshed = indicators.map((i) => seriesFor(i.id).fetched).sort().at(-1)!;
  const latest = (id: string) => {
    const ind = indicators.find((i) => i.id === id)!;
    const [d, v] = seriesFor(id).points.at(-1)!;
    return `${formatValue(v, ind)} (${formatPeriod(d, ind.frequency)})`;
  };
  const body = [
    '# Govargus',
    '',
    '> Official US data on the economy, household finances, the federal budget, crime and health, by presidential term since 1980. Every term is shown next to the trend it inherited (the four years before it), with recessions and the laws, executive orders and shocks around each change. Descriptive, not a score.',
    '',
    `All series come from US government agencies (BLS, BEA, Census, FBI, CDC, OMB and others, several via FRED) or the World Bank, and are re-fetched weekly; last refreshed ${formatDate(refreshed)}. Federal data is public domain. Each page below is Markdown; drop the .md for the HTML page with charts.`,
    '',
    ...groups.flatMap((g) => [
      `## ${g.name}`,
      '',
      ...indicators.filter((i) => i.group === g.id).map((i) =>
        `- [${indicatorTitle(i, seriesFor(i.id))}](${abs(`/indicators/${i.id}.md`)}): ${i.description} Latest ${latest(i.id)}.`),
      '',
    ]),
    '## Presidents',
    '',
    ...presidentsShown().slice().reverse().map((p) => `- [${presidentTitle(p)}](${abs(`/presidents/${p.slug}.md`)})`),
    '',
    '## Optional',
    '',
    `- [Method](${abs('/about')}): how term figures are computed, data sources and why presidents are not scored`,
    `- [Policy timeline](${abs('/events')}): laws, executive orders, Fed decisions and shocks tracked on the charts`,
    `- [Every page in one file](${abs('/llms-full.txt')})`,
    '- [Source code and raw data](https://github.com/Lusitaniae/govargus)',
    '',
  ].join('\n');
  return markdownResponse(body, 'text/plain');
}
