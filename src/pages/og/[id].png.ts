// Social preview images (1200×630): one per indicator, plus 'site' for every
// other page. Drawn as SVG and rasterized at build time with resvg, using the
// vendored DejaVu fonts so the output doesn't depend on the build machine.
import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { indicators, presidents, seriesFor, chartFrom, termEnd, formatValue, formatPeriod, type Point } from '../../lib/data';

export function getStaticPaths() {
  return [...indicators.map((i) => i.id), 'site'].map((id) => ({ params: { id } }));
}

const W = 1200, H = 630, L = 72, R = W - 72;
const fontFiles = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) => `${process.cwd()}/src/assets/fonts/${f}`);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  // A parenthetical like '(% of GDP)' stays on one line.
  for (const word of text.match(/\([^)]*\)|\S+/g) ?? []) {
    const last = lines.at(-1);
    if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

function chart(points: Point[], top: number, bottom: number): string {
  const from = chartFrom(points);
  const pts = points.filter(([d]) => d >= from);
  const t0 = Date.parse(from), t1 = Date.parse(pts.at(-1)![0]);
  const x = (d: string) => L + ((Date.parse(d) - t0) / (t1 - t0)) * (R - L);
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const y = (v: number) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const bands = presidents
    .filter((p) => termEnd(p) > from && p.start < pts.at(-1)![0])
    .map((p, i) => {
      const x0 = Math.max(L, x(p.start)), x1 = Math.min(R, x(termEnd(p)));
      return i % 2 ? '' : `<rect x="${x0}" y="${top - 16}" width="${x1 - x0}" height="${bottom - top + 32}" fill="#0b0b0b" fill-opacity="0.045"/>`;
    }).join('');
  const d = pts.map(([dt, v], i) => `${i ? 'L' : 'M'}${x(dt).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return `${bands}
    <path d="${d}" fill="none" stroke="#2a78d6" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${L}" y="${bottom + 50}" font-size="24" fill="#898781">${from.slice(0, 4)}</text>
    <text x="${R}" y="${bottom + 50}" font-size="24" fill="#898781" text-anchor="end">${pts.at(-1)![0].slice(0, 4)}</text>`;
}

function card(title: string, sub: string, subStrong: string, points: Point[]): string {
  const lines = wrap(title, 30).slice(0, 2);
  const titleSvg = lines.map((l, i) => `<text x="${L}" y="${196 + i * 70}" font-size="60" font-weight="bold" fill="#0b0b0b">${esc(l)}</text>`).join('');
  const subY = 196 + lines.length * 70 + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="DejaVu Sans">
    <rect width="${W}" height="${H}" fill="#f9f9f7"/>
    <text x="${L}" y="96" font-size="34" font-weight="bold" fill="#0b0b0b">Gov<tspan fill="#2a78d6">argus</tspan></text>
    ${titleSvg}
    <text x="${L}" y="${subY}" font-size="32" fill="#52514e"><tspan font-weight="bold" fill="#2a78d6">${esc(subStrong)}</tspan>${esc(sub)}</text>
    ${chart(points, subY + 60, H - 90)}
  </svg>`;
}

export const GET: APIRoute = ({ params }) => {
  const ind = indicators.find((i) => i.id === params.id);
  const svg = ind
    ? (() => {
        const s = seriesFor(ind.id);
        const [d, v] = s.points.at(-1)!;
        return card(ind.name, `  latest, ${formatPeriod(d, ind.frequency)}`, formatValue(v, ind), s.points);
      })()
    : card('How is the United States doing?', 'Official data across every presidential term since 1980', '', seriesFor('unemployment').points);
  const png = new Resvg(svg, { font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};
