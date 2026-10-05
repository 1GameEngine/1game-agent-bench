import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_DIR } from './paths.mjs';
import { bootstrap } from './bootstrap.mjs';
import { loadP1Task } from './p1-load.mjs';
import { auditModelSubmission, buildBuilderPrompt } from './model-builder.mjs';
import { checkOnegameBoot } from './p1-onegame.mjs';
import { checkGodotBoot } from './p1-godot.mjs';
import { stillsComplete, scenarioStillsMap } from './looks-pair.mjs';
import { requirementsForScenario } from './rubric.mjs';
import { capLooksStills } from './p1-trace.mjs';
import { mountAssetLibrary } from './assets.mjs';
import { looksEvidenceComplete, normalizeLooksScores, promptHasBannedWords, reqAgg, stripInstruction } from './looks-rubric.mjs';
import { EvalError } from './util.mjs';
import { cloudAgentSubagentEnabled, runCloudAgentSubagent } from './cloud-agent-subagent.mjs';

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
  mountAssetLibrary(workspace, taskId);
  return {
    workspace,
    replayRunId: `${runId}-gd`,
    outPath: path.join(WORK_DIR, `${runId}-gd`, 'REPLAY.json'),
  };
}

export async function defaultRunSubagent(spec) {
  const cmd = process.env.EVAL_SUBAGENT_CMD;
  if (!cmd) {
    if (cloudAgentSubagentEnabled()) return runCloudAgentSubagent(spec);
    throw new EvalError(
      'SUBAGENT_REQUIRED',
      '出码和观感由当前 Cloud Agent 的 subagent 执行。Cloud Agent（CURSOR_AGENT=1）不需要 EVAL_SUBAGENT_CMD。当前进程不是 Cloud Agent，主进程不写游戏、不重放、不看图。',
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
    .map((item) => `- ${item.id}（${item.dim}，场景 ${(item.applies ?? []).join('/')}）：${item.description}`)
    .join('\n');
  let text = `你只看这一边提交的静帧。M、D、V、A 都按画面打，不要读内部状态字段，不要看另一边，不要改计分公式。
每条分数必须引用该场景列表里的静帧 id。score 只能是 0、0.5 或 1。
V 条目按该场景全部静帧平均：frames 必须给列表里的每一个静帧 id 打 0、0.5 或 1，空画面按 0。score 等于这些帧的平均再收成 0、0.5 或 1。漏帧或 score 对不上平均，整条作废。
M、D、A 不填 frames。只输出一个 JSON 对象，形状：
{"scenarios":{"intro":{"V1":{"score":0.5,"frames":{"某静帧id":0,"另一静帧id":1},"evidence":["某静帧id"]},"M1":{"score":0,"evidence":["某静帧id"]}}}}

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

export function looksFramePlan(stills, rubric, sampleFps = 2) {
  const by = scenarioStillsMap(stills);
  const frames = {};
  const policies = [];
  let overflow = false;
  for (const sc of Object.keys(by).sort()) {
    if (!by[sc].length) continue;
    if (!requirementsForScenario(rubric, sc).length) continue;
    const capped = capLooksStills(by[sc], undefined, sampleFps);
    policies.push(capped.sample_policy);
    if (!capped.ok) overflow = true;
    frames[sc] = capped.stills.map((s) => ({ id: s.id, path: s.path }));
  }
  const uniq = [...new Set(policies)];
  return {
    frames,
    jobs: Object.keys(frames).length,
    sample_policy: uniq.length === 1 ? uniq[0] : uniq.join(','),
    overflow,
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
  if (!frames || Object.keys(frames).length === 0) {
    return { looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent', byScenario: {} };
  }
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
  const byScenario = {};
  for (const [sc, stills] of Object.entries(frames)) {
    const reqs = requirementsForScenario(rubric, sc);
    if (!reqs.length) continue;
    const ids = new Set(stills.map((s) => s.id));
    if (!looksEvidenceComplete(scenarios?.[sc], { requirements: reqs }, ids)) {
      return { looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent', byScenario: {} };
    }
    byScenario[sc] = normalizeLooksScores(scenarios[sc], { requirements: reqs }, ids);
  }
  return { looks_status: 'OK', looks_source: 'subagent', byScenario };
}

function rubricItems(rubric) {
  return (rubric?.requirements ?? []).map((req) => ({
    id: req.id,
    dim: req.dim,
    description: req.description,
    applies: req.applies,
    scope: req.scope === 'persistent' ? 'persistent' : 'scenario',
    agg: reqAgg(req),
  }));
}

export function checkBuilderBoot({ engine, workspace }) {
  if (engine === 'onegame') return checkOnegameBoot(workspace);
  if (engine === 'godot') return checkGodotBoot(workspace);
  return { ok: false, primary: 'BOOT_FAIL', notes: [`unknown engine ${engine}`] };
}

export function builderBootAttempts() {
  const n = Number(process.env.EVAL_BUILDER_BOOT_ATTEMPTS || 3);
  return Number.isInteger(n) && n >= 1 ? n : 3;
}

function builderSpec({ engine, taskId, workspace, instruction, task, repair }) {
  let prompt = buildBuilderPrompt({ engine, instruction, task });
  if (repair) {
    const detail = (repair.notes ?? []).join('\n').slice(-1500);
    prompt += `

## 构建 / 启动校验失败
上一份提交没有通过出码校验（${repair.primary}）。按下面的错误修改当前工作区，不要读评测仓，不要重写无关文件。
改完后按「提交前自己调试」把轨迹和题面再走一遍。错误文本可能只保留日志末尾，点到的每个文件都要改完。
${detail}
`;
  }
  return {
    role: 'builder',
    engine,
    taskId,
    workspace,
    prompt,
    attempt: repair?.attempt ?? 1,
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
  const items = rubricItems(rubric);
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

function planPair(built, rubric, sampleFps) {
  const og = built.onegame.replay;
  const gd = built.godot.replay;
  const plans = {
    onegame: looksFramePlan(og.stills, rubric, sampleFps),
    godot: looksFramePlan(gd.stills, rubric, sampleFps),
  };
  if (!og.G && !gd.G) return { pair: 'BOTH_G0', run: [], plans };
  if (og.G && gd.G) {
    if (plans.onegame.overflow || plans.godot.overflow || !stillsComplete(og.stills) || !stillsComplete(gd.stills)) {
      return { pair: 'INCOMPARABLE_VISUAL', run: [], plans };
    }
    const ogKeys = Object.keys(scenarioStillsMap(og.stills)).sort().join(',');
    const gdKeys = Object.keys(scenarioStillsMap(gd.stills)).sort().join(',');
    if (ogKeys !== gdKeys) return { pair: 'INCOMPARABLE_VISUAL', run: [], plans };
    return { pair: 'BOTH_G', run: ['onegame', 'godot'], plans };
  }
  const live = og.G ? 'onegame' : 'godot';
  const liveReplay = og.G ? og : gd;
  if (plans[live].overflow || !stillsComplete(liveReplay.stills)) {
    return { pair: 'INCOMPARABLE_VISUAL', run: [], plans };
  }
  return { pair: 'G_ASYMMETRIC', run: [live], plans };
}

export function defaultPrepareOracle() {
  throw new EvalError('NO_REFERENCE', '本仓不提供参考作。oracle gate 不再重放内置成品，headline 必须由 builder 按题面重写。');
}

async function buildUntilBoot({ engine, taskId, prep, instruction, task, runSubagent, bootCheck, attempts }) {
  let repair = null;
  let boot = { ok: false, primary: 'BOOT_FAIL', notes: ['boot check did not run'] };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await runRole(
      runSubagent,
      builderSpec({
        engine,
        taskId,
        workspace: prep.workspace,
        instruction,
        task,
        repair,
      }),
    );
    try {
      auditModelSubmission(prep.workspace, engine, taskId);
    } catch (err) {
      repair = { attempt: attempt + 1, primary: err.primary || 'BUILDER_INVALID', notes: [String(err.message || err)] };
      if (attempt === attempts) throw err;
      continue;
    }
    boot = await bootCheck({ engine, workspace: prep.workspace, taskId });
    if (boot?.ok) return { boot, attempts: attempt };
    repair = {
      attempt: attempt + 1,
      primary: boot?.primary || 'BOOT_FAIL',
      notes: boot?.notes?.length ? boot.notes : ['boot check failed'],
    };
  }
  return { boot, attempts };
}

export async function orchestrateEngines({
  taskId,
  runId,
  prepare = defaultPrepare,
  runSubagent = defaultRunSubagent,
  loadTask = loadP1Task,
  skipBuilder = false,
  bootCheck = checkBuilderBoot,
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
      if (!skipBuilder) {
        const builtOnce = await buildUntilBoot({
          engine,
          taskId,
          prep,
          instruction: bundle.instruction,
          task: bundle.task,
          runSubagent,
          bootCheck,
          attempts: builderBootAttempts(),
        });
        const stampPath = path.join(path.dirname(prep.outPath), `builder-${engine}.json`);
        fs.mkdirSync(path.dirname(stampPath), { recursive: true });
        fs.writeFileSync(
          stampPath,
          `${JSON.stringify({ source: 'subagent', taskId, engine, boot_attempts: builtOnce.attempts, boot_primary: builtOnce.boot?.primary ?? null }, null, 2)}\n`,
        );
      }
      await runRole(runSubagent, replaySpec({ engine, taskId, prep, token }));
      built[engine] = { ...prep, token, replay: readReplay(prep.outPath, { token, engine, taskId }) };
    }),
  );
  const planned = planPair(built, bundle.rubric, bundle.task.sample_fps);
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

export async function orchestrateOracle(opts = {}) {
  return orchestrateEngines({
    ...opts,
    skipBuilder: true,
    prepare: opts.prepare ?? defaultPrepareOracle,
  });
}
