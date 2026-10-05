import { For, Show } from 'solid-js';
import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
import pathPng from '../assets/path.png';
import grassPng from '../assets/grass.png';
import basePng from '../assets/base.png';
import wallPng from '../assets/wall.png';
import gunPng from '../assets/gun.png';
import cannonPng from '../assets/cannon.png';
import scoutPng from '../assets/scout.png';
import brutePng from '../assets/brute.png';
import flyerPng from '../assets/flyer.png';

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const COLS = 8;
const ROWS = 5;
const OX = 352;
const OY = 148;
const CELL = 72;

const COSTS = { gun: 2, wall: 2, cannon: 4 } as const;
const RANGE = { gun: 2, cannon: 3 } as const;

const START_BTN = { x: 440, y: 620, w: 400, h: 70 };
const STEP_BTN = { x: 60, y: 620, w: 240, h: 70 };
const RETRY_BTN = { x: 900, y: 620, w: 280, h: 70 };
const UPGRADE_BTN = { x: 1020, y: 160, w: 220, h: 56 };
const MAPS_BTN = { x: 1020, y: 400, w: 220, h: 56 };

const STRAIGHT_CARD = { x: 80, y: 160, w: 520, h: 180 };
const BEND_CARD = { x: 640, y: 160, w: 520, h: 180 };
const SAVE_BTN = { x: 80, y: 420, w: 200, h: 56 };
const WIPE_BTN = { x: 300, y: 420, w: 200, h: 56 };
const LOAD_BTN = { x: 520, y: 420, w: 200, h: 56 };

const CARD_RECTS = {
  gun: { x: 48, y: 160, w: 260, h: 56 },
  wall: { x: 48, y: 228, w: 260, h: 56 },
  cannon: { x: 48, y: 296, w: 260, h: 56 },
} as const;

const QUEUE_TEMPLATE = [
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1 },
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1 },
  { kind: 'flyer', hp: 3, atk: 0, fly: true, wave: 2 },
  { kind: 'brute', hp: 6, atk: 2, fly: false, wave: 3 },
  { kind: 'scout', hp: 2, atk: 1, fly: false, wave: 3 },
] as const;

const ENEMY_SPRITES: Record<string, string> = {
  scout: scoutPng,
  brute: brutePng,
  flyer: flyerPng,
};

const TOWER_SPRITES: Record<string, string> = {
  gun: gunPng,
  wall: wallPng,
  cannon: cannonPng,
};

type Screen = 'select' | 'battle';
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type MapId = 'straight' | 'bend' | '';
type TowerKind = 'gun' | 'wall' | 'cannon';

type QueueEntry = {
  id: number;
  kind: string;
  hp: number;
  atk: number;
  fly: boolean;
  wave: number;
};

type Tower = {
  id: string;
  kind: TowerKind;
  c: number;
  r: number;
  hp: number;
  upgraded: boolean;
};

type Enemy = {
  id: number;
  kind: string;
  hp: number;
  atk: number;
  fly: boolean;
  wave: number;
  c: number;
  r: number;
};

type Shot = {
  fc: number;
  fr: number;
  tc: number;
  tr: number;
};

type GameState = {
  screen: Screen;
  map: MapId;
  open: number;
  slot: number;
  phase: Phase;
  wave: number;
  dp: number;
  base: number;
  picked: { c: number; r: number } | null;
  note: string;
  shots: Shot[];
  towers: Tower[];
  enemies: Enemy[];
  queue: QueueEntry[];
  drag: { kind: TowerKind; x: number; y: number } | null;
  anim: number;
  clock: number;
  nextEnemyId: number;
  nextTowerId: number;
};

function openingQueue(): QueueEntry[] {
  return QUEUE_TEMPLATE.map((e, i) => ({ ...e, id: i }));
}

function fresh(): GameState {
  return {
    screen: 'select',
    map: '',
    open: 1,
    slot: 1,
    phase: 'ready',
    wave: 0,
    dp: 6,
    base: 4,
    picked: null,
    note: '',
    shots: [],
    towers: [],
    enemies: [],
    queue: openingQueue(),
    drag: null,
    anim: 0,
    clock: 0,
    nextEnemyId: 0,
    nextTowerId: 0,
  };
}

function dmgOf(t: Tower): number {
  if (t.kind === 'gun') return t.upgraded ? 2 : 1;
  if (t.kind === 'cannon') return t.upgraded ? 5 : 3;
  return 0;
}

