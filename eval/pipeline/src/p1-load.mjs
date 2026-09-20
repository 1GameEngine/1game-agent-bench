import fs from 'node:fs';
import path from 'node:path';
import { EVAL_DIR, taskDir } from './paths.mjs';
import { loadYaml, loadJson } from './load.mjs';
import { EvalError } from './util.mjs';
import { auditClosedPlayplan } from './p1-closed.mjs';
import { loadSchemaFile } from './p1-schema.mjs';

export const P1_TASKS = ['p1-signal-desk', 'p1-grid-scout', 'p1-ready-run'];

const ENGINE_WORDS = ['ColorRect', 'Autoload', 'bindStore', 'CharacterBody2D', '<node>', 'For'];

export function loadP1Task(taskId) {
  const dir = taskDir(taskId);
  const task = loadYaml(path.join(dir, 'task.yaml'));
  const geometry = loadYaml(path.join(dir, 'geometry.yaml'));
  const playplan = loadJson(path.join(dir, 'playplan.json'));
  const playplanNeg = loadJson(path.join(dir, 'playplan.neg.json'));
  const checkpoint = loadJson(path.join(dir, 'checkpoint.json'));
  const instruction = fs.readFileSync(path.join(dir, 'instruction.md'), 'utf8');
  const { schema, sha } = loadSchemaFile(path.join(dir, 'dump.schema.json'));
  if (task.id !== taskId || task.tier !== 'P1') throw new EvalError('EVAL_INTERNAL', `P1 task meta ${taskId}`);
  if (task.judge !== 'schema_strict' || task.rng !== 'forbidden' || task.physics !== 'forbidden') {
    throw new EvalError('EVAL_INTERNAL', `P1 flags ${taskId}`);
  }
  if (task.scene?.count !== 1 || task.scene?.width !== 1280 || task.scene?.height !== 720) {
    throw new EvalError('EVAL_INTERNAL', `P1 scene must be 1×1280×720`);
  }
  if (checkpoint.compare?.mode !== 'schema_strict' || checkpoint.compare?.extras !== 'fail') {
    throw new EvalError('EVAL_INTERNAL', 'P1 checkpoint must be schema_strict extras=fail');
  }
  if (checkpoint.select !== 'dump') throw new EvalError('EVAL_INTERNAL', 'P1 checkpoint select dump');
  for (const w of ENGINE_WORDS) {
    if (instruction.includes(w)) throw new EvalError('EVAL_INTERNAL', `engine word ${w} in ${taskId} instruction`);
  }
  for (const plan of [playplan, playplanNeg]) {
    const a = auditClosedPlayplan(plan, geometry);
    if (!a.ok) throw new EvalError('EVAL_INTERNAL', `${taskId} playplan: ${a.issues.join('; ')}`);
  }
  for (const plan of [playplan, playplanNeg]) {
    for (const step of plan.steps) {
      if (step.checkpoint && !checkpoint.slices[step.checkpoint]) {
        throw new EvalError('EVAL_INTERNAL', `${taskId} missing slice ${step.checkpoint}`);
      }
    }
  }
  return { task, geometry, playplan, playplanNeg, checkpoint, instruction, schema, sha };
}
