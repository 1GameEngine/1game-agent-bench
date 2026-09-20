import { createSignal } from 'solid-js';
import {
  createGameStore,
  renderGame,
  useNodeActive,
  useNodeHover,
  type VirtualNode,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  x: number;
  y: number;
};

const { store, commitChange, bindStore } = createGameStore({ x: 1, y: 1 } satisfies GameState);
function nudge(code: string) {
  commitChange('nudge', (draft: GameState) => {
    if (code === 'ArrowRight') draft.x = Math.min(2, draft.x + 1);
    if (code === 'ArrowLeft') draft.x = Math.max(0, draft.x - 1);
    if (code === 'ArrowDown') draft.y = Math.min(2, draft.y + 1);
    if (code === 'ArrowUp') draft.y = Math.max(0, draft.y - 1);
  });
}
function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={12} y={8} width={296} height={24} text={`${store.x},${store.y}`} textColor="#fff" textSize={16} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
