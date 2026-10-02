import { createGameStore, renderGame } from '@1game/engine-bundle/runtime/worker';
import pathUrl from '../assets/path.png';
import grassUrl from '../assets/grass.png';
import baseUrl from '../assets/base.png';
import wallUrl from '../assets/wall.png';
import gunUrl from '../assets/gun.png';
import cannonUrl from '../assets/cannon.png';
import scoutUrl from '../assets/scout.png';
import bruteUrl from '../assets/brute.png';
import flyerUrl from '../assets/flyer.png';

const COLS = 8;
const ROWS = 5;
const OX = 352;
const OY = 148;
const CELL = 72;
const COSTS: Record<string, number> = { gun: 2, wall: 2, cannon: 4 };
const RANGE: Record<string, number> = { gun: 2, cannon: 3 };
const DMG: Record<string, number> = { gun: 1, cannon: 3 };
const TOWER_SPRITE: Record<string, string> = { gun: gunUrl, wall: wallUrl, cannon: cannonUrl };
const ENEMY_SPRITE: Record<string, string> = { scout: scoutUrl, brute: bruteUrl, flyer: flyerUrl };

type Enemy = { id: number; kind: string; hp: number; atk: number; fly: boolean; wave: number; c: number; r: number };
type Tower = { kind: string; c: number; r: number; hp: number };
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type GameState = {
  phase: Phase;
  wave: number;
  dp: number;
  base: number;
  selected: string;
  towers: Tower[];
  enemies: Enemy[];
  queue: Enemy[];
  seq: number;
};

function openingQueue(): Enemy[] {
  return [
    { id: 0, kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1, c: 0, r: 2 },
    { id: 1, kind: 'scout', hp: 2, atk: 1, fly: false, wave: 1, c: 0, r: 2 },
    { id: 2, kind: 'flyer', hp: 3, atk: 0, fly: true, wave: 2, c: 0, r: 2 },
    { id: 3, kind: 'brute', hp: 6, atk: 2, fly: false, wave: 3, c: 0, r: 2 },
    { id: 4, kind: 'scout', hp: 2, atk: 1, fly: false, wave: 3, c: 0, r: 2 },
  ];
}

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  wave: 0,
  dp: 6,
  base: 4,
  selected: '',
  towers: [],
  enemies: [],
  queue: openingQueue(),
  seq: 0,
} satisfies GameState);

