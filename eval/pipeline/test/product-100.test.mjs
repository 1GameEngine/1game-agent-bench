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
  assert.equal(SUITE_TASKS.length, 1);
  assert.deepEqual(SUITE_TASKS, ['p1-chart-rush']);
  assert.equal(P0_TASKS.length, 0);
});

test('G=0 zeros the task; full marks are 100', () => {
  assert.equal(taskScore100({ G: 0, M: 1, D: 1, V: 1, A: 1 }), 0);
  assert.equal(taskScore100({ G: 1, M: 1, D: 1, V: 1, A: 1 }), 100);
  assert.equal(taskScore100({ G: 1, M: 0, D: 1, V: 1, A: 1 }), 85);
});

test('frame scores are not cross-capped', () => {
  const row = scoreAttempt({
    id: 'p1-chart-rush',
    engine: 'onegame',
    G: 1,
    M: 1,
    D: 1,
    V: 0.5,
    A: 0.5,
    primary: 'TRACE_OK',
    g0_ok: 1,
    looks_status: 'OK',
    looks_source: 'subagent',
    looks_items: { V2: 0, A2: 0, M1: 1 },
  });
  assert.equal(row.M, 1);
  assert.equal(row.D, 1);
  assert.equal(row.V, 0.5);
  assert.equal(row.A, 0.5);
  assert.equal(row.product_100, 75);
});

test('equal S with opposite dims is not a suite tie', () => {
  const og = scoreAttempt({
    id: 'p1-chart-rush',
    engine: 'onegame',
    G: 1,
    M: 1,
    D: 1,
    V: 0.5,
    A: 0.5,
    primary: 'TRACE_OK',
    g0_ok: 1,
    looks_status: 'OK',
    looks_source: 'subagent',
  });
  const gd = scoreAttempt({
    id: 'p1-chart-rush',
    engine: 'godot',
    G: 1,
    M: 0.5,
    D: 0.5,
    V: 1,
    A: 1,
    primary: 'TRACE_OK',
    g0_ok: 1,
    looks_status: 'OK',
    looks_source: 'subagent',
  });
  assert.equal(og.product_100, 75);
  assert.equal(gd.product_100, 75);
  const report = buildProduct100({ runId: 'dims', rows: [og, gd] });
  assert.equal(report.winner_engine, 'godot');
  assert.match(report.winner_sentence, /不并列/);
});

test('buildProduct100 rows and winner sentence', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, M: 1, V: 1, A: 0.5, D: 1, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
    scoreAttempt({ id, engine: 'godot', G: 1, M: 1, V: 1, A: 1, D: 1, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
  ]);
  const report = buildProduct100({ runId: 'unit', rows });
  assert.equal(report.tasks.length, SUITE_TASKS.length * 2);
  assert.equal(report.winner_engine, 'godot');
  assert.equal(report.comparable, true);
  assert.equal(report.winner, true);
  assert.match(report.winner_sentence, /1Game = /);
  assert.match(report.winner_sentence, /Godot = /);
  assert.ok(!report.winner_sentence.includes('COMPARE_SCALAR'));
  assert.ok(!('overall' in report));
  assert.doesNotThrow(() => assertNoForbiddenScoreKeys(report));
  assert.equal(winnerOf(10, 10), 'tie');
  assert.equal(report.still.replay_fps, 30);
  assert.equal(report.still.traces, 'submitted');
});

test('pending looks withholds S and says 观感未评', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, M: 1, D: 1, V: null, A: null, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'PENDING', looks_source: 'none' }),
    scoreAttempt({ id, engine: 'godot', G: 1, M: 0.5, D: 0.5, V: null, A: null, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'PENDING', looks_source: 'none' }),
  ]);
  const report = buildProduct100({ runId: 'pending', rows });
  assert.equal(report.looks_phase, 'pending');
  assert.equal(report.product_100.onegame, null);
  assert.equal(report.product_100.godot, null);
  assert.equal(report.comparable, false);
  assert.match(report.winner_sentence, /观感未评/);
  assert.equal(report.tasks[0].M, null);
  assert.equal(report.tasks.find((r) => r.engine === 'godot').D, null);
});

