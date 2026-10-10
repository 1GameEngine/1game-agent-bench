import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { EvalError } from './util.mjs';

function liveGroup(pgid) {
  // Zombies cannot modify submissions or evidence; orphaned grandchildren
  // are reaped by the system, not by this process.
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === pgid && fields[0] !== 'Z' && fields[0] !== 'X') return true;
    } catch (err) { if (!['ENOENT', 'ESRCH'].includes(err.code)) throw err; }
  }
  return false;
}

function signalGroup(pgid, signal) {
  try { process.kill(-pgid, signal); }
  catch (err) { if (err.code !== 'ESRCH') throw err; }
}

// Own the entire subprocess group, including grandchildren launched through
// spawnSync. The supervising process stays asynchronous and can honor timers.
export async function runValidationProcess(argv, { stopAt, graceMs = 5000, now = Date.now,
  cwd, env = process.env, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (process.platform !== 'linux') throw new EvalError('EVAL_INTERNAL', 'bounded validation requires Linux process groups');
  if (!Number.isFinite(stopAt)) throw new EvalError('SUBAGENT_INVALID', 'validation stop time is required');
  if (now() >= stopAt) return { stopped: true, status: null, stdout: '', stderr: '', reason: 'closing_reserve' };
  const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', bytes = 0, cause = null, timer, stopPromise;
  let rejectStop;
  const stopFailure = new Promise((_resolve, reject) => { rejectStop = reject; });
  stopFailure.catch(() => {});
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve({ status, signal }));
  });
  // Prevent an early spawn error from becoming an unhandled rejection while
  // the supervisor finishes setup.
  closed.catch(() => {});
  exited.catch(() => {});
  const stop = (why) => {
    if (stopPromise) return stopPromise;
    cause = why;
    stopPromise = (async () => {
      if (!child.pid) return;
      signalGroup(child.pid, 'SIGTERM');
      const killAt = Date.now() + graceMs;
      while (liveGroup(child.pid) && Date.now() < killAt) await delay(20);
      if (liveGroup(child.pid)) signalGroup(child.pid, 'SIGKILL');
      const reapAt = Date.now() + 2000;
      while (liveGroup(child.pid) && Date.now() < reapAt) await delay(20);
      if (liveGroup(child.pid)) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'validation process group did not stop');
    })();
    stopPromise.catch(rejectStop);
    return stopPromise;
  };
  const collect = (kind, buffer) => {
    bytes += Buffer.byteLength(buffer);
    if (bytes > maxBytes) { void stop('output_limit'); return; }
    if (kind === 'stdout') stdout += buffer; else stderr += buffer;
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', b => collect('stdout', b));
  child.stderr.on('data', b => collect('stderr', b));
  const onTerm = () => { void stop('interrupted'); };
  process.on('SIGTERM', onTerm);
  process.on('SIGINT', onTerm);
  timer = setTimeout(() => { void stop('closing_reserve'); }, Math.max(0, stopAt - now()));
  try {
    // 'close' waits for inherited output pipes too. Start descendant cleanup
    // on worker exit, otherwise an orphan holding a pipe open hides completion.
    const result = await Promise.race([exited, stopFailure]);
    // xvfb-run sends SIGTERM to its display server without waiting for it.
    // Permit a brief natural shutdown, still within the existing stage timer.
    const settleAt = Date.now() + 200;
    while (!stopPromise && liveGroup(child.pid) && Date.now() < settleAt) await delay(20);
    // Native renderers may leave auxiliary daemons behind after their command
    // exits. The worker's result is usable only after all descendants stop.
    if (!stopPromise && liveGroup(child.pid)) await stop('cleanup_after_exit');
    if (stopPromise) await stopPromise;
    await Promise.race([closed, stopFailure]);
    if (cause && !['closing_reserve', 'cleanup_after_exit'].includes(cause)) throw new EvalError('SUBAGENT_PROCESS_FAILED', `validation ${cause}`);
    if (!cause && result.signal) throw new EvalError('SUBAGENT_PROCESS_FAILED', `validation exited on ${result.signal}`);
    return { ...result, stdout, stderr, stopped: cause === 'closing_reserve', reason: cause,
      descendants_cleaned: cause === 'cleanup_after_exit' };
  } catch (err) {
    await stop('process_error');
    if (err instanceof EvalError) throw err;
    throw new EvalError('SUBAGENT_PROCESS_FAILED', err.message);
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onTerm);
  }
}
