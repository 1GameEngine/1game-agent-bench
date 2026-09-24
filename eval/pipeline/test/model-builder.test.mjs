import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadP1Task } from '../src/p1-load.mjs';
import { buildBuilderPrompt, filesFromModelText, runModelBuilder } from '../src/model-builder.mjs';

function trace(scenario, events) {
  return JSON.stringify({
    schema: 'eval.trace/1',
    scenario,
    duration_frames: 40,
    viewport: { w: 1280, h: 720 },
    events,
  });
}

function submission(engine, marker) {
  const press = [{ frame: 0, type: 'keydown', code: 'Enter' }];
  const files = {
    'demo_outputs/01_intro.json': trace('intro', []),
    'demo_outputs/02_loop.json': trace('loop', press),
    'demo_outputs/03_fail.json': trace('fail', press),
    'demo_outputs/04_clear.json': trace('clear', press),
  };
  if (engine === 'onegame') {
    files['src/game.tsx'] = `export const marker = ${JSON.stringify(marker)};\n`;
  } else {
    files['game.gd'] = `extends Node2D\n# ${marker}\n`;
    files['game.tscn'] = '[gd_scene format=3]\n';
    files['project.godot'] = 'config_version=5\n';
  }
  return JSON.stringify({ files });
}

test('builder prompt is the task text plus the engine appendix', () => {
  const task = loadP1Task('p1-chart-rush');
  const og = buildBuilderPrompt({ engine: 'onegame', instruction: task.instruction });
  const gd = buildBuilderPrompt({ engine: 'godot', instruction: task.instruction });
  assert.match(og, /只有底栏没有下落物/);
  assert.match(og, /createGameStore/);
  assert.match(gd, /当前主场景根节点脚本/);
  assert.notEqual(og, gd);
  for (const prompt of [og, gd]) {
    assert.doesNotMatch(prompt, /probe\.json/);
    assert.doesNotMatch(prompt, /last_gte/);
    assert.doesNotMatch(prompt, /"id": "M1"/);
  }
});

test('each model call writes that reply and refuses a missing model', async () => {
  const task = loadP1Task('p1-chart-rush');
  const prevCmd = process.env.EVAL_BUILDER_CMD;
  const prevKey = process.env.EVAL_BUILDER_API_KEY;
  delete process.env.EVAL_BUILDER_CMD;
  delete process.env.EVAL_BUILDER_API_KEY;
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'));
  await assert.rejects(
    () => runModelBuilder({ taskId: task.task.id, engine: 'onegame', instruction: task.instruction, dest }),
    (err) => err.primary === 'BUILDER_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dest, 'src', 'game.tsx')), false);

  const hashes = [];
  for (const [engine, marker] of [
    ['onegame', 'rewrite-a'],
    ['onegame', 'rewrite-b'],
    ['godot', 'rewrite-g'],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-'));
    await runModelBuilder({
      taskId: task.task.id,
      engine,
      instruction: task.instruction,
      dest: dir,
      wipe: true,
      complete: async ({ prompt, engine: got }) => {
        assert.equal(got, engine);
        assert.match(prompt, /Chart Rush/);
        assert.doesNotMatch(prompt, /probe\.json/);
        return submission(engine, marker);
      },
    });
    const file = engine === 'onegame' ? 'src/game.tsx' : 'game.gd';
    hashes.push(createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(new Set(hashes).size, 3);

  const script = path.join(dest, 'fake-builder.mjs');
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const body = ${JSON.stringify(submission('godot', 'from-cmd'))};
fs.mkdirSync(req.dest, { recursive: true });
process.stdout.write(body);
`,
  );
  process.env.EVAL_BUILDER_CMD = process.execPath;
  process.env.EVAL_BUILDER_ARGS = JSON.stringify([script]);
  const cmdDest = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-built-'));
  await runModelBuilder({
    taskId: task.task.id,
    engine: 'godot',
    instruction: task.instruction,
    dest: cmdDest,
    wipe: true,
  });
  assert.match(fs.readFileSync(path.join(cmdDest, 'game.gd'), 'utf8'), /from-cmd/);
  if (prevCmd === undefined) delete process.env.EVAL_BUILDER_CMD;
  else process.env.EVAL_BUILDER_CMD = prevCmd;
  delete process.env.EVAL_BUILDER_ARGS;
  if (prevKey === undefined) delete process.env.EVAL_BUILDER_API_KEY;
  else process.env.EVAL_BUILDER_API_KEY = prevKey;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.rmSync(cmdDest, { recursive: true, force: true });
});

test('builder file JSON rejects path escape', () => {
  assert.throws(() => filesFromModelText(JSON.stringify({ files: { '../x': 'no' } })), /rejected/);
});