function deploy(c: number, r: number) {
  return (r === 1 || r === 3) && c >= 1 && c <= 6;
}
function onPath(c: number, r: number) {
  return r === 2 && c >= 0 && c < COLS;
}
function towerAt(s: GameState, c: number, r: number) {
  return s.towers.find((t) => t.c === c && t.r === r) ?? null;
}
function enemyOn(s: GameState, c: number, r: number, fly: boolean) {
  return s.enemies.find((e) => e.c === c && e.r === r && e.fly === fly) ?? null;
}
function groundOn(s: GameState, c: number, r: number) {
  return s.enemies.find((e) => e.c === c && e.r === r && !e.fly) ?? null;
}
function waveOf(s: GameState) {
  const ws = [...s.queue.map((e) => e.wave), ...s.enemies.map((e) => e.wave)];
  if (!ws.length) return s.phase === 'ready' ? 0 : 3;
  return Math.min(...ws);
}
function begin(s: GameState) {
  if (s.phase !== 'ready') return;
  s.phase = 'playing';
  s.wave = 1;
}
function select(s: GameState, kind: string) {
  if (s.phase !== 'playing' || !COSTS[kind]) return;
  s.selected = kind;
}
function place(s: GameState, c: number, r: number) {
  if (s.phase !== 'playing' || !s.selected) return;
  const kind = s.selected;
  const cost = COSTS[kind];
  if (s.dp < cost) return;
  if (kind === 'wall') {
    if (!onPath(c, r) || towerAt(s, c, r) || groundOn(s, c, r)) return;
    s.towers.push({ kind, c, r, hp: 6 });
  } else {
    if (!deploy(c, r) || towerAt(s, c, r)) return;
    s.towers.push({ kind, c, r, hp: 1 });
  }
  s.dp -= cost;
  s.selected = '';
}
function step(s: GameState) {
  if (s.phase !== 'playing') return;
  const towers = s.towers.filter((t) => t.kind !== 'wall').sort((a, b) => a.c - b.c || a.r - b.r);
  for (const t of towers) {
    const hits = s.enemies
      .filter((e) => Math.abs(e.c - t.c) + Math.abs(e.r - t.r) <= RANGE[t.kind])
      .sort((a, b) => b.c - a.c || a.r - b.r || Number(a.fly) - Number(b.fly));
    if (hits[0]) hits[0].hp -= DMG[t.kind];
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
function ended(s: GameState) {
  return s.phase === 'clear' || s.phase === 'fail';
}
function onKey(code: string) {
  if (ended(store)) return;
  if (code === 'Enter') commitChange('begin', (draft: GameState) => begin(draft));
  else if (code === 'Space') commitChange('step', (draft: GameState) => step(draft));
}
function tileSource(c: number, r: number) {
  if (onPath(c, r)) return pathUrl;
  if (deploy(c, r)) return grassUrl;
  return '';
}

const cells = Array.from({ length: ROWS * COLS }, (_, i) => ({ c: i % COLS, r: Math.floor(i / COLS) }));
const cards = [
  { kind: 'gun', y: 160 },
  { kind: 'wall', y: 228 },
  { kind: 'cannon', y: 296 },
];

function App() {
  const banner = store.phase === 'fail' ? 'Tower lost' : store.phase === 'clear' ? 'Tower clear' : '';
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#1c1610" onKeyDown={(event) => onKey(event.code)}>
      <text x={80} y={12} width={1120} height={52} text="Tower Defense" textColor="#f6e7c1" textSize={42} textAlign="center" />
      <text
        x={40}
        y={68}
        width={1200}
        height={36}
        text={`wave ${store.wave} / 3    dp ${store.dp}    base ${store.base}`}
        textColor="#f6e7c1"
        textSize={28}
        textAlign="center"
      />
      {cells.map(({ c, r }) => {
        const source = tileSource(c, r);
        const tower = store.towers.find((t) => t.c === c && t.r === r);
        return (
          <group
            key={`c${c}r${r}`}
            x={OX + c * CELL}
            y={OY + r * CELL}
            width={CELL}
            height={CELL}
            clickable
            onClick={() => commitChange('cell', (draft: GameState) => { if (!ended(draft)) place(draft, c, r); })}
          >
            {source ? <image key={`tile-${c}-${r}`} x={0} y={0} width={CELL} height={CELL} source={source} /> : <node x={0} y={0} width={CELL} height={CELL} backgroundColor="#241c16" />}
            {tower ? <image key={`tower-${c}-${r}`} x={12} y={20} width={48} height={48} source={TOWER_SPRITE[tower.kind]} /> : null}
            {tower ? (
              <text x={2} y={2} width={68} height={16} text={tower.kind === 'wall' ? `${tower.hp}` : tower.kind} textColor="#f6e7c1" textSize={14} textAlign="center" />
            ) : null}
          </group>
        );
      })}
      <image key="base" x={OX + COLS * CELL} y={OY + 2 * CELL} width={CELL} height={CELL} source={baseUrl} />
      {store.enemies.map((e) => (
        <group key={`e${e.id}`} x={OX + e.c * CELL + (e.fly ? 28 : 4)} y={OY + e.r * CELL + 4} width={36} height={48}>
          <image key={`es${e.id}`} x={0} y={0} width={36} height={36} source={ENEMY_SPRITE[e.kind]} />
          <text x={0} y={32} width={36} height={16} text={`${e.kind} ${e.hp}`} textColor="#ffe08a" textSize={12} textAlign="center" />
        </group>
      ))}
      <text x={80} y={548} width={1120} height={56} text={banner} textColor="#f6d98a" textSize={40} textAlign="center" />
      {cards.map((card) => (
        <group
          key={card.kind}
          x={48}
          y={card.y}
          width={260}
          height={56}
          clickable
          onClick={() => commitChange(card.kind, (draft: GameState) => { if (!ended(draft)) select(draft, card.kind); })}
        >
          <node x={0} y={0} width={260} height={56} backgroundColor={store.selected === card.kind ? '#c47a2c' : '#5c4030'} />
          <text x={8} y={12} width={244} height={32} text={`${card.kind}  ${COSTS[card.kind]}`} textColor="#f6e7c1" textSize={24} textAlign="center" />
        </group>
      ))}
      <group x={60} y={620} width={240} height={70} clickable onClick={() => commitChange('step', (draft: GameState) => { if (!ended(draft)) step(draft); })}>
        <node x={0} y={0} width={240} height={70} backgroundColor="#5c4030" />
        <text x={0} y={14} width={240} height={42} text="Step" textColor="#f6e7c1" textSize={32} textAlign="center" />
      </group>
      <group x={440} y={620} width={400} height={70} clickable onClick={() => commitChange('start', (draft: GameState) => { if (!ended(draft)) begin(draft); })}>
        <node x={0} y={0} width={400} height={70} backgroundColor="#8a5a2a" />
        <text x={0} y={14} width={400} height={42} text="Start" textColor="#ffffff" textSize={32} textAlign="center" />
      </group>
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
