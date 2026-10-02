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
const HOLD_MS = 200;
const GRADE_COLOR: Record<string, string> = {
  Perfect: '#ffe14a',
  Great: '#7dffb3',
  Good: '#8ec5ff',
  Miss: '#ff5a6a',
};

type Phase = 'ready' | 'countdown' | 'playing' | 'fail' | 'clear';
type GameState = {
  phase: Phase;
  countdownMs: number;
  playMs: number;
  hits: number;
  misses: number;
  nextNote: number;
  hp: number;
  combo: number;
  maxCombo: number;
  score: number;
  perfects: number;
  greats: number;
  goods: number;
  grade: string;
  gradeMs: number;
  holdIndex: number;
  holdBand: string;
  holdDue: number;
};

const { store, commitChange, bindStore } = createGameStore({
  phase: 'ready',
  countdownMs: COUNTDOWN_MS,
  playMs: 0,
  hits: 0,
  misses: 0,
  nextNote: 0,
  hp: 100,
  combo: 0,
  maxCombo: 0,
  score: 0,
  perfects: 0,
  greats: 0,
  goods: 0,
  grade: '',
  gradeMs: 0,
  holdIndex: -1,
  holdBand: '',
  holdDue: 0,
} satisfies GameState);

function isHold(index: number) {
  return index === 4 || index === 8;
}
function bandOf(delta: number) {
  if (delta <= 40) return 'Perfect';
  if (delta <= 80) return 'Great';
  if (delta <= WINDOW_MS) return 'Good';
  return 'Miss';
}
function multiplier(combo: number) {
  if (combo >= 12) return 8;
  if (combo >= 8) return 4;
  if (combo >= 4) return 2;
  return 1;
}
function finish(draft: GameState) {
  if (draft.hp <= 0) draft.phase = 'fail';
  else if (draft.nextNote >= NOTE_COUNT) draft.phase = draft.hits >= 12 ? 'clear' : 'fail';
}
function award(draft: GameState, kind: string, consume: boolean) {
  if (kind === 'Miss') {
    draft.misses += 1;
    draft.hp = Math.max(0, draft.hp - 20);
    draft.combo = 0;
  } else {
    draft.hits += 1;
    draft.combo += 1;
    draft.maxCombo = Math.max(draft.maxCombo, draft.combo);
    const pts = kind === 'Perfect' ? 100 : kind === 'Great' ? 70 : 40;
    draft.score += pts * multiplier(draft.combo);
    if (kind === 'Perfect') {
      draft.perfects += 1;
      draft.hp = Math.min(100, draft.hp + 8);
    } else if (kind === 'Great') draft.greats += 1;
    else draft.goods += 1;
  }
  draft.grade = kind;
  draft.gradeMs = 500;
  draft.holdIndex = -1;
  if (consume) draft.nextNote += 1;
  finish(draft);
}
function begin(draft: GameState) {
  if (draft.phase === 'ready') draft.phase = 'countdown';
}
function expire(draft: GameState) {
  while (
    draft.phase === 'playing'
    && draft.holdIndex < 0
    && draft.nextNote < NOTE_COUNT
    && draft.playMs > STEP_MS * (draft.nextNote + 1) + WINDOW_MS
  ) {
    award(draft, 'Miss', true);
  }
}
function strike(draft: GameState, code: string) {
  if (draft.phase !== 'playing' || draft.holdIndex >= 0 || draft.nextNote >= NOTE_COUNT) return;
  const due = STEP_MS * (draft.nextNote + 1);
  const lane = LANES[draft.nextNote % 4];
  const delta = Math.abs(draft.playMs - due);
  if (delta <= WINDOW_MS && code === lane) {
    const band = bandOf(delta);
    if (isHold(draft.nextNote)) {
      draft.holdIndex = draft.nextNote;
      draft.holdBand = band;
      draft.holdDue = due;
      return;
    }
    award(draft, band, true);
  } else award(draft, 'Miss', false);
}
function release(draft: GameState, code: string) {
  if (draft.phase !== 'playing' || draft.holdIndex < 0) return;
  if (code !== LANES[draft.holdIndex % 4]) return;
  if (draft.playMs >= draft.holdDue + HOLD_MS) award(draft, draft.holdBand, true);
  else award(draft, 'Miss', true);
}
function accuracy(draft: GameState) {
  const total = draft.hits + draft.misses;
  if (!total) return 100;
  return Math.round((100 * draft.hits) / total);
}
function letter(pct: number) {
  if (pct >= 95) return 'S';
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 50) return 'C';
  return 'F';
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
        if (draft.holdIndex >= 0 && draft.playMs >= draft.holdDue + HOLD_MS) award(draft, draft.holdBand, true);
        if (draft.phase === 'playing') expire(draft);
      }
      if (draft.gradeMs > 0) draft.gradeMs = Math.max(0, draft.gradeMs - dt);
    });
  });

  const notes = [];
  if (store.phase === 'playing' || store.phase === 'clear' || store.phase === 'fail') {
    for (let i = store.nextNote; i < NOTE_COUNT; i += 1) {
      const due = STEP_MS * (i + 1);
      const age = store.playMs - (due - TRAVEL_MS);
      if (age < 0 || age > TRAVEL_MS + 80) continue;
      const y = 340 + (560 - 340) * Math.min(1.1, age / TRAVEL_MS);
      notes.push({ i, y, src: SPRITES[i % 4], hold: isHold(i) });
    }
  }
  const pct = accuracy(store);
  const banner =
    store.phase === 'fail' || store.phase === 'clear'
      ? `${store.phase === 'fail' ? 'Chart miss' : 'Chart clear'}  hits ${store.hits}  score ${store.score}  combo ${store.maxCombo}  accuracy ${pct}%  grade ${letter(pct)}  Perfect ${store.perfects}  Great ${store.greats}  Good ${store.goods}  Miss ${store.misses}`
      : store.phase === 'playing'
        ? `hits ${store.hits}  combo ${store.combo}  x${multiplier(store.combo)}`
        : '';
  const mid =
    store.phase === 'countdown'
      ? String(Math.ceil(store.countdownMs / 1000))
      : store.gradeMs > 0
        ? store.grade
        : '';
  const live = store.phase !== 'ready';

  return (
    <scene
      name="main"
      width={1280}
      height={720}
      backgroundColor="#12081c"
      onKeyDown={(event) => commitChange('key', (draft: GameState) => {
        const code = event.code || event.detail?.code;
        if (draft.phase === 'ready' && (code === 'Enter' || code === 'Space')) begin(draft);
        else strike(draft, code);
      })}
      onKeyUp={(event) => commitChange('up', (draft: GameState) => release(draft, event.code || event.detail?.code))}
    >
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
      <text x={80} y={270} width={1120} height={64} text={mid} textColor={GRADE_COLOR[store.grade] || '#f8e7ff'} textSize={42} textAlign="center" />
      {live ? <node key="hp-bg" x={440} y={248} width={400} height={16} backgroundColor="#2a2030" /> : null}
      {live ? <node key="hp" x={440} y={248} width={Math.max(4, (400 * store.hp) / 100)} height={16} backgroundColor="#ff5a6a" /> : null}
      {live ? (
        <node key="perfect-mark" x={376} y={308} width={22} height={22} backgroundColor="#ffe14a" transform={{ rotate: 45 }} />
      ) : null}
      {live ? <node key="great-mark" x={520} y={308} width={36} height={16} backgroundColor="#7dffb3" /> : null}
      {live ? <node key="good-mark" x={680} y={304} width={24} height={24} backgroundColor="#8ec5ff" /> : null}
      {live ? (
        <node key="miss-a" x={820} y={314} width={28} height={6} backgroundColor="#ff5a6a" transform={{ rotate: 45 }} />
      ) : null}
      {live ? (
        <node key="miss-b" x={820} y={314} width={28} height={6} backgroundColor="#ff5a6a" transform={{ rotate: -45 }} />
      ) : null}
      {SPRITES.map((src, i) => (
        <image key={`lane-${i}`} x={176 + i * 220} y={520} width={88} height={88} source={src} />
      ))}
      {notes.filter((note) => note.hold).map((note) => (
        <node key={`tail-${note.i}`} x={176 + (note.i % 4) * 220 + 34} y={note.y - 24 - 55} width={20} height={55} backgroundColor="#f8e7ff" />
      ))}
      {notes.map((note) => (
        <image key={`note-${note.i}`} x={176 + (note.i % 4) * 220} y={note.y - 24} width={88} height={88} source={note.src} />
      ))}
      <text x={40} y={620} width={1200} height={64} text={banner} textColor="#f8e7ff" textSize={28} textAlign="center" />
    </scene>
  );
}

renderGame(() => <App />, { bindStore });
