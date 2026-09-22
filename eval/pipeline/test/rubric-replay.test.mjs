import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredScenarios, REQUIRED_SCENARIOS } from '../src/p1-trace.mjs';
import {
  dropFailedAnchorScenarios,
  finalizeObservedScores,
  mergeScenarioScores,
  validateRubric,
} from '../src/rubric.mjs';
import { loadP1Task, P1_TASKS } from '../src/p1-load.mjs';
import { assertionScore, scoreProbe, validateProbe } from '../src/probe.mjs';
import { normalizeLooksScores } from '../src/looks-rubric.mjs';

const mini = {
  score_formula: 'G * (40*M + 10*D + 20*V + 30*A)',
  requirements: [
    { id: 'M1', dim: 'M', applies: ['intro'], description: 'title' },
    { id: 'M2', dim: 'M', applies: ['loop'], description: 'play' },
    { id: 'M3', dim: 'M', applies: ['fail'], anchor: true, description: 'fail screen' },
    { id: 'M4', dim: 'M', applies: ['clear'], anchor: true, description: 'clear screen' },
    { id: 'D1', dim: 'D', applies: ['loop'], description: 'depth' },
    { id: 'V1', dim: 'V', applies: ['intro', 'loop'], description: 'layout' },
    { id: 'A1', dim: 'A', applies: ['intro', 'loop', 'fail', 'clear'], description: 'look' },
    { id: 'A2', dim: 'A', applies: ['loop'], description: 'art' },
  ],
};

test('headline rubrics validate dim applies and fail/clear anchors', () => {
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(validateRubric(b.rubric).ok, true, id);
    assert.ok(b.rubric.requirements.every((r) => r.dim));
  }
});

test('empty fail events do not count as fail coverage', () => {
  const traces = [
    { audit: { ok: true }, trace: { scenario: 'intro', events: [] } },
    { audit: { ok: true }, trace: { scenario: 'loop', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
    { audit: { ok: true }, trace: { scenario: 'fail', events: [] } },
    { audit: { ok: true }, trace: { scenario: 'clear', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
  ];
  assert.deepEqual(missingRequiredScenarios(traces), ['fail']);
});

test('per-scenario merge does not let loop frames score fail items', () => {
  const blob = mergeScenarioScores(
    {
      intro: { M1: 1, M2: 1, M3: 1, M4: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
      loop: { M1: 1, M2: 1, M3: 1, M4: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
    },
    mini,
  );
  const split = mergeScenarioScores(
    {
      intro: { M1: 1, V1: 1, A1: 1 },
      loop: { M2: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
      fail: { M3: 0, A1: 1 },
      clear: { M4: 1, A1: 1 },
    },
    mini,
  );
  assert.equal(blob.M, 1);
  assert.ok(split.M < blob.M);
  assert.equal(split.items.M3, 0);
});

test('failed fail-anchor drops scenario and caps M/D', () => {
  const traces = [
    { audit: { ok: true }, trace: { scenario: 'intro', events: [] } },
    { audit: { ok: true }, trace: { scenario: 'loop', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
    { audit: { ok: true }, trace: { scenario: 'fail', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
    { audit: { ok: true }, trace: { scenario: 'clear', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
  ];
  const dropped = dropFailedAnchorScenarios(
    {
      intro: { M1: 1 },
      loop: { M2: 1, D1: 1 },
      fail: { M3: 0 },
      clear: { M4: 1 },
    },
    mini,
  );
  assert.deepEqual(dropped.dropped, ['fail']);
  const fin = finalizeObservedScores({
    byScenario: {
      intro: { M1: 1, V1: 1, A1: 1 },
      loop: { M2: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
      fail: { M3: 0, A1: 1 },
      clear: { M4: 1, A1: 1 },
    },
    rubric: mini,
    traces,
    replayedScenarios: REQUIRED_SCENARIOS,
  });
  assert.ok(fin.missing_scenarios.includes('fail'));
  assert.equal(fin.M, 0.5);
  assert.equal(fin.D, 0.5);
});

test('headline probes match rubric M/D and do not broadcast one mark', () => {
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(validateProbe(b.probe, b.rubric).ok, true, id);
  }
  const chart = loadP1Task('p1-chart-rush');
  const failOnly = scoreProbe({
    probe: chart.probe,
    rubric: chart.rubric,
    samples: [
      { scenario: 'intro', frame: 0, state: { phase: 'ready', remainMs: 0, clockMs: 0, hits: 0, misses: 0, cursor: 0 } },
      { scenario: 'loop', frame: 0, state: { phase: 'countdown', remainMs: 2000, clockMs: 0, hits: 0, misses: 0, cursor: 0 } },
      { scenario: 'loop', frame: 30, state: { phase: 'playing', remainMs: 0, clockMs: 800, hits: 1, misses: 0, cursor: 1 } },
      { scenario: 'fail', frame: 0, state: { phase: 'playing', hits: 0, misses: 0, cursor: 0 } },
      { scenario: 'fail', frame: 40, state: { phase: 'clear', hits: 12, misses: 0, cursor: 16 } },
      { scenario: 'clear', frame: 0, state: { phase: 'countdown', remainMs: 2000, clockMs: 0, hits: 0, misses: 0, cursor: 0 } },
      { scenario: 'clear', frame: 40, state: { phase: 'clear', hits: 16, misses: 0, cursor: 16 } },
    ],
    traces: REQUIRED_SCENARIOS.map((scenario) => ({
      audit: { ok: true },
      trace: { scenario, events: [{ frame: 0, type: 'keydown', code: 'Enter' }] },
    })),
    replayedScenarios: REQUIRED_SCENARIOS,
  });
  assert.ok(failOnly.missing_scenarios.includes('fail'));
  assert.ok(failOnly.M <= 0.5);
  assert.equal(
    assertionScore(chart.probe.assertions.find((a) => a.id === 'M6'), [
      { state: { phase: 'clear', hits: 16, misses: 0, cursor: 16 } },
    ]),
    1,
  );
});

test('rubric looks items without evidence score 0', () => {
  const rubric = {
    requirements: [
      { id: 'V1', description: 'see' },
      { id: 'A1', description: 'art' },
    ],
  };
  const ids = new Set(['loop_f0']);
  const bare = normalizeLooksScores({ V1: 1, A1: 1 }, rubric, ids);
  assert.equal(bare.V1, 0);
  const cited = normalizeLooksScores(
    { V1: { score: 1, evidence: ['loop_f0'] }, A1: { score: 1, evidence: ['other'] } },
    rubric,
    ids,
  );
  assert.equal(cited.V1, 1);
  assert.equal(cited.A1, 0);
});
