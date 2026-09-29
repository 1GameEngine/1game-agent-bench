import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mountAssetLibrary, assetLibraryRoot, TASK_SPRITES } from '../src/assets.mjs';

test('mountAssetLibrary symlinks the Kenney library and copies named sprites', () => {
  const root = assetLibraryRoot();
  if (!fs.existsSync(root)) {
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
  const mounted = mountAssetLibrary(dir, 'p1-chart-rush');
  assert.equal(mounted.ok, true);
  assert.equal(fs.realpathSync(path.join(dir, 'asset-library')), fs.realpathSync(root));
  for (const name of TASK_SPRITES['p1-chart-rush'].map((item) => item.name)) {
    const file = path.join(dir, 'assets', name);
    assert.equal(fs.existsSync(file), true);
    assert.ok(fs.statSync(file).size > 32);
  }
  assert.equal(mounted.copied.includes('arrow-left.png'), true);
  assert.equal(mounted.copied.includes('arrow-right.png'), true);
});

test('every headline task can mount the library, with or without named sprites', async () => {
  const root = assetLibraryRoot();
  if (!fs.existsSync(root)) return;
  const { P1_TASKS } = await import('../src/p1-load.mjs');
  for (const id of P1_TASKS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
    const mounted = mountAssetLibrary(dir, id);
    assert.equal(mounted.ok, true, id);
    assert.equal(mounted.copied.length, (TASK_SPRITES[id] ?? []).length);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
