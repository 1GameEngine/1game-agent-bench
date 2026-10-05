import { For, Show } from 'solid-js';
import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
import floorPng from '../assets/floor.png';
import depotPng from '../assets/depot.png';
import rockPng from '../assets/rock.png';
import meleePng from '../assets/melee.png';
import rangedPng from '../assets/ranged.png';
import supportPng from '../assets/support.png';
import brutePng from '../assets/brute.png';
import shotPng from '../assets/shot.png';
import lurkerPng from '../assets/lurker.png';

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const COLS = 8;
const ROWS = 6;
const OX = 384;
const OY = 120;
const CELL = 64;
const DEPOT = { c: 3, r: 0 };
const LIMIT = 8;
const ALLY_RANK = { melee: 0, ranged: 1, support: 2 } as const;
const ANIM_MS = 220;

const START_BTN = { x: 440, y: 620, w: 400, h: 70 };
const END_BTN = { x: 60, y: 620, w: 240, h: 70 };
const RETRY_BTN = { x: 900, y: 620, w: 280, h: 70 };
const RIDGE_BTN = { x: 1020, y: 540, w: 220, h: 56 };

const UNIT_SPRITES: Record<string, string> = {
  melee: meleePng,
  ranged: rangedPng,
  support: supportPng,
  brute: brutePng,
  shot: shotPng,
  lurker: lurkerPng,
};

type Side = 'ally' | 'enemy';
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type MapId = 'yard' | 'ridge';

type Unit = {
  id: string;
  side: Side;
  c: number;
  r: number;
  dispC: number;
  dispR: number;
  hp: number;
  max: number;
  mv: number;
  rng: number;
  atk: number;
  heal: number;
  acted: boolean;
  flashMs: number;
};

type GameState = {
  phase: Phase;
  turn: number;
  selected: string | null;
  map: MapId;
  note: string;
  blocks: [number, number][];
  units: Unit[];
};

