export const COLS = 8;
export const ROWS = 6;
export const MAX_TURN = 8;
export const DEPOT = { col: 3, row: 0 };

export type Side = 'f' | 'e';
export type Phase = 'title' | 'play' | 'clear' | 'lost';

export type UnitCore = {
  name: string;
  side: Side;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  move: number;
  range: number;
  atk: number;
  heal: number;
  acted: boolean;
  alive: boolean;
};

export type Core = {
  phase: Phase;
  mapIdx: number;
  turn: number;
  units: UnitCore[];
  selected: string;
  rejected: boolean;
};

export type MapDef = {
  name: string;
  obstacles: [number, number][];
  starts: Record<string, [number, number]>;
};

export const MAPS: MapDef[] = [
  {
    name: 'Yard',
    obstacles: [],
    starts: {
      melee: [1, 4],
      ranged: [3, 4],
      support: [5, 4],
      brute: [1, 2],
      shot: [3, 2],
      lurker: [6, 2],
    },
  },
  {
    name: 'Ridge',
    obstacles: [
      [2, 3],
      [4, 3],
      [5, 1],
    ],
    starts: {
      melee: [1, 5],
      ranged: [3, 5],
      support: [6, 5],
      brute: [0, 1],
      shot: [5, 2],
      lurker: [7, 4],
    },
  },
];

export const UNIT_ORDER = ['melee', 'ranged', 'support', 'brute', 'shot', 'lurker'] as const;

const STATS: Record<string, { side: Side; hp: number; move: number; range: number; atk: number; heal: number }> = {
  melee: { side: 'f', hp: 20, move: 2, range: 1, atk: 3, heal: 0 },
  ranged: { side: 'f', hp: 16, move: 2, range: 3, atk: 3, heal: 0 },
  support: { side: 'f', hp: 16, move: 3, range: 0, atk: 0, heal: 2 },
  brute: { side: 'e', hp: 3, move: 1, range: 1, atk: 1, heal: 0 },
  shot: { side: 'e', hp: 3, move: 1, range: 3, atk: 1, heal: 0 },
  lurker: { side: 'e', hp: 3, move: 2, range: 1, atk: 1, heal: 0 },
};

export function makeUnits(mapIdx: number): UnitCore[] {
  const map = MAPS[mapIdx];
  return UNIT_ORDER.map((name) => {
    const s = STATS[name];
    const [col, row] = map.starts[name];
    return {
      name,
      side: s.side,
      col,
      row,
      hp: s.hp,
      maxHp: s.hp,
      move: s.move,
      range: s.range,
      atk: s.atk,
      heal: s.heal,
      acted: false,
      alive: true,
    };
  });
}

export function initialCore(mapIdx: number): Core {
  return { phase: 'title', mapIdx, turn: 0, units: makeUnits(mapIdx), selected: '', rejected: false };
}

export type VisEv =
  | { k: 'move'; ph: Side; name: string; from: [number, number]; path: [number, number][] }
  | {
      k: 'attack';
      ph: Side;
      name: string;
      target: string;
      from: [number, number];
      to: [number, number];
      range: number;
      dmg: number;
      killed: boolean;
    }
  | { k: 'heal'; ph: Side; name: string; target: string; from: [number, number]; to: [number, number]; amount: number };

export function isObstacle(core: Core, col: number, row: number): boolean {
  return MAPS[core.mapIdx].obstacles.some(([c, r]) => c === col && r === row);
}

export function inBoard(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

export function unitAt(core: Core, col: number, row: number): UnitCore | undefined {
  return core.units.find((u) => u.alive && u.col === col && u.row === row);
}

function isFree(core: Core, col: number, row: number): boolean {
  return inBoard(col, row) && !isObstacle(core, col, row) && !unitAt(core, col, row);
}

const DIRS: [number, number][] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

export function reachable(core: Core, u: UnitCore): [number, number][] {
  const seen = new Set<string>([`${u.col},${u.row}`]);
  const out: [number, number][] = [];
  let frontier: [number, number][] = [[u.col, u.row]];
  for (let step = 0; step < u.move; step++) {
    const next: [number, number][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        const key = `${nc},${nr}`;
        if (seen.has(key) || !isFree(core, nc, nr)) continue;
        seen.add(key);
        next.push([nc, nr]);
        out.push([nc, nr]);
      }
    }
    frontier = next;
  }
  return out;
}

