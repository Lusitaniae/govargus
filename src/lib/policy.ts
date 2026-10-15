// The generated policy record: every executive order and public law, as
// fetched by scripts/fetch-policy.mjs. The hand-curated major events stay in
// events.json; this is the full, unranked record behind them.
import ordersJson from '../data/policy/executive-orders.json';
import { type Indicator, type President, type Point, presidents, termEnd } from './data';

export interface ExecutiveOrder { n: number | null; date: string; title: string; url: string }
export interface Law { law: string; date: string; title: string; url: string | null; ceremonial?: boolean }

export const executiveOrders = ordersJson as ExecutiveOrder[];

const lawFiles = import.meta.glob<Law[]>('../data/policy/laws/*.json', { eager: true, import: 'default' });
const congresses = Object.keys(lawFiles).map((f) => Number(f.match(/(\d+)\.json$/)![1])).sort((a, b) => a - b);
export const laws: Law[] = Object.values(lawFiles).flat().filter((l) => l.date).sort((a, b) => a.date.localeCompare(b.date));

// A Congress starts on January 3 of odd years.
const congressStart = (c: number) => `${1789 + 2 * (c - 1)}-01-03`;
// Laws are complete from the first cached Congress onward, provided there are no gaps.
const firstContiguous = congresses.reduceRight((first, c) => (c === first - 1 ? c : first), congresses.at(-1) ?? 0);
export const coverage = {
  laws: congresses.length ? congressStart(firstContiguous) : null,
  // The Federal Register API's presidential documents begin with 1994.
  orders: executiveOrders[0]?.date ?? null,
};

const inTerm = (p: President) => (d: string) => d >= p.start && d < termEnd(p);

export function policyRecord(p: President) {
  const within = inTerm(p);
  const termLaws = laws.filter((l) => within(l.date));
  const termOrders = executiveOrders.filter((o) => within(o.date));
  return {
    laws: termLaws,
    substantive: termLaws.filter((l) => !l.ceremonial).length,
    ceremonial: termLaws.filter((l) => l.ceremonial).length,
    orders: termOrders,
    lawsComplete: coverage.laws !== null && coverage.laws <= p.start,
    lawsAny: coverage.laws !== null && coverage.laws < termEnd(p),
    ordersComplete: coverage.orders !== null && coverage.orders <= p.start,
    ordersAny: coverage.orders !== null && coverage.orders < termEnd(p),
  };
}

/** Annual counts as chart points, from the first fully covered year to the last full one. */
export function perYear(dates: string[], from: string | null): Point[] {
  if (!from) return [];
  const firstYear = Number(from.slice(0, 4)) + (from.slice(5) > '01-31' ? 1 : 0);
  const lastYear = new Date().getUTCFullYear();
  const counts = new Map<number, number>();
  for (const d of dates) counts.set(Number(d.slice(0, 4)), (counts.get(Number(d.slice(0, 4))) ?? 0) + 1);
  const out: Point[] = [];
  for (let y = firstYear; y <= lastYear; y++) out.push([`${y}-01-01`, counts.get(y) ?? 0]);
  return out;
}

export const presidentsWithPolicy = () => presidents.map((p) => ({ p, rec: policyRecord(p) }));

// Pseudo-indicators so the counts can use the same chart component.
const countIndicator = (id: string, name: string, unit: string): Indicator => ({
  id, name, unit, group: 'policy', decimals: 0, frequency: 'annual', summary: 'average',
  description: '', source: { kind: 'generated', series: id, publisher: '' },
});
export const lawsIndicator = countIndicator('laws-per-year', 'Substantive public laws per year', 'laws');
export const ordersIndicator = countIndicator('orders-per-year', 'Executive orders per year', 'orders');
