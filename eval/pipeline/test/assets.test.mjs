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
  const mounted = mountAssetLibrary(dir, 'p1-night-stall');
  assert.equal(mounted.ok, true);
  assert.equal(fs.realpathSync(path.join(dir, 'asset-library')), fs.realpathSync(root));
  for (const name of TASK_SPRITES['p1-night-stall'].map((item) => item.name)) {
    const file = path.join(dir, 'assets', name);
    assert.equal(fs.existsSync(file), true);
    assert.ok(fs.statSync(file).size > 32);
  }
  const vault = mountAssetLibrary(dir, 'p1-vault-crawl');
  assert.equal(vault.copied.includes('player.png'), true);
  assert.equal(vault.copied.includes('door-open.png'), true);
});
