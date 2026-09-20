import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR, oracleGodot } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { P1_TASKS, loadP1Task } from './p1-load.mjs';
import { runOnegamePlayplan } from './p1-onegame.mjs';
import { stageGodotProject, runGodotJob, makeJob, judgeGodotEvents } from './p1-godot.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { writeReport } from './report.mjs';

function mergePlanResults(pos, neg) {
  if (pos.g0_ok !== 1) return pos;
  if (neg.g0_ok !== 1) return neg;
  if (pos.primary !== 'CHECKPOINTS_OK') return pos;
  if (neg.primary !== 'CHECKPOINTS_OK') return neg;
  return { primary: 'CHECKPOINTS_OK', g0_ok: 1, notes: [] };
}

export function runP1OnegameTask(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const boot = bootstrap({
    taskId,
    runId: `${runId}-og`,
    instruction: bundle.instruction,
    oracle: true,
  });
  const pos = runOnegamePlayplan({ gameDir: boot.gameDir, bundle, steps: bundle.playplan.steps });
  const neg = runOnegamePlayplan({ gameDir: boot.gameDir, bundle, steps: bundle.playplanNeg.steps });
  return { id: taskId, engine: 'onegame', ...mergePlanResults(pos, neg), pos, neg };
}

export function runP1GodotTask(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const staged = stageGodotProject({
    taskId,
    runId: `${runId}-gd`,
    srcDir: oracleGodot(taskId),
  });
  if (staged.tamper) return { id: taskId, engine: 'godot', primary: 'INJECT_TAMPER', g0_ok: 0, notes: ['EvalProbe tamper'] };
  if (staged.leak.length) return { id: taskId, engine: 'godot', primary: 'HARNESS_LEAK', g0_ok: 0, notes: staged.leak };

  const outDir = path.join(WORK_DIR, `${runId}-gd`);
  const posJob = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplan.steps }),
    outPath: path.join(outDir, 'pos.jsonl'),
  });
  const pos = judgeGodotEvents(posJob.events, bundle, 'pos');
  const negJob = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplanNeg.steps }),
    outPath: path.join(outDir, 'neg.jsonl'),
  });
  const neg = judgeGodotEvents(negJob.events, bundle, 'neg');
  return { id: taskId, engine: 'godot', ...mergePlanResults(pos, neg), pos, neg };
}

export function runP1Compare(suiteRunId = `p1-${Date.now()}`) {
  const attempts = [];
  for (const taskId of P1_TASKS) {
    process.stderr.write(`P1 onegame ${taskId}\n`);
    const og = runP1OnegameTask(taskId, `${suiteRunId}-${taskId}`);
    process.stderr.write(`  -> ${og.primary} g0=${og.g0_ok} ${(og.notes || []).join('; ')}\n`);
    attempts.push(og);
    process.stderr.write(`P1 godot ${taskId}\n`);
    const gd = runP1GodotTask(taskId, `${suiteRunId}-${taskId}`);
    process.stderr.write(`  -> ${gd.primary} g0=${gd.g0_ok} ${(gd.notes || []).join('; ')}\n`);
    attempts.push(gd);
  }
  const report = buildCompareScalar({ runId: suiteRunId, attempts });
  const dir = path.join(WORK_DIR, suiteRunId);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'COMPARE_SCALAR.json');
  writeReport(out, report);
  return { report, out };
}
