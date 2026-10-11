import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess } from '../src/process-supervisor.mjs';
import { auditTrace } from '../src/p1-trace.mjs';
import { runExecutionWorker } from '../src/execution-adapter.mjs';
import { orchestrateEngines } from '../src/subagent-stage.mjs';
import { EvalError } from '../src/util.mjs';
import { buildProduct100 } from '../src/product-100.mjs';
import { initializeReportStore, commitReportCheckpoint, readReportCheckpoint, rebuildProductReports } from '../src/report-store.mjs';

const node = code => [process.execPath, '--input-type=module', '-e', code];
const storeModule = new URL('../src/report-store.mjs', import.meta.url).href;
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const alive = pid => {
  try { return !['Z', 'X'].includes(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]); }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
};
function fixture(t, cleanup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-review-fixes-'));
  t.after(() => { cleanup?.(dir); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function escapedFixture(t) {
  return fixture(t, dir => {
    const pidFile = path.join(dir, 'escaped.json');
    if (fs.existsSync(pidFile)) {
      const pid = json(pidFile);
      if (alive(pid)) process.kill(-pid, 'SIGKILL');
    }
  });
}
async function waitFor(file) {
  const end = Date.now() + 5000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= end) assert.fail(`worker did not reach barrier ${file}`);
    await delay(10);
  }
}

test('an escaped descendant holding output pipes fails within the cleanup bound and cannot claim reclamation', async t => {
  const dir = escapedFixture(t), pidFile = path.join(dir, 'escaped.json');
  const script = `import fs from 'node:fs';import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']});
    fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify(child.pid));child.unref();`;
  const began = Date.now();
  await assert.rejects(runProcess(node(script), { deadline: began + 5000, graceMs: 20, reapMs: 100 }), err => {
    assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
    assert.match(err.message, /output pipes/);
    assert.equal(err.extra.process_result.reason, 'output_pipes_unclosed');
    assert.equal(err.extra.process_result.status, 0);
    assert.equal(err.extra.process_result.cleanup_finished_at, null);
    assert.equal(err.extra.process_result.descendants_cleaned, false);
    assert.ok(err.extra.process_result.cleanup_attempt_finished_at);
    return true;
  });
  assert.ok(Date.now() - began < 2000, 'close wait consumed the execution budget');
  assert.equal(alive(json(pidFile)), true, 'a detached descendant must not be reported as reclaimed');
});

test('a supervisor CLI exits on unclosed inherited pipes without awaiting external cleanup', async t => {
  const dir = escapedFixture(t), pidFile = path.join(dir, 'escaped.json');
  const worker = `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],
    {detached:true,stdio:['ignore','inherit','inherit']});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify(child.pid));child.unref();`;
  const supervisorModule = new URL('../src/process-supervisor.mjs', import.meta.url).href;
  const cli = `import {runProcess} from ${JSON.stringify(supervisorModule)};
    try{await runProcess([process.execPath,'-e',${JSON.stringify(worker)}],{deadline:Date.now()+10000,reapMs:100});}
    catch(error){console.log(JSON.stringify({primary:error.primary,reason:error.extra.process_result.reason}));process.exitCode=1;}`;
  const result = await runProcess(node(cli), { deadline: Date.now() + 3000 });
  assert.equal(result.status, 1);
  assert.equal(result.stopped, false, 'the CLI stayed alive until its outer deadline');
  assert.deepEqual(JSON.parse(result.stdout), { primary: 'SUBAGENT_PROCESS_FAILED', reason: 'output_pipes_unclosed' });
});

const trace = events => ({ schema: 'eval.trace/1', scenario: 'intro', duration_frames: 1,
  viewport: { w: 1280, h: 720 }, events });
const malformedEvents = [null, {}, 'events', [null], [1], ['keydown'], [[]],
  [{ frame: { toString: null }, type: { toString: null } }],
  [{ frame: 0, type: 'click', x: { toString: null, valueOf: null }, y: 2 }]];
test('malformed JSON event shapes produce audit issues instead of conversion or iteration errors', () => {
  for (const events of malformedEvents) {
    const result = auditTrace(trace(events));
    assert.equal(result.ok, false, JSON.stringify(events));
    assert.ok(result.issues.length > 0);
  }
  assert.equal(auditTrace(trace([])).ok, true);
  assert.equal(auditTrace(trace([{ frame: 0, type: 'click', x: '3', y: '4' }])).ok, true,
    'retain existing coordinate acceptance');
});

function submission(workspace, events = null) {
  for (const [rel, text] of Object.entries({
    'project.godot': 'config_version=5\n', 'game.gd': 'extends Node2D\n', 'game.tscn': '[gd_scene format=3]\n',
    'src/game.tsx': 'export default () => null;\n',
    ...Object.fromEntries(['intro', 'loop', 'fail', 'clear'].map((scenario, i) => [
      `demo_outputs/${String(i + 1).padStart(2, '0')}_${scenario}.json`, JSON.stringify({ ...trace(
        events ?? (scenario === 'intro' ? [] : [{ frame: 0, type: 'keydown', code: 'Enter' }])), scenario })])),
  })) {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
  }
}
test('execution audit classifies malformed author event shapes as BUILDER_INVALID', async t => {
  const workspace = fixture(t);
  for (const events of [[null], {}, [{ frame: 0, type: 'click', x: { toString: null, valueOf: null }, y: 2 }]]) {
    submission(workspace, events);
    await assert.rejects(runExecutionWorker('audit', { engine: 'godot', taskId: 'p1-chart-rush', workspace }),
      err => err.primary === 'BUILDER_INVALID');
  }
});

test('malformed author events return to each builder for correction before debug and replay', async t => {
  const dir = fixture(t), calls = [];
  const result = await orchestrateEngines({ taskId: 'p1-chart-rush', runId: 'review-author-repair', isolateFailures: true,
    prepare: ({ engine }) => ({ workspace: path.join(dir, engine), replayRunId: engine,
      outPath: path.join(dir, `${engine}-out`, 'REPLAY.json') }),
    runSubagent: async spec => {
      calls.push({ engine: spec.engine, role: spec.role, attempt: spec.attempt });
      if (spec.role === 'builder') submission(spec.workspace, spec.attempt === 1 ? [null] : null);
      if (spec.role === 'replay') throw new EvalError('REPLAY_TIMEOUT', 'test ends before engine execution');
      return '';
    }, bootCheck: () => ({ ok: true }),
  });
  for (const engine of ['onegame', 'godot']) {
    assert.deepEqual(calls.filter(c => c.engine === engine && c.role === 'builder').map(c => c.attempt), [1, 2]);
    assert.deepEqual(calls.filter(c => c.engine === engine).map(c => c.role), ['builder', 'builder', 'debug', 'replay']);
  }
  assert.ok(result.failures.every(f => f.primary === 'REPLAY_TIMEOUT'));
});

function reportFixture(t) {
  const workDir = fixture(t), runId = 'reports';
  initializeReportStore(runId, { workDir });
  const options = status => ({ workDir, input: { rows: [], packs: [] },
    reports: { 'PRODUCT_100.json': { ...buildProduct100({ runId, rows: [] }), status }, 'RUN_STATE.json': { status } } });
  const accepted = commitReportCheckpoint(runId, options('RUNNING'));
  const lockFile = path.join(workDir, runId, '.report-store', 'projection.lock');
  return { workDir, runId, options, accepted, lockFile };
}

test('empty and stale lock metadata permit rebuilding without replacing the lock inode', t => {
  const f = reportFixture(t), inode = fs.statSync(f.lockFile).ino;
  for (const body of ['', '{partial', JSON.stringify({ pid: process.pid }), JSON.stringify({ pid: 2147483647 })]) {
    fs.writeFileSync(f.lockFile, body);
    assert.equal(rebuildProductReports(f.runId, f).generationId, f.accepted.generation_id);
    assert.equal(fs.statSync(f.lockFile).ino, inode);
  }
});

function heldWriter(f, status) {
  const ready = path.join(f.workDir, 'ready.json'), release = path.join(f.workDir, 'release');
  const code = `import fs from 'node:fs';import {commitReportCheckpoint} from ${JSON.stringify(storeModule)};
    const write=fs.writeFileSync;
    fs.writeFileSync=(file,...args)=>{
      const result=write(file,...args);
      if(String(file).endsWith('CHECKPOINT.json')){
        write(${JSON.stringify(ready)},JSON.stringify({pid:process.pid}));
        const end=Date.now()+8000;
        while(!fs.existsSync(${JSON.stringify(release)})){
          if(Date.now()>end)throw Error('release barrier timed out');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        }
      }
      return result;
    };
    const record=commitReportCheckpoint(${JSON.stringify(f.runId)},${JSON.stringify(f.options(status))});
    console.log(JSON.stringify({status:record.status,generation_id:record.generation_id}));`;
  // Handle a deliberate SIGKILL immediately, before waiting at the test barrier.
  const pending = runProcess(node(code), { deadline: Date.now() + 10000 }).then(value => ({ value }), error => ({ error }));
  return { ready, release, pending };
}

test('competing processes cannot reclaim an active lock or overwrite a committed terminal generation', async t => {
  const f = reportFixture(t), inode = fs.statSync(f.lockFile).ino;
  fs.writeFileSync(f.lockFile, JSON.stringify({ pid: 2147483647 }));
  const writer = heldWriter(f, 'COMPLETE');
  let competing;
  try {
    await waitFor(writer.ready);
    assert.throws(() => commitReportCheckpoint(f.runId, f.options('FAILED')), err => err.primary === 'EVAL_REPORT_BUSY');
    assert.throws(() => rebuildProductReports(f.runId, f), err => err.primary === 'EVAL_REPORT_BUSY');
    assert.equal(readReportCheckpoint(f.runId, f).generation_id, f.accepted.generation_id);
    const competitor = `import {commitReportCheckpoint} from ${JSON.stringify(storeModule)};
      try{commitReportCheckpoint(${JSON.stringify(f.runId)},${JSON.stringify(f.options('FAILED'))});console.log('unexpected-success');}
      catch(error){console.log(error.primary);process.exitCode=1;}`;
    competing = await runProcess(node(competitor), { deadline: Date.now() + 3000 });
    assert.equal(competing.stdout.trim(), 'EVAL_REPORT_BUSY');
  } finally {
    fs.writeFileSync(writer.release, 'release');
    const done = await writer.pending;
    assert.equal(done.error, undefined, done.error?.message);
    assert.equal(done.value.status, 0, done.value.stderr);
  }
  const accepted = readReportCheckpoint(f.runId, f);
  assert.equal(accepted.status, 'COMPLETE');
  assert.throws(() => commitReportCheckpoint(f.runId, f.options('FAILED')), err => err.primary === 'EVAL_REPORT_INVALID');
  assert.equal(rebuildProductReports(f.runId, f).generationId, accepted.generation_id);
  assert.equal(fs.statSync(f.lockFile).ino, inode);
});

test('SIGKILL releases a held report lock and rebuild keeps the last accepted running checkpoint', async t => {
  const f = reportFixture(t), inode = fs.statSync(f.lockFile).ino;
  const writer = heldWriter(f, 'COMPLETE');
  try {
    await waitFor(writer.ready);
    process.kill(-json(writer.ready).pid, 'SIGKILL');
  } finally {
    fs.writeFileSync(writer.release, 'release');
    const done = await writer.pending;
    assert.equal(done.error?.primary, 'SUBAGENT_PROCESS_FAILED');
  }
  assert.equal(rebuildProductReports(f.runId, f).generationId, f.accepted.generation_id);
  assert.equal(readReportCheckpoint(f.runId, f).status, 'RUNNING');
  assert.equal(fs.statSync(f.lockFile).ino, inode);
});

test('a crash after opening the lock file leaves no ownership requiring manual cleanup', async t => {
  const f = reportFixture(t);
  const code = `import fs from 'node:fs';import {rebuildProductReports} from ${JSON.stringify(storeModule)};
    const open=fs.openSync;
    fs.openSync=(file,...args)=>{const fd=open(file,...args);if(String(file).endsWith('projection.lock'))process.kill(process.pid,'SIGKILL');return fd;};
    rebuildProductReports(${JSON.stringify(f.runId)},{workDir:${JSON.stringify(f.workDir)}});`;
  await assert.rejects(runProcess(node(code), { deadline: Date.now() + 3000 }), err => err.primary === 'SUBAGENT_PROCESS_FAILED');
  assert.equal(fs.statSync(f.lockFile).size, 0);
  assert.equal(rebuildProductReports(f.runId, f).generationId, f.accepted.generation_id);
});

test('missing lock utility fails explicitly before updating the accepted report', t => {
  const f = reportFixture(t), before = readReportCheckpoint(f.runId, f).generation_id;
  const previous = process.env.PATH;
  process.env.PATH = path.join(f.workDir, 'no-executables');
  try {
    assert.throws(() => commitReportCheckpoint(f.runId, f.options('FAILED')), err => err.primary === 'EVAL_REPORT_LOCK_FAILED');
  } finally {
    if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous;
  }
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, before);
  assert.equal(rebuildProductReports(f.runId, f).generationId, before);
});
