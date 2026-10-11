import path from 'node:path';
import { WORK_DIR } from './paths.mjs';
import { P1_TASKS } from './p1-load.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { initializeReportStore, commitReportCheckpoint, createSuiteProgressWriter } from './report-store.mjs';
import { executionPolicy, EXECUTION_POLICY_REVISION } from './execution-policy.mjs';
import { orchestrateEngines } from './subagent-stage.mjs';
import { EvalError } from './util.mjs';

export async function runP1Compare(suiteRunId = `p1-${Date.now()}`, { orchestrate = orchestrateEngines, workDir = WORK_DIR, signal, onStageEvent } = {}) {
  initializeReportStore(suiteRunId, { workDir, kind: 'compare', executionPolicy: { ...executionPolicy(), revision: EXECUTION_POLICY_REVISION } });
  const recordProgress = createSuiteProgressWriter(suiteRunId, { workDir });
  const attempts = [];
  const failures = [];
  const warnings = [];
  const dir = path.join(workDir, suiteRunId);
  const taskResults = {};
  const out = path.join(dir, 'COMPARE_SCALAR.json');
  const checkpoint = (status) => {
    const report = buildCompareScalar({ runId: suiteRunId, attempts });
    report.status = status;
    report.failures = failures;
    report.stage_warnings = warnings;
    const record = commitReportCheckpoint(suiteRunId, { workDir, input: { attempts }, taskResults,
      reports: { 'COMPARE_SCALAR.json': report,
        'RUN_STATE.json': { runId: suiteRunId, status, failures, stage_warnings: warnings, completed_task_count: Object.keys(taskResults).length } },
    });
    return { report: record.reports['COMPARE_SCALAR.json'], out, generationId: record.generation_id };
  };
  checkpoint('RUNNING');
  try {
    for (const taskId of P1_TASKS) {
      if (signal?.aborted) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'suite interrupted');
      process.stderr.write(`P1 staged ${taskId}\n`);
      const staged = await orchestrate({ taskId, runId: `${suiteRunId}-${taskId}`, isolateFailures: true, signal,
        onStageEvent: (event) => { recordProgress(event); onStageEvent?.(event); } });
      failures.push(...staged.failures);
      warnings.push(...(staged.warnings ?? []));
      const taskAttempts = [];
      for (const engine of ['onegame', 'godot']) {
        const replay = staged[engine].replay;
        const attempt = replay.attempt ?? {
          id: taskId,
          engine,
          primary: replay.primary,
          g0_ok: replay.g0_ok,
          notes: replay.notes,
        };
        process.stderr.write(`  ${engine} -> ${attempt.primary} g0=${attempt.g0_ok}\n`);
        attempts.push(attempt);
        taskAttempts.push(attempt);
      }
      taskResults[taskId] = { taskId, attempts: taskAttempts, failures: staged.failures, stage_warnings: staged.warnings ?? [] };
      checkpoint('RUNNING');
    }
    return checkpoint(failures.length ? 'FAILED' : 'COMPLETE');
  } catch (err) {
    failures.push({ stage: 'suite', primary: err.primary || 'EVAL_INTERNAL', message: String(err.message || err) });
    checkpoint('FAILED');
    throw err;
  }
}
