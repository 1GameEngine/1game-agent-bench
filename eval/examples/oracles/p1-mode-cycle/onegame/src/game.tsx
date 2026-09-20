import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  mode: 'stop' | 'walk' | 'run';
};

const { store, commitChange, bindStore } = createGameStore({ mode: 'stop' as 'stop' | 'walk' | 'run' } satisfies GameState);

function CycleBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={280}
      width={400}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('CycleBtn', (draft: GameState) => {
          draft.mode = draft.mode === 'stop' ? 'walk' : draft.mode === 'walk' ? 'run' : 'stop';
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={400}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={400} height={96} text="Cycle" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={store.mode} textColor="#fff" textSize={64} />
      <CycleBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
