import { spawnSync } from 'node:child_process';
import { EvalError } from './util.mjs';

export function execFileOk(file, argv, { cwd, timeoutMs = 120_000, env = process.env } = {}) {
  const started = Date.now();
  const result = spawnSync(file, argv, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  if (timedOut) {
    throw new EvalError('TIMEOUT', `${file} ${argv.join(' ')} timed out`, { cwd });
  }
  if (result.error && result.error.code !== 'ETIMEDOUT') {
    throw new EvalError('EVAL_INTERNAL', result.error.message, { file, argv });
  }
  return {
    file,
    argv,
    cwd,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ms: Date.now() - started,
  };
}

export function whichPnpm() {
  const r = spawnSync('pnpm', ['-v'], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new EvalError('EVAL_INTERNAL', 'pnpm is required (9+)');
  }
  return r.stdout.trim();
}
