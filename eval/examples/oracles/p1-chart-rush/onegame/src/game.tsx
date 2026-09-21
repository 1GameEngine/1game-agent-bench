import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  useFrame,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type Phase = 'ready' | 'countdown' | 'playing' | 'fail' | 'clear';

type GameState = {
  phase: Phase;
  remainMs: number;
  clockMs: number;
  hits: number;
  misses: number;
  cursor: number;
};

const LANES = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'];
const NOTES = Array.from({ length: 16 }, (_, i) => ({ lane: i % 4, t: 400 * (i + 1) }));
const WINDOW = 132;

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready' as Phase,
  remainMs: 0,
  clockMs: 0,
  hits: 0,
  misses: 0,
  cursor: 0,
} satisfies GameState);

function start(d: GameState) {
  if (d.phase !== 'ready') return;
  d.phase = 'countdown';
  d.remainMs = 3000;
}

function Btn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group x={440} y={200} width={400} height={120} clickable virtualNodeRef={setNode} onClick={() => commitChange('start', start)}>
      <node x={0} y={0} width={400} height={120} shape="roundedRect(28 28 28 28)" backgroundColor={active() ? '#6d28d9' : hover() ? '#7c3aed' : '#5b21b6'} />
      <text x={0} y={24} width={400} height={72} text="Start" textAlign="center" textSize={48} textColor="#f5f3ff" />
    </group>
  );
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (d: GameState) => {
      const step = Math.round(dt * 1000);
      if (d.phase === 'countdown') {
        d.remainMs = Math.max(0, d.remainMs - step);
        if (d.remainMs <= 0) {
          d.remainMs = 0;
          d.phase = 'playing';
          d.clockMs = 0;
        }
      } else if (d.phase === 'playing') {
        d.clockMs += step;
        while (d.cursor < NOTES.length && d.clockMs > NOTES[d.cursor].t + WINDOW) {
          d.misses += 1;
          d.cursor += 1;
        }
        if (d.misses >= 6) d.phase = 'fail';
        else if (d.cursor >= NOTES.length) d.phase = d.hits >= 12 ? 'clear' : 'fail';
      }
    });
  });

  const upcoming = NOTES.map((n, i) => {
    if (store.phase !== 'playing' || i < store.cursor) return null;
    const y = 520 - Math.max(0, (n.t - store.clockMs) * 0.12);
    if (y < 140) return null;
    return (
      <node
        key={`n${i}`}
        x={80 + n.lane * 300 + 40}
        y={y}
        width={160}
        height={36}
        shape="roundedRect(12 12 12 12)"
        backgroundColor={['#fb7185', '#38bdf8', '#a3e635', '#fbbf24'][n.lane]}
      />
    );
  });

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#1e1b4b"
      onKeyDown={(e) => {
        const code = e.detail?.code;
        commitChange('hit', (d: GameState) => {
          if (code === 'Enter') start(d);
          if (d.phase !== 'playing') return;
          const lane = LANES.indexOf(code);
          if (lane < 0) return;
          const n = NOTES[d.cursor];
          if (!n) return;
          if (lane === n.lane && Math.abs(d.clockMs - n.t) <= WINDOW) {
            d.hits += 1;
            d.cursor += 1;
            if (d.cursor >= NOTES.length) d.phase = d.hits >= 12 ? 'clear' : 'fail';
          } else {
            d.misses += 1;
            if (d.misses >= 6) d.phase = 'fail';
          }
        });
      }}
    >
      <text x={40} y={16} width={1200} height={56} text="Chart Rush" textColor="#ede9fe" textSize={40} />
      <text
        x={40}
        y={72}
        width={1200}
        height={40}
        text={`phase=${store.phase} remainMs=${store.remainMs} clockMs=${store.clockMs} hits=${store.hits} misses=${store.misses} note=${store.cursor}`}
        textColor="#ddd6fe"
        textSize={22}
      />
      {LANES.map((name, i) => (
        <node key={name} x={80 + i * 300} y={560} width={240} height={120} shape="roundedRect(16 16 16 16)" backgroundColor="#312e81" />
      ))}
      {LANES.map((name, i) => (
        <text key={`${name}l`} x={80 + i * 300} y={592} width={240} height={56} text={name.replace('Arrow', '')} textAlign="center" textSize={28} textColor="#c4b5fd" />
      ))}
      {upcoming}
      {store.phase === 'ready' ? <Btn /> : null}
      {store.phase === 'fail' ? (
        <text x={40} y={160} width={1200} height={64} text="Chart miss" textAlign="center" textSize={44} textColor="#fecaca" />
      ) : null}
      {store.phase === 'clear' ? (
        <text x={40} y={160} width={1200} height={64} text="Chart clear" textAlign="center" textSize={44} textColor="#bbf7d0" />
      ) : null}
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
