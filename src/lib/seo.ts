// Titles, descriptions, absolute URLs and JSON-LD shared by the page templates.
import { type Indicator, type President, type Series, presidents, termEnd, chartFrom, formatValue, formatPeriod, CHART_FROM } from './data';
import { tableFromYear } from './yearly';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Absolute URL for a site path like '/indicators/unemployment'. */
export const abs = (path: string) => new URL(`${base}${path}`, import.meta.env.SITE).href;

/** Pathname without the '.html' / '/index' that build.format 'file' can leave on it. */
export const cleanPath = (pathname: string) => pathname.replace(/\.html$/, '').replace(/\/index$/, '') || '/';

/** Indicator name without its parenthetical, lowercased for mid-sentence use unless it starts with an acronym. */
export function shortName(ind: Indicator): string {
  const s = ind.name.replace(/\s*\(.*\)$/, '');
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export const years = (series: Series) => `${chartFrom(series.points).slice(0, 4)}–${series.points.at(-1)![0].slice(0, 4)}`;
/** Years covered by an indicator's by-year table. */
export const tableYears = (series: Series) => `${tableFromYear(series)}–${series.points.at(-1)![0].slice(0, 4)}`;
const firstTermYear = presidents.find((p) => termEnd(p) > CHART_FROM)!.start.slice(0, 4);
export const termYears = (p: President) => `${p.start.slice(0, 4)}–${p.end?.slice(0, 4) ?? 'present'}`;
const latest = (ind: Indicator, series: Series) => {
  const [d, v] = series.points.at(-1)!;
  return `${formatValue(v, ind)} (${formatPeriod(d, ind.frequency)})`;
};

/** The search phrase with a capital first letter, for the start of a title. */
export const keywordCap = (ind: Indicator) => ind.keyword[0].toUpperCase() + ind.keyword.slice(1);

// Each indicator has two pages with distinct search intents: /indicators/<id> is
// the series year by year, /compare/<id> is every presidential term side by side.
export const indicatorTitle = (ind: Indicator, series: Series) => `US ${ind.keyword} by year, ${tableYears(series)}`;
export const indicatorDescription = (ind: Indicator, series: Series) =>
  `US ${ind.keyword} for every year since ${tableYears(series).slice(0, 4)}, from official data. Latest: ${latest(ind, series)}. Table, chart and the policies around each change.`;

export const compareTitle = (ind: Indicator, series: Series) => `${keywordCap(ind)} by president, ${firstTermYear}–${series.points.at(-1)![0].slice(0, 4)}`;
export const compareDescription = (ind: Indicator, series: Series) =>
  `${keywordCap(ind)} under every president since ${firstTermYear}: ${ind.summary === 'change' ? 'where each term started and ended, the change,' : 'the average in each term'} and the trend it inherited. Latest: ${latest(ind, series)}.`;

export const presidentHeading = (p: President) => `Economy, crime and health under ${p.name}`;
export const presidentTitle = (p: President) => `${presidentHeading(p)}, ${termYears(p)}`;
export const presidentDescription = (p: President) =>
  `How jobs, inflation, income, the deficit, crime and health changed under ${p.name}, ${termYears(p)}, next to the trend inherited.`;

export function breadcrumbs(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
  };
}

export function dataset(ind: Indicator, series: Series) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${ind.name}, United States`,
    description: ind.description,
    url: abs(`/indicators/${ind.id}`),
    isBasedOn: ind.source.page,
    creator: { '@type': 'Organization', name: ind.source.publisher },
    variableMeasured: ind.name,
    temporalCoverage: `${series.points[0][0]}/${series.points.at(-1)![0]}`,
    spatialCoverage: { '@type': 'Place', name: 'United States' },
    dateModified: series.fetched,
    isAccessibleForFree: true,
    // Works of the US federal government are public domain; World Bank data is CC BY 4.0.
    license: ind.source.publisher === 'World Bank' ? 'https://creativecommons.org/licenses/by/4.0/' : 'https://creativecommons.org/publicdomain/mark/1.0/',
    keywords: [ind.name, `${ind.keyword} by year`, `${ind.keyword} by president`, 'United States', 'presidential terms'],
    distribution: [{
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: `https://raw.githubusercontent.com/Lusitaniae/govargus/master/src/data/series/${ind.id}.json`,
    }],
  };
}
