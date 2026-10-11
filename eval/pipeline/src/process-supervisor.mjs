import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { EvalError } from './util.mjs';

function liveGroup(pgid) {
  // An exited zombie cannot modify a submission or hold an output pipe open.
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[2]) === pgid && !['Z', 'X'].includes(fields[0])) return true;
    } catch (err) { if (!['ENOENT', 'ESRCH'].includes(err.code)) throw err; }
  }
  return false;
}

function signalGroup(pgid, signal) {
  try { process.kill(-pgid, signal); }
  catch (err) { if (err.code !== 'ESRCH') throw err; }
}

// Only the supervisor must be asynchronous. Synchronous engine CLIs live in
// this child's process group, without blocking deadline timers or agent polling.
export async function runProcess(argv, { deadline, stopAt = deadline, deadlineReason = 'timeout',
  graceMs = 5000, reapMs = 2000, now = Date.now, cwd, env = process.env,
  maxBytes = 20 * 1024 * 1024, input, signal } = {}) {
  if (process.platform !== 'linux') throw new EvalError('EVAL_INTERNAL', 'bounded execution requires Linux process groups');
  if (!Array.isArray(argv) || !argv.length || !argv[0] || argv.some(v => typeof v !== 'string') ||
      (input != null && typeof input !== 'string' && !(input instanceof Uint8Array)) ||
      !Number.isFinite(deadline) || !Number.isFinite(stopAt) ||
      !['timeout', 'closing_reserve'].includes(deadlineReason) ||
      !Number.isSafeInteger(graceMs) || graceMs < 0 || !Number.isSafeInteger(reapMs) || reapMs < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new EvalError('SUBAGENT_INVALID', 'invalid bounded process request');
  }
  const cutoff = Math.min(deadline, stopAt);
  const stamp = () => new Date(now()).toISOString();
  if (signal?.aborted) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'process interrupted before launch', {
    process_result: { status: null, signal: null, stopped: false, reason: 'interrupted', descendants_cleaned: false,
      started_at: null, finished_at: null, cleanup_finished_at: stamp() },
  });
  if (now() >= cutoff) return { status: null, signal: null, stdout: '', stderr: '', stopped: true,
    reason: deadlineReason, descendants_cleaned: false, started_at: null, finished_at: stamp(), cleanup_finished_at: stamp() };
  const startedAt = stamp();
  let child;
  try {
    child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true,
      stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  } catch (err) { throw new EvalError('SUBAGENT_PROCESS_FAILED', err.message, {
    process_result: { status: null, signal: null, stopped: false, reason: 'spawn_error', descendants_cleaned: false,
      started_at: null, finished_at: null, cleanup_finished_at: stamp() },
  }); }
  let stdout = '', stderr = '', bytes = 0, cause = null, fault = null, timer, stopPromise, finishedAt = null;
  let exitStatus = null, exitSignal = null;
  let deadlineReached = false, descendantsCleaned = false, rejectStop;
  let cleanupReapAt = null, outputPipesUnclosed = false;
  const stopFailure = new Promise((_resolve, reject) => { rejectStop = reject; });
  stopFailure.catch(() => {});
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => {
      exitStatus = status; exitSignal = signal; finishedAt = stamp(); resolve({ status, signal });
    });
  });
  closed.catch(() => {});
  exited.catch(() => {});
  const stop = (why) => {
    if (why === deadlineReason) deadlineReached = true;
    else if (why !== 'cleanup_after_exit') fault ||= why;
    if (stopPromise) return stopPromise;
    cause = why;
    stopPromise = (async () => {
      if (!child.pid) return;
      signalGroup(child.pid, 'SIGTERM');
      // Cleanup grace uses a monotonic clock even if wall time is corrected.
      const killAt = performance.now() + graceMs;
      while (liveGroup(child.pid) && performance.now() < killAt) await delay(20);
      if (liveGroup(child.pid)) signalGroup(child.pid, 'SIGKILL');
      cleanupReapAt = performance.now() + reapMs;
      while (liveGroup(child.pid) && performance.now() < cleanupReapAt) await delay(20);
      if (liveGroup(child.pid)) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'process group did not stop');
    })().catch(err => {
      if (err instanceof EvalError) throw err;
      throw new EvalError('SUBAGENT_PROCESS_FAILED', `process cleanup failed: ${err.message}`);
    });
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
  signal?.addEventListener('abort', onTerm, { once: true });
  timer = setTimeout(() => { void stop(deadlineReason); }, Math.max(0, cutoff - now()));
  if (child.stdin) {
    // A command may intentionally close stdin before consuming its full request.
    child.stdin.on('error', err => { if (err.code !== 'EPIPE') void stop('input_error'); });
    child.stdin.end(input);
  }
  try {
    const result = await Promise.race([exited, stopFailure]);
    // xvfb-run briefly leaves its display server shutting down naturally.
    const settleAt = performance.now() + 200;
    while (!stopPromise && liveGroup(child.pid) && performance.now() < settleAt) await delay(20);
    if (!stopPromise && liveGroup(child.pid)) {
      descendantsCleaned = true;
      await stop('cleanup_after_exit');
    }
    if (stopPromise) await stopPromise;
    // A descendant can start its own session while keeping these pipes open.
    // Share the cleanup reap window, rather than adding an unbounded close wait
    // or extending the advertised TERM + reap allowance.
    let closeTimer;
    const closeExpired = new Promise((_resolve, reject) => {
      closeTimer = setTimeout(() => {
        outputPipesUnclosed = true;
        reject(new EvalError('SUBAGENT_PROCESS_FAILED', 'process output pipes did not close after group cleanup'));
      }, Math.max(0, (cleanupReapAt ?? performance.now() + reapMs) - performance.now()));
    });
    try { await Promise.race([closed, stopFailure, closeExpired]); }
    finally { clearTimeout(closeTimer); }
    if (fault) throw new EvalError('SUBAGENT_PROCESS_FAILED', `process ${fault}`);
    if (!deadlineReached && result.signal) throw new EvalError('SUBAGENT_PROCESS_FAILED', `process exited on ${result.signal}`);
    // A worker exit cannot hide cleanup that carries its process group beyond
    // the cutoff. Publication still independently enforces its own deadline.
    deadlineReached ||= now() >= cutoff;
    return { ...result, stdout, stderr, stopped: deadlineReached,
      reason: deadlineReached ? deadlineReason : cause, descendants_cleaned: descendantsCleaned,
      started_at: startedAt, finished_at: finishedAt, cleanup_finished_at: stamp() };
  } catch (err) {
    // Record failures only after awaiting cleanup, without retaining stdout,
    // argv, stdin or environment in the timeline. Failed cleanup stays explicit:
    // a null cleanup_finished_at must never imply that the group was reclaimed.
    const reason = fault ?? (deadlineReached ? deadlineReason : exitSignal ? 'signal' : child.pid ? 'process_error' : 'spawn_error');
    let cleanupError = null;
    try { await stop('process_error'); } catch (failure) { cleanupError = failure; }
    const failure = cleanupError ?? err;
    const error = failure instanceof EvalError ? failure : new EvalError('SUBAGENT_PROCESS_FAILED', failure.message);
    error.extra = { ...error.extra, process_result: {
      status: exitStatus, signal: exitSignal, stopped: deadlineReached,
      reason: cleanupError ? 'cleanup_failed' : outputPipesUnclosed ? 'output_pipes_unclosed' : reason,
      descendants_cleaned: cleanupError || outputPipesUnclosed ? false : descendantsCleaned,
      started_at: child.pid ? startedAt : null, finished_at: finishedAt,
      cleanup_finished_at: cleanupError || outputPipesUnclosed ? null : stamp(),
      ...(cleanupError || outputPipesUnclosed ? { cleanup_attempt_finished_at: stamp() } : {}),
    } };
    // Do not let inherited descriptors keep the supervisor itself alive after
    // a failed reclamation. This is an explicit failure, never a clean receipt.
    child.stdin?.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onTerm);
    signal?.removeEventListener('abort', onTerm);
  }
}
