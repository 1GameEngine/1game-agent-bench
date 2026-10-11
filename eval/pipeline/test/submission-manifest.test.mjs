import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSubmissionManifest, compareSubmissionManifests, verifySubmissionManifest, writeSubmissionManifest } from '../src/submission-manifest.mjs';
import { REQUIRED_ONEGAME } from '../src/paths.mjs';
import { TASK_SPRITES } from '../src/assets.mjs';

function fixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'submission-manifest-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const put = (rel, body) => {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body);
  };
  const observe = (extra = {}) => createSubmissionManifest({ workspace, engine: 'godot', taskId: 'p1-chart-rush', ...extra });
  return { workspace, put, observe };
}

test('content identities survive run metadata, output artifacts, and workspace relocation', (t) => {
  const { workspace, put, observe } = fixture(t);
  put('src/game.gd', 'extends Node2D\n'); put('assets/z.png', 'pixels'); put('demo_outputs/intro.json', '{}');
  const a = observe({ runId: 'one', stageId: 'builder', publicTask: { z: 30, a: 1 } });
  writeSubmissionManifest(path.join(workspace, 'SUBMISSION.json'), a);
  put('REPLAY.json', '{}'); put('out/archive', 'generated');
  const other = path.join(workspace, 'work', 'relocated');
  fs.mkdirSync(other, { recursive: true });
  for (const rel of ['src', 'assets', 'demo_outputs']) fs.cpSync(path.join(workspace, rel), path.join(other, rel), { recursive: true });
  const b = createSubmissionManifest({ workspace: other, engine: 'godot', taskId: 'p1-chart-rush', runId: 'two', stageId: 'debug',
    snapshotKind: 'candidate_snapshot', publicTask: { a: 1, z: 30 } });
  assert.equal(a.submission_id, b.submission_id);
  assert.equal(verifySubmissionManifest(a), true);
  assert.deepEqual(a.files.map((file) => file.path), ['assets/z.png', 'demo_outputs/intro.json', 'src/game.gd']);
  assert.equal(a.files[0].sha256, createHash('sha256').update('pixels').digest('hex'));
  assert.equal(compareSubmissionManifests(a, b).same, true);
});

test('stage and report output colocated with source does not change the submission identity', (t) => {
  const { put, observe } = fixture(t);
  put('src/game.gd', 'source');
  const before = observe();
  for (const rel of ['STAGES/builder-1-SUBMISSION.json', 'STAGE_STATE.json', 'STAGE_EVENTS.jsonl', 'LOOKS.json',
    'STAGE_ERROR.json', 'STAGE_WARNINGS.json', 'builder-godot.json', 'stage.archive.json', 'stage.started.json',
    'PROGRESS.json', 'VALIDATION_EVENTS.jsonl', 'SUBMISSION.json.123.tmp', 'report/index.html',
    '.report-store/generations/first/CHECKPOINT.json', 'PRODUCT_100.json', 'RUN_STATE.json']) put(rel, 'generated');
  assert.equal(before.submission_id, observe().submission_id);
});

test('source, trace, asset and public policy changes are independently associated', (t) => {
  const { put, observe } = fixture(t);
  for (const rel of ['src/game.gd', 'demo_outputs/intro.json', 'assets/p.png']) put(rel, 'initial');
  let previous = observe({ publicTask: { replay_fps: 30 } });
  for (const rel of ['src/game.gd', 'demo_outputs/intro.json', 'assets/p.png']) {
    put(rel, 'changed');
    const next = observe({ publicTask: { replay_fps: 30 } });
    assert.notEqual(previous.submission_id, next.submission_id);
    assert.deepEqual(compareSubmissionManifests(previous, next).changed_files, [rel]); previous = next;
  }
  assert.notEqual(previous.submission_id, observe({ publicTask: { replay_fps: 60 } }).submission_id);
  const tampered = structuredClone(previous); tampered.files[0].sha256 = 'forged';
  assert.equal(verifySubmissionManifest(tampered), false);
  assert.equal(verifySubmissionManifest({}), false);
});

