import { For, Show } from 'solid-js';
import { createGameStore, renderGame, useFrame } from '@1game/engine-bundle/runtime/worker';

import arrowDown from '../assets/arrow-down.png';
import arrowLeft from '../assets/arrow-left.png';
import arrowRight from '../assets/arrow-right.png';
import arrowUp from '../assets/arrow-up.png';

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;

const LANE_COUNT = 4;
const LANE_WIDTH = 240;
const LANE_LEFT = (SCENE_WIDTH - LANE_COUNT * LANE_WIDTH) / 2;
const JUDGE_Y = 560;
const SPAWN_Y = 220;
const TRACK_TOP = 120;
const FALL_MS = 1600;
const NOTE_INTERVAL_MS = 400;
const COUNTDOWN_MS = 3000;
const FIRST_HIT_OFFSET_MS = FALL_MS;
const HOLD_DURATION_MS = 720;
const NOTE_COUNT = 16;

const MAX_LIFE = 100;
const MISS_DAMAGE = 22;
const PERFECT_HEAL = 12;

const PERFECT_WIN = 45;
const GREAT_WIN = 90;
const GOOD_WIN = 130;
const AUTO_MISS_LATE = 160;

const TRACK_CODES = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'] as const;
const ARROW_SOURCES = [arrowLeft, arrowDown, arrowUp, arrowRight];

const BASE_SCORE = { perfect: 300, great: 200, good: 100, miss: 0 } as const;

type Phase = 'title' | 'countdown' | 'playing' | 'chart_miss' | 'chart_clear';
type JudgmentKind = keyof typeof BASE_SCORE;

type ChartNote = {
  id: string;
  index: number;
  track: number;
  hold: boolean;
  hitTimeMs: number;
  tailEndMs: number;
  resolved: boolean;
  holding: boolean;
  headJudged: boolean;
  pendingKind?: JudgmentKind;
};

type HitFeedback = {
  id: string;
  track: number;
  kind: JudgmentKind;
  untilMs: number;
};

type GameState = {
  phase: Phase;
  chartTimeMs: number;
  countdownMs: number;
  score: number;
  combo: number;
  maxCombo: number;
  life: number;
  counts: { perfect: number; great: number; good: number; miss: number };
  notes: ChartNote[];
  resolvedCount: number;
  hitCount: number;
  feedbacks: HitFeedback[];
  keysDown: Record<string, boolean>;
  feedbackSeq: number;
};

function laneCenterX(track: number): number {
  return LANE_LEFT + track * LANE_WIDTH + LANE_WIDTH / 2;
}

function buildChartNotes(): ChartNote[] {
  return Array.from({ length: NOTE_COUNT }, (_, index) => {
    const hitTimeMs = FIRST_HIT_OFFSET_MS + index * NOTE_INTERVAL_MS;
    const hold = index === 4 || index === 8;
    return {
      id: `note-${index}`,
      index,
      track: index % LANE_COUNT,
      hold,
      hitTimeMs,
      tailEndMs: hitTimeMs + HOLD_DURATION_MS,
      resolved: false,
      holding: false,
      headJudged: false,
    };
  });
}

function comboMultiplier(combo: number): number {
  if (combo >= 12) return 8;
  if (combo >= 8) return 4;
  if (combo >= 4) return 2;
  return 1;
}

function judgmentFromDelta(deltaMs: number): JudgmentKind | null {
  const d = Math.abs(deltaMs);
  if (d <= PERFECT_WIN) return 'perfect';
  if (d <= GREAT_WIN) return 'great';
  if (d <= GOOD_WIN) return 'good';
  return null;
}

function gradeFromCounts(counts: GameState['counts']): string {
  const hits = counts.perfect + counts.great + counts.good;
  const total = hits + counts.miss;
  if (total <= 0) return 'F';
  const ratio = hits / total;
  if (ratio >= 0.95) return 'S';
  if (ratio >= 0.85) return 'A';
  if (ratio >= 0.7) return 'B';
  if (ratio >= 0.5) return 'C';
  return 'F';
}

