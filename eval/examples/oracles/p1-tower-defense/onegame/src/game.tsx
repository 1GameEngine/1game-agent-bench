import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
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
const TOWER_SPRITE: Record<string, string> = { gun: gunUrl, wall: wallUrl, cannon: cannonUrl };
const ENEMY_SPRITE: Record<string, string> = { scout: scoutUrl, brute: bruteUrl, flyer: flyerUrl };

type Enemy = { id: number; kind: string; hp: number; atk: number; fly: boolean; wave: number; c: number; r: number };
type Tower = { kind: string; c: number; r: number; hp: number; upgraded: boolean };
type Shot = { fc: number; fr: number; tc: number; tr: number };
type Drag = { kind: string; x: number; y: number };
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type GameState = {
  screen: 'select' | 'battle';
  map: string;
  open: number;
  slot: number;
  phase: Phase;
  wave: number;
  dp: number;
  base: number;
  selected: string;
  picked: { c: number; r: number } | null;
  note: string;
  shots: Shot[];
  towers: Tower[];
  enemies: Enemy[];
  queue: Enemy[];
  drag: Drag | null;
  anim: number;
  clock: number;
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
} satisfies GameState);

function pathRow(s: GameState) {
  return s.map === 'bend' ? 4 : 2;
}
function deploy(s: GameState, c: number, r: number) {
  const rows = s.map === 'bend' ? [2] : [1, 3];
  return rows.includes(r) && c >= 1 && c <= 6;
}
function onPath(s: GameState, c: number, r: number) {
  return r === pathRow(s) && c >= 0 && c < COLS;
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
function reject(s: GameState) {
  s.note = 'Rejected';
}
function clearNote(s: GameState) {
  if (s.note === 'Rejected') s.note = '';
}
function dmgOf(t: Tower) {
  if (t.kind === 'gun') return t.upgraded ? 2 : 1;
  if (t.kind === 'cannon') return t.upgraded ? 5 : 3;
  return 0;
}
function resetBattle(s: GameState) {
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
function enter(s: GameState, map: string) {
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
function begin(s: GameState) {
  if (s.screen !== 'battle' || s.phase !== 'ready') return;
  s.phase = 'playing';
  s.wave = 1;
}
function place(s: GameState, c: number, r: number) {
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
function upgrade(s: GameState) {
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
function retry(s: GameState) {
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
function maps(s: GameState) {
  if (s.screen !== 'battle') return;
  if (s.phase !== 'clear' && s.phase !== 'fail') return;
  s.screen = 'select';
  s.drag = null;
  s.note = '';
  s.shots = [];
  s.phase = 'ready';
}
function saveGame(s: GameState) {
  if (s.screen !== 'select') return;
  s.slot = s.open;
  s.note = 'Saved';
}
function wipe(s: GameState) {
  if (s.screen !== 'select') return;
  s.open = 1;
  s.note = 'Wiped';
}
function loadGame(s: GameState) {
  if (s.screen !== 'select') return;
  s.open = s.slot;
  s.note = 'Loaded';
}
function tick(s: GameState) {
  s.anim += 1;
  if (s.screen !== 'battle' || s.phase !== 'playing') return;
  s.clock += 1;
  if (s.clock % 30 === 0) s.dp = Math.min(10, s.dp + 1);
}
function step(s: GameState) {
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
function inside(x: number, y: number, rect: number[]) {
  return x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
}
function cardAt(x: number, y: number) {
  if (inside(x, y, [48, 160, 260, 56])) return 'gun';
  if (inside(x, y, [48, 228, 260, 56])) return 'wall';
  if (inside(x, y, [48, 296, 260, 56])) return 'cannon';
  return '';
}
function click(s: GameState, x: number, y: number) {
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
function pointerDown(s: GameState, x: number, y: number) {
  if (s.screen === 'battle' && s.phase === 'playing') {
    const kind = cardAt(x, y);
    if (kind) {
      s.drag = { kind, x, y };
      s.picked = null;
    }
  }
}
function pointerMove(s: GameState, x: number, y: number) {
  if (!s.drag) return;
  s.drag = { kind: s.drag.kind, x, y };
}
function pointerUp(s: GameState, x: number, y: number) {
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
function onKey(code: string) {
  if (store.screen !== 'battle' || store.phase === 'clear' || store.phase === 'fail') return;
  if (code === 'Enter') commitChange('begin', (draft: GameState) => begin(draft));
  else if (code === 'Space') commitChange('step', (draft: GameState) => step(draft));
}
function shotMarks(shot: Shot) {
  const x1 = OX + shot.fc * CELL + CELL / 2;
  const y1 = OY + shot.fr * CELL + CELL / 2;
  const x2 = OX + shot.tc * CELL + CELL / 2;
  const y2 = OY + shot.tr * CELL + CELL / 2;
  return Array.from({ length: 6 }, (_, i) => {
    const t = i / 5;
    return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
  });
}

const cells = Array.from({ length: ROWS * COLS }, (_, i) => ({ c: i % COLS, r: Math.floor(i / COLS) }));
const cards = [
  { kind: 'gun', y: 160 },
  { kind: 'wall', y: 228 },
  { kind: 'cannon', y: 296 },
];

function App() {
  useFrame((info) => {
    if (info.deltaSeconds <= 0) return;
    commitChange('tick', (draft: GameState) => tick(draft));
  });
  const banner = store.screen === 'battle' && store.phase === 'fail' ? 'Tower lost' : store.screen === 'battle' && store.phase === 'clear' ? 'Tower clear' : store.note;
  const hud = store.screen === 'select' ? `open ${store.open} / 2` : `wave ${store.wave} / 3    dp ${store.dp}    base ${store.base}`;
  const row = pathRow(store);
  const bob = store.anim % 10 < 5 ? 0 : 8;
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#1c1610" onKeyDown={(event) => onKey(event.code || event.detail?.code)}>
      <text x={80} y={12} width={1120} height={52} text="Tower Defense" textColor="#f6e7c1" textSize={42} textAlign="center" />
      <text x={40} y={68} width={1200} height={36} text={hud} textColor="#f6e7c1" textSize={28} textAlign="center" />
      {store.screen === 'select' ? (
        <group key="select">
          <group key="straight" x={80} y={160} width={520} height={180}>
            <node key="straight-bg" x={0} y={0} width={520} height={180} backgroundColor="#8a5a2a" />
            <text x={16} y={48} width={488} height={40} text="Straight" textColor="#ffffff" textSize={36} textAlign="center" />
            <text x={16} y={100} width={488} height={32} text="Open" textColor="#f6e7c1" textSize={28} textAlign="center" />
          </group>
          <group key="bend" x={640} y={160} width={520} height={180}>
            <node key="bend-bg" x={0} y={0} width={520} height={180} backgroundColor={store.open >= 2 ? '#8a5a2a' : '#3a3128'} />
            <text x={16} y={48} width={488} height={40} text="Bend" textColor="#ffffff" textSize={36} textAlign="center" />
            <text x={16} y={100} width={488} height={32} text={store.open >= 2 ? 'Open' : 'Locked'} textColor="#f6e7c1" textSize={28} textAlign="center" />
          </group>
          <group key="save" x={80} y={420} width={200} height={56}>
            <node key="save-bg" x={0} y={0} width={200} height={56} backgroundColor="#3d4a38" />
            <text x={8} y={12} width={184} height={32} text="Save" textColor="#f6e7c1" textSize={24} textAlign="center" />
          </group>
          <group key="wipe" x={300} y={420} width={200} height={56}>
            <node key="wipe-bg" x={0} y={0} width={200} height={56} backgroundColor="#5c4030" />
            <text x={8} y={12} width={184} height={32} text="Wipe" textColor="#f6e7c1" textSize={24} textAlign="center" />
          </group>
          <group key="load" x={520} y={420} width={200} height={56}>
            <node key="load-bg" x={0} y={0} width={200} height={56} backgroundColor="#3d4a38" />
            <text x={8} y={12} width={184} height={32} text="Load" textColor="#f6e7c1" textSize={24} textAlign="center" />
          </group>
        </group>
      ) : (
        <group key="battle">
          {cells.map(({ c, r }) => {
            const source = onPath(store, c, r) ? pathUrl : deploy(store, c, r) ? grassUrl : '';
            const tower = store.towers.find((t) => t.c === c && t.r === r);
            return (
              <group key={`c${c}r${r}`} x={OX + c * CELL} y={OY + r * CELL} width={CELL} height={CELL}>
                {source ? <image key={`tile-${c}-${r}`} x={0} y={0} width={CELL} height={CELL} source={source} /> : <node key={`empty-${c}-${r}`} x={0} y={0} width={CELL} height={CELL} backgroundColor="#241c16" />}
                {tower ? <image key={`tower-${c}-${r}`} x={12} y={20} width={48} height={48} source={TOWER_SPRITE[tower.kind]} /> : null}
                {tower ? (
                  <text x={2} y={2} width={68} height={16} text={tower.kind === 'wall' ? `${tower.hp}${tower.upgraded ? '+' : ''}` : `${tower.kind}${tower.upgraded ? '+' : ''}`} textColor="#f6e7c1" textSize={14} textAlign="center" />
                ) : null}
              </group>
            );
          })}
          <image key="base" x={OX + COLS * CELL} y={OY + row * CELL} width={CELL} height={CELL} source={baseUrl} />
          {store.enemies.map((e) => (
            <group key={`e${e.id}`} x={OX + e.c * CELL + (e.fly ? 28 : 4)} y={OY + e.r * CELL + 4 + bob} width={36} height={48}>
              <image key={`es${e.id}`} x={0} y={0} width={36} height={36} source={ENEMY_SPRITE[e.kind]} />
              <text x={0} y={32} width={36} height={16} text={`${e.kind} ${e.hp}`} textColor="#ffe08a" textSize={12} textAlign="center" />
            </group>
          ))}
          {store.shots.map((shot, i) => {
            const marks = shotMarks(shot);
            const t = (store.anim % 7) / 6;
            const head = marks[0];
            const tail = marks[5];
            return (
              <group key={`shot-${i}`}>
                {marks.map((mark, j) => (
                  <node key={`line-${i}-${j}`} x={mark.x - 4} y={mark.y - 4} width={8} height={8} backgroundColor="#ffe14a" />
                ))}
                <node key={`dot-${i}`} x={head.x + (tail.x - head.x) * t - 6} y={head.y + (tail.y - head.y) * t - 6} width={12} height={12} backgroundColor="#ffe14a" />
              </group>
            );
          })}
          {cards.map((card) => (
            <group key={card.kind} x={48} y={card.y} width={260} height={56}>
              <node key={`${card.kind}-bg`} x={0} y={0} width={260} height={56} backgroundColor="#5c4030" />
              <text x={8} y={12} width={244} height={32} text={`${card.kind}  ${COSTS[card.kind]}`} textColor="#f6e7c1" textSize={24} textAlign="center" />
            </group>
          ))}
          <group key="upgrade" x={1020} y={160} width={220} height={56}>
            <node key="upgrade-bg" x={0} y={0} width={220} height={56} backgroundColor="#5c4030" />
            <text x={8} y={12} width={204} height={32} text="Upgrade  2" textColor="#f6e7c1" textSize={24} textAlign="center" />
          </group>
          <group key="maps" x={1020} y={400} width={220} height={56}>
            <node key="maps-bg" x={0} y={0} width={220} height={56} backgroundColor="#3d4a38" />
            <text x={8} y={12} width={204} height={32} text="Maps" textColor="#f6e7c1" textSize={24} textAlign="center" />
          </group>
          <group key="step" x={60} y={620} width={240} height={70}>
            <node key="step-bg" x={0} y={0} width={240} height={70} backgroundColor="#5c4030" />
            <text x={0} y={14} width={240} height={42} text="Step" textColor="#f6e7c1" textSize={32} textAlign="center" />
          </group>
          <group key="start" x={440} y={620} width={400} height={70}>
            <node key="start-bg" x={0} y={0} width={400} height={70} backgroundColor="#8a5a2a" />
            <text x={0} y={14} width={400} height={42} text="Start" textColor="#ffffff" textSize={32} textAlign="center" />
          </group>
          <group key="retry" x={900} y={620} width={280} height={70}>
            <node key="retry-bg" x={0} y={0} width={280} height={70} backgroundColor="#3d4a38" />
            <text x={0} y={14} width={280} height={42} text="Retry" textColor="#f6e7c1" textSize={32} textAlign="center" />
          </group>
        </group>
      )}
      {store.drag ? <image key="ghost" x={store.drag.x - 24} y={store.drag.y - 24} width={48} height={48} source={TOWER_SPRITE[store.drag.kind]} /> : null}
      <text x={80} y={548} width={1120} height={56} text={banner} textColor="#f6d98a" textSize={40} textAlign="center" />
      <group
        key="pointer"
        x={0}
        y={0}
        width={1280}
        height={720}
        clickable
        onPointerDown={(event) => commitChange('down', (draft: GameState) => pointerDown(draft, event.x, event.y))}
        onPointerMove={(event) => commitChange('move', (draft: GameState) => pointerMove(draft, event.x, event.y))}
        onPointerUp={(event) => commitChange('up', (draft: GameState) => pointerUp(draft, event.x, event.y))}
      />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
