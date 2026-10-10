import test from 'node:test';
import assert from 'node:assert/strict';
import { loadP1Task } from '../src/p1-load.mjs';

const COLS = 8;
const ROWS = 5;
const OX = 352;
const OY = 148;
const CELL = 72;
const COSTS = { gun: 2, wall: 2, cannon: 4 };
const RANGE = { gun: 2, cannon: 3 };
const QUEUE = [
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1 },
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1 },
  { kind: 'flyer', hp: 3, atk: 0, fly: true, wave: 2 },
  { kind: 'brute', hp: 6, atk: 2, fly: false, wave: 3 },
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 3 },
];

function openingQueue() {
  return QUEUE.map((e, i) => ({ ...e, id: i }));
}
function fresh() {
  return {
    screen: 'select',
    map: '',
    open: 1,
    slot: 1,
    phase: 'ready',
    wave: 0,
    dp: 6,
    base: 4,
    selected: '',
    picked: null,
    note: '',
    shots: [],
    towers: [],
    enemies: [],
    queue: openingQueue(),
    drag: null,
    anim: 0,
    clock: 0,
  };
}
function dmgOf(t) {
  if (t.kind === 'gun') return t.upgraded ? 2 : 1;
  if (t.kind === 'cannon') return t.upgraded ? 5 : 3;
  return 0;
}
function reject(s) {
  s.note = 'Rejected';
}
function clearNote(s) {
  if (s.note === 'Rejected') s.note = '';
}
function pathRow(s) {
  return s.map === 'bend' ? 4 : 2;
}
function deploy(s, c, r) {
  const rows = s.map === 'bend' ? [2] : [1, 3];
  return rows.includes(r) && c >= 1 && c <= 6;
}
function onPath(s, c, r) {
  return r === pathRow(s) && c >= 0 && c < COLS;
}
function towerAt(s, c, r) {
  return s.towers.find((t) => t.c === c && t.r === r) ?? null;
}
function enemyOn(s, c, r, fly) {
  return s.enemies.find((e) => e.c === c && e.r === r && e.fly === fly) ?? null;
}
function groundOn(s, c, r) {
  return s.enemies.find((e) => e.c === c && e.r === r && !e.fly) ?? null;
}
function waveOf(s) {
  const ws = [...s.queue.map((e) => e.wave), ...s.enemies.map((e) => e.wave)];
  if (!ws.length) return s.phase === 'ready' ? 0 : 3;
  return Math.min(...ws);
}
function resetBattle(s) {
  s.phase = 'ready';
  s.wave = 0;
  s.dp = 6;
  s.base = 4;
  s.selected = '';
  s.picked = null;
  s.note = '';
  s.shots = [];
  s.towers = [];
  s.enemies = [];
  s.queue = openingQueue();
  s.drag = null;
  s.clock = 0;
}
function enter(s, map) {
  if (s.screen !== 'select') return;
  if (map === 'bend' && s.open < 2) {
    reject(s);
    return;
  }
  if (map !== 'straight' && map !== 'bend') return;
  s.screen = 'battle';
  s.map = map;
  resetBattle(s);
}
function begin(s) {
  if (s.screen !== 'battle' || s.phase !== 'ready') return;
  s.phase = 'playing';
  s.wave = 1;
}
function place(s, c, r) {
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  if (!s.selected) {
    const tower = towerAt(s, c, r);
    if (tower) s.picked = { c, r };
    return;
  }
  const kind = s.selected;
  const cost = COSTS[kind];
  if (s.dp < cost) {
    reject(s);
    return;
  }
  if (kind === 'wall') {
    if (!onPath(s, c, r) || towerAt(s, c, r) || groundOn(s, c, r)) {
      reject(s);
      return;
    }
    s.towers.push({ kind, c, r, hp: 6, upgraded: false });
  } else {
    if (!deploy(s, c, r) || towerAt(s, c, r)) {
      reject(s);
      return;
    }
    s.towers.push({ kind, c, r, hp: 1, upgraded: false });
  }
  s.dp -= cost;
  s.selected = '';
  s.picked = null;
  clearNote(s);
}
function upgrade(s) {
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  const t = s.picked ? towerAt(s, s.picked.c, s.picked.r) : null;
  if (!t || t.upgraded || s.dp < 2) {
    reject(s);
    return;
  }
  s.dp -= 2;
  t.upgraded = true;
  if (t.kind === 'wall') t.hp += 4;
  s.picked = null;
  clearNote(s);
}
function retry(s) {
  if (s.screen !== 'battle') return;
  if (s.phase !== 'clear' && s.phase !== 'fail') return;
  const map = s.map;
  const open = s.open;
  const slot = s.slot;
  resetBattle(s);
  s.screen = 'battle';
  s.map = map;
  s.open = open;
  s.slot = slot;
}
function maps(s) {
  if (s.screen !== 'battle') return;
  if (s.phase !== 'clear' && s.phase !== 'fail') return;
  s.screen = 'select';
  s.drag = null;
  s.note = '';
  s.shots = [];
  s.phase = 'ready';
}
function saveGame(s) {
  if (s.screen !== 'select') return;
  s.slot = s.open;
  s.note = 'Saved';
}
function wipe(s) {
  if (s.screen !== 'select') return;
  s.open = 1;
  s.note = 'Wiped';
}
function loadGame(s) {
  if (s.screen !== 'select') return;
  s.open = s.slot;
  s.note = 'Loaded';
}
function tick(s) {
  s.anim += 1;
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  s.clock += 1;
  if (s.clock % 30 === 0) s.dp = Math.min(10, s.dp + 1);
}
function step(s) {
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  clearNote(s);
  s.shots = [];
  const row = pathRow(s);
  const towers = s.towers.filter((t) => t.kind !== 'wall').sort((a, b) => a.c - b.c || a.r - b.r);
  for (const t of towers) {
    const hits = s.enemies
      .filter((e) => Math.abs(e.c - t.c) + Math.abs(e.r - t.r) <= RANGE[t.kind])
      .sort((a, b) => b.c - a.c || a.r - b.r || Number(a.fly) - Number(b.fly));
    if (hits[0]) {
      hits[0].hp -= dmgOf(t);
      s.shots.push({ fc: t.c, fr: t.r, tc: hits[0].c, tr: hits[0].r });
    }
  }
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  const order = [...s.enemies].sort((a, b) => b.c - a.c || a.r - b.r || Number(a.fly) - Number(b.fly));
  for (const e of order) {
    if (!s.enemies.includes(e)) continue;
    const nc = e.c + 1;
    if (nc >= COLS) {
      s.base -= 1;
      s.enemies = s.enemies.filter((x) => x !== e);
      continue;
    }
    if (e.fly) {
      if (enemyOn(s, nc, e.r, true)) continue;
      e.c = nc;
      continue;
    }
    const wall = towerAt(s, nc, e.r);
    if (wall && wall.kind === 'wall') {
      wall.hp -= e.atk;
      continue;
    }
    if (groundOn(s, nc, e.r)) continue;
    e.c = nc;
  }
  s.towers = s.towers.filter((t) => t.kind !== 'wall' || t.hp > 0);
  if (s.queue.length) {
    const next = s.queue[0];
    const blocked = next.fly ? enemyOn(s, 0, row, true) : groundOn(s, 0, row) || towerAt(s, 0, row);
    if (!blocked) {
      s.queue.shift();
      s.enemies.push({ ...next, c: 0, r: row });
    }
  }
  if (s.base <= 0) s.phase = 'fail';
  else if (!s.queue.length && !s.enemies.length) {
    s.phase = 'clear';
    if (s.map === 'straight') s.open = Math.max(s.open, 2);
  }
  s.wave = waveOf(s);
}
function cellCenter(c, r) {
  return [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];
}
function inside(x, y, rect) {
  return x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
}
function cardAt(x, y) {
  if (inside(x, y, [48, 160, 260, 56])) return 'gun';
  if (inside(x, y, [48, 228, 260, 56])) return 'wall';
  if (inside(x, y, [48, 296, 260, 56])) return 'cannon';
  return '';
}
function click(s, x, y) {
  if (s.screen === 'battle' && inside(x, y, [900, 620, 280, 70])) {
    retry(s);
    return;
  }
  if (s.screen === 'battle' && inside(x, y, [1020, 400, 220, 56])) {
    maps(s);
    return;
  }
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (s.screen === 'battle' && inside(x, y, [1020, 160, 220, 56])) {
    upgrade(s);
    return;
  }
  if (s.screen === 'battle' && inside(x, y, [440, 620, 400, 70])) {
    begin(s);
    return;
  }
  if (s.screen === 'battle' && inside(x, y, [60, 620, 240, 70])) {
    step(s);
    return;
  }
  if (s.screen === 'select' && inside(x, y, [80, 160, 520, 180])) {
    enter(s, 'straight');
    return;
  }
  if (s.screen === 'select' && inside(x, y, [640, 160, 520, 180])) {
    enter(s, 'bend');
    return;
  }
  if (s.screen === 'select' && inside(x, y, [80, 420, 200, 56])) {
    saveGame(s);
    return;
  }
  if (s.screen === 'select' && inside(x, y, [300, 420, 200, 56])) {
    wipe(s);
    return;
  }
  if (s.screen === 'select' && inside(x, y, [520, 420, 200, 56])) {
    loadGame(s);
    return;
  }
  if (s.screen === 'battle' && s.phase === 'playing' && x >= OX && y >= OY) {
    const c = Math.floor((x - OX) / CELL);
    const r = Math.floor((y - OY) / CELL);
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) {
      const tower = towerAt(s, c, r);
      if (tower) s.picked = { c, r };
    }
  }
}
function pointerDown(s, x, y) {
  if (s.screen === 'battle' && s.phase === 'playing') {
    const kind = cardAt(x, y);
    if (kind) {
      s.drag = { kind, x, y };
      s.picked = null;
    }
  }
}
function pointerMove(s, x, y) {
  if (!s.drag) return;
  s.drag = { kind: s.drag.kind, x, y };
}
function pointerUp(s, x, y) {
  if (!s.drag) {
    click(s, x, y);
    return;
  }
  const kind = s.drag.kind;
  s.drag = null;
  if (s.phase !== 'playing') return;
  s.selected = kind;
  if (x >= OX && y >= OY) {
    const c = Math.floor((x - OX) / CELL);
    const r = Math.floor((y - OY) / CELL);
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) {
      place(s, c, r);
      s.selected = '';
      return;
    }
  }
  reject(s);
  s.selected = '';
}
function press(s, code) {
  if (s.screen !== 'battle' || s.phase === 'clear' || s.phase === 'fail') return;
  if (code === 'Enter') begin(s);
  else if (code === 'Space') step(s);
}
function apply(s, ev) {
  if (ev.type === 'click') click(s, ev.x, ev.y);
  else if (ev.type === 'mouse_down') pointerDown(s, ev.x, ev.y);
  else if (ev.type === 'mouse_move') pointerMove(s, ev.x, ev.y);
  else if (ev.type === 'mouse_up') pointerUp(s, ev.x, ev.y);
  else if (ev.type === 'keydown') press(s, ev.code);
}
function replay(events) {
  const s = fresh();
  const last = events.reduce((max, ev) => Math.max(max, ev.frame), 0);
  const by = new Map();
  for (const ev of events) {
    const list = by.get(ev.frame) ?? [];
    list.push(ev);
    by.set(ev.frame, list);
  }
  for (let frame = 0; frame <= last; frame += 1) {
    for (const ev of by.get(frame) ?? []) apply(s, ev);
    tick(s);
  }
  return s;
}
function trace(scenario, events, duration) {
  return {
    schema: 'eval.trace/1',
    scenario,
    duration_frames: duration,
    viewport: { w: 1280, h: 720 },
    events,
  };
}
function atFrame(frame, type, extra) {
  return { frame, type, ...extra };
}

