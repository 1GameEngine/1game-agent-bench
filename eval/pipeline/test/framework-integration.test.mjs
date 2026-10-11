import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { waitCloudModel, runCloudAgentSubagent } from '../src/cloud-agent-subagent.mjs';
import { publishStageResponse } from '../src/stage-close.mjs';
import { defaultRunSubagent } from '../src/subagent-stage.mjs';
import { runProcess } from '../src/process-supervisor.mjs';
import { executionPolicy } from '../src/execution-policy.mjs';
import { WORK_DIR } from '../src/paths.mjs';
import { buildProduct100 } from '../src/product-100.mjs';
import { initializeReportStore, commitReportCheckpoint, readReportCheckpoint } from '../src/report-store.mjs';

test('real replay supervision leaves the cloud receipt bridge responsive', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'responsive-bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = { role: 'builder', engine: 'godot', taskId: 'p1-chart-rush', workspace: dir };
  const agent = waitCloudModel(spec, { env: { EVAL_CLOUD_TASK_DIR: dir,
    EVAL_DISPATCH_TIMEOUT_MS: '5000', EVAL_BUILDER_TIMEOUT_MS: '5000' } });
  const req = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.request.json')))));
  const timer = setTimeout(() => {
    fs.writeFileSync(req.lifecycle.start_path + '.tmp', JSON.stringify({ id: req.id, started_at: new Date().toISOString() }));
    fs.renameSync(req.lifecycle.start_path + '.tmp', req.lifecycle.start_path);
    publishStageResponse({ timingPath: req.lifecycle.timing_path, data: { stdout: 'real-receipt', exitCode: 0 } });
  }, 100);
  let replayComplete = false;
  const replay = runCloudAgentSubagent({ role: 'replay', engine: 'onegame', taskId: spec.taskId,
    replay: { argv: [process.execPath, '-e', 'setTimeout(()=>process.stdout.write("process-only"),900)'] } })
    .then(value => { replayComplete = true; return value; });
  try {
    assert.equal(await agent, 'real-receipt');
    assert.equal(replayComplete, false, 'replay blocked cloud start/publication polling');
    assert.equal(await replay, 'process-only');
    const timing = JSON.parse(fs.readFileSync(req.lifecycle.timing_path));
    assert.equal(timing.execution_status, 'COMPLETED');
    assert.ok(Date.parse(timing.response_published_at) <= Date.parse(timing.response_observed_at));
  } finally { clearTimeout(timer); await Promise.allSettled([agent, replay]); }
});

test('external process transport preserves truthful negatives and hard timeout names', async (t) => {
  const keys = ['EVAL_SUBAGENT_CMD', 'EVAL_SUBAGENT_ARGS', 'EVAL_BUILDER_TIMEOUT_MS'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key];
  } });
  process.env.EVAL_SUBAGENT_CMD = process.execPath;
  process.env.EVAL_BUILDER_TIMEOUT_MS = '5000';
  process.env.EVAL_SUBAGENT_ARGS = JSON.stringify(['-e', `
    const spec=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
    if ('_signal' in spec || '_onLifecycle' in spec) throw Error('private runtime fields leaked');
    process.stdout.write(JSON.stringify({stdout:'',exitCode:1,failure:{kind:'validation_incomplete',message:'actual diagnostic'}}));
    process.exitCode=1;
  `]);
  const spec = { role: 'builder', engine: 'godot', taskId: 'p1-chart-rush', workspace: os.tmpdir() };
  await assert.rejects(defaultRunSubagent(spec), error => error.primary === 'STAGE_VALIDATION_INCOMPLETE');
  process.env.EVAL_BUILDER_TIMEOUT_MS = '200';
  process.env.EVAL_SUBAGENT_ARGS = JSON.stringify(['-e', 'setInterval(()=>{},1000)']);
  await assert.rejects(defaultRunSubagent(spec), error => error.primary === 'BUILDER_TIMEOUT');
});

test('cloud cancellation retains an inactive request without publishing a replacement receipt', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancelled-bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  const pending = waitCloudModel({ role: 'debug', engine: 'godot', taskId: 'p1-chart-rush', workspace: dir },
    { env: { EVAL_CLOUD_TASK_DIR: dir }, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.primary === 'SUBAGENT_PROCESS_FAILED');
  const request = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.endsWith('.request.json')))));
  const timing = JSON.parse(fs.readFileSync(request.lifecycle.timing_path));
  assert.equal(timing.state, 'FAILED');
  assert.equal(timing.execution_status, 'FAILED');
  assert.equal(fs.existsSync(request.lifecycle.response_path), false);
  assert.throws(() => publishStageResponse({ timingPath: request.lifecycle.timing_path, data: { stdout: '', exitCode: 0 } }),
    error => error.primary === 'SUBAGENT_INVALID');
});

test('report CLI repairs corrupt projections from the canonical generation without re-evaluation', async (t) => {
  const runId = `framework-cli-${randomBytes(8).toString('hex')}`;
  const dir = path.join(WORK_DIR, runId);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initializeReportStore(runId, { executionPolicy: executionPolicy({}) });
  const report = { ...buildProduct100({ runId, rows: [] }), status: 'FAILED' };
  const saved = commitReportCheckpoint(runId, { input: { rows: [], packs: [] },
    reports: { 'PRODUCT_100.json': report, 'RUN_STATE.json': { status: 'FAILED' } },
    taskResults: { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'REPLAY_TIMEOUT' } } });
  fs.writeFileSync(path.join(dir, 'PRODUCT_100.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'tasks/p1-chart-rush/RESULT.json'), '{broken');
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  for (const command of ['rebuild-product-reports', 'emit-scoreboard']) {
    const result = await runProcess([process.execPath, cli, command, '--run-id', runId], { deadline: Date.now() + 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readReportCheckpoint(runId).generation_id, saved.generation_id);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'PRODUCT_100.json'))), saved.reports['PRODUCT_100.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tasks/p1-chart-rush/RESULT.json'))), saved.task_results['p1-chart-rush']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'RUN_STATE.json'))).status, 'FAILED');
  }
});
