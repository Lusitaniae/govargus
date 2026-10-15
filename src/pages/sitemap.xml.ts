// One sitemap for the whole site. Dynamic routes mirror the getStaticPaths of
// their pages; a new page type needs adding here.
import { indicators, presidents, seriesFor, termEnd, CHART_FROM } from '../lib/data';
import { abs } from '../lib/seo';

export function GET() {
  // lastmod is when a page's data was last fetched; pages built from every series take the newest.
  const fetched = (id: string) => seriesFor(id).fetched;
  const newest = indicators.map((i) => fetched(i.id)).sort().at(-1)!;
  const paths: [string, string?][] = [
    ['/', newest], ['/presidents'], ['/compare', newest], ['/events'], ['/about'],
    ...indicators.flatMap((i): [string, string][] => [[`/indicators/${i.id}`, fetched(i.id)], [`/compare/${i.id}`, fetched(i.id)]]),
    ...presidents.filter((p) => termEnd(p) > CHART_FROM).map((p): [string, string] => [`/presidents/${p.slug}`, newest]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map(([p, mod]) => `  <url><loc>${abs(p)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
