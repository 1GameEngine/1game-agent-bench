export const BOARD_X = 352;
export const BOARD_Y = 148;
export const CELL = 72;
export const COLS = 8;
export const ROWS = 5;

export type Kind = 'gun' | 'wall' | 'cannon';
export type Rect = { x: number; y: number; w: number; h: number };

export const R_STRAIGHT: Rect = { x: 80, y: 160, w: 520, h: 180 };
export const R_BEND: Rect = { x: 640, y: 160, w: 520, h: 180 };
export const R_SAVE: Rect = { x: 80, y: 420, w: 200, h: 56 };
export const R_WIPE: Rect = { x: 300, y: 420, w: 200, h: 56 };
export const R_LOAD: Rect = { x: 520, y: 420, w: 200, h: 56 };
export const R_START: Rect = { x: 440, y: 620, w: 400, h: 70 };
export const R_STEP: Rect = { x: 60, y: 620, w: 240, h: 70 };
export const R_RETRY: Rect = { x: 900, y: 620, w: 280, h: 70 };
export const R_UPGRADE: Rect = { x: 1020, y: 160, w: 220, h: 56 };
export const R_MAPS: Rect = { x: 1020, y: 400, w: 220, h: 56 };

export const CARDS: { kind: Kind; rect: Rect; cost: number; info: string }[] = [
  { kind: 'gun', rect: { x: 48, y: 160, w: 260, h: 56 }, cost: 2, info: 'range 2  dmg 1' },
  { kind: 'wall', rect: { x: 48, y: 228, w: 260, h: 56 }, cost: 2, info: 'on path  hp 6' },
  { kind: 'cannon', rect: { x: 48, y: 296, w: 260, h: 56 }, cost: 4, info: 'range 3  dmg 3' },
];

export const MAPS = [
  { name: 'Straight', pathRow: 2, deployRows: [1, 3] },
  { name: 'Bend', pathRow: 4, deployRows: [2] },
];

export const QUEUE = [
  { name: 'scout', wave: 1, hp: 2, atk: 1, fly: false },
  { name: 'scout', wave: 1, hp: 2, atk: 1, fly: false },
  { name: 'flyer', wave: 2, hp: 3, atk: 0, fly: true },
  { name: 'brute', wave: 3, hp: 6, atk: 2, fly: false },
  { name: 'scout', wave: 3, hp: 2, atk: 1, fly: false },
];

export const WALL_HP = 6;
export const WALL_UP_HP = 4;
export const UPGRADE_COST = 2;
export const DP_CAP = 10;
export const START_DP = 6;
export const START_BASE = 4;

export type Phase = 'ready' | 'playing' | 'lost' | 'clear';
export type Def = { id: string; kind: Kind; col: number; row: number; up: boolean; hp: number };
export type Enemy = { id: string; idx: number; name: string; col: number; hp: number; fly: boolean };
export type Shot = { id: string; x1: number; y1: number; x2: number; y2: number };
export type GameState = {
  screen: 'select' | 'board';
  phase: Phase;
  open: number;
  save: number;
  msg: string;
  mapId: number;
  animMs: number;
  frameNo: number;
  playMs: number;
  kSeen: number;
  gain: number;
  dpSpent: number;
  gainOffset: number;
  playOrigin: number;
  kOffset: number;
  inputFrame: number;
  shotAt: number;
  base: number;
  nextSpawn: number;
  enemies: Enemy[];
  defs: Def[];
  nextDefId: number;
  selected: string;
  shots: Shot[];
  dragCard: string;
  dragX: number;
  dragY: number;
  undo: string;
};


