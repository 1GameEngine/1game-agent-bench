import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  aggregateLooks,
  buildLooksUserPrompt,
  parseLooksVerdict,
  promptHasBannedWords,
  stripInstruction,
  normalizeLooksScores,
  looksEvidenceComplete,
} from './looks-rubric.mjs';
import { heuristicDepth, heuristicFrame, round01, average01 } from './looks.mjs';
import { scoreLooksWorker } from './looks-worker.mjs';
import { aggregateRubric, emptyRubricScores, requirementsForScenario } from './rubric.mjs';
import { capLooksStills, stillPlayMeta } from './p1-trace.mjs';

let registeredInvoker = null;

export function setLooksInvoker(fn) {
  registeredInvoker = fn;
}

export function looksBackend() {
  if (process.env.EVAL_LOOKS_BACKEND) return process.env.EVAL_LOOKS_BACKEND;
  if (process.env.NODE_TEST_CONTEXT) return 'heuristic';
  return 'subagent';
}

export function looksJudgeConfigured() {
  if (registeredInvoker) return true;
  if (process.env.EVAL_LOOKS_CMD) return true;
  if (process.env.EVAL_LOOKS_ALLOW_WORKER === '1') return true;
  return false;
}

export function buildLooksJob({
  taskId,
  engine,
  instruction,
  geometry,
  stills,
  variant_regions,
  jobDir,
  rubric,
  scenario,
  sample_policy,
}) {
  const frames = (stills ?? []).map((s) => {
    const meta = stillPlayMeta(s);
    return {
      id: s.id,
      path: s.path,
      dump: { scenario: meta.scenario, frame: meta.frame, t_ms: meta.t_ms },
      dump_ok: 0,
    };
  });
  const scoped = scenario ? { ...rubric, requirements: requirementsForScenario(rubric, scenario) } : rubric;
  const job = {
    schema: 'eval.looks-job/1',
    taskId,
    scenario: scenario || undefined,
    sample_policy: sample_policy || 'fps2',
    instruction: stripInstruction(instruction),
    labels: geometry?.labels ?? {},
    regions: geometry?.regions ?? {},
    variant_regions: variant_regions ?? [],
    stills: frames,
    rubric: scoped ?? undefined,
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

function heuristicFromRubric(job, stills) {
  const vs = [];
  for (const s of stills) {
    const png = s.png ?? (s.path && fs.existsSync(s.path) ? fs.readFileSync(s.path) : null);
    if (!png) continue;
    const h = heuristicFrame({ png, geometry: { regions: job.regions } });
    vs.push((h.V + h.A) / 2);
  }
  if (!vs.length) {
    return { ...emptyRubricScores(job.rubric), looks_status: 'CAPTURE_FAIL', source: 'heuristic' };
  }
  const mean = round01(average01(vs));
  const mark = mean >= 0.75 ? 1 : mean >= 0.25 ? 0.5 : 0;
  const scores = {};
  for (const req of job.rubric?.requirements ?? []) scores[req.id] = mark;
  const agg = aggregateRubric(scores, job.rubric);
  return { ...agg, looks_status: 'OK', source: 'heuristic' };
}

function heuristicJob(job, stills) {
  if (job.rubric?.requirements?.length) return heuristicFromRubric(job, stills);
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
    if (text == null && process.env.EVAL_LOOKS_ALLOW_WORKER === '1') {
      return scoreLooksWorker(job, stills);
    }
    if (text == null) {
      return {
        V: 0,
        A: 0,
        M: 0,
        D: 0,
        D_visual: hasDepth ? 0 : undefined,
        looks_status: 'SUBAGENT_UNAVAILABLE',
        source: 'subagent',
      };
    }
    const stillIds = new Set((job.stills ?? []).map((s) => s.id).filter(Boolean));
    const rawScores =
      typeof text === 'object'
        ? text.scores && typeof text.scores === 'object' && !Array.isArray(text.scores)
          ? text.scores
          : text
        : null;
    const parsed =
      typeof text === 'object'
        ? { scores: normalizeLooksScores(rawScores, job.rubric, stillIds) }
        : parseLooksVerdict(text, job.rubric, stillIds);
    const evidenceScores =
      rawScores ??
      (parsed.raw?.scores && typeof parsed.raw.scores === 'object' ? parsed.raw.scores : parsed.raw);
    if (!looksEvidenceComplete(evidenceScores, job.rubric, stillIds)) {
      return {
        V: null,
        A: null,
        items: parsed.scores,
        looks_status: 'EVIDENCE_INCOMPLETE',
        source: 'subagent',
      };
    }
    const agg = job.rubric?.requirements?.length
      ? aggregateRubric(parsed.scores, job.rubric)
      : aggregateLooks(parsed.scores, { hasDepth });
    if (job.verdictPath) {
      fs.writeFileSync(job.verdictPath, `${JSON.stringify({ scores: parsed.scores }, null, 2)}\n`);
    }
    return { ...agg, looks_status: 'OK', source: 'subagent' };
  } catch (err) {
    return {
      V: 0,
      A: 0,
      M: 0,
      D: 0,
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
  rubric,
  scenario,
  sample_policy,
}) {
  const okStills = (stills ?? []).filter((s) => s.ok && (s.png || (s.path && fs.existsSync(s.path))));
  if (!okStills.length) {
    return {
      V: 0,
      A: 0,
      M: 0,
      D: 0,
      looks_status: 'CAPTURE_FAIL',
      source: 'none',
    };
  }
  const capped = capLooksStills(okStills);
  const job = buildLooksJob({
    taskId,
    engine,
    instruction,
    geometry,
    stills: capped.stills,
    variant_regions: depthKeys,
    jobDir,
    rubric,
    scenario,
    sample_policy: sample_policy || capped.sample_policy,
  });
  const vis = await judgeLooksJob(job, capped.stills);
  vis.sample_policy = job.sample_policy;
  vis.scenario = scenario;
  return vis;
}
