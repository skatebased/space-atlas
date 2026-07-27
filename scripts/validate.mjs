#!/usr/bin/env node
/**
 * Checks the generated data files before they are published.
 *
 * Runs in CI on every push and after each build, so a malformed dataset or a
 * licence leak fails the build instead of silently shipping.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SOURCES } from './lib/licensing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(join(ROOT, relativePath), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Shared record checks                                                */
/* ------------------------------------------------------------------ */

function checkRecords(list, { label, map, requireProvenance = true }) {
  const ids = new Set();

  for (const org of list) {
    const name = org.id ?? org.name ?? '(unnamed)';

    for (const field of ['id', 'name', 'country', 'iso3']) {
      if (!org[field]) fail(`${label}/${name}: missing \`${field}\``);
    }
    if (ids.has(org.id)) fail(`${label}/${name}: duplicate id`);
    ids.add(org.id);

    if (!/^[A-Z]{3}$/.test(org.iso3 ?? '')) {
      fail(`${label}/${name}: malformed iso3 "${org.iso3}"`);
    }
    if (org.foundedYear != null) {
      if (!Number.isInteger(org.foundedYear) || org.foundedYear < 1800 || org.foundedYear > 2100) {
        fail(`${label}/${name}: implausible foundedYear ${org.foundedYear}`);
      }
    }
    if (org.employees != null && !(org.employees > 0)) {
      fail(`${label}/${name}: non-positive employees`);
    }
    if (org.website && !/^https?:\/\//.test(org.website)) {
      fail(`${label}/${name}: website is not an absolute URL`);
    }
    if (org.federalContracts && !(org.federalContracts.usdTotal > 0)) {
      fail(`${label}/${name}: non-positive federal contract total`);
    }
    if (org.launchRecord) {
      const { successful, failed, totalLaunches } = org.launchRecord;
      if (successful + failed !== totalLaunches) {
        fail(`${label}/${name}: launch record does not add up`);
      }
    }

    if (requireProvenance) {
      if (!org.provenance || typeof org.provenance !== 'object') {
        fail(`${label}/${name}: missing provenance map`);
        continue;
      }
      for (const [field, source] of Object.entries(org.provenance)) {
        if (!SOURCES[source]) {
          fail(`${label}/${name}: unknown source "${source}" for \`${field}\``);
        }
      }
      // Every substantive value should be able to name where it came from.
      for (const field of ['name', 'country']) {
        if (org[field] && !org.provenance[field]) {
          fail(`${label}/${name}: \`${field}\` has no recorded source`);
        }
      }
    }

    if (map && !org.supranational && !org.historical && !map.shapes[org.iso3]) {
      warn(`${label}/${name}: no map shape for ${org.iso3}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Dataset-level checks                                                */
/* ------------------------------------------------------------------ */

function checkFull(dataset, map) {
  const list = dataset.organisations;
  if (!Array.isArray(list)) return fail('organisations.json: not an array');
  if (list.length < 400) {
    fail(`organisations.json: only ${list.length} organisations (expected 400+)`);
  }
  if (!dataset.generatedAt || Number.isNaN(Date.parse(dataset.generatedAt))) {
    fail('organisations.json: missing or invalid `generatedAt`');
  }
  if (!dataset.licenses || !Object.keys(dataset.licenses).length) {
    fail('organisations.json: missing licence manifest');
  }

  checkRecords(list, { label: 'full', map });

  const counts = dataset.counts ?? {};
  if (counts.organisations !== list.length) {
    fail(`counts.organisations (${counts.organisations}) ≠ ${list.length}`);
  }
  const countries = new Set(list.map((o) => o.iso3)).size;
  if (counts.countries !== countries) {
    fail(`counts.countries (${counts.countries}) ≠ ${countries}`);
  }

  // Anchors that should survive any correct build.
  for (const name of ['SpaceX', 'NASA', 'Arianespace', 'Rocket Lab']) {
    if (!list.some((o) => o.name === name || o.acronym === name)) {
      fail(`expected organisation "${name}" is missing`);
    }
  }

  // The enrichment sources should each land on something.
  if (!counts.withContracts) warn('no organisation carries federal contract data');
  if (!counts.withFinancials) warn('no organisation carries SEC financials');
  if (!counts.withLaunchRecord) warn('no organisation carries a launch record');
}

/**
 * The redistributable artifact is the sellable one, so the licence rule is
 * enforced rather than assumed: no field may trace to a share-alike or
 * attribution-required source.
 */
function checkOpen(dataset) {
  const list = dataset.organisations;
  if (!Array.isArray(list)) return fail('organisations.open.json: not an array');
  if (list.length < 300) {
    fail(`organisations.open.json: only ${list.length} organisations (expected 300+)`);
  }

  checkRecords(list, { label: 'open' });

  const restricted = Object.entries(SOURCES)
    .filter(([, meta]) => !meta.redistributable)
    .map(([key]) => key);

  for (const org of list) {
    for (const [field, source] of Object.entries(org.provenance ?? {})) {
      if (restricted.includes(source)) {
        fail(
          `LICENCE LEAK — open/${org.id}: \`${field}\` came from ${source} ` +
            `(${SOURCES[source].license}), which is not redistributable`,
        );
      }
    }
    // Prose is the copyrightable part of Wikipedia; it must never appear here.
    for (const field of ['summary', 'thumbnail', 'wikipedia']) {
      if (org[field] !== undefined) {
        fail(`LICENCE LEAK — open/${org.id}: \`${field}\` must not be present`);
      }
    }
  }

  for (const meta of Object.values(dataset.licenses ?? {})) {
    if (!meta.redistributable) {
      fail(`open manifest advertises a non-redistributable source: ${meta.name}`);
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
      if (xs.length && Math.max(...xs) - Math.min(...xs) > map.width * 0.7) {
        fail(`world-map.json: ${iso3} has a subpath spanning the whole map`);
      }
    }
  }
}

async function main() {
  const [full, open, map, countries] = await Promise.all([
    readJson('data/organisations.json'),
    readJson('data/organisations.open.json'),
    readJson('data/world-map.json'),
    readJson('data/countries.json'),
  ]);

  if (!map) fail('data/world-map.json is missing');
  else checkMap(map);

  if (!Array.isArray(countries) || countries.length < 200) {
    fail(`countries.json: only ${countries?.length} entries (expected 200+)`);
  }

  if (!full) fail('data/organisations.json is missing — run `npm run build:data`');
  else checkFull(full, map);

  if (!open) fail('data/organisations.open.json is missing');
  else checkOpen(open);

  for (const message of warnings) console.warn(`warn  ${message}`);
  for (const message of errors) console.error(`error ${message}`);

  if (errors.length) {
    console.error(`\n${errors.length} error(s) — dataset rejected.`);
    process.exit(1);
  }
  console.log(
    `ok — ${full.organisations.length} organisations, ` +
      `${open.organisations.length} redistributable, ` +
      `${Object.keys(map.shapes).length} map shapes, ${warnings.length} warning(s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
