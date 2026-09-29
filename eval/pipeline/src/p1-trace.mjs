import fs from 'node:fs';
import path from 'node:path';

export const TRACE_SCHEMA = 'eval.trace/1';
export const REPLAY_FPS = 30;
export const SAMPLE_FPS = 2;
export const MAX_DEMO_SECONDS = 20;
export const FRAME_MS = 33;
export const LOOKS_MAX_FRAMES = 40;

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

export function tracePolicy(task) {
  return {
    scenarios: task?.scenarios?.required ?? [],
    allowEmpty: task?.scenarios?.allow_empty ?? [],
    events: task?.input?.events ?? TRACE_EVENT_TYPES,
    keys: task?.input?.keys ?? TRACE_KEYS,
    maxFrames: (task?.max_demo_seconds ?? MAX_DEMO_SECONDS) * REPLAY_FPS,
    sampleFps: task?.sample_fps ?? SAMPLE_FPS,
  };
}

export function sampleEvery(sampleFps = SAMPLE_FPS) {
  return Math.max(1, Math.round(REPLAY_FPS / sampleFps));
}

export function projectedSampleCount(maxDemoSeconds, sampleFps) {
  const n = maxDemoSeconds * REPLAY_FPS;
  const every = sampleEvery(sampleFps);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (i % every === 0 || i === n - 1) count += 1;
  }
  return count;
}

export function auditTrace(trace, policy = null) {
  const issues = [];
  const events = policy?.events ?? TRACE_EVENT_TYPES;
  const keys = policy?.keys ?? TRACE_KEYS;
  const maxFrames = policy?.maxFrames ?? MAX_DEMO_SECONDS * REPLAY_FPS;
  if (trace?.schema !== TRACE_SCHEMA) issues.push('schema');
  if (typeof trace?.scenario !== 'string' || !trace.scenario) issues.push('scenario');
  else if (policy?.scenarios?.length && !policy.scenarios.includes(trace.scenario)) issues.push(`scenario ${trace.scenario}`);
  if (!Number.isInteger(trace?.duration_frames) || trace.duration_frames < 1) issues.push('duration_frames');
  else if (trace.duration_frames > maxFrames) issues.push('duration_frames exceeds max_demo_seconds');
  if (trace?.viewport?.w !== 1280 || trace?.viewport?.h !== 720) issues.push('viewport');
  if (!Array.isArray(trace?.events)) issues.push('events');
  let last = -1;
  for (const ev of trace?.events ?? []) {
    if (!Number.isInteger(ev.frame) || ev.frame < 0) issues.push(`frame ${ev.frame}`);
    else if (Number.isInteger(trace?.duration_frames) && ev.frame >= trace.duration_frames) issues.push(`frame ${ev.frame} past duration`);
    if (ev.frame < last) issues.push('events must be nondecreasing in frame');
    last = ev.frame;
    if (!events.includes(ev.type)) issues.push(`type ${ev.type}`);
    if (ev.type === 'keydown' || ev.type === 'keyup') {
      if (!keys.includes(ev.code)) issues.push(`key ${ev.code}`);
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

export function readTraces(dir, policy = null) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  const traces = [];
  for (const name of files.slice(0, 10)) {
    const trace = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    traces.push({ file: name, trace, audit: auditTrace(trace, policy) });
  }
  return traces;
}

export function unwrapTrace(t) {
  return t?.trace ?? t;
}

export function scenarioContentOk(trace, allowEmpty = ['intro']) {
  const sc = unwrapTrace(trace)?.scenario;
  if (allowEmpty.includes(sc)) return true;
  return Array.isArray(unwrapTrace(trace)?.events) && unwrapTrace(trace).events.length > 0;
}

export function duplicateScenarioNames(traces) {
  const seen = new Set();
  const dups = [];
  for (const t of traces ?? []) {
    const audit = t?.audit ?? { ok: true };
    if (!audit.ok) continue;
    const sc = unwrapTrace(t)?.scenario;
    if (!sc) continue;
    if (seen.has(sc)) dups.push(sc);
    else seen.add(sc);
  }
  return dups;
}

export function scenarioSet(traces) {
  return [...new Set((traces ?? []).map((t) => unwrapTrace(t)?.scenario).filter(Boolean))];
}

export function missingRequiredScenarios(traces, opts = {}) {
  const required = opts.required ?? [];
  const allowEmpty = opts.allowEmpty ?? ['intro'];
  const have = new Set();
  for (const t of traces ?? []) {
    const trace = unwrapTrace(t);
    const audit = t?.audit ?? { ok: true };
    if (!audit.ok) continue;
    if (!scenarioContentOk(trace, allowEmpty)) continue;
    if (opts.replayedScenarios && !opts.replayedScenarios.includes(trace.scenario)) continue;
    if (opts.observedScenarios && !opts.observedScenarios.includes(trace.scenario)) continue;
    if (trace.scenario) have.add(trace.scenario);
  }
  return required.filter((s) => !have.has(s));
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

export function capLooksStills(stills, max = LOOKS_MAX_FRAMES, sampleFps = SAMPLE_FPS) {
  const list = [...(stills ?? [])];
  const sample_policy = `fps${sampleFps}`;
  if (list.length <= max) return { ok: true, stills: list, sample_policy };
  return { ok: false, stills: list, sample_policy, reason: 'LOOKS_FRAME_CAP' };
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

export function pickLooksStills(stills, maxPerScenario = LOOKS_MAX_FRAMES, sampleFps = SAMPLE_FPS) {
  const by = groupStillsByScenario(stills);
  const out = [];
  for (const list of by.values()) {
    const capped = capLooksStills(list, maxPerScenario, sampleFps);
    if (!capped.ok) return { ok: false, stills: out, reason: capped.reason, sample_policy: capped.sample_policy };
    out.push(...capped.stills);
  }
  return { ok: true, stills: out, sample_policy: `fps${sampleFps}` };
}
