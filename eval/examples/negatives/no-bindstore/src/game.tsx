import { createGameStore, renderGame } from '@1game/engine-bundle/runtime/worker';

const { store, commitChange } = createGameStore({
  phase: 'ready',
  score: 0,
});

function App() {
  return (
    <scene name="main" width={320} height={180} backgroundColor="#0f1224">
      <node
        x={0}
        y={0}
        width={320}
        height={180}
        clickable
        onClick={() => {
          commitChange('click', (draft) => {
            draft.score += 1;
          });
        }}
      />
      <text x={12} y={8} width={296} height={24} text={String(store.score)} textColor="#fff" textSize={16} />
    </scene>
  );
}

renderGame(() => <App />, {});
