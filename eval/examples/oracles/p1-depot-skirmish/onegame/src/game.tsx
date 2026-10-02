import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
import floorUrl from '../assets/floor.png';
import depotUrl from '../assets/depot.png';
import rockUrl from '../assets/rock.png';
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
const SLIDE_N = 24;
const FLASH_N = 20;
const FADE_N = 18;
const ALLY_RANK: Record<string, number> = { melee: 0, ranged: 1, support: 2 };
const LURKER_RANK: Record<string, number> = { support: 0, ranged: 1, melee: 2 };
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
type Slide = { id: string; x0: number; y0: number; x1: number; y1: number; t: number };
type Mark = { id: string; t: number };
type Fade = { id: string; x: number; y: number; t: number };
type Phase = 'ready' | 'playing' | 'clear' | 'fail';
type GameState = {
  phase: Phase;
  turn: number;
  selected: string;
  map: 'yard' | 'ridge';
  note: string;
  blocks: number[][];
  units: Unit[];
  slides: Slide[];
  flashes: Mark[];
  fades: Fade[];
};

function opening(map: 'yard' | 'ridge'): Unit[] {
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

function reset(s: GameState, map: 'yard' | 'ridge') {
  s.map = map;
  s.phase = 'ready';
  s.turn = 0;
  s.selected = '';
  s.note = '';
  s.blocks = map === 'ridge' ? [[2, 3], [4, 3], [5, 1]] : [];
  s.units = opening(map);
  s.slides = [];
  s.flashes = [];
  s.fades = [];
}

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  turn: 0,
  selected: '',
  map: 'yard',
  note: '',
  blocks: [],
  units: opening('yard'),
  slides: [],
  flashes: [],
  fades: [],
} satisfies GameState);

