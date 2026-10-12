import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WORK_DIR, taskDir } from './paths.mjs';
import { loadYaml } from './load.mjs';
import { assertSubmission } from './model-builder.mjs';
import { runTraceReplay } from './stage-replay.mjs';
import { EvalError } from './util.mjs';
import { writeReport } from './report.mjs';
import { readStageContext } from './stage-close.mjs';
import { runValidationProcess } from './validation-process.mjs';
import { createSubmissionManifest, writeSubmissionManifest } from './submission-manifest.mjs';
import { diagnosticPlan } from './validation-plan.mjs';
import { readTraces, tracePolicy } from './p1-trace.mjs';
import { acquireValidationSlot, validationIndexPath, requestValidationCancel, validationBudget, VALIDATION_TERMINAL } from './validation-control.mjs';

const TASK_IDS = ['p1-chart-rush', 'p1-depot-skirmish', 'p1-tower-defense', 'p1-slide-puzzle'];
const stamp = () => new Date().toISOString();

function validationSession(runId = `validation-${Date.now()}-${randomBytes(6).toString('hex')}`) {
  if (!/^validation-\d+-[a-f0-9]{12}$/.test(runId)) throw new EvalError('SUBAGENT_INVALID', 'invalid validation session id');
  const dir = path.join(WORK_DIR, runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir, progressPath: path.join(dir, 'PROGRESS.json') };
}

function updateProgress(session, fields) {
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(session.progressPath, 'utf8')); } catch { /* First observation. */ }
  const record = { ...previous, schema: 'eval.validation-progress/1', session_id: session.runId,
    diagnostic_only: true, artifact_dir: session.dir, ...fields, updated_at: stamp() };
  fs.appendFileSync(path.join(session.dir, 'VALIDATION_EVENTS.jsonl'), `${JSON.stringify(record)}\n`);
  writeReport(session.progressPath, record);
  return record;
}

function processObservation(result) {
  if (!result) return {};
  return { process_started_at: result.started_at, process_finished_at: result.finished_at,
    cleanup_finished_at: result.cleanup_finished_at, cleanup_attempt_finished_at: result.cleanup_attempt_finished_at,
    descendants_cleaned: result.descendants_cleaned, process_exit_status: result.status,
    process_signal: result.signal, process_stop_reason: result.reason };
}

export async function validateStageTraces(options,
  { workerArgv = () => [process.execPath, fileURLToPath(import.meta.url)], notify = event => process.stderr.write(`VALIDATION_PROGRESS ${JSON.stringify(event)}\n`) } = {}) {
  const { engine, taskId, workspace, scenario, timingPath } = options;
  const ctx = readStageContext(timingPath, { engine, taskId, workspace });
  if (!['builder', 'debug'].includes(ctx.timing.role)) throw new EvalError('SUBAGENT_INVALID', 'only builder/debug can validate traces');
  const session = validationSession();
  updateProgress(session, { state: 'QUEUED', engine, taskId, stage_id: ctx.timing.id,
    queued_at: stamp(), started_at: null, submission_id: null, manifest_path: null,
    workspace: path.resolve(workspace), validation_mode: scenario || options.untilFrame != null || options.checkpoints != null ? 'diagnostic' : 'full',
    execution_deadline_at: ctx.timing.execution_deadline_at, validation_stop_at: new Date(ctx.validationStopAt).toISOString() });
  let slot;
  try {
    slot = acquireValidationSlot(timingPath, ctx.timing.id, session);
    writeReport(path.join(session.dir,'FEEDBACK.json'), { schema:'eval.validation-feedback/1',session_id:session.runId,stage_id:ctx.timing.id,events:[] });
    notify({ event: 'session_started', session_id: session.runId, stage_id: ctx.timing.id, artifact_dir: session.dir,
      progress_path: session.progressPath, feedback_path: path.join(session.dir, 'FEEDBACK.json'),
      sessions_path: validationIndexPath(timingPath), budget: validationBudget(ctx, taskId) });
    return await superviseStageValidation(options, { workerArgv, notify, ctx, session, slot });
  } catch (err) {
    const progress = JSON.parse(fs.readFileSync(session.progressPath, 'utf8'));
    if (!VALIDATION_TERMINAL.has(progress.state)) updateProgress(session, { state: 'FAILED', primary: err.primary ?? 'SUBAGENT_PROCESS_FAILED',
      message: err.message, ...(!slot ? { process_started_at: null, process_finished_at: stamp(), cleanup_finished_at: stamp() } : {}) });
    throw err;
  } finally { slot?.release(); }
}

