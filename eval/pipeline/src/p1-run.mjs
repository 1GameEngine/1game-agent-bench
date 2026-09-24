import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from './paths.mjs';
import { P1_TASKS } from './p1-load.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { writeReport } from './report.mjs';
import { orchestrateEngines } from './subagent-stage.mjs';

export async function runP1Compare(suiteRunId = `p1-${Date.now()}`) {
  const attempts = [];
  for (const taskId of P1_TASKS) {
    process.stderr.write(`P1 staged ${taskId}\n`);
    const staged = await orchestrateEngines({ taskId, runId: `${suiteRunId}-${taskId}` });
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
  }
  const report = buildCompareScalar({ runId: suiteRunId, attempts });
  const dir = path.join(WORK_DIR, suiteRunId);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'COMPARE_SCALAR.json');
  writeReport(out, report);
  return { report, out };
}
