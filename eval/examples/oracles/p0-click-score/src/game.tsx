import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  phase: 'ready' | 'playing';
  score: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  score: 0,
} satisfies GameState);

function FullHit() {
  const [node, setNode] = createSignal<VirtualNode | undefined>();
  const hover = useNodeHover(node);
  const active = useNodeActive(node);
  return (
    <node
      x={0}
      y={0}
      width={320}
      height={180}
      clickable
      virtualNodeRef={setNode}
      backgroundColor={active() ? '#1d4ed8' : hover() ? '#1e3a8a' : '#0f1224'}
      onClick={() => {
        commitChange('click', (draft: GameState) => {
          if (draft.phase === 'ready') {
            draft.phase = 'playing';
            return;
          }
          draft.score += 1;
        });
      }}
    />
  );
}

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <FullHit />
      <text
        x={12}
        y={8}
        width={296}
        height={24}
        text={`phase=${store.phase} score=${store.score}`}
        textColor="#ffffff"
        textSize={16}
      />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
