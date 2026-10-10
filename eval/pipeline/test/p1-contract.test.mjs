import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { P1_TASKS, loadP1Task } from '../src/p1-load.mjs';
import { auditTrace, missingRequiredScenarios } from '../src/p1-trace.mjs';
import { aggregateObserved } from '../src/rubric.mjs';
import { buildCompareScalar } from '../src/p1-report.mjs';
import { assertNoForbiddenScoreKeys } from '../src/util.mjs';
import { loadSuite } from '../src/load.mjs';
import { EVAL_DIR } from '../src/paths.mjs';
import path from 'node:path';

test('P1 compare_tasks are headline games with hidden rubric and traces', () => {
  const suite = loadSuite();
  assert.equal(suite.headline_track, 'product_100');
  assert.equal(suite.p0_in_headline, false);
  assert.deepEqual(suite.compare_tasks, P1_TASKS);
  assert.deepEqual(P1_TASKS, ['p1-chart-rush', 'p1-depot-skirmish', 'p1-tower-defense']);
  assert.equal(suite.replay.fps, 30);
  assert.equal(suite.replay.traces, 'submitted');
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(b.task.scene.width, 1280);
    assert.equal(b.task.scene.height, 720);
    assert.equal(b.task.judge, 'rubric_replay');
    assert.equal(b.task.traces, 'submitted');
    assert.equal(b.rubric.score_formula, 'G * (15*M + 35*D + 15*V + 35*A)');
    assert.ok(b.rubric.requirements.length >= 8);
    assert.equal(fs.existsSync(path.join(EVAL_DIR, 'tasks', id, 'judge', 'probe.json')), false);
    assert.equal(fs.existsSync(path.join(EVAL_DIR, 'examples')), false);
    assert.equal(fs.existsSync(path.join(EVAL_DIR, 'pipeline', 'src', 'materialize-submission.mjs')), false);
  }
});

test('chart rush looks isolate falling notes from receptor caps', () => {
  const b = loadP1Task('p1-chart-rush');
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.deepEqual(byId.V1.applies, ['intro']);
  assert.deepEqual(byId.V2.applies, ['loop']);
  assert.equal(byId.V2.scope, 'scenario');
  assert.deepEqual(byId.A2.applies, ['loop']);
  assert.equal(byId.A2.scope, 'scenario');
  assert.equal(byId.A1.scope, 'persistent');
  assert.doesNotMatch(JSON.stringify(b.rubric), /phase|cursor|clockMs|remainMs/);
  assert.match(byId.V2.description, /下落/);
  assert.match(byId.A2.description, /底栏/);
  assert.match(byId.D2.description, /方向键图/);
  assert.doesNotMatch(byId.M1.description, /纯色块|正式素材/);
  assert.equal(byId.V2.frame_window, 'play');
  assert.equal(byId.V3.frame_window, 'play');
  assert.equal(byId.V1.frame_window, undefined);
  assert.match(b.instruction, /文字与几何图形/);
  assert.equal(byId.V2.agg, 'mean');
  assert.equal(byId.D1.agg, 'max');
  assert.match(b.instruction, /只有底栏没有下落物/);
});

test('P1 builder prompts share body bytes', () => {
  const og = fs.readFileSync(new URL('../../builder.prompt.p1.onegame.md', import.meta.url), 'utf8');
  const gd = fs.readFileSync(new URL('../../builder.prompt.p1.godot.md', import.meta.url), 'utf8');
  const body = fs.readFileSync(new URL('../../builder.prompt.p1.body.md', import.meta.url), 'utf8').trim();
  assert.ok(og.startsWith(body));
  assert.ok(gd.startsWith(body));
  assert.notEqual(og, gd);
  assert.match(body, /提交前自己调试/);
  assert.match(body, /duration_frames/);
  assert.match(body, /每一帧都画出当时的画面/);
  assert.doesNotMatch(body, /1Game|Godot|1gameplay|CharacterBody/);
});

