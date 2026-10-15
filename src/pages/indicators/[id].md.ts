import { indicators } from '../../lib/data';
import { indicatorMarkdown, markdownResponse } from '../../lib/markdown';

export function getStaticPaths() {
  return indicators.map((ind) => ({ params: { id: ind.id } }));
}

export function GET({ params }: { params: { id: string } }) {
  return markdownResponse(indicatorMarkdown(indicators.find((i) => i.id === params.id)!));
}