function accuracyText(counts: GameState['counts']): string {
  const hits = counts.perfect + counts.great + counts.good;
  const total = hits + counts.miss;
  if (total <= 0) return '0%';
  return `${Math.round((hits / total) * 100)}%`;
}

function noteSpawnMs(note: ChartNote): number {
  return note.hitTimeMs - FALL_MS;
}

function noteHeadY(note: ChartNote, chartTimeMs: number): number {
  if (note.hold && note.headJudged) return JUDGE_Y;
  const spawn = noteSpawnMs(note);
  const t = (chartTimeMs - spawn) / FALL_MS;
  const clamped = Math.max(0, Math.min(1, t));
  return SPAWN_Y + (JUDGE_Y - SPAWN_Y) * clamped;
}

function noteTailEndY(note: ChartNote, chartTimeMs: number): number {
  const remaining = note.tailEndMs - chartTimeMs;
  return JUDGE_Y - (remaining / FALL_MS) * (JUDGE_Y - SPAWN_Y);
}

function pushFeedback(draft: GameState, track: number, kind: JudgmentKind): void {
  draft.feedbackSeq += 1;
  draft.feedbacks.push({
    id: `fb-${draft.feedbackSeq}`,
    track,
    kind,
    untilMs: draft.chartTimeMs + 450,
  });
  if (draft.feedbacks.length > 12) draft.feedbacks.shift();
}

function applyMiss(draft: GameState, track: number, note?: ChartNote): void {
  draft.counts.miss += 1;
  draft.combo = 0;
  draft.life = Math.max(0, draft.life - MISS_DAMAGE);
  pushFeedback(draft, track, 'miss');
  if (note && !note.resolved) {
    note.resolved = true;
    note.holding = false;
    draft.resolvedCount += 1;
  }
  if (draft.life <= 0) draft.phase = 'chart_miss';
}

function applyHit(draft: GameState, note: ChartNote | undefined, kind: JudgmentKind): void {
  if (!note) return;
  draft.counts[kind] += 1;
  draft.combo += 1;
  draft.maxCombo = Math.max(draft.maxCombo, draft.combo);
  draft.hitCount += 1;
  const mult = comboMultiplier(draft.combo);
  draft.score += BASE_SCORE[kind] * mult;
  if (kind === 'perfect') draft.life = Math.min(MAX_LIFE, draft.life + PERFECT_HEAL);
  pushFeedback(draft, note.track, kind);
  note.resolved = true;
  note.holding = false;
  draft.resolvedCount += 1;
}

function tryFinishChart(draft: GameState): void {
  if (draft.resolvedCount < NOTE_COUNT) return;
  if (draft.phase !== 'playing') return;
  if (draft.hitCount >= 12 && draft.life > 0) draft.phase = 'chart_clear';
  else draft.phase = 'chart_miss';
}

function processAutoMisses(draft: GameState): void {
  if (draft.phase !== 'playing') return;
  for (const note of draft.notes) {
    if (!note || note.resolved || note.headJudged) continue;
    if (draft.chartTimeMs > note.hitTimeMs + AUTO_MISS_LATE) {
      applyMiss(draft, note.track, note);
      if (draft.phase === 'chart_miss') return;
    }
  }
}

function processHoldTails(draft: GameState): void {
  if (draft.phase !== 'playing') return;
  for (const note of draft.notes) {
    if (!note || !note.hold || !note.holding || note.resolved) continue;
    if (draft.chartTimeMs >= note.tailEndMs && note.pendingKind) {
      applyHit(draft, note, note.pendingKind);
    }
  }
  tryFinishChart(draft);
}

function notesInHeadWindow(draft: GameState): ChartNote[] {
  return draft.notes.filter(
    (n) => !n.resolved && !n.headJudged && Math.abs(draft.chartTimeMs - n.hitTimeMs) <= GOOD_WIN,
  );
}

