import { For, Show } from 'solid-js';
import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';

import depotImg from '../assets/depot.png';
import floorImg from '../assets/floor.png';
import rockImg from '../assets/rock.png';
import bruteImg from '../assets/brute.png';
import lurkerImg from '../assets/lurker.png';
import meleeImg from '../assets/melee.png';
import rangedImg from '../assets/ranged.png';
import shotImg from '../assets/shot.png';
import supportImg from '../assets/support.png';

import {
  COLS,
  DEPOT,
  MAPS,
  MAX_TURN,
  ROWS,
  applyAction,
  initialCore,
  reachable,
  type Action,
  type Core,
  type UnitCore,
  type VisEv,
} from './logic';

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const CELL = 64;
const BOARD_X = 384;
const BOARD_Y = 120;

const START_BTN = { x: 440, y: 620, w: 400, h: 70 };
const END_BTN = { x: 60, y: 620, w: 240, h: 70 };
const RETRY_BTN = { x: 900, y: 620, w: 280, h: 70 };
const RIDGE_BTN = { x: 1020, y: 540, w: 220, h: 56 };

const STEP_MS = 170;
const LUNGE_MS = 110;
const PROJ_MS = 230;
const GAP_MS = 110;
const VANISH_MS = 420;

const SPRITES: Record<string, any> = {
  melee: meleeImg,
  ranged: rangedImg,
  support: supportImg,
  brute: bruteImg,
  shot: shotImg,
  lurker: lurkerImg,
};

type Seg = { t0: number; t1: number; fx: number; fy: number; tx: number; ty: number };

type SUnit = UnitCore & { segs: Seg[]; busy: number; v0: number; v1: number };

type Fx = {
  id: number;
  kind: 'flash' | 'proj' | 'num';
  c: number;
  r: number;
  tc: number;
  tr: number;
  t0: number;
  t1: number;
  text: string;
  color: string;
};

type GameState = Omit<Core, 'units'> & {
  units: SUnit[];
  clock: number;
  fx: Fx[];
  fxSeq: number;
  pendingKeys: string[];
  pendingActs: Action[];
};

function decorate(core: Core): GameState {
  return {
    ...core,
    units: core.units.map((u) => ({ ...u, segs: [], busy: 0, v0: 0, v1: 0 })),
    clock: 0,
    fx: [],
    fxSeq: 0,
    pendingKeys: [],
    pendingActs: [],
  };
}

const { store, commitChange, bindStore } = createGameStore<GameState>(decorate(initialCore(0)));

function dispPos(u: SUnit, clock: number): { x: number; y: number } {
  const segs = u.segs;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (clock < s.t0) return { x: s.fx, y: s.fy };
    if (clock < s.t1) {
      const k = (clock - s.t0) / (s.t1 - s.t0);
      return { x: s.fx + (s.tx - s.fx) * k, y: s.fy + (s.ty - s.fy) * k };
    }
  }
  return { x: u.col, y: u.row };
}

function pushFx(d: GameState, fx: Omit<Fx, 'id'>): void {
  d.fxSeq += 1;
  d.fx.push({ id: d.fxSeq, ...fx });
}

