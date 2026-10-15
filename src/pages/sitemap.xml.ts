// One sitemap for the whole site. Dynamic routes mirror the getStaticPaths of
// their pages; a new page type needs adding here.
import { indicators, presidents, termEnd, CHART_FROM } from '../lib/data';
import { abs } from '../lib/seo';

export function GET() {
  const paths = [
    '/', '/presidents', '/compare', '/events', '/about',
    ...indicators.flatMap((i) => [`/indicators/${i.id}`, `/compare/${i.id}`]),
    ...presidents.filter((p) => termEnd(p) > CHART_FROM).map((p) => `/presidents/${p.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${abs(p)}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
