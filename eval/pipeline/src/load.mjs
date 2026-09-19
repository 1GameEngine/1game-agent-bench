import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { EVAL_DIR, PIN, taskDir } from './paths.mjs';
import { EvalError } from './util.mjs';
import { allowedClickCenters, auditPlayplanStep } from './argv-audit.mjs';

export function loadYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadSuite() {
  const suite = loadYaml(path.join(EVAL_DIR, 'suite.yaml'));
  if (suite.suite_id !== 'eval-spec/1') {
    throw new EvalError('EVAL_INTERNAL', `suite_id must be eval-spec/1, got ${suite.suite_id}`);
  }
  if (suite.headline_track !== 'none') {
    throw new EvalError('SPEC_VIOLATION', 'P0 suite headline_track must be none');
  }
  if (suite.p0_in_headline !== false) {
    throw new EvalError('SPEC_VIOLATION', 'p0_in_headline must be false');
  }
  if (suite.scoring?.overall !== 'forbidden') {
    throw new EvalError('SPEC_VIOLATION', 'scoring.overall must be forbidden');
  }
  if (suite.clock?.dt_ms !== 16 || suite.clock?.max_dt_ms !== 16 || suite.clock?.wait_means !== 'N_ticks') {
    throw new EvalError('EVAL_INTERNAL', 'P0 clock contract is dt_ms=16, wait_means=N_ticks, max_dt_ms=16');
  }
  if (suite.physics !== 'forbidden' || suite.rng !== 'forbidden') {
    throw new EvalError('SPEC_VIOLATION', 'P0 physics/rng must be forbidden');
  }
  if (suite.engines?.onegame?.npm_train !== PIN) {
    throw new EvalError('EVAL_INTERNAL', `npm_train must be ${PIN}`);
  }
  const expected = ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play'];
  if (JSON.stringify(suite.tasks) !== JSON.stringify(expected)) {
    throw new EvalError('EVAL_INTERNAL', 'suite.tasks must be the frozen P0 four');
  }
  if (JSON.stringify(suite.scoring?.dimensions) !== JSON.stringify(['create_ok', 'replay_ok', 'store_match', 'argv_ok', 'hygiene_ok'])) {
    throw new EvalError('EVAL_INTERNAL', 'scoring.dimensions must be the frozen five');
  }
  return suite;
}

export function loadArgvRules() {
  return loadJson(path.join(EVAL_DIR, 'audit', 'argv-rules.json'));
}

export function loadTaskBundle(taskId) {
  const dir = taskDir(taskId);
  const task = loadYaml(path.join(dir, 'task.yaml'));
  const geometry = loadYaml(path.join(dir, 'geometry.yaml'));
  const playplan = loadJson(path.join(dir, 'playplan.json'));
  const checkpoint = loadJson(path.join(dir, 'checkpoint.json'));
  const instruction = fs.readFileSync(path.join(dir, 'instruction.md'), 'utf8');
  const rules = loadArgvRules();

  if (task.id !== taskId || task.tier !== 'P0') {
    throw new EvalError('EVAL_INTERNAL', `task.yaml id/tier mismatch for ${taskId}`);
  }
  if (task.entry !== 'src/game.tsx') {
    throw new EvalError('EVAL_INTERNAL', 'entry must be src/game.tsx');
  }
  if (task.scene?.count !== 1 || task.scene?.width !== 320 || task.scene?.height !== 180) {
    throw new EvalError('EVAL_INTERNAL', 'P0 scene must be 1×320×180');
  }
  if (task.rng !== 'forbidden' || task.physics !== 'forbidden' || task.judge !== 'store_subset') {
    throw new EvalError('EVAL_INTERNAL', 'P0 task flags mismatch');
  }
  if (playplan.schema !== 'eval.playplan/1') {
    throw new EvalError('EVAL_INTERNAL', 'playplan schema');
  }
  for (const banned of ['until', 'uid', 'locator', 'wait_wall', 'screenshot', 'bash']) {
    if (banned in playplan) {
      throw new EvalError('EVAL_INTERNAL', `playplan forbids field ${banned}`);
    }
  }
  if (checkpoint.schema !== 'eval.checkpoint/1' || checkpoint.select !== 'store:state') {
    throw new EvalError('EVAL_INTERNAL', 'checkpoint must select store:state');
  }
  if (checkpoint.compare?.mode !== 'subset_scalar_or_listed_array') {
    throw new EvalError('EVAL_INTERNAL', 'unknown compare mode');
  }
  if (taskId !== 'p0-countdown-play' && checkpoint.compare?.remainMs_lte != null) {
    throw new EvalError('EVAL_INTERNAL', 'remainMs_lte is only for p0-countdown-play');
  }
  if (taskId === 'p0-countdown-play' && checkpoint.compare?.remainMs_lte !== 0) {
    throw new EvalError('EVAL_INTERNAL', 'p0-countdown-play remainMs_lte must be 0');
  }

  const clicks = allowedClickCenters(geometry);
  const ids = new Set();
  for (const step of playplan.steps) {
    if (ids.has(step.id)) throw new EvalError('EVAL_INTERNAL', `duplicate step id ${step.id}`);
    ids.add(step.id);
    const audit = auditPlayplanStep(step.argv, { rules, allowedClicks: clicks, recordRel: 'out/eval.1gamerecord' });
    if (!audit.ok) {
      throw new EvalError('EVAL_INTERNAL', `ingested playplan argv illegal: ${audit.issues.join('; ')}`);
    }
  }
  for (const mid of checkpoint.mid ?? []) {
    if (!ids.has(mid.after)) {
      throw new EvalError('EVAL_INTERNAL', `mid.after ${mid.after} is not a playplan step id`);
    }
  }

  return { task, geometry, playplan, checkpoint, instruction, rules, allowedClicks: clicks };
}
