import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredScenarios } from '../src/p1-trace.mjs';
import { aggregateObserved, validateRubric } from '../src/rubric.mjs';
import { loadP1Task, P1_TASKS } from '../src/p1-load.mjs';
import { looksEvidenceComplete, normalizeLooksScores, reqAgg } from '../src/looks-rubric.mjs';
import { acceptLooksText, buildLooksStagePrompt } from '../src/subagent-stage.mjs';
import { buildLooksJob } from '../src/looks-judge.mjs';
import { buildLooksUserPrompt } from '../src/looks-rubric.mjs';

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

test('headline rubrics are visible frame criteria', () => {
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(validateRubric(b.rubric).ok, true, id);
    assert.ok(b.rubric.requirements.every((r) => r.scope === 'scenario' || r.scope === 'persistent'));
    for (const req of b.rubric.requirements) {
      if (req.dim === 'V') assert.equal(reqAgg(req), 'mean', `${id} ${req.id}`);
      else assert.equal(reqAgg(req), 'max', `${id} ${req.id}`);
      if (req.dim === 'M' || req.dim === 'D') assert.doesNotMatch(req.description, /机制或种类成立|1 分要求正式素材/);
      if (req.dim === 'V') assert.match(req.description, /静帧平均/);
    }
  }
});

test('a visual item averages every still and rejects a best-frame score', () => {
  const ids = new Set(['intro_f0', 'intro_f44']);
  const rubric = {
    requirements: [
      { id: 'V1', dim: 'V', scope: 'scenario', applies: ['intro'], description: '0 分空 1 分满' },
      { id: 'M1', dim: 'M', scope: 'scenario', applies: ['intro'], description: '0 分无 1 分有' },
    ],
  };
  const split = {
    V1: { score: 0.5, frames: { intro_f0: 0, intro_f44: 1 }, evidence: ['intro_f44'] },
    M1: { score: 1, evidence: ['intro_f0'] },
  };
  assert.equal(looksEvidenceComplete(split, rubric, ids), true);
  assert.equal(normalizeLooksScores(split, rubric, ids).V1, 0.5);
  const best = {
    V1: { score: 1, frames: { intro_f0: 0, intro_f44: 1 }, evidence: ['intro_f44'] },
    M1: { score: 1, evidence: ['intro_f0'] },
  };
  assert.equal(looksEvidenceComplete(best, rubric, ids), false);
  const omitted = {
    V1: { score: 1, frames: { intro_f44: 1 }, evidence: ['intro_f44'] },
    M1: { score: 1, evidence: ['intro_f0'] },
  };
  assert.equal(looksEvidenceComplete(omitted, rubric, ids), false);
  assert.equal(normalizeLooksScores(omitted, rubric, ids).V1, 0);
  assert.equal(reqAgg({ id: 'V9', dim: 'V' }), 'max');
});

test('gameplay readability excludes countdown but counts empty and unreadable play frames', () => {
  const chart = loadP1Task('p1-chart-rush');
  const rubric = { requirements: chart.rubric.requirements.filter((r) => r.id === 'V2') };
  const ids = new Set(['loop_f0', 'loop_f40', 'loop_f80', 'loop_f104', 'loop_f128', 'loop_f152']);
  const verdict = {
    frame_contexts: { loop_f0: 'title', loop_f40: 'countdown', loop_f80: 'countdown', loop_f104: 'play', loop_f128: 'play', loop_f152: 'play' },
    V2: { score: 1, frames: { loop_f0: 0, loop_f40: 0, loop_f80: 0, loop_f104: 1, loop_f128: 1, loop_f152: 1 }, evidence: ['loop_f104'] },
  };
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), true);
  assert.equal(normalizeLooksScores(verdict, rubric, ids).V2, 1);
  const frames = { loop: [...ids].map((id) => ({ id })) };
  assert.equal(acceptLooksText(JSON.stringify({ scenarios: { loop: verdict } }), { frames, rubric }).byScenario.loop.V2, 1);
  // An empty play frame and an unreadable frame both stay in the denominator.
  const bad = structuredClone(verdict);
  bad.V2.frames.loop_f128 = 0;
  bad.V2.frames.loop_f152 = 0;
  bad.frame_contexts.loop_f152 = 'unreadable';
  assert.equal(looksEvidenceComplete(bad, rubric, ids), false);
  bad.V2.score = 0.5;
  assert.equal(looksEvidenceComplete(bad, rubric, ids), true);
  assert.equal(normalizeLooksScores(bad, rubric, ids).V2, 0.5);
  bad.V2.frames.loop_f152 = 1;
  assert.equal(looksEvidenceComplete(bad, rubric, ids), false);
});

