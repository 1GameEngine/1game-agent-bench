import {
  createGameStore,
  renderGame,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  x: number;
  marked: [boolean, boolean, boolean];
};

const { store, commitChange, bindStore } = createGameStore({
  x: 1,
  marked: [false, false, false] as [boolean, boolean, boolean],
} satisfies GameState);

function nudge(code: string) {
  commitChange('nudge', (draft: GameState) => {
    if (code === 'ArrowRight') draft.x = Math.min(2, draft.x + 1);
    if (code === 'ArrowLeft') draft.x = Math.max(0, draft.x - 1);
    if (code === 'Space') {
      const next: [boolean, boolean, boolean] = [draft.marked[0], draft.marked[1], draft.marked[2]];
      next[draft.x] = true;
      draft.marked = next;
    }
  });
}

function cellColor(i: number) {
  if (store.x === i) return store.marked[i] ? '#f59e0b' : '#1d4ed8';
  return store.marked[i] ? '#22c55e' : '#1f2937';
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={48} y={24} width={1184} height={80} text={`x=${store.x} marks=${store.marked[0] ? 1 : 0}${store.marked[1] ? 1 : 0}${store.marked[2] ? 1 : 0}`} textColor="#fff" textSize={40} />
      <node x={80} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(0)} />
      <node x={480} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(1)} />
      <node x={880} y={200} width={320} height={320} shape="roundedRect(24 24 24 24)" backgroundColor={cellColor(2)} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
