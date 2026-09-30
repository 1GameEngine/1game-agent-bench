import { createGameStore, renderGame } from '@1game/engine-bundle/runtime/worker';
import floorUrl from '../assets/floor.png';
import depotUrl from '../assets/depot.png';
import meleeUrl from '../assets/melee.png';
import rangedUrl from '../assets/ranged.png';
import supportUrl from '../assets/support.png';
import bruteUrl from '../assets/brute.png';
import shotUrl from '../assets/shot.png';
import lurkerUrl from '../assets/lurker.png';

const COLS = 8;
const ROWS = 6;
const OX = 384;
const OY = 120;
const CELL = 64;
const LIMIT = 8;
const ALLY_RANK: Record<string, number> = { melee: 0, ranged: 1, support: 2 };
const SPRITE: Record<string, string> = {
  melee: meleeUrl,
  ranged: rangedUrl,
  support: supportUrl,
  brute: bruteUrl,
  shot: shotUrl,
  lurker: lurkerUrl,
};

type Unit = {
  id: string;
  side: 'ally' | 'enemy';
  c: number;
  r: number;
  hp: number;
  max: number;
  mv: number;
  rng: number;
  atk: number;
  heal: number;
  acted: boolean;
};
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type GameState = { phase: Phase; turn: number; selected: string; units: Unit[] };

function opening(): Unit[] {
  return [
    { id: 'melee', side: 'ally', c: 1, r: 4, hp: 20, max: 20, mv: 2, rng: 1, atk: 3, heal: 0, acted: false },
    { id: 'ranged', side: 'ally', c: 3, r: 4, hp: 16, max: 16, mv: 2, rng: 3, atk: 3, heal: 0, acted: false },
    { id: 'support', side: 'ally', c: 5, r: 4, hp: 16, max: 16, mv: 3, rng: 0, atk: 0, heal: 2, acted: false },
    { id: 'brute', side: 'enemy', c: 1, r: 2, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
    { id: 'shot', side: 'enemy', c: 3, r: 2, hp: 3, max: 3, mv: 1, rng: 3, atk: 1, heal: 0, acted: false },
    { id: 'lurker', side: 'enemy', c: 6, r: 2, hp: 3, max: 3, mv: 1, rng: 1, atk: 1, heal: 0, acted: false },
  ];
}

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  turn: 0,
  selected: '',
  units: opening(),
} satisfies GameState);

function living(s: GameState, side?: 'ally' | 'enemy') {
  return s.units.filter((u) => u.hp > 0 && (!side || u.side === side));
}
function at(s: GameState, c: number, r: number) {
  return s.units.find((u) => u.hp > 0 && u.c === c && u.r === r) ?? null;
}
function byId(s: GameState, id: string) {
  return s.units.find((u) => u.id === id) ?? null;
}
function los(s: GameState, u: Unit, c: number, r: number) {
  if (u.c !== c && u.r !== r) return null;
  const dist = Math.abs(u.c - c) + Math.abs(u.r - r);
  if (dist < 1) return null;
  const dc = Math.sign(c - u.c);
  const dr = Math.sign(r - u.r);
  let x = u.c + dc;
  let y = u.r + dr;
  while (x !== c || y !== r) {
    if (at(s, x, y)) return null;
    x += dc;
    y += dr;
  }
  return dist;
}
function reach(s: GameState, u: Unit) {
  const seen = new Set([`${u.c},${u.r}`]);
  let frontier = [[u.c, u.r]];
  const out: number[][] = [];
  for (let step = 1; step <= u.mv; step++) {
    const next: number[][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc;
        const nr = r + dr;
        const key = `${nc},${nr}`;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || seen.has(key)) continue;
        seen.add(key);
        if (at(s, nc, nr)) continue;
        next.push([nc, nr]);
        out.push([nc, nr]);
      }
    }
    frontier = next;
  }
  return out;
}
function settle(s: GameState) {
  const allyOnDepot = living(s, 'ally').some((u) => u.c === 3 && u.r === 0);
  if (allyOnDepot || living(s, 'enemy').length === 0) s.phase = 'clear';
  else if (living(s, 'ally').length === 0) s.phase = 'fail';
}
function enemyPhase(s: GameState) {
  for (const id of ['brute', 'shot', 'lurker']) {
    const e = byId(s, id);
    if (!e || e.hp <= 0 || s.phase !== 'playing') continue;
    const targets = living(s, 'ally').sort((a, b) => ALLY_RANK[a.id] - ALLY_RANK[b.id]);
    if (!targets.length) break;
    const shots = targets.filter((a) => {
      const d = los(s, e, a.c, a.r);
      return d != null && d <= e.rng;
    });
    if (shots.length) {
      shots[0].hp = Math.max(0, shots[0].hp - e.atk);
      settle(s);
      continue;
    }
    const goal = targets.slice().sort((a, b) => {
      const da = Math.abs(a.c - e.c) + Math.abs(a.r - e.r);
      const db = Math.abs(b.c - e.c) + Math.abs(b.r - e.r);
      return da - db || ALLY_RANK[a.id] - ALLY_RANK[b.id];
    })[0];
    const cur = Math.abs(goal.c - e.c) + Math.abs(goal.r - e.r);
    const steps = [[0, -1], [-1, 0], [1, 0], [0, 1]]
      .map(([dc, dr]) => [e.c + dc, e.r + dr])
      .filter(([c, r]) => c >= 0 && r >= 0 && c < COLS && r < ROWS && !at(s, c, r));
    steps.sort((a, b) => {
      const da = Math.abs(goal.c - a[0]) + Math.abs(goal.r - a[1]);
      const db = Math.abs(goal.c - b[0]) + Math.abs(goal.r - b[1]);
      return da - db || a[1] - b[1] || a[0] - b[0];
    });
    if (steps.length && Math.abs(goal.c - steps[0][0]) + Math.abs(goal.r - steps[0][1]) < cur) {
      e.c = steps[0][0];
      e.r = steps[0][1];
    }
  }
}
function endTurn(s: GameState) {
  if (s.phase !== 'playing') return;
  enemyPhase(s);
  if (s.phase !== 'playing') return;
  if (s.turn >= LIMIT) s.phase = 'fail';
  else {
    s.turn += 1;
    s.selected = '';
    for (const u of living(s, 'ally')) u.acted = false;
  }
}
function maybeAuto(s: GameState) {
  if (s.phase === 'playing' && living(s, 'ally').every((u) => u.acted)) endTurn(s);
}
function begin(s: GameState) {
  if (s.phase !== 'ready') return;
  s.phase = 'playing';
  s.turn = 1;
}
function clickCell(s: GameState, c: number, r: number) {
  if (s.phase !== 'playing') return;
  const hit = at(s, c, r);
  const sel = s.selected ? byId(s, s.selected) : null;
  const canHeal = Boolean(
    sel && sel.hp > 0 && !sel.acted && sel.heal > 0 && hit && hit.side === 'ally' && hit.id !== sel.id
    && Math.abs(hit.c - sel.c) + Math.abs(hit.r - sel.r) === 1,
  );
  if (canHeal && sel && hit) {
    hit.hp = Math.min(hit.max, hit.hp + sel.heal);
    sel.acted = true;
    s.selected = '';
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
      s.selected = '';
      settle(s);
      maybeAuto(s);
    }
    return;
  }
  if (!hit) {
    if (!reach(s, sel).some(([cc, rr]) => cc === c && rr === r)) return;
    sel.c = c;
    sel.r = r;
    sel.acted = true;
    s.selected = '';
    settle(s);
    maybeAuto(s);
  }
}
function onKey(code: string) {
  commitChange('key', (draft: GameState) => {
    if (draft.phase === 'clear' || draft.phase === 'fail') return;
    if (code === 'Enter') begin(draft);
    else if (code === 'Space') endTurn(draft);
  });
}

