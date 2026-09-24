import { REQUIRED_SCENARIOS, parseStillId, scenarioContentOk } from './p1-trace.mjs';

export const CHART_ORACLE = {
  countdownFrames: 90,
  gap: 30,
  fall: 120,
  window: 4,
  notes: 16,
  missLimit: 6,
  clearHits: 12,
};

function arrival(i) {
  return CHART_ORACLE.gap * (i + 1);
}

function pressFrame(noteIndex) {
  return CHART_ORACLE.countdownFrames + arrival(noteIndex);
}

function trace(scenario, duration, events) {
  return {
    schema: 'eval.trace/1',
    scenario,
    duration_frames: duration,
    viewport: { w: 1280, h: 720 },
    events,
  };
}

function tap(frame, code) {
  return [
    { frame, type: 'keydown', code },
    { frame, type: 'keyup', code },
  ];
}

const LANES = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'];

export function buildChartOracleTraces() {
  const { countdownFrames, notes } = CHART_ORACLE;
  const enter = tap(0, 'Enter');
  const hits = [];
  for (let i = 0; i < notes; i++) hits.push(...tap(pressFrame(i), LANES[i % 4]));
  const loopHits = [];
  for (let i = 0; i < 3; i++) loopHits.push(...tap(pressFrame(i), LANES[i % 4]));
  return [
    trace('intro', 46, []),
    trace('loop', countdownFrames + 90 + 1, [...enter, ...loopHits]),
    trace('fail', countdownFrames + 185 + 15, enter),
    trace('clear', pressFrame(notes - 1) + 1, [...enter, ...hits]),
  ];
}

export function rubricWitnessIssues({ rubric, traces, stills }) {
  const issues = [];
  const byTrace = new Map();
  for (const item of traces ?? []) {
    const sc = item?.trace?.scenario ?? item?.scenario;
    const auditOk = item?.audit ? item.audit.ok : true;
    const body = item?.trace ?? item;
    if (!auditOk || !scenarioContentOk(body)) continue;
    byTrace.set(sc, body);
  }
  const frames = new Map();
  for (const still of stills ?? []) {
    const { scenario } = parseStillId(still.id);
    const list = frames.get(scenario) ?? [];
    list.push(still);
    frames.set(scenario, list);
  }
  const checkStills = stills != null;
  for (const req of rubric?.requirements ?? []) {
    const applies = Array.isArray(req.applies) ? req.applies : REQUIRED_SCENARIOS;
    for (const sc of applies) {
      if (!byTrace.has(sc)) issues.push(`${req.id} missing trace ${sc}`);
      if (checkStills && !(frames.get(sc) ?? []).some((s) => s.ok !== false && (s.path || s.ok))) {
        issues.push(`${req.id} missing still ${sc}`);
      }
    }
  }
  return issues;
}
