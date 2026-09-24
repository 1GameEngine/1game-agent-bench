import { reqApplies, reqDim, reqNeed, reqWeight, isAnchor, finalizeObservedScores } from './rubric.mjs';

function eq(actual, expected) {
  if (typeof expected === 'boolean') {
    if (actual === true || actual === 'true') return expected === true;
    if (actual === false || actual === 'false') return expected === false;
    return false;
  }
  if (typeof expected === 'number') return Number(actual) === expected;
  return actual === expected;
}

function num(state, key) {
  const n = Number(state?.[key]);
  return Number.isFinite(n) ? n : null;
}

export function checkPasses(samples, check) {
  const list = samples ?? [];
  const op = check?.op;
  if (op === 'all_eq') return list.length > 0 && list.every((s) => eq(s.state?.[check.key], check.value));
  if (op === 'any_eq') return list.some((s) => eq(s.state?.[check.key], check.value));
  if (op === 'last_eq') return list.length > 0 && eq(list[list.length - 1].state?.[check.key], check.value);
  if (op === 'forbid_eq') return list.every((s) => !eq(s.state?.[check.key], check.value));
  if (op === 'rise') {
    const xs = list.map((s) => num(s.state, check.key)).filter((n) => n != null);
    return xs.length > 0 && Math.max(...xs) > Math.min(...xs);
  }
  if (op === 'any_gt') return list.some((s) => (num(s.state, check.key) ?? -Infinity) > check.value);
  if (op === 'last_gte') return list.length > 0 && (num(list[list.length - 1].state, check.key) ?? -Infinity) >= check.value;
  if (op === 'changed') {
    const vals = list.map((s) => JSON.stringify(s.state?.[check.key] ?? null));
    return new Set(vals).size >= 2;
  }
  if (op === 'before') {
    const hit = list.findIndex((s) => {
      const n = num(s.state, check.key);
      if (n == null) return false;
      if (check.gte != null) return n >= check.gte;
      return n > (check.gt ?? 0);
    });
    if (hit < 0) return false;
    const base = num(list[hit].state, check.then);
    if (base == null) return false;
    return list.slice(hit + 1).some((s) => (num(s.state, check.then) ?? -Infinity) > base);
  }
  if (op === 'before_flag') {
    const hit = list.findIndex((s) => eq(s.state?.[check.key], true));
    if (hit < 0) return false;
    return list.slice(hit).some((s) => eq(s.state?.[check.then], true));
  }
  return false;
}

export function assertionScore(assertion, samples) {
  const checks = assertion?.checks ?? [];
  if (!checks.length || !samples?.length) return 0;
  return checks.every((c) => checkPasses(samples, c)) ? 1 : 0;
}

export function probeRubric(rubric, probe) {
  const ids = new Set((probe?.assertions ?? []).map((a) => a.id));
  return {
    ...rubric,
    requirements: (rubric?.requirements ?? []).filter((r) => ids.has(r.id)),
  };
}

export function visualRubric(rubric) {
  return {
    ...rubric,
    requirements: (rubric?.requirements ?? []).filter((r) => {
      const d = reqDim(r);
      return d === 'V' || d === 'A';
    }),
  };
}

export function validateProbe(probe, rubric) {
  const issues = [];
  const assertions = probe?.assertions;
  if (!Array.isArray(probe?.keys) || !probe.keys.length) issues.push('keys');
  if (!Array.isArray(assertions) || !assertions.length) issues.push('assertions');
  const byId = new Map();
  for (const a of assertions ?? []) {
    if (!a?.id || byId.has(a.id)) issues.push(`id ${a?.id}`);
    byId.set(a.id, a);
    if (!Array.isArray(a.checks) || !a.checks.length) issues.push(`checks ${a?.id}`);
  }
  for (const req of rubric?.requirements ?? []) {
    const dim = reqDim(req);
    if (dim !== 'M' && dim !== 'D') continue;
    const a = byId.get(req.id);
    if (!a) {
      issues.push(`missing ${req.id}`);
      continue;
    }
    const need = a.need === 'all' ? 'all' : 'any';
    if (need !== reqNeed(req)) issues.push(`need ${req.id}`);
    if (isAnchor(req) !== Boolean(a.anchor)) issues.push(`anchor ${req.id}`);
    const reqAppliesSet = [...reqApplies(req)].sort().join(',');
    const got = [...(a.applies ?? [])].sort().join(',');
    if (reqAppliesSet !== got) issues.push(`applies ${req.id}`);
    if (Number(a.weight ?? 1) !== reqWeight(req)) issues.push(`weight ${req.id}`);
  }
  return { ok: issues.length === 0, issues };
}

export function scoreProbe({ probe, rubric, samples, traces, replayedScenarios }) {
  const scoped = probeRubric(rubric, probe);
  const byScenario = {};
  for (const req of scoped.requirements) {
    const assertion = (probe?.assertions ?? []).find((a) => a.id === req.id);
    for (const sc of reqApplies(req)) {
      const rows = (samples ?? [])
        .filter((s) => s.scenario === sc)
        .sort((a, b) => a.frame - b.frame);
      if (!byScenario[sc]) byScenario[sc] = {};
      byScenario[sc][req.id] = assertionScore(assertion, rows);
    }
  }
  const fin = finalizeObservedScores({
    byScenario,
    rubric: scoped,
    traces,
    replayedScenarios,
  });
  return {
    M: fin.M,
    D: fin.D,
    items: fin.items,
    missing_scenarios: fin.missing_scenarios,
    observed_scenarios: fin.observed_scenarios,
    dropped_anchors: fin.dropped_anchors,
  };
}

export function pickState(state, keys) {
  const out = {};
  for (const key of keys ?? []) out[key] = state?.[key];
  return out;
}
