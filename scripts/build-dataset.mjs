#!/usr/bin/env node
/**
 * Builds the unified dataset from every source, under the licence model.
 *
 * Order matters: Wikidata (CC0) is applied first so the commercially-clean
 * artifact gets the richest possible set of fields, and Wikipedia — which is
 * share-alike and therefore excluded from that artifact — only fills gaps.
 *
 * Emits two files from one pipeline:
 *   data/organisations.json       every field, for the public site
 *   data/organisations.open.json  CC0 / US-public-domain fields only
 *
 * The previous outputs are left untouched if a run produces obviously broken
 * results, so a bad upstream day cannot empty the site.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createResolver, flagEmoji } from './lib/countries.mjs';
import {
  createRecord,
  toRedistributable,
  licenseManifest,
  SOURCES,
} from './lib/licensing.mjs';
import { fetchWikidataOrgs } from './lib/wikidata-orgs.mjs';
import { fetchSpaceContractors, matchContractors } from './lib/usaspending.mjs';
import { fetchEdgarFinancials } from './lib/edgar.mjs';
import { fetchLaunchAgencies, matchLaunchStats } from './lib/launchlibrary.mjs';
import { fetchNews } from './lib/news.mjs';
import { fetchRecentFilings, fetchRecentAwards } from './lib/filings.mjs';
import { fetchImagery } from './lib/imagery.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_EXPECTED = 400;

const log = (message) => console.log(message);

/* ------------------------------------------------------------------ */
/* Derived fields                                                      */
/* ------------------------------------------------------------------ */

const TIERS = [
  { id: 'human-spaceflight', label: 'Human spaceflight', rank: 5 },
  { id: 'deep-space', label: 'Deep space exploration', rank: 4 },
  { id: 'orbital-launch', label: 'Orbital launch', rank: 3 },
  { id: 'satellite-operator', label: 'Satellite & spacecraft', rank: 2 },
  { id: 'emerging', label: 'Emerging', rank: 1 },
];

const DEEP_SPACE = [
  'flyby',
  'extraterrestrialOrbiter',
  'surfaceImpact',
  'softLanding',
  'rover',
  'sampleReturn',
];

const SUPPORTING = [
  'operatesSatellites',
  'buildsSatellites',
  'cargoSpacecraft',
  'crewedSuborbital',
  'suborbitalLaunch',
  'propulsion',
  'spacecraftComponents',
  'spaceManufacturing',
  'researchCraft',
  'spaceliner',
];

