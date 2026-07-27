/**
 * Resolves the country codes used in Wikipedia's flag templates.
 *
 * Those tables mix IOC codes ({{GER}}, {{SUI}}, {{NED}}) with ISO 3166-1
 * alpha-3 ({{NLD}}, {{ESP}}) and ad-hoc aliases ({{UK}}, {{EU}}), sometimes in
 * the same row, so resolution tries each scheme in turn.
 */

/** IOC codes that differ from ISO 3166-1 alpha-3, plus the ones that collide. */
const IOC_TO_ISO3 = {
  ALG: 'DZA', ANG: 'AGO', ANT: 'ATG', ARU: 'ABW', ASA: 'ASM', BAH: 'BHS',
  BAN: 'BGD', BAR: 'BRB', BER: 'BMU', BHU: 'BTN', BIZ: 'BLZ', BOT: 'BWA',
  BRN: 'BHR', BRU: 'BRN', BUL: 'BGR', BUR: 'BFA', CAM: 'KHM', CAY: 'CYM',
  CGO: 'COG', CHA: 'TCD', CHI: 'CHL', CRC: 'CRI', CRO: 'HRV', DEN: 'DNK',
  ESA: 'SLV', FIJ: 'FJI', GAM: 'GMB', GBS: 'GNB', GEQ: 'GNQ', GER: 'DEU',
  GRE: 'GRC', GRN: 'GRD', GUA: 'GTM', GUI: 'GIN', HAI: 'HTI', HON: 'HND',
  INA: 'IDN', IRI: 'IRN', ISV: 'VIR', IVB: 'VGB', KSA: 'SAU', KUW: 'KWT',
  LAT: 'LVA', LBA: 'LBY', LES: 'LSO', LIB: 'LBN', LIT: 'LTU', MAD: 'MDG', MAS: 'MYS',
  MAW: 'MWI', MGL: 'MNG', MON: 'MCO', MRI: 'MUS', MTN: 'MRT', MYA: 'MMR',
  NCA: 'NIC', NED: 'NLD', NEP: 'NPL', NGR: 'NGA', NIG: 'NER', OMA: 'OMN',
  PAR: 'PRY', PHI: 'PHL', PLE: 'PSE', POR: 'PRT', PUR: 'PRI', RSA: 'ZAF',
  SAM: 'WSM', SEY: 'SYC', SIN: 'SGP', SKN: 'KNA', SLO: 'SVN', SOL: 'SLB',
  SRI: 'LKA', STP: 'STP', SUD: 'SDN', SUI: 'CHE', TAN: 'TZA', TGA: 'TON',
  TPE: 'TWN', UAE: 'ARE', URU: 'URY', VIE: 'VNM', VIN: 'VCT', ZAM: 'ZMB',
  ZIM: 'ZWE',
};

/** Aliases and page titles that appear in `{{flag|...}}` / `{{flagicon|...}}`. */
const NAME_ALIASES = {
  uk: 'GBR',
  'united kingdom': 'GBR',
  'great britain': 'GBR',
  england: 'GBR',
  eu: 'EUE',
  'european union': 'EUE',
  europe: 'EUE',
  'african union': 'AUU',
  'arab league': 'ARL',
  'league of arab states': 'ARL',
  'asia-pacific space cooperation organization': 'APS',
  'soviet union': 'SUN',
  ussr: 'SUN',
  urs: 'SUN',
  'united nations': 'UNO',
  un: 'UNO',
  'latin america': 'LAC',
  'latin america and the caribbean': 'LAC',
  international: 'INT',
  // US state authorities listed alongside national agencies.
  'new mexico': 'USA',
  oklahoma: 'USA',
  alaska: 'USA',
  california: 'USA',
  virginia: 'USA',
  florida: 'USA',
  texas: 'USA',
  'south korea': 'KOR',
  'republic of korea': 'KOR',
  'north korea': 'PRK',
  'south africa': 'ZAF',
  'united states': 'USA',
  'united states of america': 'USA',
  russia: 'RUS',
  'russian federation': 'RUS',
  iran: 'IRN',
  taiwan: 'TWN',
  'republic of china': 'TWN',
  vietnam: 'VNM',
  laos: 'LAO',
  syria: 'SYR',
  bolivia: 'BOL',
  venezuela: 'VEN',
  tanzania: 'TZA',
  moldova: 'MDA',
  'ivory coast': 'CIV',
  "cote d'ivoire": 'CIV',
  'czech republic': 'CZE',
  czechia: 'CZE',
  turkey: 'TUR',
  türkiye: 'TUR',
  'cape verde': 'CPV',
  'democratic republic of the congo': 'COD',
  'republic of the congo': 'COG',
  'north macedonia': 'MKD',
  macedonia: 'MKD',
  brunei: 'BRN',
  'east timor': 'TLS',
  'timor-leste': 'TLS',
  eswatini: 'SWZ',
  swaziland: 'SWZ',
  palestine: 'PSE',
  'state of palestine': 'PSE',
  'hong kong': 'HKG',
  macau: 'MAC',
  'united arab emirates': 'ARE',
  'saudi arabia': 'SAU',
  'sri lanka': 'LKA',
  'new zealand': 'NZL',
  'papua new guinea': 'PNG',
  'costa rica': 'CRI',
  'dominican republic': 'DOM',
  'el salvador': 'SLV',
  'burkina faso': 'BFA',
  'sierra leone': 'SLE',
  'south sudan': 'SSD',
  'equatorial guinea': 'GNQ',
  'guinea-bissau': 'GNB',
  'antigua and barbuda': 'ATG',
  'trinidad and tobago': 'TTO',
  'bosnia and herzegovina': 'BIH',
  'saint kitts and nevis': 'KNA',
  'saint lucia': 'LCA',
  'saint vincent and the grenadines': 'VCT',
  'sao tome and principe': 'STP',
  'são tomé and príncipe': 'STP',
  'myanmar': 'MMR',
  burma: 'MMR',
  'kingdom of the netherlands': 'NLD',
  netherlands: 'NLD',
  'holy see': 'VAT',
  'vatican city': 'VAT',
};

/** Emoji flag from an ISO alpha-2 code. */
export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2 || !/^[A-Z]{2}$/.test(iso2)) return '';
  return String.fromCodePoint(
    ...[...iso2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function createResolver(countries) {
  const byIso3 = new Map(countries.map((c) => [c.iso3, c]));
  const byIso2 = new Map(countries.map((c) => [c.iso2, c]));
  const byName = new Map(
    countries.map((c) => [normalise(c.name), c]),
  );
  // Wikipedia uses short names; index the part before any comma or parenthesis.
  for (const c of countries) {
    const short = normalise(c.name.split(/[,(]/)[0]);
    if (short && !byName.has(short)) byName.set(short, c);
  }

  function normalise(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Resolves a flag-template argument (a code or a country name) to a country. */
  function resolve(token) {
    if (!token) return null;
    const raw = String(token).trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();

    // IOC first: it disambiguates codes that mean different countries in each
    // scheme (IOC BRN = Bahrain, ISO BRN = Brunei).
    if (IOC_TO_ISO3[upper] && byIso3.has(IOC_TO_ISO3[upper])) {
      return byIso3.get(IOC_TO_ISO3[upper]);
    }
    if (byIso3.has(upper)) return byIso3.get(upper);

    const alias = NAME_ALIASES[normalise(raw)];
    if (alias && byIso3.has(alias)) return byIso3.get(alias);

    if (upper.length === 2 && byIso2.has(upper)) return byIso2.get(upper);
    return byName.get(normalise(raw)) ?? null;
  }

  return { resolve, byIso3 };
}
