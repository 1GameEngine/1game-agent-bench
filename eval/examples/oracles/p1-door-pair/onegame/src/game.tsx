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
      x={40}
      y={70}
      width={100}
      height={40}
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
        width={100}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={100} height={24} text="Left" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function RightBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={180}
      y={70}
      width={100}
      height={40}
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
        width={100}
        height={40}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={100} height={24} text="Right" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text x={12} y={8} width={296} height={24} text={`${store.left}/${store.right}`} textColor="#fff" textSize={16} />
      <LeftBtn />
      <RightBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