function opening(map: MapId): Unit[] {
  const base = (rows: Unit[]): Unit[] =>
    rows.map((u) => ({ ...u, dispC: u.c, dispR: u.r, flashMs: 0 }));
  if (map === 'ridge') {
    return base([
      { id: 'melee', side: 'ally', c: 1, r: 5, hp: 20, max: 20, mv: 2, rng: 1, atk: 3, heal: 0, acted: false },
      { id: 'ranged', side: 'ally', c: 3, r: 5, hp: 16, max: 16, mv: 2, rng: 3, atk: 3, heal: 0, acted: false },
      { id: 'support', side: 'ally', c: 6, r: 5, hp: 16, max: 16, mv: 3, rng: 0, atk: 0, heal: 2, acted: false },
      { id: 'brute', side: 'enemy', c: 0, r: 1, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
      { id: 'shot', side: 'enemy', c: 5, r: 2, hp: 3, max: 3, mv: 1, rng: 3, atk: 1, heal: 0, acted: false },
      { id: 'lurker', side: 'enemy', c: 7, r: 4, hp: 3, max: 3, mv: 2, rng: 1, atk: 1, heal: 0, acted: false },
    ]);
  }
  return base([
    { id: 'melee', side: 'ally', c: 1, r: 4, hp: 20, max: 20, mv: 2, rng: 1, atk: 3, heal: 0, acted: false },
    { id: 'ranged', side: 'ally', c: 3, r: 4, hp: 16, max: 16, mv: 2, rng: 3, atk: 3, heal: 0, acted: false },
    { id: 'support', side: 'ally', c: 5, r: 4, hp: 16, max: 16, mv: 3, rng: 0, atk: 0, heal: 2, acted: false },
    { id: 'brute', side: 'enemy', c: 1, r: 2, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
    { id: 'shot', side: 'enemy', c: 3, r: 2, hp: 3, max: 3, mv: 1, rng: 3, atk: 1, heal: 0, acted: false },
    { id: 'lurker', side: 'enemy', c: 6, r: 2, hp: 3, max: 3, mv: 2, rng: 1, atk: 1, heal: 0, acted: false },
  ]);
}

function blocksFor(map: MapId): [number, number][] {
  return map === 'ridge' ? [[2, 3], [4, 3], [5, 1]] : [];
}

function fresh(map: MapId = 'yard'): GameState {
  return {
    phase: 'ready',
    turn: 0,
    selected: null,
    map,
    note: '',
    blocks: blocksFor(map),
    units: opening(map),
  };
}

function living(s: GameState, side?: Side): Unit[] {
  return s.units.filter((u) => u.hp > 0 && (!side || u.side === side));
}

function blocked(s: GameState, c: number, r: number): boolean {
  return s.blocks.some(([bc, br]) => bc === c && br === r);
}

function at(s: GameState, c: number, r: number): Unit | null {
  return s.units.find((u) => u.hp > 0 && u.c === c && u.r === r) ?? null;
}

function occupied(s: GameState, c: number, r: number): boolean {
  return blocked(s, c, r) || at(s, c, r) != null;
}

function byId(s: GameState, id: string): Unit | undefined {
  return s.units.find((u) => u.id === id);
}

function los(s: GameState, u: Unit, c: number, r: number): number | null {
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

function reach(s: GameState, u: Unit): [number, number][] {
  const seen = new Set([`${u.c},${u.r}`]);
  let frontier: [number, number][] = [[u.c, u.r]];
  const out: [number, number][] = [];
  for (let step = 1; step <= u.mv; step += 1) {
    const next: [number, number][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
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

function settle(s: GameState): void {
  const allyOnDepot = living(s, 'ally').some((u) => u.c === DEPOT.c && u.r === DEPOT.r);
  if (allyOnDepot || living(s, 'enemy').length === 0) s.phase = 'clear';
  else if (living(s, 'ally').length === 0) s.phase = 'fail';
}

function attackRank(enemyId: string, allyId: string): number {
  if (enemyId === 'lurker') return { support: 0, ranged: 1, melee: 2 }[allyId] ?? 9;
  return ALLY_RANK[allyId as keyof typeof ALLY_RANK] ?? 9;
}

function moveUnit(u: Unit, c: number, r: number): void {
  u.c = c;
  u.r = r;
}

function enemyPhase(s: GameState): void {
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
        shots[0].flashMs = ANIM_MS;
        settle(s);
        break;
      }
      const support = e.id === 'lurker' ? targets.find((a) => a.id === 'support') : null;
      const goal =
        support ??
        targets.slice().sort((a, b) => {
          const da = Math.abs(a.c - e.c) + Math.abs(a.r - e.r);
          const db = Math.abs(b.c - e.c) + Math.abs(b.r - e.r);
          return da - db || attackRank(e.id, a.id) - attackRank(e.id, b.id);
        })[0];
      const cur = Math.abs(goal.c - e.c) + Math.abs(goal.r - e.r);
      const steps = [[0, -1], [-1, 0], [1, 0], [0, 1]]
        .map(([dc, dr]) => [e.c + dc, e.r + dr] as [number, number])
        .filter(([c, r]) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !occupied(s, c, r));
      steps.sort((a, b) => {
        const da = Math.abs(goal.c - a[0]) + Math.abs(goal.r - a[1]);
        const db = Math.abs(goal.c - b[0]) + Math.abs(goal.r - b[1]);
        return da - db || a[1] - b[1] || a[0] - b[0];
      });
      if (!steps.length || Math.abs(goal.c - steps[0][0]) + Math.abs(goal.r - steps[0][1]) >= cur) break;
      moveUnit(e, steps[0][0], steps[0][1]);
    }
  }
}

function endTurn(s: GameState): void {
  if (s.phase !== 'playing') return;
  s.note = '';
  enemyPhase(s);
  if (s.phase !== 'playing') return;
  if (s.turn >= LIMIT) s.phase = 'fail';
  else {
    s.turn += 1;
    s.selected = null;
    for (const u of living(s, 'ally')) u.acted = false;
  }
}

function maybeAuto(s: GameState): void {
  if (s.phase === 'playing' && living(s, 'ally').every((u) => u.acted)) endTurn(s);
}

function begin(s: GameState): void {
  if (s.phase !== 'ready') return;
  s.phase = 'playing';
  s.turn = 1;
  s.note = '';
}

function resetMap(s: GameState, map: MapId): void {
  const next = fresh(map);
  s.phase = next.phase;
  s.turn = next.turn;
  s.selected = next.selected;
  s.map = next.map;
  s.note = next.note;
  s.blocks = next.blocks;
  s.units = next.units;
}

function cellOf(x: number, y: number): { c: number; r: number } | null {
  if (x < OX || y < OY || x >= OX + COLS * CELL || y >= OY + ROWS * CELL) return null;
  const c = Math.floor((x - OX) / CELL);
  const r = Math.floor((y - OY) / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return { c, r };
}

function inRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function clickBoard(s: GameState, x: number, y: number): void {
  if (s.phase === 'clear' || s.phase === 'fail') {
    if (inRect(x, y, RETRY_BTN)) resetMap(s, s.map);
    else if (inRect(x, y, RIDGE_BTN)) resetMap(s, 'ridge');
    return;
  }
  if (inRect(x, y, START_BTN)) {
    begin(s);
    return;
  }
  if (s.phase !== 'playing') return;
  if (inRect(x, y, END_BTN)) {
    endTurn(s);
    return;
  }
  const cell = cellOf(x, y);
  if (!cell) return;
  const hit = at(s, cell.c, cell.r);
  const sel = s.selected ? byId(s, s.selected) : null;
  const canHeal =
    sel &&
    sel.hp > 0 &&
    !sel.acted &&
    sel.heal > 0 &&
    hit &&
    hit.side === 'ally' &&
    hit.id !== sel.id &&
    Math.abs(hit.c - sel.c) + Math.abs(hit.r - sel.r) === 1;
  if (canHeal) {
    hit.hp = Math.min(hit.max, hit.hp + sel.heal);
    sel.acted = true;
    s.selected = null;
    s.note = '';
    hit.flashMs = ANIM_MS;
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
      hit.flashMs = ANIM_MS;
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
    moveUnit(sel, cell.c, cell.r);
    sel.acted = true;
    s.selected = null;
    s.note = '';
    settle(s);
    maybeAuto(s);
  }
}

function handleKey(s: GameState, code: string, down: boolean): void {
  if (!down) return;
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (code === 'Enter') begin(s);
  else if (code === 'Space' && s.phase === 'playing') endTurn(s);
}

function mapLabel(map: MapId): string {
  return map === 'ridge' ? 'Ridge' : 'Yard';
}

function unitStatusLine(s: GameState): string {
  const order = ['melee', 'ranged', 'support', 'brute', 'shot', 'lurker'];
  return order
    .map((id) => {
      const u = byId(s, id);
      const hp = u ? u.hp : 0;
      return `${id} ${hp}`;
    })
    .join('  ');
}

function reachableSet(s: GameState): Set<string> {
  const sel = s.selected ? byId(s, s.selected) : null;
  if (!sel || sel.acted || sel.hp <= 0 || s.phase !== 'playing') return new Set();
  return new Set(reach(s, sel).map(([c, r]) => `${c},${r}`));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const BOARD_CELLS = Array.from({ length: COLS * ROWS }, (_, i) => ({
  c: i % COLS,
  r: Math.floor(i / COLS),
  key: `${i % COLS},${Math.floor(i / COLS)}`,
}));

const { store, commitChange, bindStore } = createGameStore(fresh());

function Game() {
  useFrame((frame) => {
    const dtMs = frame.deltaSeconds * 1000;
    if (dtMs <= 0) return;
    const needsAnim = store.units.some(
      (u) =>
        u.flashMs > 0 || Math.abs(u.dispC - u.c) > 0.02 || Math.abs(u.dispR - u.r) > 0.02,
    );
    if (!needsAnim) return;
    commitChange('动画', (draft) => {
      for (const u of draft.units) {
        if (u.flashMs > 0) u.flashMs = Math.max(0, u.flashMs - dtMs);
        const t = Math.min(1, dtMs / ANIM_MS);
        if (Math.abs(u.dispC - u.c) > 0.001 || Math.abs(u.dispR - u.r) > 0.001) {
          u.dispC = lerp(u.dispC, u.c, t * 2.5);
          u.dispR = lerp(u.dispR, u.r, t * 2.5);
          if (Math.abs(u.dispC - u.c) < 0.02 && Math.abs(u.dispR - u.r) < 0.02) {
            u.dispC = u.c;
            u.dispR = u.r;
          }
        }
      }
    });
  });

  const reach = reachableSet(store);
  const outcome =
    store.phase === 'clear' ? 'Depot clear' : store.phase === 'fail' ? 'Depot lost' : '';
  const ended = store.phase === 'clear' || store.phase === 'fail';

  return (
    <scene
      name="main"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      backgroundColor="#1a1f2e"
      onKeyDown={(event) => {
        const code = event.detail?.code ?? '';
        commitChange(`按键:${code}`, (draft) => handleKey(draft, code, true));
      }}
      onClick={(event) => {
        commitChange('点击', (draft) => clickBoard(draft, event.x, event.y));
      }}
    >
      <text
        x={0}
        y={24}
        width={SCENE_WIDTH}
        height={36}
        text="Depot Skirmish"
        textAlign="center"
        textColor="#f8fafc"
        textSize="32"
      />
      <text
        x={40}
        y={72}
        width={600}
        height={24}
        text={`${mapLabel(store.map)}   turn ${store.turn} / 8`}
        textColor="#cbd5e1"
        textSize="20"
      />
      <text x={40} y={96} width={1200} height={22} text={unitStatusLine(store)} textColor="#94a3b8" textSize="16" />

      <For each={BOARD_CELLS}>
        {(cell) => {
          const isDepot = cell.c === DEPOT.c && cell.r === DEPOT.r;
          const isRock = store.blocks.some(([bc, br]) => bc === cell.c && br === cell.r);
          const highlight = reach.has(cell.key);
          return (
            <>
              <image
                key={`floor-${cell.key}`}
                source={isDepot ? depotPng : floorPng}
                x={OX + cell.c * CELL}
                y={OY + cell.r * CELL}
                width={CELL}
                height={CELL}
                imageFit="cover"
              />
              <Show when={isRock}>
                <image
                  key={`rock-${cell.key}`}
                  source={rockPng}
                  x={OX + cell.c * CELL}
                  y={OY + cell.r * CELL}
                  width={CELL}
                  height={CELL}
                  imageFit="cover"
                />
              </Show>
              <Show when={highlight}>
                <node
                  key={`hi-${cell.key}`}
                  x={OX + cell.c * CELL}
                  y={OY + cell.r * CELL}
                  width={CELL}
                  height={CELL}
                  backgroundColor="#22d3ee55"
                />
              </Show>
            </>
          );
        }}
      </For>

      <For each={store.units}>
        {(unit) => (
          <Show when={unit.hp > 0}>
            <group
              key={unit.id}
              x={OX + unit.dispC * CELL + 4}
              y={OY + unit.dispR * CELL + 4}
              width={CELL - 8}
              height={CELL - 8}
            >
              <image
                source={UNIT_SPRITES[unit.id]}
                x={0}
                y={0}
                width={CELL - 8}
                height={CELL - 8}
                imageFit="contain"
                opacity={unit.side === 'ally' && unit.acted ? 0.55 : 1}
              />
              <Show when={unit.flashMs > 0}>
                <node x={0} y={0} width={CELL - 8} height={CELL - 8} backgroundColor="#ffffff44" />
              </Show>
              <Show when={store.selected === unit.id}>
                <node
                  x={0}
                  y={0}
                  width={CELL - 8}
                  height={CELL - 8}
                  border="solid"
                  borderWidth={3}
                  borderColor="#facc15"
                />
              </Show>
              <text
                x={0}
                y={CELL - 22}
                width={CELL - 8}
                height={16}
                text={`${unit.hp}`}
                textAlign="center"
                textColor="#fef08a"
                textSize="14"
              />
            </group>
          </Show>
        )}
      </For>

      <Show when={store.note}>
        <text x={480} y={540} width={320} height={28} text={store.note} textAlign="center" textColor="#f87171" textSize="22" />
      </Show>
      <Show when={outcome}>
        <text x={420} y={560} width={440} height={40} text={outcome} textAlign="center" textColor="#4ade80" textSize="28" />
      </Show>

      <group x={START_BTN.x} y={START_BTN.y} width={START_BTN.w} height={START_BTN.h} clickable={!ended}>
        <node x={0} y={0} width={START_BTN.w} height={START_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#2563eb" />
        <text x={0} y={22} width={START_BTN.w} height={28} text="Start" textAlign="center" textColor="#fff" textSize="24" />
      </group>

      <group x={END_BTN.x} y={END_BTN.y} width={END_BTN.w} height={END_BTN.h} clickable={store.phase === 'playing'}>
        <node x={0} y={0} width={END_BTN.w} height={END_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#334155" />
        <text x={0} y={22} width={END_BTN.w} height={28} text="End" textAlign="center" textColor="#fff" textSize="24" />
      </group>

      <Show when={ended}>
        <group x={RETRY_BTN.x} y={RETRY_BTN.y} width={RETRY_BTN.w} height={RETRY_BTN.h} clickable>
          <node x={0} y={0} width={RETRY_BTN.w} height={RETRY_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#475569" />
          <text x={0} y={22} width={RETRY_BTN.w} height={28} text="Retry" textAlign="center" textColor="#fff" textSize="24" />
        </group>
        <group x={RIDGE_BTN.x} y={RIDGE_BTN.y} width={RIDGE_BTN.w} height={RIDGE_BTN.h} clickable>
          <node x={0} y={0} width={RIDGE_BTN.w} height={RIDGE_BTN.h} shape="roundedRect(10 10 10 10)" backgroundColor="#0f766e" />
          <text x={0} y={16} width={RIDGE_BTN.w} height={24} text="Ridge" textAlign="center" textColor="#fff" textSize="20" />
        </group>
      </Show>
    </scene>
  );
}

renderGame(() => <Game />, { bindStore });
