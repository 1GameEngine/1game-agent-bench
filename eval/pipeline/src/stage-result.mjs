import { EvalError } from './util.mjs';

const VALIDATION_FAILURES = {
  validation_incomplete: 'STAGE_VALIDATION_INCOMPLETE',
  game_validation_failed: 'GAME_VALIDATION_FAILED',
};

export function isValidationFailure(err) {
  return Object.values(VALIDATION_FAILURES).includes(err?.primary);
}

// A truthful negative result is different from a broken handoff. Only explicitly
// classified self-check failures can proceed to independent submission checks.
export function stageResponseError(spec, data) {
  if (!data || !Number.isInteger(data.exitCode) || data.exitCode < 0 || typeof data.stdout !== 'string') {
    return new EvalError('SUBAGENT_INVALID', 'subagent response needs string stdout and nonnegative integer exitCode');
  }
  if (data.exitCode === 0) {
    if (data.failure != null) return new EvalError('SUBAGENT_INVALID', 'successful response cannot contain failure');
    return null;
  }
  let primary = 'SUBAGENT_FAILED';
  if (data.failure != null) {
    if (!['builder', 'debug'].includes(spec.role) ||
        !Object.hasOwn(VALIDATION_FAILURES, data.failure?.kind) ||
        typeof data.failure.message !== 'string' || !data.failure.message.trim()) {
      return new EvalError('SUBAGENT_INVALID', 'invalid structured validation failure');
    }
    primary = VALIDATION_FAILURES[data.failure.kind];
  }
  return new EvalError(primary,
    `subagent ${spec.role} ${spec.engine} exited ${data.exitCode}\n${data.failure?.message || data.stderr || data.stdout || ''}`.slice(0, 2000),
    { stage: spec.role, engine: spec.engine, taskId: spec.taskId, exit_code: data.exitCode });
}
