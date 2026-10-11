import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStageReplay } from '../src/stage-replay.mjs';
import { validateTraces, validateStageTraces } from '../src/validate-traces.mjs';
import { verifySubmissionManifest } from '../src/submission-manifest.mjs';
import { WORK_DIR } from '../src/paths.mjs';

function writeCandidate(workspace) {
  for (const [file, body] of Object.entries({ 'game.gd': 'extends Node2D\n', 'game.tscn': '[gd_scene format=3]\n',
    'project.godot': 'config_version=5\n', 'extra.gd': 'extends Node\nclass_name EvalProbe\n', 'candidate-marker.txt': path.basename(workspace) })) {
    fs.writeFileSync(path.join(workspace, file), body);
  }
  fs.mkdirSync(path.join(workspace, 'demo_outputs'));
  for (const [i, scenario] of ['intro', 'loop', 'fail', 'clear'].entries()) {
    fs.writeFileSync(path.join(workspace, 'demo_outputs', `${String(i + 1).padStart(2, '0')}_${scenario}.json`), JSON.stringify({
      schema: 'eval.trace/1', scenario, duration_frames: 40, viewport: { w: 1280, h: 720 },
      events: scenario === 'intro' ? [] : [{ frame: 0, type: 'keydown', code: 'Enter' }],
    }));
  }
}

test('formal replay keeps its execution outcome while associating an observed submission', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-manifest-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const doc = runStageReplay({ engine: 'onegame', taskId: 'p1-chart-rush', workspace, outPath: path.join(workspace, 'REPLAY.json'),
    token: 'manifest-test', runId: path.basename(workspace) });
  assert.equal(doc.G, false);
  assert.equal(doc.via, 'stage-replay');
  assert.equal(doc.snapshot_kind, 'observed_workspace');
  const manifest = JSON.parse(fs.readFileSync(doc.manifest_path, 'utf8'));
  assert.equal(manifest.submission_id, doc.submission_id);
  assert.equal(verifySubmissionManifest(manifest), true);
  assert.equal(manifest.files.some((file) => /SUBMISSION|REPLAY/.test(file.path)), false);
});

test('self-check records the candidate actually replayed without reading a hidden rubric', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-manifest-'));
  const prior = new Set(fs.readdirSync(WORK_DIR));
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const name of fs.readdirSync(WORK_DIR)) {
      const manifest = path.join(WORK_DIR, name, 'SUBMISSION.json');
      if (!prior.has(name) && name.startsWith('validation-') && fs.existsSync(manifest)) {
        const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (data.files.some((file) => file.path === 'candidate-marker.txt')) fs.rmSync(path.join(WORK_DIR, name), { recursive: true, force: true });
      }
    }
  });
  writeCandidate(workspace);
  const read = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function (file, ...args) { reads.push(String(file)); return read.call(this, file, ...args); };
  let report;
  try { report = validateTraces({ engine: 'godot', taskId: 'p1-chart-rush', workspace, scenario: 'loop' }); }
  finally { fs.readFileSync = read; }
  assert.equal(report.ok, false);
  assert.equal(report.primary, 'INJECT_TAMPER');
  assert.equal(report.snapshot_kind, 'candidate_snapshot');
  const manifest = JSON.parse(fs.readFileSync(report.manifest_path, 'utf8'));
  assert.equal(report.submission_id, manifest.submission_id);
  assert.equal(verifySubmissionManifest(manifest), true);
  assert.deepEqual(manifest.files.filter((file) => file.kind === 'trace').map((file) => file.path), ['demo_outputs/02_loop.json']);
  const progress = JSON.parse(fs.readFileSync(report.progress_path, 'utf8'));
  assert.equal(progress.state, 'COMPLETE');
  assert.equal(progress.submission_id, report.submission_id);
  assert.deepEqual(fs.readFileSync(path.join(report.artifact_dir, 'VALIDATION_EVENTS.jsonl'), 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line).state), ['COPYING_SUBMISSION', 'AUDITING_SUBMISSION', 'REPLAYING', 'COMPLETE']);
  assert.ok(reads.every((file) => !/\/judge\/|rubric\.json$/.test(file)));
  assert.equal(fs.readdirSync(path.join(workspace, 'demo_outputs')).length, 4);
  assert.equal(fs.existsSync(path.join(workspace, 'REPLAY.json')), false);
});

test('the real supervised validation worker returns candidate diagnostics and its cleanup timeline', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'supervised-manifest-'));
  let artifact;
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    if (artifact) fs.rmSync(artifact, { recursive: true, force: true });
  });
  writeCandidate(workspace);
  const id = 'manifest-worker-stage';
  const spec = { role: 'builder', engine: 'godot', taskId: 'p1-chart-rush', workspace };
  const timingPath = path.join(workspace, `${id}.timing.json`);
  const now = Date.now();
  fs.writeFileSync(timingPath, JSON.stringify({ schema: 'eval.cloud-stage-timing/1', id, ...spec,
    state: 'RUNNING', started_at: new Date(now).toISOString(), execution_timeout_ms: 600000,
    execution_deadline_at: new Date(now + 600000).toISOString(), closing_reserve_ms: 60000 }));
  fs.writeFileSync(path.join(workspace, `${id}.request.json`), JSON.stringify({ id, spec, lifecycle: { timing_path: timingPath } }));
  const report = await validateStageTraces({ ...spec, timingPath });
  artifact = report.artifact_dir;
  assert.equal(report.primary, 'INJECT_TAMPER');
  assert.equal(report.ok, false);
  assert.equal(report.snapshot_kind, 'candidate_snapshot');
  assert.ok(Date.parse(report.cleanup_finished_at) >= Date.parse(report.process_started_at));
  const progress = JSON.parse(fs.readFileSync(report.progress_path));
  assert.equal(progress.state, 'COMPLETE');
  assert.equal(progress.stage_id, id);
  assert.equal(progress.submission_id, report.submission_id);
  assert.equal(fs.existsSync(path.join(workspace, `${id}.response.json`)), false);
});
