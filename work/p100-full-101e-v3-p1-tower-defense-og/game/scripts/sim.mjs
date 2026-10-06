// Pure-logic simulation of a trace against src/logic.ts (no engine), for planning/verifying scenarios.
import * as L from '../src/logic.ts';

export const DRAG_FRAMES = 4;

export function expand(trace) {
  const byFrame = new Map();
  const add = (frame, ev) => {
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(ev);
  };
  for (const ev of trace.events) {
    if (ev.type === 'keydown' || ev.type === 'keyup') add(ev.frame, { type: ev.type, code: ev.code });
    else if (ev.type === 'click') {
      add(ev.frame, { type: 'down', x: ev.x, y: ev.y });
      if (ev.toX === undefined) add(ev.frame + 1, { type: 'up', x: ev.x, y: ev.y });
      else {
        for (let i = 1; i < DRAG_FRAMES; i++) {
          const k = i / (DRAG_FRAMES - 1);
          add(ev.frame + i, { type: 'move', x: Math.round(ev.x + (ev.toX - ev.x) * k), y: Math.round(ev.y + (ev.toY - ev.y) * k) });
        }
        add(ev.frame + DRAG_FRAMES, { type: 'up', x: ev.toX, y: ev.toY });
      }
    }
  }
  return byFrame;
}

export function simulate(trace, frameMs = 1000 / 30, onFrame) {
  const d = L.initialState();
  const byFrame = expand(trace);
  const total = Math.max(trace.frames, ...[...byFrame.keys()].map((k) => k + 1));
  for (let f = 0; f < total; f++) {
    for (const ev of byFrame.get(f) ?? []) {
      if (ev.type === 'keydown') {
        if (ev.code === 'Enter' || ev.code === 'Space') L.keyInput(d, ev.code);
      } else if (ev.type === 'down') L.pointerDown(d, ev.x, ev.y);
      else if (ev.type === 'move') L.pointerMove(d, ev.x, ev.y);
      else if (ev.type === 'up') L.pointerUp(d, ev.x, ev.y);
    }
    L.tick(d, frameMs);
    onFrame?.(d, f);
  }
  return d;
}

export function brief(st) {
  return (
    `${st.screen}/${st.phase} open=${st.open} dp=${L.dpOf(st)} base=${st.base} wave=${L.currentWave(st)} nx=${st.nextSpawn} msg="${st.msg}" ` +
    `defs=[${st.defs.map((x) => `${x.kind}${x.up ? '+' : ''}@${x.col},${x.row}${x.kind === 'wall' ? ':' + x.hp : ''}`).join(' ')}] ` +
    `en=[${st.enemies.map((e) => `${e.name}${e.hp}@${e.col}`).join(' ')}] shots=${st.shots.length} sel=${st.selected}`
  );
}
