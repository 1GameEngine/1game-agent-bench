import fs from 'node:fs';
import path from 'node:path';
import { RECORD_REL } from './paths.mjs';
import { parseCliJson, readStoreState } from './util.mjs';
import { auditReplayArgv, pnpmExecArgv } from './argv-audit.mjs';
import { execFileOk } from './exec.mjs';
import { compareCheckpointSlice } from './compare.mjs';
import { scanHygiene } from './hygiene.mjs';
import { captureOnegameStill } from './capture.mjs';

function spawn1gameplay(playArgv, { cwd, rules, allowedClicks, role }) {
  const audit = auditReplayArgv(playArgv, { rules, allowedClicks, recordRel: RECORD_REL, role });
  if (!audit.ok) {
    return { audit, proc: null };
  }
  const proc = execFileOk('pnpm', pnpmExecArgv(playArgv), { cwd, timeoutMs: 180_000 });
  return { audit, proc };
}

export function replayAndJudge({ gameDir, bundle, stillsDir }) {
  const notes = [];
  const sliceScores = [];
  const stills = [];
  let create_ok = 0;
  let replay_ok = 0;
  let store_match = 0;
  let argv_ok = 1;
  let bindstore_empty = false;
  let timeout = false;
  let primaryHint = null;
  const argvIssues = [];
  const storeErrors = [];

  fs.mkdirSync(path.join(gameDir, 'out'), { recursive: true });

  const createArgv = ['1gameplay', 'create', '--entry', 'src/game.tsx', '--out', RECORD_REL];
  try {
    const { audit, proc } = spawn1gameplay(createArgv, {
      cwd: gameDir,
      rules: bundle.rules,
      allowedClicks: bundle.allowedClicks,
      role: 'replay',
    });
    if (!audit.ok) {
      argv_ok = 0;
      argvIssues.push(...audit.issues);
      primaryHint = 'ARGV_VIOLATION';
    } else if (proc.status === 0) {
      const createJson = parseCliJson(proc.stdout);
      if (createJson.ok === true && createJson.command === 'create') create_ok = 1;
      else notes.push('create JSON not ok/command=create');
    } else {
      notes.push(`create exit ${proc.status}: ${(proc.stderr || proc.stdout).slice(0, 400)}`);
      try {
        const failed = parseCliJson(proc.stdout);
        const msg = `${failed.message ?? ''} ${proc.stderr ?? ''}`;
        if (/bindStore/i.test(msg)) bindstore_empty = true;
      } catch {
        if (/bindStore/i.test(proc.stderr || proc.stdout || '')) bindstore_empty = true;
      }
    }
  } catch (err) {
    if (err.primary === 'TIMEOUT') timeout = true;
    else notes.push(String(err.message));
  }

  const queryArgv = [
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
  ];

  function captureSlice(id, dumpOk, dump) {
    if (!stillsDir) return;
    const cap = captureOnegameStill({
      gameDir,
      outPng: path.join(stillsDir, `${id}.png`),
      rules: bundle.rules,
      allowedClicks: bundle.allowedClicks,
    });
    stills.push({ id, dump_ok: dumpOk ? 1 : 0, dump: dump ?? null, ...cap });
  }

  function queryStore() {
    const { audit, proc } = spawn1gameplay(queryArgv, {
      cwd: gameDir,
      rules: bundle.rules,
      allowedClicks: bundle.allowedClicks,
      role: 'judge',
    });
    if (!audit.ok) {
      argv_ok = 0;
      argvIssues.push(...audit.issues);
      return null;
    }
    if (proc.status !== 0) {
      notes.push(`frame query exit ${proc.status}`);
      try {
        return parseCliJson(proc.stdout);
      } catch {
        return null;
      }
    }
    return parseCliJson(proc.stdout);
  }

  if (create_ok) {
    const initQuery = queryStore();
    const store = initQuery ? readStoreState(initQuery) : { empty: true };
    if (store.empty) {
      bindstore_empty = true;
      storeErrors.push(store.reason ?? 'BINDSTORE_EMPTY');
    } else {
      const initErrs = compareCheckpointSlice(
        bundle.checkpoint.init,
        store.value,
        bundle.checkpoint.compare,
        { isFinal: false },
      );
      storeErrors.push(...initErrs);
      sliceScores.push(initErrs.length ? 0 : 1);
      captureSlice('init', initErrs.length === 0, store.value);
    }
  }

  let stepsOk = create_ok === 1 && !bindstore_empty;
  if (stepsOk) {
    for (const step of bundle.playplan.steps) {
      try {
        const { audit, proc } = spawn1gameplay(step.argv, {
          cwd: gameDir,
          rules: bundle.rules,
          allowedClicks: bundle.allowedClicks,
          role: 'replay',
        });
        if (!audit.ok) {
          argv_ok = 0;
          argvIssues.push(...audit.issues);
          stepsOk = false;
          primaryHint = 'ARGV_VIOLATION';
          break;
        }
        if (proc.status !== 0) {
          stepsOk = false;
          notes.push(`step ${step.id} exit ${proc.status}: ${(proc.stderr || proc.stdout).slice(0, 400)}`);
          break;
        }
        const json = parseCliJson(proc.stdout);
        if (json.ok !== true || json.schema !== '1gameplay.step') {
          stepsOk = false;
          notes.push(`step ${step.id} JSON not ok 1gameplay.step`);
          break;
        }
        const mids = (bundle.checkpoint.mid ?? []).filter((m) => m.after === step.id);
        if (mids.length) {
          const q = queryStore();
          const st = q ? readStoreState(q) : { empty: true };
          if (st.empty) {
            bindstore_empty = true;
            stepsOk = false;
            storeErrors.push('BINDSTORE_EMPTY after mid');
            break;
          }
          for (const mid of mids) {
            const midErrs = compareCheckpointSlice(mid.match, st.value, bundle.checkpoint.compare, {
              isFinal: false,
            });
            storeErrors.push(...midErrs);
            sliceScores.push(midErrs.length ? 0 : 1);
            captureSlice(mid.after, midErrs.length === 0, st.value);
          }
        }
      } catch (err) {
        if (err.primary === 'TIMEOUT') {
          timeout = true;
          stepsOk = false;
          break;
        }
        throw err;
      }
    }
  }

  if (stepsOk) replay_ok = 1;

  if (create_ok && !bindstore_empty && replay_ok) {
    const finalQuery = queryStore();
    const st = finalQuery ? readStoreState(finalQuery) : { empty: true };
    if (st.empty) {
      bindstore_empty = true;
      storeErrors.push('BINDSTORE_EMPTY at final');
    } else {
      const finalErrs = compareCheckpointSlice(
        bundle.checkpoint.final,
        st.value,
        bundle.checkpoint.compare,
        { isFinal: true },
      );
      storeErrors.push(...finalErrs);
      sliceScores.push(finalErrs.length ? 0 : 1);
      captureSlice('final', finalErrs.length === 0, st.value);
    }
  }

  if (!bindstore_empty && storeErrors.length === 0 && create_ok && replay_ok) store_match = 1;
  else if (storeErrors.length) notes.push(...storeErrors);
  if (argvIssues.length) notes.push(...argvIssues);

  return {
    create_ok,
    replay_ok,
    store_match,
    argv_ok,
    bindstore_empty,
    timeout,
    primaryHint,
    notes,
    sliceScores,
    stills,
  };
}

export function replayJudgeHygiene({ gameDir, bundle, builderLog, stillsDir }) {
  const mechanical = replayAndJudge({ gameDir, bundle, stillsDir });
  const hygiene = scanHygiene({ gameDir, builderLog });
  const hygiene_ok = hygiene.ok ? 1 : 0;
  if (!hygiene.ok) mechanical.notes.push(...hygiene.issues);
  return { ...mechanical, hygiene_ok };
}
