/**
 * Discovers space organisations from Wikidata (CC0).
 *
 * This is the commercially-clean backbone of the dataset. Class-based queries
 * alone are too noisy — "aerospace manufacturer" returns Heinkel, Halberstadt
 * and Antonov, which are aviation — so the main discovery query works
 * backwards from hardware instead: whoever is recorded as the manufacturer
 * (P176) of an actual launch vehicle, spacecraft or satellite. Every result is
 * therefore an organisation that demonstrably built flight hardware.
 *
 * Discovery and enrichment are deliberately separate. Putting the OPTIONAL
 * clauses for website/HQ/staff inside the discovery query makes it heavy
 * enough that the public endpoint returns 502, so the SPARQL step fetches
 * bare Q-ids only and the details come from the entity API in batches.
 */
import { getJson } from './wikiapi.mjs';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const DATA_API = 'https://www.wikidata.org/w/api.php';
const UA = 'space-atlas/1.0 (https://github.com/skatebased/space-atlas; dataset build)';

/**
 * Discovery anchors on P619 — "UTC date of spacecraft launch" — rather than on
 * the class hierarchy.
 *
 * Class closures were the obvious approach and are wrong here: Wikidata's
 * subclass graph links "artificial satellite" into the aircraft-fleet branch
 * (~1,500 items), so `wdt:P31/wdt:P279* wd:Q1875621` drags in fighter
 * squadrons as "satellite operators". Excluding that branch with
 * FILTER NOT EXISTS is too slow for the public endpoint, and the deep rocket
 * closures time out outright.
 *
 * Anything carrying a spacecraft launch date is a spacecraft by definition, so
 * this is both faster and impossible to pollute. Launch-vehicle makers that
 * never flew a P619-dated craft are picked up by the Wikipedia layer instead.
 */
const QUERIES = {
  /**
   * Manufacturers of hardware that has actually been launched, with a count.
   * The count matters: Tesla legitimately manufactured one launched object
   * (the Falcon Heavy Roadster), which is true but should not rank it beside
   * Boeing. Surfacing the number lets that sort itself out instead of
   * hand-deleting entries.
   */
  manufacturer: `
    SELECT ?org (COUNT(DISTINCT ?craft) AS ?count) WHERE {
      ?craft wdt:P619 ?launched .
      ?craft wdt:P176 ?org .
    } GROUP BY ?org`,

  /** Operators of hardware that has actually been launched, with a count. */
  operator: `
    SELECT ?org (COUNT(DISTINCT ?craft) AS ?count) WHERE {
      ?craft wdt:P619 ?launched .
      ?craft wdt:P137 ?org .
    } GROUP BY ?org`,

  /** Government space agencies. */
  agency: `
    SELECT DISTINCT ?org WHERE {
      ?org wdt:P31/wdt:P279* wd:Q17505024 .
    }`,

  /** Operators of spaceports — launch service and range providers. */
  spaceport: `
    SELECT DISTINCT ?org WHERE {
      ?port wdt:P31/wdt:P279* wd:Q194188 .
      ?port wdt:P137 ?org .
    }`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs one bare SPARQL query, retrying on the endpoint's frequent timeouts. */
async function runQuery(query, { attempts = 4 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(SPARQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'user-agent': UA,
          accept: 'application/sparql-results+json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // The endpoint returns plain-text timeouts rather than JSON.
      if (!text.trimStart().startsWith('{')) throw new Error(text.slice(0, 80).trim());
      return JSON.parse(text).results.bindings.map((b) => ({
        qid: b.org.value.split('/').pop(),
        count: Number(b.count?.value) || 0,
      }));
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await sleep(4000 * attempt);
    }
  }
  throw new Error(`SPARQL failed: ${lastError?.message}`);
}

/** Reads the preferred value out of a claim list. */
function claim(claims, prop) {
  const list = claims?.[prop];
  if (!Array.isArray(list) || !list.length) return null;
  const preferred =
    list.find((c) => c.rank === 'preferred') ??
    list.find((c) => c.rank !== 'deprecated') ??
    list[0];
  return preferred?.mainsnak?.datavalue ?? null;
}

const entityId = (claims, prop) => {
  const value = claim(claims, prop);
  return value?.type === 'wikibase-entityid' ? value.value.id : null;
};

/** `+2003-01-24T00:00:00Z` → `2003-01-24`. */
function normaliseTime(time) {
  const match = String(time ?? '').match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1800 || year > 2200) return null;
  return `${match[1]}-${match[2] === '00' ? '01' : match[2]}-${
    match[3] === '00' ? '01' : match[3]
  }`;
}

