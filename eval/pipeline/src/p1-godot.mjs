import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { EVAL_DIR, PIPELINE_DIR, WORK_DIR } from './paths.mjs';
import { execFileOk } from './exec.mjs';
import { mountAssetLibrary } from './assets.mjs';
import { gameplayKeys, validateDump, checkpointMatch } from './p1-schema.mjs';
import { finalizeStill } from './capture.mjs';
import { FRAME_MS, parseStillId } from './p1-trace.mjs';

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

function patchWindowLock(projectGodot) {
  let text = fs.readFileSync(projectGodot, 'utf8');
  if (!/\[display\]/.test(text)) text += '\n[display]\n';
  const pairs = {
    'window/size/viewport_width': '1280',
    'window/size/viewport_height': '720',
    'window/stretch/mode': '"disabled"',
    'window/stretch/aspect': '"ignore"',
    'window/vsync/vsync_mode': '0',
  };
  for (const [key, val] of Object.entries(pairs)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, `${key}=${val}`);
    else text = text.replace('[display]', `[display]\n${key}=${val}`);
  }
  fs.writeFileSync(projectGodot, text);
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
  mountAssetLibrary(dest, taskId);
  const patched = patchAutoload(path.join(dest, 'project.godot'), 'eval_injected/EvalProbe.gd', 'eval_injected/EvalRunner.gd');
  if (!patched.tamper) patchWindowLock(path.join(dest, 'project.godot'));
  return { dest, tamper: patched.tamper, leak: leakScan(dest), officialProbe };
}

function walkGd(root, acc = [], prefix = '') {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name === '.godot' || ent.name === 'asset-library' || ent.isSymbolicLink()) continue;
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
    if (/\.(png|jpg|jpeg|webp|wav|ogg|import)$/i.test(rel)) continue;
    const txt = fs.readFileSync(path.join(dest, rel), 'utf8');
    if (/playplan|checkpoint\.json/.test(txt)) hits.push(rel);
  }
  return hits;
}

export function runGodotJob({ projectDir, job, outPath, timeoutMs }) {
  const bin = godotBin();
  if (!fs.existsSync(bin)) {
    return { ok: false, code: 'BOOT_FAIL', notes: [`godot binary missing: ${bin}`], events: [] };
  }
  const jobPath = outPath + '.job.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (job.stills_dir) fs.mkdirSync(job.stills_dir, { recursive: true });
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const env = {
    ...process.env,
    SDL_AUDIODRIVER: 'dummy',
    ALSA_CARD: 'dummy',
  };
  execFileOk(bin, ['--headless', '--path', projectDir, '--import'], {
    cwd: projectDir,
    timeoutMs: 120_000,
    env,
  });
  const user = ['--', `--job=${jobPath}`, `--out=${outPath}`];
  const wantStills = Boolean(job.stills_dir);
  const runTimeout = timeoutMs ?? (wantStills ? 90_000 : 60_000);
  let proc;
  if (wantStills) {
    proc = runGodotStills(bin, projectDir, user, runTimeout, env);
  } else {
    proc = execFileOk(bin, ['--headless', '--rendering-driver', 'opengl3', '--path', projectDir, ...user], {
      cwd: projectDir,
      timeoutMs: runTimeout,
      env,
    });
  }
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
  const stillFail = events.filter((e) => e.event === 'still_fail');
  return {
    proc,
    events,
    jobPath,
    ok: proc.status === 0 && !events.some((e) => e.event === 'error'),
    notes: [
      ...(proc.status === 0 ? [] : [`godot exit ${proc.status}: ${(proc.stderr || proc.stdout || '').slice(0, 300)}`]),
      ...stillFail.map((e) => `still ${e.id}: ${e.message}`),
    ],
  };
}

