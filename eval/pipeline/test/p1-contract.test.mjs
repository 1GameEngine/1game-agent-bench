import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { P1_TASKS, loadP1Task } from '../src/p1-load.mjs';
import { auditTrace, missingRequiredScenarios, readTraces, REQUIRED_SCENARIOS } from '../src/p1-trace.mjs';
import { applyScenarioCap } from '../src/rubric.mjs';
import { buildCompareScalar } from '../src/p1-report.mjs';
import { assertNoForbiddenScoreKeys } from '../src/util.mjs';
import { loadSuite } from '../src/load.mjs';
import { EVAL_DIR } from '../src/paths.mjs';
import { materializeSubmission } from '../src/materialize-submission.mjs';
import os from 'node:os';
import path from 'node:path';

test('P1 compare_tasks are headline games with hidden rubric and traces', () => {
  const suite = loadSuite();
  assert.equal(suite.headline_track, 'product_100');
  assert.equal(suite.p0_in_headline, false);
  assert.deepEqual(suite.compare_tasks, P1_TASKS);
  assert.deepEqual(P1_TASKS, ['p1-chart-rush']);
  assert.equal(suite.replay.fps, 30);
  assert.equal(suite.replay.traces, 'submitted');
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(b.task.scene.width, 1280);
    assert.equal(b.task.scene.height, 720);
    assert.equal(b.task.judge, 'rubric_replay');
    assert.equal(b.task.traces, 'submitted');
    assert.equal(b.rubric.score_formula, 'G * (40*M + 10*D + 20*V + 30*A)');
    assert.ok(b.rubric.requirements.length >= 8);
    for (const engine of ['onegame', 'godot']) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'submit-'));
      materializeSubmission(id, engine, dir, { replace: true });
      const traces = readTraces(path.join(dir, 'demo_outputs'));
      assert.equal(traces.length, 4);
      assert.equal(traces.every((t) => t.audit.ok), true);
      assert.deepEqual(missingRequiredScenarios(traces), []);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(fs.existsSync(path.join(EVAL_DIR, 'examples', 'oracles', id)), false);
  }
});

test('chart rush looks isolate falling notes from receptor caps', () => {
  const b = loadP1Task('p1-chart-rush');
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.deepEqual(byId.V1.applies, ['intro']);
  assert.deepEqual(byId.V2.applies, ['loop']);
  assert.equal(byId.V2.need, 'all');
  assert.deepEqual(byId.A2.applies, ['loop']);
  assert.equal(byId.A2.need, 'all');
  assert.match(byId.V2.description, /下落/);
  assert.match(byId.A2.description, /底栏/);
  assert.match(b.instruction, /只有底栏没有下落物/);
});

test('P1 builder prompts share body bytes', () => {
  const og = fs.readFileSync(new URL('../../builder.prompt.p1.onegame.md', import.meta.url), 'utf8');
  const gd = fs.readFileSync(new URL('../../builder.prompt.p1.godot.md', import.meta.url), 'utf8');
  const body = fs.readFileSync(new URL('../../builder.prompt.p1.body.md', import.meta.url), 'utf8').trim();
  assert.ok(og.startsWith(body));
  assert.ok(gd.startsWith(body));
  assert.notEqual(og, gd);
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

test('missing required scenarios cap M and D', () => {
  const traces = [{ trace: { scenario: 'intro' } }];
  const capped = applyScenarioCap({ M: 1, D: 1, V: 1, A: 1 }, traces);
  assert.equal(capped.M, 0.5);
  assert.equal(capped.D, 0.5);
  assert.deepEqual(capped.missing_scenarios, REQUIRED_SCENARIOS.filter((s) => s !== 'intro'));
  assert.equal(auditTrace({ schema: 'eval.trace/1' }).ok, false);
});
