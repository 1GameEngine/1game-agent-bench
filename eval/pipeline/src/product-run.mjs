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
import { loadP1Task } from './p1-load.mjs';
import { scorePairedLooks } from './looks-pair.mjs';
import { buildLooksJob } from './looks-judge.mjs';
import { DEPTH_TASKS, P0_TASKS, P1_TASKS, scoreAttempt, buildProduct100, zeroRow } from './product-100.mjs';
import { buildReport, writeReport } from './report.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { assertNoForbiddenScoreKeys } from './util.mjs';
import { writeScoreboard } from './scoreboard.mjs';

function mergePlanResults(pos, neg) {
  if (pos.g0_ok !== 1) return pos;
  if (neg.g0_ok !== 1) return neg;
  if (pos.primary !== 'CHECKPOINTS_OK') return pos;
  if (neg.primary !== 'CHECKPOINTS_OK') return neg;
  return { primary: 'CHECKPOINTS_OK', g0_ok: 1, notes: [] };
}

export async function mechP0Onegame(taskId, runId) {
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
  return {
    bundle,
    G,
    sliceScores: result.sliceScores,
    stills: result.stills,
    primary: primaryOf(result),
    g0_ok: result.create_ok === 1 && !result.bindstore_empty ? 1 : 0,
    mechanical: result,
    jobDir: path.join(WORK_DIR, runId, 'looks'),
  };
}

export async function mechP0Godot(taskId, runId) {
  const src = oracleGodot(taskId);
  if (!fs.existsSync(path.join(src, 'project.godot'))) {
    return {
      bundle: loadTaskBundle(taskId),
      G: 0,
      sliceScores: [],
      stills: [],
      primary: 'ENGINE_TASK_UNSUPPORTED',
      g0_ok: 0,
      rowReady: zeroRow(taskId, 'godot', 'ENGINE_TASK_UNSUPPORTED'),
      jobDir: path.join(WORK_DIR, `${runId}-gd`, 'looks'),
    };
  }
  const bundle = loadP0GodotTask(taskId);
  const staged = stageGodotProject({
    taskId,
    runId: `${runId}-gd`,
    srcDir: src,
  });
  if (staged.tamper) {
    return {
      bundle,
      G: 0,
      sliceScores: [],
      stills: [],
      primary: 'INJECT_TAMPER',
      g0_ok: 0,
      rowReady: zeroRow(taskId, 'godot', 'INJECT_TAMPER'),
      jobDir: path.join(WORK_DIR, `${runId}-gd`, 'looks'),
    };
  }
  if (staged.leak.length) {
    return {
      bundle,
      G: 0,
      sliceScores: [],
      stills: [],
      primary: 'HARNESS_LEAK',
      g0_ok: 0,
      rowReady: zeroRow(taskId, 'godot', 'HARNESS_LEAK'),
      jobDir: path.join(WORK_DIR, `${runId}-gd`, 'looks'),
    };
  }
  const outDir = path.join(WORK_DIR, `${runId}-gd`);
  const stillsDir = path.join(outDir, 'stills');
  const job = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplan.steps, stillsDir }),
    outPath: path.join(outDir, 'pos.jsonl'),
  });
  const judged = judgeGodotEvents(job.events || [], bundle, 'pos', stillsDir);
  if (job.ok === false) {
    judged.primary = job.code || judged.primary || 'BOOT_FAIL';
    judged.g0_ok = judged.g0_ok ?? 0;
    judged.notes = [...(judged.notes ?? []), ...(job.notes ?? [])];
  }
  return {
    bundle,
    G: judged.g0_ok === 1,
    sliceScores: judged.sliceScores,
    stills: judged.stills,
    primary: judged.primary,
    g0_ok: judged.g0_ok,
    jobDir: path.join(outDir, 'looks'),
  };
}

export async function mechP1Onegame(taskId, runId) {
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
  return {
    bundle,
    G,
    sliceScores: pos.sliceScores,
    sliceIds: pos.sliceIds,
    negSliceScores: neg.sliceScores,
    stills: pos.stills,
    primary: hyg.ok ? merged.primary : 'HYGIENE_FAIL',
    g0_ok: pos.g0_ok,
    attempt: { id: taskId, engine: 'onegame', ...merged, pos, neg, g0_ok: pos.g0_ok },
    jobDir: path.join(WORK_DIR, `${runId}-og`, 'looks'),
  };
}

