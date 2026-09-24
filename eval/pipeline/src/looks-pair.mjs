import fs from 'node:fs';
import path from 'node:path';
import { scoreVisuals } from './looks-judge.mjs';
import { finalizeObservedScores } from './rubric.mjs';
import { capLooksStills, groupStillsByScenario } from './p1-trace.mjs';
import { requirementsForScenario } from './rubric.mjs';
import { visualRubric } from './probe.mjs';

export function stillsComplete(stills) {
  const list = stills ?? [];
  if (!list.length) return false;
  return list.every((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
}

export function scenarioStillsMap(stills) {
  const by = groupStillsByScenario(stills ?? []);
  const out = {};
  for (const [sc, list] of by) {
    out[sc] = list.filter((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
  }
  return out;
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

async function scoreVisualsSide({
  taskId,
  engine,
  instruction,
  geometry,
  stills,
  jobDir,
  rubric,
  traces,
  replayed_scenarios,
}) {
  const visRubric =
    Array.isArray(rubric?.requirements) && rubric.requirements.length ? rubric : visualRubric(rubric);
  const by = scenarioStillsMap(stills);
  const scenarios = Object.keys(by).filter((sc) => by[sc].length);
  if (!scenarios.length) {
    return { ...emptyVis('CAPTURE_FAIL', 'none'), sample_policy: 'none' };
  }
  const byScenario = {};
  let looks_status = 'OK';
  let looks_source;
  const policies = [];
  for (const sc of scenarios) {
    if (!requirementsForScenario(visRubric, sc).length) continue;
    const capped = capLooksStills(by[sc]);
    policies.push(capped.sample_policy);
    const vis = await scoreVisuals({
      stills: capped.stills,
      geometry,
      instruction,
      taskId,
      engine,
      jobDir: jobDir ? path.join(jobDir, sc) : undefined,
      rubric: visRubric,
      scenario: sc,
      sample_policy: capped.sample_policy,
    });
    looks_source = vis.source;
    if (vis.looks_status !== 'OK') {
      looks_status = vis.looks_status;
      looks_source = vis.source;
      break;
    }
    byScenario[sc] = vis.items ?? {};
  }
  if (looks_status !== 'OK') {
    return { ...emptyVis(looks_status, looks_source ?? 'none'), sample_policy: policies[0] };
  }
  const uniqPolicy = [...new Set(policies)];
  const sample_policy = uniqPolicy.length === 1 ? uniqPolicy[0] : uniqPolicy.join(',');
  const agg = finalizeObservedScores({
    byScenario,
    rubric: visRubric,
    traces,
    replayedScenarios: replayed_scenarios,
  });
  return {
    V: agg.V,
    A: agg.A,
    M: agg.M,
    D: agg.D,
    looks_status: 'OK',
    looks_source,
    items: agg.items,
    missing_scenarios: agg.missing_scenarios,
    observed_scenarios: agg.observed_scenarios,
    sample_policy,
    jobs: scenarios.length,
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
    const ogKeys = Object.keys(scenarioStillsMap(og.stills)).sort().join(',');
    const gdKeys = Object.keys(scenarioStillsMap(gd.stills)).sort().join(',');
    if (ogKeys !== gdKeys) {
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
      replayed_scenarios: og.replayed_scenarios,
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
      replayed_scenarios: gd.replayed_scenarios,
    });
    if (ogVis.looks_status !== gdVis.looks_status || ogVis.looks_source !== gdVis.looks_source) {
      const z = emptyVis('INCOMPARABLE_LOOKS', 'pair');
      return { og: z, gd: { ...z }, pair: 'INCOMPARABLE_LOOKS' };
    }
    if (ogVis.sample_policy !== gdVis.sample_policy || ogVis.jobs !== gdVis.jobs) {
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
        replayed_scenarios: og.replayed_scenarios,
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
        replayed_scenarios: gd.replayed_scenarios,
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
