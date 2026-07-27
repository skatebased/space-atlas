/**
 * Source registry and licence tiering.
 *
 * Every value in the dataset records which source it came from, and every
 * source declares its licence. That lets the build emit two artifacts from one
 * pipeline: the full dataset for the public site, and a redistributable subset
 * containing only fields whose licence permits commercial reuse without
 * share-alike.
 *
 * Nothing here is legal advice — it encodes the published terms of each source
 * so the constraint is visible in the data instead of living in someone's head.
 */

/**
 * `redistributable: true` means the licence permits commercial use and
 * redistribution without imposing share-alike on downstream users.
 */
export const SOURCES = {
  wikidata: {
    name: 'Wikidata',
    url: 'https://www.wikidata.org',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attributionRequired: false,
    redistributable: true,
    note: 'Public domain dedication. No restrictions on commercial reuse.',
  },
  usaspending: {
    name: 'USAspending.gov',
    url: 'https://www.usaspending.gov',
    license: 'US-PD',
    licenseUrl: 'https://www.usaspending.gov/about',
    attributionRequired: false,
    redistributable: true,
    note: 'US federal government work; not subject to domestic copyright.',
  },
  sec: {
    name: 'SEC EDGAR',
    url: 'https://www.sec.gov/edgar',
    license: 'US-PD',
    licenseUrl: 'https://www.sec.gov/privacy#dissemination',
    attributionRequired: false,
    redistributable: true,
    note: 'US federal government work. Fair-access rules require a declared User-Agent.',
  },
  naturalearth: {
    name: 'Natural Earth',
    url: 'https://www.naturalearthdata.com/',
    license: 'PD',
    licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
    attributionRequired: false,
    redistributable: true,
    note: 'Explicit public domain release.',
  },
  iso: {
    name: 'ISO 3166-1 country codes',
    url: 'https://www.iso.org/iso-3166-country-codes.html',
    license: 'PD-facts',
    attributionRequired: false,
    redistributable: true,
    note: 'Country code assignments are facts, not creative expression.',
  },

  /* ---- Restricted: excluded from the redistributable artifact ---- */

  wikipedia: {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attributionRequired: true,
    redistributable: false,
    note:
      'Share-alike: derivative works must carry the same licence, so downstream ' +
      'users may redistribute freely. Prose (article extracts) is the ' +
      'copyrightable part; bare facts are not protected in the US.',
  },
  launchlibrary: {
    name: 'Launch Library 2 (The Space Devs)',
    url: 'https://thespacedevs.com/llapi',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionRequired: true,
    redistributable: false,
    note:
      'Attribution required, and free access is capped at 15 requests/hour. ' +
      'Bulk redistribution needs a commercial arrangement with The Space Devs.',
  },
};

/** Sources whose fields may appear in the redistributable artifact. */
export const REDISTRIBUTABLE_SOURCES = Object.entries(SOURCES)
  .filter(([, meta]) => meta.redistributable)
  .map(([key]) => key);

/**
 * Accumulates `{ value, source }` pairs into a record plus a provenance map.
 *
 * First write wins, so callers should apply their most-trusted source first.
 * Recording the source per field is what makes the licence split mechanical
 * rather than a judgement call at export time.
 */
export function createRecord() {
  const values = {};
  const provenance = {};

  return {
    /** Sets `field` if it has no value yet and `value` is meaningful. */
    set(field, value, source) {
      if (value === undefined || value === null || value === '') return;
      if (values[field] !== undefined) return;
      if (!SOURCES[source]) throw new Error(`unknown source "${source}"`);
      values[field] = value;
      provenance[field] = source;
    },
    /** Overwrites regardless of what is already there. */
    force(field, value, source) {
      if (!SOURCES[source]) throw new Error(`unknown source "${source}"`);
      values[field] = value;
      provenance[field] = source;
    },
    has: (field) => values[field] !== undefined,
    get: (field) => values[field],
    build: () => ({ ...values, provenance: { ...provenance } }),
  };
}

/**
 * Strips every field whose source is not redistributable.
 * `provenance` is rewritten to match, so the output stays self-describing.
 */
export function toRedistributable(record) {
  const clean = {};
  const provenance = {};

  for (const [field, value] of Object.entries(record)) {
    if (field === 'provenance') continue;
    const source = record.provenance?.[field];
    // Fields with no recorded source are derived in this repo, so they carry
    // the licence of whatever they were derived from — keep only if all the
    // inputs were clean, which `deriveSource` guarantees for callers.
    if (!source) continue;
    if (!SOURCES[source]?.redistributable) continue;
    clean[field] = value;
    provenance[field] = source;
  }

  return Object.keys(clean).length ? { ...clean, provenance } : null;
}

/** Licence manifest embedded in every emitted dataset. */
export function licenseManifest(usedSources) {
  const used = usedSources ?? Object.keys(SOURCES);
  return Object.fromEntries(
    used.filter((key) => SOURCES[key]).map((key) => [key, SOURCES[key]]),
  );
}

/**
 * Picks the most restrictive licence among the sources a derived field used.
 * Derived values (tier, slug, flag) inherit the constraints of their inputs.
 */
export function deriveSource(sources) {
  const restricted = sources.find((s) => SOURCES[s] && !SOURCES[s].redistributable);
  return restricted ?? sources.find((s) => SOURCES[s]) ?? 'wikidata';
}
