import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_DIR } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { loadP1Task } from './p1-load.mjs';
import { auditModelSubmission, buildBuilderPrompt } from './model-builder.mjs';
import { stillsComplete, scenarioStillsMap } from './looks-pair.mjs';
import { visualRubric } from './probe.mjs';
import { requirementsForScenario } from './rubric.mjs';
import { capLooksStills } from './p1-trace.mjs';
import { looksEvidenceComplete, normalizeLooksScores, promptHasBannedWords, stripInstruction } from './looks-rubric.mjs';
import { EvalError } from './util.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

export function defaultPrepare({ engine, taskId, runId, instruction }) {
  if (engine === 'onegame') {
    const boot = bootstrap({
      taskId,
      runId: `${runId}-og`,
      instruction,
      oracle: false,
    });
    return {
      workspace: boot.gameDir,
      replayRunId: `${runId}-og`,
      outPath: path.join(WORK_DIR, `${runId}-og`, 'REPLAY.json'),
    };
  }
  const workspace = path.join(WORK_DIR, `${runId}-gd-generated`, 'godot');
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'instruction.md'), instruction);
  return {
    workspace,
    replayRunId: `${runId}-gd`,
    outPath: path.join(WORK_DIR, `${runId}-gd`, 'REPLAY.json'),
  };
}

