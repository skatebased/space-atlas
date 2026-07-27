/**
 * Launch statistics from Launch Library 2 (The Space Devs).
 *
 * Licence is CC BY 4.0 — attribution required — and free access is capped at
 * 15 requests per hour, so this source is tagged non-redistributable and is
 * excluded from the commercially-clean artifact. Bulk resale would need a
 * commercial arrangement with The Space Devs.
 *
 * Because of that cap the whole agency list (350 records, 4 pages) is cached
 * to disk and only refetched when the cache is older than a day. A cache miss
 * during a rate-limited window degrades to "no launch data" rather than
 * failing the build.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_PATH = join(ROOT, '.cache', 'launchlibrary-agencies.json');
const API = 'https://ll.thespacedevs.com/2.2.0';
const UA = 'space-atlas/1.0 (https://github.com/skatebased/space-atlas)';
const PAGE_SIZE = 100;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readCache() {
  try {
    const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
    const age = Date.now() - Date.parse(raw.fetchedAt);
    return { agencies: raw.agencies, fresh: age < CACHE_MAX_AGE_MS, age };
  } catch {
    return null;
  }
}

async function writeCache(agencies) {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(
    CACHE_PATH,
    JSON.stringify({ fetchedAt: new Date().toISOString(), agencies }),
  );
}

/** Fetches all agency pages. Throws on the first rate-limit response. */
async function fetchAllPages(log) {
  const agencies = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${API}/agencies/?limit=${PAGE_SIZE}&offset=${offset}&mode=detailed`;
    const res = await fetch(url, { headers: { 'user-agent': UA } });

    if (res.status === 429) {
      throw new Error('rate limited (15 requests/hour on the free tier)');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    agencies.push(...(data.results ?? []));
    log(`  launchlibrary: ${agencies.length}/${data.count} agencies`);
    if (!data.next) break;
    await sleep(1500);
  }
  return agencies;
}

/** Normalises a name for joining against the dataset. */
function normalise(name) {
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

/**
 * Returns the agency list, preferring a fresh cache.
 * Falls back to a stale cache, then to an empty list.
 */
export async function fetchLaunchAgencies({ log = () => {} } = {}) {
  const cached = await readCache();
  if (cached?.fresh) {
    log(`  launchlibrary: using cache (${cached.agencies.length} agencies)`);
    return cached.agencies;
  }

  try {
    const agencies = await fetchAllPages(log);
    await writeCache(agencies);
    return agencies;
  } catch (err) {
    if (cached) {
      const hours = Math.round(cached.age / 3600000);
      log(`  launchlibrary: ${err.message}; using ${hours}h-old cache`);
      return cached.agencies;
    }
    log(`  launchlibrary: ${err.message}; no cache, skipping launch stats`);
    return [];
  }
}

/**
 * Joins launch statistics to organisations by name and abbreviation.
 * Returns `Map<orgId, { totalLaunches, successful, failed, ... }>`.
 */
export function matchLaunchStats(agencies, organisations) {
  const byName = new Map();
  const byAbbrev = new Map();
  for (const org of organisations) {
    const key = normalise(org.name);
    if (key && !byName.has(key)) byName.set(key, org);
    if (org.acronym) {
      const abbrev = org.acronym.toUpperCase();
      if (!byAbbrev.has(abbrev)) byAbbrev.set(abbrev, org);
    }
  }

  const matches = new Map();
  for (const agency of agencies) {
    // Only agencies with a flight record add anything.
    const successful = Number(agency.successful_launches) || 0;
    const failed = Number(agency.failed_launches) || 0;
    if (successful + failed === 0) continue;

    const org =
      byName.get(normalise(agency.name)) ??
      (agency.abbrev ? byAbbrev.get(String(agency.abbrev).toUpperCase()) : null);
    if (!org || matches.has(org.id)) continue;

    matches.set(org.id, {
      totalLaunches: successful + failed,
      successful,
      failed,
      successRate: Math.round((successful / (successful + failed)) * 1000) / 10,
      consecutiveSuccesses: Number(agency.consecutive_successful_launches) || 0,
      pending: Number(agency.pending_launches) || 0,
      landings: {
        successful: Number(agency.successful_landings) || 0,
        attempted: Number(agency.attempted_landings) || 0,
      },
    });
  }
  return matches;
}
