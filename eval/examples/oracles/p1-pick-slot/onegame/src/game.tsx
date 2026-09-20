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
      x={80}
      y={280}
      width={320}
      height={160}
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
        width={320}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={320} height={96} text="A" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function BtnB() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={480}
      y={280}
      width={320}
      height={160}
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
        width={320}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={320} height={96} text="B" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function BtnC() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={880}
      y={280}
      width={320}
      height={160}
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
        width={320}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={320} height={96} text="C" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={store.slot} textColor="#fff" textSize={64} />
      <BtnA />
      <BtnB />
      <BtnC />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
