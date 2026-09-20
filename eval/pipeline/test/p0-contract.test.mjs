import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPlayplanStep, allowedClickCenters, auditReplayArgv } from '../src/argv-audit.mjs';
import { loadArgvRules, loadSuite, loadTaskBundle } from '../src/load.mjs';
import { subsetMatch, compareCheckpointSlice } from '../src/compare.mjs';
import { assertNoForbiddenScoreKeys } from '../src/util.mjs';
import { buildReport } from '../src/report.mjs';
import { primaryOf } from '../src/verdict.mjs';
import { auditBadTickFixture } from '../src/cli.mjs';

const rules = loadArgvRules();

test('suite.yaml P0 contract', () => {
  const suite = loadSuite();
  assert.equal(suite.headline_track, 'product_100');
  assert.equal(suite.p0_in_headline, false);
  assert.equal(suite.scoring.overall, 'forbidden');
  assert.equal(suite.scoring.product_100, 'required');
});

test('ingested P0 playplans pass argv audit', () => {
  for (const id of ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play']) {
    assert.doesNotThrow(() => loadTaskBundle(id));
  }
});

test('click 160,90 allowed on full viewport', () => {
  const bundle = loadTaskBundle('p0-click-score');
  const r = auditPlayplanStep(
    ['1gameplay', 'step', 'out/eval.1gamerecord', '--click', '160,90'],
    { rules, allowedClicks: bundle.allowedClicks, recordRel: 'out/eval.1gamerecord' },
  );
  assert.equal(r.ok, true);
});

test('frozen 50,20 allowed on hud; click+until forbidden', () => {
  const bundle = loadTaskBundle('p0-hud-start');
  assert.ok(bundle.allowedClicks.has('50,20'));
  assert.ok(bundle.allowedClicks.has('160,90'));
  const bad = auditPlayplanStep(
    ['1gameplay', 'step', 'out/eval.1gamerecord', '--click', '160,90', '--until', 'x'],
    { rules, allowedClicks: bundle.allowedClicks, recordRel: 'out/eval.1gamerecord' },
  );
  assert.equal(bad.ok, false);
});

test('tick --ms 3008 rejected', () => {
  const r = auditBadTickFixture();
  assert.equal(r.ok, false);
});

test('tick must include --ms 16', () => {
  const r = auditPlayplanStep(['1gameplay', 'step', 'out/eval.1gamerecord', '--repeat', '2'], {
    rules,
    allowedClicks: new Set(),
    recordRel: 'out/eval.1gamerecord',
  });
  assert.equal(r.ok, false);
});

test('judge screenshot argv is violation', () => {
  const r = auditReplayArgv(['1gameplay', 'frame', 'screenshot', 'out/eval.1gamerecord'], {
    rules,
    allowedClicks: new Set(),
    recordRel: 'out/eval.1gamerecord',
    role: 'judge',
  });
  assert.equal(r.ok, false);
});

test('capture screenshot argv ok; replay screenshot rejected', () => {
  const cap = auditReplayArgv(
    [
      '1gameplay',
      'frame',
      'screenshot',
      'out/eval.1gamerecord',
      '--at',
      'last',
      '--out',
      'out/freeze.png',
      '--width',
      '320',
      '--height',
      '180',
      '--format',
      'png',
      '--dpr',
      '1',
    ],
    {
      rules,
      allowedClicks: new Set(),
      recordRel: 'out/eval.1gamerecord',
      role: 'capture',
    },
  );
  assert.equal(cap.ok, true);
  const replay = auditReplayArgv(['1gameplay', 'frame', 'screenshot', 'out/eval.1gamerecord', '--at', 'last', '--out', 'x.png'], {
    rules,
    allowedClicks: new Set(),
    recordRel: 'out/eval.1gamerecord',
    role: 'replay',
  });
  assert.equal(replay.ok, false);
});

test('deep subset: extra keys ok; array elements ===', () => {
  assert.deepEqual(subsetMatch({ phase: 'playing', score: 3 }, { phase: 'playing', score: 3, extra: 1 }), []);
  assert.ok(subsetMatch({ cells: ['X', 'O', 'X'] }, { cells: ['X', 'O', 'O'] }).length > 0);
});

test('remainMs_lte only on final', () => {
  const errs = compareCheckpointSlice({ phase: 'playing' }, { phase: 'playing', remainMs: 0 }, { remainMs_lte: 0 }, {
    isFinal: true,
  });
  assert.deepEqual(errs, []);
  const bad = compareCheckpointSlice({ phase: 'playing' }, { phase: 'playing', remainMs: 16 }, { remainMs_lte: 0 }, {
    isFinal: true,
  });
  assert.ok(bad.length > 0);
});

test('report forbids overall/total_score/vlm_*', () => {
  assert.throws(() => assertNoForbiddenScoreKeys({ overall: 0.5 }));
  assert.throws(() => assertNoForbiddenScoreKeys({ total_score: 4 }));
  assert.throws(() => assertNoForbiddenScoreKeys({ vlm_art: 1 }));
  const report = buildReport({
    runId: 'unit',
    taskRows: ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play'].map((id) => ({
      id,
      create_ok: 1,
      replay_ok: 1,
      store_match: 1,
      argv_ok: 1,
      hygiene_ok: 1,
    })),
  });
  assert.equal(report.report_id, 'P0_unit');
  assert.equal(report.comparable_to_godot, false);
  assert.equal(report.headline_track, 'none');
  assert.equal(report.passed_tasks, 4);
  assert.ok(!('overall' in report));
});

test('primary mapping', () => {
  assert.equal(primaryOf({ create_ok: 0, replay_ok: 0, store_match: 0, argv_ok: 1, hygiene_ok: 1 }), 'CREATE_FAIL');
  assert.equal(
    primaryOf({ create_ok: 0, bindstore_empty: true, replay_ok: 0, store_match: 0, argv_ok: 1, hygiene_ok: 1 }),
    'BINDSTORE_EMPTY',
  );
  assert.equal(
    primaryOf({ create_ok: 1, bindstore_empty: true, replay_ok: 0, store_match: 0, argv_ok: 1, hygiene_ok: 1 }),
    'BINDSTORE_EMPTY',
  );
  assert.equal(
    primaryOf({
      create_ok: 1,
      replay_ok: 1,
      store_match: 1,
      argv_ok: 1,
      hygiene_ok: 1,
    }),
    'PASS',
  );
});

test('geometry centers', () => {
  const c = allowedClickCenters({
    regions: { full: { x: 0, y: 0, w: 320, h: 180 } },
    frozen_click_centers: [],
  });
  assert.ok(c.has('160,90'));
});
