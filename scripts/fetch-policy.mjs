// Pulls the policy record into src/data/policy/:
//   executive-orders.json  every EO in the Federal Register (1994 onward), no key
//   laws/<congress>.json   every public law from Congress.gov (97th Congress, 1981, onward)
//
// Congress.gov needs an api.data.gov key: CONGRESS_API_KEY, falling back to
// DEMO_KEY (10 requests/hour). Finished Congresses never change, so their files
// are cached and only missing ones plus the current Congress are fetched. With
// DEMO_KEY the backfill completes over several runs; hitting the rate limit
// keeps what was fetched and exits 0.
import { writeFile, mkdir, access } from 'node:fs/promises';

const ROOT = new URL('../src/data/policy/', import.meta.url);
const LAWS_DIR = new URL('laws/', ROOT);
const KEY = process.env.CONGRESS_API_KEY || 'DEMO_KEY';
const FIRST_CONGRESS = 97;
const currentCongress = Math.floor((new Date().getUTCFullYear() - 1789) / 2) + 1;

class RateLimited extends Error {}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));
    if (res.status === 429) throw new RateLimited();
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url.toString().replace(KEY, '***')}`);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
}

// --- executive orders --------------------------------------------------------

async function fetchExecutiveOrders() {
  const url = new URL('https://www.federalregister.gov/api/v1/documents.json');
  url.searchParams.append('conditions[type][]', 'PRESDOCU');
  url.searchParams.append('conditions[presidential_document_type][]', 'executive_order');
  for (const f of ['executive_order_number', 'title', 'signing_date', 'publication_date', 'html_url']) url.searchParams.append('fields[]', f);
  url.searchParams.set('per_page', '1000');
  url.searchParams.set('order', 'oldest');

  // Corrections carry no EO number and some orders are published twice, so
  // keep exactly one document per order number.
  const orders = [];
  const seen = new Set();
  let next = url.toString();
  while (next) {
    const page = await getJson(next);
    for (const d of page.results ?? []) {
      const n = Number(d.executive_order_number);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      orders.push({
        n,
        date: d.signing_date || d.publication_date,
        title: d.title.trim(),
        url: d.html_url,
      });
    }
    next = page.next_page_url;
  }
  orders.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  await writeFile(new URL('executive-orders.json', ROOT), JSON.stringify(orders, null, 0).replace(/},{/g, '},\n{') + '\n');
  console.log(`executive orders: ${orders.length}, ${orders[0].date} to ${orders.at(-1).date}`);
}

// --- public laws ---------------------------------------------------------------

const BILL_PATH = {
  HR: 'house-bill', S: 'senate-bill',
  HJRES: 'house-joint-resolution', SJRES: 'senate-joint-resolution',
  HCONRES: 'house-concurrent-resolution', SCONRES: 'senate-concurrent-resolution',
  HRES: 'house-resolution', SRES: 'senate-resolution',
};
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');

// Laws that only name, commemorate, honor or appoint something. A heuristic on the
// title, shown as such on the site, so substantive laws can be counted apart.
const CEREMONIAL = /\b(designate|redesignate|to name|post office|postal (service )?facility|courthouse|federal building|commemorat\w*|coins?|congressional gold medal|to rename|memorial (highway|bridge)|national \w+ (day|week|month)|citizen regent)\b/i;

async function fetchLaws(congress) {
  const laws = [];
  let next = `https://api.congress.gov/v3/law/${congress}?format=json&limit=250&api_key=${KEY}`;
  while (next) {
    const page = await getJson(next);
    for (const b of page.bills ?? []) {
      const law = b.laws?.find((l) => l.type === 'Public Law');
      if (!law) continue;
      const path = BILL_PATH[b.type];
      laws.push({
        law: law.number,
        date: b.latestAction?.actionDate,
        title: b.title.trim(),
        url: path ? `https://www.congress.gov/bill/${ordinal(congress)}-congress/${path}/${b.number}` : null,
        ceremonial: CEREMONIAL.test(b.title) || undefined,
      });
    }
    next = page.pagination?.next ? `${page.pagination.next}&api_key=${KEY}` : null;
  }
  const num = (l) => Number(l.law.split('-')[1]);
  laws.sort((a, b) => num(a) - num(b));
  await writeFile(new URL(`${String(congress).padStart(3, '0')}.json`, LAWS_DIR), JSON.stringify(laws, null, 0).replace(/},{/g, '},\n{') + '\n');
  return laws.length;
}

await mkdir(LAWS_DIR, { recursive: true });
await fetchExecutiveOrders();

if (KEY === 'DEMO_KEY') console.warn('CONGRESS_API_KEY not set; using DEMO_KEY (10 requests/hour).');
try {
  for (let c = currentCongress; c >= FIRST_CONGRESS; c--) {
    const file = new URL(`${String(c).padStart(3, '0')}.json`, LAWS_DIR);
    const cached = await access(file).then(() => true, () => false);
    if (cached && c < currentCongress) continue;
    console.log(`laws, ${ordinal(c)} Congress: ${await fetchLaws(c)}`);
  }
} catch (err) {
  if (!(err instanceof RateLimited)) throw err;
  console.warn('Congress.gov rate limit reached; the remaining Congresses will be fetched on the next run.');
}
