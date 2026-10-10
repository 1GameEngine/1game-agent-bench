import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { EvalError } from './util.mjs';
import { stageResponseError } from './stage-result.mjs';
import { readStageStart } from './cloud-agent-subagent.mjs';

// Read only public lifecycle metadata, never a rubric or a game state.
export function readStageContext(timingPath, expected = {}, now = Date.now) {
  let timing, request;
  try {
    timing = JSON.parse(fs.readFileSync(timingPath, 'utf8'));
    request = JSON.parse(fs.readFileSync(path.join(path.dirname(timingPath), `${timing.id}.request.json`), 'utf8'));
  } catch (err) { throw new EvalError('SUBAGENT_INVALID', `stage lifecycle unavailable: ${err.message}`); }
  if (timing.schema !== 'eval.cloud-stage-timing/1' || !['QUEUED', 'RUNNING'].includes(timing.state) || request.id !== timing.id ||
      path.resolve(timingPath) !== path.resolve(request.lifecycle.timing_path) ||
      timing.role !== request.spec.role || timing.engine !== request.spec.engine || timing.taskId !== request.spec.taskId) {
    throw new EvalError('SUBAGENT_INVALID', 'stage lifecycle is not an active matching request');
  }
  if (!Number.isSafeInteger(timing.execution_timeout_ms) || timing.execution_timeout_ms < 1 || timing.execution_timeout_ms > 2147483647) {
    throw new EvalError('SUBAGENT_INVALID', 'invalid stage execution budget');
  }
  if (timing.state === 'QUEUED') {
    // A valid start receipt activates the request immediately, independently
    // of the supervisor's polling interval. Never backfill the timing file.
    const startedAt = readStageStart(timing, request.lifecycle.start_path, { now });
    timing = { ...timing, state: 'RUNNING', started_at: new Date(startedAt).toISOString(),
      execution_deadline_at: new Date(startedAt + timing.execution_timeout_ms).toISOString() };
  }
  const deadline = Date.parse(timing.execution_deadline_at);
  if (!Number.isFinite(deadline) || deadline !== Date.parse(timing.started_at) + timing.execution_timeout_ms ||
      !Number.isInteger(timing.closing_reserve_ms) || timing.closing_reserve_ms < 0) {
    throw new EvalError('SUBAGENT_INVALID', 'invalid stage deadline');
  }
  for (const key of ['engine', 'taskId', 'workspace']) {
    if (expected[key] == null) continue;
    const actual = request.spec[key];
    if (key === 'workspace' ? path.resolve(actual) !== path.resolve(expected[key]) : actual !== expected[key]) {
      throw new EvalError('SUBAGENT_INVALID', `stage ${key} does not match the validation request`);
    }
  }
  if (now() >= deadline) throw new EvalError(`${timing.role.toUpperCase()}_TIMEOUT`, 'stage execution deadline has passed');
  return { timing, request, deadline,
    // The wrap-up reminder is still not a hard cutoff. Half of its reserve
    // remains available to finish validation; the other half is for publishing.
    validationStopAt: deadline - Math.ceil(timing.closing_reserve_ms / 2) };
}

export function publishStageResponse({ timingPath, data, archivePath }, { now = Date.now } = {}) {
  const ctx = readStageContext(timingPath, {}, now);
  const malformed = stageResponseError(ctx.request.spec, data);
  if (malformed?.primary === 'SUBAGENT_INVALID') throw malformed;
  const responsePath = ctx.request.lifecycle.response_path;
  const archives = [...new Set([ctx.request.lifecycle.archive_response_path, archivePath].filter(Boolean).map(p => path.resolve(p)))];
  if (!archives.length || archives.includes(path.resolve(responsePath))) {
    throw new EvalError('SUBAGENT_INVALID', 'a separate response archive is required');
  }
  const lock = `${responsePath}.publish-lock`;
  let lockFd;
  const temps = [];
  try {
    lockFd = fs.openSync(lock, 'wx');
    if ([responsePath, ...archives].some(p => fs.existsSync(p))) throw new EvalError('SUBAGENT_INVALID', 'stage response already published');
    const body = JSON.stringify(data) + '\n';
    for (const dest of [...archives, responsePath]) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const temp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
      temps.push(temp);
      fs.writeFileSync(temp, body, { flag: 'wx' });
    }
    // Prepare both files before publication. Archive first, so the consumer
    // cannot remove the accepted receipt before its identical archive exists.
    readStageContext(timingPath, {}, now);
    for (const [i, archive] of archives.entries()) fs.renameSync(temps[i], archive);
    if (now() >= ctx.deadline) throw new EvalError(`${ctx.timing.role.toUpperCase()}_TIMEOUT`, 'stage expired while archiving response');
    fs.renameSync(temps.at(-1), responsePath);
    return { response_path: responsePath, archive_response_path: archives[0], extra_archive_paths: archives.slice(1) };
  } catch (err) {
    if (err.code === 'EEXIST') throw new EvalError('SUBAGENT_INVALID', 'another publisher already owns this response');
    throw err;
  } finally {
    for (const temp of temps) fs.rmSync(temp, { force: true });
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.rmSync(lock, { force: true }); }
  }
}
