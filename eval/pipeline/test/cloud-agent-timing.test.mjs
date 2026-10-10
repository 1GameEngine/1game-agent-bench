import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitCloudModel, receiptPublishedAt } from '../src/cloud-agent-subagent.mjs';
import { stageDispatchTimeoutMs } from '../src/stage-timeout.mjs';
import { buildDebugPrompt } from '../src/model-builder.mjs';
import { publishStageResponse, readStageContext } from '../src/stage-close.mjs';

// Exercise real receipt files and lifecycle transitions with a controlled clock.
function fixture(onTick, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-timing-'));
  const origin = Date.UTC(2026, 9, 9);
  let time = origin;
  const published = new Map();
  const spec = { role: 'debug', engine: 'onegame', taskId: 'p1-chart-rush', workspace: dir, prompt: '检查四条轨迹' };
  const env = { EVAL_CLOUD_TASK_DIR: dir, EVAL_DEBUG_TIMEOUT_MS: '1000', EVAL_DISPATCH_TIMEOUT_MS: '2000', ...overrides };
  const read = () => {
    const name = fs.readdirSync(dir).find((f) => f.endsWith('.request.json'));
    return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  };
  const pending = waitCloudModel(spec, { env, now: () => time, publicationTime: (file) => published.get(file), sleep: async (ms) => {
    time += ms;
    const req = read();
    await onTick({ req, elapsed: time - origin, time,
      advance: (ms) => { time += ms; },
      start: (fields = {}) => {
        fs.writeFileSync(req.lifecycle.start_path, JSON.stringify({ id: req.id, started_at: new Date(time).toISOString(), ...fields }));
        published.set(req.lifecycle.start_path, time);
      },
      respond: (data = { stdout: 'verified', exitCode: 0 }, at = time) => {
        fs.writeFileSync(req.lifecycle.response_path, JSON.stringify(data));
        published.set(req.lifecycle.response_path, at);
      },
    });
  } });
  const timing = () => JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.endsWith('.timing.json'))), 'utf8'));
  return { dir, origin, pending, read, timing, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('dispatch budget is independent of execution overrides and rejects invalid timers', () => {
  assert.equal(stageDispatchTimeoutMs({}), 600_000);
  assert.equal(stageDispatchTimeoutMs({ EVAL_SUBAGENT_TIMEOUT_MS: '50' }), 600_000);
  assert.equal(stageDispatchTimeoutMs({ EVAL_DISPATCH_TIMEOUT_MS: '900' }), 900);
  for (const bad of ['0', '-1', 'NaN', 'Infinity', '1.5', '2147483648']) {
    assert.throws(() => stageDispatchTimeoutMs({ EVAL_DISPATCH_TIMEOUT_MS: bad }), /positive timer-safe integer/);
  }
});

test('trusted tools accept a timely atomic start before the supervisor polls it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-start-race-'));
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const spec = { role: 'builder', engine: 'godot', taskId: 'p1-chart-rush', workspace: dir };
  const pending = waitCloudModel(spec, { env: { EVAL_CLOUD_TASK_DIR: dir, EVAL_BUILDER_TIMEOUT_MS: '3000', EVAL_DISPATCH_TIMEOUT_MS: '3000' },
    sleep: () => gate });
  try {
    const req = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.request.json')))));
    fs.writeFileSync(req.lifecycle.start_path + '.tmp', JSON.stringify({ id: req.id, started_at: new Date().toISOString() }));
    fs.renameSync(req.lifecycle.start_path + '.tmp', req.lifecycle.start_path);
    assert.equal(readStageContext(req.lifecycle.timing_path, spec).timing.state, 'RUNNING');
    publishStageResponse({ timingPath: req.lifecycle.timing_path, data: { stdout: 'complete', exitCode: 0 } });
    // Only the supervisor records state; neither tool impersonates its ack.
    assert.equal(JSON.parse(fs.readFileSync(req.lifecycle.timing_path)).state, 'QUEUED');
    resume();
    assert.equal(await pending, 'complete');
    const timing = JSON.parse(fs.readFileSync(req.lifecycle.timing_path));
    assert.equal(timing.state, 'COMPLETE');
    assert.equal(timing.execution_deadline_at, new Date(Date.parse(timing.started_at) + 3000).toISOString());
  } finally { resume(); await pending.catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const negative of [false, true]) {
  test(`receipt published before deadline survives a delayed poll (${negative ? 'self-check warning' : 'success'})`, async () => {
    const f = fixture(({ elapsed, start, respond, advance }) => {
      if (elapsed === 200) start();
      if (elapsed === 1200) {
        respond(negative ? { stdout: '', exitCode: 1, failure: { kind: 'validation_incomplete', message: 'clear 未完成' } }
          : { stdout: 'verified', exitCode: 0 }, f.origin + 1199);
        advance(1);
      }
    });
    try {
      if (negative) await assert.rejects(f.pending, (err) => err.primary === 'STAGE_VALIDATION_INCOMPLETE');
      else assert.equal(await f.pending, 'verified');
      const t = f.timing();
      assert.equal(Date.parse(t.finished_at), f.origin + 1199);
      assert.equal(Date.parse(t.response_observed_at), f.origin + 1201);
      assert.equal(t.execution_elapsed_ms, 999);
    } finally { f.cleanup(); }
  });
}