const GUN = [178, 188];
const WALL = [178, 256];
const CANNON = [178, 324];
const START = [640, 655];
const STEP = [180, 655];
const UPGRADE = [1130, 188];
const RETRY = [1040, 655];
const STRAIGHT = [340, 250];
const BEND = [900, 250];
const SAVE = [180, 448];
const WIPE = [400, 448];
const LOAD = [620, 448];
const MAPS = [1130, 428];

test('tower defense: a click does not place, a drag does', () => {
  const s = fresh();
  enter(s, 'straight');
  begin(s);
  click(s, WALL[0], WALL[1]);
  click(s, cellCenter(2, 2)[0], cellCenter(2, 2)[1]);
  assert.equal(s.towers.length, 0);
  assert.equal(s.dp, 6);
  pointerDown(s, WALL[0], WALL[1]);
  pointerMove(s, cellCenter(1, 1)[0], cellCenter(1, 1)[1]);
  pointerUp(s, cellCenter(1, 1)[0], cellCenter(1, 1)[1]);
  assert.equal(s.towers.length, 0);
  assert.equal(s.note, 'Rejected');
  assert.equal(s.dp, 6);
  pointerDown(s, WALL[0], WALL[1]);
  pointerUp(s, cellCenter(2, 2)[0], cellCenter(2, 2)[1]);
  assert.equal(s.towers.length, 1);
  assert.equal(s.dp, 4);
});

