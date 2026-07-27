/**
 * Financials for publicly-traded space companies, from SEC EDGAR
 * (US federal government work — public domain).
 *
 * Two steps: resolve a company name to a CIK via the published ticker file,
 * then pull the latest annual revenue and headcount out of its XBRL company
 * facts. Only companies already in the dataset are looked up, so the number of
 * requests scales with matches rather than with EDGAR's ~10,000 filers.
 *
 * EDGAR's fair-access policy requires a declared User-Agent with contact
 * details and caps clients at 10 requests/second; this stays well under.
 */

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const FACTS_URL = 'https://data.sec.gov/api/xbrl/companyfacts';

/**
 * EDGAR's fair-access policy requires a User-Agent naming a real contact, in
 * the form `Name email@domain`. It returns 403 for anything else — including
 * the usual `product/version (url)` shape — so this is read from the
 * environment rather than hard-coded with someone's address. Without it the
 * EDGAR source is skipped and the build continues.
 */
const UA = process.env.SEC_USER_AGENT ?? '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, { attempts = 3 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await sleep(1200 * attempt);
    }
  }
  throw new Error(`edgar ${url}: ${lastError?.message}`);
}

/** Strips corporate suffixes so "Rocket Lab USA, Inc." matches "Rocket Lab". */
function normalise(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(
      /\b(corporation|corp|incorporated|inc|company|co|limited|ltd|llc|lp|plc|holdings?|group|usa|us)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Company names that differ from their SEC registrant name badly enough that
 * normalisation alone will not join them.
 */
const TICKER_HINTS = {
  'Rocket Lab': 'RKLB',
  'Planet Labs': 'PL',
  'Virgin Galactic': 'SPCE',
  'Intuitive Machines': 'LUNR',
  'Redwire Space': 'RDW',
  'Redwire': 'RDW',
  'AST SpaceMobile': 'ASTS',
  'Momentus': 'MNTS',
  'Spire Global': 'SPIR',
  'Maxar Technologies': 'MAXR',
  'Iridium': 'IRDM',
  'Iridium Communications': 'IRDM',
  'Viasat': 'VSAT',
  'EchoStar': 'SATS',
  'L3Harris Technologies': 'LHX',
  'Northrop Grumman': 'NOC',
  'Lockheed Martin': 'LMT',
  'Boeing': 'BA',
  'The Boeing Company': 'BA',
  'Aerojet Rocketdyne': 'AJRD',
  'Honeywell': 'HON',
  'Embraer': 'ERJ',
  'Terran Orbital': 'LLAP',
  'BlackSky': 'BKSY',
  'Firefly Aerospace': 'FLY',
  'Voyager Technologies': 'VOYG',
};

/**
 * Most recent annual value across all the given XBRL concepts.
 *
 * Filers migrate between revenue tags over time, so the newest figure is not
 * necessarily under the first concept that has any data at all — every
 * concept has to be pooled before picking the latest period.
 */
function latestAnnual(facts, concepts) {
  const candidates = [];
  for (const concept of concepts) {
    const units = facts?.['us-gaap']?.[concept]?.units?.USD;
    if (!Array.isArray(units)) continue;
    for (const u of units) {
      if (u.form !== '10-K' || u.fp !== 'FY' || !Number.isFinite(u.val)) continue;
      // Annual figures only: skip quarterly rows that share the FY label.
      const months =
        (new Date(u.end) - new Date(u.start)) / (1000 * 60 * 60 * 24 * 30.4);
      if (u.start && (months < 10 || months > 14)) continue;
      candidates.push(u);
    }
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => String(b.end).localeCompare(String(a.end)));
  const latest = candidates[0];
  return { value: latest.val, fiscalYear: latest.fy ?? null, end: latest.end };
}

/** Headcount is a dei concept, reported as a plain count. */
function latestHeadcount(facts) {
  const units = facts?.dei?.EntityNumberOfEmployees?.units?.pure;
  if (!Array.isArray(units)) return null;
  const annual = units
    .filter((u) => Number.isFinite(u.val))
    .sort((a, b) => String(b.end).localeCompare(String(a.end)));
  return annual.length ? { value: annual[0].val, end: annual[0].end } : null;
}

/**
 * Looks up financials for the given organisations.
 * Returns `Map<orgId, { cik, ticker, registrant, revenue, employees }>`.
 */
export async function fetchEdgarFinancials(organisations, { log = () => {} } = {}) {
  if (!/\S+@\S+\.\S+/.test(UA)) {
    log(
      '  edgar: skipped — set SEC_USER_AGENT="Your Name you@example.com" to enable ' +
        '(SEC fair-access policy requires a contact address)',
    );
    return new Map();
  }

  let tickers;
  try {
    tickers = await getJson(TICKERS_URL);
  } catch (err) {
    log(`  edgar: ticker index unavailable (${err.message}), skipping`);
    return new Map();
  }
  if (!tickers) {
    log('  edgar: ticker index unavailable, skipping');
    return new Map();
  }

  const rows = Object.values(tickers);
  const byTicker = new Map(rows.map((r) => [String(r.ticker).toUpperCase(), r]));
  const byName = new Map();
  for (const row of rows) {
    const key = normalise(row.title);
    if (key && !byName.has(key)) byName.set(key, row);
  }

  // Resolve each organisation to at most one registrant before any fetching.
  const targets = new Map();
  for (const org of organisations) {
    const hinted = TICKER_HINTS[org.name];
    const row = hinted ? byTicker.get(hinted) : byName.get(normalise(org.name));
    if (!row) continue;
    if ([...targets.values()].some((t) => t.row.cik_str === row.cik_str)) continue;
    targets.set(org.id, { row, org });
  }
  log(`  edgar: ${targets.size} organisations matched to registrants`);

  const results = new Map();
  for (const [orgId, { row }] of targets) {
    const cik = String(row.cik_str).padStart(10, '0');
    let facts;
    try {
      facts = await getJson(`${FACTS_URL}/CIK${cik}.json`);
    } catch (err) {
      log(`  edgar ${row.ticker}: ${err.message}`);
      continue;
    }
    if (!facts) continue;

    const revenue = latestAnnual(facts.facts, [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
    ]);
    const headcount = latestHeadcount(facts.facts);

    if (!revenue && !headcount) continue;
    results.set(orgId, {
      cik,
      ticker: String(row.ticker).toUpperCase(),
      registrant: row.title,
      revenue: revenue
        ? { usd: Math.round(revenue.value), fiscalYear: revenue.fiscalYear, asOf: revenue.end }
        : null,
      employees: headcount
        ? { count: Math.round(headcount.value), asOf: headcount.end }
        : null,
    });
    // Comfortably inside EDGAR's 10 req/s fair-access limit.
    await sleep(200);
  }

  log(`  edgar: ${results.size} organisations with financials`);
  return results;
}
