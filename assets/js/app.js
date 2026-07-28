/**
 * Space Atlas — front end.
 *
 * Loads the generated dataset, then renders four views over the same filtered
 * list (map, cards, table, charts). No dependencies; the map is plain SVG
 * paths produced by scripts/build-map.mjs.
 */

import { esc, formatUsd, formatStaff, tierColor, timeAgo, number, label } from './format.js';
import { renderBrief, renderCompare, renderFeed, renderApi } from './views.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TIER_COLORS = {
  'human-spaceflight': 'var(--tier-5)',
  'deep-space': 'var(--tier-4)',
  'orbital-launch': 'var(--tier-3)',
  'satellite-operator': 'var(--tier-2)',
  emerging: 'var(--tier-1)',
};

const TIER_ORDER = [
  'human-spaceflight',
  'deep-space',
  'orbital-launch',
  'satellite-operator',
  'emerging',
];

const TIER_LABELS = {
  'human-spaceflight': 'Human spaceflight',
  'deep-space': 'Deep space exploration',
  'orbital-launch': 'Orbital launch',
  'satellite-operator': 'Satellite & spacecraft',
  emerging: 'Emerging',
};

/** Capability keys in the order they are shown, with readable labels. */
const CAPABILITY_LABELS = {
  operatesSatellites: 'Operates satellites',
  buildsSatellites: 'Builds satellites',
  recoverablePayloads: 'Recoverable payloads',
  firstSpaceTraveler: 'Own astronaut flown',
  launchSite: 'Operates launch site',
  suborbitalLaunch: 'Suborbital launch',
  orbitalLaunch: 'Orbital launch',
  cryogenicEngine: 'Cryogenic engines',
  reusableSystems: 'Reusable systems',
  flyby: 'Flyby spacecraft',
  extraterrestrialOrbiter: 'Extraterrestrial orbiter',
  surfaceImpact: 'Controlled surface impact',
  softLanding: 'Uncrewed soft landing',
  rover: 'Uncrewed rover',
  sampleReturn: 'Sample return',
  crewedLaunch: 'Crewed launch',
  eva: 'Spacewalk (EVA)',
  rendezvousDocking: 'Rendezvous & docking',
  spaceStation: 'Space station',
  circumlunarFlight: 'Crewed circumlunar flight',
  moonLanding: 'Crewed Moon landing',
  crewedSuborbital: 'Crewed suborbital flight',
  cargoSpacecraft: 'Cargo spacecraft',
  propulsion: 'Rocket engines',
  spacecraftComponents: 'Spacecraft components',
  spaceManufacturing: 'In-space manufacturing',
  spaceMining: 'Space mining',
  researchCraft: 'Research & demo craft',
  spaceliner: 'Spaceliner operations',
};

const SECTOR_LABELS = { government: 'Agency', private: 'Company' };

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  agencies: [],
  sector: 'all',
  map: null,
  view: 'brief',
  dataset: null,
  changelog: null,
  compare: [],
  query: '',
  region: 'all',
  capability: 'all',
  tier: 'all',
  sort: 'name',
  selected: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** $25,400M → "$25.4B"; $312M → "$312M". */
function formatBudget(budget) {
  if (!budget?.usdMillions) return '—';
  const m = budget.usdMillions;
  if (m >= 1000) return `$${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}B`;
  if (m >= 1) return `$${number.format(Math.round(m))}M`;
  return `$${(m * 1000).toFixed(0)}k`;
}

/**
 * Companies carry no acronym, so their heading is already the full name.
 * Returns the secondary line only when it would say something new.
 */
function secondaryName(agency) {
  const heading = label(agency);
  return heading === agency.name ? null : agency.name;
}

/* ------------------------------------------------------------------ */
/* Filtering & sorting                                                 */
/* ------------------------------------------------------------------ */