test('tower defense: dp rises once a second without Step', () => {
  const s = fresh();
  enter(s, 'straight');
  begin(s);
  for (let i = 0; i < 29; i += 1) tick(s);
  assert.equal(s.dp, 6);
  tick(s);
  assert.equal(s.dp, 7);
  assert.equal(s.towers.length, 0);
});

test('tower defense: Space before start does nothing', () => {
  const s = fresh();
  press(s, 'Space');
  enter(s, 'straight');
  press(s, 'Space');
  assert.equal(s.phase, 'ready');
  assert.equal(s.dp, 6);
  assert.equal(s.enemies.length, 0);
});

test('tower defense: a wall stops scouts while a flyer passes it', () => {
  const s = fresh();
  enter(s, 'straight');
  begin(s);
  s.selected = 'wall';
  place(s, 2, 2);
  assert.equal(s.towers[0].kind, 'wall');
  let passed = null;
  for (let i = 0; i < 12 && s.phase === 'playing'; i += 1) {
    step(s);
    const wall = s.towers.find((t) => t.kind === 'wall');
    const flyer = s.enemies.find((e) => e.fly && e.c > 2);
    const stuck = s.enemies.find((e) => !e.fly && e.c < 2);
    if (wall && wall.hp > 0 && flyer && stuck) {
      passed = s;
      break;
    }
  }
  assert.ok(passed, 'flyer should cross the wall while a scout is still behind it');
  assert.equal(passed.base, 4);
  assert.equal(passed.wave, 1);
});