test('COMPARE_SCALAR forbids overall and uses attempts denominator', () => {
  const report = buildCompareScalar({
    runId: 't',
    attempts: [
      { id: 'p1-a', engine: 'onegame', primary: 'TRACE_OK', g0_ok: 1 },
      { id: 'p1-a', engine: 'godot', primary: 'BOOT_FAIL', g0_ok: 0 },
    ],
  });
  assert.equal(report.headline, '1/2');
  assert.equal(report.checkpoints_ok, 1);
  assert.equal(report.attempts, 2);
  assert.equal(report.g0_conditional, '1/1');
  assert.equal(report.winner, false);
  assert.ok(!('overall' in report));
  assert.throws(() => assertNoForbiddenScoreKeys({ overall: 1 }));
});

test('missing fail scenario zeros that item and lowers a persistent score', () => {
  const chart = loadP1Task('p1-chart-rush');
  const traces = [{ audit: { ok: true }, trace: { scenario: 'intro', events: [] } }];
  assert.deepEqual(
    missingRequiredScenarios(traces, { required: chart.task.scenarios.required, allowEmpty: chart.task.scenarios.allow_empty }),
    ['loop', 'fail', 'clear'],
  );
  const fin = aggregateObserved(
    {
      intro: { M1: 1, V1: 1, A1: 1 },
      loop: { M2: 1, M3: 1, D1: 1, V2: 1, A1: 1, A2: 1 },
      clear: { M5: 1, M6: 1, D1: 1, D2: 1, A1: 1 },
    },
    chart.rubric,
    chart.task.scenarios.required,
  );
  assert.equal(fin.items.M4, 0);
  assert.deepEqual(fin.missing_scenarios, ['fail']);
  assert.equal(fin.items.A1, 0.75);
  assert.equal(fin.items.D1, 1);
  assert.ok(fin.M > 0.5);
  const soft = aggregateObserved(
    {
      intro: { A1: 1 },
      loop: { A1: 1 },
      fail: { A1: 0.5 },
      clear: { A1: 1 },
    },
    chart.rubric,
    chart.task.scenarios.required,
  );
  assert.equal(soft.items.A1, 0.875);
  assert.deepEqual(soft.missing_scenarios, []);
  const zeroed = aggregateObserved(
    {
      intro: { A1: 1 },
      loop: { A1: 1 },
      fail: { A1: 1 },
      clear: { A1: 0 },
    },
    chart.rubric,
    chart.task.scenarios.required,
  );
  assert.equal(zeroed.items.A1, 0.75);
  assert.equal(auditTrace({ schema: 'eval.trace/1' }).ok, false);
});

function demoTrace(events) {
  return {
    schema: 'eval.trace/1',
    scenario: 'loop',
    duration_frames: 10,
    viewport: { w: 1280, h: 720 },
    events,
  };
}

test('trace keys are rising edges and may stay down at the end', () => {
  const repeat = auditTrace(demoTrace([
    { frame: 0, type: 'keydown', code: 'ArrowLeft' },
    { frame: 2, type: 'keydown', code: 'ArrowLeft' },
  ]));
  assert.equal(repeat.ok, false);
  assert.ok(repeat.issues.includes('key repeat without keyup ArrowLeft'));
  const released = auditTrace(demoTrace([
    { frame: 0, type: 'keydown', code: 'ArrowLeft' },
    { frame: 1, type: 'keyup', code: 'ArrowLeft' },
    { frame: 2, type: 'keydown', code: 'ArrowLeft' },
  ]));
  assert.equal(released.ok, true);
  const bareUp = auditTrace(demoTrace([{ frame: 0, type: 'keyup', code: 'ArrowLeft' }]));
  assert.equal(bareUp.ok, false);
  assert.ok(bareUp.issues.includes('keyup without keydown ArrowLeft'));
  const held = auditTrace(demoTrace([{ frame: 0, type: 'keydown', code: 'Enter' }]));
  assert.equal(held.ok, true);
});
