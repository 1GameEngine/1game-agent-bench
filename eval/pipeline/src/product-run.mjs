import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR, oracleGodot } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { loadTaskBundle } from './load.mjs';
import { replayJudgeHygiene } from './replay.mjs';
import { loadP0GodotTask } from './p0-godot.mjs';
import { stageGodotProject, runGodotJob, makeJob, judgeGodotEvents } from './p1-godot.mjs';
import { primaryOf } from './verdict.mjs';
import { scorePairedLooks } from './looks-pair.mjs';
import { P0_TASKS, P1_TASKS, scoreAttempt, buildProduct100, zeroRow } from './product-100.mjs';
import { buildReport, writeReport } from './report.mjs';
import { buildCompareScalar } from './p1-report.mjs';
import { assertNoForbiddenScoreKeys } from './util.mjs';
import { writeScoreboard } from './scoreboard.mjs';
import { scoreProbe } from './probe.mjs';
import { aggregateFrameRubric } from './rubric.mjs';
import { orchestrateEngines } from './subagent-stage.mjs';

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

function emptyVis(looks_status, looks_source) {
  return { M: null, D: null, V: null, A: null, looks_status, looks_source };
}

function visualsFromLooks(looks, rubric) {
  if (!looks) return emptyVis('SKIP', 'none');
  if (looks.looks_status !== 'OK') {
    return {
      ...emptyVis(looks.looks_status, looks.looks_source ?? 'subagent'),
      sample_policy: looks.sample_policy,
      jobs: looks.jobs,
    };
  }
  const fin = aggregateFrameRubric(looks.byScenario, rubric);
  return {
    M: fin.M,
    D: fin.D,
    V: fin.V,
    A: fin.A,
    items: fin.items,
    missing_scenarios: fin.missing_scenarios,
    observed_scenarios: fin.observed_scenarios,
    looks_status: 'OK',
    looks_source: 'subagent',
    sample_policy: looks.sample_policy,
    jobs: looks.jobs,
  };
}

export function scoreStagedPair(taskId, staged) {
  const bundle = staged.bundle;
  let ogVis;
  let gdVis;
  if (staged.pair === 'BOTH_G0') {
    ogVis = emptyVis('SKIP', 'none');
    gdVis = emptyVis('SKIP', 'none');
  } else if (staged.pair === 'INCOMPARABLE_VISUAL') {
    ogVis = emptyVis('INCOMPARABLE_VISUAL', 'pair');
    gdVis = emptyVis('INCOMPARABLE_VISUAL', 'pair');
  } else {
    ogVis = staged.onegame.replay.G
      ? visualsFromLooks(staged.onegame.looks, bundle.rubric)
      : emptyVis('SKIP', 'none');
    gdVis = staged.godot.replay.G
      ? visualsFromLooks(staged.godot.looks, bundle.rubric)
      : emptyVis('SKIP', 'none');
    if (staged.onegame.replay.G && staged.godot.replay.G) {
      if (
        ogVis.looks_status !== gdVis.looks_status ||
        ogVis.looks_source !== gdVis.looks_source ||
        ogVis.sample_policy !== gdVis.sample_policy ||
        ogVis.jobs !== gdVis.jobs
      ) {
        ogVis = emptyVis('INCOMPARABLE_LOOKS', 'pair');
        gdVis = emptyVis('INCOMPARABLE_LOOKS', 'pair');
      }
    }
  }
  return {
    ogRow: rowFromReplay(taskId, 'onegame', staged.onegame.replay, ogVis),
    gdRow: rowFromReplay(taskId, 'godot', staged.godot.replay, gdVis),
    pair: staged.pair,
  };
}

function rowFromReplay(taskId, engine, replay, vis) {
  return scoreAttempt({
    id: taskId,
    engine,
    G: replay.G,
    M: vis.M,
    D: vis.D,
    V: vis.V,
    A: vis.A,
    primary: replay.primary,
    g0_ok: replay.g0_ok,
    looks_status: vis.looks_status,
    looks_source: vis.looks_source,
    stills: replay.stills,
    looks_items: vis.items,
    scenarios: vis.observed_scenarios ?? replay.scenarios,
    missing_scenarios: vis.missing_scenarios ?? [],
  });
}

