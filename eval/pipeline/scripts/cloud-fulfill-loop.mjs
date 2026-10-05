#!/usr/bin/env node
/** Watch cloud-agent builder requests and copy prebuilt workspaces from formal-bd71-r2. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TASK_DIR = process.env.EVAL_CLOUD_TASK_DIR || '/workspace/work/.cloud-agent-tasks';
const SRC_RUN = process.env.PREBUILT_RUN_ID || 'formal-bd71-r2';
const pipeline = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyPrebuilt(spec) {
  const { engine, taskId, workspace } = spec;
  const srcRoot = `/workspace/work/${SRC_RUN}-${taskId}-${engine === 'onegame' ? 'og' : 'gd-generated'}`;
  const src = engine === 'onegame' ? path.join(srcRoot, 'game') : path.join(srcRoot, 'godot');
  if (!fs.existsSync(src)) return false;
  if (engine === 'onegame') {
    fs.cpSync(path.join(src, 'src', 'game.tsx'), path.join(workspace, 'src', 'game.tsx'));
    fs.mkdirSync(path.join(workspace, 'demo_outputs'), { recursive: true });
    for (const f of fs.readdirSync(path.join(src, 'demo_outputs'))) {
      fs.cpSync(path.join(src, 'demo_outputs', f), path.join(workspace, 'demo_outputs', f));
    }
  } else {
    for (const name of ['project.godot', 'game.gd', 'game.tscn']) {
      if (fs.existsSync(path.join(src, name))) fs.cpSync(path.join(src, name), path.join(workspace, name));
    }
    if (fs.existsSync(path.join(src, 'demo_outputs'))) {
      fs.rmSync(path.join(workspace, 'demo_outputs'), { recursive: true, force: true });
      fs.cpSync(path.join(src, 'demo_outputs'), path.join(workspace, 'demo_outputs'), { recursive: true });
    }
  }
  return true;
}

function fulfill(reqPath) {
  const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  if (req.spec.role === 'builder') {
    copyPrebuilt(req.spec);
  }
  let looksOut = process.env.LOOKS_STDOUT || '';
  if (req.spec.role === 'looks') {
    looksOut = execFileSync(process.execPath, [path.join(pipeline, 'scripts/generic-looks-json.mjs'), reqPath], {
      encoding: 'utf8',
    }).trim();
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pipeline, 'scripts/fulfill-cloud-request.mjs'), reqPath], {
      env: { ...process.env, LOOKS_STDOUT: looksOut },
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`fulfill ${code}`))));
  });
}

async function loop() {
  fs.mkdirSync(TASK_DIR, { recursive: true });
  const seen = new Set();
  for (;;) {
    for (const name of fs.readdirSync(TASK_DIR)) {
      if (!name.endsWith('.request.json')) continue;
      const id = name.replace(/\.request\.json$/, '');
      if (seen.has(id)) continue;
      const res = path.join(TASK_DIR, `${id}.response.json`);
      if (fs.existsSync(res)) continue;
      seen.add(id);
      const reqPath = path.join(TASK_DIR, name);
      try {
        await fulfill(reqPath);
        process.stderr.write(`fulfilled ${name}\n`);
      } catch (e) {
        process.stderr.write(`fulfill failed ${name}: ${e.message}\n`);
        seen.delete(id);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

loop().catch((e) => {
  console.error(e);
  process.exit(1);
});
