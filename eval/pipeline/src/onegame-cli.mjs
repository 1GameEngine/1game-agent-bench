import fs from 'node:fs';
import path from 'node:path';
import { PIN } from './paths.mjs';
import { execFileOk } from './exec.mjs';
import { EvalError } from './util.mjs';

// Resolve only this workspace's installation, never a global or ancestor CLI.
export function onegameCliPath(gameDir) {
  const root = path.join(gameDir, 'node_modules', '@1game', 'cli-1gameplay');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch (err) {
    throw new EvalError('CLI_UNAVAILABLE', `workspace 1gameplay unavailable: ${err.message}`);
  }
  if (pkg.name !== '@1game/cli-1gameplay' || pkg.version !== PIN) {
    throw new EvalError('PIN_MISMATCH', `workspace 1gameplay must be ${PIN}, got ${pkg.version}`);
  }
  const rel = typeof pkg.bin === 'object' ? pkg.bin['1gameplay'] : undefined;
  if (typeof rel !== 'string') throw new EvalError('CLI_UNAVAILABLE', '1gameplay bin missing');
  const bin = path.resolve(root, rel);
  if (!bin.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(bin)) {
    throw new EvalError('CLI_UNAVAILABLE', '1gameplay bin must exist inside its package');
  }
  return bin;
}

export function runOnegameCli(gameDir, argv, options = {}) {
  if (argv[0] !== '1gameplay') throw new EvalError('EVAL_INTERNAL', 'expected 1gameplay argv');
  return execFileOk(process.execPath, [onegameCliPath(gameDir), ...argv.slice(1)], {
    ...options, cwd: gameDir, timeoutMs: options.timeoutMs ?? 180_000,
  });
}
