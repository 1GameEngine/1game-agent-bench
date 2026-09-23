import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { orchestrateEngines, assertReplayDocument, defaultRunSubagent } from '../src/subagent-stage.mjs';
import { runStageReplay } from '../src/stage-replay.mjs';
import { scoreStagedPair } from '../src/product-run.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function trace(scenario, events) {
  return {
    schema: 'eval.trace/1',
    scenario,
    duration_frames: 40,
    viewport: { w: 1280, h: 720 },
    events,
  };
}

function writeSubmission(workspace, engine) {
  const press = [{ frame: 0, type: 'keydown', code: 'Enter' }];
  const files = {
    'demo_outputs/01_intro.json': trace('intro', []),
    'demo_outputs/02_loop.json': trace('loop', press),
    'demo_outputs/03_fail.json': trace('fail', press),
    'demo_outputs/04_clear.json': trace('clear', press),
  };
  if (engine === 'onegame') files['src/game.tsx'] = 'export const game = 1;\n';
  else {
    files['game.gd'] = 'extends Node2D\n';
    files['game.tscn'] = '[gd_scene format=3]\n';
    files['project.godot'] = 'config_version=5\n';
  }
  for (const [rel, body] of Object.entries(files)) {
    const out = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, typeof body === 'string' ? body : JSON.stringify(body));
  }
}

function replayDoc(spec, stills) {
  const traces = ['intro', 'loop', 'fail', 'clear'].map((scenario) => ({
    file: `${scenario}.json`,
    trace: trace(scenario, scenario === 'intro' ? [] : [{ frame: 0, type: 'keydown', code: 'Enter' }]),
    audit: { ok: true, issues: [] },
  }));
  return {
    via: 'stage-replay',
    token: spec.replay.token,
    engine: spec.engine,
    taskId: spec.taskId,
    G: true,
    primary: 'TRACE_OK',
    g0_ok: 1,
    notes: [],
    stills,
    samples: [],
    traces,
    scenarios: ['intro', 'loop', 'fail', 'clear'],
    replayed_scenarios: ['intro', 'loop', 'fail', 'clear'],
    missing_scenarios: [],
    attempt: { id: spec.taskId, engine: spec.engine, primary: 'TRACE_OK', g0_ok: 1, notes: [] },
  };
}

test('unset subagent command stops before any game file is written', async () => {
  const prev = process.env.EVAL_SUBAGENT_CMD;
  delete process.env.EVAL_SUBAGENT_CMD;
  const workspaces = [];
  await assert.rejects(
    () =>
      orchestrateEngines({
        taskId: 'p1-chart-rush',
        runId: 'need-subagent',
        prepare: ({ engine }) => {
          const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `stage-${engine}-`));
          workspaces.push(workspace);
          return { workspace, replayRunId: engine, outPath: path.join(workspace, 'REPLAY.json') };
        },
        runSubagent: defaultRunSubagent,
      }),
    (err) => err.primary === 'SUBAGENT_REQUIRED',
  );
  assert.equal(workspaces.length, 2);
  for (const workspace of workspaces) {
    assert.equal(fs.existsSync(path.join(workspace, 'src', 'game.tsx')), false);
    assert.equal(fs.existsSync(path.join(workspace, 'game.gd')), false);
  }
  if (prev === undefined) delete process.env.EVAL_SUBAGENT_CMD;
  else process.env.EVAL_SUBAGENT_CMD = prev;
});

test('builder and looks specs hide the probe, and a forged replay is rejected', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      orchestrateEngines({
        taskId: 'p1-chart-rush',
        runId: 'forged',
        prepare: ({ engine }) => {
          const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `forge-${engine}-`));
          return { workspace, replayRunId: engine, outPath: path.join(workspace, 'REPLAY.json') };
        },
        runSubagent: async (spec) => {
          calls.push(`${spec.engine}:${spec.role}`);
          const blob = JSON.stringify(spec);
          assert.doesNotMatch(blob, /probe\.json/);
          assert.doesNotMatch(blob, /last_gte/);
          assert.doesNotMatch(blob, /"id": "M1"/);
          if (spec.role === 'builder') {
            assert.match(spec.prompt, /评测主进程不写游戏源码/);
            writeSubmission(spec.workspace, spec.engine);
            return '';
          }
          if (spec.role === 'replay') {
            assert.match(spec.replay.argv.join(' '), /stage-replay/);
            fs.writeFileSync(spec.replay.out, `${JSON.stringify({ via: 'hand', token: spec.replay.token })}\n`);
            return '';
          }
          throw new Error('looks must not run after an untrusted replay');
        },
      }),
    (err) => err.primary === 'REPLAY_UNTRUSTED',
  );
  assert.deepEqual(calls.filter((c) => c.endsWith(':looks')), []);
  assert.ok(calls.includes('onegame:builder'));
  assert.ok(calls.includes('godot:replay'));
});