test('incomplete looks evidence withholds S', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, M: 1, D: 1, V: null, A: null, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent' }),
    scoreAttempt({ id, engine: 'godot', G: 1, M: 1, D: 1, V: null, A: null, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent' }),
  ]);
  const report = buildProduct100({ runId: 'evidence', rows });
  assert.equal(report.looks_phase, 'evidence');
  assert.equal(report.product_100.onegame, null);
  assert.match(report.winner_sentence, /观感证据不全/);
});

test('buildProduct100 withholds winner when looks unpaired', () => {
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({ id, engine: 'onegame', G: 1, M: 1, V: 1, A: 1, D: 1, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'OK', looks_source: 'subagent' }),
    scoreAttempt({ id, engine: 'godot', G: 1, M: 0, V: 0, A: 0, D: 0, primary: 'TRACE_OK', g0_ok: 1, looks_status: 'CAPTURE_FAIL', looks_source: 'none' }),
  ]);
  const report = buildProduct100({ runId: 'gap', rows });
  assert.equal(report.comparable, false);
  assert.equal(report.winner, false);
  assert.equal(report.winner_engine, 'incomparable');
  assert.match(report.winner_sentence, /不可比/);
});

test('scoreAttempt records rubric M/D/V/A without dump slices', () => {
  const row = scoreAttempt({
    id: 'p1-chart-rush',
    engine: 'onegame',
    G: 1,
    M: 0.75,
    D: 0.5,
    V: 1,
    A: 0.5,
    primary: 'TRACE_OK',
    g0_ok: 1,
    looks_status: 'OK',
    looks_source: 'subagent',
    scenarios: ['intro', 'loop', 'fail', 'clear'],
  });
  assert.equal(row.M, 0.75);
  assert.equal(row.D, 0.5);
  assert.equal(row.V, 1);
  assert.equal(row.A, 0.5);
  assert.equal(row.product_100, 61.3);
  const withheld = scoreAttempt({
    id: 'p1-chart-rush',
    engine: 'onegame',
    G: 1,
    M: 1,
    D: 1,
    V: 1,
    A: 1,
    primary: 'TRACE_OK',
    g0_ok: 1,
    looks_status: 'OK',
    looks_source: 'heuristic',
  });
  assert.equal(withheld.product_100, null);
  assert.equal(withheld.V, null);
  assert.equal(withheld.A, null);
  assert.equal(withheld.M, null);
  assert.equal(withheld.D, null);
  assert.deepEqual(row.scenarios, ['intro', 'loop', 'fail', 'clear']);
  assert.equal(row.M_pos, undefined);
  assert.equal(row.D_mech, undefined);
});

test('window lock 1280x720; 320x180 stills rejected', () => {
  const w = 1280;
  const h = 720;
  const rgba = Buffer.alloc(w * h * 4, 0);
  rgba[0] = 255;
  rgba[1] = 0;
  rgba[2] = 0;
  rgba[3] = 255;
  const png = encodePngRgba(w, h, rgba);
  const still = toJudgeStill(png);
  assert.equal(still.width, STILL_W);
  assert.equal(still.height, STILL_H);
  assert.equal(still.scaled, false);
  const small = encodePngRgba(320, 180, Buffer.alloc(320 * 180 * 4, 0));
  assert.throws(() => toJudgeStill(small));
  const nn = nearestNeighborScale(decodePng(small).rgba, 320, 180, 4);
  assert.equal(nn.width, STILL_W);
  assert.equal(nn.height, STILL_H);
  const hlook = heuristicFrame({
    png: still.png,
    geometry: { regions: { a: { x: 0, y: 0, w: 10, h: 10 } } },
  });
  assert.ok(hlook.A <= 0.5);
});
