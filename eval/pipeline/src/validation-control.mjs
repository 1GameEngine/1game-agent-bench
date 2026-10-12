import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeReport } from './report.mjs';
import { EvalError } from './util.mjs';

export const VALIDATION_TERMINAL = new Set(['COMPLETE', 'FAILED', 'INCOMPLETE', 'CANCELLED']);
export function validationIndexPath(timingPath) {
  return path.join(`${path.resolve(timingPath)}.validations`, 'INDEX.json');
}
export function readValidationIndex(timingPath, stageId) {
  const file = validationIndexPath(timingPath);
  if (!fs.existsSync(file)) return { schema: 'eval.validation-index/1', stage_id: stageId, sessions: [] };
  const index = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (index.schema !== 'eval.validation-index/1' || index.stage_id !== stageId || !Array.isArray(index.sessions)) {
    throw new EvalError('SUBAGENT_INVALID', 'validation index identity mismatch');
  }
  return index;
}

// A permanent inode and an inherited open-file description. Never reclaim a
// busy lock using PID guesses or unlink it, even after a supervisor crash.
export function acquireValidationSlot(timingPath, stageId, session) {
  const file = validationIndexPath(timingPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(path.join(path.dirname(file), 'active.lock'), 'a+');
  try {
    const locked = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
    });
    if (!locked.error && locked.status === 1) throw new EvalError('VALIDATION_BUSY', 'cancel and await the current validation before starting another');
    if (locked.error || locked.status !== 0) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'cannot acquire validation process lock');
    const index = readValidationIndex(timingPath, stageId);
    for (const entry of index.sessions) {
      const progress = JSON.parse(fs.readFileSync(entry.progress_path, 'utf8'));
      if (!VALIDATION_TERMINAL.has(progress.state) || !progress.cleanup_finished_at) {
        throw new EvalError('SUBAGENT_PROCESS_FAILED', 'previous validation has no confirmed terminal cleanup');
      }
    }
    const entry = { session_id: session.runId, progress_path: session.progressPath,
      artifact_dir: session.dir, cancel_path: path.join(session.dir, 'CANCEL.json'), token: randomBytes(16).toString('hex') };
    index.sessions.push(entry);
    writeReport(file, index);
    return { fd, entry, release: () => fs.closeSync(fd) };
  } catch (err) { fs.closeSync(fd); throw err; }
}

export function requestValidationCancel(ctx, sessionId) {
  const index = readValidationIndex(ctx.request.lifecycle.timing_path, ctx.timing.id);
  const entry = index.sessions.find(s => s.session_id === sessionId);
  if (!entry) throw new EvalError('SUBAGENT_INVALID', 'validation session does not belong to this stage');
  const progress = JSON.parse(fs.readFileSync(entry.progress_path, 'utf8'));
  if (progress.stage_id !== ctx.timing.id || progress.session_id !== sessionId) throw new EvalError('SUBAGENT_INVALID', 'validation cancellation identity mismatch');
  if (VALIDATION_TERMINAL.has(progress.state)) {
    if (!progress.cleanup_finished_at) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'terminal validation has no cleanup confirmation');
    return { session_id: sessionId, state: progress.state, cleanup_finished_at: progress.cleanup_finished_at };
  }
  writeReport(entry.cancel_path, { stage_id: ctx.timing.id, session_id: sessionId, token: entry.token });
  return { session_id: sessionId, state: 'CANCEL_REQUESTED', progress_path: entry.progress_path,
    meaning: 'Cancellation requested; await terminal progress and cleanup before another validation or publication.' };
}

export function validationBudget(ctx, taskId) {
  const index = readValidationIndex(ctx.request.lifecycle.timing_path, ctx.timing.id);
  let estimate = ctx.timing.engine === 'onegame' ? 240000 : 90000;
  const observations = [];
  for (const entry of index.sessions) {
    const p = JSON.parse(fs.readFileSync(entry.progress_path, 'utf8'));
    if (p.validation_mode === 'full' && p.state === 'COMPLETE' && p.ok === true && p.process_exit_status === 0 && p.process_started_at && p.cleanup_finished_at) {
      observations.push(Date.parse(p.cleanup_finished_at) - Date.parse(p.process_started_at));
    }
  }
  for (const previous of ctx.request.spec.debug_context?.validations ?? []) {
    if (previous.taskId === taskId && previous.completed_full_replay === true && Number.isFinite(previous.elapsed_ms)) observations.push(previous.elapsed_ms);
  }
  if (observations.length) estimate = Math.max(...observations);
  const reviewMs = 45000, safetyMs = 30000;
  return { schema: 'eval.validation-budget/1', estimated_full_validation_ms: estimate,
    estimate_source: observations.length ? 'same_task_observed' : 'conservative_default',
    review_reserve_ms: reviewMs, safety_margin_ms: safetyMs,
    final_validation_start_by: new Date(ctx.validationStopAt - estimate - reviewMs - safetyMs).toISOString(),
    validation_stop_at: new Date(ctx.validationStopAt).toISOString(), execution_deadline_at: ctx.timing.execution_deadline_at,
    meaning: 'Planning estimate, not an extended deadline or a guarantee of validation completion.' };
}
