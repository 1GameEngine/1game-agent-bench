import { schemaSha256 } from './p1-schema.mjs';
import { auditClosedPlayplan } from './p1-closed.mjs';
import { EvalError } from './util.mjs';
import { loadTaskBundle } from './load.mjs';

function properties(fields) {
  return {
    'eval.schema_id': { type: 'string' },
    'eval.schema_sha256': { type: 'string' },
    ...fields,
  };
}

export function p0DumpSchema(taskId) {
  const common = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
  };
  if (taskId === 'p0-click-score') {
    return {
      ...common,
      $id: 'eval.p0-click-score/1',
      required: ['eval.schema_id', 'eval.schema_sha256', 'phase', 'score'],
      properties: properties({
        phase: { enum: ['ready', 'playing'] },
        score: { type: 'integer' },
      }),
    };
  }
  if (taskId === 'p0-hud-start') {
    return {
      ...common,
      $id: 'eval.p0-hud-start/1',
      required: ['eval.schema_id', 'eval.schema_sha256', 'phase'],
      properties: properties({
        phase: { enum: ['ready', 'playing'] },
      }),
    };
  }
  if (taskId === 'p0-grid-marks') {
    return {
      ...common,
      $id: 'eval.p0-grid-marks/1',
      required: ['eval.schema_id', 'eval.schema_sha256', 'cells', 'turn'],
      properties: properties({
        cells: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
        turn: { enum: ['X', 'O'] },
      }),
    };
  }
  if (taskId === 'p0-countdown-play') {
    return {
      ...common,
      $id: 'eval.p0-countdown-play/1',
      required: ['eval.schema_id', 'eval.schema_sha256', 'phase', 'remainMs'],
      properties: properties({
        phase: { enum: ['countdown', 'playing'] },
        remainMs: { type: 'integer' },
      }),
    };
  }
  throw new EvalError('EVAL_INTERNAL', `no P0 dump schema for ${taskId}`);
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function regionForClick(geometry, coord) {
  const [sx, sy] = String(coord).split(',').map(Number);
  for (const [name, r] of Object.entries(geometry.regions ?? {})) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (cx === sx && cy === sy) return name;
  }
  for (const [name, r] of Object.entries(geometry.regions ?? {})) {
    if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) return name;
  }
  return null;
}

export function argvStepToClosed(step, geometry) {
  const argv = step.argv;
  if (argv?.includes('--click')) {
    const coord = flagValue(argv, '--click');
    const name = regionForClick(geometry, coord);
    if (!name) throw new EvalError('EVAL_INTERNAL', `P0 click ${coord} maps to no region`);
    return { id: step.id, click: name };
  }
  const repeat = flagValue(argv, '--repeat');
  const n = repeat ? Number(repeat) : 1;
  if (!Number.isInteger(n) || n < 1) throw new EvalError('EVAL_INTERNAL', `bad tick at ${step.id}`);
  return { id: step.id, tick: n };
}

export function p0ClosedPlayplan(bundle) {
  const steps = [{ id: 'cp-init', checkpoint: 'init' }];
  for (const step of bundle.playplan.steps) {
    steps.push(argvStepToClosed(step, bundle.geometry));
    for (const mid of bundle.checkpoint.mid ?? []) {
      if (mid.after === step.id) {
        steps.push({ id: `cp-${mid.after}`, checkpoint: mid.after });
      }
    }
  }
  steps.push({ id: 'cp-final', checkpoint: 'final' });
  return {
    schema: 'eval.playplan/1',
    closed_set: true,
    post_ticks_after_input: 1,
    steps,
  };
}

export function p0CheckpointSlices(checkpoint) {
  const slices = { init: checkpoint.init, final: checkpoint.final };
  for (const mid of checkpoint.mid ?? []) {
    slices[mid.after] = mid.match;
  }
  return slices;
}

export function loadP0GodotTask(taskId) {
  const bundle = loadTaskBundle(taskId);
  const schema = p0DumpSchema(taskId);
  const sha = schemaSha256(schema);
  const playplan = p0ClosedPlayplan(bundle);
  const geometry = {
    ...bundle.geometry,
    regions: bundle.geometry.regions ?? {},
  };
  const audit = auditClosedPlayplan(playplan, geometry);
  if (!audit.ok) {
    throw new EvalError('EVAL_INTERNAL', `${taskId} closed playplan: ${audit.issues.join('; ')}`);
  }
  return {
    ...bundle,
    schema,
    sha,
    playplan,
    checkpoint: { ...bundle.checkpoint, slices: p0CheckpointSlices(bundle.checkpoint) },
  };
}