function schedule(d: GameState, evs: VisEv[]): void {
  if (evs.length === 0) return;
  const now = d.clock;
  const U = (n: string) => d.units.find((u) => u.name === n) as SUnit;
  let cursor = now;
  for (const u of d.units) cursor = Math.max(cursor, u.busy);
  for (const ev of evs) {
    const att = U(ev.name);
    let start: number;
    if (ev.ph === 'e') {
      start = cursor;
    } else {
      start = Math.max(now, att.busy);
      if (ev.k !== 'move') start = Math.max(start, U(ev.target).busy);
    }
    let end = start;
    if (ev.k === 'move') {
      let t = start;
      let p = ev.from;
      for (const q of ev.path) {
        att.segs.push({ t0: t, t1: t + STEP_MS, fx: p[0], fy: p[1], tx: q[0], ty: q[1] });
        t += STEP_MS;
        p = q;
      }
      end = t;
    } else if (ev.k === 'attack') {
      const tgt = U(ev.target);
      let hitT: number;
      if (ev.range <= 1) {
        const dx = Math.sign(ev.to[0] - ev.from[0]) * 0.45;
        const dy = Math.sign(ev.to[1] - ev.from[1]) * 0.45;
        att.segs.push({
          t0: start,
          t1: start + LUNGE_MS,
          fx: ev.from[0],
          fy: ev.from[1],
          tx: ev.from[0] + dx,
          ty: ev.from[1] + dy,
        });
        att.segs.push({
          t0: start + LUNGE_MS,
          t1: start + 2 * LUNGE_MS,
          fx: ev.from[0] + dx,
          fy: ev.from[1] + dy,
          tx: ev.from[0],
          ty: ev.from[1],
        });
        hitT = start + LUNGE_MS;
        end = start + 2 * LUNGE_MS;
      } else {
        pushFx(d, {
          kind: 'proj',
          c: ev.from[0],
          r: ev.from[1],
          tc: ev.to[0],
          tr: ev.to[1],
          t0: start,
          t1: start + PROJ_MS,
          text: '',
          color: ev.ph === 'f' ? '125,211,252' : '253,186,116',
        });
        hitT = start + PROJ_MS;
        end = hitT + 60;
      }
      pushFx(d, { kind: 'flash', c: ev.to[0], r: ev.to[1], tc: 0, tr: 0, t0: hitT, t1: hitT + 260, text: '', color: '255,60,60' });
      pushFx(d, {
        kind: 'num',
        c: ev.to[0],
        r: ev.to[1],
        tc: 0,
        tr: 0,
        t0: hitT,
        t1: hitT + 650,
        text: `-${ev.dmg}`,
        color: '#fecaca',
      });
      let tgtEnd = hitT + 260;
      if (ev.killed) {
        tgt.v0 = hitT;
        tgt.v1 = hitT + VANISH_MS;
        tgtEnd = tgt.v1;
        end = Math.max(end, tgtEnd - 120);
      }
      tgt.busy = Math.max(tgt.busy, tgtEnd);
    } else {
      const tgt = U(ev.target);
      const hitT = start + 160;
      pushFx(d, { kind: 'flash', c: ev.to[0], r: ev.to[1], tc: 0, tr: 0, t0: hitT, t1: hitT + 300, text: '', color: '74,222,128' });
      pushFx(d, {
        kind: 'num',
        c: ev.to[0],
        r: ev.to[1],
        tc: 0,
        tr: 0,
        t0: hitT,
        t1: hitT + 650,
        text: `+${ev.amount}`,
        color: '#bbf7d0',
      });
      end = hitT + 200;
      tgt.busy = Math.max(tgt.busy, hitT + 300);
    }
    att.busy = Math.max(att.busy, end);
    if (ev.ph === 'e') cursor = end + GAP_MS;
  }
}

function resetVisuals(d: GameState): void {
  d.fx = [];
  d.units = d.units.map((u) => ({ ...u, segs: [], busy: 0, v0: 0, v1: 0 }));
}

function runAction(d: GameState, act: Action): void {
  const before = d.phase;
  const evs: VisEv[] = [];
  applyAction(d as unknown as Core, act, evs);
  if ((act.t === 'retry' || act.t === 'ridge') && before !== d.phase) resetVisuals(d);
  schedule(d, evs);
}

const KEY_PRIORITY = ['Enter', 'Space'];

function processInput(d: GameState): void {
  const keys = d.pendingKeys;
  const acts = d.pendingActs;
  let handled = false;
  for (const code of KEY_PRIORITY) {
    if (keys.includes(code)) {
      handled = true;
      if (code === 'Enter') runAction(d, { t: 'start' });
      else runAction(d, { t: 'end' });
      break;
    }
  }
  if (!handled && acts.length > 0) runAction(d, acts[0]);
  d.pendingKeys = [];
  d.pendingActs = [];
}

function tick(d: GameState, dtMs: number): void {
  d.clock += dtMs;
  processInput(d);
  const clock = d.clock;
  if (d.fx.length && d.fx.some((f) => f.t1 < clock)) d.fx = d.fx.filter((f) => f.t1 >= clock);
  for (const u of d.units) {
    if (u.segs.length && u.segs[u.segs.length - 1].t1 < clock) u.segs = [];
  }
}

