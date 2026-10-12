import path from 'node:path';
import { runExecutionWorker } from './execution-adapter.mjs';
import { isValidationFailure } from './stage-result.mjs';
import { EvalError } from './util.mjs';

// This boundary records completed facts. It never judges screenshots, changes
// the agent's deadline, or manufactures a response for an unfinished stage.
export async function runAgentStage(runSubagent, spec, { recorder, signal, publicTask } = {}) {
  const handle = recorder?.begin(spec.role, { attempt: spec.attempt ?? 1 });
  let selfCheck;
  const timedSpec = { ...spec, _signal: signal,
    _onSelfCheck: evidence => { selfCheck = evidence; },
    ...(handle ? { stage_id: handle.id, _onLifecycle: event => recorder.lifecycle(handle, event) } : {}) };
  const observeSubmission = async () => handle && ['builder', 'debug'].includes(spec.role)
    ? runFrameworkStage('manifest', { workspace: spec.workspace, engine: spec.engine, taskId: spec.taskId,
      runId: recorder.runId, stageId: handle.id, publicTask,
      attempt: handle.attempt,
      manifestPath: path.join(recorder.dir, 'STAGES', `${handle.role}-${handle.attempt}-SUBMISSION.json`) }, { recorder, signal }) : null;
  let out, agentError = null;
  try {
    out = await runSubagent(timedSpec);
    if (out != null && typeof out !== 'string') {
      throw new EvalError('SUBAGENT_INVALID', 'subagent 只能返回标准输出文本。主进程不接收代写的源码对象。');
    }
  } catch (error) { agentError = error; }
  let submission;
  if (!agentError || isValidationFailure(agentError)) {
    try { submission = await observeSubmission(); }
    catch (observationError) {
      // A post-receipt infrastructure error does not rewrite what the agent
      // actually reported. Its separate manifest stage prevents scoring.
      recorder?.finish(handle, { error: agentError });
      throw observationError;
    }
  }
  if (!agentError && selfCheck && submission?.submission_id !== selfCheck.submission_id) {
    agentError = new EvalError('STAGE_VALIDATION_INCOMPLETE', 'submission changed after the validated success receipt', { self_check_session_id: selfCheck.session_id });
  }
  recorder?.finish(handle, { error: agentError, submissionId: submission?.submission_id, manifestPath: submission?.manifest_path,
    result: selfCheck ? { self_check: { session_id:selfCheck.session_id,submission_id:selfCheck.submission_id,
      reviewed_still_ids:selfCheck.reviewed_still_ids }, gameplay_review:'model_declaration' } : null });
  if (agentError) throw agentError;
  return out ?? '';
}

export async function runFrameworkStage(action, params, { recorder, signal, implementation } = {}) {
  const handle = recorder?.begin(action, { attempt: params.attempt ?? 1 });
  try {
    const value = implementation ? await implementation(params) : await runExecutionWorker(action, params, {
      signal, onLifecycle: handle ? event => recorder.lifecycle(handle, event) : undefined,
    });
    recorder?.finish(handle, { submissionId: value?.submission_id, manifestPath: value?.manifest_path, result: value ?? null });
    return value;
  } catch (error) {
    if (handle && !handle.terminal) recorder.finish(handle, { error });
    throw error;
  }
}

export async function settleStages(jobs) {
  // Await both branches before releasing ownership of their outputs, including
  // when a non-isolated caller receives a failure from one branch.
  const outcomes = await Promise.allSettled(jobs);
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  if (failed) throw failed.reason;
}
