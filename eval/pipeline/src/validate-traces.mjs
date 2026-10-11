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

export async function validateStageTraces({ engine, taskId, workspace, scenario, timingPath, signal },
  { workerArgv = () => [process.execPath, fileURLToPath(import.meta.url)] } = {}) {
  const ctx = readStageContext(timingPath, { engine, taskId, workspace });
  if (!['builder', 'debug'].includes(ctx.timing.role)) throw new EvalError('SUBAGENT_INVALID', 'only builder/debug can validate traces');
  const session = validationSession();
  updateProgress(session, { state: 'QUEUED', engine, taskId, stage_id: ctx.timing.id,
    queued_at: stamp(), started_at: null, submission_id: null, manifest_path: null,
    execution_deadline_at: ctx.timing.execution_deadline_at, validation_stop_at: new Date(ctx.validationStopAt).toISOString() });
  // This entry point is the supervised worker itself. Engine children inherit
  // its process group; there is no nested supervisor or detached child group.
  const request = { engine, taskId, workspace, scenario, validationRunId: session.runId, stageId: ctx.timing.id };
  const argv = workerArgv({ ...request, artifactDir: session.dir, progressPath: session.progressPath });
  const controller = new AbortController();
  let inactiveReason = null;
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
    } catch { inactiveReason = 'validation stage lifecycle became unavailable'; controller.abort(); }
  }, 100);
  let result;
  try {
    result = await runValidationProcess(argv, { stopAt: ctx.validationStopAt, signal: controller.signal,
      input: JSON.stringify(request), graceMs: Math.min(5000, Math.floor(ctx.timing.closing_reserve_ms / 4)) });
  } catch (err) {
    const failure = inactiveReason ? new EvalError('SUBAGENT_PROCESS_FAILED', inactiveReason, err.extra ?? {}) : err;
    updateProgress(session, { state: 'FAILED', ...processObservation(err.extra?.process_result),
      primary: failure.primary ?? 'SUBAGENT_PROCESS_FAILED', message: failure.message });
    throw failure;
  } finally {
    clearInterval(poll);
    signal?.removeEventListener('abort', cancel);
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
      if (report.schema !== 'eval.trace-validation/1' || result.status !== (report.ok ? 0 : 1)) throw new Error('invalid validation result');
      Object.assign(report, processFields);
      writeReport(path.join(session.dir, 'VALIDATION.json'), report);
      updateProgress(session, { state: 'COMPLETE', ...processFields });
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
  const report = { schema: 'eval.trace-validation/1', diagnostic_only: true, engine, taskId, ok: false,
    submission_id: progress.submission_id ?? null, manifest_path: progress.manifest_path ?? null,
    snapshot_kind: progress.snapshot_kind ?? null, progress_path: session.progressPath, ...processFields,
    primary: 'STAGE_VALIDATION_INCOMPLETE',
    failure: { kind: 'validation_incomplete', message: '验证为预留归档时间已自动停止，全部验证进程已退出；最终自查尚未完成，不能声明通过。' },
    execution_deadline_at: ctx.timing.execution_deadline_at,
    validation_stop_at: new Date(ctx.validationStopAt).toISOString(), artifact_dir: dir };
  writeReport(path.join(dir, 'VALIDATION.json'), report);
  updateProgress(session, { state: 'INCOMPLETE', ...processFields });
  return report;
}

export function validateTraces({ engine, taskId, workspace, scenario, validationRunId, stageId = null } = {}) {
  if (!TASK_IDS.includes(taskId) || !['onegame', 'godot'].includes(engine) || !workspace) {
    throw new EvalError('EVAL_INTERNAL', 'validate-traces needs a supported engine, public task id and workspace');
  }
  // Only public input/trace policy. Do not load a scoring rubric for self-checks.
  const task = loadYaml(path.join(taskDir(taskId), 'task.yaml'));
  if (scenario && !task.scenarios.required.includes(scenario)) throw new EvalError('TRACE_INVALID', 'unknown scenario');
  const session = validationSession(validationRunId);
  const { runId, dir } = session;
  updateProgress(session, { state: 'COPYING_SUBMISSION', engine, taskId, stage_id: stageId, started_at: stamp() });
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
  if (scenario) {
    for (const file of fs.readdirSync(path.join(copy, 'demo_outputs'))) {
      if (!file.endsWith('.json')) continue;
      const trace = JSON.parse(fs.readFileSync(path.join(copy, 'demo_outputs', file), 'utf8'));
      if (trace.scenario !== scenario) fs.unlinkSync(path.join(copy, 'demo_outputs', file));
    }
  }
  const submission = writeSubmissionManifest(path.join(dir, 'SUBMISSION.json'), createSubmissionManifest({
    workspace: copy, engine, taskId, runId, stageId, snapshotKind: 'candidate_snapshot', publicTask: task,
  }));
  updateProgress(session, { state: 'REPLAYING', ...submission });
  const replay = runTraceReplay({ engine, taskId, workspace: copy, runId, task, finalOnly: true });
  const expected = scenario ? [scenario] : task.scenarios.required;
  const completed = replay.replayed_scenarios ?? [];
  const report = {
    schema: 'eval.trace-validation/1', diagnostic_only: true,
    ...submission,
    progress_path: session.progressPath,
    engine, taskId, primary: replay.primary,
    ok: replay.G && expected.every((name) => completed.includes(name)) && replay.stills.every((s) => s.ok),
    expected_scenarios: expected, replayed_scenarios: completed,
    notes: replay.notes, stills: replay.stills, artifact_dir: dir,
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