function queueAct(act: Action): void {
  commitChange('input:click', (d: GameState) => {
    d.pendingActs.push(act);
  });
}

function queueKey(code: string): void {
  if (code !== 'Enter' && code !== 'Space') return;
  commitChange('input:key', (d: GameState) => {
    d.pendingKeys.push(code);
  });
}

function cellX(col: number): number {
  return BOARD_X + col * CELL;
}
function cellY(row: number): number {
  return BOARD_Y + row * CELL;
}

function unitsLine(): string {
  return store.units.map((u) => `${u.name} ${u.hp}`).join('   ');
}

function statusLine(): string {
  if (store.rejected) return 'Rejected';
  if (store.phase === 'title') return 'Press Enter or click the green button to begin';
  if (store.phase === 'play') {
    const sel = store.units.find((u) => u.name === store.selected && u.alive);
    if (sel) return `Selected: ${sel.name}`;
    return 'Pick an ally';
  }
  return '';
}

function reachCells(): { key: string; c: number; r: number }[] {
  if (store.phase !== 'play' || !store.selected) return [];
  const sel = store.units.find((u) => u.name === store.selected && u.alive && !u.acted);
  if (!sel) return [];
  return reachable(store as unknown as Core, sel).map(([c, r]) => ({ key: `${c},${r}`, c, r }));
}

const CELLS: { key: string; c: number; r: number }[] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) CELLS.push({ key: `${c},${r}`, c, r });

function Btn(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  size: number;
  onPress: () => void;
  k: string;
}) {
  return (
    <group key={props.k} x={props.x} y={props.y} width={props.w} height={props.h} clickable onClick={props.onPress}>
      <node x={0} y={0} width={props.w} height={props.h} shape="roundedRect(12 12 12 12)" backgroundColor={props.color} />
      <text
        x={0}
        y={(props.h - props.size) / 2 - 3}
        width={props.w}
        height={props.size + 10}
        text={props.label}
        textAlign="center"
        textSize={String(props.size)}
        textColor="#ffffff"
      />
    </group>
  );
}

