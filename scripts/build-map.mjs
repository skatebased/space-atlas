#!/usr/bin/env node
/**
 * Builds data/world-map.json — one SVG path per country, keyed by ISO 3166-1
 * alpha-3, in a Robinson projection.
 *
 * Takes Natural Earth 110m boundaries (TopoJSON) and does the decode +
 * projection here so the browser ships plain path strings and needs no
 * mapping library. Geography is stable, so the output is committed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 110m is the base — small enough to ship — but it omits microstates
 * (Bahrain, Singapore, Malta…), so 50m fills in whatever it misses.
 */
const SOURCES = [
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
  'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
];

const WIDTH = 1000;
/** Robinson's height:width ratio is 1.3523/(0.8487*pi) ≈ 0.5072. */
const HEIGHT = Math.round(WIDTH * (1.3523 / (0.8487 * Math.PI)));

/* Robinson projection lookup, tabulated every 5° of latitude.
 * PLEN scales the length of each parallel, PDFE its distance from the equator. */
const PLEN = [
  1, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679,
  0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322,
];
const PDFE = [
  0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176,
  0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1,
];

/** Projects [lon, lat] in degrees to SVG user units. */
function robinson(lon, lat) {
  const sign = lat < 0 ? -1 : 1;
  const absLat = Math.min(Math.abs(lat), 90);
  const i = Math.min(Math.floor(absLat / 5), 17);
  const t = (absLat - i * 5) / 5;
  const len = PLEN[i] + (PLEN[i + 1] - PLEN[i]) * t;
  const dfe = PDFE[i] + (PDFE[i + 1] - PDFE[i]) * t;

  const x = 0.8487 * len * (lon * (Math.PI / 180));
  const y = 1.3523 * dfe * sign;

  // Normalise into the viewBox: x spans ±0.8487π, y spans ±1.3523.
  return [
    ((x / (0.8487 * Math.PI)) * 0.5 + 0.5) * WIDTH,
    (0.5 - (y / 1.3523) * 0.5) * HEIGHT,
  ];
}

/** Decodes one delta-encoded, quantised TopoJSON arc into [lon, lat] pairs. */
function decodeArc(arc, transform) {
  const { scale, translate } = transform;
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
}

/** Resolves a TopoJSON arc index (negative means "traverse in reverse"). */
function arcPoints(index, arcs) {
  return index < 0 ? arcs[~index].slice().reverse() : arcs[index];
}

/** Flattens a ring's arc indices into a single [lon, lat] list. */
function ringPoints(ring, arcs) {
  const points = [];
  for (const index of ring) {
    const segment = arcPoints(index, arcs);
    // Consecutive arcs share an endpoint; drop the duplicate.
    points.push(...(points.length ? segment.slice(1) : segment));
  }
  return points;
}

/**
 * Splits a ring where it crosses the antimeridian, clamping each piece to the
 * ±180 edge. Without this, Russia and Fiji draw as a streak across the map.
 */
function splitAtAntimeridian(points) {
  const pieces = [];
  let current = [];
  for (let i = 0; i < points.length; i += 1) {
    const [lon, lat] = points[i];
    current.push([lon, lat]);
    const next = points[(i + 1) % points.length];
    const delta = next[0] - lon;
    if (Math.abs(delta) <= 180) continue;

    // Interpolate the latitude where the edge meets the dateline.
    const edge = delta > 0 ? -180 : 180;
    const span = delta > 0 ? delta - 360 : delta + 360;
    const t = span === 0 ? 0 : (edge - lon) / span;
    const latMid = lat + (next[1] - lat) * t;
    current.push([edge, latMid]);
    pieces.push(current);
    current = [[-edge, latMid]];
  }
  if (current.length) {
    if (pieces.length) pieces[0] = current.concat(pieces[0]);
    else pieces.push(current);
  }
  return pieces.filter((piece) => piece.length >= 3);
}

