import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_DIR } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { mountAssetLibrary } from './assets.mjs';
import { auditModelSubmission } from './model-builder.mjs';
import { checkOnegameBoot } from './p1-onegame.mjs';
import { checkGodotBoot } from './p1-godot.mjs';
import { EvalError } from './util.mjs';
import { createSubmissionManifest, writeSubmissionManifest } from './submission-manifest.mjs';

// Avoid importing subagent-stage: it launches this entry point. Engine adapters
// remain synchronous and run in the supervised worker's process group.
export function executeAction({ action, engine, taskId, workspace, runId, instruction,
  publicTask, stageId, manifestPath } = {}) {
  if (!['onegame', 'godot'].includes(engine)) throw new EvalError('SUBAGENT_INVALID', 'worker requires a supported engine');
  if (['audit', 'boot', 'manifest'].includes(action) && (typeof workspace !== 'string' || !workspace)) {
    throw new EvalError('SUBAGENT_INVALID', 'worker requires a workspace');
  }
  if (action === 'audit') return auditModelSubmission(workspace, engine, taskId);
  if (action === 'boot') return engine === 'onegame' ? checkOnegameBoot(workspace) : checkGodotBoot(workspace);
  if (action === 'manifest') {
    if (typeof manifestPath !== 'string' || !manifestPath) throw new EvalError('SUBAGENT_INVALID', 'manifest worker requires an output path');
    return writeSubmissionManifest(manifestPath, createSubmissionManifest({ workspace, engine, taskId, runId, stageId, publicTask }));
  }
  if (action !== 'prepare') throw new EvalError('SUBAGENT_INVALID', `unsupported execution worker action: ${action}`);
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(runId) || typeof instruction !== 'string') {
    throw new EvalError('SUBAGENT_INVALID', 'worker prepare requires a safe run id and instruction');
  }
  if (engine === 'onegame') {
    const boot = bootstrap({ taskId, runId: `${runId}-og`, instruction, oracle: false });
    return { workspace: boot.gameDir, replayRunId: `${runId}-og`, outPath: path.join(WORK_DIR, `${runId}-og`, 'REPLAY.json') };
  }
  const dest = path.join(WORK_DIR, `${runId}-gd-generated`, 'godot');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'instruction.md'), instruction);
  mountAssetLibrary(dest, taskId);
  return { workspace: dest, replayRunId: `${runId}-gd`, outPath: path.join(WORK_DIR, `${runId}-gd`, 'REPLAY.json') };
}

export function main() {
  try {
    const value = executeAction(JSON.parse(fs.readFileSync(0, 'utf8')));
    process.stdout.write(JSON.stringify({ ok: true, value: value ?? null }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false,
      error: { primary: err.primary || 'EVAL_INTERNAL', message: String(err.message || err), extra: err.extra ?? {} } }) + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
