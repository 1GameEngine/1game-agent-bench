import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  phase: 'ready' | 'playing';
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
} satisfies GameState);

function StartButton() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={110}
      y={70}
      width={100}
      height={40}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('start', (draft: GameState) => {
          draft.phase = 'playing';
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={100}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text
        x={0}
        y={8}
        width={100}
        height={24}
        text="Start"
        textAlign="center"
        textSize={18}
        textColor="#ffffff"
      />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text
        x={12}
        y={8}
        width={296}
        height={24}
        text={`phase=${store.phase}`}
        textColor="#ffffff"
        textSize={16}
      />
      <StartButton />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
