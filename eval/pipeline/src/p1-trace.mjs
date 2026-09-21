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

export function unwrapTrace(t) {
  return t?.trace ?? t;
}

export function scenarioContentOk(trace) {
  const sc = unwrapTrace(trace)?.scenario;
  if (sc === 'fail' || sc === 'clear' || sc === 'loop') {
    return Array.isArray(unwrapTrace(trace)?.events) && unwrapTrace(trace).events.length > 0;
  }
  return true;
}

export function scenarioSet(traces) {
  return [...new Set((traces ?? []).map((t) => unwrapTrace(t)?.scenario).filter(Boolean))];
}

export function missingRequiredScenarios(traces, opts = {}) {
  const have = new Set();
  for (const t of traces ?? []) {
    const trace = unwrapTrace(t);
    const audit = t?.audit ?? { ok: true };
    if (!audit.ok) continue;
    if (!scenarioContentOk(trace)) continue;
    if (opts.replayedScenarios && !opts.replayedScenarios.includes(trace.scenario)) continue;
    if (opts.observedScenarios && !opts.observedScenarios.includes(trace.scenario)) continue;
    if (trace.scenario) have.add(trace.scenario);
  }
  return REQUIRED_SCENARIOS.filter((s) => !have.has(s));
}

export function parseStillId(id) {
  const m = String(id ?? '').match(/^(.*)_f(\d+)$/);
  if (!m) return { scenario: String(id || 'play'), frame: 0 };
  return { scenario: m[1], frame: Number(m[2]) };
}

export function stillPlayMeta(still) {
  const parsed = parseStillId(still?.id);
  const frame = Number.isInteger(still?.dump?.frame) ? still.dump.frame : parsed.frame;
  const scenario = still?.dump?.scenario || parsed.scenario;
  return { scenario, frame, t_ms: frame * FRAME_MS };
}

export function groupStillsByScenario(stills) {
  const by = new Map();
  for (const s of stills ?? []) {
    const { scenario } = parseStillId(s.id);
    const list = by.get(scenario) ?? [];
    list.push(s);
    by.set(scenario, list);
  }
  return by;
}

export const LOOKS_MAX_FRAMES = 40;

export function capLooksStills(stills, max = LOOKS_MAX_FRAMES) {
  const list = [...(stills ?? [])];
  if (list.length <= max) return { stills: list, sample_policy: 'fps2' };
  const out = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (list.length - 1)) / Math.max(1, max - 1));
    out.push(list[idx]);
  }
  return { stills: out, sample_policy: 'fps2_cap40' };
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

export function pickLooksStills(stills, maxPerScenario = LOOKS_MAX_FRAMES) {
  const by = groupStillsByScenario(stills);
  const out = [];
  for (const list of by.values()) {
    out.push(...capLooksStills(list, maxPerScenario).stills);
  }
  return out;
}
