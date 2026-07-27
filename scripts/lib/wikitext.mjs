/**
 * Minimal wikitext helpers — just enough to read the sortable tables on
 * "List of government space agencies" without pulling in a parser dependency.
 */

/** Splits `{{name|a|b}}` inner text on `|`, ignoring pipes nested in braces/brackets. */
export function splitTemplateArgs(inner) {
  const parts = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < inner.length; i += 1) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth += 1;
      buf += two;
      i += 1;
      continue;
    }
    if (two === '}}' || two === ']]') {
      depth -= 1;
      buf += two;
      i += 1;
      continue;
    }
    if (inner[i] === '|' && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += inner[i];
  }
  parts.push(buf);
  return parts;
}

/** Finds top-level `{{...}}` templates in a string. */
export function findTemplates(text) {
  const found = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text.slice(i, i + 2) !== '{{') continue;
    let depth = 0;
    for (let j = i; j < text.length - 1; j += 1) {
      const two = text.slice(j, j + 2);
      if (two === '{{') depth += 1;
      else if (two === '}}') {
        depth -= 1;
        if (depth === 0) {
          const inner = text.slice(i + 2, j);
          const args = splitTemplateArgs(inner);
          found.push({ name: args[0].trim(), args: args.slice(1), raw: inner });
          i = j + 1;
          break;
        }
      }
    }
  }
  return found;
}