export function initialState(): GameState {
  return {
  screen: 'select',
  phase: 'ready',
  open: 1,
  save: 1,
  msg: '',
  mapId: 0,
  animMs: 0,
  frameNo: 0,
  playMs: 0,
  kSeen: 0,
  gain: 0,
  dpSpent: 0,
  gainOffset: 0,
  playOrigin: 0,
  kOffset: 0,
  inputFrame: -1,
  shotAt: 0,
  base: START_BASE,
  nextSpawn: 0,
  enemies: [],
  defs: [],
  nextDefId: 1,
  selected: '',
  shots: [],
  dragCard: '',
  dragX: 0,
  dragY: 0,
  undo: '',
  };
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function cellX(col: number): number {
  return BOARD_X + col * CELL;
}

export function cellY(row: number): number {
  return BOARD_Y + row * CELL;
}

export function cellAt(x: number, y: number): { col: number; row: number } | null {
  if (x < BOARD_X || y < BOARD_Y) return null;
  const col = Math.floor((x - BOARD_X) / CELL);
  const row = Math.floor((y - BOARD_Y) / CELL);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { col, row };
}

export function isDeploy(mapId: number, col: number, row: number): boolean {
  return col >= 1 && col <= 6 && MAPS[mapId].deployRows.includes(row);
}

export function defAt(d: GameState, col: number, row: number): Def | undefined {
  return d.defs.find((df) => df.col === col && df.row === row);
}

export function dpOf(s: GameState): number {
  return START_DP + (s.gain - s.gainOffset) - s.dpSpent;
}

export function resetMap(d: GameState, mapId: number): void {
  d.screen = 'board';
  d.mapId = mapId;
  d.phase = 'ready';
  d.msg = '';
  d.dpSpent = 0;
  d.gainOffset = d.gain;
  d.base = START_BASE;
  d.nextSpawn = 0;
  d.enemies.splice(0, d.enemies.length);
  d.defs.splice(0, d.defs.length);
  d.nextDefId = 1;
  d.selected = '';
  d.shots.splice(0, d.shots.length);
  d.shotAt = d.animMs;
  d.dragCard = '';
}

export function currentWave(s: GameState): number {
  if (s.screen !== 'board' || s.phase === 'ready') return 0;
  let best = 99;
  for (let i = s.nextSpawn; i < QUEUE.length; i++) best = Math.min(best, QUEUE[i].wave);
  for (const e of s.enemies) best = Math.min(best, QUEUE[e.idx].wave);
  return best === 99 ? 3 : best;
}

export function doStep(d: GameState): void {
  d.msg = '';
  d.shots.splice(0, d.shots.length);
  d.shotAt = d.animMs;
  const pr = MAPS[d.mapId].pathRow;

  for (const kind of ['gun', 'cannon'] as Kind[]) {
    const shooters = d.defs.filter((df) => df.kind === kind).sort((a, b) => a.col - b.col || a.row - b.row);
    const range = kind === 'gun' ? 2 : 3;
    for (const s of shooters) {
      const dmg = kind === 'gun' ? (s.up ? 2 : 1) : s.up ? 5 : 3;
      let target: Enemy | null = null;
      for (const e of d.enemies) {
        if (Math.abs(s.col - e.col) + Math.abs(s.row - pr) > range) continue;
        if (
          !target ||
          e.col > target.col ||
          (e.col === target.col && !e.fly && target.fly)
        ) {
          target = e;
        }
      }
      if (target) {
        target.hp -= dmg;
        d.shots.push({
          id: `s${d.shots.length}`,
          x1: cellX(s.col) + CELL / 2,
          y1: cellY(s.row) + CELL / 2,
          x2: cellX(target.col) + CELL / 2,
          y2: cellY(pr) + CELL / 2,
        });
      }
    }
  }

  for (let i = d.enemies.length - 1; i >= 0; i--) {
    if (d.enemies[i].hp <= 0) d.enemies.splice(i, 1);
  }

  const order = d.enemies.slice().sort((a, b) => b.col - a.col || Number(a.fly) - Number(b.fly));
  const gone: string[] = [];
  for (const e of order) {
    const next = e.col + 1;
    if (next > COLS - 1) {
      d.base -= 1;
      gone.push(e.id);
      continue;
    }
    if (e.fly) {
      const blocked = d.enemies.some((o) => o.id !== e.id && o.fly && o.col === next && !gone.includes(o.id));
      if (!blocked) e.col = next;
    } else {
      const wall = d.defs.find((df) => df.kind === 'wall' && df.col === next && df.row === pr);
      if (wall) {
        wall.hp -= QUEUE[e.idx].atk;
        continue;
      }
      const blocked = d.enemies.some((o) => o.id !== e.id && !o.fly && o.col === next && !gone.includes(o.id));
      if (!blocked) e.col = next;
    }
  }
  for (let i = d.enemies.length - 1; i >= 0; i--) {
    if (gone.includes(d.enemies[i].id)) d.enemies.splice(i, 1);
  }

  for (let i = d.defs.length - 1; i >= 0; i--) {
    if (d.defs[i].kind === 'wall' && d.defs[i].hp <= 0) {
      if (d.selected === d.defs[i].id) d.selected = '';
      d.defs.splice(i, 1);
    }
  }

  if (d.nextSpawn < QUEUE.length) {
    const q = QUEUE[d.nextSpawn];
    let ok: boolean;
    if (q.fly) {
      ok = !d.enemies.some((e) => e.fly && e.col === 0);
    } else {
      ok = !d.defs.some((df) => df.kind === 'wall' && df.col === 0 && df.row === pr) && !d.enemies.some((e) => !e.fly && e.col === 0);
    }
    if (ok) {
      d.enemies.push({ id: `e${d.nextSpawn}`, idx: d.nextSpawn, name: q.name, col: 0, hp: q.hp, fly: q.fly });
      d.nextSpawn += 1;
    }
  }

  if (d.base <= 0) {
    d.base = 0;
    d.phase = 'lost';
    d.msg = 'Tower lost';
  } else if (d.nextSpawn >= QUEUE.length && d.enemies.length === 0) {
    d.phase = 'clear';
    d.msg = 'Tower clear';
    if (d.mapId === 0) d.open = 2;
  }
}

export function startGame(d: GameState): void {
  if (d.screen === 'board' && d.phase === 'ready') {
    d.phase = 'playing';
    d.playOrigin = d.playMs;
    d.kOffset = d.kSeen;
  }
}

export function tryUpgrade(d: GameState): void {
  const sel = d.defs.find((df) => df.id === d.selected);
  if (!sel || sel.up || dpOf(d) < UPGRADE_COST) {
    d.msg = 'Rejected';
    return;
  }
  d.dpSpent += UPGRADE_COST;
  sel.up = true;
  if (sel.kind === 'wall') sel.hp += WALL_UP_HP;
  d.msg = '';
}

export function handleDrop(d: GameState, card: string, x: number, y: number): void {
  if (d.screen !== 'board' || d.phase !== 'playing') return;
  const cell = cellAt(x, y);
  if (!cell) return;
  const def = CARDS.find((c) => c.kind === card);
  if (!def) return;
  const pr = MAPS[d.mapId].pathRow;
  let legal = dpOf(d) >= def.cost && !defAt(d, cell.col, cell.row);
  if (legal) {
    if (def.kind === 'wall') {
      legal = cell.row === pr && !d.enemies.some((e) => !e.fly && e.col === cell.col);
    } else {
      legal = isDeploy(d.mapId, cell.col, cell.row);
    }
  }
  if (!legal) {
    d.msg = 'Rejected';
    return;
  }
  d.defs.push({
    id: `d${d.nextDefId}`,
    kind: def.kind,
    col: cell.col,
    row: cell.row,
    up: false,
    hp: def.kind === 'wall' ? WALL_HP : 0,
  });
  d.nextDefId += 1;
  d.dpSpent += def.cost;
  d.msg = '';
}

export function handleClick(d: GameState, x: number, y: number): void {
  if (d.screen === 'select') {
    if (inRect(R_STRAIGHT, x, y)) {
      resetMap(d, 0);
    } else if (inRect(R_BEND, x, y)) {
      if (d.open >= 2) resetMap(d, 1);
      else d.msg = 'Rejected';
    } else if (inRect(R_SAVE, x, y)) {
      d.save = d.open;
      d.msg = 'Saved';
    } else if (inRect(R_WIPE, x, y)) {
      d.open = 1;
      d.msg = 'Wiped';
    } else if (inRect(R_LOAD, x, y)) {
      d.open = d.save;
      d.msg = 'Loaded';
    }
    return;
  }
  const ended = d.phase === 'lost' || d.phase === 'clear';
  if (inRect(R_START, x, y)) {
    startGame(d);
  } else if (inRect(R_STEP, x, y)) {
    if (d.phase === 'playing') doStep(d);
  } else if (inRect(R_RETRY, x, y)) {
    if (ended) resetMap(d, d.mapId);
  } else if (inRect(R_MAPS, x, y)) {
    if (ended) {
      d.screen = 'select';
      d.msg = '';
      d.phase = 'ready';
    }
  } else if (inRect(R_UPGRADE, x, y)) {
    if (!ended) tryUpgrade(d);
  } else if (d.phase === 'playing') {
    const cell = cellAt(x, y);
    if (cell) {
      const def = defAt(d, cell.col, cell.row);
      if (def) d.selected = def.id;
    }
  }
}

export const KEEP_ON_UNDO = new Set(['dragCard', 'dragX', 'dragY', 'animMs', 'frameNo', 'playMs', 'kSeen', 'gain', 'inputFrame', 'undo']);

export function restoreSnapshot(d: GameState, json: string): void {
  const snap = JSON.parse(json) as Record<string, unknown>;
  const target = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(snap)) {
    if (KEEP_ON_UNDO.has(k)) continue;
    const v = snap[k];
    if (Array.isArray(v)) {
      const arr = target[k] as unknown[];
      arr.splice(0, arr.length, ...v);
    } else {
      target[k] = v;
    }
  }
}

