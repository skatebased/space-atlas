/**
 * Imagery from the NASA Image and Video Library.
 *
 * NASA media is US government work and generally public domain, so this is one
 * of the few image sources that can ship in the commercial tier. Only
 * organisations likely to appear in NASA's catalogue are queried — searching
 * for all 824 would be mostly wasted requests against a US-centric archive.
 */

const API = 'https://images-api.nasa.gov/search';
const UA = 'space-atlas/1.0 (+https://github.com/skatebased/space-atlas)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Picks a usable thumbnail out of an item's asset links. */
function thumbnailOf(item) {
  const link = (item.links ?? []).find(
    (l) => l.render === 'image' && typeof l.href === 'string',
  );
  return link?.href ?? null;
}

/**
 * Fetches recent imagery for one search term.
 * Returns newest-first items with title, date, thumbnail and NASA detail page.
 */
async function searchImages(term, { limit = 6 } = {}) {
  const params = new URLSearchParams({
    q: term,
    media_type: 'image',
    page_size: '30',
  });
  const res = await fetch(`${API}?${params}`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  const items = (data.collection?.items ?? [])
    .map((item) => {
      const meta = item.data?.[0] ?? {};
      return {
        title: meta.title ?? null,
        created: meta.date_created ?? null,
        center: meta.center ?? null,
        nasaId: meta.nasa_id ?? null,
        thumbnail: thumbnailOf(item),
        url: meta.nasa_id
          ? `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`
          : null,
      };
    })
    .filter((item) => item.title && item.thumbnail)
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));

  return items.slice(0, limit);
}

/**
 * Fetches imagery for the organisations most likely to be represented.
 * Returns `Map<orgId, image[]>`.
 */
export async function fetchImagery(organisations, { log = () => {}, maxOrgs = 60 } = {}) {
  // Rank by how much evidence we already hold — those are the organisations
  // a reader is most likely to open, and the ones NASA is likely to have shot.
  const ranked = organisations
    .filter((org) => org.name && org.name.length > 3)
    .map((org) => ({
      org,
      score:
        (org.launchRecord?.totalLaunches ?? 0) * 3 +
        (org.federalContracts ? 50 : 0) +
        (org.spacecraftCount ?? 0) +
        (org.tierRank ?? 0) * 10,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxOrgs);

  const results = new Map();
  for (const { org } of ranked) {
    // Acronyms are ambiguous in a general-purpose archive; search the name.
    const term = org.name.length > 40 && org.acronym ? org.acronym : org.name;
    try {
      const images = await searchImages(term);
      if (images.length) results.set(org.id, images);
    } catch (err) {
      log(`  imagery ${org.id}: ${err.message}`);
    }
    await sleep(350);
  }

  log(`  imagery: ${results.size}/${ranked.length} organisations with NASA imagery`);
  return results;
}
