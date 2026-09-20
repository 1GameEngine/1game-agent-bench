import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR, oracleGodot } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { loadTaskBundle } from './load.mjs';
import { replayJudgeHygiene } from './replay.mjs';
import { loadP0GodotTask } from './p0-godot.mjs';
import { runOnegamePlayplan } from './p1-onegame.mjs';
import { stageGodotProject, runGodotJob, makeJob, judgeGodotEvents } from './p1-godot.mjs';
import { scanHygiene } from './hygiene.mjs';
import { primaryOf } from './verdict.mjs';
import { scoreVisuals } from './looks.mjs';
import {
  P0_TASKS,
  P1_TASKS,
  DEPTH_TASKS,
  hasDepth,
  scoreAttempt,
  buildProduct100,
  zeroRow,
} from './product-100.mjs';
import { buildReport, writeReport } from './report.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { assertNoForbiddenScoreKeys } from './util.mjs';

function mergePlanResults(pos, neg) {
  if (pos.g0_ok !== 1) return pos;
  if (neg.g0_ok !== 1) return neg;
  if (pos.primary !== 'CHECKPOINTS_OK') return pos;
  if (neg.primary !== 'CHECKPOINTS_OK') return neg;
  return { primary: 'CHECKPOINTS_OK', g0_ok: 1, notes: [] };
}

async function visualsFor(taskId, geometry, stills) {
  const keys = DEPTH_TASKS[taskId];
  const depthKeys = Array.isArray(keys) && keys.length ? keys : undefined;
  const okStills = (stills ?? []).filter((s) => s.ok);
  const vis = await scoreVisuals({ stills: okStills, geometry, depthKeys });
  let D;
  if (hasDepth(taskId)) {
    D = depthKeys ? vis.D_visual ?? 0 : vis.V;
  }
  return { V: vis.V, A: vis.A, D, looks_status: vis.looks_status };
}

export async function scoreP0Onegame(taskId, runId) {
  const bundle = loadTaskBundle(taskId);
  const stillsDir = path.join(WORK_DIR, runId, 'stills');
  const boot = bootstrap({
    taskId,
    runId,
    instruction: bundle.instruction,
    oracle: true,
  });
  const result = replayJudgeHygiene({
    gameDir: boot.gameDir,
    bundle,
    stillsDir,
  });
  const G =
    result.create_ok === 1 &&
    result.argv_ok === 1 &&
    result.hygiene_ok === 1 &&
    !result.bindstore_empty;
  const vis = G ? await visualsFor(taskId, bundle.geometry, result.stills) : { V: 0, A: 0, D: 0, looks_status: 'SKIP' };
  const row = scoreAttempt({
    id: taskId,
    engine: 'onegame',
    G,
    sliceScores: result.sliceScores,
    V: vis.V,
    A: vis.A,
    D: vis.D,
    primary: primaryOf(result),
    g0_ok: result.create_ok === 1 && !result.bindstore_empty ? 1 : 0,
    looks_status: vis.looks_status,
    stills: result.stills,
  });
  return { row, mechanical: result };
}

export async function scoreP0Godot(taskId, runId) {
  const src = oracleGodot(taskId);
  if (!fs.existsSync(path.join(src, 'project.godot'))) {
    return zeroRow(taskId, 'godot', 'ENGINE_TASK_UNSUPPORTED');
  }
  const bundle = loadP0GodotTask(taskId);
  const staged = stageGodotProject({
    taskId,
    runId: `${runId}-gd`,
    srcDir: src,
  });
  if (staged.tamper) return zeroRow(taskId, 'godot', 'INJECT_TAMPER');
  if (staged.leak.length) return zeroRow(taskId, 'godot', 'HARNESS_LEAK');
  const outDir = path.join(WORK_DIR, `${runId}-gd`);
  const stillsDir = path.join(outDir, 'stills');
  const job = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplan.steps, stillsDir }),
    outPath: path.join(outDir, 'pos.jsonl'),
  });
  const judged = judgeGodotEvents(job.events || [], bundle, 'pos', stillsDir);
  if (job.ok === false) {
    judged.primary = job.code || 'BOOT_FAIL';
    judged.g0_ok = 0;
    judged.notes = job.notes;
  }
  const G = judged.g0_ok === 1;
  const vis = G ? await visualsFor(taskId, bundle.geometry, judged.stills) : { V: 0, A: 0, D: 0, looks_status: 'SKIP' };
  return scoreAttempt({
    id: taskId,
    engine: 'godot',
    G,
    sliceScores: judged.sliceScores,
    V: vis.V,
    A: vis.A,
    D: vis.D,
    primary: judged.primary,
    g0_ok: judged.g0_ok,
    looks_status: vis.looks_status,
    stills: judged.stills,
  });
}

