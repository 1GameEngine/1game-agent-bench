import fs from 'node:fs';
import path from 'node:path';
import { RECORD_REL } from './paths.mjs';
import { parseCliJson, readStoreState } from './util.mjs';
import { execFileOk } from './exec.mjs';
import { stepOp, clickCoord } from './p1-closed.mjs';
import { projectDump, validateDump, checkpointMatch } from './p1-schema.mjs';
import { captureOnegameStill } from './capture.mjs';
import { loadArgvRules } from './load.mjs';
import { allowedClickCenters } from './argv-audit.mjs';
import {
  FRAME_MS,
  auditTrace,
  capFrames,
  eventsByFrame,
  missingRequiredScenarios,
  readTraces,
  sampleEvery,
  scenarioSet,
  stillPlayMeta,
} from './p1-trace.mjs';

function gp(cwd, argv) {
  return execFileOk('pnpm', ['exec', ...argv], { cwd, timeoutMs: 180_000 });
}

function createRecord(cwd) {
  fs.mkdirSync(path.join(cwd, 'out'), { recursive: true });
  const rec = path.join(cwd, RECORD_REL);
  if (fs.existsSync(rec)) fs.rmSync(rec, { force: true });
  return gp(cwd, ['1gameplay', 'create', '--entry', 'src/game.tsx', '--out', RECORD_REL]);
}

function queryStore(cwd) {
  const proc = gp(cwd, [
    '1gameplay',
    'frame',
    'query',
    RECORD_REL,
    '--at',
    'last',
    '--select',
    'store:state',
    '--payload',
    'full',
  ]);
  const json = parseCliJson(proc.stdout);
  return { proc, json, store: readStoreState(json) };
}

function applyStep(cwd, step, geometry) {
  const op = stepOp(step);
  if (op === 'checkpoint') return { ok: true };
  if (op === 'tick') {
    const proc = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--ms', '16', '--repeat', String(step.tick)]);
    return { ok: proc.status === 0, proc };
  }
  if (op === 'click') {
    const coord = clickCoord(geometry, step.click);
    const click = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--click', coord]);
    if (click.status !== 0) return { ok: false, proc: click };
    const tick = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--ms', '16']);
    return { ok: tick.status === 0, proc: tick };
  }
  if (op === 'keydown' || op === 'keyup') {
    const event = JSON.stringify({ type: op, data: { code: step[op] } });
    const proc = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--ms', '16', '--event', event]);
    return { ok: proc.status === 0, proc };
  }
  return { ok: false, proc: { stdout: 'ACTION_NOT_IN_CLOSED_SET' } };
}

function tickFrames(cwd, n) {
  if (n < 1) return { ok: true };
  const argv = ['1gameplay', 'step', RECORD_REL, '--ms', String(FRAME_MS)];
  if (n > 1) argv.push('--repeat', String(n));
  const proc = gp(cwd, argv);
  return { ok: proc.status === 0, proc };
}

function applyTraceEvent(cwd, ev) {
  if (ev.type === 'click') {
    const coord = `${Math.round(Number(ev.x))},${Math.round(Number(ev.y))}`;
    const proc = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--click', coord]);
    return { ok: proc.status === 0, proc };
  }
  const event = JSON.stringify({ type: ev.type, data: { code: ev.code } });
  const proc = gp(cwd, ['1gameplay', 'step', RECORD_REL, '--ms', '1', '--event', event]);
  return { ok: proc.status === 0, proc };
}

function nextBarrier(i, n, every, by) {
  if (shouldSample(i, n, every)) return i + 1;
  let stop = n;
  const nextSample = Math.ceil((i + 1) / every) * every;
  if (nextSample < stop) stop = nextSample;
  for (const frame of by.keys()) {
    if (frame > i && frame < stop) stop = frame;
  }
  if (n - 1 > i && n - 1 < stop) stop = n - 1;
  return Math.max(i + 1, stop);
}

function shouldSample(i, n, every) {
  return i % every === 0 || i === n - 1;
}