function pathTo(core: Core, u: UnitCore, tc: number, tr: number): [number, number][] {
  const prev = new Map<string, string>();
  const start = `${u.col},${u.row}`;
  const seen = new Set<string>([start]);
  let frontier: [number, number][] = [[u.col, u.row]];
  for (let step = 0; step < u.move; step++) {
    const next: [number, number][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of DIRS) {
        const nc = c + dc;
        const nr = r + dr;
        const key = `${nc},${nr}`;
        if (seen.has(key) || !isFree(core, nc, nr)) continue;
        seen.add(key);
        prev.set(key, `${c},${r}`);
        next.push([nc, nr]);
      }
    }
    frontier = next;
  }
  const path: [number, number][] = [];
  let cur = `${tc},${tr}`;
  while (cur !== start) {
    const [c, r] = cur.split(',').map(Number);
    path.unshift([c, r]);
    cur = prev.get(cur) as string;
  }
  return path;
}

export function canAttack(core: Core, a: UnitCore, t: UnitCore): boolean {
  if (a.atk <= 0 || !a.alive || !t.alive) return false;
  const sameRow = a.row === t.row;
  const sameCol = a.col === t.col;
  if (sameRow === sameCol) return false;
  const dist = Math.abs(a.col - t.col) + Math.abs(a.row - t.row);
  if (dist < 1 || dist > a.range) return false;
  const dc = Math.sign(t.col - a.col);
  const dr = Math.sign(t.row - a.row);
  let c = a.col + dc;
  let r = a.row + dr;
  while (c !== t.col || r !== t.row) {
    if (isObstacle(core, c, r) || unitAt(core, c, r)) return false;
    c += dc;
    r += dr;
  }
  return true;
}

export function canHeal(a: UnitCore, t: UnitCore): boolean {
  if (a.heal <= 0 || !a.alive || !t.alive || a === t || t.side !== 'f') return false;
  return Math.abs(a.col - t.col) + Math.abs(a.row - t.row) === 1;
}

function alive(core: Core, side: Side): UnitCore[] {
  return core.units.filter((u) => u.alive && u.side === side);
}

function applyDamage(t: UnitCore, dmg: number): boolean {
  t.hp = Math.max(0, t.hp - dmg);
  if (t.hp <= 0) {
    t.alive = false;
    return true;
  }
  return false;
}

export function startGame(core: Core): void {
  core.phase = 'play';
  core.turn = 1;
  core.selected = '';
  core.rejected = false;
  for (const u of core.units) u.acted = false;
}

export function resetMap(core: Core, mapIdx: number): void {
  core.phase = 'title';
  core.mapIdx = mapIdx;
  core.turn = 0;
  core.units = makeUnits(mapIdx);
  core.selected = '';
  core.rejected = false;
}

function checkClear(core: Core): boolean {
  const onDepot = core.units.some((u) => u.alive && u.side === 'f' && u.col === DEPOT.col && u.row === DEPOT.row);
  if (onDepot || alive(core, 'e').length === 0) {
    core.phase = 'clear';
    core.selected = '';
    return true;
  }
  return false;
}

function afterFriendlyAction(core: Core, ev: VisEv[]): void {
  core.selected = '';
  core.rejected = false;
  if (checkClear(core)) return;
  if (alive(core, 'f').every((u) => u.acted)) endTurn(core, ev);
}

export function endTurn(core: Core, ev: VisEv[]): void {
  core.rejected = false;
  core.selected = '';
  for (const u of core.units) if (u.side === 'f') u.acted = true;
  enemyPhase(core, ev);
  if (core.phase !== 'play') return;
  if (core.turn >= MAX_TURN) {
    core.phase = 'lost';
    return;
  }
  core.turn += 1;
  for (const u of core.units) u.acted = false;
}

const FRIEND_PRIORITY: Record<string, string[]> = {
  brute: ['melee', 'ranged', 'support'],
  shot: ['melee', 'ranged', 'support'],
  lurker: ['support', 'ranged', 'melee'],
};

function manhattan(a: { col: number; row: number }, c: number, r: number): number {
  return Math.abs(a.col - c) + Math.abs(a.row - r);
}

