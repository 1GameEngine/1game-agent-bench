import test from 'node:test';
import assert from 'node:assert/strict';
import { loadP1Task } from '../src/p1-load.mjs';

const START = [1, 5, 2, 4, 0, 6, 7, 3, 8];
const GOAL = [1, 2, 3, 4, 5, 6, 7, 8, 0];
const LIMIT = 14;
// Arrow key names the direction the tile slides; the blank moves the opposite way.
const BLANK_DELTA = { ArrowLeft: 1, ArrowRight: -1, ArrowUp: 3, ArrowDown: -3 };

function slide(board, key) {
  const z = board.indexOf(0);
  const t = z + BLANK_DELTA[key];
  if (t < 0 || t > 8) return null;
  if (Math.abs(BLANK_DELTA[key]) === 1 && Math.floor(t / 3) !== Math.floor(z / 3)) return null;
  const next = board.slice();
  next[z] = next[t];
  next[t] = 0;
  return next;
}

function run(keys) {
  let board = START;
  let moves = 0;
  for (const k of keys) {
    if (board.join() === GOAL.join() || moves >= LIMIT) break;
    const n = slide(board, k);
    if (!n) continue;
    board = n;
    moves += 1;
  }
  const phase = board.join() === GOAL.join() ? 'clear' : moves >= LIMIT ? 'fail' : 'playing';
  return { board, moves, phase };
}

function shortest() {
  const seen = new Map([[START.join(), []]]);
  let frontier = [START];
  while (frontier.length) {
    const next = [];
    for (const b of frontier) {
      for (const k of Object.keys(BLANK_DELTA)) {
        const n = slide(b, k);
        if (!n || seen.has(n.join())) continue;
        seen.set(n.join(), [...seen.get(b.join()), k]);
        next.push(n);
      }
    }
    frontier = next;
  }
  return seen.get(GOAL.join());
}

test('slide puzzle: fixed start is solvable inside the move budget with margin', () => {
  const path = shortest();
  assert.ok(path, 'goal reachable');
  assert.equal(path.length, 8);
  assert.ok(path.length < LIMIT);
  assert.deepEqual(run(path), { board: GOAL, moves: 8, phase: 'clear' });
});

test('slide puzzle: wasting moves reaches the limit and fails', () => {
  const wasted = Array.from({ length: 20 }, (_, i) => (i % 2 ? 'ArrowRight' : 'ArrowLeft'));
  const r = run(wasted);
  assert.equal(r.phase, 'fail');
  assert.equal(r.moves, LIMIT);
});

test('slide puzzle: edge slide is a no-op and does not count', () => {
  assert.equal(slide([1, 2, 3, 4, 5, 6, 7, 8, 0], 'ArrowLeft'), null);
  assert.equal(slide([1, 2, 3, 4, 5, 6, 7, 8, 0], 'ArrowUp'), null);
  assert.equal(slide([1, 2, 0, 4, 5, 3, 7, 8, 6], 'ArrowRight')?.join(), [1, 0, 2, 4, 5, 3, 7, 8, 6].join());
});

test('slide puzzle task: spec text, hidden rubric and probe agree', () => {
  const b = loadP1Task('p1-slide-puzzle');
  assert.match(b.instruction, /Slide Puzzle/);
  assert.match(b.instruction, /Puzzle clear/);
  assert.match(b.instruction, /Puzzle fail/);
  assert.match(b.instruction, /1 5 2\n4 0 6\n7 3 8/);
  assert.match(b.instruction, /moves 达到 14/);
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.deepEqual(byId.M1.applies, ['intro']);
  assert.deepEqual(byId.M4.applies, ['fail']);
  assert.deepEqual(byId.M5.applies, ['clear']);
  assert.equal(byId.A1.scope, 'persistent');
  const dims = new Set(b.rubric.requirements.map((r) => r.dim));
  assert.deepEqual([...dims].sort(), ['A', 'D', 'M', 'V']);
  const probeKeys = new Set(b.probe.keys);
  for (const a of b.probe.assertions) for (const c of a.checks) assert.ok(probeKeys.has(c.key), c.key);
  assert.equal(b.task.id, 'p1-slide-puzzle');
});

test('slide puzzle: probe agrees with rubric', async () => {
  const { validateProbe } = await import('../src/probe.mjs');
  const b = loadP1Task('p1-slide-puzzle');
  assert.deepEqual(validateProbe(b.probe, b.rubric), { ok: true, issues: [] });
});

test('slide puzzle: Start, Reset and board rectangles do not overlap', () => {
  const b = loadP1Task('p1-slide-puzzle');
  const rect = (label) => {
    const m = b.instruction.match(new RegExp(`${label}[^\\n]*?\\((\\d+),(\\d+),(\\d+),(\\d+)\\)`));
    assert.ok(m, label);
    return m.slice(1).map(Number);
  };
  const rects = { start: rect('按钮 Start 矩形'), reset: rect('按钮 Reset 矩形'), board: [400, 120, 480, 480] };
  assert.match(b.instruction, /棋盘 480×480，左上角 \(400,120\)/);
  const hit = ([x, y, w, h], [X, Y, W, H]) => x < X + W && X < x + w && y < Y + H && Y < y + h;
  const names = Object.keys(rects);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.equal(hit(rects[names[i]], rects[names[j]]), false, `${names[i]} vs ${names[j]}`);
    }
    const [x, y, w, h] = rects[names[i]];
    assert.ok(x >= 0 && y >= 0 && x + w <= 1280 && y + h <= 720, names[i]);
  }
});

test('slide puzzle: reset restores the board but keeps moves', () => {
  let board = START;
  let moves = 0;
  let resets = 0;
  for (const k of ['ArrowRight', 'ArrowDown']) {
    const n = slide(board, k);
    if (n) {
      board = n;
      moves += 1;
    }
  }
  board = START;
  resets += 1;
  assert.deepEqual({ board, moves, resets }, { board: START, moves: 2, resets: 1 });
});

test('slide puzzle: reset, fail budget and trace length are in the spec', () => {
  const b = loadP1Task('p1-slide-puzzle');
  assert.match(b.instruction, /仅在 playing 时生效/);
  assert.match(b.instruction, /不超过 20 秒/);
  assert.match(b.instruction, /键盘优先于点击/);
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.deepEqual(byId.D2.applies, ['fail']);
  assert.deepEqual(byId.D3.applies, ['loop']);
  assert.doesNotMatch(JSON.stringify(b.rubric), /phase|cursor|clockMs|remainMs/);
});