export function runOnegamePlayplan({ gameDir, bundle, steps, stillsDir }) {
  const notes = [];
  const sliceScores = [];
  const sliceIds = [];
  const stills = [];
  let primary = 'CHECKPOINTS_OK';
  const created = createRecord(gameDir);
  if (created.status !== 0) {
    const msg = created.stdout + created.stderr;
    if (/bindStore/i.test(msg)) return { primary: 'BIND_FAIL', g0_ok: 0, notes: [msg.slice(0, 300)] };
    return { primary: 'BUILD_FAIL', g0_ok: 0, notes: [msg.slice(0, 300)] };
  }
  const q0 = queryStore(gameDir);
  if (q0.store.empty) return { primary: 'BIND_FAIL', g0_ok: 0, notes: ['BINDSTORE_EMPTY'] };
  const proj0 = projectDump(q0.store.value, bundle.schema, bundle.sha);
  const g0v = validateDump(proj0.dump, bundle.schema, bundle.sha);
  if (!g0v.ok) return { primary: g0v.code, g0_ok: 0, notes: g0v.notes, sliceScores, stills };

  const rules = loadArgvRules();
  const clicks = allowedClickCenters(bundle.geometry);

  for (const step of steps) {
    const op = stepOp(step);
    if (op === 'checkpoint') {
      const q = queryStore(gameDir);
      if (q.store.empty) {
        sliceScores.push(0);
        if (primary === 'CHECKPOINTS_OK') primary = 'BIND_FAIL';
        notes.push('empty at checkpoint');
        continue;
      }
      const proj = projectDump(q.store.value, bundle.schema, bundle.sha);
      const v = validateDump(proj.dump, bundle.schema, bundle.sha);
      const expected = bundle.checkpoint.slices[step.checkpoint];
      const errs = v.ok && expected ? checkpointMatch(proj.dump, expected) : ['invalid dump'];
      const dumpOk = v.ok && expected && errs.length === 0;
      sliceScores.push(dumpOk ? 1 : 0);
      sliceIds.push(step.checkpoint);
      if (!dumpOk && primary === 'CHECKPOINTS_OK') {
        primary = v.ok ? 'CHECKPOINT_FAIL' : v.code;
        notes.push(...(v.ok ? errs : v.notes));
      }
      if (stillsDir) {
        const cap = captureOnegameStill({
          gameDir,
          outPng: path.join(stillsDir, `${step.checkpoint}.png`),
          rules,
          allowedClicks: clicks,
        });
        stills.push({ id: step.checkpoint, dump_ok: dumpOk ? 1 : 0, dump: proj.dump, ...cap });
      }
      continue;
    }
    const applied = applyStep(gameDir, step, bundle.geometry);
    if (!applied.ok) {
      notes.push(`step ${step.id} failed`);
      if (primary === 'CHECKPOINTS_OK') primary = 'BOOT_FAIL';
      break;
    }
  }
  return { primary, g0_ok: 1, notes, sliceScores, sliceIds, stills };
}

export function runOnegameTraces({ gameDir, stillsDir, tracesDir }) {
  const notes = [];
  const stills = [];
  const samples = [];
  const dir = tracesDir ?? path.join(gameDir, 'demo_outputs');
  const submitted = readTraces(dir);
  const valid = submitted.filter((t) => t.audit.ok);
  if (!submitted.length) {
    return {
      primary: 'TRACE_MISSING',
      g0_ok: 0,
      notes: ['no submitted traces'],
      stills,
      traces: submitted,
      scenarios: [],
      missing_scenarios: missingRequiredScenarios([]),
    };
  }
  if (!valid.length) {
    return {
      primary: 'TRACE_INVALID',
      g0_ok: 0,
      notes: submitted.flatMap((t) => t.audit.issues.map((i) => `${t.file}: ${i}`)).slice(0, 12),
      stills,
      traces: submitted,
      scenarios: scenarioSet(submitted),
      missing_scenarios: missingRequiredScenarios(submitted),
    };
  }

  const created = createRecord(gameDir);
  if (created.status !== 0) {
    const msg = created.stdout + created.stderr;
    if (/bindStore/i.test(msg)) {
      return { primary: 'BIND_FAIL', g0_ok: 0, notes: [msg.slice(0, 300)], stills, traces: submitted };
    }
    return { primary: 'BUILD_FAIL', g0_ok: 0, notes: [msg.slice(0, 300)], stills, traces: submitted };
  }
  const q0 = queryStore(gameDir);
  if (q0.store.empty) {
    return { primary: 'BIND_FAIL', g0_ok: 0, notes: ['BINDSTORE_EMPTY'], stills, traces: submitted };
  }

  const rules = loadArgvRules();
  const every = sampleEvery();
  let primary = 'TRACE_OK';
  const replayed_scenarios = [];

  for (const item of valid) {
    const boot = createRecord(gameDir);
    if (boot.status !== 0) {
      primary = 'BOOT_FAIL';
      notes.push(`replay create failed ${item.file}`);
      break;
    }
    const n = capFrames(item.trace.duration_frames);
    const by = eventsByFrame(item.trace);
    let i = 0;
    let failed = false;
    while (i < n) {
      const evs = by.get(i) ?? [];
      for (const ev of evs) {
        const applied = applyTraceEvent(gameDir, ev);
        if (!applied.ok) {
          primary = 'TRACE_REPLAY_FAIL';
          notes.push(`${item.trace.scenario} frame ${i} ${ev.type}`);
          failed = true;
          break;
        }
      }
      if (failed) break;
      const stop = nextBarrier(i, n, every, by);
      const run = Math.max(1, stop - i);
      const ticked = tickFrames(gameDir, run);
      if (!ticked.ok) {
        primary = 'TRACE_REPLAY_FAIL';
        notes.push(`${item.trace.scenario} tick ${i}+${run}`);
        failed = true;
        break;
      }
      const last = i + run - 1;
      if (stillsDir && shouldSample(last, n, every)) {
        const id = `${item.trace.scenario}_f${last}`;
        const cap = captureOnegameStill({
          gameDir,
          outPng: path.join(stillsDir, `${id}.png`),
          rules,
          allowedClicks: [],
        });
        const meta = { scenario: item.trace.scenario, frame: last, t_ms: last * FRAME_MS };
        stills.push({
          id,
          dump_ok: 1,
          dump: meta,
          ...cap,
        });
      }
      i += run;
    }
    if (failed) break;
    replayed_scenarios.push(item.trace.scenario);
  }

  return {
    primary,
    g0_ok: 1,
    notes,
    stills,
    samples,
    traces: submitted,
    scenarios: scenarioSet(valid),
    replayed_scenarios,
    missing_scenarios: missingRequiredScenarios(valid, { replayedScenarios: replayed_scenarios }),
  };
}

