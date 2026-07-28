# 🛰️ Space Atlas

An interactive atlas of every government space agency **and** private
spaceflight company on Earth — capabilities, budgets, workforce, founding
dates and headquarters, in one searchable place.

**226 organisations — 89 government agencies and 137 private companies —
across 78 countries.**

Static site, no framework, no build step. Deploys straight to GitHub Pages.

## Features

- **Brief** — the console: live headline wire, recent federal contract actions
  with descriptions, flight activity, SEC filings and imagery, all filtered
  together
- **Map** — world choropleth shaded by each country's highest demonstrated
  capability. Clicking a country opens its national roll-up rather than one
  organisation, because a single shape can hold hundreds
- **Countries** — national profiles: every organisation based there, aggregate
  contracts, launches and success rate, national milestones and press. This is
  what the map cannot show — 255 of 822 organisations are American
- **Cards / Table** — browsable grid or dense sortable table
- **Charts** — budget and workforce rankings, founding activity by decade, and
  how widely each capability is held
- **Compare** — up to four organisations side by side across 14 metrics
- **Feed** — what changed between dataset revisions, generated from git history
- **API** — schema, licence tiers, provenance model and fetchable endpoints
- **Search & filter** — by sector (agency / company), name, country, acronym,
  region, capability or tier
- **Detail view** — full capability breakdown per organisation, including the
  mission or vehicle that first demonstrated each milestone (ESA's orbital
  launch → *Ariane 1*; SpaceX's → *Falcon 1*), a company's vehicle portfolio
  with flight status, and links to the official site and Wikipedia
- Deep links (`#isro`), keyboard shortcuts (`/` to search, `Esc` to close),
  light and dark themes

## Where the data comes from

Nothing is hand-maintained. Every field records which source it came from.

| Source | Provides | Licence | Redistributable |
| --- | --- | --- | --- |
| [Wikidata](https://www.wikidata.org) | organisation roster, country, HQ, founding, website, staff, logo | CC0-1.0 | ✅ |
| [USAspending.gov](https://www.usaspending.gov) | US federal contract awards | US public domain | ✅ |
| [SEC EDGAR](https://www.sec.gov/edgar) | revenue and headcount for listed companies | US public domain | ✅ |
| [Natural Earth](https://www.naturalearthdata.com/) | country boundaries | Public domain | ✅ |
| ISO 3166-1 | country codes and regions | Facts | ✅ |
| Wikipedia [agencies](https://en.wikipedia.org/wiki/List_of_government_space_agencies) / [companies](https://en.wikipedia.org/wiki/List_of_private_spaceflight_companies) | demonstrated capabilities, budgets, prose, vehicle lists | CC BY-SA 4.0 | ❌ share-alike |
| [NASA Image and Video Library](https://images.nasa.gov) | imagery per organisation | US public domain | ✅ |
| [Launch Library 2](https://thespacedevs.com/llapi) | launch and landing record | CC BY 4.0 | ❌ attribution, 15 req/hour |
| Space news RSS (NASA, ESA, SpaceNews, Payload, NASASpaceflight, Spaceflight Now, European Spaceflight, Ars Technica, Phys.org) | headlines tagged to organisations | Publisher copyright | ❌ |

A GitHub Action re-runs the build every Monday and commits the result only if
something changed.

## The two data tiers

The build emits two files from one pipeline:

| File | Contents | Use |
| --- | --- | --- |
| `data/organisations.json` | every field | the public site |
| `data/organisations.open.json` | only CC0 / US-public-domain fields | redistribution |

The split is mechanical, not a judgement call: each record carries a
`provenance` map of `field → source`, `scripts/lib/licensing.mjs` declares
whether each source is redistributable, and the open artifact is produced by
dropping every field whose source is not.

`scripts/validate.mjs` then enforces it — a Wikipedia- or Launch-Library-sourced
field appearing in the open artifact is a hard build failure, reported as a
`LICENCE LEAK`. That check exists because the failure mode is silent: nothing
about a share-alike field looks different from a public-domain one at runtime.

**This is not legal advice.** It encodes each source's published terms so the
constraint is visible in the data rather than living in someone's memory.
[`LICENSING.md`](LICENSING.md) is a brief written to be handed to counsel: it
lists every source's terms, what the code enforces, and the specific questions
a lawyer needs to answer before anything is sold. Two things worth knowing:

- Wikipedia is CC BY-SA 4.0. You may sell it, but derivatives must carry the
  same licence, so your customers may redistribute it too. Bare facts are not
  copyrightable in the US (*Feist*); the **prose** is the protected part, which
  is why `summary` is excluded from the open tier rather than the whole record.
- Launch Library 2 is free at 15 requests/hour. Bulk redistribution needs a
  commercial arrangement with The Space Devs.

### Why the scrape can't quietly break the site

Wikipedia tables get restructured. Three things guard against that:

1. `scripts/scrape.mjs` throws rather than writing a dataset with fewer than 50
   agencies or 80 companies, so a parse failure leaves the committed data in
   place.
2. `scripts/validate.mjs` checks schema, ID uniqueness, plausible years and
   budgets, map coverage, and the presence of anchor organisations (NASA, ESA,
   ISRO, JAXA, Roscosmos, CNSA, SpaceX, Rocket Lab, Blue Origin, Arianespace)
   — including that SpaceX still reads as orbital- and crewed-launch capable,
   which catches a silent break in the private-page parsing. It runs after
   every scrape and on every push.
3. The Pages deploy is gated on that validation passing.

## Running locally

```bash
python3 -m http.server 8181
```

Then open <http://localhost:8181>. The page fetches JSON, so opening
`index.html` via `file://` will not work — it needs a server.

To regenerate the data (Node 20+, no dependencies):

```bash
npm run build:all
```

That runs three steps, which can also be run individually:

| Command | Writes | Notes |
| --- | --- | --- |
| `npm run build:countries` | `data/countries.json` | ISO 3166-1 reference. Rarely changes. |
| `npm run build:map` | `data/world-map.json` | Robinson-projected SVG paths per country. Rarely changes. |
| `npm run scrape` | `data/agencies.json` | Wikipedia capabilities layer. |
| `npm run build:data` | `data/organisations*.json` | Merges every source. This is the weekly one. |
| `npm run build:changelog` | `data/changelog.json` | Diffs dataset revisions from git history. |
| `npm test` | — | Validates schema, provenance and licence tiers. |

`npm run build:data` needs one environment variable for the SEC source, which
rejects generic user agents under its fair-access policy:

```bash
export SEC_USER_AGENT="Your Name you@example.com"
```

Without it EDGAR is skipped and the build continues. In CI this is read from
the `SEC_USER_AGENT` repository secret.

The scrape makes ~40 paced API requests across both pages and takes a couple
of minutes.

## Deploying to GitHub Pages

1. Push this repository to GitHub with `main` as the default branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push once more (or run the *Deploy to GitHub Pages* workflow manually).

`.github/workflows/refresh-data.yml` needs no secrets — it uses the built-in
`GITHUB_TOKEN`. If the weekly commit fails to push, enable
**Settings → Actions → General → Workflow permissions → Read and write**.

## Project layout

```
index.html                 markup and view shells
assets/css/style.css       theming, layout, all four views
assets/js/app.js           data loading, filtering, rendering, interaction
data/agencies.json         generated — the dataset
data/countries.json        generated — ISO country reference
data/world-map.json        generated — SVG paths + centroids per country
scripts/scrape.mjs         both Wikipedia lists + Wikidata → agencies.json
scripts/build-map.mjs      TopoJSON → projected SVG paths
scripts/build-countries.mjs ISO 3166-1 → countries.json
scripts/validate.mjs       integrity checks (npm test)
scripts/lib/wikitext.mjs   wikitable parser (rowspan, colspan, nested templates)
scripts/lib/private.mjs    folds the product-per-row private list into companies
scripts/lib/countries.mjs  IOC/ISO country-code and name resolution
scripts/lib/wikiapi.mjs    MediaWiki + Wikidata clients
```

## Notes on the data

- **Capability tiers** are derived, not stated upstream: human spaceflight →
  deep space → orbital launch → satellite & spacecraft → emerging. A country is
  shaded by its most capable organisation, agency or company.
- **Only demonstrated capability counts.** The private list is organised by
  vehicle, with a flight record like `Retired (0/1)` meaning "flew once,
  failed". A vehicle in development, cancelled, or with zero successes does not
  earn its company the capability — which is why Astrobotic shows none despite
  Peregrine having launched.
- **Companies have no country column upstream.** Country comes from the
  article's Wikidata item (`P17`, then country of headquarters), falling back to
  the nationality adjective in the article's opening sentence. 14 companies
  resolve to none and are omitted; the scrape lists them by name each run.
- **Workforce figures are whole-organisation.** Diversified manufacturers
  (Airbus, Boeing, Toyota, AVIC) report company-wide headcount, not space staff,
  so they dominate that chart. The chart says so.
- **Supranational bodies** (ESA, African Space Agency, APSCO) have no map shape
  and are reachable through search and the other views.
- **Defunct programmes** — the Soviet space program and MirCorp — are marked
  *Defunct* rather than dropped, since they hold capability firsts.
- **Sub-national bodies** (US state spaceport authorities, Kerala's K-Space) sit
  in the upstream agency table under a different column layout; they are kept
  and flagged `subnational`.
- **Budgets** are whatever year Wikipedia last recorded; the year is shown
  alongside each figure. They are not inflation-adjusted and not directly
  comparable across years.
- Wikipedia's tables mix IOC and ISO country codes in the same rows
  (`{{GER}}` and `{{NLD}}` side by side); `scripts/lib/countries.mjs` resolves
  IOC first because some codes mean different countries in each scheme
  (IOC `BRN` is Bahrain, ISO `BRN` is Brunei).

## Licence

Site code: MIT (see `LICENSE`). Data licensing is covered in detail by
[`LICENSING.md`](LICENSING.md).
Organisation data derives from Wikipedia and Wikidata and remains under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Boundaries are from Natural Earth (public domain).