function App() {
  const cells = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) cells.push({ c, r });
  }
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#1c1610" onKeyDown={(event) => onKey(event.code)}>
      <text x={80} y={12} width={1120} height={52} text="Depot Skirmish" textColor="#f6e7c1" textSize={42} textAlign="center" />
      <text
        x={40}
        y={68}
        width={1200}
        height={36}
        text={`turn ${store.turn} / 8    ${store.units.map((u) => `${u.id} ${u.hp}`).join('   ')}`}
        textColor="#f6e7c1"
        textSize={22}
        textAlign="center"
      />
      {cells.map(({ c, r }) => {
        const unit = store.units.find((u) => u.hp > 0 && u.c === c && u.r === r);
        const selected = unit && store.selected === unit.id;
        return (
          <group
            key={`c${c}r${r}`}
            x={OX + c * CELL}
            y={OY + r * CELL}
            width={CELL}
            height={CELL}
            clickable
            onClick={() => commitChange('cell', (draft: GameState) => clickCell(draft, c, r))}
          >
            <image x={0} y={0} width={CELL} height={CELL} source={c === 3 && r === 0 ? depotUrl : floorUrl} />
            {selected ? <node x={2} y={2} width={60} height={60} backgroundColor="#f0c14a" /> : null}
            {unit ? <image x={8} y={4} width={48} height={48} source={SPRITE[unit.id]} /> : null}
          </group>
        );
      })}
      <text
        x={80}
        y={548}
        width={1120}
        height={56}
        text={store.phase === 'fail' ? 'Depot lost' : store.phase === 'clear' ? 'Depot clear' : ''}
        textColor="#f6d98a"
        textSize={40}
        textAlign="center"
      />
      <group
        x={60}
        y={620}
        width={240}
        height={70}
        clickable
        onClick={() => commitChange('end', (draft: GameState) => endTurn(draft))}
      >
        <node x={0} y={0} width={240} height={70} backgroundColor="#5c4030" />
        <text x={0} y={14} width={240} height={42} text="End" textColor="#f6e7c1" textSize={32} textAlign="center" />
      </group>
      <group
        x={440}
        y={620}
        width={400}
        height={70}
        clickable
        onClick={() => commitChange('start', (draft: GameState) => begin(draft))}
      >
        <node x={0} y={0} width={400} height={70} backgroundColor="#8a5a2a" />
        <text x={0} y={14} width={400} height={42} text="Start" textColor="#ffffff" textSize={32} textAlign="center" />
      </group>
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