export async function mechP1Godot(taskId, runId) {
  const bundle = loadP1Task(taskId);
  const staged = stageGodotProject({
    taskId,
    runId: `${runId}-gd`,
    srcDir: oracleGodot(taskId),
  });
  if (staged.tamper) {
    return {
      bundle,
      G: 0,
      sliceScores: [],
      stills: [],
      primary: 'INJECT_TAMPER',
      g0_ok: 0,
      attempt: { id: taskId, engine: 'godot', primary: 'INJECT_TAMPER', g0_ok: 0, notes: ['EvalProbe tamper'] },
      rowReady: zeroRow(taskId, 'godot', 'INJECT_TAMPER'),
      jobDir: path.join(WORK_DIR, `${runId}-gd`, 'looks'),
    };
  }
  if (staged.leak.length) {
    return {
      bundle,
      G: 0,
      sliceScores: [],
      stills: [],
      primary: 'HARNESS_LEAK',
      g0_ok: 0,
      attempt: { id: taskId, engine: 'godot', primary: 'HARNESS_LEAK', g0_ok: 0, notes: staged.leak },
      rowReady: zeroRow(taskId, 'godot', 'HARNESS_LEAK'),
      jobDir: path.join(WORK_DIR, `${runId}-gd`, 'looks'),
    };
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
    pos.primary = posJob.code || pos.primary || 'BOOT_FAIL';
    pos.notes = [...(pos.notes ?? []), ...(posJob.notes ?? [])];
  }
  const negJob = runGodotJob({
    projectDir: staged.dest,
    job: makeJob({ bundle, steps: bundle.playplanNeg.steps }),
    outPath: path.join(outDir, 'neg.jsonl'),
  });
  const neg = judgeGodotEvents(negJob.events || [], bundle, 'neg');
  const merged = mergePlanResults(pos, neg);
  return {
    bundle,
    G: pos.g0_ok === 1,
    sliceScores: pos.sliceScores,
    sliceIds: pos.sliceIds,
    negSliceScores: neg.sliceScores,
    stills: pos.stills,
    primary: merged.primary,
    g0_ok: pos.g0_ok,
    attempt: { id: taskId, engine: 'godot', ...merged, pos, neg, g0_ok: pos.g0_ok },
    jobDir: path.join(outDir, 'looks'),
  };
}

function rowFromMech(taskId, engine, mech, vis) {
  if (mech.rowReady && !mech.G) {
    return { ...mech.rowReady, looks_status: vis.looks_status, looks_source: vis.looks_source };
  }
  return scoreAttempt({
    id: taskId,
    engine,
    G: mech.G,
    sliceScores: mech.sliceScores,
    negSliceScores: mech.negSliceScores,
    sliceIds: mech.sliceIds,
    V: vis.V,
    A: vis.A,
    D: vis.D,
    primary: mech.primary,
    g0_ok: mech.g0_ok,
    looks_status: vis.looks_status,
    looks_source: vis.looks_source,
    stills: mech.stills,
    looks_items: vis.items,
  });
}

function stillsForJob(stills) {
  return (stills ?? [])
    .filter((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))))
    .map((s) => ({
      id: s.id,
      dump_ok: s.dump_ok ?? 0,
      dump: s.dump,
      ok: true,
      path: s.path,
      png: s.png,
    }));
}

function prepareLooksJobs(taskId, og, gd) {
  const instruction = og.bundle?.instruction ?? gd.bundle?.instruction;
  const geometry = og.bundle?.geometry ?? gd.bundle?.geometry;
  const depthKeys = DEPTH_TASKS[taskId];
  const jobs = [];
  for (const side of [
    { engine: 'onegame', mech: og },
    { engine: 'godot', mech: gd },
  ]) {
    if (!side.mech.G) continue;
    const stills = stillsForJob(side.mech.stills);
    if (!stills.length) continue;
    const job = buildLooksJob({
      taskId,
      engine: side.engine,
      instruction,
      geometry,
      stills,
      variant_regions: Array.isArray(depthKeys) ? depthKeys : undefined,
      jobDir: side.mech.jobDir,
    });
    jobs.push({
      taskId,
      engine: side.engine,
      jobDir: side.mech.jobDir,
      requestPath: job.requestPath,
      promptPath: job.promptPath,
      verdictPath: job.verdictPath,
      stills: stills.map((s) => ({ id: s.id, path: s.path, dump: s.dump, dump_ok: s.dump_ok })),
    });
  }
  return jobs;
}

