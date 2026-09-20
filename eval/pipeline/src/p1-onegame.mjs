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

export function runOnegamePlayplan({ gameDir, bundle, steps, stillsDir }) {
  const notes = [];
  const sliceScores = [];
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
        stills.push({ id: step.checkpoint, dump_ok: dumpOk ? 1 : 0, ...cap });
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
  return { primary, g0_ok: 1, notes, sliceScores, stills };
}
