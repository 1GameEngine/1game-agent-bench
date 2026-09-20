import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  on: boolean;
};

const { store, commitChange, bindStore } = createGameStore({ on: false } satisfies GameState);

function ToggleBtn() {
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
        commitChange('ToggleBtn', (draft: GameState) => {
          draft.on = !draft.on;
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
      <text x={0} y={32} width={400} height={96} text="Toggle" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" >
      <text x={48} y={32} width={1184} height={96} text={store.on ? 'on' : 'off'} textColor="#fff" textSize={64} />
      <ToggleBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