export function defaultRunSubagent(spec) {
  const cmd = process.env.EVAL_SUBAGENT_CMD;
  if (!cmd) {
    throw new EvalError(
      'SUBAGENT_REQUIRED',
      '出码、重放、观感都必须由 subagent 执行。设置 EVAL_SUBAGENT_CMD（stdin 为阶段 JSON）。未配置时不算分，主进程不写游戏、不重放、不看图。',
    );
  }
  let args = [];
  if (process.env.EVAL_SUBAGENT_ARGS) {
    const parsed = JSON.parse(process.env.EVAL_SUBAGENT_ARGS);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new EvalError('EVAL_INTERNAL', 'EVAL_SUBAGENT_ARGS must be a JSON string array');
    }
    args = parsed;
  }
  const timeoutMs = Number(process.env.EVAL_SUBAGENT_TIMEOUT_MS || 600_000);
  const result = spawnSync(cmd, args, {
    cwd: spec.workspace,
    env: process.env,
    encoding: 'utf8',
    input: JSON.stringify(spec),
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw new EvalError('SUBAGENT_INVALID', result.error.message);
  if (result.status !== 0) {
    throw new EvalError(
      'SUBAGENT_INVALID',
      `subagent ${spec.role} ${spec.engine} exited ${result.status}\n${result.stderr || result.stdout}`.slice(0, 2000),
    );
  }
  return result.stdout ?? '';
}

export function replayArgv({ engine, taskId, workspace, outPath, token, replayRunId }) {
  return [
    process.execPath,
    CLI,
    'stage-replay',
    '--engine',
    engine,
    '--task',
    taskId,
    '--workspace',
    workspace,
    '--out',
    outPath,
    '--token',
    token,
    '--run-id',
    replayRunId,
  ];
}

export function buildLooksStagePrompt({ instruction, frames, items }) {
  const stills = Object.entries(frames)
    .map(([sc, list]) => `${sc}: ${list.map((s) => s.id).join(', ')}`)
    .join('\n');
  const lines = items
    .map((item) => `- ${item.id}（${item.dim}，场景 ${item.applies.join('/')}）：${item.description}`)
    .join('\n');
  let text = `你只看这一边提交的静帧。不要看另一边，不要改计分公式，不要根据探针猜分。
每条分数必须引用该场景列表里的静帧 id。score 只能是 0、0.5 或 1。
只输出一个 JSON 对象，形状：
{"scenarios":{"intro":{"V1":{"score":0,"evidence":["某静帧id"]}}}}

题面：
${stripInstruction(instruction)}

静帧 id：
${stills}

观感条目：
${lines}
`;
  const banned = promptHasBannedWords(text);
  if (banned.length) text = text.replace(new RegExp(banned.join('|'), 'g'), '□');
  return text;
}

export function looksFramePlan(stills, rubric) {
  const vis = visualRubric(rubric);
  const by = scenarioStillsMap(stills);
  const frames = {};
  const policies = [];
  for (const sc of Object.keys(by).sort()) {
    if (!by[sc].length) continue;
    if (!requirementsForScenario(vis, sc).length) continue;
    const capped = capLooksStills(by[sc]);
    policies.push(capped.sample_policy);
    frames[sc] = capped.stills.map((s) => ({ id: s.id, path: s.path }));
  }
  const uniq = [...new Set(policies)];
  return {
    frames,
    jobs: Object.keys(frames).length,
    sample_policy: uniq.length === 1 ? uniq[0] : uniq.join(','),
  };
}

export function assertReplayDocument(doc, { token, engine, taskId }) {
  if (!doc || doc.via !== 'stage-replay' || doc.token !== token || doc.engine !== engine || doc.taskId !== taskId) {
    throw new EvalError(
      'REPLAY_UNTRUSTED',
      '重放结果必须由 stage-replay 写出，且令牌与本次任务一致。主进程不重放，也不接受手改的探针数字。',
    );
  }
  return doc;
}

function readReplay(outPath, expect) {
  if (!fs.existsSync(outPath)) {
    throw new EvalError('REPLAY_UNTRUSTED', `stage-replay did not write ${outPath}`);
  }
  return assertReplayDocument(JSON.parse(fs.readFileSync(outPath, 'utf8')), expect);
}

export function acceptLooksText(text, { frames, rubric }) {
  const raw = String(text ?? '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) {
    return { looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent', byScenario: {} };
  }
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent', byScenario: {} };
  }
  const scenarios = data?.scenarios && typeof data.scenarios === 'object' ? data.scenarios : data;
  const vis = visualRubric(rubric);
  const byScenario = {};
  for (const [sc, stills] of Object.entries(frames)) {
    const reqs = requirementsForScenario(vis, sc);
    if (!reqs.length) continue;
    const ids = new Set(stills.map((s) => s.id));
    if (!looksEvidenceComplete(scenarios?.[sc], { requirements: reqs }, ids)) {
      return { looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent', byScenario: {} };
    }
    byScenario[sc] = normalizeLooksScores(scenarios[sc], { requirements: reqs }, ids);
  }
  return { looks_status: 'OK', looks_source: 'subagent', byScenario };
}

function visualItems(rubric) {
  return visualRubric(rubric).requirements.map((req) => ({
    id: req.id,
    dim: req.dim,
    description: req.description,
    applies: req.applies,
    need: req.need,
    anchor: req.anchor === true,
  }));
}

function builderSpec({ engine, taskId, workspace, instruction }) {
  return {
    role: 'builder',
    engine,
    taskId,
    workspace,
    prompt: buildBuilderPrompt({ engine, instruction }),
  };
}

function replaySpec({ engine, taskId, prep, token }) {
  const argv = replayArgv({
    engine,
    taskId,
    workspace: prep.workspace,
    outPath: prep.outPath,
    token,
    replayRunId: prep.replayRunId,
  });
  return {
    role: 'replay',
    engine,
    taskId,
    workspace: prep.workspace,
    prompt:
      '你是重放执行器。不要改探针数字，不要手写 REPLAY.json，不要打开静帧打分。只运行 spec.replay.argv，并把它的退出码当作你的退出码。',
    replay: { argv, out: prep.outPath, token },
  };
}

function looksSpec({ engine, taskId, workspace, instruction, rubric, plan }) {
  const items = visualItems(rubric);
  return {
    role: 'looks',
    engine,
    taskId,
    workspace,
    prompt: buildLooksStagePrompt({ instruction, frames: plan.frames, items }),
    stills: plan.frames,
    rubric_items: items,
  };
}

async function runRole(runSubagent, spec) {
  const out = await runSubagent(spec);
  if (out != null && typeof out !== 'string') {
    throw new EvalError('SUBAGENT_INVALID', 'subagent 只能返回标准输出文本。主进程不接收代写的源码对象。');
  }
  return out ?? '';
}

function planPair(built, rubric) {
  const og = built.onegame.replay;
  const gd = built.godot.replay;
  const plans = {
    onegame: looksFramePlan(og.stills, rubric),
    godot: looksFramePlan(gd.stills, rubric),
  };
  if (!og.G && !gd.G) return { pair: 'BOTH_G0', run: [], plans };
  if (og.G && gd.G) {
    if (!stillsComplete(og.stills) || !stillsComplete(gd.stills)) {
      return { pair: 'INCOMPARABLE_VISUAL', run: [], plans };
    }
    const ogKeys = Object.keys(scenarioStillsMap(og.stills)).sort().join(',');
    const gdKeys = Object.keys(scenarioStillsMap(gd.stills)).sort().join(',');
    if (ogKeys !== gdKeys) return { pair: 'INCOMPARABLE_VISUAL', run: [], plans };
    return { pair: 'BOTH_G', run: ['onegame', 'godot'], plans };
  }
  return { pair: 'G_ASYMMETRIC', run: [og.G ? 'onegame' : 'godot'], plans };
}

export async function orchestrateEngines({
  taskId,
  runId,
  prepare = defaultPrepare,
  runSubagent = defaultRunSubagent,
  loadTask = loadP1Task,
} = {}) {
  const bundle = loadTask(taskId);
  const prepped = {};
  for (const engine of ['onegame', 'godot']) {
    prepped[engine] = prepare({ engine, taskId, runId, instruction: bundle.instruction });
  }
  const built = {};
  await Promise.all(
    ['onegame', 'godot'].map(async (engine) => {
      const prep = prepped[engine];
      const token = randomBytes(16).toString('hex');
      await runRole(runSubagent, builderSpec({ engine, taskId, workspace: prep.workspace, instruction: bundle.instruction }));
      auditModelSubmission(prep.workspace, engine);
      const stampPath = path.join(path.dirname(prep.outPath), `builder-${engine}.json`);
      fs.mkdirSync(path.dirname(stampPath), { recursive: true });
      fs.writeFileSync(stampPath, `${JSON.stringify({ source: 'subagent', taskId, engine }, null, 2)}\n`);
      await runRole(runSubagent, replaySpec({ engine, taskId, prep, token }));
      built[engine] = { ...prep, token, replay: readReplay(prep.outPath, { token, engine, taskId }) };
    }),
  );
  const planned = planPair(built, bundle.rubric);
  await Promise.all(
    planned.run.map(async (engine) => {
      const text = await runRole(
        runSubagent,
        looksSpec({
          engine,
          taskId,
          workspace: built[engine].workspace,
          instruction: bundle.instruction,
          rubric: bundle.rubric,
          plan: planned.plans[engine],
        }),
      );
      if (!String(text).trim()) {
        throw new EvalError('SUBAGENT_INVALID', `looks subagent ${engine} 没有给出逐条证据。`);
      }
      const accepted = acceptLooksText(text, { frames: planned.plans[engine].frames, rubric: bundle.rubric });
      built[engine].looks = {
        ...accepted,
        sample_policy: planned.plans[engine].sample_policy,
        jobs: planned.plans[engine].jobs,
      };
    }),
  );
  return {
    taskId,
    bundle,
    pair: planned.pair,
    onegame: built.onegame,
    godot: built.godot,
  };
}