function classify(caps = {}, roles = []) {
  const has = (key) => caps[key]?.has === true;
  if (has('crewedLaunch') || has('spaceStation') || has('moonLanding')) return TIERS[0];
  if (DEEP_SPACE.some(has)) return TIERS[1];
  if (has('orbitalLaunch')) return TIERS[2];
  if (SUPPORTING.some(has)) return TIERS[3];
  // Wikidata-only organisations have no capability table, so their role
  // stands in: building or operating flight hardware is a real signal.
  if (roles.includes('manufacturer') || roles.includes('operator')) return TIERS[3];
  return TIERS[4];
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normalised name used to join organisations across sources. */
function joinKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(
      /\b(corporation|corp|incorporated|inc|company|co|limited|ltd|llc|gmbh|sa|plc|holdings?|group)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const countries = JSON.parse(
    await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'),
  );
  const { resolve, resolveFromText } = createResolver(countries);

  // The Wikipedia-derived dataset built by scrape.mjs, used as an overlay for
  // capabilities and prose that Wikidata does not carry.
  let wikipedia = { organisations: [] };
  try {
    wikipedia = JSON.parse(
      await readFile(join(ROOT, 'data', 'agencies.json'), 'utf8'),
    );
  } catch {
    log('  note: data/agencies.json missing — run `npm run scrape` first');
  }

  log('fetching Wikidata organisations…');
  const { orgs: wikidataOrgs } = await fetchWikidataOrgs({ log });
  log(`  wikidata: ${wikidataOrgs.size} organisations`);

  /* ---- Assemble records, CC0 first ---- */
  const records = new Map();
  const byJoinKey = new Map();

  const ensure = (name) => {
    const key = joinKey(name);
    if (byJoinKey.has(key)) return byJoinKey.get(key);
    const record = { key, r: createRecord(), roles: [], capabilities: {}, products: [] };
    byJoinKey.set(key, record);
    records.set(key, record);
    return record;
  };

  for (const org of wikidataOrgs.values()) {
    const entry = ensure(org.name);
    const { r } = entry;
    r.set('name', org.name, 'wikidata');
    r.set('wikidataId', org.qid, 'wikidata');
    r.set('country', org.country, 'wikidata');
    r.set('headquarters', org.headquarters, 'wikidata');
    r.set('founded', org.inception, 'wikidata');
    r.set('website', org.website, 'wikidata');
    r.set('employees', org.employees, 'wikidata');
    r.set('logo', org.logo, 'wikidata');
    if (org.spacecraftCount) r.set('spacecraftCount', org.spacecraftCount, 'wikidata');
    entry.roles = [...new Set([...entry.roles, ...org.roles])];
    entry.wikipediaTitle = org.wikipediaTitle;
  }

  // Wikipedia overlay: capabilities, prose, acronyms, budgets.
  for (const org of wikipedia.organisations ?? []) {
    const entry = ensure(org.name);
    const { r } = entry;
    r.set('name', org.name, 'wikipedia');
    r.set('acronym', org.acronym, 'wikipedia');
    r.set('country', org.country, 'wikipedia');
    r.set('headquarters', org.headquarters, 'wikipedia');
    r.set('founded', org.founded, 'wikipedia');
    r.set('website', org.website, 'wikipedia');
    r.set('employees', org.employees, 'wikipedia');
    r.set('logo', org.logo, 'wikipedia');
    r.set('summary', org.summary, 'wikipedia');
    r.set('thumbnail', org.thumbnail, 'wikipedia');
    r.set('wikipedia', org.wikipedia, 'wikipedia');
    if (org.budget) r.set('budget', org.budget, 'wikipedia');
    if (org.orgType) r.set('orgType', org.orgType, 'wikipedia');
    entry.capabilities = org.capabilities ?? {};
    entry.products = org.products ?? [];
    entry.historical = org.historical;
    entry.subnational = org.subnational;
  }

  /* ---- Resolve countries and finalise the base list ---- */
  const organisations = [];
  const usedIds = new Set();
  let unresolved = 0;

  for (const entry of records.values()) {
    const built = entry.r.build();
    if (!built.name) continue;

    const country =
      resolve(built.country) ?? resolveFromText(built.summary) ?? null;
    if (!country) {
      unresolved += 1;
      continue;
    }

    const tier = classify(entry.capabilities, entry.roles);
    let id = slug(built.name);
    if (usedIds.has(id)) id = `${id}-${slug(country.iso3)}`;
    if (usedIds.has(id)) continue;
    usedIds.add(id);

    const countrySource = built.provenance.country ?? 'wikidata';
    const provenance = {
      ...built.provenance,
      id: countrySource,
      iso2: countrySource,
      iso3: countrySource,
      flag: countrySource,
      region: 'iso',
      subregion: 'iso',
      tier: entry.capabilities && Object.keys(entry.capabilities).length
        ? 'wikipedia'
        : 'wikidata',
      tierLabel: 'wikidata',
      tierRank: 'wikidata',
      roles: 'wikidata',
      orgType: built.provenance.orgType ?? 'wikidata',
    };

    organisations.push({
      ...built,
      id,
      // Wikidata-discovered organisations with no Wikipedia row default to
      // private unless they were found through the agency query.
      orgType:
        built.orgType ??
        (entry.roles.includes('agency') ? 'government' : 'private'),
      country: country.name,
      iso2: country.iso2,
      iso3: country.iso3,
      flag: country.emoji ?? flagEmoji(country.iso2),
      region: country.region,
      subregion: country.subregion,
      supranational: Boolean(country.supranational),
      historical: Boolean(entry.historical || country.historical),
      subnational: Boolean(entry.subnational),
      foundedYear: built.founded ? Number(built.founded.slice(0, 4)) : null,
      roles: entry.roles,
      tier: tier.id,
      tierLabel: tier.label,
      tierRank: tier.rank,
      capabilities: entry.capabilities,
      ...(entry.products.length ? { products: entry.products } : {}),
      provenance,
    });
  }

  log(`  merged: ${organisations.length} organisations (${unresolved} without a country)`);
  if (organisations.length < MIN_EXPECTED) {
    throw new Error(
      `only ${organisations.length} organisations — refusing to overwrite existing data`,
    );
  }

  /* ---- Enrichment sources ---- */
  log('fetching USAspending contract awards…');
  const { contractors, window } = await fetchSpaceContractors({ log });
  const contracts = matchContractors(contractors, organisations);
  log(`  usaspending: ${contractors.length} recipients, ${contracts.size} matched`);

  log('fetching SEC EDGAR financials…');
  const financials = await fetchEdgarFinancials(organisations, { log });

  log('fetching Launch Library 2 statistics…');
  const launchAgencies = await fetchLaunchAgencies({ log });
  const launchStats = matchLaunchStats(launchAgencies, organisations);
  log(`  launchlibrary: ${launchStats.size} organisations matched`);

  for (const org of organisations) {
    const contract = contracts.get(org.id);
    if (contract) {
      org.federalContracts = { ...contract, window };
      org.provenance.federalContracts = 'usaspending';
    }
    const financial = financials.get(org.id);
    if (financial) {
      org.financials = financial;
      org.provenance.financials = 'sec';
    }
    const launches = launchStats.get(org.id);
    if (launches) {
      org.launchRecord = launches;
      org.provenance.launchRecord = 'launchlibrary';
    }
  }

  /* ---- Intelligence layer: paper trail, imagery, press ---- */
  log('fetching recent contract actions…');
  const awards = await fetchRecentAwards(organisations, { log });

  log('fetching recent SEC filings…');
  const filings = await fetchRecentFilings(organisations, { log });

  log('fetching NASA imagery…');
  const imagery = await fetchImagery(organisations, { log });

  log('fetching space news…');
  const { items: newsItems, byOrg: newsByOrg } = await fetchNews(organisations, { log });

  for (const org of organisations) {
    const orgAwards = awards.get(org.id);
    if (orgAwards?.length) {
      org.recentAwards = orgAwards;
      org.provenance.recentAwards = 'usaspending';
    }
    const orgFilings = filings.get(org.id);
    if (orgFilings?.length) {
      org.recentFilings = orgFilings;
      org.provenance.recentFilings = 'sec';
    }
    const orgImages = imagery.get(org.id);
    if (orgImages?.length) {
      org.imagery = orgImages;
      org.provenance.imagery = 'nasaimages';
    }
    const orgNews = newsByOrg.get(org.id);
    if (orgNews?.length) {
      org.news = orgNews;
      org.provenance.news = 'news';
    }
  }

  organisations.sort((a, b) => a.name.localeCompare(b.name));

  /* ---- Emit both artifacts ---- */
  const counts = summarise(organisations);
  const generatedAt = new Date().toISOString();

  const full = {
    generatedAt,
    tier: 'full',
    notice:
      'Contains Wikipedia-derived fields under CC BY-SA 4.0. Redistribution ' +
      'requires attribution and the same licence. See `licenses` and each ' +
      "record's `provenance` map.",
    licenses: licenseManifest(),
    counts,
    news: newsItems,
    organisations,
  };

  const openOrganisations = organisations
    .map(toRedistributable)
    .filter((org) => org && org.name && org.iso3);
  const openCounts = summarise(openOrganisations);

  const open = {
    generatedAt,
    tier: 'open',
    notice:
      'Every field here comes from a CC0 or US public-domain source and may ' +
      'be redistributed commercially without attribution or share-alike.',
    licenses: licenseManifest(
      Object.keys(SOURCES).filter((key) => SOURCES[key].redistributable),
    ),
    counts: openCounts,
    organisations: openOrganisations,
  };

  await writeFile(
    join(ROOT, 'data', 'organisations.json'),
    `${JSON.stringify(full, null, 1)}\n`,
  );
  await writeFile(
    join(ROOT, 'data', 'organisations.open.json'),
    `${JSON.stringify(open, null, 1)}\n`,
  );

  log(
    `\norganisations.json — ${counts.organisations} orgs (${counts.agencies} agencies, ${counts.companies} companies), ${counts.countries} countries`,
  );
  log(
    `  contracts ${counts.withContracts} · financials ${counts.withFinancials} · launch records ${counts.withLaunchRecord}`,
  );
  log(
    `  news ${counts.withNews} · filings ${counts.withFilings} · imagery ${counts.withImagery} · recent awards ${counts.withRecentAwards} · ${newsItems.length} headlines`,
  );
  log(
    `organisations.open.json — ${openCounts.organisations} orgs, redistributable fields only`,
  );
}

function summarise(list) {
  const has = (a, key) => a.capabilities?.[key]?.has === true;
  return {
    organisations: list.length,
    agencies: list.filter((a) => a.orgType === 'government').length,
    companies: list.filter((a) => a.orgType === 'private').length,
    countries: new Set(list.map((a) => a.iso3)).size,
    orbitalLaunch: list.filter((a) => has(a, 'orbitalLaunch')).length,
    humanSpaceflight: list.filter((a) => has(a, 'crewedLaunch')).length,
    deepSpace: list.filter((a) => (a.tierRank ?? 0) >= 4).length,
    withContracts: list.filter((a) => a.federalContracts).length,
    withFinancials: list.filter((a) => a.financials).length,
    withLaunchRecord: list.filter((a) => a.launchRecord).length,
    withNews: list.filter((a) => a.news?.length).length,
    withFilings: list.filter((a) => a.recentFilings?.length).length,
    withImagery: list.filter((a) => a.imagery?.length).length,
    withRecentAwards: list.filter((a) => a.recentAwards?.length).length,
    federalContractUsd: Math.round(
      list.reduce((sum, a) => sum + (a.federalContracts?.usdTotal ?? 0), 0),
    ),
  };
}

main().catch((err) => {
  console.error(`build failed: ${err.message}`);
  process.exit(1);
});