function living(s: GameState, side?: 'ally' | 'enemy') {
  return s.units.filter((u) => u.hp > 0 && (!side || u.side === side));
}
function blocked(s: GameState, c: number, r: number) {
  return s.blocks.some(([bc, br]) => bc === c && br === r);
}
function at(s: GameState, c: number, r: number) {
  return s.units.find((u) => u.hp > 0 && u.c === c && u.r === r) ?? null;
}
function occupied(s: GameState, c: number, r: number) {
  return blocked(s, c, r) || at(s, c, r) != null;
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
    if (occupied(s, x, y)) return null;
    x += dc;
    y += dr;
  }
  return dist;
}
function reach(s: GameState, u: Unit) {
  const seen = new Set([`${u.c},${u.r}`]);
  let frontier = [[u.c, u.r]];
  const out: number[][] = [];
  for (let step = 1; step <= u.mv; step += 1) {
    const next: number[][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
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
function settle(s: GameState) {
  const allyOnDepot = living(s, 'ally').some((u) => u.c === 3 && u.r === 0);
  if (allyOnDepot || living(s, 'enemy').length === 0) s.phase = 'clear';
  else if (living(s, 'ally').length === 0) s.phase = 'fail';
}
function rank(enemyId: string, allyId: string) {
  return enemyId === 'lurker' ? LURKER_RANK[allyId] : ALLY_RANK[allyId];
}
function hurt(s: GameState, u: Unit, amount: number) {
  u.hp = Math.max(0, u.hp - amount);
  s.flashes.push({ id: u.id, t: 0 });
  if (u.hp <= 0) s.fades.push({ id: u.id, x: OX + u.c * CELL, y: OY + u.r * CELL, t: 0 });
}
function slide(s: GameState, id: string, c0: number, r0: number, c1: number, r1: number) {
  s.slides.push({ id, x0: OX + c0 * CELL, y0: OY + r0 * CELL, x1: OX + c1 * CELL, y1: OY + r1 * CELL, t: 0 });
}
function enemyPhase(s: GameState) {
  for (const id of ['brute', 'shot', 'lurker']) {
    const e = byId(s, id);
    if (!e || e.hp <= 0 || s.phase !== 'playing') continue;
    const originC = e.c;
    const originR = e.r;
    for (let step = 0; step < e.mv; step += 1) {
      if (e.hp <= 0 || s.phase !== 'playing') break;
      const targets = living(s, 'ally').sort((a, b) => rank(e.id, a.id) - rank(e.id, b.id));
      if (!targets.length) break;
      const shots = targets.filter((a) => {
        const d = los(s, e, a.c, a.r);
        return d != null && d <= e.rng;
      });
      if (shots.length) {
        hurt(s, shots[0], e.atk);
        settle(s);
        break;
      }
      const support = e.id === 'lurker' ? targets.find((a) => a.id === 'support') : null;
      const goal = support ?? targets.slice().sort((a, b) => {
        const da = Math.abs(a.c - e.c) + Math.abs(a.r - e.r);
        const db = Math.abs(b.c - e.c) + Math.abs(b.r - e.r);
        return da - db || rank(e.id, a.id) - rank(e.id, b.id);
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
    if (e.c !== originC || e.r !== originR) slide(s, e.id, originC, originR, e.c, e.r);
  }
}
function endTurn(s: GameState) {
  if (s.phase !== 'playing') return;
  s.note = '';
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
  s.note = '';
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
    s.flashes.push({ id: hit.id, t: 0 });
    sel.acted = true;
    s.selected = '';
    s.note = '';
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
      hurt(s, hit, sel.atk);
      sel.acted = true;
      s.selected = '';
      s.note = '';
      settle(s);
      maybeAuto(s);
    } else s.note = 'Rejected';
    return;
  }
  if (!hit) {
    if (!reach(s, sel).some(([cc, rr]) => cc === c && rr === r)) {
      s.note = 'Rejected';
      return;
    }
    const oc = sel.c;
    const or = sel.r;
    sel.c = c;
    sel.r = r;
    slide(s, sel.id, oc, or, c, r);
    sel.acted = true;
    s.selected = '';
    s.note = '';
    settle(s);
    maybeAuto(s);
  }
}
function App() {
  useFrame((frame) => {
    if (frame.deltaSeconds <= 0) return;
    commitChange('anim', (draft: GameState) => {
      draft.slides = draft.slides.map((s) => ({ ...s, t: s.t + 1 })).filter((s) => s.t < SLIDE_N);
      draft.flashes = draft.flashes.map((s) => ({ ...s, t: s.t + 1 })).filter((s) => s.t < FLASH_N);
      draft.fades = draft.fades.map((s) => ({ ...s, t: s.t + 1 })).filter((s) => s.t < FADE_N);
    });
  });

  const cells = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) cells.push({ c, r });
  }
  const selected = store.selected ? store.units.find((u) => u.id === store.selected && u.hp > 0 && !u.acted) : null;
  const reachCells = selected ? reach(store, selected) : [];
  const ended = store.phase === 'clear' || store.phase === 'fail';
  const place = store.map === 'ridge' ? 'Ridge' : 'Yard';
  const banner = store.phase === 'fail' ? 'Depot lost' : store.phase === 'clear' ? 'Depot clear' : store.note;

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#1c1610"
      onKeyDown={(event) => commitChange('key', (draft: GameState) => {
        if (draft.phase === 'clear' || draft.phase === 'fail') return;
        const code = event.code || event.detail?.code;
        if (code === 'Enter') begin(draft);
        else if (code === 'Space') endTurn(draft);
      })}
    >
      <text x={80} y={12} width={1120} height={52} text="Depot Skirmish" textColor="#f6e7c1" textSize={42} textAlign="center" />
      <text
        x={40}
        y={68}
        width={1200}
        height={36}
        text={`${place}   turn ${store.turn} / 8    ${store.units.map((u) => `${u.id} ${u.hp}`).join('   ')}`}
        textColor="#f6e7c1"
        textSize={22}
        textAlign="center"
      />
      {cells.map(({ c, r }) => {
        const lit = reachCells.some(([cc, rr]) => cc === c && rr === r);
        const rock = store.blocks.some(([bc, br]) => bc === c && br === r);
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
            <image x={0} y={0} width={CELL} height={CELL} source={rock ? rockUrl : c === 3 && r === 0 ? depotUrl : floorUrl} />
            {lit ? <node x={0} y={0} width={CELL} height={CELL} backgroundColor="#f0c14a" opacity={0.4} /> : null}
          </group>
        );
      })}
      {store.units.filter((u) => u.hp > 0).map((unit) => {
        const slide = store.slides.find((s) => s.id === unit.id);
        const k = slide ? Math.min(1, slide.t / SLIDE_N) : 1;
        const x = slide ? slide.x0 + (slide.x1 - slide.x0) * k : OX + unit.c * CELL;
        const y = slide ? slide.y0 + (slide.y1 - slide.y0) * k : OY + unit.r * CELL;
        const flash = store.flashes.some((s) => s.id === unit.id);
        return (
          <group key={`u-${unit.id}`}>
            {store.selected === unit.id ? <node x={x} y={y} width={CELL} height={CELL} backgroundColor="#f0c14a" opacity={0.45} /> : null}
            <image x={x + 8} y={y + 16} width={48} height={40} source={SPRITE[unit.id]} />
            {unit.side === 'ally' && unit.acted ? <node x={x + 8} y={y + 16} width={48} height={40} backgroundColor="#000000" opacity={0.45} /> : null}
            {unit.side === 'ally' ? (
              <node x={x + 50} y={y + 4} width={10} height={10} backgroundColor={unit.acted ? '#6d6458' : '#67d67a'} />
            ) : null}
            {flash ? <node x={x + 8} y={y + 16} width={48} height={40} backgroundColor="#fff3a0" opacity={0.55} /> : null}
            <text x={x + 2} y={y} width={40} height={16} text={String(unit.hp)} textColor="#fff6df" textSize={16} textAlign="left" />
          </group>
        );
      })}
      {store.fades.map((fade) => (
        <image
          key={`fade-${fade.id}`}
          x={fade.x + 8}
          y={fade.y + 16}
          width={48}
          height={40}
          source={SPRITE[fade.id]}
          opacity={Math.max(0, 1 - fade.t / FADE_N)}
        />
      ))}
      <text x={80} y={548} width={1120} height={56} text={banner} textColor="#f6d98a" textSize={40} textAlign="center" />
      <group x={60} y={620} width={240} height={70} clickable onClick={() => commitChange('end', (draft: GameState) => endTurn(draft))}>
        <node x={0} y={0} width={240} height={70} backgroundColor="#5c4030" />
        <text x={0} y={14} width={240} height={42} text="End" textColor="#f6e7c1" textSize={32} textAlign="center" />
      </group>
      <group x={440} y={620} width={400} height={70} clickable onClick={() => commitChange('start', (draft: GameState) => begin(draft))}>
        <node x={0} y={0} width={400} height={70} backgroundColor="#8a5a2a" />
        <text x={0} y={14} width={400} height={42} text="Start" textColor="#ffffff" textSize={32} textAlign="center" />
      </group>
      {ended ? (
        <group key="retry" x={900} y={620} width={280} height={70} clickable onClick={() => commitChange('retry', (draft: GameState) => reset(draft, draft.map))}>
          <node x={0} y={0} width={280} height={70} backgroundColor="#3d5c45" />
          <text x={0} y={14} width={280} height={42} text="Retry" textColor="#f6e7c1" textSize={32} textAlign="center" />
        </group>
      ) : null}
      {ended ? (
        <group key="ridge" x={1020} y={540} width={220} height={56} clickable onClick={() => commitChange('ridge', (draft: GameState) => reset(draft, 'ridge'))}>
          <node x={0} y={0} width={220} height={56} backgroundColor="#3a4a62" />
          <text x={0} y={8} width={220} height={40} text="Ridge" textColor="#f6e7c1" textSize={28} textAlign="center" />
        </group>
      ) : null}
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