export function keyInput(d: GameState, code: string): void {
  if (d.inputFrame === d.frameNo) {
    if (d.undo === '') return;
    restoreSnapshot(d, d.undo);
  }
  d.inputFrame = d.frameNo;
  d.undo = '';
  if (d.screen !== 'board') return;
  if (code === 'Enter') startGame(d);
  else if (code === 'Space' && d.phase === 'playing') doStep(d);
}

export function pointerInput(d: GameState, kind: 'click' | 'drop', x: number, y: number, card: string): void {
  if (d.inputFrame === d.frameNo) return;
  d.undo = JSON.stringify({ ...d, undo: '' });
  d.inputFrame = d.frameNo;
  if (kind === 'click') handleClick(d, x, y);
  else handleDrop(d, card, x, y);
}

export function tick(d: GameState, ms: number): void {
  d.frameNo += 1;
  d.animMs += ms;
  if (d.screen === 'board' && d.phase === 'playing') {
    d.playMs += ms;
    const seconds = Math.floor((d.playMs - d.playOrigin + 1) / 1000);
    while (d.kSeen - d.kOffset < seconds) {
      d.kSeen += 1;
      if (dpOf(d) < DP_CAP) d.gain += 1;
    }
  }
}

export function pointerDown(d: GameState, x: number, y: number): void {
  if (d.screen !== 'board' || d.phase !== 'playing') return;
  const card = CARDS.find((c) => inRect(c.rect, x, y));
  if (card) {
    d.dragCard = card.kind;
    d.dragX = x;
    d.dragY = y;
  }
}

export function pointerMove(d: GameState, x: number, y: number): void {
  if (d.dragCard === '') return;
  d.dragX = x;
  d.dragY = y;
}

export function pointerUp(d: GameState, x: number, y: number): void {
  if (d.dragCard !== '') {
    const card = d.dragCard;
    d.dragCard = '';
    pointerInput(d, 'drop', x, y, card);
  } else {
    pointerInput(d, 'click', x, y, '');
  }
}