/** Removes `<ref>...</ref>`, `<ref />`, and HTML comments. */
export function stripRefs(text) {
  return text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Reduces a cell to readable plain text: resolves `[[link|label]]`, drops
 * refs and templates, converts `<br />` to a separator.
 */
export function plainText(text) {
  let out = stripRefs(text);
  // Two passes, innermost-first, repeated until stable:
  //   1. unwrap templates that carry the text we want ({{langx|fr|NAME}}),
  //      which would otherwise be deleted along with their wrapper;
  //   2. drop every remaining template.
  // Repeating handles nesting like {{lang-ar|{{...}}}}.
  for (let i = 0; i < 8; i += 1) {
    const next = out
      .replace(/\{\{lang[x]?\|[^|{}]*\|([^{}]*?)\}\}/gi, '$1')
      .replace(/\{\{lang-[a-z-]+\|([^{}]*?)\}\}/gi, '$1')
      .replace(
        /\{\{(?:nowrap|nobold|noitalic|transl|transliteration|native name)\|(?:[^|{}]*\|)*([^{}]*?)\}\}/gi,
        '$1',
      )
      .replace(/\{\{[^{}]*\}\}/g, ' ');
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/\{\{|\}\}/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/<\/?(small|span|sup|sub|b|i)[^>]*>/gi, '')
    .replace(/'''?/g, '')
    .replace(/^[\s|]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first `<br />`-separated segment of a cell.
 * Acronym cells often stack native-language forms ("ISRO<br />इसरो").
 */
export function firstSegment(text) {
  // A cell can lead with a template that reduces to nothing, so take the
  // first segment that actually has content.
  const segments = plainText(text)
    .split('·')
    .map((part) =>
      part
        .trim()
        // Drop a trailing native-language restatement: "X Space Agency (Agencia …)".
        .replace(/\s*\([^()]*\)\s*$/, '')
        .trim()
        .replace(/[,;]$/, ''),
    )
    .filter(Boolean);
  return segments[0] ?? '';
}

/**
 * First article `[[Article|Label]]` in a cell, as `{ title, label }`.
 * Media and category links are skipped — agency cells often embed a
 * `[[File:...]]` logo ahead of the article link.
 */
export function firstLink(text) {
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  for (const match of stripRefs(text).matchAll(pattern)) {
    const title = match[1].trim();
    if (/^\s*(file|image|category|media):/i.test(title)) continue;
    return { title, label: (match[2] ?? title).trim() };
  }
  return null;
}

/**
 * Reads Wikipedia's yes/no cell templates.
 * Returns true for `{{ya}}`/`{{yes}}`, false for `{{na}}`/`{{no}}`, null if absent.
 */
export function checkMark(text) {
  const templates = findTemplates(stripRefs(text)).map((t) =>
    t.name.toLowerCase(),
  );
  if (templates.some((n) => ['ya', 'yes', 'y', 'check', 'tick'].includes(n))) {
    return true;
  }
  if (templates.some((n) => ['na', 'no', 'n', 'dunno', 'partial'].includes(n))) {
    return false;
  }
  return null;
}

/**
 * The parenthetical detail Wikipedia puts under a checkmark, e.g. the first
 * rocket or launch site: `{{ya}}<br /><small>([[Long March 1]])</small>`.
 */
export function checkDetail(text) {
  const match = stripRefs(text).match(/<small>\s*\(?([\s\S]*?)\)?\s*<\/small>/i);
  if (!match) return null;
  const detail = plainText(match[1]).replace(/^\(|\)$/g, '').trim();
  return detail || null;
}

/** Reads `{{dts|format=dmy|2023|1|24|abbr=on}}` into an ISO date string. */
export function templateDate(text) {
  const dts = findTemplates(stripRefs(text)).find((t) =>
    ['dts', 'dts/format', 'start date'].includes(t.name.toLowerCase()),
  );
  if (dts) {
    const nums = dts.args
      .filter((a) => !a.includes('='))
      .map((a) => Number(a.trim()))
      .filter((n) => Number.isFinite(n));
    if (nums.length) {
      const [y, m = 1, d = 1] = nums;
      if (y > 1800 && y < 2200) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  // Fall back to a bare year in the cell text.
  const year = plainText(text).match(/\b(1[89]\d{2}|20\d{2})\b/);
  return year ? `${year[1]}-01-01` : null;
}

/**
 * Splits a `{| ... |}` wikitable into rows of raw cell strings.
 * Header rows (`!`) and the caption are skipped.
 */
export function parseTable(tableText) {
  const body = tableText
    .replace(/^\{\|[^\n]*\n/, '')
    .replace(/\n\|\}\s*$/, '');
  const rows = [];

  for (const chunk of body.split(/\n\|-[^\n]*/)) {
    const cells = [];
    // Citation templates wrap across lines, and their continuation lines start
    // with `|` too. Track how deep we are so those are not read as new cells.
    let depth = 0;

    for (const line of chunk.split('\n')) {
      const continuing = depth > 0;
      depth += nesting(line);

      if (!continuing) {
        if (/^[!|]\+/.test(line)) continue; // caption
        if (/^!/.test(line)) continue; // header
        if (/^\|/.test(line)) {
          // One line may hold several cells separated by `||`.
          for (const piece of splitTopLevelCells(line.slice(1))) {
            cells.push(stripCellAttributes(piece));
          }
          continue;
        }
      }
      // Continuation of the previous cell (wrapped refs, lists, templates).
      if (cells.length) cells[cells.length - 1] += `\n${line}`;
    }

    if (cells.length) rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

/** Net change in template / link / ref nesting contributed by one line. */
function nesting(line) {
  const count = (pattern) => (line.match(pattern) ?? []).length;
  return (
    count(/\{\{/g) -
    count(/\}\}/g) +
    count(/\[\[/g) -
    count(/\]\]/g) +
    count(/<ref(?![^>]*\/>)[^>]*>/g) -
    count(/<\/ref>/g)
  );
}

/** Splits a line on `||`, ignoring separators inside templates or links. */
function splitTopLevelCells(line) {
  const pieces = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < line.length; i += 1) {
    const two = line.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth += 1;
      buf += two;
      i += 1;
      continue;
    }
    if (two === '}}' || two === ']]') {
      depth -= 1;
      buf += two;
      i += 1;
      continue;
    }
    if (two === '||' && depth <= 0) {
      pieces.push(buf);
      buf = '';
      i += 1;
      continue;
    }
    buf += line[i];
  }
  pieces.push(buf);
  return pieces;
}

/** Drops leading `style="..." |` / `scope="row" |` attributes from a cell. */
function stripCellAttributes(cell) {
  const match = cell.match(
    /^\s*((?:[a-zA-Z-]+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)\s*)+)\|(?!\|)/,
  );
  return match ? cell.slice(match[0].length) : cell;
}

/** Extracts the wikitables that follow a given `== Section ==` heading. */
export function tablesInSection(wikitext, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = wikitext.search(new RegExp(`^={2,4}\\s*${escaped}\\s*={2,4}`, 'm'));
  if (start === -1) return [];

  const rest = wikitext.slice(start + 1);
  const nextHeading = rest.search(/^={2}[^=]/m);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  const tables = [];
  let index = section.indexOf('{|');
  while (index !== -1) {
    const end = section.indexOf('\n|}', index);
    if (end === -1) break;
    tables.push(section.slice(index, end + 3));
    index = section.indexOf('{|', end);
  }
  return tables;
}
