declare module '*.png' {
  const src: string;
  export default src;
}

import floorPng from '../assets/floor.png';
import wallPng from '../assets/wall.png';
import doorPng from '../assets/door.png';
import doorOpenPng from '../assets/door-open.png';
import keyPng from '../assets/key.png';
import chestPng from '../assets/chest.png';
import guardPng from '../assets/guard.png';
import playerPng from '../assets/player.png';
import {
  createGameStore,
  renderGame,
  useFrame,
} from '@1game/engine-bundle/runtime/worker';

type Phase = 'play' | 'fail' | 'clear';

type GameState = {
  phase: Phase;
  px: number;
  py: number;
  hasKey: boolean;
  doorOpen: boolean;
  bx: number;
  by: number;
  ex: number;
  ey: number;
  patrol: number;
  tick: number;
};

const W = 8;
const H = 6;
const CELL = 80;
const OX = 320;
const OY = 120;
const MAP = [
  '########',
  '#P..K..#',
  '#..B...#',
  '#.E...D#',
  '#....A.#',
  '#...G..#',
];

const { store, commitChange, bindStore } = createGameStore({
  phase: 'play' as Phase,
  px: 1,
  py: 1,
  hasKey: false,
  doorOpen: false,
  bx: 3,
  by: 2,
  ex: 2,
  ey: 3,
  patrol: 0,
  tick: 0,
} satisfies GameState);

const PATROL_X = [1, 2, 3, 2];

function tile(x: number, y: number) {
  return MAP[y]?.[x] ?? '#';
}

function blocked(d: GameState, x: number, y: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  const t = tile(x, y);
  if (t === '#') return true;
  if (t === 'D' && !d.doorOpen) return true;
  if (d.bx === x && d.by === y) return true;
  return false;
}

function tryMove(d: GameState, dx: number, dy: number) {
  if (d.phase !== 'play') return;
  const nx = d.px + dx;
  const ny = d.py + dy;
  if (d.bx === nx && d.by === ny) {
    const tx = d.bx + dx;
    const ty = d.by + dy;
    if (blocked(d, tx, ty) || (d.ex === tx && d.ey === ty)) return;
    d.bx = tx;
    d.by = ty;
  }
  if (blocked(d, nx, ny)) return;
  d.px = nx;
  d.py = ny;
  if (tile(nx, ny) === 'K') {
    d.hasKey = true;
    d.doorOpen = true;
  }
  if (tile(nx, ny) === 'A') d.phase = 'fail';
  if (tile(nx, ny) === 'G' && d.hasKey) d.phase = 'clear';
  if (d.px === d.ex && d.py === d.ey) d.phase = 'fail';
}

function App() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (d: GameState) => {
      if (d.phase !== 'play') return;
      d.tick += Math.round(dt * 1000);
      if (d.tick >= 792) {
        d.tick = 0;
        d.patrol = (d.patrol + 1) % PATROL_X.length;
        d.ex = PATROL_X[d.patrol];
        d.ey = 3;
        if (d.px === d.ex && d.py === d.ey) d.phase = 'fail';
      }
    });
  });

  const cells = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = tile(x, y);
      cells.push(
        <image
          key={`c${x}-${y}`}
          x={OX + x * CELL}
          y={OY + y * CELL}
          width={CELL - 4}
          height={CELL - 4}
          source={t === '#' ? wallPng : floorPng}
          imageFit="cover"
        />,
      );
      if (t === 'D') {
        cells.push(
          <image
            key={`d${x}-${y}`}
            x={OX + x * CELL}
            y={OY + y * CELL}
            width={CELL - 4}
            height={CELL - 4}
            source={store.doorOpen ? doorOpenPng : doorPng}
            imageFit="contain"
          />,
        );
      }
      if (t === 'K' && !store.hasKey) {
        cells.push(
          <image
            key={`k${x}-${y}`}
            x={OX + x * CELL + 12}
            y={OY + y * CELL + 12}
            width={52}
            height={52}
            source={keyPng}
            imageFit="contain"
          />,
        );
      }
    }
  }

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#020617"
      onKeyDown={(e) => {
        const code = e.detail?.code;
        commitChange('move', (d: GameState) => {
          if (code === 'ArrowLeft' || code === 'KeyA') tryMove(d, -1, 0);
          if (code === 'ArrowRight' || code === 'KeyD') tryMove(d, 1, 0);
          if (code === 'ArrowUp' || code === 'KeyW') tryMove(d, 0, -1);
          if (code === 'ArrowDown' || code === 'KeyS') tryMove(d, 0, 1);
        });
      }}
    >
      <text x={40} y={20} width={1200} height={56} text="Vault Crawl" textColor="#e2e8f0" textSize={40} />
      <text
        x={40}
        y={72}
        width={1200}
        height={40}
        text={`phase=${store.phase} pos=${store.px},${store.py} key=${store.hasKey ? 1 : 0} door=${store.doorOpen ? 1 : 0} box=${store.bx},${store.by} guard=${store.ex},${store.ey}`}
        textColor="#cbd5e1"
        textSize={22}
      />
      {cells}
      <image x={OX + store.bx * CELL + 8} y={OY + store.by * CELL + 8} width={60} height={60} source={chestPng} imageFit="contain" />
      <image x={OX + store.ex * CELL + 8} y={OY + store.ey * CELL + 8} width={60} height={60} source={guardPng} imageFit="contain" />
      <image x={OX + store.px * CELL + 8} y={OY + store.py * CELL + 8} width={60} height={60} source={playerPng} imageFit="contain" />
      {store.phase === 'fail' ? (
        <text x={40} y={640} width={1200} height={56} text="Caught" textAlign="center" textSize={40} textColor="#fecaca" />
      ) : null}
      {store.phase === 'clear' ? (
        <text x={40} y={640} width={1200} height={56} text="Vault open" textAlign="center" textSize={40} textColor="#bbf7d0" />
      ) : null}
    </scene>
  );
}
renderGame(() => <App />, { bindStore });
