# 🛰️ Space Agency Atlas

An interactive atlas of every government space organisation on Earth —
capabilities, budgets, workforce, founding dates and headquarters, in one
searchable place.

Static site, no framework, no build step. Deploys straight to GitHub Pages.

## Features

- **Map** — world choropleth shaded by each country's highest demonstrated
  capability, with hover detail and click-through
- **Cards / Table** — the same data as a browsable grid or a dense sortable table
- **Compare** — budget and workforce rankings, founding activity by decade, and
  how widely each capability is held
- **Search & filter** — by name, country, acronym, region, capability or tier
- **Detail view** — full capability breakdown per agency, including the mission
  or vehicle that first demonstrated each milestone (e.g. orbital launch →
  *Ariane 1*), with links to the official site and Wikipedia
- Deep links (`#isro`), keyboard shortcuts (`/` to search, `Esc` to close),
  light and dark themes

## Where the data comes from

Nothing is hand-maintained. `scripts/scrape.mjs` builds the dataset from:

| Source | Provides |
| --- | --- |
| Wikipedia, [List of government space agencies](https://en.wikipedia.org/wiki/List_of_government_space_agencies) | the roster, demonstrated capabilities, budgets |
| MediaWiki API | intro extract, thumbnail, canonical article URL |
| Wikidata | official website, headquarters, staff count, inception date, logo |
| [Natural Earth](https://www.naturalearthdata.com/) via world-atlas | country boundaries |

A GitHub Action re-runs the scrape every Monday and commits the result only if
something changed.

### Why the scrape can't quietly break the site

Wikipedia tables get restructured. Three things guard against that:

1. `scripts/scrape.mjs` throws rather than writing a dataset with fewer than 50
   agencies, so a parse failure leaves the committed data in place.
2. `scripts/validate.mjs` checks schema, ID uniqueness, plausible years and
   budgets, map coverage, and the presence of anchor agencies (NASA, ESA, ISRO,
   JAXA, Roscosmos, CNSA). It runs after every scrape and on every push.
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
| `npm run scrape` | `data/agencies.json` | The agency dataset. This is the weekly one. |
| `npm test` | — | Validates all three files. |

The scrape makes ~15 paced API requests and takes about a minute.

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
scripts/scrape.mjs         Wikipedia + Wikidata → agencies.json
scripts/build-map.mjs      TopoJSON → projected SVG paths
scripts/build-countries.mjs ISO 3166-1 → countries.json
scripts/validate.mjs       integrity checks (npm test)
scripts/lib/               wikitext parsing, country-code resolution, API clients
```

## Notes on the data

- **Capability tiers** are derived, not stated upstream: human spaceflight →
  deep space → orbital launch → satellite operator → emerging. A country is
  shaded by its most capable agency.
- **Supranational bodies** (ESA, African Space Agency, APSCO) have no map shape
  and are reachable through search and the other views.
- **Defunct programmes** — currently the Soviet space program — are marked
  *Defunct* rather than dropped, since they hold capability firsts.
- **Budgets** are whatever year Wikipedia last recorded; the year is shown
  alongside each figure. They are not inflation-adjusted and not directly
  comparable across years.
- Wikipedia's tables mix IOC and ISO country codes in the same rows
  (`{{GER}}` and `{{NLD}}` side by side); `scripts/lib/countries.mjs` resolves
  IOC first because some codes mean different countries in each scheme
  (IOC `BRN` is Bahrain, ISO `BRN` is Brunei).

## Licence

Site code: MIT (see `LICENSE`).
Agency data derives from Wikipedia and Wikidata and remains under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Boundaries are from Natural Earth (public domain).
