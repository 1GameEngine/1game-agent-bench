import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { P1_TASKS, loadP1Task } from '../src/p1-load.mjs';
import { auditClosedPlayplan } from '../src/p1-closed.mjs';
import { buildCompareScalar } from '../src/p1-report.mjs';
import { assertNoForbiddenScoreKeys } from '../src/util.mjs';
import { loadSuite } from '../src/load.mjs';

test('P1 compare_tasks are 10 closed-set tasks', () => {
  const suite = loadSuite();
  assert.equal(suite.headline_track, 'product_100');
  assert.equal(suite.p0_in_headline, false);
  assert.deepEqual(suite.compare_tasks, P1_TASKS);
  assert.equal(P1_TASKS.length, 10);
  for (const id of P1_TASKS) {
    const b = loadP1Task(id);
    assert.equal(auditClosedPlayplan(b.playplan, b.geometry).ok, true);
    assert.equal(auditClosedPlayplan(b.playplanNeg, b.geometry).ok, true);
  }
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
      { id: 'p1-a', engine: 'onegame', primary: 'CHECKPOINTS_OK', g0_ok: 1 },
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
