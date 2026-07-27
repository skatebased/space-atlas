#!/usr/bin/env node
/**
 * Builds data/countries.json — the canonical country reference used to join
 * Wikipedia's agency tables to the world map.
 *
 * Source: ISO 3166-1 list (name, alpha-2, alpha-3, numeric, region, sub-region).
 * Geography changes rarely, so this is committed and only re-run on demand.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE =
  'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json';

/** Entities that appear in the agency tables but are not ISO 3166-1 countries. */
const SUPRANATIONAL = [
  {
    name: 'European Union',
    iso2: 'EU',
    iso3: 'EUE',
    emoji: '🇪🇺',
    numeric: '000',
    region: 'Europe',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'African Union',
    iso2: 'AU',
    iso3: 'AUU',
    emoji: '🌍',
    numeric: '000',
    region: 'Africa',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'Arab League',
    iso2: 'AL',
    iso3: 'ARL',
    emoji: '🌐',
    numeric: '000',
    region: 'Asia',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'Asia-Pacific Space Cooperation Organization',
    iso2: 'AP',
    iso3: 'APS',
    emoji: '🌏',
    numeric: '000',
    region: 'Asia',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'Latin America and the Caribbean',
    iso2: 'LA',
    iso3: 'LAC',
    emoji: '🌎',
    numeric: '000',
    region: 'Americas',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'United Nations',
    iso2: 'UN',
    iso3: 'UNO',
    emoji: '🇺🇳',
    numeric: '000',
    region: 'International',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'International',
    iso2: 'XX',
    iso3: 'INT',
    emoji: '🌐',
    numeric: '000',
    region: 'International',
    subregion: 'Supranational',
    supranational: true,
  },
  {
    name: 'Soviet Union',
    iso2: 'SU',
    iso3: 'SUN',
    emoji: '🚩',
    numeric: '810',
    region: 'Europe',
    subregion: 'Historical',
    historical: true,
  },
];

/** Shorter, more conventional display names than the formal ISO entries. */
const NAME_OVERRIDES = {
  TWN: { name: 'Taiwan', region: 'Asia', subregion: 'Eastern Asia' },
  KOR: { name: 'South Korea' },
  PRK: { name: 'North Korea' },
  RUS: { name: 'Russia' },
  IRN: { name: 'Iran' },
  BOL: { name: 'Bolivia' },
  VEN: { name: 'Venezuela' },
  TZA: { name: 'Tanzania' },
  VNM: { name: 'Vietnam' },
  SYR: { name: 'Syria' },
  LAO: { name: 'Laos' },
  MDA: { name: 'Moldova' },
  BRN: { name: 'Brunei' },
  CIV: { name: "Côte d'Ivoire" },
  COD: { name: 'DR Congo' },
  GBR: { name: 'United Kingdom' },
  USA: { name: 'United States' },
  CZE: { name: 'Czechia' },
  NLD: { name: 'Netherlands' },
  PSE: { name: 'Palestine' },
  MKD: { name: 'North Macedonia' },
};

async function main() {
  const res = await fetch(SOURCE, {
    headers: { 'user-agent': 'space-agency-atlas/1.0 (dataset build)' },
  });
  if (!res.ok) throw new Error(`ISO source returned ${res.status}`);
  const raw = await res.json();

  const countries = raw.map((c) => ({
    name: c.name,
    iso2: c['alpha-2'],
    iso3: c['alpha-3'],
    numeric: c['country-code'],
    region: c.region || 'Other',
    subregion: c['sub-region'] || '',
    ...NAME_OVERRIDES[c['alpha-3']],
  }));

  const all = [...countries, ...SUPRANATIONAL].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  await writeFile(
    join(ROOT, 'data', 'countries.json'),
    `${JSON.stringify(all, null, 2)}\n`,
  );
  console.log(`countries.json — ${all.length} entries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
