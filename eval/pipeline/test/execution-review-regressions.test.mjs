import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { orchestrateEngines } from '../src/subagent-stage.mjs';
import { runExecutionWorker } from '../src/execution-adapter.mjs';
import { EvalError } from '../src/util.mjs';

function prepareIn(dir) {
  return ({ engine }) => {
    const workspace = path.join(dir, engine);
    fs.mkdirSync(workspace, { recursive: true });
    return { workspace, replayRunId: engine, outPath: path.join(dir, `${engine}-out`, 'REPLAY.json') };
  };
}

test('a malformed author trace is a repairable submission error, never an infrastructure failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-syntax-review-'));
  try {
    for (const [file, content] of Object.entries({
      'project.godot': 'config_version=5\n', 'game.gd': 'extends Node2D\n', 'game.tscn': '[gd_scene format=3]\n',
      'demo_outputs/01_intro.json': '{broken-json',
      'demo_outputs/02_loop.json': '{}', 'demo_outputs/03_fail.json': '{}', 'demo_outputs/04_clear.json': '{}',
    })) {
      const dest = path.join(dir, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
    await assert.rejects(runExecutionWorker('audit', { engine: 'godot', taskId: 'p1-chart-rush', workspace: dir }),
      err => err.primary === 'BUILDER_INVALID');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('infrastructure audit failures stop each side without dispatching builder repair or replay', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-infrastructure-review-'));
  const calls = [];
  try {
    const result = await orchestrateEngines({
      taskId: 'p1-chart-rush', runId: 'review-audit-infrastructure', prepare: prepareIn(dir), isolateFailures: true,
      runSubagent: async spec => { calls.push(`${spec.engine}:${spec.role}:${spec.attempt}`); return ''; },
      auditSubmission: async () => { throw new EvalError('EVAL_INTERNAL', 'disk read failure'); },
      bootCheck: () => assert.fail('boot must not follow an infrastructure audit failure'),
    });
    assert.deepEqual(calls.sort(), ['godot:builder:1', 'onegame:builder:1']);
    assert.equal(result.failures.length, 2);
    assert.ok(result.failures.every(failure => failure.primary === 'EVAL_INTERNAL'));
    assert.equal(result.onegame.replay.G, null);
    assert.equal(result.godot.replay.G, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('nonisolated failure still waits until the other engine pipeline has finished writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settled-pipelines-review-'));
  const calls = [];
  try {
    await assert.rejects(orchestrateEngines({
      taskId: 'p1-chart-rush', runId: 'review-all-settled', prepare: prepareIn(dir),
      auditSubmission: () => {}, bootCheck: () => ({ ok: true }),
      runSubagent: async spec => {
        if (spec.engine === 'onegame') throw new EvalError('BUILDER_TIMEOUT', 'first side failed');
        await delay(30);
        calls.push(spec.role);
        if (spec.role === 'replay') throw new EvalError('REPLAY_TIMEOUT', 'partner completed and failed');
        return '';
      },
    }), err => err.primary === 'BUILDER_TIMEOUT');
    assert.deepEqual(calls, ['builder', 'debug', 'replay']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
