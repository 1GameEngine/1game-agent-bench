import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadP1Task } from '../src/p1-load.mjs';
import { auditTrace, tracePolicy } from '../src/p1-trace.mjs';
import { EVAL_DIR } from '../src/paths.mjs';

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

function fresh() {
  return {
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
    queue: QUEUE.map((e, i) => ({ ...e, id: i })),
    seq: 0,
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
function deploy(c, r) {
  return (r === 1 || r === 3) && c >= 1 && c <= 6;
}
function onPath(c, r) {
  return r === 2 && c >= 0 && c < COLS;
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
function begin(s) {
  if (s.phase !== 'ready') return;
  s.phase = 'playing';
  s.wave = 1;
}
function select(s, kind) {
  if (s.phase !== 'playing' || !COSTS[kind]) return;
  s.selected = kind;
  s.picked = null;
}
function place(s, c, r) {
  if (s.phase !== 'playing') return;
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
    if (!onPath(c, r) || towerAt(s, c, r) || groundOn(s, c, r)) {
      reject(s);
      return;
    }
    s.towers.push({ kind, c, r, hp: 6, upgraded: false });
  } else {
    if (!deploy(c, r) || towerAt(s, c, r)) {
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
  if (s.phase !== 'playing') return;
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
  if (s.phase !== 'clear' && s.phase !== 'fail') return;
  const next = fresh();
  for (const key of Object.keys(s)) delete s[key];
  Object.assign(s, next);
}
function step(s) {
  if (s.phase !== 'playing') return;
  clearNote(s);
  s.shots = [];
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
    const blocked = next.fly ? enemyOn(s, 0, 2, true) : (groundOn(s, 0, 2) || towerAt(s, 0, 2));
    if (!blocked) {
      s.queue.shift();
      s.enemies.push({ ...next, c: 0, r: 2 });
    }
  }
  if (s.base <= 0) s.phase = 'fail';
  else if (!s.queue.length && !s.enemies.length) s.phase = 'clear';
  else s.dp = Math.min(10, s.dp + 1);
  s.wave = waveOf(s);
}
function cellCenter(c, r) {
  return [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];
}
function click(s, x, y) {
  if (x >= 900 && x < 1180 && y >= 620 && y < 690) {
    retry(s);
    return;
  }
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (x >= 1020 && x < 1240 && y >= 160 && y < 216) {
    upgrade(s);
    return;
  }
  if (x >= 440 && x < 840 && y >= 620 && y < 690) {
    begin(s);
    return;
  }
  if (x >= 60 && x < 300 && y >= 620 && y < 690) {
    step(s);
    return;
  }
  if (x >= 48 && x < 308 && y >= 160 && y < 216) {
    select(s, 'gun');
    return;
  }
  if (x >= 48 && x < 308 && y >= 228 && y < 284) {
    select(s, 'wall');
    return;
  }
  if (x >= 48 && x < 308 && y >= 296 && y < 352) {
    select(s, 'cannon');
    return;
  }
  if (x >= OX && y >= OY) {
    const c = Math.floor((x - OX) / CELL);
    const r = Math.floor((y - OY) / CELL);
    if (c >= 0 && r >= 0 && c < COLS && r < ROWS) place(s, c, r);
  }
}
function press(s, code) {
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (code === 'Enter') begin(s);
  else if (code === 'Space') step(s);
}
function replay(events) {
  const s = fresh();
  for (const ev of events) {
    if (ev.type === 'click') click(s, ev.x, ev.y);
    if (ev.type === 'keydown') press(s, ev.code);
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

test('tower defense: illegal tile and a poor card do not spend dp', () => {
  const s = fresh();
  begin(s);
  select(s, 'gun');
  place(s, 3, 2);
  assert.equal(s.towers.length, 0);
  assert.equal(s.dp, 6);
  assert.equal(s.note, 'Rejected');
  select(s, 'cannon');
  place(s, 4, 1);
  assert.equal(s.dp, 2);
  select(s, 'cannon');
  place(s, 5, 1);
  assert.equal(s.towers.length, 1);
  assert.equal(s.dp, 2);
  assert.equal(s.phase, 'playing');
});

test('tower defense: Space before start does nothing', () => {
  const s = fresh();
  press(s, 'Space');
  assert.equal(s.phase, 'ready');
  assert.equal(s.dp, 6);
  assert.equal(s.enemies.length, 0);
});

test('tower defense: a wall stops scouts while a flyer passes it', () => {
  const s = fresh();
  begin(s);
  select(s, 'wall');
  place(s, 1, 1);
  assert.equal(s.towers.length, 0);
  place(s, 2, 2);
  assert.equal(s.towers[0].kind, 'wall');
  let passed = null;
  for (let i = 0; i < 12 && s.phase === 'playing'; i++) {
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

test('tower defense: cannon, wall and a late gun clear with base intact', () => {
  const s = fresh();
  begin(s);
  select(s, 'cannon');
  place(s, 4, 1);
  select(s, 'wall');
  place(s, 7, 2);
  step(s);
  step(s);
  select(s, 'gun');
  place(s, 6, 1);
  let n = 2;
  while (s.phase === 'playing' && n < 24) {
    step(s);
    n += 1;
  }
  assert.equal(s.phase, 'clear');
  assert.equal(s.base, 4);
  assert.equal(s.wave, 3);
  assert.deepEqual(s.towers.map((t) => t.kind).sort(), ['cannon', 'gun', 'wall']);
  assert.ok(s.shots.length > 0);
  assert.ok(n <= 16);
  retry(s);
  assert.equal(s.phase, 'ready');
  assert.equal(s.wave, 0);
  assert.equal(s.dp, 6);
  assert.equal(s.base, 4);
  assert.equal(s.towers.length, 0);
});

test('tower defense task: spec text and hidden rubric agree', () => {
  const b = loadP1Task('p1-tower-defense');
  assert.equal(b.task.sample_fps, 2);
  assert.equal(b.task.max_demo_seconds, 19);
  assert.deepEqual(b.task.input.keys, ['Enter', 'Space']);
  assert.match(b.instruction, /Tower Defense/);
  assert.match(b.instruction, /Tower lost/);
  assert.match(b.instruction, /Tower clear/);
  assert.match(b.instruction, /flyer/);
  assert.match(b.instruction, /19 秒/);
  assert.match(b.instruction, /Rejected/);
  assert.match(b.instruction, /Upgrade/);
  assert.match(b.instruction, /Retry/);
  assert.doesNotMatch(b.instruction, /\(2,2\)|\(4,1\)|\(6,1\)|\(7,2\)/);
  const byId = Object.fromEntries(b.rubric.requirements.map((r) => [r.id, r]));
  assert.match(byId.M3.description, /Rejected/);
  assert.match(byId.M7.description, /Retry/);
  assert.match(byId.D4.description, /射击线/);
  assert.match(byId.D7.description, /升级/);
  assert.equal(byId.V2.agg, 'mean');
  assert.equal(byId.D1.agg, 'max');
  assert.match(byId.M1.description, /纯色块/);
  assert.match(byId.D1.description, /纯色块/);
  assert.match(byId.V1.description, /静帧平均/);
  assert.match(byId.D1.description, /flyer/);
  const start = b.instruction.match(/Start 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const stepBtn = b.instruction.match(/Step 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const upgrade = b.instruction.match(/Upgrade 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  const retryBtn = b.instruction.match(/Retry 矩形 \((\d+),(\d+),(\d+),(\d+)\)/);
  assert.ok(start && stepBtn && upgrade && retryBtn);
  const rects = [start, stepBtn, upgrade, retryBtn].map((m) => m.slice(1).map(Number));
  const board = { x: OX, y: OY, w: COLS * CELL, h: ROWS * CELL };
  const base = { x: OX + COLS * CELL, y: OY + 2 * CELL, w: CELL, h: CELL };
  function overlap(a, b) {
    return a[0] < b.x + b.w && a[0] + a[2] > b.x && a[1] < b.y + b.h && a[1] + a[3] > b.y;
  }
  for (const rect of rects) {
    assert.equal(overlap(rect, board), false);
    assert.equal(overlap(rect, base), false);
  }
});

test('tower defense reference traces follow the scripted fights', () => {
  const b = loadP1Task('p1-tower-defense');
  const policy = tracePolicy(b.task);
  for (const engine of ['onegame', 'godot']) {
    const dir = path.join(EVAL_DIR, 'examples', 'oracles', 'p1-tower-defense', engine, 'demo_outputs');
    const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
    assert.deepEqual(files, ['01_intro.json', '02_loop.json', '03_fail.json', '04_clear.json']);
    const byScenario = {};
    for (const name of files) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      assert.equal(auditTrace(doc, policy).ok, true, `${engine}/${name} ${auditTrace(doc, policy).issues}`);
      byScenario[doc.scenario] = doc;
    }
    assert.equal(byScenario.intro.events.length, 0);
    const upgraded = replay(eventsUntil(byScenario.loop.events, UPGRADE));
    const freshWall = upgraded.towers.find((t) => t.kind === 'wall');
    assert.equal(freshWall.upgraded, true);
    assert.equal(freshWall.hp, 10);
    assert.equal(upgraded.dp, 2);
    const loop = replay(byScenario.loop.events);
    const wall = loop.towers.find((t) => t.kind === 'wall');
    assert.ok(wall && wall.upgraded && wall.hp > 0);
    assert.ok(loop.enemies.some((e) => e.fly && e.c > wall.c));
    assert.ok(loop.enemies.some((e) => !e.fly && e.c < wall.c));
    assert.equal(loop.base, 4);
    const failMid = replay(beforeRetry(byScenario.fail.events));
    assert.equal(failMid.phase, 'fail');
    assert.equal(failMid.base, 0);
    assert.equal(failMid.towers.length, 0);
    const fail = replay(byScenario.fail.events);
    assert.equal(fail.phase, 'ready');
    assert.equal(fail.wave, 0);
    assert.equal(fail.dp, 6);
    assert.equal(fail.base, 4);
    const clearMid = replay(beforeRetry(byScenario.clear.events));
    assert.equal(clearMid.phase, 'clear');
    assert.equal(clearMid.base, 4);
    assert.ok(clearMid.shots.length > 0);
    assert.deepEqual(clearMid.towers.map((t) => t.kind).sort(), ['cannon', 'gun', 'wall']);
    const clear = replay(byScenario.clear.events);
    assert.equal(clear.phase, 'ready');
    assert.equal(clear.towers.length, 0);
  }
});

function eventsUntil(events, point) {
  const index = events.findIndex((ev) => ev.type === 'click' && ev.x === point[0] && ev.y === point[1]);
  return index < 0 ? events : events.slice(0, index + 1);
}
function beforeRetry(events) {
  const index = events.findIndex((ev) => ev.type === 'click' && ev.x === RETRY[0] && ev.y === RETRY[1]);
  return index < 0 ? events : events.slice(0, index);
}

export const demoEvents = {
  loop() {
    const events = [
      atFrame(10, 'click', { x: START[0], y: START[1] }),
      atFrame(22, 'click', { x: WALL[0], y: WALL[1] }),
      atFrame(34, 'click', { x: cellCenter(1, 1)[0], y: cellCenter(1, 1)[1] }),
      atFrame(46, 'click', { x: cellCenter(2, 2)[0], y: cellCenter(2, 2)[1] }),
      atFrame(58, 'click', { x: cellCenter(2, 2)[0], y: cellCenter(2, 2)[1] }),
      atFrame(70, 'click', { x: UPGRADE[0], y: UPGRADE[1] }),
    ];
    let frame = 82;
    const probe = fresh();
    begin(probe);
    select(probe, 'wall');
    place(probe, 2, 2);
    place(probe, 2, 2);
    upgrade(probe);
    while (probe.phase === 'playing' && frame < 400) {
      events.push(atFrame(frame, 'click', { x: STEP[0], y: STEP[1] }));
      step(probe);
      const wall = probe.towers.find((t) => t.kind === 'wall');
      const flyer = probe.enemies.find((e) => e.fly && wall && e.c > wall.c);
      const stuck = probe.enemies.find((e) => !e.fly && wall && e.c < wall.c);
      frame += 12;
      if (wall && wall.hp > 0 && flyer && stuck) break;
    }
    return trace('loop', events, frame + 36);
  },
  fail() {
    const events = [atFrame(10, 'click', { x: START[0], y: START[1] })];
    let frame = 22;
    const probe = fresh();
    begin(probe);
    while (probe.phase === 'playing') {
      events.push(atFrame(frame, 'click', { x: STEP[0], y: STEP[1] }));
      step(probe);
      frame += 12;
    }
    events.push(atFrame(frame, 'click', { x: RETRY[0], y: RETRY[1] }));
    return trace('fail', events, frame + 48);
  },
  clear() {
    const events = [
      atFrame(10, 'click', { x: START[0], y: START[1] }),
      atFrame(22, 'click', { x: CANNON[0], y: CANNON[1] }),
      atFrame(34, 'click', { x: cellCenter(4, 1)[0], y: cellCenter(4, 1)[1] }),
      atFrame(46, 'click', { x: WALL[0], y: WALL[1] }),
      atFrame(58, 'click', { x: cellCenter(7, 2)[0], y: cellCenter(7, 2)[1] }),
      atFrame(70, 'click', { x: STEP[0], y: STEP[1] }),
      atFrame(82, 'click', { x: STEP[0], y: STEP[1] }),
      atFrame(94, 'click', { x: GUN[0], y: GUN[1] }),
      atFrame(106, 'click', { x: cellCenter(6, 1)[0], y: cellCenter(6, 1)[1] }),
    ];
    let frame = 118;
    const probe = replay(events);
    while (probe.phase === 'playing') {
      events.push(atFrame(frame, 'click', { x: STEP[0], y: STEP[1] }));
      step(probe);
      frame += 12;
    }
    events.push(atFrame(frame, 'click', { x: RETRY[0], y: RETRY[1] }));
    return trace('clear', events, frame + 48);
  },
};
