import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process-supervisor.mjs';
import { WORK_DIR } from '../src/paths.mjs';

const worker = fileURLToPath(new URL('../src/execution-worker.mjs', import.meta.url));
const execute = input => runProcess([process.execPath, worker], { deadline: Date.now() + 10000, input: JSON.stringify(input) });

test('worker preserves independent game audit failures rather than reporting a transport failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-audit-'));
  try {
    const result = await execute({ action: 'audit', engine: 'godot', taskId: 'p1-chart-rush', workspace: dir });
    assert.equal(result.status, 1);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, false);
    assert.equal(response.error.primary, 'BUILDER_INVALID');
    assert.match(response.error.message, /missing/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('worker serializes a real negative boot result as a successful action', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-boot-'));
  try {
    const result = await execute({ action: 'boot', engine: 'godot', workspace: dir });
    assert.equal(result.status, 0);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, true);
    assert.equal(response.value.ok, false);
    assert.ok(['BUILD_FAIL', 'BOOT_FAIL'].includes(response.value.primary));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('worker prepare creates the same isolated Godot workspace, public instruction and assets', async () => {
  const runId = `worker-test-${randomBytes(8).toString('hex')}`;
  const dir = path.join(WORK_DIR, `${runId}-gd-generated`);
  try {
    const result = await execute({ action: 'prepare', engine: 'godot', taskId: 'p1-chart-rush', runId, instruction: 'public-only task' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, true);
    assert.equal(response.value.workspace, path.join(dir, 'godot'));
    assert.equal(fs.readFileSync(path.join(response.value.workspace, 'instruction.md'), 'utf8'), 'public-only task');
    assert.ok(fs.readdirSync(path.join(response.value.workspace, 'assets')).length > 0);
    assert.equal(response.value.replayRunId, `${runId}-gd`);
    assert.equal(fs.existsSync(response.value.outPath), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('worker rejects unknown actions and path-traversing prepare ids before filesystem changes', async () => {
  for (const input of [
    { action: 'unknown', engine: 'godot' },
    { action: 'prepare', engine: 'godot', runId: '../escape', instruction: 'bad' },
  ]) {
    const result = await execute(input);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.primary, 'SUBAGENT_INVALID');
  }
});

test('worker observes a submission in its own process and returns the persisted manifest association', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-manifest-'));
  const workspace = path.join(dir, 'game');
  const manifestPath = path.join(dir, 'evidence', 'SUBMISSION.json');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'game.gd'), 'extends Node2D\n');
  try {
    const result = await execute({ action: 'manifest', engine: 'godot', taskId: 'p1-chart-rush', workspace,
      runId: 'manifest-worker-test', stageId: 'builder-stage-test', manifestPath, publicTask: { id: 'p1-chart-rush' } });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const response = JSON.parse(result.stdout);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    assert.equal(response.value.submission_id, manifest.submission_id);
    assert.equal(response.value.manifest_path, manifestPath);
    assert.equal(manifest.stageId, 'builder-stage-test');
    assert.ok(manifest.files.some(file => file.path === 'game.gd' && file.sha256));
    assert.equal(fs.readFileSync(path.join(workspace, 'game.gd'), 'utf8'), 'extends Node2D\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