/** Renders one already-split point list as an SVG subpath. */
function pointsToPath(points) {
  let d = '';
  let prev = null;
  for (const [lon, lat] of points) {
    const [px, py] = robinson(lon, lat);
    const x = Math.round(px * 10) / 10;
    const y = Math.round(py * 10) / 10;
    // Drop points that round to the same place as the last one.
    if (prev && prev[0] === x && prev[1] === y) continue;
    d += `${d ? 'L' : 'M'}${x} ${y}`;
    prev = [x, y];
  }
  return d ? `${d}Z` : '';
}

function ringToPath(ring, arcs) {
  const points = ringPoints(ring, arcs);
  if (points.length < 4) return '';
  return splitAtAntimeridian(points).map(pointsToPath).filter(Boolean).join('');
}

/** Shoelace area of one projected point list. */
function areaOf(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = robinson(points[i][0], points[i][1]);
    const next = points[(i + 1) % points.length];
    const [x2, y2] = robinson(next[0], next[1]);
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

/** Approximate projected area of a ring, used to drop specks. */
function ringArea(ring, arcs) {
  return splitAtAntimeridian(ringPoints(ring, arcs)).reduce(
    (sum, piece) => sum + areaOf(piece),
    0,
  );
}

/** Centroid of the largest landmass — where the map tooltip anchors. */
function centroidOf(rings, arcs) {
  let best = null;
  let bestArea = -1;
  for (const ring of rings) {
    for (const piece of splitAtAntimeridian(ringPoints(ring, arcs))) {
      const area = areaOf(piece);
      if (area <= bestArea) continue;
      bestArea = area;
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of piece) {
        const [x, y] = robinson(lon, lat);
        sx += x;
        sy += y;
      }
      best = [
        Math.round((sx / piece.length) * 10) / 10,
        Math.round((sy / piece.length) * 10) / 10,
      ];
    }
  }
  return best;
}

async function fetchTopo(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'space-agency-atlas/1.0 (dataset build)' },
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function main() {
  const countries = JSON.parse(
    await readFile(join(ROOT, 'data', 'countries.json'), 'utf8'),
  );
  const byNumeric = new Map(
    countries.map((c) => [String(Number(c.numeric)), c.iso3]),
  );

  const shapes = {};
  const centroids = {};
  const unmatched = new Set();
  let filledFrom50m = 0;

  for (const [index, url] of SOURCES.entries()) {
    const topo = await fetchTopo(url);
    const arcs = topo.arcs.map((arc) => decodeArc(arc, topo.transform));

    for (const geom of topo.objects.countries.geometries) {
      const iso3 = byNumeric.get(String(Number(geom.id)));
      if (!iso3) {
        if (index === 0) unmatched.add(geom.properties?.name ?? String(geom.id));
        continue;
      }
      // The finer source only fills gaps; it never replaces a 110m shape.
      if (shapes[iso3]) continue;

      const rings =
        geom.type === 'Polygon' ? geom.arcs : geom.arcs.flatMap((poly) => poly);
      // Drop islands too small to be visible or clickable at this scale.
      const visible = rings.filter((ring) => ringArea(ring, arcs) > 0.4);
      const kept = visible.length ? visible : rings;
      const path = kept.map((ring) => ringToPath(ring, arcs)).filter(Boolean).join('');
      if (!path) continue;

      shapes[iso3] = path;
      const centroid = centroidOf(kept, arcs);
      if (centroid) centroids[iso3] = centroid;
      if (index > 0) filledFrom50m += 1;
    }
  }

  const out = { width: WIDTH, height: HEIGHT, shapes, centroids };
  await writeFile(join(ROOT, 'data', 'world-map.json'), JSON.stringify(out));

  const bytes = JSON.stringify(out).length;
  console.log(
    `world-map.json — ${Object.keys(shapes).length} shapes (${filledFrom50m} from 50m), ${(bytes / 1024).toFixed(0)} KB`,
  );
  if (unmatched.size) console.log(`  no ISO match: ${[...unmatched].join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
