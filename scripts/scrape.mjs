#!/usr/bin/env node
/**
 * Builds data/agencies.json — the dataset behind the site.
 *
 * Roster and demonstrated capabilities come from the tables on Wikipedia's
 * "List of government space agencies"; each agency is then enriched with an
 * intro extract and thumbnail from MediaWiki and with structured fields
 * (website, headquarters, staff, inception) from Wikidata.
 *
 * The previous data/agencies.json is left untouched if the scrape produces
 * obviously broken output, so a bad upstream edit cannot empty the site.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseTable,
  tablesInSection,
  plainText,
  firstLink,
  firstSegment,
  checkMark,
  checkDetail,
  templateDate,
  findTemplates,
  stripRefs,
} from './lib/wikitext.mjs';
import { createResolver, flagEmoji } from './lib/countries.mjs';
import { fetchWikitext, fetchArticles, fetchEntities } from './lib/wikiapi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PAGE = 'List of government space agencies';
const SOURCE_URL = `https://en.wikipedia.org/wiki/${SOURCE_PAGE.replace(/ /g, '_')}`;
/** Refuse to overwrite a good dataset with a suspiciously small one. */
const MIN_EXPECTED_AGENCIES = 50;

/** Agencies whose country cell has no flag template (multi-nation bodies). */
const COUNTRY_OVERRIDES = {
  'European Space Agency': 'EUE',
  'African Space Agency': 'AUU',
  'Arab Space Cooperation Group': 'ARL',
  'Asia-Pacific Space Cooperation Organization': 'APS',
  'Soviet space program': 'SUN',
  'Latin American and Caribbean Space Agency': 'LAC',
  'United Nations Committee on the Peaceful Uses of Outer Space': 'UNO',
  'United Nations Office for Outer Space Affairs': 'UNO',
  'Consultative Committee for Space Data Systems': 'INT',
  'International Astronautical Federation': 'INT',
};

/* ------------------------------------------------------------------ */
/* Table readers                                                       */
/* ------------------------------------------------------------------ */

/** Pulls the country token out of a cell's `{{flag}}` / `{{flagicon}}` / `{{XXX}}`. */
function countryToken(cell) {
  const templates = findTemplates(stripRefs(cell));
  for (const t of templates) {
    const name = t.name.toLowerCase();
    if ((name === 'flag' || name === 'flagicon' || name === 'flagcountry') && t.args[0]) {
      return t.args[0].trim();
    }
  }
  // Bare country templates like {{ALG}} — a 2–3 letter all-caps name.
  const bare = templates.find((t) => /^[A-Za-z]{2,3}$/.test(t.name));
  return bare ? bare.name.trim() : null;
}

/** A capability cell becomes `{ has, detail }`. */
function capability(cell) {
  return { has: checkMark(cell) === true, detail: checkDetail(cell) };
}

/** Reads the overview table: country, name, acronym, founding, basic capabilities. */
function readOverview(tables) {
  const rows = [];
  for (const table of tables) {
    for (const cells of parseTable(table)) {
      if (cells.length < 5) continue;
      const link = firstLink(cells[1]);
      if (!link) continue;
      rows.push({
        title: link.title,
        name: firstSegment(cells[1]) || null,
        acronym: firstSegment(cells[2]) || null,
        countryToken: countryToken(cells[0]),
        founded: templateDate(cells[3]),
        capabilities: {
          firstSpaceTraveler: capability(cells[4] ?? ''),
          operatesSatellites: capability(cells[5] ?? ''),
          buildsSatellites: capability(cells[6] ?? ''),
          recoverablePayloads: capability(cells[7] ?? ''),
        },
      });
    }
  }
  return rows;
}

/**
 * Reads a capability table into `title → { countryToken, capabilities }`.
 * `keys` names the capability for each column after the agency column.
 */
function readCapabilityTable(tables, keys) {
  const out = new Map();
  for (const table of tables) {
    for (const cells of parseTable(table)) {
      if (cells.length < 2) continue;
      const link = firstLink(cells[0]);
      if (!link) continue;
      const capabilities = {};
      keys.forEach((key, index) => {
        capabilities[key] = capability(cells[index + 1] ?? '');
      });
      out.set(link.title, {
        countryToken: countryToken(cells[0]),
        historical: /†/.test(cells[0]),
        capabilities,
      });
    }
  }
  return out;
}