test('a backdated start published after dispatch deadline is rejected', async () => {
  const f = fixture(({ elapsed, start }) => {
    if (elapsed === 2000) start({ started_at: new Date(f.origin + 1999).toISOString() });
  });
  try { await assert.rejects(f.pending, (err) => err.primary === 'DEBUG_DISPATCH_TIMEOUT'); }
  finally { f.cleanup(); }
});

test('publication time cannot be backdated using the temporary file mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-publication-'));
  try {
    const file = path.join(dir, 'response.json');
    fs.writeFileSync(file + '.tmp', '{}');
    fs.utimesSync(file + '.tmp', new Date(0), new Date(0));
    fs.renameSync(file + '.tmp', file);
    const stat = fs.statSync(file);
    const stamp = receiptPublishedAt(file, stat);
    assert.equal(stat.mtimeMs, 0);
    assert.ok(stamp > Date.now() - 1000 && stamp <= Date.now());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('queue wait does not consume execution time and successful timing survives receipt cleanup', async () => {
  const f = fixture(({ elapsed, req, start, respond }) => {
    if (elapsed === 600) start();
    if (elapsed === 1200) respond();
    assert.match(req.handoff.prompt, /实际开始本阶段/);
    assert.match(req.handoff.prompt, /执行截止时间 = started_at/);
    assert.equal(req.lifecycle.closing_reserve_ms, 100);
  });
  try {
    assert.equal(await f.pending, 'verified'); // Old request-based 1000ms timer would fail.
    const record = f.timing();
    assert.equal(record.state, 'COMPLETE');
    assert.equal(record.queue_wait_ms, 600);
    assert.equal(record.execution_elapsed_ms, 600);
    assert.equal(Date.parse(record.execution_deadline_at), f.origin + 1600);
    assert.equal(Date.parse(record.wrap_up_at), f.origin + 1500);
    assert.deepEqual(fs.readdirSync(f.dir), [path.basename(record.timing_path)]);
  } finally { f.cleanup(); }
});

test('unstarted work reports dispatch timeout and retains its request', async () => {
  const f = fixture(() => {});
  try {
    await assert.rejects(f.pending, (err) => err.primary === 'DEBUG_DISPATCH_TIMEOUT' && err.extra.timeout_phase === 'dispatch');
    assert.equal(f.timing().started_at, null);
    assert.equal(f.timing().execution_elapsed_ms, null);
    assert.equal(f.timing().queue_wait_ms, 2000);
    assert.equal(f.read().id, f.timing().id);
  } finally { f.cleanup(); }
});

test('a result without a real start receipt is rejected', async () => {
  const f = fixture(({ respond }) => respond());
  try {
    await assert.rejects(f.pending, /without a start receipt/);
    assert.equal(f.timing().state, 'FAILED');
    assert.equal(f.timing().primary, 'SUBAGENT_INVALID');
  } finally { f.cleanup(); }
});

for (const kind of ['wrong id', 'future time', 'backdated time', 'invalid time']) {
  test(`start receipt rejects ${kind}`, async () => {
    const f = fixture(({ start, time }) => start(kind === 'wrong id' ? { id: 'another-request' } : {
      started_at: kind === 'invalid time' ? 'invalid' : new Date(kind === 'future time' ? time + 1 : time - 1000).toISOString(),
    }));
    try {
      await assert.rejects(f.pending, /wrong id or invalid start time/);
      assert.equal(f.timing().primary, 'SUBAGENT_INVALID');
    } finally { f.cleanup(); }
  });
}

test('a start at the expired dispatch deadline cannot extend the request', async () => {
  const f = fixture(({ elapsed, start }) => { if (elapsed === 2000) start(); });
  try {
    await assert.rejects(f.pending, (err) => err.primary === 'DEBUG_DISPATCH_TIMEOUT');
  } finally { f.cleanup(); }
});

test('execution deadline rejects late success and rewriting start cannot restart the budget', async () => {
  const f = fixture(({ elapsed, start, respond }) => {
    start(); // Rewriting this file every poll must not restart the clock.
    if (elapsed === 1200) respond();
  });
  try {
    await assert.rejects(f.pending, (err) => err.primary === 'DEBUG_TIMEOUT' && err.extra.timeout_phase === 'execution');
    const record = f.timing();
    assert.equal(Date.parse(record.started_at), f.origin + 200);
    assert.equal(record.execution_elapsed_ms, 1000);
    assert.equal(record.queue_wait_ms, 200);
    assert.equal(fs.existsSync(record.response_path), true);
    assert.equal(f.read().id, record.id);
  } finally { f.cleanup(); }
});

test('nonzero agent result records failure rather than completion', async () => {
  const f = fixture(({ start, respond }) => { start(); respond({ stdout: '', exitCode: 1, stderr: 'final verification incomplete' }); });
  try {
    await assert.rejects(f.pending, /final verification incomplete/);
    assert.equal(f.timing().state, 'FAILED');
    assert.equal(f.timing().primary, 'SUBAGENT_FAILED');
    assert.equal(f.timing().execution_elapsed_ms, 0);
  } finally { f.cleanup(); }
});

test('validation can finish in the closing reserve before the absolute deadline', async () => {
  const f = fixture(({ elapsed, start, respond }) => {
    if (elapsed === 200) start();
    if (elapsed === 1200) respond();
  }, { EVAL_DEBUG_TIMEOUT_MS: '1100' });
  try {
    assert.equal(await f.pending, 'verified');
    const t = f.timing();
    assert.ok(Date.parse(t.finished_at) > Date.parse(t.wrap_up_at));
    assert.ok(Date.parse(t.finished_at) < Date.parse(t.execution_deadline_at));
  } finally { f.cleanup(); }
});

for (const [kind, primary] of [['validation_incomplete', 'STAGE_VALIDATION_INCOMPLETE'], ['game_validation_failed', 'GAME_VALIDATION_FAILED']]) {
  test(`truthful ${kind} keeps failure evidence and its own classification`, async () => {
    const f = fixture(({ start, respond }) => {
      start(); respond({ stdout: '', exitCode: 1, failure: { kind, message: 'clear 尚未验证' } });
    });
    try {
      await assert.rejects(f.pending, (err) => err.primary === primary);
      assert.equal(f.timing().state, 'FAILED');
      assert.equal(f.timing().primary, primary);
      assert.ok(fs.existsSync(f.timing().response_path));
    } finally { f.cleanup(); }
  });
}

for (const data of [{ stdout: '', exitCode: null }, { stdout: '', exitCode: '0' },
  { stdout: '', exitCode: 0, failure: { kind: 'validation_incomplete', message: 'unfinished' } },
  { stdout: '', exitCode: 1, failure: { kind: 'environment_failure', message: 'network' } }]) {
  test(`malformed failure cannot be recovered: ${JSON.stringify(data)}`, async () => {
    const f = fixture(({ start, respond }) => { start(); respond(data); });
    try { await assert.rejects(f.pending, (err) => err.primary === 'SUBAGENT_INVALID'); }
    finally { f.cleanup(); }
  });
}

test('debug instructions put build/type/assets checks before final trajectories and require revalidation', () => {
  const prompt = buildDebugPrompt({ instruction: '做游戏', task: { scenarios: { required: ['intro', 'clear'] } } });
  assert.ok(prompt.indexOf('先完成依赖、构建、类型、素材加载') < prompt.indexOf('1. 对照游戏需求'));
  assert.match(prompt, /最终版本的每条测试用例/);
  assert.match(prompt, /修改后必须重新验证，未完成不能声称成功/);
  assert.doesNotMatch(prompt, /1Game|Godot|1gameplay|rubric/);
});
