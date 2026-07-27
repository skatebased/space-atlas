/**
 * Reads Wikipedia's "List of private spaceflight companies".
 *
 * That page is organised by product, not by company: each row is a rocket,
 * capsule or station, with the company cell `rowspan`-ed across its products.
 * This module folds those rows back up into one record per company and
 * converts them into the same capability vocabulary the agency scraper uses,
 * so both can share a dataset.
 *
 * Headings wrap across lines in the source ("!Launcher\nname"), which makes
 * header-name matching unreliable, so columns are addressed positionally.
 * The indices below are verified against the live page by scripts/validate.mjs.
 */
import {
  parseTable,
  tablesInSection,
  plainText,
  firstLink,
} from './wikitext.mjs';

export const SOURCE_PAGE = 'List of private spaceflight companies';

/**
 * One entry per table on the page.
 * `product` / `type` / `status` / `first` are column indices.
 */
const SECTIONS = [
  {
    heading: 'Launch vehicle manufacturers',
    kind: 'launcher',
    product: 1,
    type: 2,
    reach: 4,
    status: 5,
    first: 6,
  },
  { heading: 'Cargo transport vehicles', kind: 'cargo', product: 1, status: 12 },
  { heading: 'Orbital', kind: 'crew-orbital', product: 1, status: 10 },
  { heading: 'Suborbital', kind: 'crew-suborbital', product: 1, status: 9 },
  {
    heading: 'Landers, rovers and orbiters',
    kind: 'lander',
    product: 1,
    type: 2,
    status: 3,
    first: 4,
  },
  {
    heading: 'Research craft and tech demonstrators',
    kind: 'research',
    product: 1,
    type: 2,
    status: 3,
  },
  {
    heading: 'Propulsion manufacturers',
    kind: 'propulsion',
    product: 1,
    type: 2,
    status: 4,
  },
  { heading: 'Space manufacturing', kind: 'manufacturing', product: 1, status: 3 },
  { heading: 'Space mining', kind: 'mining', product: 2, status: 3 },
  {
    heading: 'Space stations',
    kind: 'station',
    product: 1,
    type: 2,
    status: 5,
  },
  {
    heading: 'Spacecraft component developers and manufacturers',
    kind: 'components',
    product: 1,
  },
  { heading: 'Spaceliner companies', kind: 'spaceliner', product: 2, status: 3 },
];

/**
 * Interprets a status cell.
 *
 * Wikipedia annotates flight record as "(successes/attempts)", so
 * "Retired (0/1)" means the vehicle flew once and failed — not a
 * demonstrated capability.
 */
export function readStatus(cell) {
  const label = plainText(cell ?? '');
  const record = label.match(/\((\d+)\s*\/\s*(\d+)\)/);
  const successes = record ? Number(record[1]) : null;
  const attempts = record ? Number(record[2]) : null;

  const hasFlown = /\b(operational|retired|derelict|active|in service|deorbited)\b/i.test(
    label,
  );
  const demonstrated = hasFlown && (successes === null || successes > 0);

  return { label: label || null, demonstrated, successes, attempts };
}

/** A capability entry in the shared schema. */
const cap = (has, detail = null) => ({ has, detail });

/** Merges a capability in, keeping the strongest claim and its first example. */
function addCapability(target, key, has, detail) {
  const existing = target[key];
  if (!existing) {
    target[key] = cap(has, has ? detail : null);
    return;
  }
  if (has && !existing.has) {
    target[key] = cap(true, detail);
    return;
  }
  if (has && existing.has && !existing.detail && detail) existing.detail = detail;
}

