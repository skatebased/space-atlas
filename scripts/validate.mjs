#!/usr/bin/env node
/**
 * Checks the generated data files before they are published.
 *
 * Runs in CI on every push and after each scrape, so a malformed dataset
 * fails the build instead of silently breaking the site.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(ROOT, relativePath), 'utf8'));
}

function checkDataset(dataset, map) {
  if (!Array.isArray(dataset.organisations)) {
    return fail('agencies.json: `organisations` is not an array');
  }

  const agencies = dataset.organisations;
  if (agencies.length < 150) {
    fail(`agencies.json: only ${agencies.length} organisations (expected 150+)`);
  }
  const government = agencies.filter((a) => a.orgType === 'government');
  const private_ = agencies.filter((a) => a.orgType === 'private');
  if (government.length < 50) fail(`only ${government.length} agencies (expected 50+)`);
  if (private_.length < 80) fail(`only ${private_.length} companies (expected 80+)`);
  if (!dataset.generatedAt || Number.isNaN(Date.parse(dataset.generatedAt))) {
    fail('agencies.json: missing or invalid `generatedAt`');
  }

  const ids = new Set();
  for (const agency of agencies) {
    const label = agency.id ?? agency.name ?? '(unnamed)';

    for (const field of ['id', 'name', 'country', 'iso3', 'tier', 'tierLabel', 'orgType']) {
      if (!agency[field]) fail(`${label}: missing \`${field}\``);
    }
    if (ids.has(agency.id)) fail(`${label}: duplicate id`);
    ids.add(agency.id);

    if (!/^[A-Z]{3}$/.test(agency.iso3 ?? '')) {
      fail(`${label}: malformed iso3 "${agency.iso3}"`);
    }
    if (agency.foundedYear != null) {
      const year = agency.foundedYear;
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        fail(`${label}: implausible foundedYear ${year}`);
      }
    }
    if (agency.budget && !(agency.budget.usdMillions > 0)) {
      fail(`${label}: non-positive budget`);
    }
    if (agency.employees != null && !(agency.employees > 0)) {
      fail(`${label}: non-positive employees`);
    }
    if (!agency.capabilities || typeof agency.capabilities !== 'object') {
      fail(`${label}: missing capabilities`);
    }
    if (agency.website && !/^https?:\/\//.test(agency.website)) {
      fail(`${label}: website is not an absolute URL`);
    }
    if (!['government', 'private'].includes(agency.orgType)) {
      fail(`${label}: unexpected orgType "${agency.orgType}"`);
    }

    // Every non-supranational agency should land somewhere on the map.
    if (!agency.supranational && !agency.historical && !map.shapes[agency.iso3]) {
      warn(`${label}: no map shape for ${agency.iso3}`);
    }
  }

  // Headline numbers must match the rows they summarise.
  const counts = dataset.counts ?? {};
  const actualCountries = new Set(agencies.map((a) => a.iso3)).size;
  if (counts.organisations !== agencies.length) {
    fail(`counts.organisations (${counts.organisations}) ≠ ${agencies.length}`);
  }
  if (counts.agencies !== government.length) {
    fail(`counts.agencies (${counts.agencies}) ≠ ${government.length}`);
  }
  if (counts.companies !== private_.length) {
    fail(`counts.companies (${counts.companies}) ≠ ${private_.length}`);
  }
  if (counts.countries !== actualCountries) {
    fail(`counts.countries (${counts.countries}) ≠ ${actualCountries}`);
  }

  // Sanity anchors: these should be present in any correct scrape.
  for (const acronym of ['NASA', 'ESA', 'ISRO', 'JAXA', 'Roscosmos', 'CNSA']) {
    if (!agencies.some((a) => a.acronym === acronym)) {
      fail(`expected agency "${acronym}" is missing`);
    }
  }
  for (const name of ['SpaceX', 'Rocket Lab', 'Blue Origin', 'Arianespace']) {
    if (!agencies.some((a) => a.name === name && a.orgType === 'private')) {
      fail(`expected company "${name}" is missing`);
    }
  }
  // SpaceX is the anchor for the private-sector capability mapping.
  const spacex = agencies.find((a) => a.name === 'SpaceX');
  if (spacex && !spacex.capabilities.orbitalLaunch?.has) {
    fail('SpaceX is not marked orbital-launch capable — private parsing broke');
  }
  if (spacex && !spacex.capabilities.crewedLaunch?.has) {
    fail('SpaceX is not marked crewed-launch capable — private parsing broke');
  }

  const coverage = (field) =>
    agencies.filter((a) => a[field]).length / agencies.length;
  for (const field of ['summary', 'wikipedia']) {
    if (coverage(field) < 0.7) {
      warn(`only ${(coverage(field) * 100).toFixed(0)}% of agencies have \`${field}\``);
    }
  }
}

function checkMap(map) {
  if (!map.width || !map.height) fail('world-map.json: missing dimensions');

  const shapes = Object.entries(map.shapes ?? {});
  if (shapes.length < 150) {
    fail(`world-map.json: only ${shapes.length} shapes (expected 150+)`);
  }

  for (const [iso3, d] of shapes) {
    if (!/^[A-Z]{3}$/.test(iso3)) fail(`world-map.json: bad key "${iso3}"`);
    if (!/^M[-\d.\s]/.test(d)) fail(`world-map.json: ${iso3} path does not start with M`);

    // A subpath spanning most of the map means an antimeridian seam leaked through.
    for (const sub of d.split('M').slice(1)) {
      const xs = (sub.match(/-?[\d.]+(?= )/g) ?? []).map(Number);
      if (!xs.length) continue;
      if (Math.max(...xs) - Math.min(...xs) > map.width * 0.7) {
        fail(`world-map.json: ${iso3} has a subpath spanning the whole map`);
      }
    }
  }
}

async function main() {
  const [dataset, map, countries] = await Promise.all([
    readJson('data/agencies.json'),
    readJson('data/world-map.json'),
    readJson('data/countries.json'),
  ]);

  if (!Array.isArray(countries) || countries.length < 200) {
    fail(`countries.json: only ${countries?.length} entries (expected 200+)`);
  }

  checkMap(map);
  checkDataset(dataset, map);

  for (const message of warnings) console.warn(`warn  ${message}`);
  for (const message of errors) console.error(`error ${message}`);

  if (errors.length) {
    console.error(`\n${errors.length} error(s) — dataset rejected.`);
    process.exit(1);
  }
  console.log(
    `ok — ${dataset.organisations.length} organisations, ${Object.keys(map.shapes).length} map shapes, ${warnings.length} warning(s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
