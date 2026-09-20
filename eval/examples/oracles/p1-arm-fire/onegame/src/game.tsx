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
      x={50}
      y={70}
      width={90}
      height={40}
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
        width={90}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={90} height={24} text="Arm" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function FireBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={180}
      y={70}
      width={90}
      height={40}
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
        width={90}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={90} height={24} text="Fire" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text x={12} y={8} width={296} height={24} text={`armed=${store.armed} shots=${store.shots}`} textColor="#fff" textSize={16} />
      <ArmBtn />
      <FireBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
