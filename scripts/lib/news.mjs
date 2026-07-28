/**
 * Space news, aggregated from public RSS feeds at build time.
 *
 * Fetching happens during the build rather than in the browser: the site is
 * static, and these feeds send no CORS headers, so a client-side fetch would
 * be blocked. Building it in also means the news is versioned alongside the
 * dataset.
 *
 * Headlines are third-party editorial content — linked and excerpted, never
 * reproduced in full — so this source is tagged non-redistributable and is
 * excluded from the commercial tier.
 */

const UA = 'space-atlas/1.0 (+https://github.com/skatebased/space-atlas)';

/** Feeds verified to return 200 without an API key. */
const FEEDS = [
  { id: 'nasa', name: 'NASA', url: 'https://www.nasa.gov/feed/' },
  {
    id: 'esa',
    name: 'ESA',
    url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News',
  },
  { id: 'spacenews', name: 'SpaceNews', url: 'https://spacenews.com/feed/' },
  { id: 'payload', name: 'Payload', url: 'https://payloadspace.com/feed/' },
  {
    id: 'nasaspaceflight',
    name: 'NASASpaceflight',
    url: 'https://www.nasaspaceflight.com/feed/',
  },
  {
    id: 'spaceflightnow',
    name: 'Spaceflight Now',
    url: 'https://spaceflightnow.com/feed/',
  },
  {
    id: 'europeanspaceflight',
    name: 'European Spaceflight',
    url: 'https://europeanspaceflight.com/feed/',
  },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://arstechnica.com/space/feed/' },
  { id: 'physorg', name: 'Phys.org', url: 'https://phys.org/rss-feed/space-news/' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decodes the XML entities that appear in RSS titles and descriptions. */
function decodeEntities(text) {
  return String(text ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Strips HTML and collapses whitespace. */
function plain(text) {
  return decodeEntities(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (xml, name) => {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? match[1] : null;
};

/** Parses RSS 2.0 and Atom into a common item shape. */
function parseFeed(xml, feed) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom
    ? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
    : xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];

  const items = [];
  for (const block of blocks) {
    const title = plain(tag(block, 'title'));
    if (!title) continue;

    let link;
    if (isAtom) {
      const href = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = href?.[1];
    } else {
      link = plain(tag(block, 'link'));
    }
    if (!link || !/^https?:\/\//.test(link)) continue;

    const dateRaw =
      tag(block, 'pubDate') ??
      tag(block, 'published') ??
      tag(block, 'updated') ??
      tag(block, 'dc:date');
    const published = dateRaw ? new Date(plain(dateRaw)) : null;

    const summaryRaw =
      tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content');
    const summary = summaryRaw ? plain(summaryRaw).slice(0, 240) : null;

    items.push({
      title,
      link,
      summary,
      published:
        published && !Number.isNaN(published.getTime())
          ? published.toISOString()
          : null,
      source: feed.name,
      sourceId: feed.id,
    });
  }
  return items;
}

/** Words too generic to identify an organisation from a headline. */
const STOPWORDS = new Set([
  'space',
  'aerospace',
  'systems',
  'technologies',
  'technology',
  'industries',
  'international',
  'national',
  'agency',
  'corporation',
  'company',
  'group',
  'satellite',
  'satellites',
  'science',
  'research',
  'institute',
  'center',
  'centre',
  'laboratory',
  'university',
  'orbital',
  'launch',
  'rocket',
  'the',
  'and',
]);

/**
 * Builds the list of distinctive strings that identify each organisation in
 * prose. A name only qualifies if it survives the stopword filter — matching
 * on "Space" or "Systems" would tag every headline.
 */
function buildMatchers(organisations) {
  const matchers = [];
  for (const org of organisations) {
    const candidates = new Set();

    const name = org.name.trim();
    const nameWords = name.toLowerCase().split(/\s+/);
    const meaningful = nameWords.filter((w) => !STOPWORDS.has(w.replace(/[^a-z]/g, '')));
    // Full names are safe when at least one word carries meaning.
    if (name.length >= 5 && meaningful.length) candidates.add(name);

    // Acronyms only if long enough to be unambiguous.
    if (org.acronym && org.acronym.length >= 3 && /^[A-Za-z]+$/.test(org.acronym)) {
      candidates.add(org.acronym);
    }

    // Space news is mostly about hardware, not companies — "Ariane 6 takes
    // flight" names no organisation at all. Vehicle names are the strongest
    // signal available, so they matter more than the org name here.
    for (const product of org.products ?? []) {
      const productName = String(product.name ?? '').trim();
      // Some product cells are prose descriptions rather than names.
      if (productName.length < 4 || productName.length > 28) continue;
      if (productName.split(/\s+/).length > 3 || /[;,]/.test(productName)) continue;
      const words = productName
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => !STOPWORDS.has(w.replace(/[^a-z]/g, '')));
      if (!words.length) continue;
      candidates.add(productName);
    }

    for (const candidate of candidates) {
      matchers.push({
        org,
        text: candidate,
        // Word-boundary match, case-insensitive, longest candidates first.
        pattern: new RegExp(
          `\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'i',
        ),
        weight: candidate.length,
      });
    }
  }
  // Prefer the most specific match when several apply.
  return matchers.sort((a, b) => b.weight - a.weight);
}

/** Fetches one feed, tolerating individual failures. */
async function fetchFeed(feed, log) {
  try {
    const res = await fetch(feed.url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, feed);
    log(`  news ${feed.id}: ${items.length} items`);
    return items;
  } catch (err) {
    log(`  news ${feed.id}: FAILED (${err.message})`);
    return [];
  }
}

/**
 * Fetches every feed and tags each item with the organisations it mentions.
 * Returns `{ items, byOrg }` where `byOrg` is `Map<orgId, item[]>`.
 */
export async function fetchNews(organisations, { log = () => {}, limit = 250 } = {}) {
  const all = [];
  for (const feed of FEEDS) {
    all.push(...(await fetchFeed(feed, log)));
    await sleep(400);
  }

  // Newest first, de-duplicated by link.
  const seen = new Set();
  const items = all
    .filter((item) => {
      if (seen.has(item.link)) return false;
      seen.add(item.link);
      return true;
    })
    .sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')))
    .slice(0, limit);

  const matchers = buildMatchers(organisations);
  const byOrg = new Map();

  for (const item of items) {
    const haystack = `${item.title} ${item.summary ?? ''}`;
    const matched = new Set();
    for (const matcher of matchers) {
      if (matched.size >= 4) break;
      if (matched.has(matcher.org.id)) continue;
      if (matcher.pattern.test(haystack)) matched.add(matcher.org.id);
    }
    item.organisations = [...matched];
    for (const orgId of matched) {
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      if (byOrg.get(orgId).length < 8) byOrg.get(orgId).push(item);
    }
  }

  const tagged = items.filter((i) => i.organisations.length).length;
  log(`  news: ${items.length} items, ${tagged} tagged to ${byOrg.size} organisations`);
  return { items, byOrg };
}
