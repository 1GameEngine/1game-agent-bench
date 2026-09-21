import fs from 'node:fs';
import { hasDepth } from './product-100.mjs';
import { scoreVisuals } from './looks-judge.mjs';
import { applyScenarioCap } from './rubric.mjs';

export function stillsComplete(stills) {
  const list = stills ?? [];
  if (!list.length) return false;
  return list.every((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
}

function emptyVis(looks_status, looks_source) {
  return {
    V: 0,
    A: 0,
    M: 0,
    D: 0,
    looks_status,
    looks_source,
  };
}

async function scoreVisualsSide({ taskId, engine, instruction, geometry, stills, jobDir, rubric, traces }) {
  const vis = await scoreVisuals({
    stills: (stills ?? []).filter((s) => s.ok),
    geometry,
    instruction,
    taskId,
    engine,
    jobDir,
    rubric,
  });
  const agg = applyScenarioCap(
    {
      M: vis.M ?? 0,
      D: vis.D ?? vis.D_visual ?? 0,
      V: vis.V ?? 0,
      A: vis.A ?? 0,
      items: vis.items,
    },
    traces,
  );
  return {
    V: agg.V,
    A: agg.A,
    M: agg.M,
    D: agg.D,
    looks_status: vis.looks_status,
    looks_source: vis.source,
    items: vis.items ?? agg.items,
    missing_scenarios: agg.missing_scenarios,
  };
}

export async function scorePairedLooks({
  taskId,
  instruction,
  geometry,
  og,
  gd,
  ogJobDir,
  gdJobDir,
  rubric,
}) {
  const ogG = Boolean(og.G);
  const gdG = Boolean(gd.G);
  if (!ogG && !gdG) {
    const skip = emptyVis('SKIP', 'none');
    return { og: skip, gd: skip, pair: 'BOTH_G0' };
  }
  if (ogG && gdG) {
    if (!stillsComplete(og.stills) || !stillsComplete(gd.stills)) {
      const z = emptyVis('INCOMPARABLE_VISUAL', 'pair');
      return { og: z, gd: { ...z }, pair: 'INCOMPARABLE_VISUAL' };
    }
    const ogVis = await scoreVisualsSide({
      taskId,
      engine: 'onegame',
      instruction,
      geometry,
      stills: og.stills,
      jobDir: ogJobDir,
      rubric,
      traces: og.traces,
    });
    const gdVis = await scoreVisualsSide({
      taskId,
      engine: 'godot',
      instruction,
      geometry,
      stills: gd.stills,
      jobDir: gdJobDir,
      rubric,
      traces: gd.traces,
    });
    if (ogVis.looks_status !== gdVis.looks_status || ogVis.looks_source !== gdVis.looks_source) {
      const z = emptyVis('INCOMPARABLE_LOOKS', 'pair');
      return { og: z, gd: { ...z }, pair: 'INCOMPARABLE_LOOKS' };
    }
    return { og: ogVis, gd: gdVis, pair: ogVis.looks_status };
  }
  const ogVis = ogG
    ? await scoreVisualsSide({
        taskId,
        engine: 'onegame',
        instruction,
        geometry,
        stills: og.stills,
        jobDir: ogJobDir,
        rubric,
        traces: og.traces,
      })
    : emptyVis('SKIP', 'none');
  const gdVis = gdG
    ? await scoreVisualsSide({
        taskId,
        engine: 'godot',
        instruction,
        geometry,
        stills: gd.stills,
        jobDir: gdJobDir,
        rubric,
        traces: gd.traces,
      })
    : emptyVis('SKIP', 'none');
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
