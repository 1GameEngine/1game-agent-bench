import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PIN } from '../src/paths.mjs';
import { stageTimeoutMs } from '../src/stage-timeout.mjs';
import { runCloudAgentSubagent } from '../src/cloud-agent-subagent.mjs';
import { onegameCliPath, runOnegameCli } from '../src/onegame-cli.mjs';

test('stage budgets use role override, legacy override, then safe defaults', () => {
  assert.equal(stageTimeoutMs('replay', {}), 1_800_000);
  for (const role of ['builder', 'debug', 'looks']) assert.equal(stageTimeoutMs(role, {}), 600_000);
  assert.equal(stageTimeoutMs('replay', { EVAL_SUBAGENT_TIMEOUT_MS: '900' }), 900);
  assert.equal(stageTimeoutMs('replay', { EVAL_REPLAY_TIMEOUT_MS: '1200', EVAL_SUBAGENT_TIMEOUT_MS: '900' }), 1200);
  for (const bad of ['0', '-1', 'abc', 'Infinity', '1.5', '2147483648']) {
    assert.throws(() => stageTimeoutMs('replay', { EVAL_REPLAY_TIMEOUT_MS: bad }), /positive timer-safe integer/);
  }
});

test('cloud replay timeout is distinguished from an invalid model response', async () => {
  const previous = process.env.EVAL_REPLAY_TIMEOUT_MS;
  process.env.EVAL_REPLAY_TIMEOUT_MS = '80';
  try {
    await assert.rejects(() => runCloudAgentSubagent({
      role: 'replay', engine: 'onegame', taskId: 'p1-tower-defense',
      replay: { argv: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'] },
    }), (err) => err.primary === 'REPLAY_TIMEOUT' && err.extra.timeout_ms === 80);
  } finally {
    if (previous === undefined) delete process.env.EVAL_REPLAY_TIMEOUT_MS;
    else process.env.EVAL_REPLAY_TIMEOUT_MS = previous;
  }
});

test('direct CLI uses the pinned workspace package and preserves argv tokens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-pin-'));
  const root = path.join(dir, 'node_modules/@1game/cli-1gameplay');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  const pkg = { name: '@1game/cli-1gameplay', version: PIN, bin: { '1gameplay': 'bin/cli.mjs' } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, 'bin/cli.mjs'), 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));');
  try {
    const argv = ['1gameplay', 'step', 'record with spaces', '--ms', '0', '--event', '{"type":"pointer.down","data":{"x":1,"y":2}}'];
    const result = runOnegameCli(dir, argv);
    assert.equal(result.status, 0);
    assert.equal(result.file, process.execPath);
    assert.deepEqual(JSON.parse(result.stdout), { argv: argv.slice(1), cwd: dir });
    assert.throws(() => onegameCliPath(path.join(dir, 'child')), (err) => err.primary === 'CLI_UNAVAILABLE');
    pkg.version = '0.0.0';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    assert.throws(() => onegameCliPath(dir), (err) => err.primary === 'PIN_MISMATCH');
    pkg.version = PIN; pkg.bin['1gameplay'] = '../../foreign.mjs';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
    assert.throws(() => onegameCliPath(dir), (err) => err.primary === 'CLI_UNAVAILABLE');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
