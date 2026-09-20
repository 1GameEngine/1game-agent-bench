import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  value: number;
};

const { store, commitChange, bindStore } = createGameStore({ value: 0 } satisfies GameState);

function PlusBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={720}
      y={280}
      width={320}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('PlusBtn', (draft: GameState) => {
          draft.value = Math.min(3, draft.value + 1);
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={320}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={320} height={96} text="Plus" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function MinusBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={240}
      y={280}
      width={320}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('MinusBtn', (draft: GameState) => {
          draft.value = Math.max(0, draft.value - 1);
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={320}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={320} height={96} text="Minus" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={String(store.value)} textColor="#fff" textSize={64} />
      <MinusBtn />
      <PlusBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
