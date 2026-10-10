import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORK_DIR } from '../src/paths.mjs';
import { validateTraces } from '../src/validate-traces.mjs';

test('self-check rejects unsupported engines and non-public task paths before copying', () => {
  for (const [engine, taskId] of [['worker', 'p1-chart-rush'], ['godot', '../judge'], ['godot', 'p0-click-score']]) {
    assert.throws(() => validateTraces({ engine, taskId, workspace: '/missing' }), (err) => err.primary === 'EVAL_INTERNAL');
  }
});

test('self-check rejects an unknown scenario before copying', () => {
  assert.throws(() => validateTraces({ engine: 'godot', taskId: 'p1-chart-rush', workspace: '/missing', scenario: 'ridge' }),
    (err) => err.primary === 'TRACE_INVALID');
});

test('single-scenario self-check audits all traces, reads no hidden rubric and preserves the submission', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-validation-'));
  const files = {
    'game.gd': `extends Node2D\n# ${workspace}\n`, 'game.tscn': '[gd_scene format=3]\n', 'project.godot': 'config_version=5\n',
  };
  for (const [i, scenario] of ['intro', 'loop', 'fail', 'clear', 'clear'].entries()) {
    files[`demo_outputs/${String(i + 1).padStart(2, '0')}_${scenario}.json`] = JSON.stringify({
      schema: 'eval.trace/1', scenario, duration_frames: 40, viewport: { w: 1280, h: 720 },
      events: scenario === 'intro' ? [] : [{ frame: 0, type: 'keydown', code: 'Enter' }],
    });
  }
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(workspace, rel)), { recursive: true });
    fs.writeFileSync(path.join(workspace, rel), body);
  }
  const prior = new Set(fs.readdirSync(WORK_DIR));
  const read = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function (file, ...args) {
    reads.push(String(file));
    return read.call(this, file, ...args);
  };
  try {
    assert.throws(() => validateTraces({ engine: 'godot', taskId: 'p1-chart-rush', workspace, scenario: 'loop' }),
      (err) => err.primary === 'BUILDER_INVALID' && /repeat scenario clear/.test(err.message));
    assert.ok(reads.some((file) => file.endsWith('/p1-chart-rush/task.yaml')));
    assert.ok(reads.every((file) => !/\/judge\/|rubric\.json$/.test(file)), `hidden reads: ${reads}`);
    for (const [rel, body] of Object.entries(files)) assert.equal(read(path.join(workspace, rel), 'utf8'), body);
    assert.equal(fs.existsSync(path.join(workspace, 'REPLAY.json')), false);
  } finally {
    fs.readFileSync = read;
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const name of fs.readdirSync(WORK_DIR)) {
      const copiedScript = path.join(WORK_DIR, name, 'submission', 'game.gd');
      if (!prior.has(name) && name.startsWith('validation-') && fs.existsSync(copiedScript) &&
          read(copiedScript, 'utf8') === files['game.gd']) fs.rmSync(path.join(WORK_DIR, name), { recursive: true, force: true });
    }
  }
});
