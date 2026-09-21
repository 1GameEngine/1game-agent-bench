import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  useFrame,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  phase: 'ready' | 'countdown' | 'playing';
  remainMs: number;
  clockMs: number;
  hits: number;
  misses: number;
  score: number;
  resolved: [boolean, boolean, boolean];
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  remainMs: 0,
  clockMs: 0,
  hits: 0,
  misses: 0,
  score: 0,
  resolved: [false, false, false] as [boolean, boolean, boolean],
} satisfies GameState);

function beatAt(clock: number) {
  if (clock >= 0 && clock < 480) return 0;
  if (clock >= 800 && clock < 1280) return 1;
  if (clock >= 1600 && clock < 2080) return 2;
  return -1;
}

function StartBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={200}
      width={400}
      height={120}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('start', (d: GameState) => {
          if (d.phase !== 'ready') return;
          d.phase = 'countdown';
          d.remainMs = 3000;
        });
      }}
    >
      <node x={0} y={0} width={400} height={120} shape="roundedRect(28 28 28 28)" backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'} />
      <text x={0} y={24} width={400} height={72} text="Start" textAlign="center" textSize={48} textColor="#ffffff" />
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
      }
    });
  });
  const open = beatAt(store.clockMs);
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code !== 'Space') return;
        commitChange('hit', (d: GameState) => {
          if (d.phase !== 'playing') return;
          const idx = beatAt(d.clockMs);
          if (idx >= 0 && !d.resolved[idx]) {
            const resolved: [boolean, boolean, boolean] = [d.resolved[0], d.resolved[1], d.resolved[2]];
            resolved[idx] = true;
            d.resolved = resolved;
            d.hits += 1;
            d.score += 1;
          } else {
            d.misses += 1;
          }
        });
      }}
    >
      <text x={40} y={16} width={1200} height={64} text={`phase=${store.phase} remainMs=${store.remainMs} clockMs=${store.clockMs} hits=${store.hits} misses=${store.misses} score=${store.score}`} textColor="#fff" textSize={26} />
      <node x={200} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 0 || store.resolved[0] ? '#fbbf24' : '#1f2937'} />
      <node x={540} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 1 || store.resolved[1] ? '#fbbf24' : '#1f2937'} />
      <node x={880} y={520} width={200} height={120} shape="roundedRect(16 16 16 16)" backgroundColor={open === 2 || store.resolved[2] ? '#fbbf24' : '#334155'} />
      <StartBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
