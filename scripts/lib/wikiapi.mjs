/**
 * Thin clients for the MediaWiki and Wikidata APIs.
 *
 * The agency tables give capabilities but not much else, so articles are
 * enriched with an intro extract and a thumbnail from MediaWiki, and with
 * structured fields (website, headquarters, staff, inception) from Wikidata.
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const DATA_API = 'https://www.wikidata.org/w/api.php';
const UA = 'space-agency-atlas/1.0 (https://github.com/; dataset build)';

/** Courtesy pause between requests, so a full run stays under rate limits. */
const REQUEST_SPACING_MS = 300;
let nextRequestAt = 0;

/**
 * Fetches JSON, serialised and paced.
 * Retries 429/5xx with exponential backoff, honouring `Retry-After`.
 */
export async function getJson(url, { attempts = 6 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const wait = nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextRequestAt = Date.now() + REQUEST_SPACING_MS;

    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000 * 2 ** attempt;
        nextRequestAt = Date.now() + backoff;
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
    }
  }
  throw new Error(`request failed: ${url} — ${lastError?.message}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Fetches the raw wikitext of an article. */
export async function fetchWikitext(page) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
  const data = await getJson(url);
  if (!data?.parse?.wikitext) throw new Error(`no wikitext for ${page}`);
  return data.parse.wikitext;
}

/**
 * For a list of article titles, returns a map of
 * title → { title, qid, extract, thumbnail, url }.
 * Redirects and title normalisation are followed, and the result is keyed by
 * the title that was asked for.
 */
export async function fetchArticles(titles) {
  const result = new Map();
  const unique = [...new Set(titles.filter(Boolean))];

  for (const batch of chunk(unique, 20)) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      redirects: '1',
      prop: 'extracts|pageimages|pageprops|info',
      exintro: '1',
      explaintext: '1',
      exlimit: '20',
      piprop: 'thumbnail',
      pithumbsize: '320',
      pilimit: '20',
      ppprop: 'wikibase_item',
      inprop: 'url',
      titles: batch.join('|'),
    });
    const data = await getJson(`${WIKI_API}?${params}`);
    const query = data?.query ?? {};

    // Map requested title → final title through normalisation and redirects.
    const alias = new Map();
    for (const n of query.normalized ?? []) alias.set(n.from, n.to);
    for (const r of query.redirects ?? []) {
      for (const [from, to] of alias) if (to === r.from) alias.set(from, r.to);
      alias.set(r.from, r.to);
    }

    const byFinalTitle = new Map();
    for (const page of query.pages ?? []) {
      if (page.missing) continue;
      byFinalTitle.set(page.title, {
        title: page.title,
        qid: page.pageprops?.wikibase_item ?? null,
        extract: page.extract ? tidyExtract(page.extract) : null,
        thumbnail: page.thumbnail?.source ?? null,
        url:
          page.fullurl ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      });
    }

    for (const requested of batch) {
      const final = alias.get(requested) ?? requested;
      const page = byFinalTitle.get(final);
      if (page) result.set(requested, page);
    }
  }
  return result;
}

/** Trims an intro extract to the first couple of sentences. */
function tidyExtract(text) {
  const clean = text
    .replace(/\s+/g, ' ')
    // Stripping pronunciation markup leaves gaps like "(ISRO ; founded…".
    .replace(/\(\s+/g, '(')
    .replace(/\s+([),;:.])/g, '$1')
    .replace(/\(\s*[,;]\s*/g, '(')
    .replace(/\(\)/g, '')
    .trim();
  if (clean.length <= 320) return clean;
  const cut = clean.slice(0, 320);
  const stop = cut.lastIndexOf('. ');
  return `${stop > 120 ? cut.slice(0, stop) : cut.trimEnd()}…`;
}

/** Claim property IDs pulled from each organisation's Wikidata item. */
const PROPS = {
  inception: 'P571',
  headquarters: 'P159',
  website: 'P856',
  employees: 'P1128',
  country: 'P17',
  countryOfOrigin: 'P495',
  location: 'P276',
  logo: 'P154',
  image: 'P18',
  parent: 'P749',
  coordinates: 'P625',
};

/** Properties whose values are entities needing a second lookup. */
const ENTITY_PROPS = [
  PROPS.headquarters,
  PROPS.country,
  PROPS.countryOfOrigin,
  PROPS.location,
  PROPS.parent,
];

/** Reads the preferred value out of a Wikidata claim list. */
function claimValue(claims, prop) {
  const list = claims?.[prop];
  if (!Array.isArray(list) || !list.length) return null;
  const preferred =
    list.find((c) => c.rank === 'preferred') ??
    list.find((c) => c.rank !== 'deprecated') ??
    list[0];
  return preferred?.mainsnak?.datavalue ?? null;
}

/**
 * Fetches structured fields for the given Q-ids.
 * Entity-valued fields (headquarters, country) are resolved to English labels
 * in a second pass.
 */
export async function fetchEntities(qids) {
  const unique = [...new Set(qids.filter(Boolean))];
  const raw = new Map();

  for (const batch of chunk(unique, 40)) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: batch.join('|'),
      props: 'claims',
      languages: 'en',
    });
    const data = await getJson(`${DATA_API}?${params}`);
    for (const [qid, entity] of Object.entries(data?.entities ?? {})) {
      if (entity.missing !== undefined) continue;
      raw.set(qid, entity.claims ?? {});
    }
  }

  // Collect referenced entities so their labels can be resolved in one go.
  const referenced = new Set();
  for (const claims of raw.values()) {
    for (const prop of ENTITY_PROPS) {
      const value = claimValue(claims, prop);
      if (value?.type === 'wikibase-entityid' && value.value?.id) {
        referenced.add(value.value.id);
      }
    }
  }

  // Many company items have no country (P17) but do name a headquarters city.
  // Fetch the referenced entities' own claims so that city's country can be
  // used as a fallback, then resolve every label in one final pass.
  const referencedClaims = await fetchClaims([...referenced]);
  const secondHop = new Set();
  for (const claims of referencedClaims.values()) {
    const value = claimValue(claims, PROPS.country);
    if (value?.type === 'wikibase-entityid' && value.value?.id) {
      secondHop.add(value.value.id);
    }
  }
  const labels = await fetchLabels([...referenced, ...secondHop]);

  /** The country an entity-valued property resolves to, one hop out. */
  const countryOfEntity = (id) => {
    const value = claimValue(referencedClaims.get(id), PROPS.country);
    return value?.type === 'wikibase-entityid'
      ? (labels.get(value.value.id) ?? null)
      : null;
  };

  const out = new Map();
  for (const [qid, claims] of raw) {
    const entityId = (prop) => {
      const value = claimValue(claims, prop);
      return value?.type === 'wikibase-entityid' ? value.value.id : null;
    };
    const entityLabel = (prop) => {
      const id = entityId(prop);
      return id ? (labels.get(id) ?? null) : null;
    };
    /** Country, preferring the explicit claim over the headquarters' country. */
    const resolveCountry = () =>
      entityLabel(PROPS.country) ??
      entityLabel(PROPS.countryOfOrigin) ??
      (entityId(PROPS.headquarters) &&
        countryOfEntity(entityId(PROPS.headquarters))) ??
      (entityId(PROPS.location) && countryOfEntity(entityId(PROPS.location))) ??
      null;

    const inception = claimValue(claims, PROPS.inception);
    const employees = claimValue(claims, PROPS.employees);
    const website = claimValue(claims, PROPS.website);
    const coords = claimValue(claims, PROPS.coordinates);
    const logo = claimValue(claims, PROPS.logo) ?? claimValue(claims, PROPS.image);

    out.set(qid, {
      inception: inception?.value?.time
        ? normaliseWikidataTime(inception.value.time)
        : null,
      headquarters: entityLabel(PROPS.headquarters),
      country: resolveCountry(),
      parent: entityLabel(PROPS.parent),
      website: typeof website?.value === 'string' ? website.value : null,
      employees: Number.isFinite(Number(employees?.value?.amount))
        ? Math.round(Number(employees.value.amount))
        : null,
      logo: logo?.value ? commonsThumb(logo.value) : null,
      coordinates:
        coords?.value && Number.isFinite(coords.value.latitude)
          ? [
              Math.round(coords.value.latitude * 1e4) / 1e4,
              Math.round(coords.value.longitude * 1e4) / 1e4,
            ]
          : null,
    });
  }
  return out;
}

/** Fetches raw claims for a set of Q-ids (used for second-hop lookups). */
async function fetchClaims(qids) {
  const out = new Map();
  for (const batch of chunk(qids, 40)) {
    const params = new URLSearchParams({
      action: 'wbgetentities',
      format: 'json',
      ids: batch.join('|'),
      props: 'claims',
      languages: 'en',
    });
    const data = await getJson(`${DATA_API}?${params}`);
    for (const [qid, entity] of Object.entries(data?.entities ?? {})) {
      if (entity.missing !== undefined) continue;
      out.set(qid, entity.claims ?? {});
    }
  }
  return out;
}

/** Fetches English labels for a set of Q-ids. */
async function fetchLabels(qids) {
  const labels = new Map();
  for (const batch of chunk(qids, 50)) {
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

/** `+2003-01-24T00:00:00Z` → `2003-01-24`. */
function normaliseWikidataTime(time) {
  const match = String(time).match(/^\+(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  if (!year || year < 1800 || year > 2200) return null;
  return `${y}-${m === '00' ? '01' : m}-${d === '00' ? '01' : d}`;
}

/** Builds a Commons image URL for a file name, scaled to `width`. */
function commonsThumb(fileName, width = 320) {
  const name = String(fileName).replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}