/** Maps one product row onto the shared capability vocabulary. */
function applyRow(record, section, row) {
  const product = plainText(row[section.product] ?? '');
  const type = section.type != null ? plainText(row[section.type] ?? '') : '';
  const status = readStatus(section.status != null ? row[section.status] : '');
  const flown = status.demonstrated;
  const caps = record.capabilities;

  // Track the portfolio regardless of flight status.
  if (product) {
    record.products.push({
      name: product,
      kind: section.kind,
      type: type || null,
      status: status.label,
      demonstrated: flown,
    });
  }

  switch (section.kind) {
    case 'launcher': {
      const reach = plainText(row[section.reach] ?? '');
      const suborbital = /suborbital|sounding/i.test(`${reach} ${type}`);
      const orbital =
        !suborbital &&
        /\b(leo|geo|gto|sso|meo|tli|orbit|lunar|moon|mars|interplanetary|escape)\b/i.test(
          reach,
        );
      if (orbital) addCapability(caps, 'orbitalLaunch', flown, product);
      if (suborbital) addCapability(caps, 'suborbitalLaunch', flown, product);
      if (/reusable/i.test(type)) {
        addCapability(caps, 'reusableSystems', flown, product);
      }
      break;
    }
    case 'cargo':
      addCapability(caps, 'cargoSpacecraft', flown, product);
      break;
    case 'crew-orbital':
      addCapability(caps, 'crewedLaunch', flown, product);
      break;
    case 'crew-suborbital':
      addCapability(caps, 'crewedSuborbital', flown, product);
      break;
    case 'lander': {
      // "Lunar lander", "Mars rover", "orbiter" — the type names the milestone.
      if (/rover/i.test(type)) addCapability(caps, 'rover', flown, product);
      else if (/orbiter/i.test(type)) {
        addCapability(caps, 'extraterrestrialOrbiter', flown, product);
      } else if (/lander|landing/i.test(type)) {
        addCapability(caps, 'softLanding', flown, product);
      } else if (/flyby/i.test(type)) addCapability(caps, 'flyby', flown, product);
      else addCapability(caps, 'extraterrestrialOrbiter', flown, product);
      break;
    }
    case 'research':
      addCapability(caps, 'researchCraft', flown, product);
      break;
    case 'propulsion':
      addCapability(caps, 'propulsion', flown, product);
      break;
    case 'manufacturing':
      addCapability(caps, 'spaceManufacturing', flown, product);
      break;
    case 'mining':
      addCapability(caps, 'spaceMining', flown, product);
      break;
    case 'station':
      addCapability(caps, 'spaceStation', flown, product);
      break;
    case 'components':
      // This table has no status column; presence is the claim.
      addCapability(caps, 'spacecraftComponents', true, product);
      break;
    case 'spaceliner':
      addCapability(caps, 'spaceliner', flown, product);
      break;
    default:
      break;
  }
}

/**
 * Reads the whole page into `Map<articleTitle, record>`.
 * Companies without a wiki link are keyed by their plain name.
 */
export function readPrivateCompanies(wikitext) {
  const records = new Map();
  const sectionsSeen = [];

  for (const section of SECTIONS) {
    const tables = tablesInSection(wikitext, section.heading);
    if (!tables.length) {
      sectionsSeen.push({ heading: section.heading, rows: 0 });
      continue;
    }

    let rowCount = 0;
    for (const table of tables) {
      for (const row of parseTable(table)) {
        if (row.length <= section.product) continue;
        const companyCell = row[0] ?? '';
        const link = firstLink(companyCell);
        const name = link?.label ?? plainText(companyCell);
        if (!name || name.length > 90) continue;

        const key = link?.title ?? name;
        if (!records.has(key)) {
          records.set(key, {
            title: link?.title ?? null,
            name: link?.title ?? name,
            linked: Boolean(link),
            capabilities: {},
            products: [],
            sections: new Set(),
          });
        }
        const record = records.get(key);
        record.sections.add(section.kind);
        applyRow(record, section, row);
        rowCount += 1;
      }
    }
    sectionsSeen.push({ heading: section.heading, rows: rowCount });
  }

  for (const record of records.values()) {
    record.sections = [...record.sections];
    // Cap the portfolio so a prolific manufacturer cannot bloat the payload.
    record.products = record.products.slice(0, 12);
  }

  return { records, sectionsSeen };
}
