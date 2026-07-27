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
  "people's republic of china": 'CHN',
  'republic of china': 'TWN',
  "democratic people's republic of korea": 'PRK',
  'islamic republic of iran': 'IRN',
  'united kingdom of great britain and northern ireland': 'GBR',
  russia: 'RUS',
  'russian federation': 'RUS',
  iran: 'IRN',
  taiwan: 'TWN',
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

/**
 * Nationality adjectives, for the last-resort fallback used on company
 * articles whose Wikidata item carries no location at all. Wikipedia intros
 * almost always open "X is an American aerospace company…".
 */
const DEMONYMS = {
  american: 'USA', chinese: 'CHN', japanese: 'JPN', indian: 'IND',
  british: 'GBR', english: 'GBR', scottish: 'GBR', welsh: 'GBR',
  french: 'FRA', german: 'DEU', italian: 'ITA', spanish: 'ESP',
  russian: 'RUS', canadian: 'CAN', australian: 'AUS', swiss: 'CHE',
  dutch: 'NLD', israeli: 'ISR', brazilian: 'BRA', mexican: 'MEX',
  singaporean: 'SGP', norwegian: 'NOR', swedish: 'SWE', danish: 'DNK',
  finnish: 'FIN', polish: 'POL', ukrainian: 'UKR', turkish: 'TUR',
  emirati: 'ARE', argentine: 'ARG', argentinian: 'ARG', belgian: 'BEL',
  austrian: 'AUT', portuguese: 'PRT', czech: 'CZE', romanian: 'ROU',
  greek: 'GRC', irish: 'IRL', taiwanese: 'TWN', malaysian: 'MYS',
  indonesian: 'IDN', thai: 'THA', vietnamese: 'VNM', iranian: 'IRN',
  saudi: 'SAU', egyptian: 'EGY', nigerian: 'NGA', kenyan: 'KEN',
  chilean: 'CHL', colombian: 'COL', peruvian: 'PER', luxembourgish: 'LUX',
  'new zealand': 'NZL', 'south korean': 'KOR', 'north korean': 'PRK',
  'south african': 'ZAF', 'hong kong': 'HKG',
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
  const byCore = new Map();

  // Wikipedia uses short names; index the part before any comma or parenthesis.
  for (const c of countries) {
    const short = normalise(c.name.split(/[,(]/)[0]);
    if (short && !byName.has(short)) byName.set(short, c);
    const core = coreName(c.name);
    if (core && !byCore.has(core)) byCore.set(core, c);
  }

  function normalise(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Strips the constitutional wrapper Wikidata labels carry
   * ("People's Republic of China" → "china") so they match ISO short names.
   */
  function coreName(value) {
    return normalise(value)
      .replace(/\s*\(.*\)\s*$/, '')
      .replace(
        /^(the\s+)?(people'?s\s+)?(democratic\s+)?(federal\s+|federative\s+)?(socialist\s+|islamic\s+|bolivarian\s+|plurinational\s+|oriental\s+|arab\s+|co-?operative\s+)?(republic|kingdom|state|commonwealth|union|principality|sultanate|emirate|grand duchy|duchy|federation)s?\s+of\s+/,
        '',
      )
      .replace(/^the\s+/, '')
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
    return byName.get(normalise(raw)) ?? byCore.get(coreName(raw)) ?? null;
  }

  /**
   * Last-resort country guess from an article's opening sentence.
   * Only the lead clause is considered, and only the "is a/an <Demonym>"
   * shape, so a passing mention of another country cannot win.
   */
  function resolveFromText(text) {
    if (!text) return null;
    const lead = String(text).split(/(?<=\.)\s/)[0].toLowerCase();
    const match = lead.match(
      /\b(?:is|was)\s+(?:an?\s+)?(?:privately[\s-]held\s+|private\s+|publicly[\s-]traded\s+|former\s+|defunct\s+)*([a-z]+(?:\s[a-z]+)?)/,
    );
    if (!match) return null;

    // Try the two-word demonym first ("south korean"), then the single word.
    const [two] = [match[1], match[1].split(' ')[0]].filter(
      (candidate) => DEMONYMS[candidate],
    );
    const iso3 = two ? DEMONYMS[two] : null;
    return iso3 ? (byIso3.get(iso3) ?? null) : null;
  }

  return { resolve, resolveFromText, byIso3 };
}
