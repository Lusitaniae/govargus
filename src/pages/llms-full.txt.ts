// Every indicator and president page as Markdown in one file, for agents that
// would rather make one request than crawl.
import { indicators } from '../lib/data';
import { indicatorMarkdown, presidentMarkdown, presidentsShown, markdownResponse } from '../lib/markdown';

export function GET() {
  const pages = [
    ...indicators.map(indicatorMarkdown),
    ...presidentsShown().slice().reverse().map(presidentMarkdown),
  ];
  return markdownResponse(pages.join('\n---\n\n'), 'text/plain');
}
