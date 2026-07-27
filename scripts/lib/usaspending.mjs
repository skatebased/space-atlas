/**
 * US federal contract awards, from USAspending.gov (public domain).
 *
 * This is the dataset's differentiator: directories list who exists, this
 * shows who actually wins government money. The query is deliberately broad
 * (space NAICS plus space Product Service Codes); precision comes from the
 * join — a recipient is only kept if it matches an organisation already in
 * the dataset, so guided-missile primes that never touch space drop out.
 */

const API = 'https://api.usaspending.gov/api/v2';
const UA = 'space-atlas/1.0 (https://github.com/skatebased/space-atlas)';

/** Space-related North American Industry Classification System codes. */
const NAICS = [
  '336414', // guided missile and space vehicle manufacturing
  '336415', // space vehicle propulsion units and parts
  '336419', // other space vehicle parts and auxiliary equipment
  '927110', // space research and technology
  '517410', // satellite telecommunications
];

/** Product Service Codes specific to space hardware and space R&D. */
const PSC = [
  '1810', // space vehicles
  '1820', // space vehicle components
  '1830', // space vehicle remote control systems
  '1840', // space vehicle launchers
  '1850', // space vehicle handling and servicing equipment
  '1860', // space survival equipment
  'AR11', // R&D space – basic research
  'AR12',
  'AR21',
  'AR22',
];

/** Contract award type codes (excludes grants and loans). */
const AWARD_TYPES = ['A', 'B', 'C', 'D'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body, { attempts = 4 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.detail) throw new Error(String(data.detail).slice(0, 120));
      return data;
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await sleep(1500 * attempt);
    }
  }
  throw new Error(`usaspending ${path}: ${lastError?.message}`);
}

/** Corporate suffixes stripped before matching recipient names to orgs. */
const SUFFIXES =
  /\b(corporation|corp|incorporated|inc|company|co|limited|ltd|llc|lp|llp|plc|gmbh|ag|sa|nv|bv|ab|as|oy|spa|srl|pty|holdings?|group|systems?|technologies|technology|industries|international|usa|us|na)\b/g;

/** Normalises a company name for comparison. */
export function normaliseName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recipients whose legal name does not resemble the organisation's common
 * name. Without these the biggest players silently fail to join.
 */
const RECIPIENT_ALIASES = {
  'space exploration': 'SpaceX',
  'blue origin': 'Blue Origin',
  'rocket lab': 'Rocket Lab',
  'united launch alliance': 'United Launch Alliance',
  'sierra nevada': 'Sierra Nevada Corporation',
  'orbital sciences': 'Orbital Sciences Corporation',
  'ball aerospace': 'Ball Aerospace & Technologies',
  'aerojet rocketdyne': 'Aerojet Rocketdyne',
  'l3harris': 'L3Harris Technologies',
  'jet propulsion laboratory': 'Jet Propulsion Laboratory',
  'california institute of': 'Jet Propulsion Laboratory',
  'firefly': 'Firefly Aerospace',
  'astrobotic': 'Astrobotic Technology',
  'intuitive machines': 'Intuitive Machines',
  'maxar': 'Maxar Technologies',
  'planet labs': 'Planet Labs',
  'axiom space': 'Axiom Space',
  'relativity space': 'Relativity Space',
};

/**
 * Fetches the top space-contract recipients over the given window.
 * Returns `[{ name, normalised, amount }]`, aggregated across the duplicate
 * entity records USAspending returns for one company.
 */
export async function fetchSpaceContractors({
  startDate = '2015-10-01',
  endDate = new Date().toISOString().slice(0, 10),
  pages = 4,
  log = () => {},
} = {}) {
  const totals = new Map();

  // NAICS and PSC are separate filters; run both and merge.
  const filterSets = [
    { label: 'naics', filters: { naics_codes: NAICS } },
    { label: 'psc', filters: { psc_codes: PSC } },
  ];

  for (const { label, filters } of filterSets) {
    for (let page = 1; page <= pages; page += 1) {
      let data;
      try {
        data = await post('/search/spending_by_category', {
          filters: {
            time_period: [{ start_date: startDate, end_date: endDate }],
            award_type_codes: AWARD_TYPES,
            ...filters,
          },
          category: 'recipient',
          limit: 100,
          page,
        });
      } catch (err) {
        log(`  usaspending ${label} p${page}: FAILED (${err.message})`);
        break;
      }

      const results = data.results ?? [];
      for (const row of results) {
        const amount = Number(row.amount);
        if (!row.name || !Number.isFinite(amount) || amount <= 0) continue;
        const key = normaliseName(row.name);
        if (!key) continue;
        const held = totals.get(key);
        // Several entity records map to one company; sum them and keep the
        // longest legal name as the display form.
        if (held) {
          held.amount += amount;
          if (row.name.length > held.name.length) held.name = row.name;
        } else {
          totals.set(key, { name: row.name, normalised: key, amount });
        }
      }

      log(`  usaspending ${label} p${page}: ${results.length} rows`);
      if (results.length < 100) break;
      await sleep(700);
    }
  }

  const contractors = [...totals.values()].sort((a, b) => b.amount - a.amount);
  return { contractors, window: { startDate, endDate } };
}

/**
 * Joins contractors to organisations by normalised name, with an alias table
 * for the cases where the legal name and the common name diverge.
 * Returns `Map<orgId, { usdTotal, recipientName }>`.
 */
export function matchContractors(contractors, organisations) {
  const byNormalised = new Map();
  for (const org of organisations) {
    const key = normaliseName(org.name);
    if (key && !byNormalised.has(key)) byNormalised.set(key, org);
  }

  // Alias targets resolve to whichever organisation carries that name.
  const aliasTargets = new Map();
  for (const [fragment, orgName] of Object.entries(RECIPIENT_ALIASES)) {
    const org = organisations.find((o) => o.name === orgName);
    if (org) aliasTargets.set(fragment, org);
  }

  const matches = new Map();
  for (const contractor of contractors) {
    let org = byNormalised.get(contractor.normalised);

    if (!org) {
      for (const [fragment, target] of aliasTargets) {
        if (contractor.normalised.startsWith(fragment)) {
          org = target;
          break;
        }
      }
    }
    if (!org) continue;

    const held = matches.get(org.id);
    if (held) {
      held.usdTotal += contractor.amount;
    } else {
      matches.set(org.id, {
        usdTotal: contractor.amount,
        recipientName: contractor.name,
      });
    }
  }

  for (const entry of matches.values()) {
    entry.usdTotal = Math.round(entry.usdTotal);
  }
  return matches;
}
