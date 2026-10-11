import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process-supervisor.mjs';

const argv = code => [process.execPath, '-e', code];
const deadline = () => Date.now() + 5000;
function alive(pid) {
  try { return !['Z', 'X'].includes(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]); }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

test('a synchronous worker cannot block another command or the supervisor polling timer', async () => {
  let polls = 0, slowDone = false;
  const timer = setInterval(() => { polls++; }, 20);
  const nested = 'setTimeout(()=>{},700)';
  const slow = runProcess(argv(`require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(nested)}]);`),
    { deadline: deadline() }).then(result => { slowDone = true; return result; });
  try {
    const fast = await runProcess(argv('process.stdout.write("fast")'), { deadline: deadline() });
    assert.equal(fast.stdout, 'fast');
    assert.equal(slowDone, false);
    assert.equal((await slow).status, 0);
    assert.ok(polls >= 5, `supervisor polling only ran ${polls} times`);
  } finally { clearInterval(timer); await slow; }
});

test('stdin JSON and ordinary nonzero exit are preserved with execution and cleanup timestamps', async () => {
  const input = JSON.stringify({ text: '中文'.repeat(20000), number: 17 });
  const result = await runProcess(argv('process.stdout.write(require("node:fs").readFileSync(0));process.stderr.write("diagnostic");process.exitCode=7'),
    { deadline: deadline(), input });
  assert.equal(result.stdout, input);
  assert.equal(result.stderr, 'diagnostic');
  assert.equal(result.status, 7);
  assert.equal(result.stopped, false);
  assert.ok(Date.parse(result.started_at) <= Date.parse(result.finished_at));
  assert.ok(Date.parse(result.finished_at) <= Date.parse(result.cleanup_finished_at));
});

test('hard timeout cleans TERM-resistant synchronous descendants and retains timeout classification', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-deadline-'));
  const file = path.join(dir, 'pids.json');
  const nested = `require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify([process.ppid,process.pid]));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const worker = `process.on('SIGTERM',()=>{});require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(nested)}],{stdio:'inherit'});`;
  try {
    const result = await runProcess(argv(worker), { deadline: Date.now() + 900, graceMs: 100 });
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'timeout');
    assert.ok(JSON.parse(fs.readFileSync(file)).every(pid => !alive(pid)));
  } finally {
    if (fs.existsSync(file)) for (const pid of JSON.parse(fs.readFileSync(file))) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expired deadlines launch nothing and cancellation is a process failure', async () => {
  const late = await runProcess(['/must-not-launch'], { deadline: Date.now() - 1 });
  assert.equal(late.reason, 'timeout');
  assert.equal(late.started_at, null);
  const abort = new AbortController();
  const pending = runProcess(argv('setInterval(()=>{},1000)'), { deadline: deadline(), signal: abort.signal, graceMs: 100 });
  const timer = setTimeout(() => abort.abort(), 100);
  try { await assert.rejects(pending, err => {
    assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
    assert.match(err.message, /interrupted/);
    assert.equal(err.extra.process_result.reason, 'interrupted');
    assert.ok(err.extra.process_result.started_at);
    assert.ok(err.extra.process_result.cleanup_finished_at);
    assert.ok(Date.parse(err.extra.process_result.finished_at) <= Date.parse(err.extra.process_result.cleanup_finished_at));
    assert.equal(Object.hasOwn(err.extra.process_result, 'stdout'), false);
    return true;
  }); }
  finally { clearTimeout(timer); }
  await assert.rejects(runProcess(argv('throw Error("must-not-launch")'), { deadline: deadline(), signal: abort.signal }), err => {
    assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
    assert.equal(err.extra.process_result.started_at, null);
    assert.equal(err.extra.process_result.reason, 'interrupted');
    return true;
  });
});

test('output overflow and spawn errors cannot become incomplete-validation warnings', async () => {
  await assert.rejects(runProcess(argv('process.stdout.write("x".repeat(65536));setInterval(()=>{},1000)'),
    { deadline: deadline(), maxBytes: 32, graceMs: 100 }),
  err => {
    assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
    assert.match(err.message, /output_limit/);
    assert.equal(err.extra.process_result.reason, 'output_limit');
    assert.ok(err.extra.process_result.cleanup_finished_at);
    assert.equal(Object.hasOwn(err.extra.process_result, 'stdout'), false);
    assert.equal(Object.hasOwn(err.extra.process_result, 'env'), false);
    return true;
  });
  await assert.rejects(runProcess(['/missing-supervisor-executable'], { deadline: deadline() }),
    err => {
      assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
      assert.equal(err.extra.process_result.reason, 'spawn_error');
      assert.equal(err.extra.process_result.started_at, null);
      assert.ok(err.extra.process_result.cleanup_finished_at);
      return true;
    });
});

test('cleanup failure preserves an explicit incomplete cleanup timeline without claiming success', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-cleanup-failure-'));
  const file = path.join(dir, 'pid.json');
  const originalKill = process.kill;
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid < 0) throw Object.assign(new Error('simulated process-group permission failure'), { code: 'EPERM' });
    return originalKill.call(process, pid, signal);
  });
  const worker = `require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(process.pid));process.stdout.write('x'.repeat(128));setInterval(()=>{},1000);`;
  try {
    await assert.rejects(runProcess(argv(worker), { deadline: deadline(), maxBytes: 32 }), err => {
      assert.equal(err.primary, 'SUBAGENT_PROCESS_FAILED');
      assert.equal(err.extra.process_result.reason, 'cleanup_failed');
      assert.equal(err.extra.process_result.cleanup_finished_at, null);
      assert.equal(err.extra.process_result.descendants_cleaned, false);
      assert.ok(err.extra.process_result.cleanup_attempt_finished_at);
      assert.equal(Object.hasOwn(err.extra.process_result, 'stdout'), false);
      return true;
    });
  } finally {
    t.mock.restoreAll();
    if (fs.existsSync(file)) {
      const pid = JSON.parse(fs.readFileSync(file));
      if (alive(pid)) originalKill.call(process, -pid, 'SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker that exits on time cannot hide cleanup that exceeds the deadline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-cleanup-deadline-'));
  const file = path.join(dir, 'pid.json');
  const nested = 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)';
  const worker = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nested)}],{stdio:['ignore','pipe','ignore']});require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(c.pid));c.stdout.once('data',()=>process.exit(0));`;
  const cutoff = Date.now() + 450;
  try {
    const result = await runProcess(argv(worker), { deadline: cutoff, graceMs: 400 });
    assert.equal(result.status, 0);
    assert.equal(result.stopped, true);
    assert.equal(result.reason, 'timeout');
    assert.ok(Date.parse(result.finished_at) < cutoff);
    assert.ok(Date.parse(result.cleanup_finished_at) >= cutoff);
    assert.equal(alive(JSON.parse(fs.readFileSync(file))), false);
  } finally {
    if (fs.existsSync(file)) { const pid = JSON.parse(fs.readFileSync(file)); if (alive(pid)) process.kill(pid, 'SIGKILL'); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