function commonsThumb(fileName, width = 320) {
  if (!fileName) return null;
  const name = String(fileName).replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

/** Fetches labels + claims for a batch of Q-ids. */
async function fetchEntityBatch(qids) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    ids: qids.join('|'),
    props: 'labels|claims|sitelinks',
    languages: 'en',
    sitefilter: 'enwiki',
  });
  const data = await getJson(`${DATA_API}?${params}`);
  return data?.entities ?? {};
}

/** Fetches English labels only, for referenced entities (country, HQ). */
async function fetchLabels(qids) {
  const labels = new Map();
  for (const batch of chunk([...new Set(qids.filter(Boolean))], 50)) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: batch.join('|'),
      props: 'labels',
      languages: 'en',
    });
    const data = await getJson(`${DATA_API}?${params}`);
    for (const [qid, entity] of Object.entries(data?.entities ?? {})) {
      const label = entity?.labels?.en?.value;
      if (label) labels.set(qid, label);
    }
  }
  return labels;
}

/**
 * Runs discovery then enrichment, returning
 * `Map<qid, { qid, name, country, inception, website, headquarters, ... }>`.
 */
export async function fetchWikidataOrgs({ log = () => {} } = {}) {
  /* ---- 1. Discovery: bare Q-ids per role ---- */
  const roles = new Map();
  const craftCounts = new Map();
  for (const [role, query] of Object.entries(QUERIES)) {
    let rows;
    try {
      rows = await runQuery(query);
    } catch (err) {
      // A single failing query must not sink the whole build.
      log(`  wikidata ${role}: FAILED (${err.message})`);
      continue;
    }
    for (const { qid, count } of rows) {
      if (!roles.has(qid)) roles.set(qid, new Set());
      roles.get(qid).add(role);
      if (count) {
        craftCounts.set(qid, Math.max(craftCounts.get(qid) ?? 0, count));
      }
    }
    log(`  wikidata ${role}: ${rows.length} orgs`);
    await sleep(1500);
  }

  if (!roles.size) throw new Error('wikidata discovery returned nothing');

  /* ---- 2. Enrichment: labels and claims in batches of 50 ---- */
  const qids = [...roles.keys()];
  const raw = new Map();
  for (const batch of chunk(qids, 50)) {
    const entities = await fetchEntityBatch(batch);
    for (const [qid, entity] of Object.entries(entities)) {
      if (entity.missing !== undefined) continue;
      raw.set(qid, entity);
    }
  }
  log(`  wikidata enrichment: ${raw.size}/${qids.length} entities`);

  /* ---- 3. Resolve referenced entities (country, headquarters) ---- */
  const referenced = [];
  for (const entity of raw.values()) {
    referenced.push(entityId(entity.claims, 'P17'), entityId(entity.claims, 'P159'));
  }
  const labels = await fetchLabels(referenced);

  /* ---- 4. Assemble ---- */
  const orgs = new Map();
  for (const [qid, entity] of raw) {
    const name = entity.labels?.en?.value;
    // No English label means nothing usable to display or match on.
    if (!name) continue;

    const claims = entity.claims ?? {};
    const website = claim(claims, 'P856');
    const employees = claim(claims, 'P1128');
    const inception = claim(claims, 'P571');
    const logo = claim(claims, 'P154') ?? claim(claims, 'P18');

    orgs.set(qid, {
      qid,
      name,
      country: labels.get(entityId(claims, 'P17')) ?? null,
      headquarters: labels.get(entityId(claims, 'P159')) ?? null,
      inception: inception?.value?.time ? normaliseTime(inception.value.time) : null,
      website: typeof website?.value === 'string' ? website.value : null,
      employees: Number.isFinite(Number(employees?.value?.amount))
        ? Math.round(Number(employees.value.amount))
        : null,
      logo: logo?.value ? commonsThumb(logo.value) : null,
      wikipediaTitle: entity.sitelinks?.enwiki?.title ?? null,
      spacecraftCount: craftCounts.get(qid) ?? 0,
      roles: [...(roles.get(qid) ?? [])],
    });
  }

  return { orgs };
}
