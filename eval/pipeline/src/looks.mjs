import fs from 'node:fs';
import { decodePng, STILL_SCALE, LOGICAL_W, LOGICAL_H } from './png-nn.mjs';

function quantKey(r, g, b) {
  return `${r >> 4},${g >> 4},${b >> 4}`;
}

function regionStats(rgba, width, height, region, scale) {
  const x0 = Math.max(0, Math.floor(region.x * scale));
  const y0 = Math.max(0, Math.floor(region.y * scale));
  const x1 = Math.min(width, Math.ceil((region.x + region.w) * scale));
  const y1 = Math.min(height, Math.ceil((region.y + region.h) * scale));
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  const keys = new Set();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sr += rgba[i];
      sg += rgba[i + 1];
      sb += rgba[i + 2];
      keys.add(quantKey(rgba[i], rgba[i + 1], rgba[i + 2]));
      n++;
    }
  }
  if (!n) return { n: 0, unique: 0, mean: [0, 0, 0] };
  return { n, unique: keys.size, mean: [sr / n, sg / n, sb / n] };
}

function globalStats(rgba) {
  const keys = new Set();
  let dark = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    keys.add(quantKey(rgba[i], rgba[i + 1], rgba[i + 2]));
    if (rgba[i] + rgba[i + 1] + rgba[i + 2] < 40) dark++;
  }
  return { unique: keys.size, darkRatio: dark / n };
}

function meanDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function heuristicFrame({ png, geometry }) {
  const img = decodePng(png);
  const scale = img.width === LOGICAL_W ? 1 : STILL_SCALE;
  const g = globalStats(img.rgba);
  const regions = Object.entries(geometry?.regions ?? {});
  const stats = regions.map(([, r]) => regionStats(img.rgba, img.width, img.height, r, scale));
  const contrast = stats.filter((s) => s.unique >= 2).length;
  const v1 = regions.length === 0 ? (g.unique >= 3 ? 1 : 0.5) : contrast / regions.length;
  const v2 = g.unique >= 4 ? 1 : g.unique >= 2 ? 0.5 : 0;
  const v3 = g.darkRatio < 0.98 ? 1 : 0;
  const v4 = v1 >= 0.5 ? 1 : 0.5;
  const a1 = g.unique >= 8 ? 1 : g.unique >= 4 ? 0.5 : 0;
  const a2 = g.unique >= 12 ? 1 : 0.5;
  const a3 = contrast > 0 ? (g.unique >= 8 ? 1 : 0.5) : 0;
  const a4 = a1;
  const V = (clamp01(v1) + v2 + v3 + v4) / 4;
  let A = (a1 + a2 + a3 + a4) / 4;
  if (g.unique < 12) A = Math.min(A, 0.5);
  return {
    V: round01(V),
    A: round01(A),
    unique: g.unique,
    source: 'heuristic',
  };
}

export function heuristicDepth({ png, geometry, keys }) {
  if (!keys?.length) return { D: 0, source: 'heuristic' };
  const img = decodePng(png);
  const scale = img.width === LOGICAL_W ? 1 : STILL_SCALE;
  const means = keys.map((k) => regionStats(img.rgba, img.width, img.height, geometry.regions[k], scale).mean);
  let pairs = 0;
  let distinct = 0;
  for (let i = 0; i < means.length; i++) {
    for (let j = i + 1; j < means.length; j++) {
      pairs++;
      if (meanDistance(means[i], means[j]) >= 18) distinct++;
    }
  }
  if (!pairs) return { D: 0, source: 'heuristic' };
  const ratio = distinct / pairs;
  const D = ratio >= 0.66 ? 1 : ratio >= 0.33 ? 0.5 : 0;
  return { D, source: 'heuristic' };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export function round01(x) {
  if (x >= 0.75) return 1;
  if (x >= 0.25) return 0.5;
  return 0;
}

export function average01(vals) {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function scoreVisuals({ stills, geometry, depthKeys }) {
  if (!stills?.length) {
    return { V: 0, A: 0, D: depthKeys ? 0 : undefined, looks_status: 'CAPTURE_FAIL', source: 'none' };
  }
  const vs = [];
  const as = [];
  const ds = [];
  for (const s of stills) {
    if (!s.png && s.path) {
      if (!fs.existsSync(s.path)) continue;
      s.png = fs.readFileSync(s.path);
    }
    if (!s.png) continue;
    try {
      const h = heuristicFrame({ png: s.png, geometry });
      vs.push(h.V);
      as.push(h.A);
      if (depthKeys) ds.push(heuristicDepth({ png: s.png, geometry, keys: depthKeys }).D);
    } catch {
      vs.push(0);
      as.push(0);
      if (depthKeys) ds.push(0);
    }
  }
  if (!vs.length) {
    return { V: 0, A: 0, D: depthKeys ? 0 : undefined, looks_status: 'CAPTURE_FAIL', source: 'none' };
  }
  const out = {
    V: round01(average01(vs)),
    A: round01(average01(as)),
    looks_status: 'OK',
    source: 'heuristic',
  };
  if (depthKeys) out.D_visual = round01(average01(ds));
  return out;
}
