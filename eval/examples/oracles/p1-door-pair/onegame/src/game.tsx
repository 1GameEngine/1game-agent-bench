import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  left: boolean;
  right: boolean;
};

const { store, commitChange, bindStore } = createGameStore({ left: false, right: false } satisfies GameState);

function LeftBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={160}
      y={280}
      width={400}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('LeftBtn', (draft: GameState) => {
          draft.left = true;
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
      <text x={0} y={32} width={400} height={96} text="Left" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function RightBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={720}
      y={280}
      width={400}
      height={160}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('RightBtn', (draft: GameState) => {
          draft.right = true;
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
      <text x={0} y={32} width={400} height={96} text="Right" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={48} y={32} width={1184} height={96} text={`${store.left}/${store.right}`} textColor="#fff" textSize={64} />
      <LeftBtn />
      <RightBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
