import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PIN, REQUIRED_ONEGAME, gameDir as gameDirFor, oracleGame, oracleTraces } from './paths.mjs';
import { EvalError } from './util.mjs';
import { execFileOk, whichPnpm } from './exec.mjs';

function nodeMajor() {
  return Number(process.versions.node.split('.')[0]);
}

function pnpmMajor(v) {
  return Number(String(v).split('.')[0]);
}

function assertPreflight() {
  if (nodeMajor() < 20) {
    throw new EvalError('EVAL_INTERNAL', `Node >= 20 required, got ${process.versions.node}`);
  }
  const pnpmV = whichPnpm();
  if (pnpmMajor(pnpmV) < 9) {
    throw new EvalError('EVAL_INTERNAL', `pnpm 9+ required, got ${pnpmV}`);
  }
  if (process.env.ONEGAME_ENGINE_CDN_BASE) {
    throw new EvalError('SPEC_VIOLATION', 'ONEGAME_ENGINE_CDN_BASE must be unset');
  }
}

function emptyEnough(dir) {
  if (!fs.existsSync(dir)) return true;
  const allowed = new Set(['.cursor', '.agents', '.claude', '.DS_Store']);
  for (const name of fs.readdirSync(dir)) {
    if (!allowed.has(name)) return false;
  }
  return true;
}

function patchPnpmBuildAllowlist(pkgPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.pnpm = {
    ...(pkg.pnpm ?? {}),
    onlyBuiltDependencies: Array.from(
      new Set([...(pkg.pnpm?.onlyBuiltDependencies ?? []), 'better-sqlite3', 'esbuild', '@napi-rs/canvas']),
    ),
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function ensureBetterSqlite3(cwd) {
  const require = createRequire(path.join(cwd, 'package.json'));
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
  } catch {
    return;
  }
  const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(binding)) return;
  const install = execFileOk('npm', ['run', 'install'], { cwd: pkgDir, timeoutMs: 180_000 });
  if (install.status !== 0 || !fs.existsSync(binding)) {
    throw new EvalError(
      'EVAL_INTERNAL',
      `better-sqlite3 native binding missing\n${install.stdout}\n${install.stderr}`,
    );
  }
}

function pinGate(cwd) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const issues = [];
  for (const name of REQUIRED_ONEGAME) {
    if (deps[name] !== PIN) issues.push(`${name}=${deps[name]}`);
  }
  if (deps['@1game/cli'] !== deps['@1game/engine-bundle']) {
    issues.push('cli/engine-bundle mismatch');
  }
  if (issues.length) {
    throw new EvalError('HYGIENE_FAIL', `pin gate failed: ${issues.join('; ')}`);
  }
}

export function bootstrap({ taskId, runId, instruction, oracle = false, replaceExisting = true }) {
  assertPreflight();
  const cwd = gameDirFor(runId);
  if (replaceExisting && fs.existsSync(cwd)) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
  fs.mkdirSync(cwd, { recursive: true });
  if (!emptyEnough(cwd)) {
    throw new EvalError(
      'EVAL_INTERNAL',
      'game dir must be empty except .cursor/.agents/.claude/.DS_Store before 1game init',
    );
  }
  for (const banned of ['instruction.md', 'AGENTS.md', 'README.md', 'package.json', '.git', '.npmrc']) {
    if (fs.existsSync(path.join(cwd, banned))) {
      throw new EvalError('EVAL_INTERNAL', `must not exist before init: ${banned}`);
    }
  }

  const init = execFileOk('npx', ['-y', `@1game/cli@${PIN}`, 'init', '.'], { cwd, timeoutMs: 180_000 });
  if (init.status !== 0) {
    throw new EvalError('CREATE_FAIL', `1game init failed\n${init.stderr}\n${init.stdout}`);
  }

  patchPnpmBuildAllowlist(path.join(cwd, 'package.json'));
  const install = execFileOk('pnpm', ['install'], { cwd, timeoutMs: 180_000 });
  if (install.status !== 0) {
    throw new EvalError('EVAL_INTERNAL', `pnpm install failed\n${install.stderr}\n${install.stdout}`);
  }
  ensureBetterSqlite3(cwd);

  const activate = execFileOk('pnpm', ['exec', '1game-skill', 'activate', '--cursor', '--force'], {
    cwd,
    timeoutMs: 60_000,
  });
  if (activate.status !== 0) {
    throw new EvalError('HYGIENE_FAIL', `1game-skill activate --cursor --force failed\n${activate.stderr}`);
  }
  pinGate(cwd);

  fs.writeFileSync(path.join(cwd, 'instruction.md'), instruction);
  if (oracle) {
    const src = oracleGame(taskId);
    fs.copyFileSync(src, path.join(cwd, 'src', 'game.tsx'));
    const traces = oracleTraces(taskId, 'onegame');
    if (fs.existsSync(traces)) {
      fs.cpSync(traces, path.join(cwd, 'demo_outputs'), { recursive: true });
    }
  }
  return { gameDir: cwd };
}
