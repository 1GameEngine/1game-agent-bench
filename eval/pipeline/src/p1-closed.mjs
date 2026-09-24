export const CLOSED_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
];

export const CLOSED_OPS = ['tick', 'click', 'keydown', 'keyup', 'checkpoint'];

export function stepOp(step) {
  const ops = CLOSED_OPS.filter((k) => Object.prototype.hasOwnProperty.call(step, k));
  return ops.length === 1 ? ops[0] : null;
}

export function auditClosedPlayplan(playplan, geometry) {
  const issues = [];
  if (playplan?.schema !== 'eval.playplan/1') issues.push('schema');
  if (playplan?.closed_set !== true) issues.push('closed_set must be true');
  if (playplan?.post_ticks_after_input !== 1) issues.push('post_ticks_after_input must be 1');
  for (const banned of ['until', 'uid', 'locator', 'wait_wall', 'screenshot', 'bash', 'hover', 'drag', 'wheel']) {
    if (banned in (playplan ?? {})) issues.push(`forbidden field ${banned}`);
  }
  const regions = new Set(Object.keys(geometry?.regions ?? {}));
  const ids = new Set();
  for (const step of playplan?.steps ?? []) {
    if (!step?.id || ids.has(step.id)) issues.push(`bad id ${step?.id}`);
    ids.add(step.id);
    const op = stepOp(step);
    if (!op) {
      issues.push(`step ${step.id} must have exactly one closed op`);
      continue;
    }
    if (op === 'tick') {
      if (!Number.isInteger(step.tick) || step.tick < 1) issues.push(`tick n invalid at ${step.id}`);
    }
    if (op === 'click') {
      if (typeof step.click !== 'string' || !regions.has(step.click)) {
        issues.push(`click region missing: ${step.click}`);
      }
    }
    if (op === 'keydown' || op === 'keyup') {
      if (!CLOSED_KEYS.includes(step[op])) issues.push(`key not in closed set: ${step[op]}`);
    }
    if (op === 'checkpoint' && typeof step.checkpoint !== 'string') {
      issues.push(`checkpoint id missing at ${step.id}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function regionCenter(region) {
  return `${region.x + region.w / 2},${region.y + region.h / 2}`.replace(/\.0,/g, ',').replace(/\.0$/, '');
}

export function clickCoord(geometry, name) {
  const r = geometry.regions[name];
  const x = r.x + r.w / 2;
  const y = r.y + r.h / 2;
  return `${x},${y}`;
}
