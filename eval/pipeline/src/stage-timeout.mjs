import { EvalError } from './util.mjs';
import { stageResponseError } from './stage-result.mjs';

const DEFAULTS = { builder: 600_000, debug: 600_000, replay: 1_800_000, looks: 600_000 };

function timerMs(value, label) {
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 2_147_483_647) {
    throw new EvalError('EVAL_INTERNAL', `${label} must be a positive timer-safe integer`);
  }
  return ms;
}

export function stageTimeoutMs(role, env = process.env) {
  if (!(role in DEFAULTS)) throw new EvalError('EVAL_INTERNAL', `unknown stage ${role}`);
  const key = `EVAL_${role.toUpperCase()}_TIMEOUT_MS`;
  const value = env[key] ?? env.EVAL_SUBAGENT_TIMEOUT_MS ?? DEFAULTS[role];
  return timerMs(value, `${key} / EVAL_SUBAGENT_TIMEOUT_MS`);
}

export function stageDispatchTimeoutMs(env = process.env) {
  return timerMs(env.EVAL_DISPATCH_TIMEOUT_MS ?? 600_000, 'EVAL_DISPATCH_TIMEOUT_MS');
}

export function stageProcessError(spec, result) {
  const timeout = result.error?.code === 'ETIMEDOUT';
  if (!result.error && Number.isInteger(result.status) && result.status > 0) {
    try {
      const data = JSON.parse(result.stdout);
      if (data.exitCode === result.status) return stageResponseError(spec, data);
    } catch { /* Plain process failures have no recoverable self-check contract. */ }
  }
  return new EvalError(
    timeout ? `${spec.role.toUpperCase()}_TIMEOUT` : 'SUBAGENT_PROCESS_FAILED',
    `subagent ${spec.role} ${spec.engine}: ${result.error?.message ?? `exited ${result.status}`}\n${result.stderr || result.stdout || ''}`.slice(0, 2000),
    { stage: spec.role, engine: spec.engine, taskId: spec.taskId, timeout_ms: stageTimeoutMs(spec.role) },
  );
}
