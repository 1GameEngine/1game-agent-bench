import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runValidationProcess } from '../src/validation-process.mjs';

function alive(pid) {
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

test('bounded validation preserves normal output and cannot start after the stop time', async () => {
  const argv = [process.execPath, '-e', 'process.stdout.write("已完成")'];
  const r = await runValidationProcess(argv, { stopAt: Date.now() + 3000 });
  assert.equal(r.stdout, '已完成'); assert.equal(r.status, 0); assert.equal(r.stopped, false);
  const late = await runValidationProcess([process.execPath, '-e', 'throw Error("must not launch")'], { stopAt: Date.now() - 1 });
  assert.equal(late.stopped, true); assert.equal(late.stdout, '');
});

test('automatic cutoff stops a SIGTERM-resistant worker and nested child without killing unrelated processes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-group-'));
  const pidFile = path.join(dir, 'pids.json');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const done = once(unrelated, 'close');
  const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.ppid,process.pid]));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const worker = `process.on('SIGTERM',()=>{});require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'inherit'});`;
  try {
    const r = await runValidationProcess([process.execPath, '-e', worker], { stopAt: Date.now() + 700, graceMs: 100 });
    assert.equal(r.stopped, true); assert.equal(r.reason, 'closing_reserve');
    const pids = JSON.parse(fs.readFileSync(pidFile));
    assert.ok(pids.every(pid => !alive(pid)), `surviving validation processes: ${pids}`);
    assert.ok(alive(unrelated.pid));
  } finally {
    unrelated.kill('SIGKILL'); await done;
    if (fs.existsSync(pidFile)) for (const pid of JSON.parse(fs.readFileSync(pidFile))) if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spawn failures remain process failures rather than recoverable self-check warnings', async () => {
  await assert.rejects(runValidationProcess(['/missing-validation-executable'], { stopAt: Date.now() + 1000 }),
    (err) => err.primary === 'SUBAGENT_PROCESS_FAILED');
});

test('a completed worker returns only after its surviving descendants have been cleaned up', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-orphan-'));
  const file = path.join(dir, 'pid.json');
  const worker = `const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(c.pid));process.exit(0);`;
  try {
    const r = await runValidationProcess([process.execPath, '-e', worker], { stopAt: Date.now() + 3000, graceMs: 100 });
    assert.equal(r.status, 0); assert.equal(r.descendants_cleaned, true);
    assert.equal(alive(JSON.parse(fs.readFileSync(file))), false);
  } finally {
    if (fs.existsSync(file)) { const pid = JSON.parse(fs.readFileSync(file)); if (alive(pid)) process.kill(pid, 'SIGKILL'); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normal delayed helper shutdown is awaited without turning validation into a failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-settle-'));
  const file = path.join(dir, 'pid.json');
  const worker = `const c=require('node:child_process').spawn('/bin/sleep',['0.05'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(c.pid));process.exit(0);`;
  try {
    const r = await runValidationProcess([process.execPath, '-e', worker], { stopAt: Date.now() + 3000, graceMs: 100 });
    assert.equal(r.status, 0); assert.equal(r.stopped, false);
    assert.equal(alive(JSON.parse(fs.readFileSync(file))), false);
  } finally {
    if (fs.existsSync(file)) { const pid = JSON.parse(fs.readFileSync(file)); if (alive(pid)) process.kill(pid, 'SIGKILL'); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker exit cleans inherited output pipes without waiting for the validation deadline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-inherited-pipes-'));
  const file = path.join(dir, 'pid.json');
  const worker = `const c=require('node:child_process').spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(file)},JSON.stringify(c.pid));process.stdout.write('{"ok":true}');process.exit(0);`;
  try {
    const r = await runValidationProcess([process.execPath, '-e', worker], { stopAt: Date.now() + 3000, graceMs: 100 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '{"ok":true}');
    assert.equal(r.stopped, false);
    assert.equal(r.reason, 'cleanup_after_exit');
    assert.equal(r.descendants_cleaned, true);
    assert.equal(alive(JSON.parse(fs.readFileSync(file))), false);
  } finally {
    if (fs.existsSync(file)) { const pid = JSON.parse(fs.readFileSync(file)); if (alive(pid)) process.kill(pid, 'SIGKILL'); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
