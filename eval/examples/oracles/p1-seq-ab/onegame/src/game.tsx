import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  stage: number;
};

const { store, commitChange, bindStore } = createGameStore({ stage: 0 } satisfies GameState);

function BtnA() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={200}
      y={280}
      width={360}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BtnA', (draft: GameState) => {
          if (draft.stage === 0) draft.stage = 1;
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={360}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={360} height={96} text="A" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function BtnB() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={720}
      y={280}
      width={360}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BtnB', (draft: GameState) => {
          if (draft.stage === 1) draft.stage = 2;
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={360}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={360} height={96} text="B" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={String(store.stage)} textColor="#fff" textSize={64} />
      <BtnA />
      <BtnB />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