test('tower defense: no towers leak the base', () => {
  const s = fresh();
  enter(s, 'straight');
  begin(s);
  let n = 0;
  while (s.phase === 'playing' && n < 30) {
    step(s);
    n += 1;
  }
  assert.equal(s.phase, 'fail');
  assert.equal(s.base, 0);
  assert.ok(n <= 18);
  assert.ok(s.enemies.length >= 1);
});

test('tower defense: clearing Straight unlocks Bend, and load restores it', () => {
  const s = fresh();
  enter(s, 'bend');
  assert.equal(s.screen, 'select');
  assert.equal(s.note, 'Rejected');
  enter(s, 'straight');
  begin(s);
  s.selected = 'cannon';
  place(s, 4, 1);
  s.selected = 'wall';
  place(s, 7, 2);
  step(s);
  step(s);
  while (s.dp < 2) tick(s);
  s.selected = 'gun';
  place(s, 6, 1);
  let n = 2;
  while (s.phase === 'playing' && n < 24) {
    step(s);
    n += 1;
  }
  assert.equal(s.phase, 'clear');
  assert.equal(s.base, 4);
  assert.equal(s.open, 2);
  assert.ok(s.shots.length > 0);
  maps(s);
  assert.equal(s.screen, 'select');
  saveGame(s);
  assert.equal(s.note, 'Saved');
  wipe(s);
  assert.equal(s.open, 1);
  assert.equal(s.note, 'Wiped');
  loadGame(s);
  assert.equal(s.open, 2);
  assert.equal(s.note, 'Loaded');
  enter(s, 'bend');
  assert.equal(s.map, 'bend');
  assert.equal(pathRow(s), 4);
  assert.equal(s.phase, 'ready');
  assert.equal(s.towers.length, 0);
});

