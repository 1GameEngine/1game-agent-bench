import fs from 'node:fs';
import path from 'node:path';
import { taskDir } from './paths.mjs';
import { P1_TASKS } from './product-100.mjs';
import { loadYaml, loadJson } from './load.mjs';
import { EvalError } from './util.mjs';
import { validateRubric } from './rubric.mjs';
import { validateProbe } from './probe.mjs';

export { P1_TASKS };

const ENGINE_WORDS = ['ColorRect', 'Autoload', 'bindStore', 'CharacterBody2D', '<node>', 'For'];

export function loadP1Task(taskId) {
  const dir = taskDir(taskId);
  const task = loadYaml(path.join(dir, 'task.yaml'));
  const instruction = fs.readFileSync(path.join(dir, 'instruction.md'), 'utf8');
  const rubric = loadJson(path.join(dir, 'judge', 'rubric.json'));
  const probe = loadJson(path.join(dir, 'judge', 'probe.json'));
  if (task.id !== taskId || task.tier !== 'P1') throw new EvalError('EVAL_INTERNAL', `P1 task meta ${taskId}`);
  if (task.judge !== 'rubric_replay' || task.rng !== 'forbidden' || task.physics !== 'forbidden') {
    throw new EvalError('EVAL_INTERNAL', `P1 flags ${taskId}`);
  }
  if (task.scene?.count !== 1 || task.scene?.width !== 1280 || task.scene?.height !== 720) {
    throw new EvalError('EVAL_INTERNAL', `P1 scene must be 1×1280×720`);
  }
  if (task.traces !== 'submitted' || task.replay_fps !== 30) {
    throw new EvalError('EVAL_INTERNAL', `P1 traces must be submitted at 30fps`);
  }
  if (fs.existsSync(path.join(dir, 'dump.schema.json'))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} must not use dump.schema.json as judge`);
  }
  if (fs.existsSync(path.join(dir, 'playplan.json'))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} must not ship official playplan`);
  }
  for (const w of ENGINE_WORDS) {
    if (instruction.includes(w)) throw new EvalError('EVAL_INTERNAL', `engine word ${w} in ${taskId} instruction`);
  }
  if (rubric.score_formula !== 'G * (40*M + 10*D + 20*V + 30*A)') {
    throw new EvalError('EVAL_INTERNAL', `${taskId} rubric formula`);
  }
  const vr = validateRubric(rubric);
  if (!vr.ok) throw new EvalError('EVAL_INTERNAL', `${taskId} rubric ${vr.issues.join('; ')}`);
  const vp = validateProbe(probe, rubric);
  if (!vp.ok) throw new EvalError('EVAL_INTERNAL', `${taskId} probe ${vp.issues.join('; ')}`);
  return { task, instruction, rubric, probe, geometry: { regions: {}, labels: {} } };
}