function runGodotStills(bin, projectDir, user, timeoutMs, env) {
  const glArgs = ['--rendering-driver', 'opengl3', '--path', projectDir, ...user];
  const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
  if (xvfb.status === 0) {
    return execFileOk(
      'xvfb-run',
      ['-a', '-s', '-screen 0 1280x720x24', bin, '--display-driver', 'x11', ...glArgs],
      { cwd: projectDir, timeoutMs, env },
    );
  }
  return execFileOk(bin, ['--headless', ...glArgs], { cwd: projectDir, timeoutMs, env });
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

export function makeTraceJob({ traces, stillsDir, probeKeys }) {
  const valid = (traces ?? []).filter((t) => t.audit?.ok);
  return {
    traces: valid.map((t) => t.trace),
    stills_dir: stillsDir ?? '',
    sample_every: 15,
    max_frames: 600,
    frame_dt: 0.033,
    probe_keys: probeKeys ?? [],
  };
}

export function judgeTraceEvents(events, stillsDir) {
  const notes = [];
  const stills = [];
  const samples = [];
  const err = events.find((e) => e.event === 'error');
  if (err) {
    return {
      primary: err.code || 'BOOT_FAIL',
      notes: [err.message || JSON.stringify(err)],
      g0_ok: 0,
      stills,
    };
  }
  const g0 = events.find((e) => e.event === 'g0');
  if (!g0) return { primary: 'BOOT_FAIL', notes: ['no g0'], g0_ok: 0, stills };
  for (const ev of events.filter((e) => e.event === 'still')) {
    const parsed = parseStillId(ev.id);
    const meta = { scenario: parsed.scenario, frame: parsed.frame, t_ms: parsed.frame * FRAME_MS };
    const rawPath = stillsDir ? path.join(stillsDir, `${ev.id}.png`) : ev.path;
    if (rawPath && fs.existsSync(rawPath)) {
      const cap = finalizeStill(rawPath);
      stills.push({
        id: ev.id,
        dump_ok: 1,
        dump: meta,
        ...cap,
      });
    } else {
      stills.push({ id: ev.id, dump_ok: 0, dump: meta, ok: false, status: 'CAPTURE_FAIL' });
    }
  }
  for (const ev of events.filter((e) => e.event === 'probe')) {
    const parsed = parseStillId(ev.id);
    samples.push({
      scenario: parsed.scenario,
      frame: parsed.frame,
      state: ev.state && typeof ev.state === 'object' ? ev.state : {},
    });
  }
  const scenarios = [...new Set(events.filter((e) => e.event === 'trace_done').map((e) => e.scenario))];
  return { primary: 'TRACE_OK', notes, g0_ok: 1, stills, samples, scenarios, replayed_scenarios: scenarios };
}

export function judgeGodotEvents(events, bundle, playplanKind, stillsDir) {
  const notes = [];
  const sliceScores = [];
  const sliceIds = [];
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
    const isFinal = ev.id === 'final';
    const errs = v.ok && expected ? checkpointMatch(ev.dump, expected, bundle.checkpoint.compare, { isFinal }) : ['bad checkpoint'];
    const dumpOk = Boolean(expected) && v.ok && errs.length === 0;
    sliceScores.push(dumpOk ? 1 : 0);
    sliceIds.push(ev.id);
    if (!dumpOk && primary === 'CHECKPOINTS_OK') {
      primary = expected ? (v.ok ? 'CHECKPOINT_FAIL' : v.code) : 'CHECKPOINT_FAIL';
      notes.push(...(expected && v.ok ? errs : v.notes ?? [`unknown ${ev.id}`]));
    }
    const rawPath = stillsDir ? path.join(stillsDir, `${ev.id}.png`) : ev.path;
    if (rawPath && fs.existsSync(rawPath)) {
      const cap = finalizeStill(rawPath);
      stills.push({ id: ev.id, dump_ok: dumpOk ? 1 : 0, dump: ev.dump, ...cap });
    } else {
      stills.push({ id: ev.id, dump_ok: dumpOk ? 1 : 0, dump: ev.dump, ok: false, status: 'CAPTURE_FAIL' });
    }
  }
  return { primary, notes, g0_ok: 1, playplanKind, sliceScores, sliceIds, stills };
}
