import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EVAL_DIR, PIPELINE_DIR, WORK_DIR } from './paths.mjs';
import { execFileOk } from './exec.mjs';
import { gameplayKeys, validateDump, checkpointMatch } from './p1-schema.mjs';
import { finalizeStill } from './capture.mjs';

export function godotBin() {
  return (
    process.env.GODOT_BIN ||
    path.join(EVAL_DIR, 'tools', 'godot', 'Godot_v4.4.1-stable_linux.x86_64')
  );
}

function shaFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function patchAutoload(projectGodot, probeRel, runnerRel) {
  let text = fs.readFileSync(projectGodot, 'utf8');
  if (/^EvalProbe=/m.test(text) || /\[autoload\][\s\S]*EvalProbe/.test(text)) {
    return { tamper: true, text };
  }
  if (!/\[autoload\]/.test(text)) {
    text += `\n[autoload]\nEvalProbe="*res://${probeRel}"\nEvalRunner="*res://${runnerRel}"\n`;
  } else {
    text = text.replace(
      '[autoload]',
      `[autoload]\nEvalProbe="*res://${probeRel}"\nEvalRunner="*res://${runnerRel}"`,
    );
  }
  fs.writeFileSync(projectGodot, text);
  return { tamper: false, text };
}

export function stageGodotProject({ taskId, runId, srcDir }) {
  const dest = path.join(WORK_DIR, runId, 'godot');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(srcDir, dest, { recursive: true });
  const injectDir = path.join(dest, 'eval_injected');
  fs.mkdirSync(injectDir, { recursive: true });
  const probeSrc = path.join(PIPELINE_DIR, 'godot', 'EvalProbe.gd');
  const runnerSrc = path.join(PIPELINE_DIR, 'godot', 'EvalRunner.gd');
  fs.copyFileSync(probeSrc, path.join(injectDir, 'EvalProbe.gd'));
  fs.copyFileSync(runnerSrc, path.join(injectDir, 'EvalRunner.gd'));
  const officialProbe = shaFile(probeSrc);
  for (const rel of walkGd(dest)) {
    if (rel.endsWith('eval_injected/EvalProbe.gd')) continue;
    const full = path.join(dest, rel);
    const txt = fs.readFileSync(full, 'utf8');
    if (/class_name EvalProbe|func dump\(/.test(txt) && shaFile(full) !== officialProbe) {
      return { dest, tamper: true, leak: leakScan(dest) };
    }
  }
  const patched = patchAutoload(path.join(dest, 'project.godot'), 'eval_injected/EvalProbe.gd', 'eval_injected/EvalRunner.gd');
  return { dest, tamper: patched.tamper, leak: leakScan(dest), officialProbe };
}

function walkGd(root, acc = [], prefix = '') {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name === '.godot') continue;
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkGd(path.join(root, ent.name), acc, rel);
    else acc.push(rel);
  }
  return acc;
}

function leakScan(dest) {
  const hits = [];
  for (const rel of walkGd(dest)) {
    if (rel.startsWith('eval_injected/')) continue;
    const txt = fs.readFileSync(path.join(dest, rel), 'utf8');
    if (/playplan|checkpoint\.json/.test(txt)) hits.push(rel);
  }
  return hits;
}

export function runGodotJob({ projectDir, job, outPath, timeoutMs = 60_000 }) {
  const bin = godotBin();
  if (!fs.existsSync(bin)) {
    return { ok: false, code: 'BOOT_FAIL', notes: [`godot binary missing: ${bin}`] };
  }
  const jobPath = outPath + '.job.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  execFileOk(bin, ['--headless', '--path', projectDir, '--import'], { cwd: projectDir, timeoutMs: 120_000 });
  const proc = execFileOk(
    bin,
    ['--headless', '--path', projectDir, '--', `--job=${jobPath}`, `--out=${outPath}`],
    { cwd: projectDir, timeoutMs },
  );
  const events = [];
  if (fs.existsSync(outPath)) {
    for (const line of fs.readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        events.push({ event: 'error', code: 'EVAL_INTERNAL', message: line.slice(0, 200) });
      }
    }
  }
  return { proc, events, jobPath };
}

export function makeJob({ bundle, steps, stillsDir }) {
  return {
    schema_id: bundle.schema.$id,
    schema_sha256: bundle.sha,
    schema_keys: gameplayKeys(bundle.schema),
    geometry: { regions: bundle.geometry.regions ?? {} },
    post_ticks_after_input: 1,
    stills_dir: stillsDir ?? '',
    steps,
  };
}

export function judgeGodotEvents(events, bundle, playplanKind, stillsDir) {
  const notes = [];
  const sliceScores = [];
  const stills = [];
  const err = events.find((e) => e.event === 'error');
  if (err) return { primary: err.code || 'BOOT_FAIL', notes: [err.message || JSON.stringify(err)], g0_ok: 0, sliceScores, stills };
  const g0 = events.find((e) => e.event === 'g0');
  if (!g0) return { primary: 'BOOT_FAIL', notes: ['no g0 dump'], g0_ok: 0, sliceScores, stills };
  const g0v = validateDump(g0.dump, bundle.schema, bundle.sha);
  if (!g0v.ok) return { primary: g0v.code, notes: g0v.notes, g0_ok: 0, sliceScores, stills };
  let primary = 'CHECKPOINTS_OK';
  for (const ev of events.filter((e) => e.event === 'checkpoint')) {
    const expected = bundle.checkpoint.slices[ev.id];
    const v = validateDump(ev.dump, bundle.schema, bundle.sha);
    const errs = v.ok && expected ? checkpointMatch(ev.dump, expected) : ['bad checkpoint'];
    const dumpOk = Boolean(expected) && v.ok && errs.length === 0;
    sliceScores.push(dumpOk ? 1 : 0);
    if (!dumpOk && primary === 'CHECKPOINTS_OK') {
      primary = expected ? (v.ok ? 'CHECKPOINT_FAIL' : v.code) : 'CHECKPOINT_FAIL';
      notes.push(...(expected && v.ok ? errs : v.notes ?? [`unknown ${ev.id}`]));
    }
    const rawPath = stillsDir ? path.join(stillsDir, `${ev.id}.png`) : ev.path;
    if (rawPath && fs.existsSync(rawPath)) {
      const cap = finalizeStill(rawPath);
      stills.push({ id: ev.id, dump_ok: dumpOk ? 1 : 0, ...cap });
    } else {
      stills.push({ id: ev.id, dump_ok: dumpOk ? 1 : 0, ok: false, status: 'CAPTURE_FAIL' });
    }
  }
  return { primary, notes, g0_ok: 1, playplanKind, sliceScores, stills };
}
