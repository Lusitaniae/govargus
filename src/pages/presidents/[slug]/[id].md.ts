import { presidents, indicators } from '../../../lib/data';
import { termMarkdown, markdownResponse } from '../../../lib/markdown';
import { termPages } from '../../../lib/term';

export function getStaticPaths() {
  return termPages().map(({ p, ind }) => ({ params: { slug: p.slug, id: ind.id } }));
}

export function GET({ params }: { params: { slug: string; id: string } }) {
  const p = presidents.find((x) => x.slug === params.slug)!;
  return markdownResponse(termMarkdown(p, indicators.find((i) => i.id === params.id)!));
}
