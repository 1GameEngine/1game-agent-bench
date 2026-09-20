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
      x={180}
      y={70}
      width={80}
      height={40}
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
        width={80}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={80} height={24} text="Plus" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function MinusBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={60}
      y={70}
      width={80}
      height={40}
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
        width={80}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={80} height={24} text="Minus" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text x={12} y={8} width={296} height={24} text={String(store.value)} textColor="#fff" textSize={16} />
      <MinusBtn />
      <PlusBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
