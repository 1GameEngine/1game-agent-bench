import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  tab: 'red' | 'blue';
  count_red: number;
  count_blue: number;
};

const { store, commitChange, bindStore } = createGameStore({ tab: 'red' as 'red' | 'blue', count_red: 0, count_blue: 0 } satisfies GameState);

function RedBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={20}
      y={20}
      width={70}
      height={32}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('RedBtn', (draft: GameState) => {
          draft.tab = 'red';
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={70}
        height={32}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={70} height={24} text="Red" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function BlueBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={100}
      y={20}
      width={70}
      height={32}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('BlueBtn', (draft: GameState) => {
          draft.tab = 'blue';
        });
      }}
    >
      <node
        x={0}
        y={0}
        width={70}
        height={32}
        shape="roundedRect(8 8 8 8)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={8} width={70} height={24} text="Blue" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function ActBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={110}
      y={90}
      width={100}
      height={40}
      clickable
      virtualNodeRef={setNode}
      onClick={() => {
        commitChange('ActBtn', (draft: GameState) => {
          if (draft.tab === 'red') draft.count_red += 1; else draft.count_blue += 1;
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
      <text x={0} y={8} width={100} height={24} text="Act" textAlign="center" textSize={16} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <text x={180} y={20} width={120} height={24} text={`${store.tab} ${store.count_red}/${store.count_blue}`} textColor="#fff" textSize={14} />
      <RedBtn />
      <BlueBtn />
      <ActBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
