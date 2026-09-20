import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  armed: boolean;
  shots: number;
};

const { store, commitChange, bindStore } = createGameStore({ armed: false, shots: 0 } satisfies GameState);

function ArmBtn() {
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
        commitChange('ArmBtn', (draft: GameState) => {
          draft.armed = true;
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
      <text x={0} y={32} width={360} height={96} text="Arm" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function FireBtn() {
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
        commitChange('FireBtn', (draft: GameState) => {
          if (draft.armed) { draft.shots += 1; draft.armed = false; }
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
      <text x={0} y={32} width={360} height={96} text="Fire" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={`armed=${store.armed} shots=${store.shots}`} textColor="#fff" textSize={64} />
      <ArmBtn />
      <FireBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
