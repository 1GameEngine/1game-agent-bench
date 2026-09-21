import { quantizeLooks } from './looks-rubric.mjs';
import { missingRequiredScenarios } from './p1-trace.mjs';

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

export function aggregateRubric(scores, rubric) {
  const by = { M: [], D: [], V: [], A: [] };
  const items = {};
  for (const req of rubric?.requirements ?? []) {
    const cat = String(req.id || '')[0];
    const v = quantizeLooks(scores?.[req.id]);
    items[req.id] = v;
    if (by[cat]) by[cat].push(v);
  }
  const avg = (arr) => (arr.length ? clamp01(mean(arr)) : 0);
  return {
    M: roundScore(avg(by.M), 3),
    D: roundScore(avg(by.D), 3),
    V: roundScore(avg(by.V), 3),
    A: roundScore(avg(by.A), 3),
    items,
  };
}

export function applyScenarioCap(agg, traces) {
  const missing = missingRequiredScenarios(traces);
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