function pickMoveTarget(core: Core, e: UnitCore): UnitCore | undefined {
  const order = FRIEND_PRIORITY[e.name];
  const friends = order.map((n) => core.units.find((u) => u.name === n && u.alive)).filter((u): u is UnitCore => !!u);
  if (friends.length === 0) return undefined;
  if (e.name === 'lurker') {
    const support = friends.find((u) => u.name === 'support');
    if (support) return support;
  }
  let best = friends[0];
  let bestD = manhattan(e, best.col, best.row);
  for (const f of friends.slice(1)) {
    const d = manhattan(e, f.col, f.row);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

function enemyAct(core: Core, e: UnitCore, ev: VisEv[]): void {
  let moved: [number, number][] = [];
  let startPos: [number, number] = [e.col, e.row];
  const flush = () => {
    if (moved.length) ev.push({ k: 'move', ph: 'e', name: e.name, from: startPos, path: moved });
    moved = [];
  };
  for (let seg = 0; seg < e.move; seg++) {
    if (core.phase !== 'play') break;
    const order = FRIEND_PRIORITY[e.name];
    let victim: UnitCore | undefined;
    for (const n of order) {
      const f = core.units.find((u) => u.name === n && u.alive);
      if (f && canAttack(core, e, f)) {
        victim = f;
        break;
      }
    }
    if (victim) {
      flush();
      const killed = applyDamage(victim, e.atk);
      ev.push({
        k: 'attack',
        ph: 'e',
        name: e.name,
        target: victim.name,
        from: [e.col, e.row],
        to: [victim.col, victim.row],
        range: e.range,
        dmg: e.atk,
        killed,
      });
      if (alive(core, 'f').length === 0) core.phase = 'lost';
      return;
    }
    const target = pickMoveTarget(core, e);
    if (!target) break;
    const cur = manhattan(e, target.col, target.row);
    let best: [number, number] | undefined;
    let bestD = Infinity;
    for (const [dc, dr] of DIRS) {
      const nc = e.col + dc;
      const nr = e.row + dr;
      if (!isFree(core, nc, nr)) continue;
      const d = Math.abs(nc - target.col) + Math.abs(nr - target.row);
      if (
        d < bestD ||
        (d === bestD && best && (nr < best[1] || (nr === best[1] && nc < best[0])))
      ) {
        best = [nc, nr];
        bestD = d;
      }
    }
    if (!best || bestD >= cur) break;
    e.col = best[0];
    e.row = best[1];
    moved.push([best[0], best[1]]);
  }
  flush();
}

function enemyPhase(core: Core, ev: VisEv[]): void {
  for (const name of ['brute', 'shot', 'lurker']) {
    const e = core.units.find((u) => u.name === name);
    if (!e || !e.alive) continue;
    enemyAct(core, e, ev);
    if (core.phase !== 'play') return;
  }
}

export type Action =
  | { t: 'cell'; col: number; row: number }
  | { t: 'start' }
  | { t: 'end' }
  | { t: 'retry' }
  | { t: 'ridge' };

export function applyAction(core: Core, act: Action, ev: VisEv[]): void {
  if (act.t === 'start') {
    if (core.phase === 'title') startGame(core);
    return;
  }
  if (act.t === 'retry') {
    if (core.phase === 'clear' || core.phase === 'lost') resetMap(core, core.mapIdx);
    return;
  }
  if (act.t === 'ridge') {
    if (core.phase === 'clear' || core.phase === 'lost') resetMap(core, 1);
    return;
  }
  if (core.phase !== 'play') return;
  if (act.t === 'end') {
    endTurn(core, ev);
    return;
  }
  clickCell(core, act.col, act.row, ev);
}

function clickCell(core: Core, col: number, row: number, ev: VisEv[]): void {
  if (!inBoard(col, row)) return;
  const sel = core.selected ? core.units.find((u) => u.name === core.selected && u.alive) : undefined;
  const hit = unitAt(core, col, row);

  if (hit && hit.side === 'f') {
    if (sel && hit === sel) return;
    if (sel && canHeal(sel, hit)) {
      const before = hit.hp;
      hit.hp = Math.min(hit.maxHp, hit.hp + sel.heal);
      sel.acted = true;
      ev.push({
        k: 'heal',
        ph: 'f',
        name: sel.name,
        target: hit.name,
        from: [sel.col, sel.row],
        to: [hit.col, hit.row],
        amount: hit.hp - before,
      });
      afterFriendlyAction(core, ev);
      return;
    }
    if (!hit.acted) {
      core.selected = hit.name;
      return;
    }
    if (sel) core.rejected = true;
    return;
  }

  if (!sel) return;

  if (hit && hit.side === 'e') {
    if (canAttack(core, sel, hit)) {
      const killed = applyDamage(hit, sel.atk);
      sel.acted = true;
      ev.push({
        k: 'attack',
        ph: 'f',
        name: sel.name,
        target: hit.name,
        from: [sel.col, sel.row],
        to: [hit.col, hit.row],
        range: sel.range,
        dmg: sel.atk,
        killed,
      });
      afterFriendlyAction(core, ev);
    } else {
      core.rejected = true;
    }
    return;
  }

  if (!hit && reachable(core, sel).some(([c, r]) => c === col && r === row)) {
    const path = pathTo(core, sel, col, row);
    const from: [number, number] = [sel.col, sel.row];
    sel.col = col;
    sel.row = row;
    sel.acted = true;
    ev.push({ k: 'move', ph: 'f', name: sel.name, from, path });
    afterFriendlyAction(core, ev);
    return;
  }
  core.rejected = true;
}