function rowFromMech(taskId, engine, mech, vis) {
  if (mech.rowReady && !mech.G) {
    return { ...mech.rowReady, looks_status: vis.looks_status, looks_source: vis.looks_source };
  }
  const probeScore = mech.bundle?.probe
    ? scoreProbe({
        probe: mech.bundle.probe,
        rubric: mech.bundle.rubric,
        samples: mech.samples ?? [],
        traces: mech.traces,
        replayedScenarios: mech.replayed_scenarios,
      })
    : null;
  const missing = [
    ...new Set([...(probeScore?.missing_scenarios ?? []), ...(vis.missing_scenarios ?? mech.missing_scenarios ?? [])]),
  ];
  return scoreAttempt({
    id: taskId,
    engine,
    G: mech.G,
    M: probeScore ? probeScore.M : vis.M,
    D: probeScore ? probeScore.D : vis.D,
    V: vis.V,
    A: vis.A,
    primary: mech.primary,
    g0_ok: mech.g0_ok,
    looks_status: vis.looks_status,
    looks_source: vis.looks_source,
    stills: mech.stills,
    looks_items: { ...(probeScore?.items ?? {}), ...(vis.items ?? {}) },
    scenarios: vis.observed_scenarios ?? mech.scenarios,
    missing_scenarios: missing,
  });
}

function serializeReplay(replay) {
  return serializeMech({
    G: replay.G,
    stills: replay.stills,
    primary: replay.primary,
    g0_ok: replay.g0_ok,
    attempt: replay.attempt,
    traces: replay.traces,
    scenarios: replay.scenarios,
    replayed_scenarios: replay.replayed_scenarios,
    missing_scenarios: replay.missing_scenarios,
    samples: replay.samples,
    jobDir: undefined,
  });
}

function serializeMech(mech) {
  return {
    G: Boolean(mech.G),
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
    traces: mech.traces,
    scenarios: mech.scenarios,
    replayed_scenarios: mech.replayed_scenarios,
    missing_scenarios: mech.missing_scenarios,
    samples: mech.samples ?? [],
  };
}

async function pairAndRows(taskId, og, gd) {
  const vis = await scorePairedLooks({
    taskId,
    instruction: og.bundle?.instruction ?? gd.bundle?.instruction,
    geometry: og.bundle?.geometry ?? gd.bundle?.geometry,
    rubric: og.bundle?.rubric ?? gd.bundle?.rubric,
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

export async function runProduct100(suiteRunId = `p100-${Date.now()}`) {
  const rows = [];
  const p0taskRows = [];
  const p1attempts = [];
  const packs = [];

  for (const taskId of P0_TASKS) {
    process.stderr.write(`product P0 pair ${taskId}\n`);
    const og = await mechP0Onegame(taskId, `${suiteRunId}-${taskId}`);
    const gd = await mechP0Godot(taskId, `${suiteRunId}-${taskId}`);
    const paired = await pairAndRows(taskId, og, gd);
    rows.push(paired.ogRow, paired.gdRow);
    p0taskRows.push({ id: taskId, ...og.mechanical });
    packs.push({
      id: taskId,
      bundle: {
        instruction: og.bundle?.instruction ?? gd.bundle?.instruction,
        geometry: og.bundle?.geometry ?? gd.bundle?.geometry,
        rubric: og.bundle?.rubric ?? gd.bundle?.rubric,
        probe: og.bundle?.probe ?? gd.bundle?.probe,
      },
      og: serializeMech(og),
      gd: serializeMech(gd),
    });
  }

  for (const taskId of P1_TASKS) {
    process.stderr.write(`product P1 pair ${taskId}\n`);
    const staged = await orchestrateEngines({ taskId, runId: `${suiteRunId}-${taskId}` });
    const paired = scoreStagedPair(taskId, staged);
    rows.push(paired.ogRow, paired.gdRow);
    p1attempts.push(staged.onegame.replay.attempt, staged.godot.replay.attempt);
    packs.push({
      id: taskId,
      bundle: {
        instruction: staged.bundle.instruction,
        geometry: staged.bundle.geometry,
        rubric: staged.bundle.rubric,
        probe: staged.bundle.probe,
      },
      og: serializeReplay(staged.onegame.replay),
      gd: serializeReplay(staged.godot.replay),
    });
  }

  return writeSuiteReports(suiteRunId, { rows, p0taskRows, p1attempts, packs });
}
