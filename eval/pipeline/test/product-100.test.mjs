import test from 'node:test';
import assert from 'node:assert/strict';
import {
  taskScore100,
  scoreAttempt,
  buildProduct100,
  SUITE_TASKS,
  winnerOf,
  P0_TASKS,
} from '../src/product-100.mjs';
import { encodePngRgba, decodePng, nearestNeighborScale, toJudgeStill, STILL_W, STILL_H } from '../src/png-nn.mjs';
import { heuristicFrame } from '../src/looks.mjs';
import { assertNoForbiddenScoreKeys } from '../src/util.mjs';
import { loadSuite } from '../src/load.mjs';

test('suite winner is product_100', () => {
  const suite = loadSuite();
  assert.equal(suite.headline_track, 'product_100');
  assert.equal(SUITE_TASKS.length, 14);
  assert.equal(P0_TASKS.length, 4);
});

test('G=0 zeros the task; missing D renormalizes', () => {
  assert.equal(taskScore100({ G: 0, M: 1, D: 1, V: 1, A: 1, hasD: true }), 0);
  const fullD = taskScore100({ G: 1, M: 1, D: 1, V: 1, A: 1, hasD: true });
  assert.equal(fullD, 100);
  const noD = taskScore100({ G: 1, M: 1, V: 1, A: 1, hasD: false });
  assert.equal(noD, 100);
  const place = taskScore100({ G: 1, M: 1, V: 1, A: 0.5, hasD: false });
  assert.ok(place > 70 && place < 90);
});

test('low M caps A contribution', () => {
  const uncapped = taskScore100({ G: 1, M: 0, V: 1, A: 1, hasD: false });
  const capped = taskScore100({ G: 1, M: 0.4, V: 1, A: 1, hasD: false });
  const halfA = taskScore100({ G: 1, M: 0.4, V: 1, A: 0.5, hasD: false });
  assert.equal(capped, halfA);
  assert.ok(uncapped <= 100);
});

test('buildProduct100 28 rows and winner sentence', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, sliceScores: [1, 1], V: 1, A: 0.5, D: 1, primary: 'PASS', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
    scoreAttempt({ id, engine: 'godot', G: 1, sliceScores: [1, 1], V: 1, A: 1, D: 1, primary: 'CHECKPOINTS_OK', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
  ]);
  const report = buildProduct100({ runId: 'unit', rows });
  assert.equal(report.tasks.length, 28);
  assert.equal(report.winner_engine, 'godot');
  assert.equal(report.comparable, true);
  assert.equal(report.winner, true);
  assert.match(report.winner_sentence, /1Game = /);
  assert.match(report.winner_sentence, /Godot = /);
  assert.ok(!report.winner_sentence.includes('COMPARE_SCALAR'));
  assert.ok(!('overall' in report));
  assert.doesNotThrow(() => assertNoForbiddenScoreKeys(report));
  assert.equal(winnerOf(10, 10), 'tie');
});

test('buildProduct100 withholds winner when looks unpaired', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, sliceScores: [1], V: 1, A: 1, D: 1, primary: 'PASS', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
    scoreAttempt({ id, engine: 'godot', G: 1, sliceScores: [1], V: 0, A: 0, D: 0, primary: 'CHECKPOINTS_OK', g0_ok: 1, looks_status: 'CAPTURE_FAIL', looks_source: 'none' }),
  ]);
  const report = buildProduct100({ runId: 'gap', rows });
  assert.equal(report.comparable, false);
  assert.equal(report.winner, false);
  assert.equal(report.winner_engine, 'incomparable');
  assert.match(report.winner_sentence, /不可比/);
});

test('nearest-neighbor 320x180 -> 1280x720', () => {
  const w = 320;
  const h = 180;
  const rgba = Buffer.alloc(w * h * 4, 0);
  rgba[0] = 255;
  rgba[1] = 0;
  rgba[2] = 0;
  rgba[3] = 255;
  const png = encodePngRgba(w, h, rgba);
  const round = decodePng(png);
  assert.equal(round.width, 320);
  assert.equal(round.rgba[0], 255);
  const up = nearestNeighborScale(round.rgba, 320, 180, 4);
  assert.equal(up.width, STILL_W);
  assert.equal(up.height, STILL_H);
  assert.equal(up.rgba[0], 255);
  const still = toJudgeStill(png);
  assert.equal(still.width, 1280);
  assert.equal(still.scaled, true);
  const hlook = heuristicFrame({
    png: still.png,
    geometry: { regions: { a: { x: 0, y: 0, w: 10, h: 10 } } },
  });
  assert.ok(hlook.A <= 0.5);
});
