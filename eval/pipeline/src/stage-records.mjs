import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { isValidationFailure } from './stage-result.mjs';
import { writeReport } from './report.mjs';
import { EXECUTION_POLICY_REVISION } from './execution-policy.mjs';
import { EvalError } from './util.mjs';

export function stageOutcome({ role, error = null, evidenceStatus = 'NOT_APPLICABLE' }) {
  const validation = isValidationFailure(error);
  return {
    execution_status: !error || validation ? 'COMPLETED' : /(?:^|_)TIMEOUT$/.test(error.primary ?? '') ? 'TIMED_OUT' : 'FAILED',
    self_check_status: !['builder', 'debug'].includes(role) ? 'NOT_APPLICABLE'
      : !error ? 'REPORTED_PASS' : error.primary === 'STAGE_VALIDATION_INCOMPLETE' ? 'INCOMPLETE'
        : error.primary === 'GAME_VALIDATION_FAILED' ? 'REPORTED_FAIL' : 'UNAVAILABLE',
    evidence_status: evidenceStatus,
  };
}

// One recorder owns an engine's stage records. Events are diagnostic; immutable
// terminal records and accepted receipts remain the completed facts.
export class StageRecorder {
  constructor({ dir, runId, engine, taskId, onEvent, now = Date.now }) {
    Object.assign(this, { dir, runId, engine, taskId, onEvent, now });
    this.sequence = 0;
    fs.mkdirSync(path.join(dir, 'STAGES'), { recursive: true });
  }

  begin(role, { attempt = 1 } = {}) {
    const id = `${this.runId}:${this.engine}:${role}:${attempt}:${++this.sequence}`;
    const handle = { id, role, attempt, startedAt: this.now(), terminal: false,
      record: { schema: 'eval.stage-record/1', id, run_id: this.runId, task_id: this.taskId,
        engine: this.engine, role, attempt, execution_policy_revision: EXECUTION_POLICY_REVISION,
        state: 'QUEUED', queued_at: new Date(this.now()).toISOString() } };
    this.event(handle, 'QUEUED');
    return handle;
  }

  event(handle, state, fields = {}) {
    if (handle.terminal) throw new EvalError('EVAL_INTERNAL', 'terminal stage cannot transition');
    Object.assign(handle.record, fields, { state });
    const event = { schema: 'eval.stage-event/1', stage_id: handle.id, run_id: this.runId,
      engine: this.engine, task_id: this.taskId, role: handle.role, attempt: handle.attempt, state,
      observed_at: new Date(this.now()).toISOString(), ...fields };
    fs.appendFileSync(path.join(this.dir, 'STAGE_EVENTS.jsonl'), `${JSON.stringify(event)}\n`);
    writeReport(path.join(this.dir, 'STAGE_STATE.json'), handle.record);
    this.onEvent?.(event);
  }

  lifecycle(handle, event) {
    const { state = handle.record.state, id: requestId } = event;
    const keys = ['queued_at', 'started_at', 'finished_at', 'execution_deadline_at', 'wrap_up_at',
      'queue_deadline_at', 'queue_wait_ms', 'execution_elapsed_ms', 'response_published_at',
      'response_observed_at', 'execution_timeout_ms', 'queue_timeout_ms', 'closing_reserve_ms',
      'timeout_phase', 'primary', 'process_result', 'timing_path', 'archive_response_path',
      'execution_status', 'self_check_status', 'evidence_status'];
    const fields = Object.fromEntries(keys.filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]));
    // Never let the transport's legacy FAILED for self-check warnings become
    // the canonical execution status. finish() supplies the orthogonal axes.
    this.event(handle, state, { ...fields, ...(requestId ? { transport_request_id: requestId } : {}) });
  }

  finish(handle, { error = null, evidenceStatus = 'NOT_APPLICABLE', submissionId = null,
    manifestPath = null, artifactPath = null, result = null } = {}) {
    const outcome = stageOutcome({ role: handle.role, error, evidenceStatus });
    const state = outcome.execution_status === 'COMPLETED' ? 'COMPLETE' : outcome.execution_status;
    this.event(handle, state, { ...outcome, finished_at: handle.record.response_published_at
      ?? handle.record.finished_at ?? new Date(this.now()).toISOString(),
      primary: error?.primary ?? null, message: error ? String(error.message) : null,
      submission_id: submissionId, manifest_path: manifestPath, artifact_path: artifactPath, result_summary: result,
      process_result: error?.extra?.process_result ?? handle.record.process_result ?? null });
    const name = createHash('sha256').update(handle.id).digest('hex');
    const file = path.join(this.dir, 'STAGES', `${name}.json`);
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(handle.record, null, 2)}\n`, { flag: 'wx' });
      // link is an atomic no-replace publication, unlike rename on Linux.
      fs.linkSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
    handle.terminal = true;
    return { ...handle.record, record_path: file };
  }
}
