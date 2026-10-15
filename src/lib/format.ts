// Value and period formatting shared by server-rendered pages and the chart
// tooltip script. Imports no data, so the client bundle stays small.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPeriod(date: string, freq: string): string {
  const [y, m] = date.split('-').map(Number);
  // An annual point not dated January is a rolling 12-month window.
  if (freq === 'annual' && m !== 1) return `12 mo. to ${MONTHS[(m + 10) % 12]} ${y + 1}`;
  if (freq === 'annual') return String(y);
  if (freq === 'quarterly') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatValue(v: number, ind: { unit: string; decimals: number }, opts: { signed?: boolean; decimals?: number } = {}): string {
  const decimals = opts.decimals ?? ind.decimals;
  // Sign from the rounded value, so nothing prints as "−0.00".
  const r = Number(v.toFixed(decimals));
  const sign = opts.signed && r > 0 ? '+' : r < 0 ? '−' : '';
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (ind.unit === '$') return `${sign}$${n}`;
  if (ind.unit.startsWith('%')) return `${sign}${n}${opts.signed ? ' pts' : '%'}`;
  return `${sign}${n} ${ind.unit}`;
}
