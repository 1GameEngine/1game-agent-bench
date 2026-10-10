import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStageContext, publishStageResponse } from '../src/stage-close.mjs';
import { validateStageTraces } from '../src/validate-traces.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-close-'));
  const id = 'own-stage';
  const now = Date.now();
  const lifecycle = { timing_path: path.join(dir, `${id}.timing.json`), response_path: path.join(dir, `${id}.response.json`),
    archive_response_path: path.join(dir, `${id}.archive.json`) };
  const spec = { role: 'builder', engine: 'godot', taskId: 'p1-tower-defense', workspace: dir };
  const timing = { schema: 'eval.cloud-stage-timing/1', id, role: spec.role, engine: spec.engine, taskId: spec.taskId,
    state: 'RUNNING', started_at: new Date(now - 1000).toISOString(), execution_timeout_ms: 600000,
    execution_deadline_at: new Date(now + 599000).toISOString(), closing_reserve_ms: 60000 };
  const save = () => fs.writeFileSync(lifecycle.timing_path, JSON.stringify(timing));
  save();
  fs.writeFileSync(path.join(dir, `${id}.request.json`), JSON.stringify({ id, spec, lifecycle }));
  return { dir, lifecycle, spec, timing, save, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('publisher archives the exact truthful negative before publishing and refuses overwrites', () => {
  const f = fixture();
  const data = { stdout: '', exitCode: 1, failure: { kind: 'validation_incomplete', message: 'clear 未完成；验证进程已退出' } };
  const extra = path.join(f.dir, 'extra/archive.json');
  try {
    publishStageResponse({ timingPath: f.lifecycle.timing_path, data, archivePath: extra });
    const actual = fs.readFileSync(f.lifecycle.response_path, 'utf8');
    assert.deepEqual(JSON.parse(actual), data);
    for (const file of [f.lifecycle.archive_response_path, extra]) assert.equal(fs.readFileSync(file, 'utf8'), actual);
    assert.throws(() => publishStageResponse({ timingPath: f.lifecycle.timing_path, data: { stdout: '', exitCode: 0 } }),
      (err) => err.primary === 'SUBAGENT_INVALID');
    assert.equal(fs.readFileSync(f.lifecycle.response_path, 'utf8'), actual);
    assert.ok(!fs.existsSync(f.lifecycle.response_path + '.publish-lock'));
  } finally { f.cleanup(); }
});

test('expired, inactive, wrong-workspace and malformed requests never publish', () => {
  const f = fixture();
  const success = { stdout: '', exitCode: 0 };
  try {
    assert.throws(() => readStageContext(f.lifecycle.timing_path, { workspace: f.dir + '-other' }), /workspace does not match/);
    assert.throws(() => publishStageResponse({ timingPath: f.lifecycle.timing_path, data: { ...success, failure: { kind: 'validation_incomplete', message: 'bad' } } }),
      (err) => err.primary === 'SUBAGENT_INVALID');
    assert.throws(() => publishStageResponse({ timingPath: f.lifecycle.timing_path, data: success },
      { now: () => Date.parse(f.timing.execution_deadline_at) }), (err) => err.primary === 'BUILDER_TIMEOUT');
    f.timing.state = 'FAILED'; f.save();
    assert.throws(() => publishStageResponse({ timingPath: f.lifecycle.timing_path, data: success }), /not an active/);
    assert.equal(fs.existsSync(f.lifecycle.response_path), false);
    assert.equal(fs.existsSync(f.lifecycle.archive_response_path), false);
  } finally { f.cleanup(); }
});

test('expiry during archive preparation cannot publish a late response', () => {
  const f = fixture();
  let calls = 0;
  const deadline = Date.parse(f.timing.execution_deadline_at);
  try {
    assert.throws(() => publishStageResponse({ timingPath: f.lifecycle.timing_path, data: { stdout: '', exitCode: 0 } },
      { now: () => ++calls <= 2 ? deadline - 1 : deadline }), (err) => err.primary === 'BUILDER_TIMEOUT');
    assert.equal(fs.existsSync(f.lifecycle.response_path), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.lifecycle.archive_response_path)), { stdout: '', exitCode: 0 });
    assert.ok(fs.readdirSync(f.dir).every(n => !n.endsWith('.tmp') && !n.endsWith('.publish-lock')));
  } finally { f.cleanup(); }
});

test('queued requests still reject missing, forged, late and expired start receipts', () => {
  const f = fixture();
  try {
    const startPath = path.join(f.dir, 'own-stage.started.json');
    f.lifecycle.start_path = startPath;
    fs.writeFileSync(path.join(f.dir, 'own-stage.request.json'), JSON.stringify({ id: f.timing.id, spec: f.spec, lifecycle: f.lifecycle }));
    f.timing.state = 'QUEUED';
    f.timing.queued_at = new Date(Date.now() - 1000).toISOString();
    f.timing.queue_timeout_ms = 60000;
    f.save();
    assert.throws(() => readStageContext(f.lifecycle.timing_path), err => err.primary === 'SUBAGENT_INVALID');
    for (const ack of [
      { id: 'another-stage', started_at: new Date().toISOString() },
      { id: f.timing.id, started_at: new Date(Date.now() + 10000).toISOString() },
      { id: f.timing.id, started_at: new Date(Date.parse(f.timing.queued_at) - 1).toISOString() },
    ]) {
      fs.writeFileSync(startPath, JSON.stringify(ack));
      assert.throws(() => readStageContext(f.lifecycle.timing_path), err => err.primary === 'SUBAGENT_INVALID');
    }
    const stamp = Date.now();
    fs.writeFileSync(startPath, JSON.stringify({ id: f.timing.id, started_at: new Date(stamp).toISOString() }));
    f.timing.queue_timeout_ms = 500; f.save();
    assert.throws(() => readStageContext(f.lifecycle.timing_path), err => err.primary === 'BUILDER_DISPATCH_TIMEOUT');
    f.timing.queue_timeout_ms = 60000; f.save();
    assert.throws(() => readStageContext(f.lifecycle.timing_path, {}, () => stamp + 600000), err => err.primary === 'BUILDER_TIMEOUT');
    f.timing.state = 'FAILED'; f.save();
    assert.throws(() => readStageContext(f.lifecycle.timing_path), /not an active/);
  } finally { f.cleanup(); }
});

test('validation started too late returns truthful incomplete diagnostics without touching the submission or receipt', async () => {
  const f = fixture();
  let artifact;
  try {
    f.timing.started_at = new Date(Date.now() - 598000).toISOString();
    f.timing.execution_deadline_at = new Date(Date.parse(f.timing.started_at) + 600000).toISOString(); f.save();
    const original = 'own source remains unchanged';
    fs.writeFileSync(path.join(f.dir, 'game.gd'), original);
    const r = await validateStageTraces({ engine: f.spec.engine, taskId: f.spec.taskId, workspace: f.dir, timingPath: f.lifecycle.timing_path });
    artifact = r.artifact_dir;
    assert.equal(r.ok, false);
    assert.equal(r.failure.kind, 'validation_incomplete');
    assert.equal(r.diagnostic_only, true);
    assert.equal(fs.readFileSync(path.join(f.dir, 'game.gd'), 'utf8'), original);
    assert.equal(fs.existsSync(f.lifecycle.response_path), false);
    assert.equal(fs.existsSync(path.join(f.dir, 'REPLAY.json')), false);
    assert.equal(fs.existsSync(path.join(artifact, 'REPLAY.json')), false);
  } finally { f.cleanup(); if (artifact) fs.rmSync(artifact, { recursive: true, force: true }); }
});
