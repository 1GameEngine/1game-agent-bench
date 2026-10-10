import { quantizeLooks, reqAgg } from './looks-rubric.mjs';
import { BANNED_LOOKS_WORDS } from './looks-rubric.mjs';

export { reqAgg };

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
  return null;
}

export function reqWeight(req) {
  const w = Number(req?.weight);
  return Number.isFinite(w) && w > 0 ? w : 1;
}

export function reqScope(req) {
  return req?.scope === 'persistent' ? 'persistent' : 'scenario';
}

export function requirementsForScenario(rubric, scenario) {
  return (rubric?.requirements ?? []).filter((r) => {
    const applies = reqApplies(r);
    return !applies || applies.includes(scenario);
  });
}

function rubricScenarios(rubric) {
  const names = [];
  for (const req of rubric?.requirements ?? []) {
    for (const sc of reqApplies(req) ?? []) {
      if (!names.includes(sc)) names.push(sc);
    }
  }
  return names;
}

export function validateRubric(rubric, opts = {}) {
  const issues = [];
  const scenarios = opts.scenarios ?? rubricScenarios(rubric);
  const sampleFps = opts.sampleFps;
  if (rubric?.score_formula !== 'G * (15*M + 35*D + 15*V + 35*A)') issues.push('formula');
  const reqs = rubric?.requirements;
  if (!Array.isArray(reqs) || reqs.length < 8 || reqs.length > 24) issues.push('size');
  const ids = new Set();
  const dims = new Set();
  for (const req of reqs ?? []) {
    if (!req?.id || ids.has(req.id)) issues.push(`id ${req?.id}`);
    ids.add(req.id);
    const dim = reqDim(req);
    if (!dim) issues.push(`dim ${req.id}`);
    else dims.add(dim);
    if (req.id && dim && req.id[0] !== dim) issues.push(`id-prefix ${req.id}`);
    if (req.scope !== 'scenario' && req.scope !== 'persistent') issues.push(`scope ${req.id}`);
    if (req.agg != null && req.agg !== 'max' && req.agg !== 'mean') issues.push(`agg ${req.id}`);
    if (req.frame_window != null && (req.frame_window !== 'play' || dim !== 'V' || reqAgg(req) !== 'mean')) {
      issues.push(`frame-window ${req.id}`);
    }
    if (!req.description) issues.push(`desc ${req.id}`);
    const description = String(req.description ?? '');
    if (/phase|cursor|clockMs|remainMs/.test(description)) issues.push(`hidden-field ${req.id}`);
    if (!/0\s*分/.test(description) || !/1\s*分/.test(description)) issues.push(`anchors ${req.id}`);
    for (const word of BANNED_LOOKS_WORDS) {
      if (description.includes(word)) issues.push(`engine-word ${req.id}`);
    }
    if (sampleFps) {
      const minMs = 1000 / sampleFps;
      for (const match of description.matchAll(/(\d+)\s*毫秒/g)) {
        if (Number(match[1]) < minMs) issues.push(`timing ${req.id}`);
      }
    }
    const applies = reqApplies(req);
    if (!applies) issues.push(`applies ${req.id}`);
    for (const sc of applies ?? []) {
      if (!scenarios.includes(sc)) issues.push(`applies ${req.id} ${sc}`);
    }
  }
  for (const dim of RUBRIC_DIMS) {
    if (!dims.has(dim)) issues.push(`missing-dim ${dim}`);
  }
  return { ok: issues.length === 0, issues };
}

function persistentItemScore(values) {
  if (!values.length) return 0;
  return roundScore(mean(values), 3);
}

function averageDim(arr) {
  if (!arr.length) return 0;
  const wsum = arr.reduce((a, x) => a + x.w, 0);
  return clamp01(arr.reduce((a, x) => a + x.v * x.w, 0) / wsum);
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
  return {
    M: roundScore(averageDim(by.M), 3),
    D: roundScore(averageDim(by.D), 3),
    V: roundScore(averageDim(by.V), 3),
    A: roundScore(averageDim(by.A), 3),
    items,
  };
}

export function aggregateObserved(byScenario, rubric, requiredScenarios = []) {
  const items = {};
  const by = { M: [], D: [], V: [], A: [] };
  const observed = byScenario ?? {};
  const required = requiredScenarios?.length ? requiredScenarios : rubricScenarios(rubric);
  for (const req of rubric?.requirements ?? []) {
    const applies = reqApplies(req) ?? required;
    let v = 0;
    if (reqScope(req) === 'persistent' || reqAgg(req) === 'mean') {
      const all = applies.map((sc) => (observed[sc] ? quantizeLooks(observed[sc]?.[req.id]) : 0));
      v = persistentItemScore(all);
    } else {
      const present = applies.filter((sc) => observed[sc]).map((sc) => quantizeLooks(observed[sc]?.[req.id]));
      v = present.length ? quantizeLooks(Math.max(...present)) : 0;
    }
    items[req.id] = v;
    const cat = reqDim(req);
    if (by[cat]) by[cat].push({ v, w: reqWeight(req) });
  }
  const observedNames = new Set(Object.keys(observed));
  return {
    M: roundScore(averageDim(by.M), 3),
    D: roundScore(averageDim(by.D), 3),
    V: roundScore(averageDim(by.V), 3),
    A: roundScore(averageDim(by.A), 3),
    items,
    observed_scenarios: Object.keys(observed),
    missing_scenarios: required.filter((sc) => !observedNames.has(sc)),
  };
}

export function aggregateFrameRubric(byScenario, rubric, requiredScenarios) {
  return aggregateObserved(byScenario, rubric, requiredScenarios);
}

export function emptyRubricScores(rubric) {
  const items = {};
  for (const req of rubric?.requirements ?? []) items[req.id] = 0;
  return items;
}
