import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from './paths.mjs';
import { loadP1Task } from './p1-load.mjs';
import { runOnegameTraces } from './p1-onegame.mjs';
import { stageGodotProject, runGodotJob, makeTraceJob, judgeTraceEvents } from './p1-godot.mjs';
import { scanHygiene } from './hygiene.mjs';
import { missingRequiredScenarios, readTraces } from './p1-trace.mjs';
import { EvalError } from './util.mjs';

function publicStill(still) {
  return {
    id: still.id,
    ok: Boolean(still.ok),
    path: still.path ?? null,
    dump_ok: still.dump_ok ?? 0,
    dump: still.dump ?? null,
    status: still.status ?? null,
    sha256: still.sha256 ?? null,
    scale: still.scale ?? null,
  };
}

function writeDoc(outPath, doc) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

export function runStageReplay({ engine, taskId, workspace, outPath, token, runId } = {}) {
  if (!token || !outPath || !workspace || !runId || !taskId) {
    throw new EvalError('EVAL_INTERNAL', 'stage-replay needs engine, task, workspace, out, token, and run-id');
  }
  if (engine !== 'onegame' && engine !== 'godot') {
    throw new EvalError('EVAL_INTERNAL', `stage-replay engine must be onegame or godot, got ${engine}`);
  }
  const bundle = loadP1Task(taskId);
  const base = {
    via: 'stage-replay',
    token,
    engine,
    taskId,
    notes: [],
    stills: [],
    samples: [],
    traces: [],
    scenarios: [],
    replayed_scenarios: [],
    missing_scenarios: [],
  };

  if (engine === 'onegame') {
    const hyg = scanHygiene({ gameDir: workspace });
    const stillsDir = path.join(WORK_DIR, runId, 'stills');
    const replay = runOnegameTraces({
      gameDir: workspace,
      stillsDir,
    });
    const primary = hyg.ok ? replay.primary : 'HYGIENE_FAIL';
    const replayed = replay.replayed_scenarios ?? [];
    const G = replay.g0_ok === 1 && hyg.ok && replayed.length > 0;
    return writeDoc(outPath, {
      ...base,
      G,
      primary,
      g0_ok: replay.g0_ok ?? 0,
      notes: [...(hyg.ok ? [] : hyg.issues ?? ['hygiene']), ...(replay.notes ?? [])],
      stills: (replay.stills ?? []).map(publicStill),
      samples: replay.samples ?? [],
      traces: replay.traces ?? [],
      scenarios: replay.scenarios ?? [],
      replayed_scenarios: replay.replayed_scenarios ?? [],
      missing_scenarios: replay.missing_scenarios ?? [],
      attempt: { id: taskId, engine, primary, g0_ok: replay.g0_ok ?? 0, notes: replay.notes ?? [] },
    });
  }

  const staged = stageGodotProject({ taskId, runId, srcDir: workspace });
  if (staged.tamper || staged.leak?.length) {
    const primary = staged.tamper ? 'INJECT_TAMPER' : 'HARNESS_LEAK';
    const notes = staged.tamper ? ['EvalProbe tamper'] : staged.leak;
    return writeDoc(outPath, {
      ...base,
      G: false,
      primary,
      g0_ok: 0,
      notes,
      attempt: { id: taskId, engine, primary, g0_ok: 0, notes },
    });
  }
  const stillsDir = path.join(WORK_DIR, runId, 'stills');
  const traces = readTraces(path.join(staged.dest, 'demo_outputs'));
  const jobRun = runGodotJob({
    projectDir: staged.dest,
    job: makeTraceJob({ traces, stillsDir }),
    outPath: path.join(WORK_DIR, runId, 'traces.jsonl'),
    timeoutMs: 300_000,
  });
  const judged = judgeTraceEvents(jobRun.events || [], stillsDir);
  if (jobRun.ok === false) {
    judged.primary = jobRun.code || judged.primary || 'BOOT_FAIL';
    judged.notes = [...(judged.notes ?? []), ...(jobRun.notes ?? [])];
  }
  const G = judged.g0_ok === 1 && (judged.replayed_scenarios ?? []).length > 0;
  const missing = missingRequiredScenarios(
    traces.filter((t) => t.audit.ok),
    { replayedScenarios: judged.replayed_scenarios },
  );
  return writeDoc(outPath, {
    ...base,
    G,
    primary: judged.primary,
    g0_ok: judged.g0_ok ?? 0,
    notes: judged.notes ?? [],
    stills: (judged.stills ?? []).map(publicStill),
    samples: judged.samples ?? [],
    traces,
    scenarios: judged.scenarios ?? [],
    replayed_scenarios: judged.replayed_scenarios ?? [],
    missing_scenarios: missing,
    attempt: { id: taskId, engine, primary: judged.primary, g0_ok: judged.g0_ok ?? 0, notes: judged.notes ?? [] },
  });
}
