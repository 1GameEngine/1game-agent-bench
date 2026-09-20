import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PIPELINE_DIR = path.resolve(here, '..');
export const EVAL_DIR = path.resolve(PIPELINE_DIR, '..');
export const REPO_DIR = path.resolve(EVAL_DIR, '..');
export const WORK_DIR = path.join(REPO_DIR, 'work');
export const PIN = '1.21.0';
export const RECORD_REL = 'out/eval.1gamerecord';
export const REQUIRED_ONEGAME = [
  '@1game/cli',
  '@1game/engine-bundle',
  '@1game/cli-1gameplay',
  '@1game/skill',
];
export const PINNED_OK = new Set(REQUIRED_ONEGAME);
export const DIMENSIONS = ['create_ok', 'replay_ok', 'store_match', 'argv_ok', 'hygiene_ok'];
export const P0_NOTICE =
  'P0 机械五维表；报表前缀 P0_；headline_track=none；不可与 Godot 对比；禁止 overall / total_score。';

export function gameDir(runId) {
  return path.join(WORK_DIR, runId, 'game');
}

export function taskDir(taskId) {
  return path.join(EVAL_DIR, 'tasks', taskId);
}

export function oracleGame(taskId) {
  const p1 = path.join(EVAL_DIR, 'examples', 'oracles', taskId, 'onegame', 'src', 'game.tsx');
  if (fs.existsSync(p1)) return p1;
  return path.join(EVAL_DIR, 'examples', 'oracles', taskId, 'src', 'game.tsx');
}

export function oracleGodot(taskId) {
  return path.join(EVAL_DIR, 'examples', 'oracles', taskId, 'godot');
}