/** Reads the budget table into `title → { usdMillions, year }`. */
function readBudgets(tables) {
  const out = new Map();
  for (const table of tables) {
    for (const cells of parseTable(table)) {
      if (cells.length < 3) continue;
      const link = firstLink(cells[0]);
      if (!link) continue;
      const amount = Number(plainText(cells[1]).replace(/[^\d.]/g, ''));
      const year = Number(plainText(cells[2]).match(/\b(19|20)\d{2}\b/)?.[0]);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.set(link.title, {
        usdMillions: amount,
        year: Number.isFinite(year) ? year : null,
        countryToken: countryToken(cells[0]),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Derived fields                                                      */
/* ------------------------------------------------------------------ */

const TIERS = [
  { id: 'human-spaceflight', label: 'Human spaceflight', rank: 5 },
  { id: 'deep-space', label: 'Deep space exploration', rank: 4 },
  { id: 'orbital-launch', label: 'Orbital launch', rank: 3 },
  { id: 'satellite-operator', label: 'Satellite operator', rank: 2 },
  { id: 'emerging', label: 'Emerging agency', rank: 1 },
];

function classify(caps) {
  const has = (key) => caps[key]?.has === true;
  if (has('crewedLaunch') || has('spaceStation') || has('moonLanding')) {
    return TIERS[0];
  }
  if (
    ['flyby', 'extraterrestrialOrbiter', 'surfaceImpact', 'softLanding', 'rover', 'sampleReturn'].some(
      has,
    )
  ) {
    return TIERS[1];
  }
  if (has('orbitalLaunch')) return TIERS[2];
  if (has('operatesSatellites') || has('buildsSatellites')) return TIERS[3];
  return TIERS[4];
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const countries = JSON.parse(
    await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'),
  );
  const { resolve } = createResolver(countries);

  console.log(`fetching ${SOURCE_PAGE}…`);
  const wikitext = await fetchWikitext(SOURCE_PAGE);

  const overview = readOverview(tablesInSection(wikitext, 'Overview'));
  const launch = readCapabilityTable(tablesInSection(wikitext, 'Launch capability'), [
    'launchSite',
    'suborbitalLaunch',
    'orbitalLaunch',
    'cryogenicEngine',
    'reusableSystems',
  ]);
  const [deepSpaceTable, withoutLaunchTable] = tablesInSection(
    wikitext,
    'Extraterrestrial exploration capability',
  );
  const deepSpace = readCapabilityTable(deepSpaceTable ? [deepSpaceTable] : [], [
    'flyby',
    'extraterrestrialOrbiter',
    'surfaceImpact',
    'softLanding',
    'rover',
    'sampleReturn',
  ]);
  // The "without launch capabilities" table omits the flyby column.
  const deepSpaceNoLaunch = readCapabilityTable(
    withoutLaunchTable ? [withoutLaunchTable] : [],
    [
      'extraterrestrialOrbiter',
      'surfaceImpact',
      'softLanding',
      'rover',
      'sampleReturn',
    ],
  );
  const human = readCapabilityTable(
    tablesInSection(wikitext, 'Human spaceflight capability'),
    [
      'crewedLaunch',
      'eva',
      'rendezvousDocking',
      'spaceStation',
      'circumlunarFlight',
      'moonLanding',
    ],
  );
  const budgets = readBudgets(tablesInSection(wikitext, 'Budgets'));

  console.log(
    `  parsed — overview ${overview.length}, launch ${launch.size}, deep space ${deepSpace.size + deepSpaceNoLaunch.size}, human ${human.size}, budgets ${budgets.size}`,
  );
  if (overview.length < MIN_EXPECTED_AGENCIES) {
    throw new Error(
      `overview table yielded only ${overview.length} rows — upstream layout likely changed`,
    );
  }

  // Every article title mentioned anywhere on the page.
  const allTitles = new Set(overview.map((row) => row.title));
  for (const source of [launch, deepSpace, deepSpaceNoLaunch, human, budgets]) {
    for (const title of source.keys()) allTitles.add(title);
  }

  console.log(`fetching ${allTitles.size} articles…`);
  const articles = await fetchArticles([...allTitles]);

  // Titles differ across tables ([[ESA]] vs [[European Space Agency]]); the
  // canonical article title after redirects is the join key.
  const canonical = (title) => articles.get(title)?.title ?? title;

  /** Merges a capability map into the record set, creating records as needed. */
  const records = new Map();
  const ensure = (title) => {
    const key = canonical(title);
    if (!records.has(key)) {
      records.set(key, {
        title: key,
        capabilities: {},
        countryToken: null,
        historical: false,
      });
    }
    return records.get(key);
  };

  for (const row of overview) {
    const record = ensure(row.title);
    record.name = row.name;
    record.acronym = row.acronym;
    record.founded = row.founded;
    record.countryToken ??= row.countryToken;
    record.inOverview = true;
    Object.assign(record.capabilities, row.capabilities);
  }

  for (const source of [launch, deepSpace, deepSpaceNoLaunch, human]) {
    for (const [title, entry] of source) {
      const record = ensure(title);
      record.countryToken ??= entry.countryToken;
      record.historical ||= entry.historical;
      Object.assign(record.capabilities, entry.capabilities);
    }
  }

  for (const [title, budget] of budgets) {
    const record = ensure(title);
    record.countryToken ??= budget.countryToken;
    record.budget = { usdMillions: budget.usdMillions, year: budget.year };
  }

  const qids = [...records.keys()]
    .map((key) => articles.get(key)?.qid ?? findQid(articles, key))
    .filter(Boolean);
  console.log(`fetching ${qids.length} Wikidata entities…`);
  const entities = await fetchEntities(qids);

  const unresolved = [];
  const agencies = [];

  for (const record of records.values()) {
    const article = articles.get(record.title) ?? findArticle(articles, record.title);
    const entity = article?.qid ? entities.get(article.qid) : null;

    const overrideIso3 = COUNTRY_OVERRIDES[record.title];
    const country =
      (overrideIso3 && countries.find((c) => c.iso3 === overrideIso3)) ||
      resolve(record.countryToken) ||
      resolve(entity?.country);

    if (!country) {
      unresolved.push(`${record.title} (token: ${record.countryToken ?? '—'})`);
      continue;
    }

    const founded = record.founded ?? entity?.inception ?? null;
    const tier = classify(record.capabilities);

    agencies.push({
      id: slug(record.title),
      name: record.name ?? article?.title ?? record.title,
      acronym: record.acronym,
      country: country.name,
      iso2: country.iso2,
      iso3: country.iso3,
      flag: country.emoji ?? flagEmoji(country.iso2),
      region: country.region,
      subregion: country.subregion,
      supranational: Boolean(country.supranational),
      historical: Boolean(record.historical || country.historical),
      founded,
      foundedYear: founded ? Number(founded.slice(0, 4)) : null,
      headquarters: entity?.headquarters ?? null,
      coordinates: entity?.coordinates ?? null,
      website: entity?.website ?? null,
      employees: entity?.employees ?? null,
      budget: record.budget ?? null,
      summary: article?.extract ?? null,
      thumbnail: article?.thumbnail ?? null,
      logo: entity?.logo ?? null,
      parent: entity?.parent ?? null,
      wikipedia: article?.url ?? null,
      tier: tier.id,
      tierLabel: tier.label,
      tierRank: tier.rank,
      capabilities: record.capabilities,
    });
  }

  agencies.sort((a, b) => a.name.localeCompare(b.name));

  if (agencies.length < MIN_EXPECTED_AGENCIES) {
    throw new Error(
      `only ${agencies.length} agencies resolved — refusing to overwrite existing dataset`,
    );
  }

  const dataset = {
    generatedAt: new Date().toISOString(),
    source: { page: SOURCE_PAGE, url: SOURCE_URL, license: 'CC BY-SA 4.0' },
    counts: summarise(agencies),
    agencies,
  };

  await writeFile(
    join(ROOT, 'data', 'agencies.json'),
    `${JSON.stringify(dataset, null, 1)}\n`,
  );

  console.log(`agencies.json — ${agencies.length} agencies`);
  console.log(
    `  ${dataset.counts.countries} countries · ${dataset.counts.orbitalLaunch} orbital launch · ${dataset.counts.humanSpaceflight} human spaceflight`,
  );
  if (unresolved.length) {
    console.log(`  skipped (no country): ${unresolved.join('; ')}`);
  }
}

function summarise(agencies) {
  const has = (a, key) => a.capabilities[key]?.has === true;
  return {
    agencies: agencies.length,
    countries: new Set(agencies.map((a) => a.iso3)).size,
    orbitalLaunch: agencies.filter((a) => has(a, 'orbitalLaunch')).length,
    humanSpaceflight: agencies.filter((a) => has(a, 'crewedLaunch')).length,
    deepSpace: agencies.filter((a) => a.tierRank >= 4).length,
    withBudget: agencies.filter((a) => a.budget).length,
    totalBudgetUsdMillions: Math.round(
      agencies.reduce((sum, a) => sum + (a.budget?.usdMillions ?? 0), 0),
    ),
  };
}

/** Falls back to a case-insensitive title match. */
function findArticle(articles, title) {
  for (const article of articles.values()) {
    if (article.title.toLowerCase() === title.toLowerCase()) return article;
  }
  return null;
}

function findQid(articles, title) {
  return findArticle(articles, title)?.qid ?? null;
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

main().catch((err) => {
  console.error(`scrape failed: ${err.message}`);
  process.exit(1);
});
