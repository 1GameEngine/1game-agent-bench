import { fileURLToPath } from 'node:url';
import { runProcess } from './process-supervisor.mjs';
import { executionPolicy } from './execution-policy.mjs';
import { EvalError } from './util.mjs';

const WORKER = fileURLToPath(new URL('./execution-worker.mjs', import.meta.url));

export async function runExecutionWorker(action, params, { onLifecycle, signal } = {}) {
  const timeout = executionPolicy().framework_budgets_ms[action];
  if (!timeout) throw new EvalError('EVAL_INTERNAL', `unknown execution action ${action}`);
  const startedAt = Date.now();
  onLifecycle?.({ state: 'RUNNING', started_at: new Date(startedAt).toISOString(),
    execution_deadline_at: new Date(startedAt + timeout).toISOString() });
  const result = await runProcess([process.execPath, WORKER], {
    input: JSON.stringify({ action, ...params }), deadline: startedAt + timeout, signal,
  });
  onLifecycle?.({ state: 'RUNNING', process_result: resultMetadata(result) });
  if (result.stopped) throw new EvalError('SUBAGENT_PROCESS_FAILED', `${action} execution worker timed out`, { action, timeout_ms: timeout });
  let doc;
  try { doc = JSON.parse(result.stdout); }
  catch { throw new EvalError('SUBAGENT_PROCESS_FAILED', `${action} worker returned invalid JSON: ${result.stderr}`.slice(0, 2000)); }
  if (doc.ok === false && doc.error && result.status === 1) {
    throw new EvalError(doc.error.primary ?? 'EVAL_INTERNAL', doc.error.message, doc.error.extra);
  }
  if (doc.ok !== true || result.status !== 0) throw new EvalError('SUBAGENT_PROCESS_FAILED', `${action} worker exited ${result.status}: ${result.stderr}`.slice(0, 2000));
  return doc.value;
}

export function resultMetadata(result) {
  const { status, signal, stopped, reason, descendants_cleaned, started_at, finished_at, cleanup_finished_at } = result;
  return { status, signal, stopped, reason, descendants_cleaned, started_at, finished_at, cleanup_finished_at };
}
