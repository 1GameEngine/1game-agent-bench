import fs from 'node:fs';
import { DEPTH_TASKS, hasDepth } from './product-100.mjs';
import { scoreVisuals } from './looks-judge.mjs';

export function stillsComplete(stills) {
  const list = stills ?? [];
  if (!list.length) return false;
  return list.every((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
}

function emptyVis(looks_status, looks_source, taskId) {
  return {
    V: 0,
    A: 0,
    D: hasDepth(taskId) ? 0 : undefined,
    looks_status,
    looks_source,
  };
}

async function oneSide({ taskId, engine, instruction, geometry, stills, jobDir, G }) {
  if (!G) return emptyVis('SKIP', 'none', taskId);
  return scoreVisualsSide({ taskId, engine, instruction, geometry, stills, jobDir });
}

async function scoreVisualsSide({ taskId, engine, instruction, geometry, stills, jobDir }) {
  const keys = DEPTH_TASKS[taskId];
  const depthKeys = Array.isArray(keys) && keys.length ? keys : undefined;
  const vis = await scoreVisuals({
    stills: (stills ?? []).filter((s) => s.ok),
    geometry,
    depthKeys,
    instruction,
    taskId,
    engine,
    jobDir,
  });
  let D;
  if (hasDepth(taskId)) {
    D = depthKeys ? vis.D_visual ?? 0 : vis.V;
  }
  return { V: vis.V, A: vis.A, D, looks_status: vis.looks_status, looks_source: vis.source };
}

export async function scorePairedLooks({
  taskId,
  instruction,
  geometry,
  og,
  gd,
  ogJobDir,
  gdJobDir,
}) {
  const ogG = Boolean(og.G);
  const gdG = Boolean(gd.G);
  if (!ogG && !gdG) {
    const skip = emptyVis('SKIP', 'none', taskId);
    return { og: skip, gd: skip, pair: 'BOTH_G0' };
  }
  if (ogG && gdG) {
    if (!stillsComplete(og.stills) || !stillsComplete(gd.stills)) {
      const z = emptyVis('INCOMPARABLE_VISUAL', 'pair', taskId);
      return { og: z, gd: { ...z }, pair: 'INCOMPARABLE_VISUAL' };
    }
    const ogVis = await scoreVisualsSide({
      taskId,
      engine: 'onegame',
      instruction,
      geometry,
      stills: og.stills,
      jobDir: ogJobDir,
    });
    const gdVis = await scoreVisualsSide({
      taskId,
      engine: 'godot',
      instruction,
      geometry,
      stills: gd.stills,
      jobDir: gdJobDir,
    });
    if (ogVis.looks_status !== gdVis.looks_status || ogVis.looks_source !== gdVis.looks_source) {
      const z = emptyVis('INCOMPARABLE_LOOKS', 'pair', taskId);
      return { og: z, gd: { ...z }, pair: 'INCOMPARABLE_LOOKS' };
    }
    return { og: ogVis, gd: gdVis, pair: ogVis.looks_status };
  }
  const ogVis = await oneSide({
    taskId,
    engine: 'onegame',
    instruction,
    geometry,
    stills: og.stills,
    jobDir: ogJobDir,
    G: ogG,
  });
  const gdVis = await oneSide({
    taskId,
    engine: 'godot',
    instruction,
    geometry,
    stills: gd.stills,
    jobDir: gdJobDir,
    G: gdG,
  });
  return { og: ogVis, gd: gdVis, pair: 'G_ASYMMETRIC' };
}

export function pairComparable(ogRow, gdRow) {
  if (!ogRow.G && !gdRow.G) return { ok: true, reason: 'BOTH_G0' };
  if (ogRow.G !== gdRow.G) return { ok: true, reason: 'G_ASYMMETRIC' };
  if (ogRow.looks_status === 'INCOMPARABLE_VISUAL' || gdRow.looks_status === 'INCOMPARABLE_VISUAL') {
    return { ok: false, reason: 'INCOMPARABLE_VISUAL' };
  }
  if (ogRow.looks_status === 'INCOMPARABLE_LOOKS' || gdRow.looks_status === 'INCOMPARABLE_LOOKS') {
    return { ok: false, reason: 'INCOMPARABLE_LOOKS' };
  }
  if (ogRow.looks_status !== 'OK' || gdRow.looks_status !== 'OK') {
    return { ok: false, reason: `${ogRow.looks_status}/${gdRow.looks_status}` };
  }
  if (ogRow.looks_source !== gdRow.looks_source) {
    return { ok: false, reason: 'looks_source_mismatch' };
  }
  if (ogRow.looks_source !== 'subagent') {
    return { ok: false, reason: `looks_source=${ogRow.looks_source}` };
  }
  return { ok: true, reason: 'OK' };
}

export function suiteComparable(rows, taskIds) {
  const reasons = [];
  for (const id of taskIds) {
    const og = rows.find((r) => r.id === id && r.engine === 'onegame');
    const gd = rows.find((r) => r.id === id && r.engine === 'godot');
    const p = pairComparable(og, gd);
    if (!p.ok) reasons.push({ id, reason: p.reason });
  }
  return { comparable: reasons.length === 0, reasons };
}