test('credentials, environment values and excluded link targets are not read or serialized', (t) => {
  const { workspace, put, observe } = fixture(t);
  const secret = 'do-not-include-test-secret';
  for (const rel of ['.env', '.env.local', '.aws/credentials', '.codex/auth.json', 'credentials.json', 'secrets.txt', 'node_modules/unrelated/data']) put(rel, secret);
  fs.symlinkSync(path.join(workspace, '.env'), path.join(workspace, 'env-alias'));
  fs.symlinkSync('/etc/passwd', path.join(workspace, 'external'));
  const read = fs.readFileSync;
  const reads = [];
  fs.readFileSync = function (file, ...args) { reads.push(String(file)); return read.call(this, file, ...args); };
  let manifest;
  try { manifest = observe({ runtime: { API_KEY: secret, GODOT_BIN: secret, godot_version: '4.4.1' } }); }
  finally { fs.readFileSync = read; }
  assert.equal(reads.some((file) => file === '/etc/passwd' || file.endsWith('/.env') || file.includes('/.aws/')), false);
  assert.equal(JSON.stringify(manifest).includes(secret), false);
  assert.equal(manifest.runtime.godot_version, '4.4.1');
  assert.ok(manifest.diagnostics.some((item) => item.code === 'excluded_symlink_target'));
  assert.ok(manifest.diagnostics.some((item) => item.code === 'external_symlink_not_hashed'));
  assert.equal(manifest.observation_complete, false);
});

test('symlink cycles and dangling links remain diagnostic observations', (t) => {
  const { workspace, put, observe } = fixture(t);
  put('src/game.gd', 'game');
  fs.symlinkSync(workspace, path.join(workspace, 'src', 'cycle'));
  fs.symlinkSync(path.join(workspace, 'missing'), path.join(workspace, 'broken'));
  const manifest = observe();
  assert.ok(manifest.diagnostics.some((item) => item.code === 'symlink_cycle'));
  assert.equal(manifest.files.some((file) => file.path === 'src/game.gd'), true);
  assert.equal(manifest.files.find((file) => file.path === 'broken').link, 'unresolved');
  assert.equal(verifySubmissionManifest(manifest), true);
});

test('approved shared assets are bounded to public task sources', (t) => {
  const { workspace, put, observe } = fixture(t);
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-library-'));
  t.after(() => fs.rmSync(library, { recursive: true, force: true }));
  const previous = process.env.EVAL_ASSET_LIBRARY;
  process.env.EVAL_ASSET_LIBRARY = library;
  t.after(() => { if (previous === undefined) delete process.env.EVAL_ASSET_LIBRARY; else process.env.EVAL_ASSET_LIBRARY = previous; });
  for (const item of TASK_SPRITES['p1-chart-rush']) {
    fs.mkdirSync(path.dirname(path.join(library, item.src)), { recursive: true }); fs.writeFileSync(path.join(library, item.src), 'sprite');
  }
  fs.writeFileSync(path.join(library, 'unrelated-secret.txt'), 'not-read');
  fs.symlinkSync(library, path.join(workspace, 'asset-library'));
  put('assets/selected.png', 'copied sprite');
  const a = observe();
  assert.equal(a.files.filter((file) => file.shared_library_source).length, 4);
  assert.equal(a.files.some((file) => file.path.includes('unrelated')), false);
  fs.writeFileSync(path.join(library, TASK_SPRITES['p1-chart-rush'][0].src), 'changed sprite');
  assert.notEqual(a.submission_id, observe().submission_id);
});

test('dependency lock and installed public train versions contribute without dumping package metadata', (t) => {
  const { put, observe } = fixture(t);
  put('package.json', JSON.stringify({ dependencies: Object.fromEntries(REQUIRED_ONEGAME.map((name) => [name, '1.23.0'])) }));
  put('pnpm-lock.yaml', 'lockfileVersion: 9.0');
  for (const name of REQUIRED_ONEGAME) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.23.0', credential: 'never-export' }));
  const a = observe({ engine: 'onegame' });
  assert.equal(a.dependencies.packages['@1game/cli'].installed, '1.23.0');
  assert.equal(a.dependencies.locks[0].path, 'pnpm-lock.yaml');
  assert.equal(JSON.stringify(a).includes('never-export'), false);
  put('node_modules/@1game/cli/package.json', JSON.stringify({ version: '1.23.1' }));
  const b = observe({ engine: 'onegame' });
  assert.notEqual(a.submission_id, b.submission_id);
  assert.deepEqual(compareSubmissionManifests(a, b).changed_files, []);
});

test('a concurrent source write is diagnostic and cannot claim a stable observation', (t) => {
  const { workspace, put, observe } = fixture(t);
  put('game.gd', 'before');
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    const body = read.call(this, file, ...args);
    if (String(file) === path.join(workspace, 'game.gd')) fs.writeFileSync(file, 'after with a different size');
    return body;
  };
  let manifest;
  try { manifest = observe(); } finally { fs.readFileSync = read; }
  assert.equal(manifest.observation_complete, false);
  assert.equal(manifest.files.find((file) => file.path === 'game.gd').unstable, true);
  assert.ok(manifest.diagnostics.some((item) => item.code === 'changed_while_reading'));
  assert.equal(verifySubmissionManifest(manifest), true);
});
