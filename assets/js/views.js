/**
 * The console views: intelligence brief, head-to-head compare, change feed and
 * API explorer.
 *
 * Split out of app.js because these are self-contained renderers — each takes
 * the filtered list plus the dataset and returns markup. Interaction is wired
 * by app.js through delegated events.
 */

import {
  esc,
  formatUsd,
  formatStaff,
  tierColor,
  timeAgo,
  number, label } from './format.js';

/* ------------------------------------------------------------------ */
/* Intelligence brief                                                  */
/* ------------------------------------------------------------------ */

function newsPanel(dataset, list) {
  const ids = new Set(list.map((o) => o.id));
  // Prefer headlines that mention something in the current filter.
  const items = (dataset.news ?? [])
    .map((item) => ({
      ...item,
      hits: (item.organisations ?? []).filter((id) => ids.has(id)),
    }))
    .sort((a, b) => b.hits.length - a.hits.length || 0)
    .slice(0, 14);

  if (!items.length) return '';

  const byId = new Map(list.map((o) => [o.id, o]));
  return `
    <section class="brief-card brief-card--tall">
      <h2 class="brief-card__title">Latest intelligence</h2>
      <ul class="wire">
        ${items
          .map(
            (item) => `
          <li class="wire__item">
            <a class="wire__headline" href="${esc(item.link)}" target="_blank" rel="noopener">
              ${esc(item.title)}
            </a>
            <div class="wire__meta">
              <span class="wire__source">${esc(item.source)}</span>
              <span>${esc(timeAgo(item.published))}</span>
              ${item.hits
                .slice(0, 3)
                .map(
                  (id) =>
                    `<button class="wire__tag" data-id="${esc(id)}">${esc(
                      byId.get(id) ? label(byId.get(id)) : id,
                    )}</button>`,
                )
                .join('')}
            </div>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function awardsPanel(list) {
  const awards = list
    .filter((o) => o.recentAwards?.length)
    .flatMap((o) => o.recentAwards.map((a) => ({ ...a, org: o })))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  if (!awards.length) return '';
  return `
    <section class="brief-card">
      <h2 class="brief-card__title">Recent contract actions</h2>
      <p class="chart-card__sub">
        US federal awards under space and defence-aerospace procurement codes.
        Some primes' largest actions are missile rather than space programmes.
      </p>
      <ul class="ledger">
        ${awards
          .map(
            (a) => `
          <li class="ledger__row" data-id="${esc(a.org.id)}">
            <span class="ledger__amount">${esc(formatUsd(a.amount))}</span>
            <span class="ledger__body">
              <strong>${esc(label(a.org))}</strong>
              ${a.agency ? `<span class="ledger__agency">${esc(a.agency)}</span>` : ''}
              ${a.description ? `<span class="ledger__desc">${esc(a.description)}</span>` : ''}
            </span>
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function filingsPanel(list) {
  const filings = list
    .filter((o) => o.recentFilings?.length)
    .flatMap((o) => o.recentFilings.map((f) => ({ ...f, org: o })))
    .sort((a, b) => String(b.filed ?? '').localeCompare(String(a.filed ?? '')))
    .slice(0, 12);

  if (!filings.length) return '';
  return `
    <section class="brief-card">
      <h2 class="brief-card__title">Regulatory filings</h2>
      <ul class="ledger">
        ${filings
          .map(
            (f) => `
          <li class="ledger__row" data-id="${esc(f.org.id)}">
            <span class="ledger__form">${esc(f.form)}</span>
            <span class="ledger__body">
              <strong>${esc(label(f.org))}</strong>
              <span class="ledger__agency">${esc(f.filed ?? '')}</span>
            </span>
            ${
              f.url
                ? `<a class="ledger__link" href="${esc(f.url)}" target="_blank" rel="noopener">open</a>`
                : ''
            }
          </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function imageryPanel(list) {
  const shots = list
    .filter((o) => o.imagery?.length)
    .flatMap((o) => o.imagery.slice(0, 2).map((i) => ({ ...i, org: o })))
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')))
    .slice(0, 12);

  if (!shots.length) return '';
  return `
    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Imagery</h2>
      <div class="shots">
        ${shots
          .map(
            (s) => `
          <a class="shot" href="${esc(s.url ?? '#')}" target="_blank" rel="noopener"
             title="${esc(s.title)}">
            <img src="${esc(s.thumbnail)}" alt="${esc(s.title)}" loading="lazy">
            <span class="shot__caption">
              <strong>${esc(label(s.org))}</strong>
              ${esc(String(s.created ?? '').slice(0, 4))}
            </span>
          </a>`,
          )
          .join('')}
      </div>
    </section>`;
}

function activityPanel(list) {
  const flying = list
    .filter((o) => o.launchRecord)
    .sort((a, b) => b.launchRecord.totalLaunches - a.launchRecord.totalLaunches)
    .slice(0, 10);
  if (!flying.length) return '';

  return `
    <section class="brief-card">
      <h2 class="brief-card__title">Flight activity</h2>
      <ul class="ledger">
        ${flying
          .map((o) => {
            const l = o.launchRecord;
            return `
          <li class="ledger__row" data-id="${esc(o.id)}">
            <span class="ledger__amount">${number.format(l.totalLaunches)}</span>
            <span class="ledger__body">
              <strong>${esc(label(o))}</strong>
              <span class="ledger__agency">${l.successRate}% success · ${l.failed} failed${
                l.pending ? ` · ${l.pending} upcoming` : ''
              }</span>
            </span>
          </li>`;
          })
          .join('')}
      </ul>
    </section>`;
}

export function renderBrief(dataset, list) {
  const panels = [
    newsPanel(dataset, list),
    awardsPanel(list),
    activityPanel(list),
    filingsPanel(list),
    imageryPanel(list),
  ].filter(Boolean);

  return panels.length
    ? panels.join('')
    : '<p class="empty-state">No intelligence for this selection.</p>';
}

/* ------------------------------------------------------------------ */
/* Head-to-head compare                                                */
/* ------------------------------------------------------------------ */

/** Rows shown in the comparison grid, in order. */
const COMPARE_ROWS = [
  { label: 'Sector', get: (o) => (o.orgType === 'private' ? 'Company' : 'Agency') },
  { label: 'Country', get: (o) => `${o.flag} ${o.country}` },
  { label: 'Founded', get: (o) => o.foundedYear ?? '—' },
  { label: 'Capability tier', get: (o) => o.tierLabel },
  { label: 'Headquarters', get: (o) => o.headquarters ?? '—' },
  { label: 'Staff', get: (o) => formatStaff(o.employees) },
  { label: 'Budget', get: (o) => (o.budget ? formatUsd(o.budget.usdMillions * 1e6) : '—') },
  { label: 'Revenue', get: (o) => (o.financials?.revenue ? formatUsd(o.financials.revenue.usd) : '—') },
  { label: 'Federal contracts', get: (o) => (o.federalContracts ? formatUsd(o.federalContracts.usdTotal) : '—') },
  { label: 'Launches', get: (o) => (o.launchRecord ? number.format(o.launchRecord.totalLaunches) : '—') },
  { label: 'Success rate', get: (o) => (o.launchRecord ? `${o.launchRecord.successRate}%` : '—') },
  { label: 'Spacecraft flown', get: (o) => o.spacecraftCount ?? '—' },
  { label: 'Recent filings', get: (o) => o.recentFilings?.length ?? 0 },
  { label: 'In the news', get: (o) => o.news?.length ?? 0 },
];

export function renderCompare(list, selectedIds) {
  const selected = selectedIds
    .map((id) => list.find((o) => o.id === id))
    .filter(Boolean);

  const picker = `
    <div class="compare__picker">
      <label class="field">
        <span class="field__label">Add organisation</span>
        <select id="compare-add" class="field__control">
          <option value="">Select…</option>
          ${list
            .slice()
            .sort((a, b) => (label(a)).localeCompare(b.acronym ?? b.name))
            .map(
              (o) =>
                `<option value="${esc(o.id)}">${esc(label(o))} — ${esc(o.country)}</option>`,
            )
            .join('')}
        </select>
      </label>
      ${
        selected.length
          ? `<button class="ghost-button" id="compare-clear" type="button">Clear</button>`
          : ''
      }
    </div>`;

  if (!selected.length) {
    return `${picker}
      <p class="empty-state">
        Pick up to four organisations to compare side by side.
      </p>`;
  }

  return `${picker}
    <div class="table-wrap">
      <table class="data-table compare__table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            ${selected
              .map(
                (o) => `
              <th scope="col">
                <span class="compare__head" style="--tier-color:${tierColor(o.tier)}">
                  ${o.flag} ${esc(label(o))}
                  <button class="compare__remove" data-remove="${esc(o.id)}"
                          aria-label="Remove ${esc(o.name)}">✕</button>
                </span>
              </th>`,
              )
              .join('')}
          </tr>
        </thead>
        <tbody>
          ${COMPARE_ROWS.map(
            (row) => `
            <tr>
              <th scope="row" class="compare__label">${esc(row.label)}</th>
              ${selected
                .map((o) => `<td>${esc(String(row.get(o) ?? '—'))}</td>`)
                .join('')}
            </tr>`,
          ).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Change feed                                                         */
/* ------------------------------------------------------------------ */

export function renderFeed(changelog) {
  const revisions = changelog?.revisions ?? [];
  if (!revisions.length) {
    return `<p class="empty-state">
      No dataset revisions recorded yet. The feed fills in as the weekly
      refresh commits changes.
    </p>`;
  }

  return revisions
    .map(
      (rev) => `
    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">
        ${esc(new Date(rev.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }))}
        <span class="feed__hash">${esc(rev.hash)}</span>
      </h2>
      <p class="chart-card__sub">${esc(rev.subject)} · ${number.format(rev.total)} organisations</p>

      ${
        rev.changes.length
          ? `<ul class="ledger">
              ${rev.changes
                .slice(0, 12)
                .map(
                  (c) => `
                <li class="ledger__row" data-id="${esc(c.id)}">
                  <span class="ledger__amount ${c.delta > 0 ? 'is-up' : 'is-down'}">
                    ${c.delta > 0 ? '+' : ''}${esc(
                      c.money ? formatUsd(Math.abs(c.delta)) : number.format(c.delta),
                    )}
                  </span>
                  <span class="ledger__body">
                    <strong>${esc(c.name)}</strong>
                    <span class="ledger__agency">${esc(c.metric)}: ${esc(
                      c.money ? formatUsd(c.from) : number.format(c.from),
                    )} → ${esc(c.money ? formatUsd(c.to) : number.format(c.to))}</span>
                  </span>
                </li>`,
                )
                .join('')}
            </ul>`
          : ''
      }

      ${
        rev.added.length
          ? `<h3 class="detail__section-title">Added — ${rev.added.length}</h3>
             <p class="feed__names">${rev.added
               .slice(0, 40)
               .map((a) => `<button data-id="${esc(a.id)}">${esc(a.name)}</button>`)
               .join('')}</p>`
          : ''
      }
      ${
        rev.removed.length
          ? `<h3 class="detail__section-title">Removed — ${rev.removed.length}</h3>
             <p class="feed__names">${rev.removed
               .slice(0, 20)
               .map((r) => `<span>${esc(r.name)}</span>`)
               .join('')}</p>`
          : ''
      }
    </section>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ */
/* API explorer                                                        */
/* ------------------------------------------------------------------ */

export function renderApi(dataset, sample) {
  const licenses = Object.entries(dataset.licenses ?? {});
  const open = licenses.filter(([, m]) => m.redistributable);
  const restricted = licenses.filter(([, m]) => !m.redistributable);

  const base = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '/')}`;

  return `
    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Data access</h2>
      <p class="chart-card__sub">
        Static JSON over HTTPS. No key, no rate limit, CORS-open — fetch it
        directly from a browser or a server.
      </p>

      <div class="api-endpoints">
        <div class="api-endpoint">
          <div class="api-endpoint__head">
            <code>data/organisations.open.json</code>
            <span class="sector-chip sector-chip--government">Redistributable</span>
          </div>
          <p>
            ${number.format(dataset.counts?.organisations ?? 0)} organisations, every field
            drawn from a CC0 or US public-domain source. Commercial use,
            resale and sublicensing permitted; no attribution required.
          </p>
          <a class="ghost-button" href="data/organisations.open.json" target="_blank" rel="noopener">Fetch ↗</a>
        </div>

        <div class="api-endpoint">
          <div class="api-endpoint__head">
            <code>data/organisations.json</code>
            <span class="sector-chip sector-chip--private">Attribution + share-alike</span>
          </div>
          <p>
            The full record, including Wikipedia prose, capability tables,
            launch statistics and press. Contains CC BY-SA material — see
            <a href="LICENSING.md">LICENSING.md</a> before redistributing.
          </p>
          <a class="ghost-button" href="data/organisations.json" target="_blank" rel="noopener">Fetch ↗</a>
        </div>

        <div class="api-endpoint">
          <div class="api-endpoint__head"><code>data/changelog.json</code></div>
          <p>What changed between dataset revisions.</p>
          <a class="ghost-button" href="data/changelog.json" target="_blank" rel="noopener">Fetch ↗</a>
        </div>
      </div>
    </section>

    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Every field carries its source</h2>
      <p class="chart-card__sub">
        Each record has a <code>provenance</code> map of field → source, and
        each source declares whether it may be redistributed. The open tier is
        produced by deleting every field that fails that test, and the build
        rejects itself if one slips through.
      </p>
      <pre class="api-sample"><code>${esc(JSON.stringify(sample, null, 2))}</code></pre>
    </section>

    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Sources and terms</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Source</th><th>Licence</th><th>Attribution</th><th>In open tier</th></tr>
          </thead>
          <tbody>
            ${[...open, ...restricted]
              .map(
                ([key, meta]) => `
              <tr>
                <td><strong>${esc(meta.name)}</strong></td>
                <td>${esc(meta.license)}</td>
                <td>${meta.attributionRequired ? 'Required' : 'Not required'}</td>
                <td>${
                  meta.redistributable
                    ? '<span class="cap__mark">✓</span> yes'
                    : '<span class="is-historical">no</span>'
                }</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Try it</h2>
      <pre class="api-sample"><code>curl -s ${esc(base)}data/organisations.open.json \\
  | jq '.organisations[] | select(.federalContracts) | {name, usd: .federalContracts.usdTotal}' \\
  | head -40</code></pre>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Country profile                                                     */
/* ------------------------------------------------------------------ */

/** Capabilities worth calling out at national level, most significant first. */
const NATIONAL_MILESTONES = [
  ['crewedLaunch', 'Crewed launch'],
  ['orbitalLaunch', 'Orbital launch'],
  ['softLanding', 'Soft landing'],
  ['rover', 'Rover'],
  ['sampleReturn', 'Sample return'],
  ['spaceStation', 'Space station'],
  ['reusableSystems', 'Reusable systems'],
  ['launchSite', 'Launch site'],
  ['buildsSatellites', 'Builds satellites'],
];

/** Aggregates a country's organisations into one national picture. */
export function summariseCountry(orgs) {
  const sum = (fn) => orgs.reduce((total, o) => total + (fn(o) ?? 0), 0);

  const launches = orgs.filter((o) => o.launchRecord);
  const successful = sum((o) => o.launchRecord?.successful);
  const failed = sum((o) => o.launchRecord?.failed);

  const milestones = NATIONAL_MILESTONES.map(([key, name]) => {
    const holders = orgs.filter((o) => o.capabilities?.[key]?.has);
    if (!holders.length) return null;
    // Rank by demonstrated activity rather than array order. Picking the first
    // match credited Boeing with US crewed launch and Astra with orbital
    // launch, because they sort earlier than NASA — true that they hold the
    // capability, wrong as a national headline.
    const ranked = holders.slice().sort(
      (a, b) =>
        (b.launchRecord?.totalLaunches ?? 0) - (a.launchRecord?.totalLaunches ?? 0) ||
        (b.spacecraftCount ?? 0) - (a.spacecraftCount ?? 0) ||
        b.tierRank - a.tierRank,
    );
    return {
      label: name,
      by: ranked[0].name,
      detail: ranked[0].capabilities[key]?.detail,
      count: holders.length,
    };
  }).filter(Boolean);

  const years = orgs.map((o) => o.foundedYear).filter(Boolean);

  return {
    total: orgs.length,
    agencies: orgs.filter((o) => o.orgType === 'government').length,
    companies: orgs.filter((o) => o.orgType === 'private').length,
    contracts: sum((o) => o.federalContracts?.usdTotal),
    withContracts: orgs.filter((o) => o.federalContracts).length,
    revenue: sum((o) => o.financials?.revenue?.usd),
    staff: sum((o) => o.employees),
    spacecraft: sum((o) => o.spacecraftCount),
    launchTotal: successful + failed,
    successRate: successful + failed ? Math.round((successful / (successful + failed)) * 1000) / 10 : null,
    launchOrgs: launches.length,
    milestones,
    firstFounded: years.length ? Math.min(...years) : null,
    topTier: orgs.reduce((best, o) => (o.tierRank > (best?.tierRank ?? 0) ? o : best), null),
  };
}

export function renderCountry(iso3, allOrgs, dataset) {
  const orgs = allOrgs.filter((o) => o.iso3 === iso3);
  if (!orgs.length) {
    return `<p class="empty-state">No organisations recorded for this country.</p>`;
  }

  const s = summariseCountry(orgs);
  const [first] = orgs;

  // Rank by evidence held, so the significant players surface first.
  const ranked = orgs.slice().sort(
    (a, b) =>
      (b.federalContracts?.usdTotal ?? 0) - (a.federalContracts?.usdTotal ?? 0) ||
      (b.launchRecord?.totalLaunches ?? 0) - (a.launchRecord?.totalLaunches ?? 0) ||
      (b.spacecraftCount ?? 0) - (a.spacecraftCount ?? 0) ||
      b.tierRank - a.tierRank,
  );

  const ids = new Set(orgs.map((o) => o.id));
  const news = (dataset.news ?? [])
    .filter((n) => (n.organisations ?? []).some((id) => ids.has(id)))
    .slice(0, 8);

  const stat = (label, value) => `
    <div class="stat">
      <dt class="stat__label">${esc(label)}</dt>
      <dd class="stat__value" style="margin:0">${esc(value)}</dd>
    </div>`;

  return `
    <section class="brief-card brief-card--wide country__head">
      <div class="country__title">
        <span class="country__flag">${first.flag}</span>
        <div>
          <h2 class="detail__title">${esc(first.country)}</h2>
          <p class="detail__subtitle">
            ${number.format(s.total)} organisations · ${s.agencies} ${
              s.agencies === 1 ? 'agency' : 'agencies'
            } · ${s.companies} ${s.companies === 1 ? 'company' : 'companies'}
            ${s.firstFounded ? ` · oldest founded ${s.firstFounded}` : ''}
          </p>
        </div>
      </div>
      <dl class="stat-strip country__stats">
        ${stat('Organisations', number.format(s.total))}
        ${stat('Spacecraft flown', number.format(s.spacecraft))}
        ${stat('Launches', s.launchTotal ? number.format(s.launchTotal) : '—')}
        ${stat('Success rate', s.successRate != null ? `${s.successRate}%` : '—')}
        ${stat('Federal contracts', formatUsd(s.contracts))}
        ${stat('Reported staff', formatStaff(s.staff))}
      </dl>
      <p class="chart-card__sub">
        Staff and contract totals are whole-organisation figures. Diversified
        primes report company-wide headcount, and the procurement codes cover
        defence aerospace as well as space.
      </p>
    </section>

    ${
      s.milestones.length
        ? `<section class="brief-card brief-card--wide">
             <h2 class="brief-card__title">National milestones</h2>
             <p class="chart-card__sub">
               Capabilities demonstrated by at least one organisation based here.
               The named organisation is the most active holder, not necessarily
               the first to achieve it.
             </p>
             <ul class="cap-grid">
               ${s.milestones
                 .map(
                   (m) => `
                 <li class="cap">
                   <span class="cap__mark">✓</span>
                   <span>${esc(m.label)}</span>
                   <span class="cap__detail">${esc(
                     [
                       m.by,
                       m.detail,
                       m.count > 1 ? `+${m.count - 1} more` : null,
                     ]
                       .filter(Boolean)
                       .join(' · '),
                   )}</span>
                 </li>`,
                 )
                 .join('')}
             </ul>
           </section>`
        : ''
    }

    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Organisations — ${number.format(orgs.length)}</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Organisation</th>
              <th scope="col">Sector</th>
              <th scope="col">Founded</th>
              <th scope="col" class="num">Craft</th>
              <th scope="col" class="num">Launches</th>
              <th scope="col" class="num">Fed. contracts</th>
              <th scope="col">Capability</th>
            </tr>
          </thead>
          <tbody>
            ${ranked
              .map(
                (o) => `
              <tr data-id="${esc(o.id)}" tabindex="0">
                <td>
                  <div class="cell-agency">
                    <strong>${esc(label(o))}</strong>
                    ${label(o) !== o.name ? `<span>${esc(o.name)}</span>` : ''}
                  </div>
                </td>
                <td>${o.orgType === 'private' ? 'Company' : 'Agency'}</td>
                <td>${o.foundedYear ?? '—'}</td>
                <td class="num">${o.spacecraftCount ?? '—'}</td>
                <td class="num">${
                  o.launchRecord ? number.format(o.launchRecord.totalLaunches) : '—'
                }</td>
                <td class="num">${
                  o.federalContracts ? formatUsd(o.federalContracts.usdTotal) : '—'
                }</td>
                <td>
                  <span class="tier-badge" style="--tier-color:${tierColor(o.tier)}">
                    ${esc(o.tierLabel)}
                  </span>
                </td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    ${
      news.length
        ? `<section class="brief-card brief-card--wide">
             <h2 class="brief-card__title">In the news</h2>
             <ul class="wire">
               ${news
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
             </ul>
           </section>`
        : ''
    }`;
}

/** Ranked index of every country, used when no country is selected. */
export function renderCountryIndex(list) {
  const byCountry = new Map();
  for (const org of list) {
    if (!byCountry.has(org.iso3)) byCountry.set(org.iso3, []);
    byCountry.get(org.iso3).push(org);
  }

  const rows = [...byCountry.entries()]
    .map(([iso3, orgs]) => ({ iso3, orgs, s: summariseCountry(orgs) }))
    .sort(
      (a, b) =>
        b.s.contracts - a.s.contracts ||
        b.s.launchTotal - a.s.launchTotal ||
        b.s.total - a.s.total,
    );

  return `
    <section class="brief-card brief-card--wide">
      <h2 class="brief-card__title">Countries — ${rows.length}</h2>
      <p class="chart-card__sub">
        Select a country for its full roll-up, or click any country on the map.
      </p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col" class="num">Orgs</th>
              <th scope="col" class="num">Agencies</th>
              <th scope="col" class="num">Craft flown</th>
              <th scope="col" class="num">Launches</th>
              <th scope="col" class="num">Fed. contracts</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                ({ iso3, orgs, s }) => `
              <tr data-country="${esc(iso3)}" tabindex="0">
                <td><strong>${orgs[0].flag} ${esc(orgs[0].country)}</strong></td>
                <td class="num">${number.format(s.total)}</td>
                <td class="num">${s.agencies || '—'}</td>
                <td class="num">${s.spacecraft ? number.format(s.spacecraft) : '—'}</td>
                <td class="num">${s.launchTotal ? number.format(s.launchTotal) : '—'}</td>
                <td class="num">${s.contracts ? formatUsd(s.contracts) : '—'}</td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}
