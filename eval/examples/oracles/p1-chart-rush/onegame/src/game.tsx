import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';
import leftUrl from '../assets/arrow-left.png';
import downUrl from '../assets/arrow-down.png';
import upUrl from '../assets/arrow-up.png';
import rightUrl from '../assets/arrow-right.png';

const LANES = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'] as const;
const SPRITES = [leftUrl, downUrl, upUrl, rightUrl];
const NOTE_COUNT = 16;
const STEP_MS = 400;
const WINDOW_MS = 132;
const COUNTDOWN_MS = 3000;
const TRAVEL_MS = 800;

type Phase = 'ready' | 'countdown' | 'playing' | 'fail' | 'clear';
type GameState = {
  phase: Phase;
  countdownMs: number;
  playMs: number;
  hits: number;
  misses: number;
  nextNote: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  countdownMs: COUNTDOWN_MS,
  playMs: 0,
  hits: 0,
  misses: 0,
  nextNote: 0,
} satisfies GameState);

function begin(draft: GameState) {
  if (draft.phase === 'ready') draft.phase = 'countdown';
}

function expire(draft: GameState) {
  while (draft.nextNote < NOTE_COUNT && draft.playMs > STEP_MS * (draft.nextNote + 1) + WINDOW_MS) {
    draft.misses += 1;
    draft.nextNote += 1;
    if (draft.misses >= 6) {
      draft.phase = 'fail';
      return;
    }
  }
  if (draft.phase === 'playing' && draft.nextNote >= NOTE_COUNT) {
    draft.phase = draft.hits >= 12 ? 'clear' : 'fail';
  }
}

function strike(draft: GameState, code: string) {
  if (draft.phase !== 'playing' || draft.nextNote >= NOTE_COUNT) return;
  const due = STEP_MS * (draft.nextNote + 1);
  const lane = LANES[draft.nextNote % 4];
  if (Math.abs(draft.playMs - due) <= WINDOW_MS && code === lane) {
    draft.hits += 1;
    draft.nextNote += 1;
  } else {
    draft.misses += 1;
  }
  if (draft.misses >= 6) draft.phase = 'fail';
  else if (draft.nextNote >= NOTE_COUNT) draft.phase = draft.hits >= 12 ? 'clear' : 'fail';
}

function onKey(code: string) {
  commitChange('key', (draft: GameState) => {
    if (draft.phase === 'ready' && (code === 'Enter' || code === 'Space')) begin(draft);
    else strike(draft, code);
  });
}

function App() {
  useFrame((frame) => {
    const dt = Math.max(1, Math.round(frame.deltaSeconds * 1000));
    commitChange('tick', (draft: GameState) => {
      if (draft.phase === 'countdown') {
        draft.countdownMs = Math.max(0, draft.countdownMs - dt);
        if (draft.countdownMs <= 0) {
          draft.phase = 'playing';
          draft.playMs = 0;
        }
      } else if (draft.phase === 'playing') {
        draft.playMs += dt;
        expire(draft);
      }
    });
  });

  const notes = [];
  if (store.phase === 'playing' || store.phase === 'clear' || store.phase === 'fail') {
    for (let i = store.nextNote; i < NOTE_COUNT; i += 1) {
      const due = STEP_MS * (i + 1);
      const age = store.playMs - (due - TRAVEL_MS);
      if (age < 0 || age > TRAVEL_MS + 80) continue;
      const y = 340 + (560 - 340) * Math.min(1.1, age / TRAVEL_MS);
      notes.push({ i, y, src: SPRITES[i % 4] });
    }
  }
  const banner =
    store.phase === 'fail' ? 'Chart miss' : store.phase === 'clear' ? `Chart clear   hits ${store.hits}` : store.phase === 'playing' ? `hits ${store.hits}` : '';

  return (
    <scene name="main" width={1280} height={720} backgroundColor="#12081c" onKeyDown={(event) => onKey(event.code)}>
      <text x={80} y={36} width={1120} height={72} text="Chart Rush" textColor="#f8e7ff" textSize={64} textAlign="center" />
      <node
        x={440}
        y={150}
        width={400}
        height={100}
        clickable
        backgroundColor="#7c3aed"
        onClick={() => commitChange('start', (draft: GameState) => begin(draft))}
      >
        <text x={0} y={18} width={400} height={64} text="Start" textColor="#ffffff" textSize={48} textAlign="center" />
      </node>
      <text
        x={80}
        y={270}
        width={1120}
        height={64}
        text={store.phase === 'countdown' ? String(Math.ceil(store.countdownMs / 1000)) : ''}
        textColor="#f8e7ff"
        textSize={42}
        textAlign="center"
      />
      {SPRITES.map((src, i) => (
        <image key={`lane-${i}`} x={176 + i * 220} y={520} width={88} height={88} source={src} />
      ))}
      {notes.map((note) => (
        <image key={`note-${note.i}`} x={176 + (note.i % 4) * 220} y={note.y - 24} width={88} height={88} source={note.src} />
      ))}
      <text x={80} y={620} width={1120} height={64} text={banner} textColor="#f8e7ff" textSize={36} textAlign="center" />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
