import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR, oracleGodot } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { P1_TASKS, loadP1Task } from './p1-load.mjs';
import { runOnegameTraces } from './p1-onegame.mjs';
import { stageGodotProject, runGodotJob, makeTraceJob, judgeTraceEvents } from './p1-godot.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { writeReport } from './report.mjs';
import { readTraces } from './p1-trace.mjs';

export function runP1OnegameTask(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const boot = bootstrap({
    taskId,
    runId: `${runId}-og`,
    instruction: bundle.instruction,
    oracle: true,
  });
  const replay = runOnegameTraces({ gameDir: boot.gameDir });
  return { id: taskId, engine: 'onegame', primary: replay.primary, g0_ok: replay.g0_ok, notes: replay.notes };
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
  const traces = readTraces(path.join(staged.dest, 'demo_outputs'));
  const job = runGodotJob({
    projectDir: staged.dest,
    job: makeTraceJob({ traces }),
    outPath: path.join(outDir, 'traces.jsonl'),
    timeoutMs: 180_000,
  });
  const judged = judgeTraceEvents(job.events || []);
  if (job.ok === false) {
    judged.primary = job.code || judged.primary || 'BOOT_FAIL';
    judged.notes = [...(judged.notes ?? []), ...(job.notes ?? [])];
  }
  return { id: taskId, engine: 'godot', primary: judged.primary, g0_ok: judged.g0_ok, notes: judged.notes };
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