export async function scoreP1Onegame(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const boot = bootstrap({
    taskId,
    runId: `${runId}-og`,
    instruction: bundle.instruction,
    oracle: true,
  });
  const hyg = scanHygiene({ gameDir: boot.gameDir });
  const posDir = path.join(WORK_DIR, `${runId}-og`, 'stills-pos');
  const pos = runOnegamePlayplan({
    gameDir: boot.gameDir,
    bundle,
    steps: bundle.playplan.steps,
    stillsDir: posDir,
  });
  const neg = runOnegamePlayplan({
    gameDir: boot.gameDir,
    bundle,
    steps: bundle.playplanNeg.steps,
  });
  const merged = mergePlanResults(pos, neg);
  const G = pos.g0_ok === 1 && hyg.ok;
  const vis = G ? await visualsFor(taskId, bundle.geometry, pos.stills) : { V: 0, A: 0, D: 0, looks_status: 'SKIP' };
  const row = scoreAttempt({
    id: taskId,
    engine: 'onegame',
    G,
    sliceScores: pos.sliceScores,
    negSliceScores: neg.sliceScores,
    V: vis.V,
    A: vis.A,
    D: vis.D,
    primary: hyg.ok ? merged.primary : 'HYGIENE_FAIL',
    g0_ok: pos.g0_ok,
    looks_status: vis.looks_status,
    stills: pos.stills,
  });
  return { row, attempt: { id: taskId, engine: 'onegame', ...merged, pos, neg, g0_ok: pos.g0_ok } };
}

export async function scoreP1Godot(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const staged = stageGodotProject({
    taskId,
    runId: `${runId}-gd`,
    srcDir: oracleGodot(taskId),
  });
  if (staged.tamper) {
    const row = zeroRow(taskId, 'godot', 'INJECT_TAMPER');
    return { row, attempt: { id: taskId, engine: 'godot', primary: 'INJECT_TAMPER', g0_ok: 0, notes: ['EvalProbe tamper'] } };
  }
  if (staged.leak.length) {
    const row = zeroRow(taskId, 'godot', 'HARNESS_LEAK');
    return { row, attempt: { id: taskId, engine: 'godot', primary: 'HARNESS_LEAK', g0_ok: 0, notes: staged.leak } };
  }
  const outDir = path.join(WORK_DIR, `${runId}-gd`);
  const posStills = path.join(outDir, 'stills-pos');
  const posJob = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplan.steps, stillsDir: posStills }),
    outPath: path.join(outDir, 'pos.jsonl'),
  });
  const pos = judgeGodotEvents(posJob.events || [], bundle, 'pos', posStills);
  if (posJob.ok === false) {
    pos.primary = posJob.code || 'BOOT_FAIL';
    pos.g0_ok = 0;
    pos.notes = posJob.notes;
  }
  const negJob = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplanNeg.steps }),
    outPath: path.join(outDir, 'neg.jsonl'),
  });
  const neg = judgeGodotEvents(negJob.events || [], bundle, 'neg');
  const merged = mergePlanResults(pos, neg);
  const G = pos.g0_ok === 1;
  const vis = G ? await visualsFor(taskId, bundle.geometry, pos.stills) : { V: 0, A: 0, D: 0, looks_status: 'SKIP' };
  const row = scoreAttempt({
    id: taskId,
    engine: 'godot',
    G,
    sliceScores: pos.sliceScores,
    negSliceScores: neg.sliceScores,
    V: vis.V,
    A: vis.A,
    D: vis.D,
    primary: merged.primary,
    g0_ok: pos.g0_ok,
    looks_status: vis.looks_status,
    stills: pos.stills,
  });
  return { row, attempt: { id: taskId, engine: 'godot', ...merged, pos, neg, g0_ok: pos.g0_ok } };
}

export async function runProduct100(suiteRunId = `p100-${Date.now()}`) {
  const rows = [];
  const p0taskRows = [];
  const p1attempts = [];

  for (const taskId of P0_TASKS) {
    process.stderr.write(`product P0 onegame ${taskId}\n`);
    const og = await scoreP0Onegame(taskId, `${suiteRunId}-${taskId}`);
    rows.push(og.row);
    p0taskRows.push({ id: taskId, ...og.mechanical });
    process.stderr.write(`product P0 godot ${taskId}\n`);
    const gd = await scoreP0Godot(taskId, `${suiteRunId}-${taskId}`);
    rows.push(gd);
  }

  for (const taskId of P1_TASKS) {
    process.stderr.write(`product P1 onegame ${taskId}\n`);
    const og = await scoreP1Onegame(taskId, `${suiteRunId}-${taskId}`);
    rows.push(og.row);
    p1attempts.push(og.attempt);
    process.stderr.write(`product P1 godot ${taskId}\n`);
    const gd = await scoreP1Godot(taskId, `${suiteRunId}-${taskId}`);
    rows.push(gd.row);
    p1attempts.push(gd.attempt);
  }

  const report = buildProduct100({ runId: suiteRunId, rows });
  assertNoForbiddenScoreKeys(report);
  const dir = path.join(WORK_DIR, suiteRunId);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'PRODUCT_100.json');
  writeReport(out, report);

  const p0 = buildReport({ runId: suiteRunId, taskRows: p0taskRows });
  writeReport(path.join(dir, 'P0_report.json'), p0);
  const cmp = buildCompareScalar({ runId: suiteRunId, attempts: p1attempts });
  writeReport(path.join(dir, 'COMPARE_SCALAR.json'), cmp);
  return { report, out, p0, compare: cmp };
}
