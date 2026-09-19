import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PIN, PINNED_OK, REQUIRED_ONEGAME } from './paths.mjs';

function walkFiles(root, acc = []) {
  if (!fs.existsSync(root)) return acc;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'out') continue;
      walkFiles(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collectDeps(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
}

export function scanHygiene({ gameDir, builderLog, env = process.env }) {
  const issues = [];
  if (env.ONEGAME_ENGINE_CDN_BASE) {
    issues.push('ONEGAME_ENGINE_CDN_BASE is set; archive must embed engine');
  }

  const pkgPath = path.join(gameDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, issues: ['package.json missing'] };
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = collectDeps(pkg);

  const extra = Object.keys(deps).filter((name) => name.startsWith('@1game/') && !PINNED_OK.has(name));
  if (extra.length) {
    issues.push(`extra @1game/* not authorized on P0: ${extra.join(', ')}`);
  }
  for (const name of REQUIRED_ONEGAME) {
    if (deps[name] !== PIN) {
      issues.push(`${name} must be exactly "${PIN}", got ${JSON.stringify(deps[name])}`);
    }
  }
  if (deps['@1game/cli'] !== deps['@1game/engine-bundle']) {
    issues.push('@1game/cli and @1game/engine-bundle version strings must be equal');
  }

  for (const leaked of ['playplan.json', 'checkpoint.json']) {
    if (fs.existsSync(path.join(gameDir, leaked)) || fs.existsSync(path.join(gameDir, 'eval', leaked))) {
      issues.push(`${leaked} must not be copied into game/`);
    }
  }

  const srcFiles = walkFiles(path.join(gameDir, 'src'));
  const instruction = fs.existsSync(path.join(gameDir, 'instruction.md'))
    ? fs.readFileSync(path.join(gameDir, 'instruction.md'), 'utf8')
    : '';
  const texts = [
    instruction,
    ...srcFiles.filter((f) => /\.(tsx?|jsx?|md)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')),
  ];
  const blob = texts.join('\n');
  if (/@1game\/solid-ui|@1game\/game-store|runtime\/physics|from ['"]@1game\/physics/.test(blob)) {
    issues.push('P0 forbids extra @1game/* / physics imports');
  }
  if (/\bMath\.random\b|\bDate\.now\b/.test(blob)) {
    issues.push('P0 forbids Math.random / Date.now as gameplay input');
  }
  if (/docs\/.+\.md/.test(blob) || /1game-engine/.test(blob)) {
    issues.push('must not link engine docs/ or 1game-engine sources');
  }

  const skillSrc = path.join(gameDir, 'node_modules', '@1game', 'skill', 'skills');
  const skillDst = path.join(gameDir, '.cursor', 'skills');
  if (fs.existsSync(skillSrc) && fs.existsSync(skillDst)) {
    const installed = walkFiles(skillSrc);
    for (const file of installed) {
      const rel = path.relative(skillSrc, file);
      const copy = path.join(skillDst, rel);
      if (!fs.existsSync(copy)) continue;
      if (sha256(file) !== sha256(copy)) {
        issues.push(`modified skill copy: ${rel}`);
      }
    }
  }

  const log = builderLog ?? '';
  if (log) {
    if (/whats-new/.test(log)) issues.push('builder log: whats-new');
    if (/1game publish/.test(log)) issues.push('builder log: 1game publish');
    if (/ONEGAME_ENGINE_CDN_BASE/.test(log)) issues.push('builder log: ONEGAME_ENGINE_CDN_BASE');
    if (/activate --global/.test(log)) issues.push('builder log: activate --global');
    if (/npx skills add/.test(log)) issues.push('builder log: npx skills add');
    if (/docs\/.+\.md/.test(log)) issues.push('builder log: docs/*.md');
    if (/node_modules\//.test(log) && /(rm|edit|patch|write|unlink).*node_modules/.test(log)) {
      issues.push('builder log: node_modules mutation');
    }
  }

  return { ok: issues.length === 0, issues };
}
