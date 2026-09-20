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
  score: number;
  pulses: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  remainMs: 0,
  score: 0,
  pulses: 0,
} satisfies GameState);

function StartBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={200}
      width={400}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('start', (draft: GameState) => {
          if (draft.phase !== 'ready') return;
          draft.phase = 'countdown';
          draft.remainMs = 3000;
        });
      }}
    >
      <node x={0} y={0} width={400} height={160} shape="roundedRect(32 32 32 32)" backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'} />
      <text x={0} y={32} width={400} height={96} text="Start" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function PlayZone() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  return (
    <node
      x={0}
      y={480}
      width={1280}
      height={240}
      clickable
      virtualNodeRef={setNode}
      backgroundColor={store.phase === 'playing' ? '#14532d' : '#111827'}
      onClick={() => {
        commitChange('hit', (draft: GameState) => {
          if (draft.phase === 'playing') draft.score += 1;
        });
      }}
    />
  );
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (draft: GameState) => {
      if (draft.phase !== 'countdown') return;
      draft.remainMs = Math.max(0, draft.remainMs - Math.round(dt * 1000));
      if (draft.remainMs <= 0) {
        draft.remainMs = 0;
        draft.phase = 'playing';
      }
    });
  });
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('pulse', (draft: GameState) => {
            if (draft.phase === 'playing') draft.pulses += 1;
          });
        }
      }}
    >
      <PlayZone />
      <text x={48} y={24} width={1184} height={80} text={`phase=${store.phase} remainMs=${store.remainMs} score=${store.score} pulses=${store.pulses}`} textColor="#fff" textSize={36} />
      <StartBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
