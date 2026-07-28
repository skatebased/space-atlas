#!/usr/bin/env node
/**
 * Builds data/changelog.json — what changed between dataset revisions.
 *
 * The dataset is committed on every refresh, so git already holds the history;
 * this diffs consecutive revisions of data/organisations.json and records
 * organisations added or removed and the metrics that moved. No competitor can
 * reproduce it without the same commit history.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = 'data/organisations.json';
const MAX_REVISIONS = 12;

async function git(args) {
  const { stdout } = await run('git', args, {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** Numeric metrics worth reporting when they move. */
const TRACKED = [
  { key: 'launchRecord.totalLaunches', label: 'launches' },
  { key: 'federalContracts.usdTotal', label: 'federal contracts', money: true },
  { key: 'financials.revenue.usd', label: 'revenue', money: true },
  { key: 'spacecraftCount', label: 'spacecraft flown' },
  { key: 'employees', label: 'staff' },
];

const read = (obj, path) =>
  path.split('.').reduce((value, key) => (value == null ? value : value[key]), obj);

function diff(previous, current) {
  const before = new Map(previous.map((o) => [o.id, o]));
  const after = new Map(current.map((o) => [o.id, o]));

  const added = [...after.keys()]
    .filter((id) => !before.has(id))
    .map((id) => ({ id, name: after.get(id).name, country: after.get(id).country }));

  const removed = [...before.keys()]
    .filter((id) => !after.has(id))
    .map((id) => ({ id, name: before.get(id).name }));

  const changes = [];
  for (const [id, now] of after) {
    const then = before.get(id);
    if (!then) continue;
    for (const metric of TRACKED) {
      const a = read(then, metric.key);
      const b = read(now, metric.key);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      changes.push({
        id,
        name: now.name,
        metric: metric.label,
        from: a,
        to: b,
        delta: b - a,
        money: Boolean(metric.money),
      });
    }
  }

  // Biggest proportional moves first — a jump from 2 to 6 launches matters
  // more than one from 700 to 704.
  changes.sort(
    (x, y) => Math.abs(y.delta / (y.from || 1)) - Math.abs(x.delta / (x.from || 1)),
  );

  return { added, removed, changes: changes.slice(0, 40) };
}

async function main() {
  let log;
  try {
    log = await git([
      'log',
      `-${MAX_REVISIONS}`,
      '--format=%H|%cI|%s',
      '--',
      DATA_PATH,
    ]);
  } catch (err) {
    console.error(`changelog: git unavailable (${err.message})`);
    await writeFile(
      join(ROOT, 'data', 'changelog.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), revisions: [] }, null, 1)}\n`,
    );
    return;
  }

  const commits = log
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...rest] = line.split('|');
      return { hash, date, subject: rest.join('|') };
    });

  if (commits.length < 2) {
    console.log('changelog: fewer than two dataset revisions, nothing to diff');
    await writeFile(
      join(ROOT, 'data', 'changelog.json'),
      `${JSON.stringify(
        { generatedAt: new Date().toISOString(), revisions: [] },
        null,
        1,
      )}\n`,
    );
    return;
  }

  /** Loads the dataset as of one commit; missing/renamed files are skipped. */
  const at = async (hash) => {
    try {
      const raw = await git(['show', `${hash}:${DATA_PATH}`]);
      const parsed = JSON.parse(raw);
      return parsed.organisations ?? [];
    } catch {
      return null;
    }
  };

  const revisions = [];
  for (let i = 0; i < commits.length - 1; i += 1) {
    const [current, previous] = [await at(commits[i].hash), await at(commits[i + 1].hash)];
    if (!current || !previous) continue;

    const result = diff(previous, current);
    if (!result.added.length && !result.removed.length && !result.changes.length) continue;

    revisions.push({
      hash: commits[i].hash.slice(0, 7),
      date: commits[i].date,
      subject: commits[i].subject,
      total: current.length,
      ...result,
    });
  }

  const out = { generatedAt: new Date().toISOString(), revisions };
  await writeFile(
    join(ROOT, 'data', 'changelog.json'),
    `${JSON.stringify(out, null, 1)}\n`,
  );

  const added = revisions.reduce((n, r) => n + r.added.length, 0);
  const changed = revisions.reduce((n, r) => n + r.changes.length, 0);
  console.log(
    `changelog.json — ${revisions.length} revisions, ${added} additions, ${changed} metric changes`,
  );
}

main().catch((err) => {
  console.error(`changelog failed: ${err.message}`);
  process.exit(1);
});