function onKeyDown(code: string): void {
  commitChange(`keydown:${code}`, (draft) => {
    const wasDown = draft.keysDown[code];
    draft.keysDown[code] = true;
    if (wasDown) return;

    if (draft.phase === 'title' && code === 'Enter') {
      startCountdown(draft);
      return;
    }
    if (draft.phase !== 'playing') return;

    const track = TRACK_CODES.indexOf(code as (typeof TRACK_CODES)[number]);
    if (track < 0) return;

    const windowNotes = notesInHeadWindow(draft);
    const onTrack = windowNotes.find((n) => n.track === track && !n.headJudged);
    if (onTrack) {
      const kind = judgmentFromDelta(draft.chartTimeMs - onTrack.hitTimeMs);
      if (!kind) return;
      const note = draft.notes.find((n) => n?.id === onTrack.id);
      if (!note) return;
      if (note.hold) {
        note.headJudged = true;
        note.holding = true;
        note.pendingKind = kind;
      } else {
        applyHit(draft, note, kind);
        tryFinishChart(draft);
      }
      return;
    }

    if (windowNotes.length > 0) {
      applyMiss(draft, track);
      if (draft.phase === 'chart_miss') return;
    }
  });
}

function onKeyUp(code: string): void {
  commitChange(`keyup:${code}`, (draft) => {
    draft.keysDown[code] = false;
    if (draft.phase !== 'playing') return;

    const track = TRACK_CODES.indexOf(code as (typeof TRACK_CODES)[number]);
    if (track < 0) return;

    for (const note of draft.notes) {
      if (!note?.hold || !note.holding || note.resolved || note.track !== track) continue;
      if (draft.chartTimeMs < note.tailEndMs) {
        applyMiss(draft, track, note);
        if (draft.phase === 'chart_miss') return;
      }
    }
    tryFinishChart(draft);
  });
}

function startCountdown(draft: GameState): void {
  draft.phase = 'countdown';
  draft.countdownMs = COUNTDOWN_MS;
  draft.chartTimeMs = 0;
  draft.score = 0;
  draft.combo = 0;
  draft.maxCombo = 0;
  draft.life = MAX_LIFE;
  draft.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  draft.notes = [];
  draft.resolvedCount = 0;
  draft.hitCount = 0;
  draft.feedbacks = [];
  draft.keysDown = {};
}

function tickGame(draft: GameState, deltaSeconds: number): void {
  const dtMs = deltaSeconds * 1000;
  draft.feedbacks = draft.feedbacks.filter((f) => f.untilMs > draft.chartTimeMs);

  if (draft.phase === 'countdown') {
    draft.countdownMs -= dtMs;
    if (draft.countdownMs <= 0) {
      draft.phase = 'playing';
      draft.chartTimeMs = 0;
      draft.notes = buildChartNotes();
    }
    return;
  }

  if (draft.phase !== 'playing') return;

  draft.chartTimeMs += dtMs;
  processAutoMisses(draft);
  if (draft.phase !== 'playing') return;
  processHoldTails(draft);
}

const initialState: GameState = {
  phase: 'title',
  chartTimeMs: 0,
  countdownMs: COUNTDOWN_MS,
  score: 0,
  combo: 0,
  maxCombo: 0,
  life: MAX_LIFE,
  counts: { perfect: 0, great: 0, good: 0, miss: 0 },
  notes: [],
  resolvedCount: 0,
  hitCount: 0,
  feedbacks: [],
  keysDown: {},
  feedbackSeq: 0,
};

const { store, commitChange, bindStore } = createGameStore(initialState);

function feedbackColor(kind: JudgmentKind): string {
  if (kind === 'perfect') return '#fbbf24';
  if (kind === 'great') return '#4ade80';
  if (kind === 'good') return '#60a5fa';
  return '#f87171';
}

