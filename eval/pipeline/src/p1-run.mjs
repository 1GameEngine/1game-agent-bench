import path from 'node:path';
import { WORK_DIR } from './paths.mjs';
import { P1_TASKS } from './p1-load.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { writeReport } from './report.mjs';
import { orchestrateEngines } from './subagent-stage.mjs';

export async function runP1Compare(suiteRunId = `p1-${Date.now()}`) {
  const attempts = [];
  const failures = [];
  const dir = path.join(WORK_DIR, suiteRunId);
  const out = path.join(dir, 'COMPARE_SCALAR.json');
  const checkpoint = (status) => {
    const report = buildCompareScalar({ runId: suiteRunId, attempts });
    report.status = status;
    report.failures = failures;
    writeReport(out, report);
    return { report, out };
  };
  checkpoint('RUNNING');
  try {
    for (const taskId of P1_TASKS) {
      process.stderr.write(`P1 staged ${taskId}\n`);
      const staged = await orchestrateEngines({ taskId, runId: `${suiteRunId}-${taskId}`, isolateFailures: true });
      failures.push(...staged.failures);
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
      }
      checkpoint('RUNNING');
    }
    return checkpoint(failures.length ? 'FAILED' : 'COMPLETE');
  } catch (err) {
    failures.push({ stage: 'suite', primary: err.primary || 'EVAL_INTERNAL', message: String(err.message || err) });
    checkpoint('FAILED');
    throw err;
  }
}
