import fs from 'node:fs';
import path from 'node:path';

export const TRACE_SCHEMA = 'eval.trace/1';
export const REPLAY_FPS = 30;
export const SAMPLE_FPS = 2;
export const MAX_DEMO_SECONDS = 20;
export const FRAME_MS = 33;
export const REQUIRED_SCENARIOS = ['intro', 'loop', 'fail', 'clear'];

export const TRACE_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
];

export const TRACE_EVENT_TYPES = ['keydown', 'keyup', 'click'];

export function auditTrace(trace) {
  const issues = [];
  if (trace?.schema !== TRACE_SCHEMA) issues.push('schema');
  if (typeof trace?.scenario !== 'string' || !trace.scenario) issues.push('scenario');
  if (!Number.isInteger(trace?.duration_frames) || trace.duration_frames < 1) issues.push('duration_frames');
  if (trace?.viewport?.w !== 1280 || trace?.viewport?.h !== 720) issues.push('viewport');
  if (!Array.isArray(trace?.events)) issues.push('events');
  let last = -1;
  for (const ev of trace?.events ?? []) {
    if (!Number.isInteger(ev.frame) || ev.frame < 0) issues.push(`frame ${ev.frame}`);
    if (ev.frame < last) issues.push('events must be nondecreasing in frame');
    last = ev.frame;
    if (!TRACE_EVENT_TYPES.includes(ev.type)) issues.push(`type ${ev.type}`);
    if (ev.type === 'keydown' || ev.type === 'keyup') {
      if (!TRACE_KEYS.includes(ev.code)) issues.push(`key ${ev.code}`);
    }
    if (ev.type === 'click') {
      const x = Number(ev.x);
      const y = Number(ev.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1280 || y < 0 || y > 720) {
        issues.push(`click ${x},${y}`);
      }
    }
    for (const banned of ['until', 'uid', 'locator', 'wait_wall', 'screenshot', 'bash', 'hover', 'drag']) {
      if (banned in ev) issues.push(`forbidden ${banned}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function readTraces(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  const traces = [];
  for (const name of files.slice(0, 10)) {
    const trace = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    traces.push({ file: name, trace, audit: auditTrace(trace) });
  }
  return traces;
}

export function scenarioSet(traces) {
  return [...new Set((traces ?? []).map((t) => t.trace?.scenario).filter(Boolean))];
}

export function missingRequiredScenarios(traces) {
  const have = new Set(scenarioSet(traces));
  return REQUIRED_SCENARIOS.filter((s) => !have.has(s));
}

export function capFrames(durationFrames) {
  return Math.min(Number(durationFrames) || 0, MAX_DEMO_SECONDS * REPLAY_FPS);
}

export function sampleEvery() {
  return Math.round(REPLAY_FPS / SAMPLE_FPS);
}

export function eventsByFrame(trace) {
  const map = new Map();
  for (const ev of trace.events ?? []) {
    const list = map.get(ev.frame) ?? [];
    list.push(ev);
    map.set(ev.frame, list);
  }
  return map;
}

export function pickLooksStills(stills, maxPerScenario = 3) {
  const by = new Map();
  for (const s of stills ?? []) {
    const sc = String(s.id ?? '').split('_f')[0] || 'play';
    const list = by.get(sc) ?? [];
    list.push(s);
    by.set(sc, list);
  }
  const out = [];
  for (const list of by.values()) {
    if (list.length <= maxPerScenario) {
      out.push(...list);
      continue;
    }
    out.push(list[0], list[Math.floor(list.length / 2)], list[list.length - 1]);
  }
  return out;
}
