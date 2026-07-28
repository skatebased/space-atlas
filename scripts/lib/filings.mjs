/**
 * Recent regulatory filings and contract awards — the paper trail.
 *
 * Both sources are US federal works and therefore public domain, so unlike the
 * news feed these can appear in the commercial tier.
 *
 *   SEC submissions API  → what a listed company has filed and when
 *   USAspending awards   → individual contract actions, with the awarding
 *                          agency and what was bought
 */

const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions';
const USASPENDING = 'https://api.usaspending.gov/api/v2';
const UA_USASPENDING = 'space-atlas/1.0 (+https://github.com/skatebased/space-atlas)';
/** SEC requires a contact address; without it every request 403s. */
const UA_SEC = process.env.SEC_USER_AGENT ?? '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Filing types worth surfacing; routine ownership forms are noise. */
const INTERESTING_FORMS = new Set([
  '8-K',
  '10-K',
  '10-Q',
  'S-1',
  'S-1/A',
  'S-3',
  'S-4',
  '20-F',
  '6-K',
  'DEF 14A',
  '425',
  'SC 13D',
]);

/**
 * Recent SEC filings for organisations that already resolved to a CIK.
 * Returns `Map<orgId, filing[]>`.
 */
export async function fetchRecentFilings(organisations, { log = () => {}, perOrg = 6 } = {}) {
  if (!/\S+@\S+\.\S+/.test(UA_SEC)) {
    log('  filings: skipped — SEC_USER_AGENT not set');
    return new Map();
  }

  const targets = organisations.filter((org) => org.financials?.cik);
  const results = new Map();

  for (const org of targets) {
    try {
      const res = await fetch(`${SEC_SUBMISSIONS}/CIK${org.financials.cik}.json`, {
        headers: { 'user-agent': UA_SEC, accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const recent = data.filings?.recent;
      if (!recent?.form) continue;

      const filings = [];
      for (let i = 0; i < recent.form.length && filings.length < perOrg; i += 1) {
        const form = recent.form[i];
        if (!INTERESTING_FORMS.has(form)) continue;
        const accession = String(recent.accessionNumber[i] ?? '').replace(/-/g, '');
        filings.push({
          form,
          filed: recent.filingDate[i] ?? null,
          description: recent.primaryDocDescription?.[i] || null,
          url: accession
            ? `https://www.sec.gov/Archives/edgar/data/${Number(org.financials.cik)}/${accession}/${recent.primaryDocument[i] ?? ''}`
            : null,
        });
      }
      if (filings.length) results.set(org.id, filings);
    } catch (err) {
      log(`  filings ${org.financials.ticker}: ${err.message}`);
    }
    await sleep(150);
  }

  log(`  filings: ${results.size} organisations with recent SEC filings`);
  return results;
}

/** Space-related NAICS and PSC codes, matching the aggregate query. */
const NAICS = ['336414', '336415', '336419', '927110', '517410'];
const PSC = ['1810', '1820', '1830', '1840', '1850', '1860', 'AR11', 'AR12'];

/** Normalises a recipient name the same way the aggregate matcher does. */
function normalise(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(
      /\b(corporation|corp|incorporated|inc|company|co|limited|ltd|llc|lp|llp|plc|gmbh|ag|sa|nv|bv|ab|as|oy|spa|srl|pty|holdings?|group|systems?|technologies|technology|industries|international|usa|us|na)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Individual recent contract actions, newest first.
 * Returns `Map<orgId, award[]>` keyed by normalised recipient name.
 */
export async function fetchRecentAwards(
  organisations,
  { log = () => {}, months = 24, perOrg = 6 } = {},
) {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months);

  const byName = new Map();
  for (const org of organisations) {
    const key = normalise(org.name);
    if (key && !byName.has(key)) byName.set(key, org);
  }

  const results = new Map();

  for (const [label, codes] of [
    ['naics', { naics_codes: NAICS }],
    ['psc', { psc_codes: PSC }],
  ]) {
    for (let page = 1; page <= 3; page += 1) {
      let data;
      try {
        const res = await fetch(`${USASPENDING}/search/spending_by_award`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': UA_USASPENDING,
          },
          body: JSON.stringify({
            filters: {
              time_period: [
                {
                  start_date: start.toISOString().slice(0, 10),
                  end_date: end.toISOString().slice(0, 10),
                },
              ],
              award_type_codes: ['A', 'B', 'C', 'D'],
              ...codes,
            },
            fields: [
              'Award ID',
              'Recipient Name',
              'Award Amount',
              'Description',
              'Awarding Agency',
              'Start Date',
            ],
            sort: 'Award Amount',
            order: 'desc',
            limit: 100,
            page,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
        if (data.detail) throw new Error(String(data.detail).slice(0, 100));
      } catch (err) {
        log(`  awards ${label} p${page}: FAILED (${err.message})`);
        break;
      }

      const rows = data.results ?? [];
      for (const row of rows) {
        const org = byName.get(normalise(row['Recipient Name']));
        if (!org) continue;
        const list = results.get(org.id) ?? [];
        if (list.length >= perOrg) continue;
        list.push({
          amount: Math.round(Number(row['Award Amount']) || 0),
          agency: row['Awarding Agency'] ?? null,
          description: row.Description
            ? String(row.Description).slice(0, 180)
            : null,
          started: row['Start Date'] ?? null,
        });
        results.set(org.id, list);
      }

      log(`  awards ${label} p${page}: ${rows.length} rows`);
      if (rows.length < 100) break;
      await sleep(700);
    }
  }

  log(`  awards: ${results.size} organisations with recent contract actions`);
  return results;
}
