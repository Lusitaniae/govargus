// Titles, descriptions, absolute URLs and JSON-LD shared by the page templates.
import { type Indicator, type President, type Series, chartFrom, formatValue, formatPeriod } from './data';

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
export const termYears = (p: President) => `${p.start.slice(0, 4)}–${p.end?.slice(0, 4) ?? 'present'}`;
const latest = (ind: Indicator, series: Series) => {
  const [d, v] = series.points.at(-1)!;
  return `${formatValue(v, ind)} (${formatPeriod(d, ind.frequency)})`;
};

export const indicatorTitle = (ind: Indicator, series: Series) => `US ${shortName(ind)} by president, ${years(series)}`;
export const indicatorDescription = (ind: Indicator, series: Series) =>
  `US ${shortName(ind)}: ${latest(ind, series)}. Every term since ${chartFrom(series.points).slice(0, 4)} next to the trend it inherited, with the policies around it.`;

export const compareTitle = (ind: Indicator) => `${ind.name.replace(/\s*\(.*\)$/, '')}: each president's term side by side`;
export const compareDescription = (ind: Indicator, series: Series) =>
  `${ind.name.replace(/\s*\(.*\)$/, '')} under every president since ${chartFrom(series.points).slice(0, 4)}, lined up from inauguration day. Latest: ${latest(ind, series)}.`;

export const presidentTitle = (p: President) => `Economy, crime and health under ${p.name}, ${termYears(p)}`;
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
    distribution: [{
      '@type': 'DataDownload',
      encodingFormat: 'application/json',
      contentUrl: `https://raw.githubusercontent.com/Lusitaniae/govargus/master/src/data/series/${ind.id}.json`,
    }],
  };
}