function serializeMech(mech) {
  return {
    G: Boolean(mech.G),
    sliceScores: mech.sliceScores ?? [],
    sliceIds: mech.sliceIds ?? [],
    negSliceScores: mech.negSliceScores,
    stills: (mech.stills ?? []).map((s) => ({
      id: s.id,
      dump_ok: s.dump_ok ?? 0,
      dump: s.dump,
      ok: Boolean(s.ok && s.path && fs.existsSync(s.path)),
      path: s.path,
      status: s.status,
    })),
    primary: mech.primary,
    g0_ok: mech.g0_ok,
    jobDir: mech.jobDir,
    attempt: mech.attempt,
    mechanical: mech.mechanical,
  };
}

async function pairAndRows(taskId, og, gd) {
  const vis = await scorePairedLooks({
    taskId,
    instruction: og.bundle?.instruction ?? gd.bundle?.instruction,
    geometry: og.bundle?.geometry ?? gd.bundle?.geometry,
    og,
    gd,
    ogJobDir: og.jobDir,
    gdJobDir: gd.jobDir,
  });
  return {
    ogRow: rowFromMech(taskId, 'onegame', og, vis.og),
    gdRow: rowFromMech(taskId, 'godot', gd, vis.gd),
    pair: vis.pair,
  };
}

function writeSuiteReports(suiteRunId, { rows, p0taskRows, p1attempts, packs }) {
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
  const html = writeScoreboard({ dir, report, rows, packs });
  return { report, out, p0, compare: cmp, htmlPath: html.htmlPath };
}

export async function runProduct100(suiteRunId = `p100-${Date.now()}`, opts = {}) {
  const phase = opts.phase ?? 'all';
  const dir = path.join(WORK_DIR, suiteRunId);
  const mechPath = path.join(dir, 'MECH.json');

  if (phase === 'looks') {
    const saved = JSON.parse(fs.readFileSync(mechPath, 'utf8'));
    const rows = [];
    for (const pack of saved.tasks) {
      const og = { ...pack.og, bundle: pack.bundle };
      const gd = { ...pack.gd, bundle: pack.bundle };
      const paired = await pairAndRows(pack.id, og, gd);
      rows.push(paired.ogRow, paired.gdRow);
    }
    return writeSuiteReports(suiteRunId, {
      rows,
      p0taskRows: saved.p0taskRows ?? [],
      p1attempts: saved.p1attempts ?? [],
      packs: saved.tasks ?? [],
    });
  }

  const rows = [];
  const p0taskRows = [];
  const p1attempts = [];
  const packs = [];
  const looksJobs = [];

  for (const taskId of P0_TASKS) {
    process.stderr.write(`product P0 pair ${taskId}\n`);
    const og = await mechP0Onegame(taskId, `${suiteRunId}-${taskId}`);
    const gd = await mechP0Godot(taskId, `${suiteRunId}-${taskId}`);
    looksJobs.push(...prepareLooksJobs(taskId, og, gd));
    if (phase !== 'mech') {
      const paired = await pairAndRows(taskId, og, gd);
      rows.push(paired.ogRow, paired.gdRow);
    }
    p0taskRows.push({ id: taskId, ...og.mechanical });
    packs.push({
      id: taskId,
      bundle: { instruction: og.bundle?.instruction ?? gd.bundle?.instruction, geometry: og.bundle?.geometry ?? gd.bundle?.geometry },
      og: serializeMech(og),
      gd: serializeMech(gd),
    });
  }

  for (const taskId of P1_TASKS) {
    process.stderr.write(`product P1 pair ${taskId}\n`);
    const og = await mechP1Onegame(taskId, `${suiteRunId}-${taskId}`);
    const gd = await mechP1Godot(taskId, `${suiteRunId}-${taskId}`);
    looksJobs.push(...prepareLooksJobs(taskId, og, gd));
    if (phase !== 'mech') {
      const paired = await pairAndRows(taskId, og, gd);
      rows.push(paired.ogRow, paired.gdRow);
    }
    p1attempts.push(og.attempt, gd.attempt);
    packs.push({
      id: taskId,
      bundle: { instruction: og.bundle?.instruction ?? gd.bundle?.instruction, geometry: og.bundle?.geometry ?? gd.bundle?.geometry },
      og: serializeMech(og),
      gd: serializeMech(gd),
    });
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mechPath, `${JSON.stringify({ suiteRunId, tasks: packs, p0taskRows, p1attempts }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'LOOKS_JOBS.json'), `${JSON.stringify({ jobs: looksJobs }, null, 2)}\n`);

  if (phase === 'mech') {
    process.stderr.write(`wrote ${looksJobs.length} looks jobs; fill looks-verdict.json then --looks\n`);
    return { mechPath, looksJobs, out: mechPath };
  }

  return writeSuiteReports(suiteRunId, { rows, p0taskRows, p1attempts, packs });
}