function reject(s: GameState): void {
  s.note = 'Rejected';
}

function clearNote(s: GameState): void {
  if (s.note === 'Rejected') s.note = '';
}

function pathRow(s: GameState): number {
  return s.map === 'bend' ? 4 : 2;
}

function deployCell(s: GameState, c: number, r: number): boolean {
  const rows = s.map === 'bend' ? [2] : [1, 3];
  return rows.includes(r) && c >= 1 && c <= 6;
}

function onPath(s: GameState, c: number, r: number): boolean {
  return r === pathRow(s) && c >= 0 && c < COLS;
}

function towerAt(s: GameState, c: number, r: number): Tower | null {
  return s.towers.find((t) => t.c === c && t.r === r) ?? null;
}

function enemyOn(s: GameState, c: number, r: number, fly: boolean): Enemy | null {
  return s.enemies.find((e) => e.c === c && e.r === r && e.fly === fly) ?? null;
}

function groundOn(s: GameState, c: number, r: number): Enemy | null {
  return s.enemies.find((e) => e.c === c && e.r === r && !e.fly) ?? null;
}

function waveOf(s: GameState): number {
  const ws = [...s.queue.map((e) => e.wave), ...s.enemies.map((e) => e.wave)];
  if (!ws.length) return s.phase === 'ready' ? 0 : 3;
  return Math.min(...ws);
}

function resetBattle(s: GameState): void {
  s.phase = 'ready';
  s.wave = 0;
  s.dp = 6;
  s.base = 4;
  s.picked = null;
  s.note = '';
  s.shots = [];
  s.towers = [];
  s.enemies = [];
  s.queue = openingQueue();
  s.drag = null;
  s.clock = 0;
  s.nextEnemyId = 0;
  s.nextTowerId = 0;
}

function enterMap(s: GameState, map: MapId): void {
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

function begin(s: GameState): void {
  if (s.screen !== 'battle' || s.phase !== 'ready') return;
  s.phase = 'playing';
  s.wave = 1;
}

function placeTower(s: GameState, c: number, r: number, kind: TowerKind): void {
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
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
    const id = `t${s.nextTowerId++}`;
    s.towers.push({ id, kind, c, r, hp: 6, upgraded: false });
  } else {
    if (!deployCell(s, c, r) || towerAt(s, c, r)) {
      reject(s);
      return;
    }
    const id = `t${s.nextTowerId++}`;
    s.towers.push({ id, kind, c, r, hp: 1, upgraded: false });
  }
  s.dp -= cost;
  s.picked = null;
  clearNote(s);
}