export async function cancelStageValidation({ timingPath, sessionId }) {
  const ctx = readStageContext(timingPath);
  if (!['builder','debug'].includes(ctx.timing.role)) throw new EvalError('SUBAGENT_INVALID', 'only builder/debug can cancel their validation');
  const requested = requestValidationCancel(ctx, sessionId);
  if (requested.state !== 'CANCEL_REQUESTED') return requested;
  const end = Math.min(ctx.deadline, Date.now() + 10000);
  while (Date.now() < end) {
    const p = JSON.parse(fs.readFileSync(requested.progress_path, 'utf8'));
    if (VALIDATION_TERMINAL.has(p.state)) {
      if (!p.cleanup_finished_at) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'cancelled validation cleanup is unconfirmed');
      return { session_id: sessionId, state: p.state, cleanup_finished_at: p.cleanup_finished_at };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new EvalError('SUBAGENT_PROCESS_FAILED', 'validation cancellation cleanup was not confirmed; do not publish or start another validation');
}

async function superviseStageValidation({ engine, taskId, workspace, scenario, timingPath, signal, untilFrame, checkpoints },
  { workerArgv, notify, ctx, session, slot }) {
  // This entry point is the supervised worker itself. Engine children inherit
  // its process group; there is no nested supervisor or detached child group.
  const request = { engine, taskId, workspace, scenario, untilFrame, checkpoints, validationRunId: session.runId, stageId: ctx.timing.id };
  const argv = workerArgv({ ...request, artifactDir: session.dir, progressPath: session.progressPath });
  const controller = new AbortController();
  let inactiveReason = null;
  let cancelled = false, feedbackOffset = 0;
  const feedbackFile = path.join(session.dir, 'FEEDBACK.jsonl');
  const feedback = { schema: 'eval.validation-feedback/1', session_id: session.runId, stage_id: ctx.timing.id, events: [] };
  const flushFeedback = () => {
    if (!fs.existsSync(feedbackFile)) return;
    const text = fs.readFileSync(feedbackFile, 'utf8');
    const end = text.lastIndexOf('\n') + 1;
    for (const line of text.slice(feedbackOffset, end).split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      const progress = JSON.parse(fs.readFileSync(session.progressPath, 'utf8'));
      const observed = { ...event, session_id: session.runId, submission_id: progress.submission_id ?? null };
      feedback.events.push(observed); notify(observed);
    }
    feedbackOffset = end;
    writeReport(path.join(session.dir, 'FEEDBACK.json'), feedback);
  };
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const poll = setInterval(() => {
    try {
      const current = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
      if (current.schema !== 'eval.cloud-stage-timing/1' || current.id !== ctx.timing.id ||
          current.engine !== engine || current.taskId !== taskId || current.role !== ctx.timing.role ||
          !['QUEUED', 'RUNNING'].includes(current.state)) {
        inactiveReason = 'validation stage became inactive or changed identity'; controller.abort();
      }
      if (fs.existsSync(slot.entry.cancel_path)) {
        const cancel = JSON.parse(fs.readFileSync(slot.entry.cancel_path, 'utf8'));
        if (cancel.stage_id !== ctx.timing.id || cancel.session_id !== session.runId || cancel.token !== slot.entry.token) throw new Error('invalid cancellation identity');
        cancelled = true; controller.abort();
      }
      flushFeedback();
    } catch { inactiveReason = 'validation stage lifecycle became unavailable'; controller.abort(); }
  }, 100);
  let result;
  try {
    result = await runValidationProcess(argv, { stopAt: ctx.validationStopAt, signal: controller.signal,
      input: JSON.stringify(request), inheritedFd: slot.fd, graceMs: Math.min(5000, Math.floor(ctx.timing.closing_reserve_ms / 4)) });
  } catch (err) {
    if (cancelled && !inactiveReason && err.extra?.process_result?.cleanup_finished_at) {
      const report = { schema: 'eval.trace-validation/2', diagnostic_only: true, ok: false, engine, taskId,
        workspace: path.resolve(workspace), primary: 'VALIDATION_CANCELLED',
        ...JSON.parse(fs.readFileSync(session.progressPath, 'utf8')), ...processObservation(err.extra.process_result), artifact_dir: session.dir };
      report.schema = 'eval.trace-validation/2'; report.primary = 'VALIDATION_CANCELLED';
      report.ok = false; report.state = 'CANCELLED';
      writeReport(path.join(session.dir, 'VALIDATION.json'), report);
      updateProgress(session, { state: 'CANCELLED', ...processObservation(err.extra.process_result), cancellation_reason: 'agent_requested' });
      notify({ event: 'session_cancelled', session_id: session.runId, cleanup_finished_at: report.cleanup_finished_at });
      return report;
    }
    const failure = inactiveReason ? new EvalError('SUBAGENT_PROCESS_FAILED', inactiveReason, err.extra ?? {}) : err;
    updateProgress(session, { state: 'FAILED', ...processObservation(err.extra?.process_result),
      primary: failure.primary ?? 'SUBAGENT_PROCESS_FAILED', message: failure.message });
    throw failure;
  } finally {
    clearInterval(poll);
    signal?.removeEventListener('abort', cancel);
  }
  try { flushFeedback(); }
  catch(err) {
    updateProgress(session,{state:'FAILED',...processObservation(result),primary:'SUBAGENT_PROCESS_FAILED',message:'validation feedback is invalid'});
    throw new EvalError('SUBAGENT_PROCESS_FAILED',`invalid validation feedback: ${err.message}`);
  }
  const progress = JSON.parse(fs.readFileSync(session.progressPath, 'utf8'));
  if (progress.schema !== 'eval.validation-progress/1' || progress.session_id !== session.runId ||
      progress.engine !== engine || progress.taskId !== taskId || progress.stage_id !== ctx.timing.id) {
    throw new EvalError('SUBAGENT_PROCESS_FAILED', 'validation progress identity mismatch');
  }
  const processFields = processObservation(result);
  if (!result.stopped) {
    try {
      const report = JSON.parse(result.stdout);
      if (!['eval.trace-validation/1','eval.trace-validation/2'].includes(report.schema) || result.status !== (report.ok ? 0 : 1)) throw new Error('invalid validation result');
      Object.assign(report, processFields);
      writeReport(path.join(session.dir, 'VALIDATION.json'), report);
      updateProgress(session, { state: 'COMPLETE', ...processFields });
      notify({ event: 'session_finished', session_id: session.runId, ok: report.ok, progress_path: session.progressPath });
      return report;
    } catch (err) {
      const failure = new EvalError('SUBAGENT_PROCESS_FAILED', `validation worker failed: ${result.stderr || err.message}`);
      updateProgress(session, { state: 'FAILED', ...processFields, primary: failure.primary, message: failure.message });
      throw failure;
    }
  }
  const dir = session.dir;
  fs.writeFileSync(path.join(dir, 'stdout.log'), result.stdout);
  fs.writeFileSync(path.join(dir, 'stderr.log'), result.stderr);
  const report = { schema: 'eval.trace-validation/2', diagnostic_only: true, engine, taskId, ok: false,
    workspace: path.resolve(workspace), validation_mode: progress.validation_mode,
    submission_id: progress.submission_id ?? null, manifest_path: progress.manifest_path ?? null,
    snapshot_kind: progress.snapshot_kind ?? null, progress_path: session.progressPath, ...processFields,
    primary: 'STAGE_VALIDATION_INCOMPLETE',
    failure: { kind: 'validation_incomplete', message: '验证为预留归档时间已自动停止，全部验证进程已退出；最终自查尚未完成，不能声明通过。' },
    execution_deadline_at: ctx.timing.execution_deadline_at,
    validation_stop_at: new Date(ctx.validationStopAt).toISOString(), artifact_dir: dir };
  writeReport(path.join(dir, 'VALIDATION.json'), report);
  updateProgress(session, { state: 'INCOMPLETE', ...processFields });
  notify({ event: 'session_incomplete', session_id: session.runId, cleanup_finished_at: result.cleanup_finished_at });
  return report;
}

export function validateTraces({ engine, taskId, workspace, scenario, untilFrame, checkpoints, validationRunId, stageId = null } = {},
  { replay = runTraceReplay } = {}) {
  if (!TASK_IDS.includes(taskId) || !['onegame', 'godot'].includes(engine) || !workspace) {
    throw new EvalError('EVAL_INTERNAL', 'validate-traces needs a supported engine, public task id and workspace');
  }
  // Only public input/trace policy. Do not load a scoring rubric for self-checks.
  const task = loadYaml(path.join(taskDir(taskId), 'task.yaml'));
  if (scenario && !task.scenarios.required.includes(scenario)) throw new EvalError('TRACE_INVALID', 'unknown scenario');
  const session = validationSession(validationRunId);
  const { runId, dir } = session;
  updateProgress(session, { state: 'COPYING_SUBMISSION', engine, taskId, stage_id: stageId, workspace: path.resolve(workspace), started_at: stamp() });
  const copy = path.join(dir, 'submission');
  const excluded = new Set(['node_modules', '.git', '.godot', 'out', 'work', '.validation']);
  fs.cpSync(path.resolve(workspace), copy, {
    recursive: true,
    filter: (src) => !excluded.has(path.relative(path.resolve(workspace), src).split(path.sep)[0]),
  });
  if (engine === 'onegame') {
    fs.symlinkSync(path.join(path.resolve(workspace), 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  }
  updateProgress(session, { state: 'AUDITING_SUBMISSION' });
  assertSubmission(copy, engine, task);
  const plan = diagnosticPlan(readTraces(path.join(copy, 'demo_outputs'), tracePolicy(task)), { scenario, untilFrame, checkpoints });
  const submission = writeSubmissionManifest(path.join(dir, 'SUBMISSION.json'), createSubmissionManifest({
    workspace: copy, engine, taskId, runId, stageId, snapshotKind: 'candidate_snapshot', publicTask: task,
  }));
  updateProgress(session, { state: 'REPLAYING', ...submission, validation_mode: plan.mode });
  const feedbackPath = path.join(dir, 'FEEDBACK.jsonl');
  const replayed = replay({ engine, taskId, workspace: copy, runId, task, finalOnly: true,
    tracesOverride: plan.traces, sampleFrames: plan.checkpoints, feedbackPath,
    onFeedback: event => fs.appendFileSync(feedbackPath, `${JSON.stringify(event)}\n`) });
  const expected = scenario ? [scenario] : task.scenarios.required;
  const completed = replayed.replayed_scenarios ?? [];
  const report = {
    schema: 'eval.trace-validation/2', diagnostic_only: true,
    workspace: path.resolve(workspace), stage_id: stageId, validation_mode: plan.mode,
    diagnostic_plan: { scenario: plan.scenario, until_frame: plan.until_frame, checkpoints: plan.checkpoints },
    trace_frames: Object.fromEntries(plan.traces.map(item=>[item.trace.scenario,item.trace.duration_frames])),
    ...submission,
    progress_path: session.progressPath,
    engine, taskId, primary: replayed.primary,
    ok: replayed.G && expected.every((name) => completed.includes(name)) && replayed.stills.every((s) => s.ok),
    expected_scenarios: expected, replayed_scenarios: completed,
    notes: replayed.notes, stills: replayed.stills, artifact_dir: dir,
    meaning: '运行成功仅说明轨迹合法、可启动并执行，不证明玩法或终局符合题面；请检查起止静帧。此报告不是正式重放回执或评分。',
  };
  writeReport(path.join(dir, 'VALIDATION.json'), report);
  updateProgress(session, { state: 'COMPLETE', completed_at: stamp(), ok: report.ok,
    expected_scenarios: expected, replayed_scenarios: completed });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = validateTraces(JSON.parse(fs.readFileSync(0, 'utf8')));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } catch (err) {
    process.stderr.write(`${err.primary ?? 'EVAL_INTERNAL'}: ${err.message}\n`);
    process.exitCode = 1;
  }
}
