import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadP1Task } from '../src/p1-load.mjs';
import { EVAL_DIR } from '../src/paths.mjs';

const COLS = 8;
const ROWS = 6;
const OX = 384;
const OY = 120;
const CELL = 64;
const DEPOT = { c: 3, r: 0 };
const LIMIT = 8;
const ALLY_RANK = { melee: 0, ranged: 1, support: 2 };

function opening(map) {
  if (map === 'ridge') {
    return [
      { id: 'melee', side: 'ally', c: 1, r: 5, hp: 20, max: 20, mv: 2, rng: 1, atk: 3, heal: 0, acted: false },
      { id: 'ranged', side: 'ally', c: 3, r: 5, hp: 16, max: 16, mv: 2, rng: 3, atk: 3, heal: 0, acted: false },
      { id: 'support', side: 'ally', c: 6, r: 5, hp: 16, max: 16, mv: 3, rng: 0, atk: 0, heal: 2, acted: false },
      { id: 'brute', side: 'enemy', c: 0, r: 1, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
      { id: 'shot', side: 'enemy', c: 5, r: 2, hp: 3, max: 3, mv: 1, rng: 3, atk: 1, heal: 0, acted: false },
      { id: 'lurker', side: 'enemy', c: 7, r: 4, hp: 3, max: 3, mv: 2, rng: 1, atk: 1, heal: 0, acted: false },
    ];
  }
  return [
    { id: 'melee', side: 'ally', c: 1, r: 4, hp: 20, max: 20, mv: 2, rng: 1, atk: 3, heal: 0, acted: false },
    { id: 'ranged', side: 'ally', c: 3, r: 4, hp: 16, max: 16, mv: 2, rng: 3, atk: 3, heal: 0, acted: false },
    { id: 'support', side: 'ally', c: 5, r: 4, hp: 16, max: 16, mv: 3, rng: 0, atk: 0, heal: 2, acted: false },
    { id: 'brute', side: 'enemy', c: 1, r: 2, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
    { id: 'shot', side: 'enemy', c: 3, r: 2, hp: 3, max: 3, mv: 1, rng: 3, atk: 1, heal: 0, acted: false },
    { id: 'lurker', side: 'enemy', c: 6, r: 2, hp: 3, max: 3, mv: 2, rng: 1, atk: 1, heal: 0, acted: false },
  ];
}

function blocksFor(map) {
  return map === 'ridge' ? [[2, 3], [4, 3], [5, 1]] : [];
}

function fresh() {
  return {
    phase: 'ready',
    turn: 0,
    selected: null,
    map: 'yard',
    note: '',
    blocks: blocksFor('yard'),
    units: opening('yard'),
  };
}

function living(s, side) {
  return s.units.filter((u) => u.hp > 0 && (!side || u.side === side));
}
function blocked(s, c, r) {
  return s.blocks.some(([bc, br]) => bc === c && br === r);
}
function at(s, c, r) {
  return s.units.find((u) => u.hp > 0 && u.c === c && u.r === r) ?? null;
}
function occupied(s, c, r) {
  return blocked(s, c, r) || at(s, c, r) != null;
}
function byId(s, id) {
  return s.units.find((u) => u.id === id);
}
function los(s, u, c, r) {
  if (u.c !== c && u.r !== r) return null;
  const dist = Math.abs(u.c - c) + Math.abs(u.r - r);
  if (dist < 1) return null;
  const dc = Math.sign(c - u.c);
  const dr = Math.sign(r - u.r);
  let x = u.c + dc;
  let y = u.r + dr;
  while (x !== c || y !== r) {
    if (occupied(s, x, y)) return null;
    x += dc;
    y += dr;
  }
  return dist;
}
function reach(s, u) {
  const seen = new Set([`${u.c},${u.r}`]);
  let frontier = [[u.c, u.r]];
  const out = [];
  for (let step = 1; step <= u.mv; step++) {
    const next = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        const key = `${nc},${nr}`;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen.has(key)) continue;
        seen.add(key);
        if (occupied(s, nc, nr)) continue;
        next.push([nc, nr]);
        out.push([nc, nr]);
      }
    }
    frontier = next;
  }
  return out;
}
function settle(s) {
  const allyOnDepot = living(s, 'ally').some((u) => u.c === DEPOT.c && u.r === DEPOT.r);
  if (allyOnDepot || living(s, 'enemy').length === 0) s.phase = 'clear';
  else if (living(s, 'ally').length === 0) s.phase = 'fail';
}
function attackRank(enemyId, allyId) {
  if (enemyId === 'lurker') return { support: 0, ranged: 1, melee: 2 }[allyId];
  return ALLY_RANK[allyId];
}
function enemyPhase(s) {
  for (const id of ['brute', 'shot', 'lurker']) {
    const e = byId(s, id);
    if (!e || e.hp <= 0 || s.phase !== 'playing') continue;
    for (let step = 0; step < e.mv; step += 1) {
      if (e.hp <= 0 || s.phase !== 'playing') break;
      const targets = living(s, 'ally').sort((a, b) => attackRank(e.id, a.id) - attackRank(e.id, b.id));
      if (!targets.length) break;
      const shots = targets.filter((a) => {
        const d = los(s, e, a.c, a.r);
        return d != null && d <= e.rng;
      });
      if (shots.length) {
        shots[0].hp = Math.max(0, shots[0].hp - e.atk);
        settle(s);
        break;
      }
      const support = e.id === 'lurker' ? targets.find((a) => a.id === 'support') : null;
      const goal = support ?? targets.slice().sort((a, b) => {
        const da = Math.abs(a.c - e.c) + Math.abs(a.r - e.r);
        const db = Math.abs(b.c - e.c) + Math.abs(b.r - e.r);
        return da - db || attackRank(e.id, a.id) - attackRank(e.id, b.id);
      })[0];
      const cur = Math.abs(goal.c - e.c) + Math.abs(goal.r - e.r);
      const steps = [[0, -1], [-1, 0], [1, 0], [0, 1]]
        .map(([dc, dr]) => [e.c + dc, e.r + dr])
        .filter(([c, r]) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !occupied(s, c, r));
      steps.sort((a, b) => {
        const da = Math.abs(goal.c - a[0]) + Math.abs(goal.r - a[1]);
        const db = Math.abs(goal.c - b[0]) + Math.abs(goal.r - b[1]);
        return da - db || a[1] - b[1] || a[0] - b[0];
      });
      if (!steps.length || Math.abs(goal.c - steps[0][0]) + Math.abs(goal.r - steps[0][1]) >= cur) break;
      e.c = steps[0][0];
      e.r = steps[0][1];
    }
  }
}
function endTurn(s) {
  if (s.phase !== 'playing') return;
  enemyPhase(s);
  if (s.phase !== 'playing') return;
  if (s.turn >= LIMIT) s.phase = 'fail';
  else {
    s.turn += 1;
    s.selected = null;
    for (const u of living(s, 'ally')) u.acted = false;
  }
}
function maybeAuto(s) {
  if (s.phase === 'playing' && living(s, 'ally').every((u) => u.acted)) endTurn(s);
}
function begin(s) {
  if (s.phase !== 'ready') return;
  s.phase = 'playing';
  s.turn = 1;
  s.note = '';
}
function resetMap(s, map) {
  s.map = map;
  s.phase = 'ready';
  s.turn = 0;
  s.selected = null;
  s.note = '';
  s.blocks = blocksFor(map);
  s.units = opening(map);
}
function cellOf(x, y) {
  if (x < OX || y < OY) return null;
  const c = Math.floor((x - OX) / CELL);
  const r = Math.floor((y - OY) / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return { c, r };
}
function click(s, x, y) {
  if (s.phase === 'clear' || s.phase === 'fail') {
    if (x >= 900 && x < 1180 && y >= 620 && y < 690) resetMap(s, s.map);
    else if (x >= 1020 && x < 1240 && y >= 540 && y < 596) resetMap(s, 'ridge');
    return;
  }
  if (x >= 440 && x < 840 && y >= 620 && y < 690) {
    begin(s);
    return;
  }
  if (s.phase !== 'playing') return;
  if (x >= 60 && x < 300 && y >= 620 && y < 690) {
    endTurn(s);
    return;
  }
  const cell = cellOf(x, y);
  if (!cell) return;
  const hit = at(s, cell.c, cell.r);
  const sel = s.selected ? byId(s, s.selected) : null;
  const canHeal = sel && sel.hp > 0 && !sel.acted && sel.heal > 0 && hit && hit.side === 'ally' && hit.id !== sel.id
    && Math.abs(hit.c - sel.c) + Math.abs(hit.r - sel.r) === 1;
  if (canHeal) {
    hit.hp = Math.min(hit.max, hit.hp + sel.heal);
    sel.acted = true;
    s.selected = null;
    maybeAuto(s);
    return;
  }
  if (hit && hit.side === 'ally' && !hit.acted) {
    s.selected = hit.id;
    return;
  }
  if (!sel || sel.acted || sel.hp <= 0) return;
  if (hit && hit.side === 'enemy') {
    const d = los(s, sel, hit.c, hit.r);
    if (d != null && d <= sel.rng && sel.atk > 0) {
      hit.hp = Math.max(0, hit.hp - sel.atk);
      sel.acted = true;
      s.selected = null;
      s.note = '';
      settle(s);
      maybeAuto(s);
    } else s.note = 'Rejected';
    return;
  }
  if (!hit) {
    if (!reach(s, sel).some(([c, r]) => c === cell.c && r === cell.r)) {
      s.note = 'Rejected';
      return;
    }
    sel.c = cell.c;
    sel.r = cell.r;
    sel.acted = true;
    s.selected = null;
    s.note = '';
    settle(s);
    maybeAuto(s);
  }
}
function key(s, code) {
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (code === 'Enter') begin(s);
  else if (code === 'Space' && s.phase === 'playing') endTurn(s);
}

const cell = (c, r) => ({ c, r });
function apply(s, act) {
  if (act === 'end') key(s, 'Space');
  else if (act === 'start') click(s, 640, 655);
  else if (act === 'retry') click(s, 1040, 655);
  else if (act === 'ridge') click(s, 1130, 568);
  else click(s, OX + act.c * CELL + 32, OY + act.r * CELL + 32);
}
function play(actions) {
  const s = fresh();
  for (const act of actions) apply(s, act);
  return s;
}

const LOOP = ['start', cell(1, 4), cell(7, 5), cell(1, 3), 'end', cell(1, 3), cell(1, 2)];
const CLEAR = [
  'start', cell(3, 4), cell(3, 2), cell(1, 4), cell(1, 3), 'end',
  cell(1, 3), cell(1, 2), cell(3, 4), cell(3, 3), 'end', cell(3, 3), cell(5, 3),
];
const HOLD = ['start', cell(5, 4), cell(4, 2), 'end', cell(4, 2), cell(3, 0)];
const FAIL = ['start', ...Array(8).fill('end')];

test('depot skirmish: illegal click stays put, then a step, then a kill', () => {
  const mid = fresh();
  for (const act of LOOP.slice(0, 3)) apply(mid, act);
  assert.equal(byId(mid, 'melee').c, 1);
  assert.equal(byId(mid, 'melee').r, 4);
  const moved = fresh();
  for (const act of LOOP.slice(0, 4)) apply(moved, act);
  assert.deepEqual([byId(moved, 'melee').c, byId(moved, 'melee').r], [1, 3]);
  assert.equal(mid.note, 'Rejected');
  assert.equal(mid.selected, 'melee');
  const afterEnd = fresh();
  for (const act of LOOP.slice(0, 5)) apply(afterEnd, act);
  assert.deepEqual([byId(afterEnd, 'brute').c, byId(afterEnd, 'brute').r], [1, 2]);
  const lurker = byId(afterEnd, 'lurker');
  assert.equal(Math.abs(lurker.c - 6) + Math.abs(lurker.r - 2), 2);
  assert.ok(Math.abs(lurker.c - 5) + Math.abs(lurker.r - 4) < 3);
  const done = play(LOOP);
  assert.equal(done.phase, 'playing');
  assert.equal(done.turn, 2);
  assert.equal(byId(done, 'brute').hp, 0);
  assert.ok(byId(done, 'melee').hp < 20);
  assert.notEqual(byId(done, 'lurker').c, 6);
  assert.equal(done.note, '');
});

test('depot skirmish: wiping the three enemies clears before the cap', () => {
  const s = play(CLEAR);
  assert.equal(s.phase, 'clear');
  assert.ok(s.turn < LIMIT);
  assert.equal(living(s, 'enemy').length, 0);
  assert.ok(byId(s, 'melee').hp > 0);
});

test('depot skirmish: standing on the depot clears with enemies still alive', () => {
  const s = play(HOLD);
  assert.equal(s.phase, 'clear');
  assert.equal(byId(s, 'support').c, DEPOT.c);
  assert.equal(byId(s, 'support').r, DEPOT.r);
  assert.ok(living(s, 'enemy').length > 0);
});

test('depot skirmish: eight passed turns lose on 8 / 8 with the depot empty', () => {
  const s = play(FAIL);
  assert.equal(s.phase, 'fail');
  assert.equal(s.turn, 8);
  assert.ok(living(s, 'enemy').length > 0);
  assert.ok(living(s, 'ally').every((u) => u.c !== DEPOT.c || u.r !== DEPOT.r));
});

test('depot skirmish: support heals an adjacent ally and cannot attack', () => {
  const s = play(['start', cell(5, 4), cell(4, 4), 'end', cell(4, 4), cell(3, 4)]);
  assert.equal(byId(s, 'ranged').hp, 16);
  const miss = play(['start', cell(5, 4), cell(3, 2)]);
  assert.equal(byId(miss, 'shot').hp, 3);
  assert.equal(miss.selected, 'support');
});

test('depot skirmish: retry restores the map and ridge is a different board', () => {
  const lost = play(FAIL);
  click(lost, 1040, 655);
  assert.equal(lost.phase, 'ready');
  assert.equal(lost.turn, 0);
  assert.equal(lost.map, 'yard');
  assert.deepEqual([byId(lost, 'melee').c, byId(lost, 'melee').r], [1, 4]);
  assert.equal(byId(lost, 'lurker').mv, 2);
  const won = play(CLEAR);
  click(won, 1130, 568);
  assert.equal(won.phase, 'ready');
  assert.equal(won.map, 'ridge');
  assert.equal(won.turn, 0);
  assert.deepEqual(won.blocks, [[2, 3], [4, 3], [5, 1]]);
  assert.deepEqual([byId(won, 'brute').c, byId(won, 'brute').r], [0, 1]);
  assert.deepEqual([byId(won, 'lurker').c, byId(won, 'lurker').r], [7, 4]);
  click(won, 640, 655);
  key(won, 'Space');
  assert.equal(won.phase, 'playing');
});

test('depot skirmish: ended input and a blocked shot do nothing', () => {
  const s = play(FAIL);
  const hp = byId(s, 'melee').hp;
  click(s, 640, 655);
  key(s, 'Space');
  assert.equal(s.phase, 'fail');
  assert.equal(byId(s, 'melee').hp, hp);
  const blocked = play(['start', cell(3, 4), cell(1, 3)]);
  assert.equal(byId(blocked, 'melee').r, 4);
  assert.equal(blocked.selected, 'ranged');
});

test('depot skirmish task: spec text and hidden rubric agree', () => {
  const b = loadP1Task('p1-depot-skirmish');
  assert.match(b.instruction, /Depot Skirmish/);
  assert.match(b.instruction, /Depot clear/);
  assert.match(b.instruction, /Depot lost/);
  assert.match(b.instruction, /turn N \/ 8/);
  assert.match(b.instruction, /\(1,4\)/);
  assert.match(b.instruction, /不超过 19 秒/);
  const byIdReq = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.equal(byIdReq.D1.scope, 'persistent');
  assert.equal(byIdReq.A1.scope, 'persistent');
  assert.deepEqual(byIdReq.M5.applies, ['fail']);
  assert.deepEqual(byIdReq.M6.applies, ['clear']);
  assert.equal(b.rubric.requirements.filter((r) => r.dim === 'D').length, 7);
  assert.equal(b.rubric.requirements.length, 24);
  assert.deepEqual(b.task.scenarios.required, ['intro', 'loop', 'fail', 'clear']);
  assert.equal(b.task.sample_fps, 2);
  assert.equal(b.task.max_demo_seconds, 19);
  assert.doesNotMatch(JSON.stringify(b.rubric), /phase|cursor|clockMs|remainMs/);
});

test('depot skirmish: Start, End and the board do not overlap', () => {
  const rects = {
    start: [440, 620, 400, 70],
    end: [60, 620, 240, 70],
    retry: [900, 620, 280, 70],
    ridge: [1020, 540, 220, 56],
    board: [384, 120, 512, 384],
  };
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

test('depot skirmish reference traces follow the scripted fights', () => {
  const scripts = {
    intro: [],
    loop: LOOP,
    fail: [...FAIL, 'retry'],
    clear: [...CLEAR, 'ridge'],
  };
  for (const engine of ['onegame', 'godot']) {
    const dir = path.join(EVAL_DIR, 'examples', 'oracles', 'p1-depot-skirmish', engine, 'demo_outputs');
    for (const name of fs.readdirSync(dir)) {
      const trace = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      const script = scripts[trace.scenario];
      assert.ok(script, name);
      assert.equal(trace.events.length, script.length, `${engine}/${name}`);
      const s = fresh();
      for (const ev of trace.events) {
        if (ev.type === 'click') click(s, ev.x, ev.y);
        else if (ev.type === 'keydown') key(s, ev.code);
      }
      if (trace.scenario === 'intro') assert.equal(s.phase, 'ready');
      if (trace.scenario === 'loop') {
        assert.equal(s.turn, 2);
        assert.equal(byId(s, 'brute').hp, 0);
      }
      if (trace.scenario === 'fail') {
        assert.equal(s.phase, 'ready');
        assert.equal(s.turn, 0);
        assert.equal(s.map, 'yard');
      }
      if (trace.scenario === 'clear') {
        assert.equal(s.phase, 'ready');
        assert.equal(s.map, 'ridge');
        assert.deepEqual([byId(s, 'shot').c, byId(s, 'shot').r], [5, 2]);
      }
    }
  }
});
