import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildScoreboardView,
  renderScoreboardHtml,
  writeScoreboard,
  parseTaskCopy,
  packSides,
} from '../src/scoreboard.mjs';
import { scoreAttempt, SUITE_TASKS, P1_TASKS } from '../src/product-100.mjs';

function fakeReport(engineIds, taskIds, extra = {}) {
  const engines = {};
  const product_100 = {};
  for (const id of engineIds) {
    engines[id] = { product_100: extra.suite?.[id] ?? 80, task_count: taskIds.length };
    product_100[id] = engines[id].product_100;
  }
  return {
    schema: 'eval.product-100/1',
    report_id: 'P100_unit',
    comparable: true,
    still: { looks: 'subagent' },
    weights: { M: 40, D: 10, V: 20, A: 30 },
    task_ids: taskIds,
    engines,
    product_100,
    tasks: extra.rows ?? [],
  };
}

test('parseTaskCopy reads 标题 and first body line', () => {
  const copy = parseTaskCopy('标题：信号台\n\n做一个控制室微游戏。\n\n玩家体验：\n- x', 'p1-x');
  assert.equal(copy.title, '信号台');
  assert.match(copy.blurb, /控制室/);
  const md = parseTaskCopy('# 夜市摊\n\n做一个摊位游戏。', 'p1-night-stall');
  assert.equal(md.title, '夜市摊');
});

test('packSides understands og/gd and extra engine keys', () => {
  const sides = packSides({
    id: 'p1-x',
    og: { G: 1, stills: [] },
    gd: { G: 1, stills: [] },
    unity: { G: 1, stills: [{ id: 'init' }] },
  });
  assert.deepEqual(
    sides.map((s) => s.engine),
    ['onegame', 'godot', 'unity'],
  );
});

test('scoreboard view: one card per game, labeled engine summaries, extra engine becomes a column', () => {
  const taskIds = [...SUITE_TASKS, 'p1-extra-game'];
  const engineIds = ['onegame', 'godot', 'unity'];
  const rows = taskIds.flatMap((id) =>
    engineIds.map((engine, i) =>
      scoreAttempt({
        id,
        engine,
        G: 1,
        sliceScores: [1],
        V: 1,
        A: 0.5,
        D: 0.5,
        primary: 'CHECKPOINTS_OK',
        g0_ok: 1,
        looks_status: 'OK',
        looks_source: 'subagent',
        looks_items: { V1: 1, V2: 1, V3: engine === 'godot' ? 0.5 : 1, V4: 1, A1: 1, A2: 0.5, A3: 0.5, A4: 0.5, D1: 0.5 },
      }),
    ),
  );
  const packs = taskIds.map((id) => ({
    id,
    bundle: { instruction: `标题：${id}\n\n题面说明一行。` },
    og: { stills: [{ id: 'init', dump: { lamp: false } }, { id: 'final', dump: { lamp: true } }] },
    gd: { stills: [{ id: 'init', dump: { lamp: false } }, { id: 'final', dump: { lamp: true } }] },
    unity: { stills: [{ id: 'init', dump: { lamp: false } }, { id: 'final', dump: { lamp: true } }] },
  }));
  const report = fakeReport(engineIds, taskIds, { rows, suite: { onegame: 79.4, godot: 81.1, unity: 70 } });
  const view = buildScoreboardView({ report, rows, packs });
  assert.equal(view.engines.length, 3);
  assert.equal(view.engines[2].id, 'unity');
  assert.equal(view.engines[2].label, 'unity');
  assert.equal(view.games.length, 4);
  assert.equal(view.games[0].id, P1_TASKS[0]);
  assert.ok(view.games.every((g) => Object.keys(g.scores).join(',') === 'onegame,godot,unity'));
  assert.equal(view.games[0].stills[0].shots.length, 3);
  assert.equal(view.games[0].metrics[0].values.unity, 1);
  const html = renderScoreboardHtml(view);
  assert.ok(!html.includes('__VIEW_JSON__'));
  assert.match(html, /"id":"unity"/);
  assert.match(html, /p1-extra-game/);
});

test('writeScoreboard emits index.html with N game cards from template', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoreboard-'));
  const rows = SUITE_TASKS.flatMap((id) => [
    scoreAttempt({
      id,
      engine: 'onegame',
      G: 1,
      sliceScores: [1],
      V: 1,
      A: 0.5,
      D: 0.5,
      primary: 'CHECKPOINTS_OK',
      g0_ok: 1,
      looks_status: 'OK',
      looks_source: 'subagent',
      looks_items: { V1: 1, D1: 0.5 },
    }),
    scoreAttempt({
      id,
      engine: 'godot',
      G: 1,
      sliceScores: [1],
      V: 1,
      A: 0.5,
      D: 0.5,
      primary: 'CHECKPOINTS_OK',
      g0_ok: 1,
      looks_status: 'OK',
      looks_source: 'subagent',
      looks_items: { V1: 1, D1: 0.5 },
    }),
  ]);
  const report = fakeReport(['onegame', 'godot'], [...SUITE_TASKS], {
    rows,
    suite: { onegame: 79.4, godot: 81.1 },
  });
  const packs = SUITE_TASKS.map((id) => ({
    id,
    bundle: { instruction: `标题：${id}\n\n说明。` },
    og: { stills: [{ id: 'init', dump: { a: 1 } }] },
    gd: { stills: [{ id: 'init', dump: { a: 1 } }] },
  }));
  const { htmlPath, view } = writeScoreboard({ dir, report, rows, packs });
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.equal(view.games.length, 3);
  assert.match(html, /套件总览/);
  assert.match(html, /1Game/);
  assert.match(html, /Godot/);
  assert.ok(html.includes(`id=\\"${P1_TASKS[0]}\\"`) || html.includes(`"id":"${P1_TASKS[0]}"`));
});
