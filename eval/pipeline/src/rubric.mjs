import { quantizeLooks } from './looks-rubric.mjs';
import { REQUIRED_SCENARIOS, missingRequiredScenarios } from './p1-trace.mjs';

export const RUBRIC_DIMS = ['M', 'D', 'V', 'A'];

function mean(vals) {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function roundScore(x, digits = 3) {
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function reqDim(req) {
  const d = String(req?.dim || req?.id || '')[0];
  return RUBRIC_DIMS.includes(d) ? d : null;
}

export function reqApplies(req) {
  if (Array.isArray(req?.applies) && req.applies.length) return req.applies;
  return [...REQUIRED_SCENARIOS];
}

export function reqWeight(req) {
  const w = Number(req?.weight);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

export function reqNeed(req) {
  return req?.need === 'all' ? 'all' : 'any';
}

export function reqScope(req) {
  return req?.scope === 'persistent' ? 'persistent' : 'scenario';
}

export function isAnchor(req) {
  return req?.anchor === true;
}

export function requirementsForScenario(rubric, scenario) {
  return (rubric?.requirements ?? []).filter((r) => reqApplies(r).includes(scenario));
}

export function validateRubric(rubric) {
  const issues = [];
  if (rubric?.score_formula !== 'G * (15*M + 35*D + 15*V + 35*A)') issues.push('formula');
  const reqs = rubric?.requirements;
  if (!Array.isArray(reqs) || reqs.length < 8 || reqs.length > 24) issues.push('size');
  const ids = new Set();
  for (const req of reqs ?? []) {
    if (!req?.id || ids.has(req.id)) issues.push(`id ${req?.id}`);
    ids.add(req.id);
    if (!reqDim(req)) issues.push(`dim ${req.id}`);
    if (req.scope !== 'scenario' && req.scope !== 'persistent') issues.push(`scope ${req.id}`);
    if (!req.description) issues.push(`desc ${req.id}`);
    if (/phase|cursor|clockMs|remainMs/.test(String(req.description))) issues.push(`hidden-field ${req.id}`);
    for (const sc of reqApplies(req)) {
      if (!REQUIRED_SCENARIOS.includes(sc)) issues.push(`applies ${req.id} ${sc}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function aggregateRubric(scores, rubric) {
  const by = { M: [], D: [], V: [], A: [] };
  const items = {};
  for (const req of rubric?.requirements ?? []) {
    const cat = reqDim(req);
    const v = quantizeLooks(scores?.[req.id]);
    items[req.id] = v;
    if (by[cat]) by[cat].push({ v, w: reqWeight(req) });
  }
  const avg = (arr) => {
    if (!arr.length) return 0;
    const wsum = arr.reduce((a, x) => a + x.w, 0);
    return clamp01(arr.reduce((a, x) => a + x.v * x.w, 0) / wsum);
  };
  return {
    M: roundScore(avg(by.M), 3),
    D: roundScore(avg(by.D), 3),
    V: roundScore(avg(by.V), 3),
    A: roundScore(avg(by.A), 3),
    items,
  };
}

export function mergeScenarioScores(byScenario, rubric) {
  const items = {};
  const by = { M: [], D: [], V: [], A: [] };
  for (const req of rubric?.requirements ?? []) {
    const applies = reqApplies(req).filter((sc) => byScenario[sc]);
    const vals = applies.map((sc) => quantizeLooks(byScenario[sc]?.[req.id])).filter((v) => v != null);
    if (!vals.length) continue;
    let v;
    if (reqNeed(req) === 'all') v = Math.min(...vals);
    else v = mean(vals);
    v = quantizeLooks(v);
    items[req.id] = v;
    const cat = reqDim(req);
    if (by[cat]) by[cat].push({ v, w: reqWeight(req) });
  }
  const avg = (arr) => {
    if (!arr.length) return 0;
    const wsum = arr.reduce((a, x) => a + x.w, 0);
    return clamp01(arr.reduce((a, x) => a + x.v * x.w, 0) / wsum);
  };
  return {
    M: roundScore(avg(by.M), 3),
    D: roundScore(avg(by.D), 3),
    V: roundScore(avg(by.V), 3),
    A: roundScore(avg(by.A), 3),
    items,
  };
}

export function dropFailedAnchorScenarios(byScenario, rubric) {
  const kept = { ...byScenario };
  const dropped = [];
  for (const sc of Object.keys(kept)) {
    const anchors = (rubric?.requirements ?? []).filter((r) => isAnchor(r) && reqApplies(r).includes(sc));
    if (!anchors.length) continue;
    const failed = anchors.some((r) => quantizeLooks(kept[sc]?.[r.id]) <= 0);
    if (failed) {
      dropped.push(sc);
      delete kept[sc];
    }
  }
  return { byScenario: kept, dropped };
}

export function applyScenarioCap(agg, traces, opts) {
  const missing = missingRequiredScenarios(traces, opts);
  if (!missing.length) return { ...agg, missing_scenarios: [] };
  return {
    ...agg,
    M: Math.min(agg.M, 0.5),
    D: Math.min(agg.D, 0.5),
    missing_scenarios: missing,
  };
}

export function emptyRubricScores(rubric) {
  const items = {};
  for (const req of rubric?.requirements ?? []) items[req.id] = 0;
  return items;
}

export function aggregateFrameRubric(byScenario, rubric) {
  const items = {};
  const by = { M: [], D: [], V: [], A: [] };
  const observed = byScenario ?? {};
  for (const req of rubric?.requirements ?? []) {
    const applies = reqApplies(req);
    const present = applies
      .filter((sc) => observed[sc])
      .map((sc) => quantizeLooks(observed[sc]?.[req.id]));
    let v = 0;
    if (present.length && reqScope(req) === 'persistent') {
      const all = applies.map((sc) => (observed[sc] ? quantizeLooks(observed[sc]?.[req.id]) : 0));
      v = quantizeLooks(mean(all));
    } else if (present.length) {
      v = quantizeLooks(Math.max(...present));
    }
    items[req.id] = v;
    const cat = reqDim(req);
    if (by[cat]) by[cat].push({ v, w: reqWeight(req) });
  }
  const avg = (arr) => {
    if (!arr.length) return 0;
    const wsum = arr.reduce((a, x) => a + x.w, 0);
    return clamp01(arr.reduce((a, x) => a + x.v * x.w, 0) / wsum);
  };
  return {
    M: roundScore(avg(by.M), 3),
    D: roundScore(avg(by.D), 3),
    V: roundScore(avg(by.V), 3),
    A: roundScore(avg(by.A), 3),
    items,
    observed_scenarios: Object.keys(observed),
    missing_scenarios: [],
  };
}

export function finalizeObservedScores({ byScenario, rubric, traces, replayedScenarios }) {
  const anchored = dropFailedAnchorScenarios(byScenario, rubric);
  const played = Object.keys(anchored.byScenario);
  const agg = mergeScenarioScores(anchored.byScenario, rubric);
  const capped = applyScenarioCap(agg, traces, {
    replayedScenarios,
    observedScenarios: played,
  });
  return { ...capped, observed_scenarios: played, dropped_anchors: anchored.dropped };
}