test('main agent scores frame rubric without cross-item caps', async () => {
  const calls = [];
  const staged = await orchestrateEngines({
    taskId: 'p1-chart-rush',
    runId: 'scored',
    prepare: ({ engine }) => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `score-${engine}-`));
      return { workspace, replayRunId: engine, outPath: path.join(workspace, 'REPLAY.json') };
    },
    runSubagent: async (spec) => {
      calls.push(`${spec.engine}:${spec.role}`);
      if (spec.role === 'builder') {
        writeSubmission(spec.workspace, spec.engine);
        return '';
      }
      if (spec.role === 'replay') {
        const stills = ['intro', 'loop', 'fail', 'clear'].map((scenario) => {
          const id = `${scenario}_f0`;
          const file = path.join(spec.workspace, `${id}.png`);
          fs.writeFileSync(file, 'png');
          return { id, ok: true, path: file, dump_ok: 1 };
        });
        fs.writeFileSync(spec.replay.out, `${JSON.stringify(replayDoc(spec, stills))}\n`);
        return '';
      }
      assert.deepEqual(
        spec.rubric_items.map((item) => item.id).sort(),
        ['A1', 'A2', 'D1', 'D2', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'V1', 'V2'],
      );
      assert.doesNotMatch(JSON.stringify(spec.rubric_items), /phase|cursor|clockMs|remainMs/);
      assert.doesNotMatch(JSON.stringify(spec.stills), spec.engine === 'onegame' ? /godot/ : /onegame/);
      const scenarios = {};
      for (const [sc, frames] of Object.entries(spec.stills)) {
        scenarios[sc] = {};
        for (const item of spec.rubric_items.filter((row) => row.applies.includes(sc))) {
          scenarios[sc][item.id] = { score: item.id === 'V2' || item.id === 'A2' ? 0 : 1, evidence: [frames[0].id] };
        }
      }
      return JSON.stringify({ scenarios });
    },
  });
  for (const engine of ['onegame', 'godot']) {
    const roles = calls.filter((c) => c.startsWith(`${engine}:`)).map((c) => c.split(':')[1]);
    assert.deepEqual(roles, ['builder', 'replay', 'looks']);
  }
  const scored = scoreStagedPair('p1-chart-rush', staged);
  assert.equal(scored.ogRow.looks_source, 'subagent');
  assert.equal(scored.gdRow.looks_source, 'subagent');
  assert.equal(scored.ogRow.M, 1);
  assert.equal(scored.ogRow.V, 0.5);
  assert.equal(scored.ogRow.product_100, 75);
  assert.equal(scored.gdRow.product_100, 75);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(path.dirname(staged.onegame.outPath), 'builder-onegame.json'), 'utf8')).source,
    'subagent',
  );
});

test('stage-replay is the only writer of a trusted replay document', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cli-'));
  const out = path.join(workspace, 'REPLAY.json');
  const doc = runStageReplay({
    engine: 'onegame',
    taskId: 'p1-chart-rush',
    workspace,
    outPath: out,
    token: 'tok',
    runId: 'empty-og',
  });
  assert.equal(doc.via, 'stage-replay');
  assert.equal(doc.G, false);
  assert.equal(assertReplayDocument(doc, { token: 'tok', engine: 'onegame', taskId: 'p1-chart-rush' }).primary, doc.primary);
  assert.throws(
    () => assertReplayDocument({ via: 'hand', token: 'tok', engine: 'onegame', taskId: 'p1-chart-rush' }, { token: 'tok', engine: 'onegame', taskId: 'p1-chart-rush' }),
    (err) => err.primary === 'REPLAY_UNTRUSTED',
  );
  const missing = spawnSync(process.execPath, [cli, 'stage-replay', '--engine', 'onegame'], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /stage-replay needs/);
});

test('product and compare entrypoints do not replay or build inline', () => {
  const product = fs.readFileSync(new URL('../src/product-run.mjs', import.meta.url), 'utf8');
  const run = product.slice(product.indexOf('export async function runProduct100'));
  assert.doesNotMatch(run, /runOnegameTraces|runModelBuilder|scorePairedLooks|scoreVisuals/);
  const compare = fs.readFileSync(new URL('../src/p1-run.mjs', import.meta.url), 'utf8');
  assert.match(compare, /orchestrateEngines/);
  assert.doesNotMatch(compare, /runModelBuilder|runOnegameTraces|runGodotJob/);
  const stage = fs.readFileSync(new URL('../src/subagent-stage.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(stage, /taskScore100|applyPlayableGates|scoreProbe/);
});
