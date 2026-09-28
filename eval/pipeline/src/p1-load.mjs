import fs from 'node:fs';
import path from 'node:path';
import { taskDir, EVAL_DIR } from './paths.mjs';
import { P1_TASKS } from './product-100.mjs';
import { loadYaml, loadJson } from './load.mjs';
import { EvalError } from './util.mjs';
import { validateRubric } from './rubric.mjs';
import { LOOKS_MAX_FRAMES, projectedSampleCount, TRACE_EVENT_TYPES, TRACE_KEYS } from './p1-trace.mjs';

export { P1_TASKS };

const ENGINE_WORDS = ['ColorRect', 'Autoload', 'bindStore', 'CharacterBody2D', '<node>', 'For'];
const SUPPORTED_RNG = new Set(['forbidden']);
const SUPPORTED_PHYSICS = new Set(['forbidden']);

export function loadP1Task(taskId) {
  const dir = taskDir(taskId);
  const task = loadYaml(path.join(dir, 'task.yaml'));
  const body = fs.readFileSync(path.join(dir, 'instruction.md'), 'utf8');
  const sharedPath = path.join(EVAL_DIR, 'tasks', '_shared', 'constraints.md');
  const shared = fs.readFileSync(sharedPath, 'utf8').trim();
  const instruction = `${body.trim()}\n\n${shared}\n`;
  const rubric = loadJson(path.join(dir, 'judge', 'rubric.json'));
  if (fs.existsSync(path.join(dir, 'judge', 'probe.json'))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} must not ship judge/probe.json`);
  }
  if (task.id !== taskId || task.tier !== 'P1') throw new EvalError('EVAL_INTERNAL', `P1 task meta ${taskId}`);
  if (task.judge !== 'rubric_replay' || !SUPPORTED_RNG.has(task.rng) || !SUPPORTED_PHYSICS.has(task.physics)) {
    throw new EvalError('EVAL_INTERNAL', `P1 flags ${taskId}`);
  }
  if (task.scene?.count !== 1 || task.scene?.width !== 1280 || task.scene?.height !== 720) {
    throw new EvalError('EVAL_INTERNAL', `P1 scene must be 1×1280×720`);
  }
  if (task.traces !== 'submitted' || task.replay_fps !== 30) {
    throw new EvalError('EVAL_INTERNAL', `P1 traces must be submitted at 30fps`);
  }
  const required = task.scenarios?.required;
  const allowEmpty = task.scenarios?.allow_empty ?? [];
  if (!Array.isArray(required) || required.length < 1 || required.length > 6) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} scenarios.required`);
  }
  if (new Set(required).size !== required.length) throw new EvalError('EVAL_INTERNAL', `${taskId} duplicate scenario`);
  if (allowEmpty.some((name) => !required.includes(name))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} allow_empty not in required`);
  }
  if (!Number.isInteger(task.sample_fps) || task.sample_fps < 1 || task.sample_fps > 10) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} sample_fps`);
  }
  if (!Number.isInteger(task.max_demo_seconds) || task.max_demo_seconds < 1 || task.max_demo_seconds > 20) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} max_demo_seconds`);
  }
  if (task.sample_fps * task.max_demo_seconds > LOOKS_MAX_FRAMES) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} sample_fps * max_demo_seconds exceeds ${LOOKS_MAX_FRAMES}`);
  }
  if (projectedSampleCount(task.max_demo_seconds, task.sample_fps) > LOOKS_MAX_FRAMES) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} projected stills exceed ${LOOKS_MAX_FRAMES}`);
  }
  const events = task.input?.events ?? [];
  const keys = task.input?.keys ?? [];
  if (!events.length || events.some((ev) => !TRACE_EVENT_TYPES.includes(ev))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} input.events`);
  }
  if (keys.some((key) => !TRACE_KEYS.includes(key))) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} input.keys`);
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
  if (rubric.score_formula !== 'G * (15*M + 35*D + 15*V + 35*A)') {
    throw new EvalError('EVAL_INTERNAL', `${taskId} rubric formula`);
  }
  const vr = validateRubric(rubric, { scenarios: required, sampleFps: task.sample_fps });
  if (!vr.ok) throw new EvalError('EVAL_INTERNAL', `${taskId} rubric ${vr.issues.join('; ')}`);
  return { task, instruction, rubric, geometry: { regions: {}, labels: {} } };
}
