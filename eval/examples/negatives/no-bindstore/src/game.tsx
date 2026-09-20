import { createGameStore, renderGame } from '@1game/engine-bundle/runtime/worker';

const { store, commitChange } = createGameStore({
  phase: 'ready',
  score: 0,
});

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <node
        x={0}
        y={0}
        width={1280}
        height={720}
        clickable
        onClick={() => {
          commitChange('click', (draft) => {
            draft.score += 1;
          });
        }}
      />
      <text x={48} y={32} width={1184} height={96} text={String(store.score)} textColor="#fff" textSize={64} />
    </scene>
  );
}

renderGame(() => <App />, {});
