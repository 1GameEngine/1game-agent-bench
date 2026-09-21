import {
  createGameStore,
  renderGame,
} from '@1game/engine-bundle/runtime/worker';

type GameState = {
  px: number;
  py: number;
  b0x: number;
  b0y: number;
  b1x: number;
  b1y: number;
  cleared: boolean;
};

const { store, commitChange, bindStore } = createGameStore({
  px: 0,
  py: 0,
  b0x: 1,
  b0y: 0,
  b1x: 1,
  b1y: 1,
  cleared: false,
} satisfies GameState);

function inBound(x: number, y: number) {
  return x >= 0 && x <= 2 && y >= 0 && y <= 1;
}

function boxAt(d: GameState, x: number, y: number) {
  return (d.b0x === x && d.b0y === y) || (d.b1x === x && d.b1y === y);
}

function onGoals(d: GameState) {
  const a = `${d.b0x},${d.b0y}`;
  const b = `${d.b1x},${d.b1y}`;
  return (a === '2,0' || a === '2,1') && (b === '2,0' || b === '2,1') && a !== b;
}

function nudge(code: string) {
  commitChange('nudge', (d: GameState) => {
    let dx = 0;
    let dy = 0;
    if (code === 'ArrowRight') dx = 1;
    if (code === 'ArrowLeft') dx = -1;
    if (code === 'ArrowUp') dy = 1;
    if (code === 'ArrowDown') dy = -1;
    if (dx === 0 && dy === 0) return;
    const nx = d.px + dx;
    const ny = d.py + dy;
    if (!inBound(nx, ny)) return;
    if (boxAt(d, nx, ny)) {
      const bx = nx + dx;
      const by = ny + dy;
      if (!inBound(bx, by) || boxAt(d, bx, by)) return;
      if (d.b0x === nx && d.b0y === ny) {
        d.b0x = bx;
        d.b0y = by;
      } else {
        d.b1x = bx;
        d.b1y = by;
      }
    }
    d.px = nx;
    d.py = ny;
    d.cleared = onGoals(d);
  });
}

function cellColor(x: number, y: number) {
  const goal = x === 2;
  const box = (store.b0x === x && store.b0y === y) || (store.b1x === x && store.b1y === y);
  const player = store.px === x && store.py === y;
  if (box && goal) return '#f59e0b';
  if (box) return '#ea580c';
  if (player) return '#1d4ed8';
  if (goal) return '#14532d';
  return '#1f2937';
}

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224" onKeyDown={(e) => nudge(e.detail?.code)}>
      <text x={40} y={16} width={1200} height={64} text={`p=${store.px},${store.py} b0=${store.b0x},${store.b0y} b1=${store.b1x},${store.b1y} cleared=${store.cleared}`} textColor="#fff" textSize={28} />
      <node x={140} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(0, 0)} />
      <node x={500} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(1, 0)} />
      <node x={860} y={400} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(2, 0)} />
      <node x={140} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(0, 1)} />
      <node x={500} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(1, 1)} />
      <node x={860} y={160} width={280} height={200} shape="roundedRect(16 16 16 16)" backgroundColor={cellColor(2, 1)} />
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
