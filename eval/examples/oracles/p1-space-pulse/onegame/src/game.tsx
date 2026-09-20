import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  held: boolean;
  pulses: number;
};

const { store, commitChange, bindStore } = createGameStore({ held: false, pulses: 0 } satisfies GameState);
function App() {
  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#0f1224"
      onKeyDown={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('down', (draft: GameState) => {
            draft.held = true;
          });
        }
      }}
      onKeyUp={(e) => {
        if (e.detail?.code === 'Space') {
          commitChange('up', (draft: GameState) => {
            draft.held = false;
            draft.pulses += 1;
          });
        }
      }}
    >
      <text x={48} y={32} width={1184} height={96} text={`held=${store.held} pulses=${store.pulses}`} textColor="#fff" textSize={64} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
