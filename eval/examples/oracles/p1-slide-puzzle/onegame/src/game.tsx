import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';

const START = [1, 5, 2, 4, 0, 6, 7, 3, 8];
const GOAL = [1, 2, 3, 4, 5, 6, 7, 8, 0];
const LIMIT = 14;
const COLORS = ['#e85d4c', '#f4a261', '#e9c46a', '#2a9d8f', '#457b9d', '#5e60ce', '#9b5de5', '#f15bb5'];

type Phase = 'ready' | 'playing' | 'fail' | 'clear';
type GameState = {
  phase: Phase;
  moves: number;
  resets: number;
  board: number[];
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  moves: 0,
  resets: 0,
  board: START.slice(),
} satisfies GameState);

function ended(draft: GameState) {
  return draft.phase === 'clear' || draft.phase === 'fail';
}

function settle(draft: GameState) {
  if (draft.board.join() === GOAL.join()) draft.phase = 'clear';
  else if (draft.moves >= LIMIT) draft.phase = 'fail';
}

function slide(draft: GameState, key: string) {
  if (draft.phase !== 'playing') return;
  const z = draft.board.indexOf(0);
  const delta = key === 'ArrowLeft' ? 1 : key === 'ArrowRight' ? -1 : key === 'ArrowUp' ? 3 : key === 'ArrowDown' ? -3 : 0;
  if (!delta) return;
  const t = z + delta;
  if (t < 0 || t > 8) return;
  if (Math.abs(delta) === 1 && Math.floor(t / 3) !== Math.floor(z / 3)) return;
  const next = draft.board.slice();
  next[z] = next[t];
  next[t] = 0;
  draft.board = next;
  draft.moves += 1;
  settle(draft);
}

function reset(draft: GameState) {
  if (draft.phase !== 'playing') return;
  draft.board = START.slice();
  draft.resets += 1;
}

function begin(draft: GameState) {
  if (draft.phase === 'ready') draft.phase = 'playing';
}

function onKey(event: { detail?: { code?: string }; code?: string } | undefined) {
  const code = event?.detail?.code || event?.code || '';
  if (!code) return;
  commitChange('key', (draft: GameState) => {
    if (ended(draft)) return;
    if (code === 'Enter') begin(draft);
    else if (code === 'KeyR') reset(draft);
    else slide(draft, code);
  });
}

function clickTile(idx: number) {
  commitChange('tile', (draft: GameState) => {
    if (draft.phase !== 'playing') return;
    const z = draft.board.indexOf(0);
    const sameRow = Math.floor(idx / 3) === Math.floor(z / 3);
    const adj = (sameRow && Math.abs(idx - z) === 1) || Math.abs(idx - z) === 3;
    if (!adj) return;
    const key = idx === z + 1 ? 'ArrowLeft' : idx === z - 1 ? 'ArrowRight' : idx === z + 3 ? 'ArrowUp' : 'ArrowDown';
    slide(draft, key);
  });
}

function App() {
  useFrame(() => {});
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#10243a" onKeyDown={(event) => onKey(event)}>
      <text x={80} y={28} width={1120} height={72} text="Slide Puzzle" textColor="#f8fafc" textSize={56} textAlign="center" />
      {Array.from({ length: 9 }, (_, i) => (
        <node
          key={i}
          x={400 + (i % 3) * 160 + 8}
          y={120 + Math.floor(i / 3) * 160 + 8}
          width={144}
          height={144}
          backgroundColor={store.board[i] === 0 ? '#0b1726' : COLORS[store.board[i] - 1]}
          clickable
          onClick={() => clickTile(i)}
        >
          <text
            x={0}
            y={36}
            width={144}
            height={72}
            text={store.board[i] === 0 ? '0' : String(store.board[i])}
            textColor={store.board[i] === 0 ? '#0b1726' : '#10243a'}
            textSize={54}
            textAlign="center"
          />
        </node>
      ))}
      <node x={60} y={620} width={240} height={70} backgroundColor="#f4a261" clickable onClick={() => commitChange('reset', (draft: GameState) => reset(draft))}>
        <text x={0} y={14} width={240} height={42} text="Reset" textColor="#10243a" textSize={32} textAlign="center" />
      </node>
      <node x={440} y={620} width={400} height={70} backgroundColor="#2a9d8f" clickable onClick={() => commitChange('start', (draft: GameState) => begin(draft))}>
        <text x={0} y={14} width={400} height={42} text="Start" textColor="#f8fafc" textSize={32} textAlign="center" />
      </node>
      <text x={900} y={150} width={340} height={48} text={`moves ${store.moves} / 14`} textColor="#f8fafc" textSize={32} textAlign="left" />
      <text
        x={900}
        y={210}
        width={340}
        height={80}
        text={store.phase === 'fail' ? 'Puzzle fail' : store.phase === 'clear' ? 'Puzzle clear' : `resets ${store.resets}`}
        textColor={store.phase === 'fail' || store.phase === 'clear' ? '#fef08a' : '#f8fafc'}
        textSize={32}
        textAlign="left"
      />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
