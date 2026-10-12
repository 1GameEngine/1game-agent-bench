import { EvalError } from './util.mjs';

export function diagnosticPlan(traces, { scenario, untilFrame, checkpoints } = {}) {
  const frames = checkpoints == null ? [] : typeof checkpoints === 'string'
    ? checkpoints.split(',').map(v => /^\d+$/.test(v) ? Number(v) : NaN) : checkpoints;
  if (!Array.isArray(frames) || frames.length > 38 || frames.some(f => !Number.isSafeInteger(f) || f < 0)) {
    throw new EvalError('TRACE_INVALID', 'checkpoints must contain at most 38 nonnegative integer frame numbers');
  }
  const end = untilFrame == null ? null : typeof untilFrame === 'string' && /^\d+$/.test(untilFrame) ? Number(untilFrame) : untilFrame;
  if (end !== null && (!Number.isSafeInteger(end) || end < 0)) throw new EvalError('TRACE_INVALID', 'until-frame must be a nonnegative integer');
  if ((end !== null || frames.length) && !scenario) throw new EvalError('TRACE_INVALID', 'prefix/checkpoint diagnostics require one scenario');
  const selected = traces.filter(t => !scenario || t.trace.scenario === scenario);
  if (scenario && selected.length !== 1) throw new EvalError('TRACE_INVALID', 'diagnostic scenario must have exactly one submitted trace');
  const planned = selected.map(item => {
    const n = item.trace.duration_frames;
    if (end !== null && end >= n || frames.some(f => f >= (end === null ? n : end + 1))) {
      throw new EvalError('TRACE_INVALID', 'diagnostic frame is outside the submitted trace/prefix');
    }
    return end === null ? item : { ...item, trace: { ...item.trace, duration_frames: end + 1,
      events: item.trace.events.filter(e => e.frame <= end) } };
  });
  return { mode: scenario || end !== null || frames.length ? 'diagnostic' : 'full', traces: planned,
    scenario: scenario ?? null, until_frame: end, checkpoints: [...new Set(frames)].sort((a,b)=>a-b) };
}