test('no gameplay evidence cannot earn readability and cannot omit or mislabel frames', () => {
  const chart = loadP1Task('p1-chart-rush');
  const rubric = { requirements: chart.rubric.requirements.filter((r) => r.id === 'V2') };
  const ids = new Set(['loop_f0', 'loop_f204']);
  const verdict = {
    frame_contexts: { loop_f0: 'title', loop_f204: 'title' },
    V2: { score: 0, frames: { loop_f0: 0, loop_f204: 0 }, evidence: ['loop_f0'] },
  };
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), true);
  assert.equal(normalizeLooksScores(verdict, rubric, ids).V2, 0);
  verdict.V2.score = 1;
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), false);
  verdict.V2.score = 0;
  delete verdict.frame_contexts.loop_f204;
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), false);
  verdict.frame_contexts.loop_f204 = 'skip';
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), false);
  verdict.frame_contexts.loop_f204 = 'play';
  delete verdict.V2.frames.loop_f204;
  assert.equal(looksEvidenceComplete(verdict, rubric, ids), false);
});

test('both looks entry points describe the same gameplay frame window', () => {
  const chart = loadP1Task('p1-chart-rush');
  const stills = [{ id: 'loop_f0', path: '/unused.png' }];
  const job = buildLooksJob({ taskId: chart.task.id, instruction: chart.instruction, rubric: chart.rubric, scenario: 'loop', stills });
  const direct = buildLooksUserPrompt(job);
  const staged = buildLooksStagePrompt({ instruction: chart.instruction, frames: { loop: stills }, items: chart.rubric.requirements });
  for (const prompt of [direct, staged]) {
    assert.match(prompt, /frame_window=play/);
    assert.match(prompt, /frame_contexts/);
    assert.match(prompt, /unreadable/);
    assert.match(prompt, /0\.75/);
  }
});

test('empty fail events do not count as fail coverage', () => {
  const traces = [
    { audit: { ok: true }, trace: { scenario: 'intro', events: [] } },
    { audit: { ok: true }, trace: { scenario: 'loop', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
    { audit: { ok: true }, trace: { scenario: 'fail', events: [] } },
    { audit: { ok: true }, trace: { scenario: 'clear', events: [{ frame: 0, type: 'keydown', code: 'Enter' }] } },
  ];
  assert.deepEqual(missingRequiredScenarios(traces, { required: ['intro', 'loop', 'fail', 'clear'], allowEmpty: ['intro'] }), ['fail']);
});

test('scenario items do not borrow a score from another scene', () => {
  const required = ['intro', 'loop', 'fail', 'clear'];
  const blob = aggregateObserved(
    {
      intro: { M1: 1, M2: 1, M3: 1, M4: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
      loop: { M1: 1, M2: 1, M3: 1, M4: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
    },
    mini,
    required,
  );
  const split = aggregateObserved(
    {
      intro: { M1: 1, V1: 1, A1: 1 },
      loop: { M2: 1, D1: 1, V1: 1, A1: 1, A2: 1 },
      fail: { M3: 0, A1: 1 },
      clear: { M4: 1, A1: 1 },
    },
    mini,
    required,
  );
  assert.equal(blob.items.M3, 0);
  assert.equal(split.items.M3, 0);
  assert.equal(split.items.M4, 1);
  assert.deepEqual(split.missing_scenarios, []);
});

test('a missed scene zeros that item and does not cap the other mechanics', () => {
  const chart = loadP1Task('p1-chart-rush');
  const fin = aggregateObserved(
    {
      intro: { M1: 1, V1: 1, A1: 1 },
      loop: { M2: 1, M3: 1, D1: 1, V2: 0, A1: 1, A2: 1 },
      clear: { M5: 1, M6: 1, D1: 1, D2: 1, A1: 1 },
    },
    chart.rubric,
    chart.task.scenarios.required,
  );
  assert.equal(fin.items.M4, 0);
  assert.equal(fin.items.V2, 0);
  assert.ok(fin.M > 0.5);
  assert.equal(fin.items.A1, 0.75);
  assert.equal(fin.items.D1, 1);
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
