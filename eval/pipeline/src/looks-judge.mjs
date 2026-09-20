import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  aggregateLooks,
  buildLooksUserPrompt,
  gameplayView,
  parseLooksVerdict,
  promptHasBannedWords,
  stripInstruction,
  normalizeLooksScores,
} from './looks-rubric.mjs';
import { heuristicDepth, heuristicFrame, round01, average01 } from './looks.mjs';

let registeredInvoker = null;

export function setLooksInvoker(fn) {
  registeredInvoker = fn;
}

export function looksBackend() {
  if (process.env.EVAL_LOOKS_BACKEND) return process.env.EVAL_LOOKS_BACKEND;
  if (process.env.NODE_TEST_CONTEXT) return 'heuristic';
  return 'subagent';
}

export function buildLooksJob({
  taskId,
  engine,
  instruction,
  geometry,
  stills,
  variant_regions,
  jobDir,
}) {
  const frames = (stills ?? []).map((s) => ({
    id: s.id,
    path: s.path,
    dump: gameplayView(s.dump),
    dump_ok: s.dump_ok ?? 0,
  }));
  const job = {
    schema: 'eval.looks-job/1',
    taskId,
    instruction: stripInstruction(instruction),
    labels: geometry?.labels ?? {},
    regions: geometry?.regions ?? {},
    variant_regions: variant_regions ?? [],
    stills: frames,
  };
  const banned = promptHasBannedWords(buildLooksUserPrompt(job));
  if (banned.length) {
    job.instruction = job.instruction.replace(new RegExp(banned.join('|'), 'g'), '□');
  }
  if (jobDir) {
    fs.mkdirSync(jobDir, { recursive: true });
    const requestPath = path.join(jobDir, 'looks-request.json');
    const promptPath = path.join(jobDir, 'looks-prompt.txt');
    fs.writeFileSync(requestPath, `${JSON.stringify(job, null, 2)}\n`);
    fs.writeFileSync(promptPath, `${buildLooksUserPrompt(job)}\n`);
    job.requestPath = requestPath;
    job.promptPath = promptPath;
    job.verdictPath = path.join(jobDir, 'looks-verdict.json');
  }
  job.engine_record = engine;
  return job;
}

function heuristicJob(job, stills) {
  const vs = [];
  const as = [];
  const ds = [];
  const hasDepth = Boolean(job.variant_regions?.length);
  for (const s of stills) {
    const png = s.png ?? (s.path && fs.existsSync(s.path) ? fs.readFileSync(s.path) : null);
    if (!png) continue;
    const h = heuristicFrame({ png, geometry: { regions: job.regions } });
    vs.push(h.V);
    as.push(h.A);
    if (hasDepth) ds.push(heuristicDepth({ png, geometry: { regions: job.regions }, keys: job.variant_regions }).D);
  }
  if (!vs.length) return { V: 0, A: 0, D_visual: hasDepth ? 0 : undefined, looks_status: 'CAPTURE_FAIL', source: 'heuristic' };
  const out = {
    V: round01(average01(vs)),
    A: round01(average01(as)),
    looks_status: 'OK',
    source: 'heuristic',
  };
  if (hasDepth) out.D_visual = round01(average01(ds));
  return out;
}

function invokeCmd(job) {
  const cmd = process.env.EVAL_LOOKS_CMD;
  if (!cmd) return null;
  const prompt = buildLooksUserPrompt(job);
  const proc = spawnSync(cmd, [job.requestPath || ''], {
    encoding: 'utf8',
    input: prompt,
    timeout: 180_000,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    env: process.env,
  });
  if (proc.status !== 0) {
    throw new Error(`EVAL_LOOKS_CMD exit ${proc.status}: ${(proc.stderr || proc.stdout || '').slice(0, 400)}`);
  }
  return proc.stdout;
}

function readVerdictFile(job) {
  if (job.verdictPath && fs.existsSync(job.verdictPath)) {
    return fs.readFileSync(job.verdictPath, 'utf8');
  }
  return null;
}

export async function judgeLooksJob(job, stills) {
  const hasDepth = Boolean(job.variant_regions?.length);
  const backend = looksBackend();
  if (backend === 'heuristic') {
    return heuristicJob(job, stills);
  }
  try {
    let text = null;
    if (registeredInvoker) {
      text = await registeredInvoker(job);
    }
    if (text == null) text = readVerdictFile(job);
    if (text == null) text = invokeCmd(job);
    if (text == null) {
      return {
        V: 0,
        A: 0,
        D_visual: hasDepth ? 0 : undefined,
        looks_status: 'SUBAGENT_UNAVAILABLE',
        source: 'subagent',
      };
    }
    const parsed =
      typeof text === 'object'
        ? { scores: normalizeLooksScores(text.scores ?? text) }
        : parseLooksVerdict(text);
    const agg = aggregateLooks(parsed.scores, { hasDepth });
    if (job.verdictPath) {
      fs.writeFileSync(job.verdictPath, `${JSON.stringify({ scores: parsed.scores }, null, 2)}\n`);
    }
    return { ...agg, looks_status: 'OK', source: 'subagent' };
  } catch (err) {
    return {
      V: 0,
      A: 0,
      D_visual: hasDepth ? 0 : undefined,
      looks_status: 'SUBAGENT_FAIL',
      source: 'subagent',
      notes: [String(err.message || err).slice(0, 300)],
    };
  }
}

export async function scoreVisuals({
  stills,
  geometry,
  depthKeys,
  instruction,
  taskId,
  engine,
  jobDir,
}) {
  const okStills = (stills ?? []).filter((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
  if (!okStills.length) {
    return {
      V: 0,
      A: 0,
      D: depthKeys ? 0 : undefined,
      looks_status: 'CAPTURE_FAIL',
      source: 'none',
    };
  }
  const job = buildLooksJob({
    taskId,
    engine,
    instruction,
    geometry,
    stills: okStills,
    variant_regions: depthKeys,
    jobDir,
  });
  const vis = await judgeLooksJob(job, okStills);
  if (depthKeys) vis.D_visual = vis.D_visual ?? 0;
  return vis;
}
