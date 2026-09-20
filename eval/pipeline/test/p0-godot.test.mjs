import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTaskBundle } from '../src/load.mjs';
import { auditClosedPlayplan } from '../src/p1-closed.mjs';
import { checkpointMatch } from '../src/p1-schema.mjs';
import { loadP0GodotTask, p0ClosedPlayplan, argvStepToClosed } from '../src/p0-godot.mjs';
import { PROCESS_P0_TASKS } from '../src/product-100.mjs';

test('P0 argv playplans project to closed Godot jobs', () => {
  for (const id of PROCESS_P0_TASKS) {
    const bundle = loadTaskBundle(id);
    const closed = p0ClosedPlayplan(bundle);
    const geom = { regions: bundle.geometry.regions ?? {} };
    assert.equal(auditClosedPlayplan(closed, geom).ok, true, id);
    assert.equal(closed.steps[0].checkpoint, 'init');
    assert.equal(closed.steps.at(-1).checkpoint, 'final');
  }
});

test('P0 click maps to named regions', () => {
  const hud = loadTaskBundle('p0-hud-start');
  assert.equal(argvStepToClosed(hud.playplan.steps[0], hud.geometry).click, 'dead');
  assert.equal(argvStepToClosed(hud.playplan.steps[1], hud.geometry).click, 'btn_start');
  const grid = loadTaskBundle('p0-grid-marks');
  assert.equal(argvStepToClosed(grid.playplan.steps[0], grid.geometry).click, 'cell0');
  const click = loadTaskBundle('p0-click-score');
  assert.equal(argvStepToClosed(click.playplan.steps[0], click.geometry).click, 'full');
});

test('P0 Godot bundles load with dump schema and slices', () => {
  const hud = loadP0GodotTask('p0-hud-start');
  assert.equal(hud.schema.$id, 'eval.p0-hud-start/1');
  assert.deepEqual(hud.checkpoint.slices.dead, { phase: 'ready' });
  assert.equal(hud.playplan.steps.some((s) => s.checkpoint === 'dead'), true);
  const cd = loadP0GodotTask('p0-countdown-play');
  assert.equal(cd.playplan.steps.find((s) => s.tick).tick, 188);
});

test('checkpointMatch compares arrays and remainMs_lte', () => {
  assert.deepEqual(
    checkpointMatch({ cells: ['X', 'O', 'X'], turn: 'O' }, { cells: ['X', 'O', 'X'], turn: 'O' }),
    [],
  );
  assert.ok(checkpointMatch({ cells: ['X', 'O', ''] }, { cells: ['X', 'O', 'X'] }).length > 0);
  assert.deepEqual(
    checkpointMatch({ phase: 'playing', remainMs: 0 }, { phase: 'playing' }, { remainMs_lte: 0 }, { isFinal: true }),
    [],
  );
  assert.ok(
    checkpointMatch({ phase: 'playing', remainMs: 16 }, { phase: 'playing' }, { remainMs_lte: 0 }, { isFinal: true })
      .length > 0,
  );
});