function feedbackLabel(kind: JudgmentKind): string {
  if (kind === 'perfect') return 'Perfect';
  if (kind === 'great') return 'Great';
  if (kind === 'good') return 'Good';
  return 'Miss';
}

function feedbackShape(kind: JudgmentKind): string {
  if (kind === 'perfect') return 'circular';
  if (kind === 'great') return 'roundedRect(10 10 10 10)';
  if (kind === 'good') return 'roundedRect(4 4 4 4)';
  return 'roundedRect(2 2 2 2)';
}

const START_BTN = { x: 440, y: 200, w: 400, h: 88 };

function Game() {
  useFrame((frame) => {
    const dt = frame.deltaSeconds;
    if (dt <= 0) return;
    commitChange('tick', (draft: GameState) => tickGame(draft, dt));
  });

  const mult = () => comboMultiplier(store.combo);

  return (
    <scene
      name="main"
      width={SCENE_WIDTH}
      height={SCENE_HEIGHT}
      backgroundColor="#0b1020"
      onKeyDown={(event) => {
        const code = event.detail?.code;
        if (code) onKeyDown(code);
      }}
      onKeyUp={(event) => {
        const code = event.detail?.code;
        if (code) onKeyUp(code);
      }}
    >
      <text x={0} y={28} width={SCENE_WIDTH} height={48} text="Chart Rush" textAlign="center" textSize="42" textColor="#f8fafc" />

      <Show when={store.phase === 'title'}>
        <group
          key="start-btn"
          x={START_BTN.x}
          y={START_BTN.y}
          width={START_BTN.w}
          height={START_BTN.h}
          clickable
          onClick={() => {
            commitChange('start', (draft) => {
              if (draft.phase === 'title') startCountdown(draft);
            });
          }}
        >
          <node
            x={0}
            y={0}
            width={START_BTN.w}
            height={START_BTN.h}
            shape="roundedRect(16 16 16 16)"
            backgroundColor="#2563eb"
          />
          <text x={0} y={24} width={START_BTN.w} height={40} text="Start" textAlign="center" textSize="36" textColor="#ffffff" />
        </group>
        <text
          x={0}
          y={320}
          width={SCENE_WIDTH}
          height={28}
          text="Press Enter or click Start"
          textAlign="center"
          textSize="22"
          textColor="#94a3b8"
        />
      </Show>

      <Show when={store.phase === 'countdown'}>
        <text
          x={0}
          y={260}
          width={SCENE_WIDTH}
          height={120}
          text={String(Math.max(1, Math.ceil(store.countdownMs / 1000)))}
          textAlign="center"
          textSize="96"
          textColor="#fde047"
        />
      </Show>

      <For each={[0, 1, 2, 3]}>
        {(track) => {
          const lx = LANE_LEFT + track * LANE_WIDTH;
          return (
            <group key={`lane-${track}`}>
              <node x={lx + 8} y={120} width={LANE_WIDTH - 16} height={JUDGE_Y - 80} backgroundColor="#141c33" shape="roundedRect(8 8 8 8)" />
              <image
                source={ARROW_SOURCES[track]}
                x={laneCenterX(track) - 40}
                y={JUDGE_Y + 12}
                width={80}
                height={80}
                imageFit="contain"
              />
            </group>
          );
        }}
      </For>

      <node x={LANE_LEFT} y={JUDGE_Y} width={LANE_COUNT * LANE_WIDTH} height={4} backgroundColor="#e2e8f0" />

      <Show when={store.phase === 'playing' || store.phase === 'chart_clear' || store.phase === 'chart_miss'}>
        <text x={24} y={88} width={200} height={28} text={`Score ${store.score}`} textSize="22" textColor="#e2e8f0" />
        <text x={24} y={118} width={240} height={24} text={`Combo ${store.combo}  x${mult()}`} textSize="20" textColor="#a5f3fc" />
        <node x={24} y={148} width={220} height={16} backgroundColor="#1e293b" shape="roundedRect(4 4 4 4)" />
        <node
          x={24}
          y={148}
          width={220 * (store.life / MAX_LIFE)}
          height={16}
          backgroundColor="#22c55e"
          shape="roundedRect(4 4 4 4)"
        />
      </Show>

      <For each={store.notes}>
        {(note) => {
          const showNote = () =>
            store.phase === 'playing' &&
            !note.resolved &&
            (store.chartTimeMs >= noteSpawnMs(note) - 50 || note.headJudged);
          const headY = () => noteHeadY(note, store.chartTimeMs);
          const tailTopY = () => {
            const end = noteTailEndY(note, store.chartTimeMs);
            return Math.max(TRACK_TOP, end);
          };
          const tailLen = () => {
            if (!note.hold) return 0;
            return Math.max(0, headY() - tailTopY());
          };
          return (
            <Show when={showNote()}>
              <group key={note.id}>
                <Show when={note.hold && tailLen() > 0}>
                  <node
                    x={laneCenterX(note.track) - 18}
                    y={tailTopY()}
                    width={36}
                    height={tailLen()}
                    backgroundColor="#818cf8"
                    shape="roundedRect(6 6 0 0)"
                  />
                </Show>
                <image
                  source={ARROW_SOURCES[note.track]}
                  x={laneCenterX(note.track) - 36}
                  y={headY() - 36}
                  width={72}
                  height={72}
                  imageFit="contain"
                />
              </group>
            </Show>
          );
        }}
      </For>

      <For each={store.feedbacks}>
        {(fb) => (
          <group key={fb.id}>
            <node
              x={laneCenterX(fb.track) - 52}
              y={JUDGE_Y - 110}
              width={104}
              height={36}
              shape={feedbackShape(fb.kind)}
              backgroundColor={feedbackColor(fb.kind)}
            />
            <text
              x={laneCenterX(fb.track) - 52}
              y={JUDGE_Y - 104}
              width={104}
              height={24}
              text={feedbackLabel(fb.kind)}
              textAlign="center"
              textSize="16"
              textColor="#0f172a"
            />
          </group>
        )}
      </For>

      <Show when={store.phase === 'chart_miss'}>
        <node x={280} y={180} width={720} height={360} backgroundColor="#1f2937" shape="roundedRect(20 20 20 20)" />
        <text x={280} y={210} width={720} height={48} text="Chart miss" textAlign="center" textSize="40" textColor="#f87171" />
        <text
          x={300}
          y={280}
          width={680}
          height={220}
          text={`score ${store.score}\ncombo ${store.maxCombo}\naccuracy ${accuracyText(store.counts)}\ngrade ${gradeFromCounts(store.counts)}\nPerfect ${store.counts.perfect}  Great ${store.counts.great}  Good ${store.counts.good}  Miss ${store.counts.miss}`}
          textAlign="center"
          textSize="24"
          textColor="#e2e8f0"
          autoWrap
        />
      </Show>

      <Show when={store.phase === 'chart_clear'}>
        <node x={280} y={180} width={720} height={360} backgroundColor="#1e3a2f" shape="roundedRect(20 20 20 20)" />
        <text x={280} y={210} width={720} height={48} text="Chart clear" textAlign="center" textSize="40" textColor="#4ade80" />
        <text
          x={300}
          y={280}
          width={680}
          height={220}
          text={`score ${store.score}\ncombo ${store.maxCombo}\naccuracy ${accuracyText(store.counts)}\ngrade ${gradeFromCounts(store.counts)}\nPerfect ${store.counts.perfect}  Great ${store.counts.great}  Good ${store.counts.good}  Miss ${store.counts.miss}`}
          textAlign="center"
          textSize="24"
          textColor="#ecfdf5"
          autoWrap
        />
      </Show>
    </scene>
  );
}

renderGame(() => <Game />, { bindStore });