function Game() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (d: GameState) => tick(d, dt * 1000));
  });

  const ended = () => store.phase === 'clear' || store.phase === 'lost';

  return (
    <scene
      name="main"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      backgroundColor="#0f172a"
      onKeyDown={(event) => {
        const code = event.detail?.code;
        if (code) queueKey(code);
      }}
    >
      <text x={0} y={12} width={SCENE_WIDTH} height={54} text="Depot Skirmish" textAlign="center" textSize="44" textColor="#f8fafc" />
      <text x={BOARD_X} y={78} width={260} height={30} text={`Map: ${MAPS[store.mapIdx].name}`} textAlign="left" textSize="26" textColor="#fde68a" />
      <text
        x={BOARD_X + 252}
        y={78}
        width={260}
        height={30}
        text={`turn ${store.turn} / ${MAX_TURN}`}
        textAlign="right"
        textSize="26"
        textColor="#e2e8f0"
      />

      <node x={BOARD_X - 6} y={BOARD_Y - 6} width={COLS * CELL + 12} height={ROWS * CELL + 12} shape="roundedRect(6 6 6 6)" backgroundColor="#334155" />

      <For each={CELLS}>
        {(cell) => (
          <image
            key={`tile-${cell.key}`}
            source={cell.c === DEPOT.col && cell.r === DEPOT.row ? depotImg : floorImg}
            x={cellX(cell.c)}
            y={cellY(cell.r)}
            width={CELL}
            height={CELL}
            imageFit="default"
          />
        )}
      </For>

      <For each={MAPS[store.mapIdx].obstacles.map(([c, r]) => ({ key: `${c},${r}`, c, r }))}>
        {(o) => (
          <group key={`rock-${o.key}`} x={cellX(o.c)} y={cellY(o.r)} width={CELL} height={CELL}>
            <node
              x={3}
              y={3}
              width={CELL - 6}
              height={CELL - 6}
              shape="roundedRect(10 10 10 10)"
              backgroundColor="#1e293b"
              border="line"
              borderWidth={3}
              borderColor="#94a3b8"
            />
            <image source={rockImg} x={0} y={0} width={CELL} height={CELL} imageFit="default" />
          </group>
        )}
      </For>

      <For each={reachCells()}>
        {(cell) => (
          <node
            key={`reach-${cell.key}`}
            x={cellX(cell.c) + 2}
            y={cellY(cell.r) + 2}
            width={CELL - 4}
            height={CELL - 4}
            backgroundColor="rgba(250,204,21,0.45)"
            border="line" borderWidth={3}
            borderColor="#facc15"
          />
        )}
      </For>

      <For each={store.units}>
        {(u) => (
          <Show when={u.alive || u.v1 > store.clock}>
            <group
              key={`unit-${u.name}`}
              x={cellX(dispPos(u, store.clock).x)}
              y={cellY(dispPos(u, store.clock).y)}
              width={CELL}
              height={CELL}
              overflowVisible
            >
              <group
                x={0}
                y={0}
                width={CELL}
                height={CELL}
                transformRender={
                  !u.alive && store.clock >= u.v0
                    ? {
                        scaleX: Math.max(0.02, 1 - (store.clock - u.v0) / (u.v1 - u.v0)),
                        scaleY: Math.max(0.02, 1 - (store.clock - u.v0) / (u.v1 - u.v0)),
                      }
                    : undefined
                }
              >
                <node
                  x={2}
                  y={2}
                  width={CELL - 4}
                  height={CELL - 4}
                  shape="roundedRect(8 8 8 8)"
                  backgroundColor={u.side === 'f' ? 'rgba(37,99,235,0.45)' : 'rgba(220,38,38,0.45)'}
                  border="line" borderWidth={2}
                  borderColor={u.side === 'f' ? '#60a5fa' : '#f87171'}
                />
                <image source={SPRITES[u.name]} x={8} y={4} width={48} height={48} imageFit="contain" />
                <Show when={u.alive && u.side === 'f' && u.acted}>
                  <node x={2} y={2} width={CELL - 4} height={CELL - 4} shape="roundedRect(8 8 8 8)" backgroundColor="rgba(2,6,23,0.55)" />
                </Show>
                <node x={2} y={46} width={CELL - 4} height={16} backgroundColor="rgba(2,6,23,0.85)" />
                <text x={4} y={48} width={44} height={14} text={u.name} textAlign="left" textSize="10" textColor="#cbd5e1" />
                <Show when={u.alive}>
                  <text x={34} y={46} width={28} height={16} text={`${u.hp}`} textAlign="right" textSize="15" textColor="#fef08a" />
                  <Show when={u.side === 'f'}>
                    <node
                      x={3}
                      y={3}
                      width={u.acted ? 34 : 38}
                      height={14}
                      shape="roundedRect(4 4 4 4)"
                      backgroundColor={u.acted ? 'rgba(127,29,29,0.95)' : 'rgba(21,128,61,0.95)'}
                    />
                    <text
                      x={3}
                      y={3}
                      width={u.acted ? 34 : 38}
                      height={14}
                      text={u.acted ? 'done' : 'ready'}
                      textAlign="center"
                      textSize="11"
                      textColor="#ffffff"
                    />
                  </Show>
                </Show>
              </group>
              <Show when={u.alive && store.selected === u.name}>
                <node x={-1} y={-1} width={CELL + 2} height={CELL + 2} shape="roundedRect(8 8 8 8)" border="line" borderWidth={4} borderColor="#fde047" />
              </Show>
            </group>
          </Show>
        )}
      </For>

      <For each={store.fx}>
        {(f) => (
          <group key={`fx-${f.id}`} x={0} y={0} width={SCENE_WIDTH} height={SCENE_HEIGHT} overflowVisible>
            <Show when={f.kind === 'flash' && store.clock >= f.t0 && store.clock <= f.t1}>
              <node
                x={cellX(f.c)}
                y={cellY(f.r)}
                width={CELL}
                height={CELL}
                backgroundColor={`rgba(${f.color},${(0.6 * (1 - (store.clock - f.t0) / (f.t1 - f.t0))).toFixed(3)})`}
              />
            </Show>
            <Show when={f.kind === 'proj' && store.clock >= f.t0 && store.clock <= f.t1}>
              <node
                x={cellX(f.c + (f.tc - f.c) * ((store.clock - f.t0) / (f.t1 - f.t0))) + CELL / 2 - 8}
                y={cellY(f.r + (f.tr - f.r) * ((store.clock - f.t0) / (f.t1 - f.t0))) + CELL / 2 - 8}
                width={16}
                height={16}
                shape="circular"
                backgroundColor={`rgb(${f.color})`}
                border="line" borderWidth={2}
                borderColor="#ffffff"
              />
            </Show>
            <Show when={f.kind === 'num' && store.clock >= f.t0 && store.clock <= f.t1}>
              <text
                x={cellX(f.c)}
                y={cellY(f.r) + 14 - 30 * ((store.clock - f.t0) / (f.t1 - f.t0))}
                width={CELL}
                height={30}
                text={f.text}
                textAlign="center"
                textSize="26"
                textColor={f.color}
              />
            </Show>
          </group>
        )}
      </For>

      <For each={CELLS}>
        {(cell) => (
          <group
            key={`hit-${cell.key}`}
            x={cellX(cell.c)}
            y={cellY(cell.r)}
            width={CELL}
            height={CELL}
            clickable
            onClick={() => queueAct({ t: 'cell', col: cell.c, row: cell.r })}
          />
        )}
      </For>

      <text x={140} y={516} width={1000} height={24} text={unitsLine()} textAlign="center" textSize="24" textColor="#e2e8f0" />
      <text
        x={340}
        y={554}
        width={600}
        height={30}
        text={statusLine()}
        textAlign="center"
        textSize="24"
        textColor={store.rejected ? '#f87171' : '#94a3b8'}
      />

      <Show when={store.phase === 'clear'}>
        <text x={14} y={250} width={356} height={56} text="Depot clear" textAlign="center" textSize="42" textColor="#4ade80" />
      </Show>
      <Show when={store.phase === 'lost'}>
        <text x={14} y={250} width={356} height={56} text="Depot lost" textAlign="center" textSize="42" textColor="#f87171" />
      </Show>

      <text x={14} y={140} width={356} height={24} text="Blue frame: your squad" textAlign="center" textSize="18" textColor="#93c5fd" />
      <text x={14} y={168} width={356} height={24} text="Red frame: hostile squad" textAlign="center" textSize="18" textColor="#fca5a5" />
      <text x={14} y={196} width={356} height={24} text="Hold the crate tile or defeat all hostiles" textAlign="center" textSize="16" textColor="#94a3b8" />

      <Btn
        k="btn-start"
        x={START_BTN.x}
        y={START_BTN.y}
        w={START_BTN.w}
        h={START_BTN.h}
        label="Start"
        size={34}
        color={store.phase === 'title' ? '#16a34a' : '#334155'}
        onPress={() => queueAct({ t: 'start' })}
      />
      <Btn
        k="btn-end"
        x={END_BTN.x}
        y={END_BTN.y}
        w={END_BTN.w}
        h={END_BTN.h}
        label="End"
        size={34}
        color={store.phase === 'play' ? '#b45309' : '#334155'}
        onPress={() => queueAct({ t: 'end' })}
      />
      <Show when={ended()}>
        <Btn
          k="btn-retry"
          x={RETRY_BTN.x}
          y={RETRY_BTN.y}
          w={RETRY_BTN.w}
          h={RETRY_BTN.h}
          label="Retry"
          size={34}
          color="#2563eb"
          onPress={() => queueAct({ t: 'retry' })}
        />
        <Btn
          k="btn-ridge"
          x={RIDGE_BTN.x}
          y={RIDGE_BTN.y}
          w={RIDGE_BTN.w}
          h={RIDGE_BTN.h}
          label="Ridge"
          size={30}
          color="#7c3aed"
          onPress={() => queueAct({ t: 'ridge' })}
        />
      </Show>
    </scene>
  );
}

renderGame(() => <Game />, { bindStore });
