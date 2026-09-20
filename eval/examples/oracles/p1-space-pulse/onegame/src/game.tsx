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
      width={320}
      height={180}
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
      <text x={12} y={8} width={296} height={24} text={`held=${store.held} pulses=${store.pulses}`} textColor="#fff" textSize={16} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
