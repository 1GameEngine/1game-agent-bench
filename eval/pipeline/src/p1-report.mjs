import { assertNoForbiddenScoreKeys, EvalError } from './util.mjs';

export function buildCompareScalar({ runId, attempts }) {
  const checkpoints_ok = attempts.filter((a) => a.primary === 'TRACE_OK' || a.primary === 'CHECKPOINTS_OK').length;
  const g0_ok = attempts.filter((a) => a.g0_ok === 1).length;
  const report = {
    schema: 'eval.compare-scalar/1',
    headline_track: 'COMPARE_SCALAR',
    report_id: `COMPARE_SCALAR_${runId}`,
    comparable: true,
    winner: false,
    notice:
      '过程指标：COMPARE_SCALAR = TRACE_OK / ATTEMPTS（分母含 G0 失败）。非胜负。胜负只看 product_100。禁止 overall / total_score。',
    checkpoints_ok,
    attempts: attempts.length,
    headline: `${checkpoints_ok}/${attempts.length}`,
    g0_ok,
    g0_conditional: `${checkpoints_ok}/${g0_ok}`,
    engines: {
      onegame: summarize(attempts.filter((a) => a.engine === 'onegame')),
      godot: summarize(attempts.filter((a) => a.engine === 'godot')),
    },
    tasks: attempts.map((a) => ({
      id: a.id,
      engine: a.engine,
      primary: a.primary,
      g0_ok: a.g0_ok,
      notes: a.notes?.length ? a.notes : undefined,
    })),
  };
  assertNoForbiddenScoreKeys(report);
  if ('overall' in report || 'total_score' in report) {
    throw new EvalError('EVAL_INTERNAL', 'compare report grew overall');
  }
  return report;
}

function summarize(rows) {
  return {
    checkpoints_ok: rows.filter((a) => a.primary === 'TRACE_OK' || a.primary === 'CHECKPOINTS_OK').length,
    attempts: rows.length,
    g0_ok: rows.filter((a) => a.g0_ok === 1).length,
  };
}
