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
      x={80}
      y={80}
      width={280}
      height={128}
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
        width={280}
        height={128}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={280} height={96} text="Red" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function BlueBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={400}
      y={80}
      width={280}
      height={128}
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
        width={280}
        height={128}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={280} height={96} text="Blue" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function ActBtn() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <group
      x={440}
      y={360}
      width={400}
      height={160}
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
        width={400}
        height={160}
        shape="roundedRect(32 32 32 32)"
        backgroundColor={active() ? '#1d4ed8' : hover() ? '#3b82f6' : '#2563eb'}
      />
      <text x={0} y={32} width={400} height={96} text="Act" textAlign="center" textSize={64} textColor="#ffffff" />
    </group>
  );
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text x={720} y={80} width={480} height={96} text={`${store.tab} ${store.count_red}/${store.count_blue}`} textColor="#fff" textSize={56} />
      <RedBtn />
      <BlueBtn />
      <ActBtn />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
