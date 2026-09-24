import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';

type GameState = {
  phase: 'countdown' | 'playing';
  remainMs: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'countdown',
  remainMs: 3000,
} satisfies GameState);

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (draft: GameState) => {
      if (draft.phase !== 'countdown') return;
      draft.remainMs = Math.max(0, draft.remainMs - Math.round(dt * 1000));
      if (draft.remainMs <= 0) {
        draft.remainMs = 0;
        draft.phase = 'playing';
      }
    });
  });

  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <text
        x={48}
        y={32}
        width={1184}
        height={96}
        text={`phase=${store.phase} remainMs=${store.remainMs}`}
        textColor="#ffffff"
        textSize={64}
      />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
