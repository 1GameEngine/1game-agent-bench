import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateStageTraces, cancelStageValidation } from '../src/validate-traces.mjs';

function alive(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

function fixture(t, remainingMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-progress-'));
  const id = 'progress-stage';
  const now = Date.now(), executionMs = 600000;
  const spec = { engine: 'godot', taskId: 'p1-chart-rush', workspace: dir, role: 'builder' };
  const timingPath = path.join(dir, `${id}.timing.json`);
  const timing = { schema: 'eval.cloud-stage-timing/1', id, ...spec, state: 'RUNNING',
    started_at: new Date(now + remainingMs - executionMs).toISOString(), execution_timeout_ms: executionMs,
    execution_deadline_at: new Date(now + remainingMs).toISOString(), closing_reserve_ms: 200 };
  const save = () => fs.writeFileSync(timingPath, JSON.stringify(timing));
  save();
  fs.writeFileSync(path.join(dir, `${id}.request.json`), JSON.stringify({ id, spec, lifecycle: { timing_path: timingPath } }));
  let artifact;
  const workerArgv = (request) => {
    artifact = request.artifactDir;
    // This worker simulates only lifecycle/progress, never a formal REPLAY or score.
    const script = `
      const fs = require('node:fs'); const path = require('node:path');
      fs.readFileSync(0, 'utf8');
      const file = ${JSON.stringify(request.progressPath)};
      const progress = JSON.parse(fs.readFileSync(file, 'utf8'));
      process.on('SIGTERM', () => {});
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {stdio:'ignore'});
      fs.writeFileSync(path.join(progress.artifact_dir, 'pids.json'), JSON.stringify([process.pid, child.pid]));
      Object.assign(progress, {state:'REPLAYING', submission_id:'test-candidate', manifest_path:path.join(progress.artifact_dir,'SUBMISSION.json'), snapshot_kind:'candidate_snapshot'});
      fs.writeFileSync(file, JSON.stringify(progress));
      fs.appendFileSync(path.join(progress.artifact_dir,'FEEDBACK.jsonl'),JSON.stringify({event:'trace_done',scenario:'intro',frames:1})+String.fromCharCode(10));
      setInterval(()=>{},1000);
    `;
    return [process.execPath, '-e', script];
  };
  t.after(() => {
    if (artifact && fs.existsSync(path.join(artifact, 'pids.json'))) {
      for (const pid of JSON.parse(fs.readFileSync(path.join(artifact, 'pids.json')))) if (alive(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (artifact) fs.rmSync(artifact, { recursive: true, force: true });
  });
  return { spec, timingPath, timing, save, workerArgv, get artifact() { return artifact; } };
}

test('automatic validation stop keeps the same candidate and reports cleanup time', async (t) => {
  const f = fixture(t, 1500);
  const report = await validateStageTraces({ ...f.spec, timingPath: f.timingPath }, { workerArgv: f.workerArgv });
  assert.equal(report.failure.kind, 'validation_incomplete');
  assert.equal(report.submission_id, 'test-candidate');
  assert.equal(report.artifact_dir, f.artifact);
  assert.equal(report.snapshot_kind, 'candidate_snapshot');
  assert.ok(Date.parse(report.cleanup_finished_at) >= Date.parse(report.process_started_at));
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.artifact, 'pids.json'))).every((pid) => !alive(pid)));
  const progress = JSON.parse(fs.readFileSync(report.progress_path));
  assert.equal(progress.state, 'INCOMPLETE');
  assert.equal(progress.submission_id, report.submission_id);
});

test('owned cancellation waits for group cleanup, live feedback arrives early, and overlapping validation is refused', async t=>{
  const f=fixture(t,20000),events=[];
  const validating=validateStageTraces({...f.spec,timingPath:f.timingPath},{workerArgv:f.workerArgv,notify:e=>events.push(e)});
  assert.equal(events[0].event,'session_started');
  assert.ok(events[0].progress_path);
  const end=Date.now()+3000;
  while(!events.some(e=>e.event==='trace_done')&&Date.now()<end)await delay(20);
  assert.ok(events.some(e=>e.event==='trace_done'), 'scenario feedback was delayed until worker exit');
  await assert.rejects(validateStageTraces({...f.spec,timingPath:f.timingPath},{workerArgv:f.workerArgv,notify:()=>{}}),e=>e.primary==='VALIDATION_BUSY');
  await assert.rejects(cancelStageValidation({timingPath:f.timingPath,sessionId:'validation-1-not-owned'}),e=>e.primary==='SUBAGENT_INVALID');
  const stopped=await cancelStageValidation({timingPath:f.timingPath,sessionId:events[0].session_id});
  const report=await validating;
  assert.equal(stopped.state,'CANCELLED');
  assert.equal(report.primary,'VALIDATION_CANCELLED');
  assert.equal(report.ok,false);
  assert.ok(stopped.cleanup_finished_at);
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.artifact,'pids.json'))).every(pid=>!alive(pid)));
});

test('an inactive stage cancels its validation group instead of becoming a self-check warning', async (t) => {
  const f = fixture(t, 20000);
  const validating = validateStageTraces({ ...f.spec, timingPath: f.timingPath }, { workerArgv: f.workerArgv });
  // Attach rejection handling before cancellation to avoid an unhandled rejection.
  const rejected = assert.rejects(validating, (err) => err.primary === 'SUBAGENT_PROCESS_FAILED' && /inactive/.test(err.message));
  const waitUntil = Date.now() + 3000;
  while (Date.now() < waitUntil) {
    const progress = JSON.parse(fs.readFileSync(path.join(f.artifact, 'PROGRESS.json')));
    if (progress.state === 'REPLAYING') break;
    await delay(20);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.artifact, 'PROGRESS.json'))).state, 'REPLAYING');
  const cancelledAt = Date.now();
  f.timing.state = 'FAILED'; f.save();
  await rejected;
  assert.ok(Date.now() - cancelledAt < 2000, 'cancellation waited for the execution deadline');
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.artifact, 'pids.json'))).every((pid) => !alive(pid)));
  const progress = JSON.parse(fs.readFileSync(path.join(f.artifact, 'PROGRESS.json')));
  assert.equal(progress.state, 'FAILED');
  assert.equal(progress.primary, 'SUBAGENT_PROCESS_FAILED');
  assert.equal(progress.submission_id, 'test-candidate');
  assert.ok(Date.parse(progress.cleanup_finished_at) >= Date.parse(progress.process_started_at));
  assert.equal(progress.process_stop_reason, 'interrupted');
  assert.equal(fs.existsSync(path.join(f.artifact, 'VALIDATION.json')), false);
});
