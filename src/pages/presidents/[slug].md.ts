import { presidents } from '../../lib/data';
import { presidentMarkdown, presidentsShown, markdownResponse } from '../../lib/markdown';

export function getStaticPaths() {
  return presidentsShown().map((p) => ({ params: { slug: p.slug } }));
}

export function GET({ params }: { params: { slug: string } }) {
  return markdownResponse(presidentMarkdown(presidents.find((p) => p.slug === params.slug)!));
}