test('tower defense task: spec text and hidden rubric agree', () => {
  const b = loadP1Task('p1-tower-defense');
  assert.equal(b.task.sample_fps, 2);
  assert.equal(b.task.max_demo_seconds, 19);
  assert.deepEqual(b.task.input.keys, ['Enter', 'Space']);
  assert.ok(b.task.input.events.includes('mouse_down'));
  assert.match(b.instruction, /Tower Defense/);
  assert.match(b.instruction, /Tower lost/);
  assert.match(b.instruction, /Tower clear/);
  assert.match(b.instruction, /flyer/);
  assert.match(b.instruction, /19 秒/);
  assert.match(b.instruction, /Rejected/);
  assert.match(b.instruction, /Upgrade/);
  assert.match(b.instruction, /Retry/);
  assert.match(b.instruction, /Straight/);
  assert.match(b.instruction, /Bend/);
  assert.match(b.instruction, /Save/);
  assert.match(b.instruction, /Load/);
  assert.match(b.instruction, /Wipe/);
  assert.match(b.instruction, /拖/);
  assert.doesNotMatch(b.instruction, /\(2,2\)|\(4,1\)|\(6,1\)|\(7,2\)/);
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.match(byId.M3.description, /拖/);
  assert.match(byId.M7.description, /Retry/);
  assert.match(byId.D2.description, /每秒|涨/);
  assert.match(byId.D4.description, /射击线/);
  assert.match(byId.D7.description, /升级/);
  assert.match(byId.D8.description, /Bend/);
  assert.match(byId.A5.description, /静帧/);
  assert.equal(byId.V2.agg, 'mean');
  assert.equal(byId.D1.agg, 'max');
  assert.equal(byId.A5.agg, 'max');
  assert.doesNotMatch(byId.M1.description, /机制或种类成立|正式素材/);
  assert.doesNotMatch(byId.D1.description, /机制或种类成立|正式素材/);
  assert.match(byId.V1.description, /静帧平均/);
  assert.match(byId.D1.description, /flyer/);
  const start = b.instruction.match(/Start 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const stepBtn = b.instruction.match(/Step 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const upgrade = b.instruction.match(/Upgrade 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const retryBtn = b.instruction.match(/Retry 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const mapsBtn = b.instruction.match(/Maps 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  assert.ok(start && stepBtn && upgrade && retryBtn && mapsBtn);
  const rects = [start, stepBtn, upgrade, retryBtn, mapsBtn].map((m) => m.slice(1).map(Number));
  const board = { x: OX, y: OY, w: COLS * CELL, h: ROWS * CELL };
  const bases = [2, 4].map((row) => ({ x: OX + COLS * CELL, y: OY + row * CELL, w: CELL, h: CELL }));
  function overlap(a, b) {
    return a[0] < b.x + b.w && a[0] + a[2] > b.x && a[1] < b.y + b.h && a[1] + a[3] > b.y;
  }
  for (const rect of rects) {
    assert.equal(overlap(rect, board), false);
    for (const base of bases) assert.equal(overlap(rect, base), false);
  }
});
