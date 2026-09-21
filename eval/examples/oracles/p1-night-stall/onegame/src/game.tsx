import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  useFrame,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type Phase = 'title' | 'open' | 'fail' | 'clear';

type GameState = {
  phase: Phase;
  clockMs: number;
  station: 0 | 1 | 2;
  cooking: number;
  cookStation: 0 | 1 | 2;
  cooked: number;
  served: number;
  coins: number;
  upgrade: 0 | 1;
  waiting: number;
  spawned: number;
};

const GUEST_AT = [2000, 5000, 8000, 11000];
const WANT = [0, 1, 2, 0];
const COOK = [330, 660, 330];
const PATIENCE = 2700;
const CLOSE_AT = 15000;
const NAMES = ['Bun', 'Noodle', 'Tea'];

const { store, commitChange, bindStore } = createGameStore({
  phase: 'title' as Phase,
  clockMs: 0,
  station: 0 as 0 | 1 | 2,
  cooking: 0,
  cookStation: 0 as 0 | 1 | 2,
  cooked: -1,
  served: 0,
  coins: 0,
  upgrade: 0 as 0 | 1,
  waiting: -1,
  spawned: 0,
} satisfies GameState);

function cookMs(station: number, upgrade: number) {
  const raw = COOK[station] ?? 330;
  return upgrade ? Math.floor(raw / 2) : raw;
}

function Btn(props: { x: number; y: number; w: number; h: number; label: string; onPress: () => void; lit?: boolean }) {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  const bg = () => (props.lit ? '#f59e0b' : active() ? '#9f1239' : hover() ? '#be123c' : '#881337');
  return (
    <group key={props.label} x={props.x} y={props.y} width={props.w} height={props.h} clickable virtualNodeRef={setNode} onClick={props.onPress}>
      <node x={0} y={0} width={props.w} height={props.h} shape="roundedRect(20 20 20 20)" backgroundColor={bg()} />
      <text x={0} y={24} width={props.w} height={56} text={props.label} textAlign="center" textSize={36} textColor="#fff7ed" />
    </group>
  );
}

function openStall(d: GameState) {
  if (d.phase !== 'title') return;
  d.phase = 'open';
  d.clockMs = 0;
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (d: GameState) => {
      const step = Math.round(dt * 1000);
      if (d.phase !== 'open') return;
      d.clockMs += step;
      if (d.cooking > 0) {
        d.cooking = Math.max(0, d.cooking - step);
        if (d.cooking === 0) d.cooked = d.cookStation;
      }
      while (d.spawned < GUEST_AT.length && d.clockMs >= GUEST_AT[d.spawned]) {
        if (d.waiting < 0) d.waiting = d.spawned;
        d.spawned += 1;
      }
      if (d.waiting >= 0 && d.clockMs - GUEST_AT[d.waiting] > PATIENCE) {
        d.phase = 'fail';
        return;
      }
      if (d.clockMs >= CLOSE_AT) {
        d.phase = d.served >= 3 ? 'clear' : 'fail';
      }
    });
  });

  const want = store.waiting >= 0 ? NAMES[WANT[store.waiting]] : 'none';
  const dish = store.cooked >= 0 ? NAMES[store.cooked] : 'empty';

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#1c0b12"
      onKeyDown={(e) => {
        const code = e.detail?.code;
        commitChange('key', (d: GameState) => {
          if (code === 'Enter') openStall(d);
          if (d.phase !== 'open') return;
          if (code === 'ArrowLeft') d.station = Math.max(0, d.station - 1) as 0 | 1 | 2;
          if (code === 'ArrowRight') d.station = Math.min(2, d.station + 1) as 0 | 1 | 2;
          if (code === 'ArrowUp' && d.coins >= 1 && d.upgrade === 0) {
            d.coins -= 1;
            d.upgrade = 1;
          }
          if (code !== 'Space') return;
          if (d.cooking > 0) return;
          if (d.cooked >= 0) {
            if (d.waiting >= 0 && WANT[d.waiting] === d.cooked) {
              d.served += 1;
              d.coins += 1;
              d.cooked = -1;
              d.waiting += 1;
              if (d.waiting >= d.spawned) d.waiting = -1;
            } else if (d.waiting >= 0) {
              d.phase = 'fail';
            } else {
              d.cooked = -1;
            }
            return;
          }
          d.cookStation = d.station;
          d.cooking = cookMs(d.station, d.upgrade);
        });
      }}
    >
      <text x={40} y={16} width={1200} height={56} text="Night Stall" textColor="#fecdd3" textSize={40} />
      <text
        x={40}
        y={72}
        width={1200}
        height={48}
        text={`phase=${store.phase} clockMs=${store.clockMs} station=${NAMES[store.station]} cooked=${dish} served=${store.served} coins=${store.coins} upgrade=${store.upgrade} want=${want}`}
        textColor="#ffe4e6"
        textSize={22}
      />
      <node x={80} y={160} width={280} height={220} shape="roundedRect(24 24 24 24)" backgroundColor={store.station === 0 ? '#fb7185' : '#4c0519'} />
      <text x={80} y={230} width={280} height={80} text="Bun" textAlign="center" textSize={40} textColor="#fff1f2" />
      <node x={500} y={160} width={280} height={220} shape="roundedRect(24 24 24 24)" backgroundColor={store.station === 1 ? '#fbbf24' : '#4c0519'} />
      <text x={500} y={230} width={280} height={80} text="Noodle" textAlign="center" textSize={40} textColor="#fff7ed" />
      <node x={920} y={160} width={280} height={220} shape="roundedRect(24 24 24 24)" backgroundColor={store.station === 2 ? '#38bdf8' : '#4c0519'} />
      <text x={920} y={230} width={280} height={80} text="Tea" textAlign="center" textSize={40} textColor="#e0f2fe" />
      <node x={80} y={420} width={360} height={120} shape="roundedRect(20 20 20 20)" backgroundColor={store.waiting >= 0 ? '#e11d48' : '#3f3f46'} />
      <text x={80} y={450} width={360} height={64} text={store.waiting >= 0 ? `Guest ${want}` : 'Queue empty'} textAlign="center" textSize={32} textColor="#fff" />
      <node x={480} y={420} width={280} height={120} shape="roundedRect(20 20 20 20)" backgroundColor={store.upgrade ? '#a3e635' : '#44403c'} />
      <text x={480} y={450} width={280} height={64} text="Upgrade" textAlign="center" textSize={32} textColor="#fff" />
      {store.phase === 'title' ? <Btn x={840} y={430} w={360} h={120} label="Start" onPress={() => commitChange('start', openStall)} /> : null}
      {store.phase === 'fail' ? (
        <text x={40} y={580} width={1200} height={80} text="Closed early" textAlign="center" textSize={48} textColor="#fecaca" />
      ) : null}
      {store.phase === 'clear' ? (
        <text x={40} y={580} width={1200} height={80} text="Night clear" textAlign="center" textSize={48} textColor="#bbf7d0" />
      ) : null}
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
