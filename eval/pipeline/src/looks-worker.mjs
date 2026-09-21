import fs from 'node:fs';
import { decodePng } from './png-nn.mjs';
import { aggregateLooks, gameplayView, quantizeLooks } from './looks-rubric.mjs';
import { aggregateRubric } from './rubric.mjs';

function quantKey(r, g, b) {
  return `${r >> 4},${g >> 4},${b >> 4}`;
}

function regionStats(rgba, width, height, region) {
  const x0 = Math.max(0, Math.floor(region.x));
  const y0 = Math.max(0, Math.floor(region.y));
  const x1 = Math.min(width, Math.ceil(region.x + region.w));
  const y1 = Math.min(height, Math.ceil(region.y + region.h));
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
  if (!n) return { n: 0, unique: 0, mean: [0, 0, 0], lum: 0 };
  const mean = [sr / n, sg / n, sb / n];
  return { n, unique: keys.size, mean, lum: (mean[0] + mean[1] + mean[2]) / 3 };
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

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function playRegions(regions) {
  return Object.entries(regions ?? {}).filter(([name]) => name !== 'dead');
}

function scoreFrame({ img, dump, dumpOk, geometry, variantKeys }) {
  const g = globalStats(img.rgba);
  const hud = regionStats(img.rgba, img.width, img.height, { x: 48, y: 32, w: 1184, h: 96 });
  const labeled = playRegions(geometry?.regions);
  const regionHits = labeled.map(([, r]) => regionStats(img.rgba, img.width, img.height, r));
  const present = regionHits.filter((s) => s.unique >= 2 || s.lum >= 40).length;
  let V1 = 1;
  if (labeled.length) {
    const ratio = present / labeled.length;
    V1 = ratio >= 0.99 ? 1 : ratio >= 0.4 ? 0.5 : 0;
  } else {
    V1 = g.unique >= 2 ? 1 : 0.5;
  }
  const V2 = hud.unique >= 2 && hud.lum >= 20 ? 1 : hud.unique >= 2 ? 0.5 : 0;
  const fields = Object.keys(dump ?? {});
  let V3 = 0;
  if (dumpOk === 1 && fields.length) {
    V3 = V2 >= 0.5 || present > 0 ? 1 : 0.5;
    if (dump.on === true) {
      const tog = geometry?.regions?.toggle;
      if (tog && regionStats(img.rgba, img.width, img.height, tog).lum < 40) V3 = 0;
    }
  } else if (fields.length) {
    V3 = V2 >= 0.5 ? 0.5 : 0;
  }
  const V4 = g.darkRatio < 0.98 && g.unique >= 3 ? 1 : g.unique >= 2 ? 0.5 : 0;
  const A1 = g.unique >= 8 ? 1 : g.unique >= 4 ? 0.5 : 0;
  const A2 = 0.5;
  const A3 = labeled.length ? (present ? 0.5 : 0) : V2 >= 1 ? 0.5 : 0;
  const A4 = V2 >= 1 ? 0.5 : 0;
  let D1 = 1;
  if (variantKeys?.length) {
    const means = variantKeys
      .map((k) => geometry?.regions?.[k])
      .filter(Boolean)
      .map((r) => regionStats(img.rgba, img.width, img.height, r).mean);
    let pairs = 0;
    let distinct = 0;
    for (let i = 0; i < means.length; i++) {
      for (let j = i + 1; j < means.length; j++) {
        pairs++;
        if (dist(means[i], means[j]) >= 18) distinct++;
      }
    }
    const ratio = pairs ? distinct / pairs : 0;
    D1 = ratio >= 0.66 ? 1 : ratio >= 0.33 ? 0.5 : 0;
  }
  return {
    V1: quantizeLooks(V1),
    V2: quantizeLooks(V2),
    V3: quantizeLooks(V3),
    V4: quantizeLooks(V4),
    A1: quantizeLooks(A1),
    A2: quantizeLooks(A2),
    A3: quantizeLooks(A3),
    A4: quantizeLooks(A4),
    D1: quantizeLooks(D1),
  };
}

export function scoreLooksWorker(job, stills) {
  const hasDepth = Boolean(job.variant_regions?.length);
  const itemSets = [];
  for (const s of stills ?? []) {
    const png = s.png ?? (s.path && fs.existsSync(s.path) ? fs.readFileSync(s.path) : null);
    if (!png) continue;
    let img;
    try {
      img = decodePng(png);
    } catch {
      continue;
    }
    itemSets.push(
      scoreFrame({
        img,
        dump: gameplayView(s.dump),
        dumpOk: s.dump_ok ?? 0,
        geometry: { regions: job.regions, labels: job.labels },
        variantKeys: job.variant_regions,
      }),
    );
  }
  if (!itemSets.length) {
    return {
      V: 0,
      A: 0,
      D_visual: hasDepth ? 0 : undefined,
      looks_status: 'CAPTURE_FAIL',
      source: 'worker',
    };
  }
  const avgItems = {};
  for (const id of ['V1', 'V2', 'V3', 'V4', 'A1', 'A2', 'A3', 'A4', 'D1']) {
    avgItems[id] = quantizeLooks(itemSets.reduce((a, it) => a + (it[id] ?? 0), 0) / itemSets.length);
  }
  if (job.rubric?.requirements?.length) {
    const fill = {};
    const mark = quantizeLooks((avgItems.V1 + avgItems.A1) / 2);
    for (const req of job.rubric.requirements) fill[req.id] = mark;
    const agg = aggregateRubric(fill, job.rubric);
    return { ...agg, looks_status: 'OK', source: 'worker', looks_runner: 'looks-job-worker' };
  }
  const agg = aggregateLooks(avgItems, { hasDepth });
  return { ...agg, looks_status: 'OK', source: 'worker', looks_runner: 'looks-job-worker' };
}
