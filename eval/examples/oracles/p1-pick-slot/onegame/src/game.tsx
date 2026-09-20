import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  slot: 'A' | 'B' | 'C';
};

const { store, commitChange, bindStore } = createGameStore({ slot: 'A' as 'A' | 'B' | 'C' } satisfies GameState);

function BtnA() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={20}
      y={70}
      width={80}
      height={40}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BtnA', (draft: GameState) => {
          draft.slot = 'A';
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
      <text x={0} y={8} width={80} height={24} text="A" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function BtnB() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={120}
      y={70}
      width={80}
      height={40}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BtnB', (draft: GameState) => {
          draft.slot = 'B';
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
      <text x={0} y={8} width={80} height={24} text="B" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function BtnC() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={220}
      y={70}
      width={80}
      height={40}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BtnC', (draft: GameState) => {
          draft.slot = 'C';
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
      <text x={0} y={8} width={80} height={24} text="C" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text x={12} y={8} width={296} height={24} text={store.slot} textColor="#fff" textSize={16} />
      <BtnA />
      <BtnB />
      <BtnC />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