function matchesQuery(agency, query) {
  if (!query) return true;
  const haystack = [
    agency.name,
    agency.acronym,
    agency.country,
    agency.headquarters,
    agency.region,
    agency.subregion,
    agency.tierLabel,
    SECTOR_LABELS[agency.orgType],
    agency.orgType === 'private' ? 'company private' : 'agency government',
    ...(agency.products ?? []).map((p) => p.name),
    agency.financials?.ticker,
    agency.federalContracts ? 'contractor' : null,
    agency.launchRecord ? 'launch record' : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  // Every whitespace-separated term must appear somewhere.
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function visibleAgencies() {
  const list = state.agencies.filter(
    (a) =>
      matchesQuery(a, state.query) &&
      (state.sector === 'all' || a.orgType === state.sector) &&
      (state.region === 'all' || a.region === state.region) &&
      (state.tier === 'all' || a.tier === state.tier) &&
      (state.capability === 'all' || a.capabilities[state.capability]?.has),
  );

  const byName = (a, b) => a.name.localeCompare(b.name);
  const sorters = {
    name: byName,
    tier: (a, b) => b.tierRank - a.tierRank || byName(a, b),
    budget: (a, b) =>
      (b.budget?.usdMillions ?? -1) - (a.budget?.usdMillions ?? -1) || byName(a, b),
    founded: (a, b) =>
      (a.foundedYear ?? Infinity) - (b.foundedYear ?? Infinity) || byName(a, b),
    'founded-desc': (a, b) =>
      (b.foundedYear ?? -Infinity) - (a.foundedYear ?? -Infinity) || byName(a, b),
    country: (a, b) => a.country.localeCompare(b.country) || byName(a, b),
    contracts: (a, b) =>
      (b.federalContracts?.usdTotal ?? -1) - (a.federalContracts?.usdTotal ?? -1) ||
      byName(a, b),
    launches: (a, b) =>
      (b.launchRecord?.totalLaunches ?? -1) - (a.launchRecord?.totalLaunches ?? -1) ||
      byName(a, b),
    spacecraft: (a, b) =>
      (b.spacecraftCount ?? -1) - (a.spacecraftCount ?? -1) || byName(a, b),
  };

  return list.sort(sorters[state.sort] ?? byName);
}

/* ------------------------------------------------------------------ */
/* Rendering — shared chrome                                           */
/* ------------------------------------------------------------------ */

function renderStats(dataset) {
  const c = dataset.counts;
  const stats = [
    ['Organisations', number.format(c.organisations)],
    ['Agencies', number.format(c.agencies)],
    ['Companies', number.format(c.companies)],
    ['Countries', number.format(c.countries)],
    ['Orbital launch', number.format(c.orbitalLaunch)],
    ['Fed. contracts', formatUsd(c.federalContractUsd)],
  ];

  $('#stat-strip').innerHTML = stats
    .map(
      ([label, value]) => `
      <div class="stat">
        <dt class="stat__label">${esc(label)}</dt>
        <dd class="stat__value" style="margin:0">${esc(value)}</dd>
      </div>`,
    )
    .join('');
}

function populateFilters() {
  const regions = [...new Set(state.agencies.map((a) => a.region))].sort();
  $('#filter-region').innerHTML = [
    '<option value="all">All regions</option>',
    ...regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`),
  ].join('');

  // Only offer capabilities that at least one agency actually demonstrates.
  const available = Object.keys(CAPABILITY_LABELS).filter((key) =>
    state.agencies.some((a) => a.capabilities[key]?.has),
  );
  $('#filter-capability').innerHTML = [
    '<option value="all">Any capability</option>',
    ...available.map(
      (key) => `<option value="${esc(key)}">${esc(CAPABILITY_LABELS[key])}</option>`,
    ),
  ].join('');

  const tiers = TIER_ORDER.filter((t) => state.agencies.some((a) => a.tier === t));
  $('#filter-tier').innerHTML = [
    '<option value="all">All tiers</option>',
    ...tiers.map((t) => `<option value="${esc(t)}">${esc(TIER_LABELS[t])}</option>`),
  ].join('');
}

function renderLegend() {
  $('#map-legend').innerHTML = TIER_ORDER.map(
    (tier) => `
      <li>
        <span class="legend__swatch" style="background:${tierColor(tier)}"></span>
        ${esc(TIER_LABELS[tier])}
      </li>`,
  )
    .concat(
      `<li><span class="legend__swatch" style="background:var(--map-empty)"></span>No organisation</li>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* Rendering — map                                                     */
/* ------------------------------------------------------------------ */

function buildMap() {
  const { width, height, shapes } = state.map;
  const svg = $('#world-map');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // One path per country; agency data is attached during update().
  svg.innerHTML = Object.entries(shapes)
    .map(
      ([iso3, d]) =>
        `<path class="map__country" data-iso3="${iso3}" d="${d}"></path>`,
    )
    .join('');
}

function updateMap(list) {
  const svg = $('#world-map');
  const byIso3 = new Map();
  // A country can host more than one agency — keep the most capable.
  for (const agency of list) {
    const held = byIso3.get(agency.iso3);
    if (!held || agency.tierRank > held.tierRank) byIso3.set(agency.iso3, agency);
  }

  const filtering = list.length !== state.agencies.length;
  svg.classList.toggle('map--filtered', filtering);

  for (const path of svg.children) {
    const agency = byIso3.get(path.dataset.iso3);
    if (agency) {
      path.style.fill = tierColor(agency.tier);
      path.classList.add('map__country--active', 'map__country--match');
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute(
        'aria-label',
        `${agency.country} — ${label(agency)}`,
      );
      continue;
    }

    // Not in the filtered set: keep it clickable if it has an agency at all.
    const anyAgency = state.agencies.find((a) => a.iso3 === path.dataset.iso3);
    path.style.fill = anyAgency ? tierColor(anyAgency.tier) : '';
    path.classList.toggle('map__country--active', Boolean(anyAgency));
    path.classList.remove('map__country--match');
    if (anyAgency) {
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `${anyAgency.country} — filtered out`);
    } else {
      path.removeAttribute('tabindex');
      path.removeAttribute('role');
      path.removeAttribute('aria-label');
    }
  }
}

function agenciesForIso3(iso3) {
  return state.agencies.filter((a) => a.iso3 === iso3);
}

function showTooltip(iso3, clientX, clientY) {
  const agencies = agenciesForIso3(iso3);
  if (!agencies.length) return hideTooltip();

  const tooltip = $('#map-tooltip');
  const frame = $('.map__frame').getBoundingClientRect();
  const [first] = agencies;

  tooltip.innerHTML = `
    <strong>${first.flag} ${esc(first.country)}</strong>
    ${agencies
      .map(
        (a) =>
          `<span>${esc(label(a))} · ${esc(a.tierLabel)}${
            a.foundedYear ? ` · ${a.foundedYear}` : ''
          }</span>`,
      )
      .join('<br>')}`;
  tooltip.hidden = false;
  tooltip.style.left = `${clientX - frame.left}px`;
  tooltip.style.top = `${clientY - frame.top}px`;
}

function hideTooltip() {
  $('#map-tooltip').hidden = true;
}

/* ------------------------------------------------------------------ */
/* Rendering — cards                                                   */
/* ------------------------------------------------------------------ */

function renderCards(list) {
  $('#card-grid').innerHTML = list
    .map(
      (a) => `
      <button class="card" data-id="${esc(a.id)}" type="button"
              style="--tier-color:${tierColor(a.tier)}">
        <div class="card__head">
          <span class="card__flag" aria-hidden="true">${a.flag || '🛰️'}</span>
          <div>
            <div class="card__acronym">${esc(label(a))}</div>
            <div class="card__country">${esc(a.country)}</div>
          </div>
          <span class="sector-chip sector-chip--${esc(a.orgType)}">${esc(
            SECTOR_LABELS[a.orgType] ?? '',
          )}</span>
        </div>
        ${secondaryName(a) ? `<p class="card__name">${esc(secondaryName(a))}</p>` : ''}
        <span class="tier-badge" style="--tier-color:${tierColor(a.tier)}">
          ${esc(a.tierLabel)}
        </span>
        <div class="card__facts">
          <span>${a.foundedYear ? `Est. ${a.foundedYear}` : 'Est. —'}</span>
          <span>${formatBudget(a.budget)}</span>
          ${a.employees ? `<span>${formatStaff(a.employees)} staff</span>` : ''}
          ${a.federalContracts ? `<span class="fact-contract">${formatUsd(a.federalContracts.usdTotal)} fed</span>` : ''}
          ${a.launchRecord ? `<span>${a.launchRecord.totalLaunches} launches</span>` : ''}
          ${
            !a.launchRecord && a.spacecraftCount
              ? `<span>${a.spacecraftCount} craft flown</span>`
              : ''
          }
          ${a.historical ? '<span class="is-historical">Defunct</span>' : ''}
        </div>
      </button>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* Rendering — table                                                   */
/* ------------------------------------------------------------------ */

function renderTable(list) {
  $('#data-table tbody').innerHTML = list
    .map(
      (a) => `
      <tr data-id="${esc(a.id)}" tabindex="0">
        <td>
          <div class="cell-agency">
            <strong>${esc(label(a))}</strong>
            ${secondaryName(a) ? `<span>${esc(secondaryName(a))}</span>` : ''}
          </div>
        </td>
        <td>${a.flag} ${esc(a.country)}</td>
        <td>${a.foundedYear ?? '—'}</td>
        <td class="num">${formatBudget(a.budget)}</td>
        <td class="num">${formatStaff(a.employees)}</td>
        <td>
          <span class="tier-badge" style="--tier-color:${tierColor(a.tier)}">
            ${esc(a.tierLabel)}
          </span>
        </td>
      </tr>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* Rendering — charts                                                  */
/* ------------------------------------------------------------------ */

function barRows(items, { max, value, label, tier }) {
  return items
    .map((item) => {
      const width = max > 0 ? Math.max((value(item) / max) * 100, 1.2) : 0;
      return `
        <div class="bar-row" data-id="${esc(item.id)}">
          <span class="bar-row__label">${item.flag} ${esc(
            item.acronym ?? item.name,
          )}</span>
          <span class="bar-row__track">
            <span class="bar-row__fill"
                  style="width:${width.toFixed(1)}%;--tier-color:${tierColor(
                    tier(item),
                  )}"></span>
          </span>
          <span class="bar-row__value">${esc(label(item))}</span>
        </div>`;
    })
    .join('');
}

function renderCharts(list) {
  const budgets = list
    .filter((a) => a.budget?.usdMillions)
    .sort((a, b) => b.budget.usdMillions - a.budget.usdMillions)
    .slice(0, 15);

  const staffed = list
    .filter((a) => a.employees)
    .sort((a, b) => b.employees - a.employees)
    .slice(0, 15);

  // Founding activity by decade.
  const decades = new Map();
  for (const a of list) {
    if (!a.foundedYear) continue;
    const decade = Math.floor(a.foundedYear / 10) * 10;
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
  }
  const sortedDecades = [...decades.entries()].sort((a, b) => a[0] - b[0]);
  const peak = Math.max(1, ...sortedDecades.map(([, n]) => n));

  // How widely each capability is held.
  const capCounts = Object.entries(CAPABILITY_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      count: list.filter((a) => a.capabilities[key]?.has).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const capMax = Math.max(1, ...capCounts.map((c) => c.count));

  $('#charts').innerHTML = `
    <section class="chart-card">
      <h2 class="chart-card__title">Annual budget</h2>
      <p class="chart-card__sub">Top ${budgets.length} by most recent reported figure (USD)</p>
      ${
        budgets.length
          ? barRows(budgets, {
              max: budgets[0].budget.usdMillions,
              value: (a) => a.budget.usdMillions,
              label: (a) =>
                `${formatBudget(a.budget)}${a.budget.year ? ` · ${a.budget.year}` : ''}`,
              tier: (a) => a.tier,
            })
          : '<p class="chart-card__sub">No budget data in this selection.</p>'
      }
    </section>

    <section class="chart-card">
      <h2 class="chart-card__title">Workforce</h2>
      <p class="chart-card__sub">
        Top ${staffed.length} by reported headcount. Diversified manufacturers
        (Airbus, Boeing, Toyota) report company-wide totals, not space staff.
      </p>
      ${
        staffed.length
          ? barRows(staffed, {
              max: staffed[0].employees,
              value: (a) => a.employees,
              label: (a) => `${number.format(a.employees)}`,
              tier: (a) => a.tier,
            })
          : '<p class="chart-card__sub">No workforce data in this selection.</p>'
      }
    </section>

    <section class="chart-card chart-card--wide">
      <h2 class="chart-card__title">When agencies were founded</h2>
      <p class="chart-card__sub">Agencies established per decade</p>
      <div class="histogram">
        ${sortedDecades
          .map(
            ([decade, count]) => `
            <div class="histogram__col" title="${count} founded in the ${decade}s">
              <span class="histogram__count">${count}</span>
              <span class="histogram__bar" style="height:${(count / peak) * 100}%"></span>
              <span class="histogram__label">${decade}s</span>
            </div>`,
          )
          .join('')}
      </div>
    </section>

    <section class="chart-card chart-card--wide">
      <h2 class="chart-card__title">Capability adoption</h2>
      <p class="chart-card__sub">How many of these ${list.length} agencies have demonstrated each milestone</p>
      <ul class="cap-list">
        ${capCounts
          .map(
            (c) => `
            <li class="cap-list__row">
              <span class="cap-list__name">${esc(c.label)}</span>
              <span class="bar-row__track">
                <span class="bar-row__fill" style="width:${(c.count / capMax) * 100}%"></span>
              </span>
              <span class="bar-row__value">${c.count}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Rendering — detail drawer                                           */
/* ------------------------------------------------------------------ */

function capabilityGroups(agency) {
  const groups = [
    ['Core', ['operatesSatellites', 'buildsSatellites', 'recoverablePayloads', 'firstSpaceTraveler']],
    ['Launch', ['launchSite', 'suborbitalLaunch', 'orbitalLaunch', 'cryogenicEngine', 'reusableSystems']],
    ['Exploration', ['flyby', 'extraterrestrialOrbiter', 'surfaceImpact', 'softLanding', 'rover', 'sampleReturn']],
    ['Human spaceflight', ['crewedLaunch', 'eva', 'rendezvousDocking', 'spaceStation', 'circumlunarFlight', 'moonLanding']],
  ];

  return groups
    .map(([title, keys]) => {
      const present = keys.filter((key) => agency.capabilities[key]);
      if (!present.length) return '';
      return `
        <h3 class="detail__section-title">${esc(title)}</h3>
        <ul class="cap-grid">
          ${present
            .map((key) => {
              const cap = agency.capabilities[key];
              return `
                <li class="cap ${cap.has ? '' : 'cap--no'}">
                  <span class="cap__mark">${cap.has ? '✓' : '·'}</span>
                  <span>${esc(CAPABILITY_LABELS[key])}</span>
                  ${cap.detail ? `<span class="cap__detail">${esc(cap.detail)}</span>` : ''}
                </li>`;
            })
            .join('')}
        </ul>`;
    })
    .join('');
}

/**
 * Hard numbers from the government and financial sources: federal contract
 * awards, filed financials, and flight record. These are what separate this
 * from a directory listing, so they sit above the capability breakdown.
 */
function evidenceSections(agency) {
  const blocks = [];

  if (agency.launchRecord) {
    const l = agency.launchRecord;
    blocks.push(`
      <h3 class="detail__section-title">Flight record</h3>
      <dl class="facts">
        <div class="fact"><dt class="fact__label">Launches</dt>
          <dd class="fact__value" style="margin:0">${l.totalLaunches}</dd></div>
        <div class="fact"><dt class="fact__label">Success rate</dt>
          <dd class="fact__value" style="margin:0">${l.successRate}%</dd></div>
        <div class="fact"><dt class="fact__label">Failures</dt>
          <dd class="fact__value" style="margin:0">${l.failed}</dd></div>
        ${
          l.landings.attempted
            ? `<div class="fact"><dt class="fact__label">Landings</dt>
                 <dd class="fact__value" style="margin:0">${l.landings.successful}/${l.landings.attempted}</dd></div>`
            : ''
        }
      </dl>`);
  }

  if (agency.federalContracts) {
    const c = agency.federalContracts;
    blocks.push(`
      <h3 class="detail__section-title">US federal contracts</h3>
      <dl class="facts">
        <div class="fact"><dt class="fact__label">Awarded</dt>
          <dd class="fact__value" style="margin:0">${formatUsd(c.usdTotal)}</dd></div>
        <div class="fact"><dt class="fact__label">Since</dt>
          <dd class="fact__value" style="margin:0">${esc(c.window?.startDate?.slice(0, 4) ?? '—')}</dd></div>
      </dl>
      <p class="chart-card__sub">Recipient of record: ${esc(c.recipientName)}</p>`);
  }

  if (agency.financials) {
    const f = agency.financials;
    blocks.push(`
      <h3 class="detail__section-title">Filed financials</h3>
      <dl class="facts">
        <div class="fact"><dt class="fact__label">Ticker</dt>
          <dd class="fact__value" style="margin:0">${esc(f.ticker)}</dd></div>
        ${
          f.revenue
            ? `<div class="fact"><dt class="fact__label">Revenue</dt>
                 <dd class="fact__value" style="margin:0">${formatUsd(f.revenue.usd)}</dd></div>
               <div class="fact"><dt class="fact__label">Fiscal year</dt>
                 <dd class="fact__value" style="margin:0">${esc(f.revenue.fiscalYear ?? '—')}</dd></div>`
            : ''
        }
      </dl>
      <p class="chart-card__sub">SEC registrant: ${esc(f.registrant)} · CIK ${esc(f.cik)}</p>`);
  }

  return blocks.join('');
}

/** The dossier's open-source-intelligence sections. */
function dossierSections(agency) {
  const blocks = [];

  if (agency.news?.length) {
    blocks.push(`
      <h3 class="detail__section-title">In the news</h3>
      <ul class="wire wire--compact">
        ${agency.news
          .slice(0, 6)
          .map(
            (n) => `
          <li class="wire__item">
            <a class="wire__headline" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>
            <div class="wire__meta">
              <span class="wire__source">${esc(n.source)}</span>
              <span>${esc(timeAgo(n.published))}</span>
            </div>
          </li>`,
          )
          .join('')}
      </ul>`);
  }

  if (agency.recentAwards?.length) {
    blocks.push(`
      <h3 class="detail__section-title">Recent contract actions</h3>
      <ul class="ledger">
        ${agency.recentAwards
          .map(
            (a) => `
          <li class="ledger__row">
            <span class="ledger__amount">${esc(formatUsd(a.amount))}</span>
            <span class="ledger__body">
              ${a.agency ? `<strong>${esc(a.agency)}</strong>` : ''}
              ${a.description ? `<span class="ledger__desc">${esc(a.description)}</span>` : ''}
            </span>
          </li>`,
          )
          .join('')}
      </ul>`);
  }

  if (agency.recentFilings?.length) {
    blocks.push(`
      <h3 class="detail__section-title">SEC filings</h3>
      <ul class="ledger">
        ${agency.recentFilings
          .map(
            (f) => `
          <li class="ledger__row">
            <span class="ledger__form">${esc(f.form)}</span>
            <span class="ledger__body">
              <span class="ledger__agency">${esc(f.filed ?? '')}${
                f.description ? ` · ${esc(f.description)}` : ''
              }</span>
            </span>
            ${
              f.url
                ? `<a class="ledger__link" href="${esc(f.url)}" target="_blank" rel="noopener">open</a>`
                : ''
            }
          </li>`,
          )
          .join('')}
      </ul>`);
  }

  if (agency.imagery?.length) {
    blocks.push(`
      <h3 class="detail__section-title">Imagery</h3>
      <div class="shots shots--compact">
        ${agency.imagery
          .slice(0, 6)
          .map(
            (i) => `
          <a class="shot" href="${esc(i.url ?? '#')}" target="_blank" rel="noopener" title="${esc(i.title)}">
            <img src="${esc(i.thumbnail)}" alt="${esc(i.title)}" loading="lazy">
          </a>`,
          )
          .join('')}
      </div>`);
  }

  return blocks.join('');
}

/** Vehicles and products, for private companies (the agency page has none). */
function productList(agency) {
  const products = agency.products ?? [];
  if (!products.length) return '';
  return `
    <h3 class="detail__section-title">Vehicles &amp; products</h3>
    <ul class="cap-grid">
      ${products
        .map(
          (p) => `
          <li class="cap ${p.demonstrated ? '' : 'cap--no'}">
            <span class="cap__mark">${p.demonstrated ? '✓' : '·'}</span>
            <span>${esc(p.name)}</span>
            <span class="cap__detail">${esc(p.status ?? p.type ?? '')}</span>
          </li>`,
        )
        .join('')}
    </ul>`;
}

function openDetail(id) {
  const agency = state.agencies.find((a) => a.id === id);
  if (!agency) return;

  state.selected = id;
  const facts = [
    ['Founded', agency.foundedYear ?? '—'],
    ...(agency.spacecraftCount ? [['Craft flown', agency.spacecraftCount]] : []),
    ['Budget', formatBudget(agency.budget)],
    ['Staff', formatStaff(agency.employees)],
    ['Headquarters', agency.headquarters ?? '—'],
    ['Region', agency.subregion || agency.region],
    ['Tier', agency.tierLabel],
  ];

  $('#detail-body').innerHTML = `
    <div class="detail__head">
      <span class="detail__flag" aria-hidden="true">${agency.flag || '🛰️'}</span>
      <div>
        <h2 class="detail__title" id="detail-title">${esc(
          label(agency),
        )}</h2>
        <p class="detail__subtitle">
          ${secondaryName(agency) ? `${esc(secondaryName(agency))} · ` : ''}${esc(agency.country)}
          <span class="sector-chip sector-chip--${esc(agency.orgType)}">${esc(
            SECTOR_LABELS[agency.orgType] ?? '',
          )}</span>
          ${agency.historical ? '<span class="is-historical">· Defunct</span>' : ''}
        </p>
      </div>
    </div>

    ${
      agency.thumbnail
        ? `<img class="detail__thumb" src="${esc(agency.thumbnail)}" alt="" loading="lazy">`
        : ''
    }
    ${agency.summary ? `<p class="detail__summary">${esc(agency.summary)}</p>` : ''}

    <dl class="facts">
      ${facts
        .map(
          ([label, value]) => `
          <div class="fact">
            <dt class="fact__label">${esc(label)}</dt>
            <dd class="fact__value" style="margin:0">${esc(value)}</dd>
          </div>`,
        )
        .join('')}
    </dl>

    ${evidenceSections(agency)}
    ${dossierSections(agency)}
    ${capabilityGroups(agency)}
    ${productList(agency)}

    <div class="detail__links">
      ${
        agency.website
          ? `<a class="ghost-button" href="${esc(
              agency.website,
            )}" target="_blank" rel="noopener">Official site ↗</a>`
          : ''
      }
      ${
        agency.wikipedia
          ? `<a class="ghost-button" href="${esc(
              agency.wikipedia,
            )}" target="_blank" rel="noopener">Wikipedia ↗</a>`
          : ''
      }
    </div>`;

  $('#detail').hidden = false;
  $('#detail-scrim').hidden = false;
  $('#detail-close').focus();
  history.replaceState(null, '', `#${agency.id}`);
}

function closeDetail() {
  state.selected = null;
  $('#detail').hidden = true;
  $('#detail-scrim').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
}

/* ------------------------------------------------------------------ */
/* View switching                                                      */
/* ------------------------------------------------------------------ */

function setView(view) {
  state.view = view;
  for (const panel of $$('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== view;
  }
  for (const btn of $$('.view-switch__btn')) {
    btn.setAttribute('aria-selected', String(btn.dataset.view === view));
  }
  render();
}

/** Re-renders whichever view is active, plus the shared result count. */
function render() {
  const list = visibleAgencies();

  $('#result-count').textContent =
    list.length === state.agencies.length
      ? `${list.length} organisations across ${new Set(list.map((a) => a.iso3)).size} countries`
      : `${list.length} of ${state.agencies.length} organisations`;

  // The API and feed views do not depend on the filtered list.
  const listDriven = !['api', 'feed'].includes(state.view);
  const isEmpty = list.length === 0 && listDriven;
  $('#empty-state').hidden = !isEmpty;
  $(`#panel-${state.view}`).hidden = isEmpty && state.view !== 'map';

  if (state.view === 'map') updateMap(list);
  else if (state.view === 'grid') renderCards(list);
  else if (state.view === 'table') renderTable(list);
  else if (state.view === 'charts') renderCharts(list);
  else if (state.view === 'brief') $('#brief').innerHTML = renderBrief(state.dataset, list);
  else if (state.view === 'compare') $('#compare').innerHTML = renderCompare(list, state.compare);
  else if (state.view === 'feed') $('#feed').innerHTML = renderFeed(state.changelog);
  else if (state.view === 'api') {
    $('#api-docs').innerHTML = renderApi(state.dataset, sampleRecord());
  }
}

/** A small, real record for the API documentation. */
function sampleRecord() {
  const org =
    state.agencies.find((o) => o.name === 'Rocket Lab') ??
    state.agencies.find((o) => o.federalContracts) ??
    state.agencies[0];
  if (!org) return {};
  const keep = [
    'id', 'name', 'country', 'iso3', 'orgType', 'foundedYear',
    'website', 'tier', 'spacecraftCount', 'federalContracts', 'provenance',
  ];
  return Object.fromEntries(
    keep.filter((k) => org[k] !== undefined).map((k) => [k, org[k]]),
  );
}

/** Scrolling headline strip under the masthead. */
function renderTicker(dataset) {
  const items = (dataset.news ?? []).slice(0, 30);
  if (!items.length) return;
  const markup = items
    .map(
      (item) =>
        `<a class="ticker__item" href="${esc(item.link)}" target="_blank" rel="noopener">
           <span class="ticker__src">${esc(item.source)}</span>${esc(item.title)}
         </a>`,
    )
    .join('');
  // Duplicated so the marquee can loop without a visible seam.
  $('#ticker').innerHTML = markup + markup;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Delays a handler until input settles — avoids re-rendering per keystroke. */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function wireEvents() {
  $('#search').addEventListener(
    'input',
    debounce((event) => {
      state.query = event.target.value.trim();
      render();
    }, 140),
  );

  for (const [id, key] of [
    ['#filter-sector', 'sector'],
    ['#filter-region', 'region'],
    ['#filter-capability', 'capability'],
    ['#filter-tier', 'tier'],
    ['#sort', 'sort'],
  ]) {
    $(id).addEventListener('change', (event) => {
      state[key] = event.target.value;
      render();
    });
  }

  $('#reset-filters').addEventListener('click', () => {
    Object.assign(state, {
      query: '',
      sector: 'all',
      region: 'all',
      capability: 'all',
      tier: 'all',
      sort: 'name',
    });
    $('#search').value = '';
    $('#filter-sector').value = 'all';
    $('#filter-region').value = 'all';
    $('#filter-capability').value = 'all';
    $('#filter-tier').value = 'all';
    $('#sort').value = 'name';
    render();
  });

  for (const btn of $$('.view-switch__btn')) {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  }

  // Map interaction.
  const svg = $('#world-map');
  svg.addEventListener('mousemove', (event) => {
    const path = event.target.closest('.map__country--active');
    if (path) showTooltip(path.dataset.iso3, event.clientX, event.clientY);
    else hideTooltip();
  });
  svg.addEventListener('mouseleave', hideTooltip);
  svg.addEventListener('click', (event) => {
    const path = event.target.closest('.map__country--active');
    if (!path) return;
    const [agency] = agenciesForIso3(path.dataset.iso3);
    if (agency) openDetail(agency.id);
  });
  svg.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const path = event.target.closest('.map__country--active');
    if (!path) return;
    event.preventDefault();
    const [agency] = agenciesForIso3(path.dataset.iso3);
    if (agency) openDetail(agency.id);
  });

  // Cards, table rows and chart bars all open the detail drawer.
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-remove], #compare-clear')) return;
    const target = event.target.closest('[data-id]');
    if (target && !event.target.closest('a')) openDetail(target.dataset.id);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const row = event.target.closest('tr[data-id]');
    if (row) openDetail(row.dataset.id);
  });

  // Compare view: add, remove and clear the selection.
  document.addEventListener('change', (event) => {
    if (event.target.id !== 'compare-add') return;
    const id = event.target.value;
    if (id && !state.compare.includes(id) && state.compare.length < 4) {
      state.compare.push(id);
    }
    render();
  });
  document.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      state.compare = state.compare.filter((id) => id !== remove.dataset.remove);
      render();
      return;
    }
    if (event.target.id === 'compare-clear') {
      state.compare = [];
      render();
    }
  });

  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-scrim').addEventListener('click', closeDetail);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.selected) closeDetail();
    // "/" focuses search, unless the user is already typing somewhere.
    if (
      event.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    ) {
      event.preventDefault();
      $('#search').focus();
    }
  });

  // Theme.
  $('#theme-toggle').addEventListener('click', () => {
    const next =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('atlas-theme', next);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('[data-theme-icon]').textContent = theme === 'dark' ? '☾' : '☀';
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  const stored = localStorage.getItem('atlas-theme');
  const prefersLight = matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(stored ?? (prefersLight ? 'light' : 'dark'));

  try {
    const [dataset, map, changelog] = await Promise.all([
      fetch('data/organisations.json').then((r) => {
        if (!r.ok) throw new Error(`organisations.json — HTTP ${r.status}`);
        return r.json();
      }),
      fetch('data/world-map.json').then((r) => {
        if (!r.ok) throw new Error(`world-map.json — HTTP ${r.status}`);
        return r.json();
      }),
      // The feed is a nicety; a missing changelog must not block the console.
      fetch('data/changelog.json')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    state.agencies = dataset.organisations;
    state.dataset = dataset;
    state.changelog = changelog;
    state.map = map;

    renderStats(dataset);
    populateFilters();
    renderLegend();
    buildMap();
    renderTicker(dataset);
    wireEvents();
    setView('brief');

    const generated = new Date(dataset.generatedAt);
    $('#footer-meta').textContent = `Dataset generated ${generated.toLocaleDateString(
      'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' },
    )} · ${dataset.organisations.length} organisations`;

    // Deep link: #nasa opens that agency.
    const hash = location.hash.slice(1);
    if (hash) openDetail(hash);
  } catch (error) {
    $('#main').insertAdjacentHTML(
      'afterbegin',
      `<p class="empty-state">Could not load the dataset (${esc(
        error.message,
      )}). If you are opening this file directly, run a local server instead: <code>python3 -m http.server</code></p>`,
    );
  }
}

init();
