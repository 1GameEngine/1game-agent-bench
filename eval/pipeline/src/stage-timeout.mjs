import { EvalError } from './util.mjs';

const DEFAULTS = { builder: 600_000, debug: 600_000, replay: 1_800_000, looks: 600_000 };

export function stageTimeoutMs(role, env = process.env) {
  if (!(role in DEFAULTS)) throw new EvalError('EVAL_INTERNAL', `unknown stage ${role}`);
  const key = `EVAL_${role.toUpperCase()}_TIMEOUT_MS`;
  const value = env[key] ?? env.EVAL_SUBAGENT_TIMEOUT_MS ?? DEFAULTS[role];
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 2_147_483_647) {
    throw new EvalError('EVAL_INTERNAL', `${key} / EVAL_SUBAGENT_TIMEOUT_MS must be a positive timer-safe integer`);
  }
  return ms;
}

export function stageProcessError(spec, result) {
  const timeout = result.error?.code === 'ETIMEDOUT';
  return new EvalError(
    timeout ? `${spec.role.toUpperCase()}_TIMEOUT` : 'SUBAGENT_INVALID',
    `subagent ${spec.role} ${spec.engine}: ${result.error?.message ?? `exited ${result.status}`}\n${result.stderr || result.stdout || ''}`.slice(0, 2000),
    { stage: spec.role, engine: spec.engine, taskId: spec.taskId, timeout_ms: stageTimeoutMs(spec.role) },
  );
}