function upgradeTower(s: GameState): void {
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

function retryBattle(s: GameState): void {
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

function goMaps(s: GameState): void {
  if (s.screen !== 'battle') return;
  if (s.phase !== 'clear' && s.phase !== 'fail') return;
  s.screen = 'select';
  s.drag = null;
  s.note = '';
  s.shots = [];
  s.phase = 'ready';
}

function saveGame(s: GameState): void {
  if (s.screen !== 'select') return;
  s.slot = s.open;
  s.note = 'Saved';
}

function wipeOpen(s: GameState): void {
  if (s.screen !== 'select') return;
  s.open = 1;
  s.note = 'Wiped';
}

function loadGame(s: GameState): void {
  if (s.screen !== 'select') return;
  s.open = s.slot;
  s.note = 'Loaded';
}

function logicTick(s: GameState): void {
  s.anim += 1;
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  s.clock += 1;
  if (s.clock % 30 === 0) s.dp = Math.min(10, s.dp + 1);
}

function stepBattle(s: GameState): void {
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  clearNote(s);
  s.shots = [];
  const row = pathRow(s);
  const towers = s.towers
    .filter((t) => t.kind !== 'wall')
    .sort((a, b) => a.c - b.c || a.r - b.r);
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
  const order = [...s.enemies].sort(
    (a, b) => b.c - a.c || a.r - b.r || Number(a.fly) - Number(b.fly),
  );
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
    const blocked = next.fly
      ? enemyOn(s, 0, row, true)
      : groundOn(s, 0, row) || towerAt(s, 0, row);
    if (!blocked) {
      s.queue.shift();
      s.enemies.push({
        ...next,
        id: s.nextEnemyId++,
        c: 0,
        r: row,
      });
    }
  }
  if (s.base <= 0) s.phase = 'fail';
  else if (!s.queue.length && !s.enemies.length) {
    s.phase = 'clear';
    if (s.map === 'straight') s.open = Math.max(s.open, 2);
  }
  s.wave = waveOf(s);
}

function inRect(x: number, y: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function cardAt(x: number, y: number): TowerKind | '' {
  if (inRect(x, y, CARD_RECTS.gun)) return 'gun';
  if (inRect(x, y, CARD_RECTS.wall)) return 'wall';
  if (inRect(x, y, CARD_RECTS.cannon)) return 'cannon';
  return '';
}

function cellOf(x: number, y: number): { c: number; r: number } | null {
  if (x < OX || y < OY || x >= OX + COLS * CELL || y >= OY + ROWS * CELL) return null;
  const c = Math.floor((x - OX) / CELL);
  const r = Math.floor((y - OY) / CELL);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return { c, r };
}

function clickAt(s: GameState, x: number, y: number): void {
  if (s.screen === 'battle' && inRect(x, y, RETRY_BTN)) {
    retryBattle(s);
    return;
  }
  if (s.screen === 'battle' && inRect(x, y, MAPS_BTN)) {
    goMaps(s);
    return;
  }
  if (s.phase === 'clear' || s.phase === 'fail') return;
  if (s.screen === 'battle' && inRect(x, y, UPGRADE_BTN)) {
    upgradeTower(s);
    return;
  }
  if (s.screen === 'battle' && inRect(x, y, START_BTN)) {
    begin(s);
    return;
  }
  if (s.screen === 'battle' && inRect(x, y, STEP_BTN)) {
    stepBattle(s);
    return;
  }
  if (s.screen === 'select' && inRect(x, y, STRAIGHT_CARD)) {
    enterMap(s, 'straight');
    return;
  }
  if (s.screen === 'select' && inRect(x, y, BEND_CARD)) {
    enterMap(s, 'bend');
    return;
  }
  if (s.screen === 'select' && inRect(x, y, SAVE_BTN)) {
    saveGame(s);
    return;
  }
  if (s.screen === 'select' && inRect(x, y, WIPE_BTN)) {
    wipeOpen(s);
    return;
  }
  if (s.screen === 'select' && inRect(x, y, LOAD_BTN)) {
    loadGame(s);
    return;
  }
  if (s.screen === 'battle' && s.phase === 'playing') {
    const cell = cellOf(x, y);
    if (cell) {
      const tower = towerAt(s, cell.c, cell.r);
      if (tower) s.picked = { c: cell.c, r: cell.r };
    }
  }
}

function pointerDown(s: GameState, x: number, y: number): void {
  if (s.screen === 'battle' && s.phase === 'playing') {
    const kind = cardAt(x, y);
    if (kind) {
      s.drag = { kind, x, y };
      s.picked = null;
    }
  }
}

function pointerMove(s: GameState, x: number, y: number): void {
  if (!s.drag) return;
  s.drag = { kind: s.drag.kind, x, y };
}

function pointerUp(s: GameState, x: number, y: number): void {
  if (!s.drag) {
    clickAt(s, x, y);
    return;
  }
  const kind = s.drag.kind;
  s.drag = null;
  if (s.phase !== 'playing') return;
  const cell = cellOf(x, y);
  if (cell) {
    placeTower(s, cell.c, cell.r, kind);
    return;
  }
  reject(s);
}

function handleKey(s: GameState, code: string): void {
  if (s.screen !== 'battle' || s.phase === 'clear' || s.phase === 'fail') return;
  if (code === 'Enter') begin(s);
  else if (code === 'Space') stepBattle(s);
}

function cellCenter(c: number, r: number): [number, number] {
  return [OX + c * CELL + CELL / 2, OY + r * CELL + CELL / 2];
}

function enemyBob(id: number, anim: number): number {
  const phase = (anim + id * 11) % 30;
  if (phase < 15) return phase * 0.4;
  return (30 - phase) * 0.4;
}

function towerLabel(kind: TowerKind, upgraded: boolean): string {
  const base = kind === 'gun' ? 'gun' : kind === 'wall' ? 'wall' : 'cannon';
  return upgraded ? `${base}+` : base;
}

const BOARD_CELLS = Array.from({ length: COLS * ROWS }, (_, i) => ({
  c: i % COLS,
  r: Math.floor(i / COLS),
  key: `${i % COLS},${Math.floor(i / COLS)}`,
}));

const { store, commitChange, bindStore } = createGameStore(fresh());

function Game() {
  useFrame((frame) => {
    if (frame.deltaSeconds <= 0) return;
    commitChange('tick', (draft) => logicTick(draft));
  });

  const ended = store.phase === 'clear' || store.phase === 'fail';
  const outcome =
    store.phase === 'clear' ? 'Tower clear' : store.phase === 'fail' ? 'Tower lost' : '';
  const pathR = store.map === 'bend' ? 4 : 2;
  const baseRow = store.map ? pathR : 2;
  const shotT = (store.anim % 30) / 30;

  return (
    <scene
      name="main"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      backgroundColor="#1a2030"
      onKeyDown={(event) => {
        const code = event.detail?.code ?? '';
        commitChange(`key:${code}`, (draft) => handleKey(draft, code));
      }}
      onClick={(event) => {
        commitChange('click', (draft) => clickAt(draft, event.x, event.y));
      }}
      onPointerDown={(event) => {
        commitChange('pointer-down', (draft) => pointerDown(draft, event.x, event.y));
      }}
      onPointerMove={(event) => {
        commitChange('pointer-move', (draft) => pointerMove(draft, event.x, event.y));
      }}
      onPointerUp={(event) => {
        commitChange('pointer-up', (draft) => pointerUp(draft, event.x, event.y));
      }}
    >
      <text
        x={0}
        y={20}
        width={SCENE_WIDTH}
        height={44}
        text="Tower Defense"
        textAlign="center"
        textColor="#f8fafc"
        textSize="36"
      />

      <Show when={store.screen === 'select'}>
        <text
          x={80}
          y={100}
          width={400}
          height={28}
          text={`open ${store.open} / 2`}
          textColor="#cbd5e1"
          textSize="22"
        />
        <group key="straight-card" x={STRAIGHT_CARD.x} y={STRAIGHT_CARD.y} width={STRAIGHT_CARD.w} height={STRAIGHT_CARD.h}>
          <node x={0} y={0} width={STRAIGHT_CARD.w} height={STRAIGHT_CARD.h} shape="roundedRect(12 12 12 12)" backgroundColor="#334155" />
          <text x={0} y={60} width={STRAIGHT_CARD.w} height={36} text="Straight" textAlign="center" textColor="#f1f5f9" textSize="28" />
          <text x={0} y={120} width={STRAIGHT_CARD.w} height={24} text="Open" textAlign="center" textColor="#4ade80" textSize="20" />
        </group>
        <group key="bend-card" x={BEND_CARD.x} y={BEND_CARD.y} width={BEND_CARD.w} height={BEND_CARD.h}>
          <node x={0} y={0} width={BEND_CARD.w} height={BEND_CARD.h} shape="roundedRect(12 12 12 12)" backgroundColor="#334155" />
          <text x={0} y={60} width={BEND_CARD.w} height={36} text="Bend" textAlign="center" textColor="#f1f5f9" textSize="28" />
          <text
            x={0}
            y={120}
            width={BEND_CARD.w}
            height={24}
            text={store.open >= 2 ? 'Open' : 'Locked'}
            textAlign="center"
            textColor={store.open >= 2 ? '#4ade80' : '#f87171'}
            textSize="20"
          />
        </group>
        <group key="save-btn" x={SAVE_BTN.x} y={SAVE_BTN.y} width={SAVE_BTN.w} height={SAVE_BTN.h}>
          <node x={0} y={0} width={SAVE_BTN.w} height={SAVE_BTN.h} shape="roundedRect(8 8 8 8)" backgroundColor="#2563eb" />
          <text x={0} y={16} width={SAVE_BTN.w} height={24} text="Save" textAlign="center" textColor="#fff" textSize="20" />
        </group>
        <group key="wipe-btn" x={WIPE_BTN.x} y={WIPE_BTN.y} width={WIPE_BTN.w} height={WIPE_BTN.h}>
          <node x={0} y={0} width={WIPE_BTN.w} height={WIPE_BTN.h} shape="roundedRect(8 8 8 8)" backgroundColor="#475569" />
          <text x={0} y={16} width={WIPE_BTN.w} height={24} text="Wipe" textAlign="center" textColor="#fff" textSize="20" />
        </group>
        <group key="load-btn" x={LOAD_BTN.x} y={LOAD_BTN.y} width={LOAD_BTN.w} height={LOAD_BTN.h}>
          <node x={0} y={0} width={LOAD_BTN.w} height={LOAD_BTN.h} shape="roundedRect(8 8 8 8)" backgroundColor="#0f766e" />
          <text x={0} y={16} width={LOAD_BTN.w} height={24} text="Load" textAlign="center" textColor="#fff" textSize="20" />
        </group>
      </Show>

      <Show when={store.screen === 'battle'}>
        <text
          x={40}
          y={72}
          width={600}
          height={24}
          text={`${store.map === 'bend' ? 'Bend' : 'Straight'}   wave ${store.wave} / 3   dp ${store.dp}   base ${store.base}`}
          textColor="#e2e8f0"
          textSize="20"
        />

        <For each={BOARD_CELLS}>
          {(cell) => {
            const isPath = cell.r === pathR;
            const isDeploy =
              store.map === 'bend'
                ? cell.r === 2 && cell.c >= 1 && cell.c <= 6
                : (cell.r === 1 || cell.r === 3) && cell.c >= 1 && cell.c <= 6;
            const tile = isPath ? pathPng : isDeploy ? grassPng : '';
            return (
              <Show when={tile}>
                <image
                  key={`tile-${cell.key}`}
                  source={tile}
                  x={OX + cell.c * CELL}
                  y={OY + cell.r * CELL}
                  width={CELL}
                  height={CELL}
                  imageFit="cover"
                />
              </Show>
            );
          }}
        </For>

        <image
          source={basePng}
          x={OX + COLS * CELL}
          y={OY + baseRow * CELL}
          width={CELL}
          height={CELL}
          imageFit="cover"
        />

        <For each={store.towers}>
          {(tower) => (
            <group
              key={tower.id}
              x={OX + tower.c * CELL + 4}
              y={OY + tower.r * CELL + 4}
              width={CELL - 8}
              height={CELL - 8}
            >
              <image
                source={TOWER_SPRITES[tower.kind]}
                x={0}
                y={0}
                width={CELL - 8}
                height={CELL - 8}
                imageFit="contain"
              />
              <Show when={store.picked?.c === tower.c && store.picked?.r === tower.r}>
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
                y={CELL - 20}
                width={CELL - 8}
                height={14}
                text={towerLabel(tower.kind, tower.upgraded)}
                textAlign="center"
                textColor="#fef9c3"
                textSize="12"
              />
              <Show when={tower.kind === 'wall'}>
                <text
                  x={0}
                  y={2}
                  width={CELL - 8}
                  height={14}
                  text={`${tower.hp}`}
                  textAlign="center"
                  textColor="#fca5a5"
                  textSize="12"
                />
              </Show>
            </group>
          )}
        </For>

        <For each={store.enemies}>
          {(enemy) => {
            const bob = enemyBob(enemy.id, store.anim);
            return (
              <image
                key={`enemy-${enemy.id}`}
                source={ENEMY_SPRITES[enemy.kind]}
                x={OX + enemy.c * CELL + 8}
                y={OY + enemy.r * CELL + 8 - bob}
                width={CELL - 16}
                height={CELL - 16}
                imageFit="contain"
              />
            );
          }}
        </For>

        <For each={store.shots}>
          {(shot) => {
            const [x0, y0] = cellCenter(shot.fc, shot.fr);
            const [x1, y1] = cellCenter(shot.tc, shot.tr);
            const hx = x0 + (x1 - x0) * shotT;
            const hy = y0 + (y1 - y0) * shotT;
            return (
              <>
                <line key={`line-${shot.fc}-${shot.fr}-${shot.tc}-${shot.tr}`} from={{ x: x0, y: y0 }} to={{ x: x1, y: y1 }} stroke="#fde047" strokeWidth={3} />
                <node
                  key={`dot-${shot.fc}-${shot.fr}-${shot.tc}-${shot.tr}`}
                  x={hx - 6}
                  y={hy - 6}
                  width={12}
                  height={12}
                  shape="circular"
                  backgroundColor="#fff176"
                />
              </>
            );
          }}
        </For>

        <group key="card-gun" x={CARD_RECTS.gun.x} y={CARD_RECTS.gun.y} width={CARD_RECTS.gun.w} height={CARD_RECTS.gun.h}>
          <node x={0} y={0} width={CARD_RECTS.gun.w} height={CARD_RECTS.gun.h} shape="roundedRect(8 8 8 8)" backgroundColor="#1e293b" />
          <image source={gunPng} x={8} y={8} width={40} height={40} imageFit="contain" />
          <text x={56} y={16} width={180} height={24} text="gun (2)" textColor="#e2e8f0" textSize="18" />
        </group>
        <group key="card-wall" x={CARD_RECTS.wall.x} y={CARD_RECTS.wall.y} width={CARD_RECTS.wall.w} height={CARD_RECTS.wall.h}>
          <node x={0} y={0} width={CARD_RECTS.wall.w} height={CARD_RECTS.wall.h} shape="roundedRect(8 8 8 8)" backgroundColor="#1e293b" />
          <image source={wallPng} x={8} y={8} width={40} height={40} imageFit="contain" />
          <text x={56} y={16} width={180} height={24} text="wall (2)" textColor="#e2e8f0" textSize="18" />
        </group>
        <group key="card-cannon" x={CARD_RECTS.cannon.x} y={CARD_RECTS.cannon.y} width={CARD_RECTS.cannon.w} height={CARD_RECTS.cannon.h}>
          <node x={0} y={0} width={CARD_RECTS.cannon.w} height={CARD_RECTS.cannon.h} shape="roundedRect(8 8 8 8)" backgroundColor="#1e293b" />
          <image source={cannonPng} x={8} y={8} width={40} height={40} imageFit="contain" />
          <text x={56} y={16} width={180} height={24} text="cannon (4)" textColor="#e2e8f0" textSize="18" />
        </group>

        <Show when={store.drag}>
          {(drag) => (
            <image
              key="drag-card"
              source={TOWER_SPRITES[drag().kind]}
              x={drag().x - 28}
              y={drag().y - 28}
              width={56}
              height={56}
              imageFit="contain"
            />
          )}
        </Show>

        <group key="upgrade-btn" x={UPGRADE_BTN.x} y={UPGRADE_BTN.y} width={UPGRADE_BTN.w} height={UPGRADE_BTN.h}>
          <node x={0} y={0} width={UPGRADE_BTN.w} height={UPGRADE_BTN.h} shape="roundedRect(8 8 8 8)" backgroundColor="#7c3aed" />
          <text x={0} y={16} width={UPGRADE_BTN.w} height={24} text="Upgrade (2)" textAlign="center" textColor="#fff" textSize="18" />
        </group>

        <group key="start-btn" x={START_BTN.x} y={START_BTN.y} width={START_BTN.w} height={START_BTN.h}>
          <node x={0} y={0} width={START_BTN.w} height={START_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#2563eb" />
          <text x={0} y={22} width={START_BTN.w} height={28} text="Start" textAlign="center" textColor="#fff" textSize="24" />
        </group>

        <group key="step-btn" x={STEP_BTN.x} y={STEP_BTN.y} width={STEP_BTN.w} height={STEP_BTN.h}>
          <node x={0} y={0} width={STEP_BTN.w} height={STEP_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#334155" />
          <text x={0} y={22} width={STEP_BTN.w} height={28} text="Step" textAlign="center" textColor="#fff" textSize="24" />
        </group>

        <Show when={ended}>
          <group key="retry-btn" x={RETRY_BTN.x} y={RETRY_BTN.y} width={RETRY_BTN.w} height={RETRY_BTN.h}>
            <node x={0} y={0} width={RETRY_BTN.w} height={RETRY_BTN.h} shape="roundedRect(12 12 12 12)" backgroundColor="#475569" />
            <text x={0} y={22} width={RETRY_BTN.w} height={28} text="Retry" textAlign="center" textColor="#fff" textSize="24" />
          </group>
          <group key="maps-btn" x={MAPS_BTN.x} y={MAPS_BTN.y} width={MAPS_BTN.w} height={MAPS_BTN.h}>
            <node x={0} y={0} width={MAPS_BTN.w} height={MAPS_BTN.h} shape="roundedRect(10 10 10 10)" backgroundColor="#0f766e" />
            <text x={0} y={16} width={MAPS_BTN.w} height={24} text="Maps" textAlign="center" textColor="#fff" textSize="20" />
          </group>
        </Show>
      </Show>

      <Show when={store.note && store.note !== outcome}>
        <text x={480} y={520} width={320} height={28} text={store.note} textAlign="center" textColor="#f87171" textSize="22" />
      </Show>
      <Show when={outcome}>
        <text
          x={420}
          y={560}
          width={440}
          height={40}
          text={outcome}
          textAlign="center"
          textColor={store.phase === 'fail' ? '#f87171' : '#4ade80'}
          textSize="28"
        />
      </Show>
    </scene>
  );
}

renderGame(() => <Game />, { bindStore });
