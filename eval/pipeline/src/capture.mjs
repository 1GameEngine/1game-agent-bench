import fs from 'node:fs';
import path from 'node:path';
import { RECORD_REL } from './paths.mjs';
import { parseCliJson } from './util.mjs';
import { auditReplayArgv, pnpmExecArgv } from './argv-audit.mjs';
import { execFileOk } from './exec.mjs';
import { toJudgeStill, sha256, STILL_W, STILL_H } from './png-nn.mjs';

export function captureArgv(outPng) {
  return [
    '1gameplay',
    'frame',
    'screenshot',
    RECORD_REL,
    '--at',
    'last',
    '--out',
    outPng,
    '--width',
    '1280',
    '--height',
    '720',
    '--format',
    'png',
    '--dpr',
    '1',
  ];
}

export function captureOnegameStill({ gameDir, outPng, rules, allowedClicks }) {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const argv = captureArgv(outPng);
  const audit = auditReplayArgv(argv, { rules, allowedClicks, recordRel: RECORD_REL, role: 'capture' });
  if (!audit.ok) {
    return { ok: false, status: 'ARGV_VIOLATION', issues: audit.issues };
  }
  const proc = execFileOk('pnpm', pnpmExecArgv(argv), { cwd: gameDir, timeoutMs: 180_000 });
  if (proc.status !== 0 || !fs.existsSync(outPng)) {
    return { ok: false, status: 'CAPTURE_FAIL', issues: [(proc.stderr || proc.stdout).slice(0, 300)] };
  }
  try {
    parseCliJson(proc.stdout);
  } catch {
    /* screenshot still valid if file exists */
  }
  return finalizeStill(outPng);
}

export function finalizeStill(srcPath) {
  try {
    const raw = fs.readFileSync(srcPath);
    const still = toJudgeStill(raw);
    fs.writeFileSync(srcPath, still.png);
    const st = fs.statSync(srcPath);
    if (st.size < 32) return { ok: false, status: 'CAPTURE_FAIL', issues: ['empty png'] };
    return {
      ok: true,
      status: 'OK',
      path: srcPath,
      png: still.png,
      width: STILL_W,
      height: STILL_H,
      scale: 'window_1280x720',
      sha256: sha256(still.png),
    };
  } catch (err) {
    return { ok: false, status: 'CAPTURE_FAIL', issues: [String(err.message)] };
  }
}

export function stillMeta(cap) {
  if (!cap?.ok) {
    return {
      dump_ok: cap?.dump_ok ?? 0,
      png_ok: 0,
      looks_status: cap?.status ?? 'CAPTURE_FAIL',
    };
  }
  return {
    dump_ok: cap.dump_ok ?? 1,
    png_ok: 1,
    path: cap.path,
    width: cap.width,
    height: cap.height,
    scale: cap.scale,
    sha256: cap.sha256,
  };
}
