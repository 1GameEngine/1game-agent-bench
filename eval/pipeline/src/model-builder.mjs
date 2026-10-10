import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EVAL_DIR } from './paths.mjs';
import { duplicateScenarioNames, missingRequiredScenarios, readTraces, tracePolicy } from './p1-trace.mjs';
import { loadP1Task } from './p1-load.mjs';
import { EvalError } from './util.mjs';

const ENGINE_FILES = {
  onegame: ['src/game.tsx'],
  godot: ['project.godot', 'game.tscn', 'game.gd'],
};

export function traceFilePlan(task) {
  return (task?.scenarios?.required ?? []).map((scenario, index) => ({
    rel: `demo_outputs/${String(index + 1).padStart(2, '0')}_${scenario}.json`,
    scenario,
  }));
}

export function requiredSubmissionFiles(engine, task) {
  const head = ENGINE_FILES[engine];
  if (!head) throw new EvalError('EVAL_INTERNAL', `no builder file list for ${engine}`);
  return [...head, ...traceFilePlan(task).map((item) => item.rel)];
}

export function buildBuilderPrompt({ engine, instruction, task }) {
  const promptPath = path.join(EVAL_DIR, `builder.prompt.p1.${engine}.md`);
  if (!fs.existsSync(promptPath)) {
    throw new EvalError('EVAL_INTERNAL', `missing builder prompt ${promptPath}`);
  }
  const appendix = fs.readFileSync(promptPath, 'utf8').trim();
  const files = requiredSubmissionFiles(engine, task).map((rel) => `- ${rel}`).join('\n');
  const names = traceFilePlan(task)
    .map((item) => `${path.basename(item.rel)} 的 scenario 是 ${item.scenario}`)
    .join('，');
  const eventList = (task?.input?.events ?? ['keydown', 'keyup', 'click']).join('、');
  return `${appendix}

## 本题题面（唯一玩法来源）

${instruction.trim()}

## 本次必须重写

你是这一次跑分的 Builder。只根据上面的题面和本引擎附录，从零写出一份新提交。
不要读取量表、评测仓，也不要照抄任何上一轮工程。

把提交写进当前工作目录。评测主进程不写游戏源码。
写完后主进程会审计轨迹，再做构建和一次启动：1Game 执行 1gameplay create 并确认 store 已绑定；Godot headless import 后让主场景跑一帧。
校验失败时你会再次被调用，prompt 末尾是错误文本。只按错误改当前工作区，不要读评测仓。
也可以只在标准输出打印一个 JSON 对象（仅旧的模型命令会读取它）：
{"files":{"相对路径":"文件全文"}}

每个 scenario 恰好一条轨迹，不得用另一个文件重复 clear 或其他演示名；同一演示所需的多个地图或步骤应合并在该条时长上限内。
必须包含：
${files}

traces 使用 schema eval.trace/1。duration_frames 是整数。viewport 是 {"w":1280,"h":720}。每条事件带整数 frame。${names}。事件类型只有 ${eventList}。keydown 和 keyup 用 code。click、mouse_down、mouse_move、mouse_up 用 x 和 y。格式和自查步骤以「提交前自己调试」为准。
1Game 只改 src/game.tsx 和 demo_outputs，入口从 @1game/engine-bundle/runtime/worker 导入并绑定 store。方向键图用静态 import 引用 assets 里的 png。
Godot 主场景是 game.tscn，脚本 game.gd，窗口 1280×720。方向键图用 res://assets/ 下的 png。不要写探测脚本，不要用 CharacterBody2D 或 RigidBody 决定对错。
`;
}

const DEBUG_PROMPT_BANNED = ['1Game', '1game', 'Godot', 'godot', 'EvalProbe', '1gameplay', 'CharacterBody', 'napi-canvas', 'Xvfb', 'rubric'];

export function buildDebugPrompt({ instruction, task }) {
  const allowEmpty = new Set(task?.scenarios?.allow_empty ?? []);
  const cases = traceFilePlan(task)
    .map((item) => {
      const stop = allowEmpty.has(item.scenario)
        ? '可以没有事件，结束时停在开始。'
        : '必须有事件，结束时需求里的这一局面已经发生。';
      return `- \`${item.rel}\`：scenario 是 ${item.scenario}。${stop}`;
    })
    .join('\n');
  const text = `你是调试。当前工作目录里已经有一份游戏，以及 demo_outputs 下的测试用例。这一轮只改这份提交，让游戏需求在每条测试用例结束时成立。

不要读评测仓，不要读隐藏量表，不要实现探测接口。使用交接提供的统一验证入口执行真实轨迹，再对照需求检查画面；不要另写输入注入器。下面的玩法核对步骤与引擎无关。

## 游戏需求

${String(instruction ?? '').trim()}

## 测试用例

每条轨迹是一条测试用例。轨迹里没有的点击和按键不会发生。
每个 scenario 恰好一条轨迹，不能新增重复场景文件。允许事件类型：${(task?.input?.events ?? ['keydown', 'keyup', 'click']).join('、')}。mouse_down、mouse_move、mouse_up 如本题允许，使用 frame/type/x/y。
${cases}

先完成依赖、构建、类型、素材加载和文字属性的必要检查，再修正规则或轨迹。进入最终完整轨迹验证前，完成所有代码与素材修改；不要在轨迹已经通过后才补类型声明或做无关的文案调整。

1. 对照游戏需求列清单。每种可见文案、每种输入、每种胜负条件，都要能在当前提交里找到。文案与需求逐字一致。
2. 按 frame 从小到大喂入该条测试用例的事件。走完后，文件名里的 scenario 必须已经发生。intro 停在开始，loop 停在对局中途，fail 停在失败，clear 停在过关。失败文案和过关文案不能同时出现。
3. 整段 duration_frames 里的每一帧都画出当时的画面。移动、攻击、倒下用一份这一帧内不再改短的列表来画，去掉已经结束的过程时跳过空位。失败或通关文案出现之后，后面的帧保持这句文案，过程在这句文案出现前画完。
4. 用手算血量、回合、连击、胜负。失败不能写成过关，过关不能停在半截。对不上需求时，改游戏规则，或改这条测试用例的事件和时长。
5. 测试用例保持 eval.trace/1。duration_frames 是不小于 1 的整数，并且不超过需求给出的时长上限乘 30。viewport 是 {"w":1280,"h":720}。events 按 frame 非递减。keydown 和 keyup 写成 {"frame":整数,"type":"keydown"或"keyup","code":需求允许的键}。click 写成 {"frame":整数,"type":"click","x":数字,"y":数字}。同一按键在 keyup 之前不能再 keydown。
6. 所有修改完成后，把最终版本的每条测试用例按第 2 步和第 3 步再走一遍。通过后只做必要归档和回报，不追加无关调整；若发现必要缺陷，修改后必须重新验证，未完成不能声称成功。给最终验证与回报留出时间，无法在阶段截止前完成时如实回报失败。最终消息留空，或只包含一个 JSON。
`;
  const hit = DEBUG_PROMPT_BANNED.filter((word) => text.includes(word));
  if (hit.length) throw new EvalError('EVAL_INTERNAL', `debug prompt names an engine or rubric: ${hit.join(',')}`);
  return text;
}

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new EvalError('BUILDER_INVALID', `builder path rejected: ${rel}`);
  }
  return rel.split('\\').join('/');
}

export function filesFromModelText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.files || typeof parsed.files !== 'object') return null;
  const files = {};
  for (const [rel, body] of Object.entries(parsed.files)) {
    if (typeof body !== 'string') throw new EvalError('BUILDER_INVALID', `builder file is not text: ${rel}`);
    files[safeRel(rel)] = body;
  }
  return files;
}

function writeFiles(dest, files) {
  for (const [rel, body] of Object.entries(files)) {
    const out = path.join(dest, safeRel(rel));
    const resolved = path.resolve(out);
    const root = path.resolve(dest);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new EvalError('BUILDER_INVALID', `builder path escapes dest: ${rel}`);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
  }
}

export function auditModelSubmission(dest, engine, taskId) {
  const bundle = loadP1Task(taskId);
  assertSubmission(dest, engine, bundle.task);
}

function walkTextFiles(root, acc = [], prefix = '') {
  if (!fs.existsSync(root)) return acc;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git' || ent.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkTextFiles(path.join(root, ent.name), acc, rel);
    else if (/\.(tsx?|jsx?|gd|md|json|godot|tscn|txt)$/i.test(ent.name)) acc.push(rel);
  }
  return acc;
}

export function assertSubmission(dest, engine, task) {
  const required = requiredSubmissionFiles(engine, task);
  const missing = required.filter((rel) => !fs.existsSync(path.join(dest, rel)));
  if (missing.length) {
    throw new EvalError('BUILDER_INVALID', `model submission missing ${missing.join(', ')}`);
  }
  const blob = required
    .filter((rel) => rel.endsWith('.gd') || rel.endsWith('.tsx') || rel.endsWith('.ts'))
    .map((rel) => fs.readFileSync(path.join(dest, rel), 'utf8'))
    .join('\n');
  if (/class_name EvalProbe|func dump\(/.test(blob)) {
    throw new EvalError('BUILDER_INVALID', 'model submission must not implement EvalProbe');
  }
  const policy = tracePolicy(task);
  const traces = readTraces(path.join(dest, 'demo_outputs'), policy);
  if (!traces.length || traces.some((t) => !t.audit.ok)) {
    const issues = traces.flatMap((t) => t.audit.issues.map((issue) => `${t.file}: ${issue}`));
    throw new EvalError('BUILDER_INVALID', `model traces failed audit: ${issues.join('; ') || 'none'}`);
  }
  for (const item of traceFilePlan(task)) {
    const hit = traces.find((t) => t.file === path.basename(item.rel));
    if (hit?.trace?.scenario !== item.scenario) {
      throw new EvalError('BUILDER_INVALID', `${item.rel} scenario must be ${item.scenario}`);
    }
  }
  const duplicates = duplicateScenarioNames(traces);
  if (duplicates.length) {
    throw new EvalError('BUILDER_INVALID', `model traces repeat scenario ${[...new Set(duplicates)].join(', ')}`);
  }
  const missingScenarios = missingRequiredScenarios(traces, {
    required: policy.scenarios,
    allowEmpty: policy.allowEmpty,
  });
  if (missingScenarios.length) {
    throw new EvalError('BUILDER_INVALID', `model traces missing ${missingScenarios.join(', ')}`);
  }
  const leaks = [];
  for (const rel of walkTextFiles(dest)) {
    if (rel.startsWith('demo_outputs/')) continue;
    const text = fs.readFileSync(path.join(dest, rel), 'utf8');
    if (/judge\/|probe\.json|examples\/oracles|\brubric\b/.test(text)) leaks.push(rel);
  }
  if (leaks.length) {
    throw new EvalError('BUILDER_INVALID', `model submission leaks judge material: ${leaks.join(', ')}`);
  }
}

function completeWithCommand({ prompt, engine, instruction, dest }) {
  const cmd = process.env.EVAL_BUILDER_CMD;
  if (!cmd) {
    throw new EvalError(
      'BUILDER_REQUIRED',
      '跑分必须由模型按题面重写两边提交。设置 EVAL_BUILDER_CMD（工作目录为提交目录，stdin 为 JSON）或 EVAL_BUILDER_API_KEY。禁止写回内嵌成品。',
    );
  }
  let args = [];
  if (process.env.EVAL_BUILDER_ARGS) {
    const parsed = JSON.parse(process.env.EVAL_BUILDER_ARGS);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new EvalError('EVAL_INTERNAL', 'EVAL_BUILDER_ARGS must be a JSON string array');
    }
    args = parsed;
  }
  const timeoutMs = Number(process.env.EVAL_BUILDER_TIMEOUT_MS || 600_000);
  const result = spawnSync(cmd, args, {
    cwd: dest,
    env: process.env,
    encoding: 'utf8',
    input: JSON.stringify({ engine, instruction, prompt, dest }),
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw new EvalError('BUILDER_INVALID', result.error.message);
  if (result.status !== 0) {
    throw new EvalError('BUILDER_INVALID', `builder exited ${result.status}\n${result.stderr || result.stdout}`.slice(0, 2000));
  }
  return result.stdout ?? '';
}

function completeWithApi({ prompt }) {
  const key = process.env.EVAL_BUILDER_API_KEY;
  if (!key) return null;
  const base = (process.env.EVAL_BUILDER_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.EVAL_BUILDER_MODEL || 'gpt-4.1';
  const timeoutMs = Number(process.env.EVAL_BUILDER_TIMEOUT_MS || 600_000);
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const body=JSON.parse(require('fs').readFileSync(0,'utf8'));
fetch(process.env.EVAL_BUILDER_URL,{method:'POST',headers:{authorization:'Bearer '+process.env.EVAL_BUILDER_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:process.env.EVAL_BUILDER_MODEL,messages:[{role:'system',content:'你只根据题面实现游戏。输出 JSON 或直接说明已写盘。'},{role:'user',content:body.prompt}]})}).then(async (r)=>{const t=await r.text(); if(!r.ok){console.error(t); process.exit(1);} const j=JSON.parse(t); process.stdout.write(j.choices?.[0]?.message?.content ?? '');}).catch((e)=>{console.error(e); process.exit(1);});`,
    ],
    {
      env: {
        ...process.env,
        EVAL_BUILDER_URL: `${base}/chat/completions`,
        EVAL_BUILDER_API_KEY: key,
        EVAL_BUILDER_MODEL: model,
      },
      encoding: 'utf8',
      input: JSON.stringify({ prompt }),
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw new EvalError('BUILDER_INVALID', `builder API failed\n${result.stderr || result.stdout}`.slice(0, 2000));
  }
  return result.stdout ?? '';
}

export async function runModelBuilder({ taskId, engine, instruction, dest, wipe = false, complete } = {}) {
  if (!taskId || !instruction) throw new EvalError('EVAL_INTERNAL', 'model builder needs taskId and instruction');
  const prompt = buildBuilderPrompt({ engine, instruction, task: loadP1Task(taskId).task });
  if (wipe) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  const stampPath = path.join(path.dirname(path.resolve(dest)), `builder-${engine}.json`);
  let text = '';
  if (complete) {
    text = await complete({ prompt, engine, instruction, dest, taskId });
  } else if (process.env.EVAL_BUILDER_CMD) {
    text = completeWithCommand({ prompt, engine, instruction, dest });
  } else if (process.env.EVAL_BUILDER_API_KEY) {
    text = completeWithApi({ prompt });
  } else {
    throw new EvalError(
      'BUILDER_REQUIRED',
      '跑分必须由模型按题面重写两边提交。设置 EVAL_BUILDER_CMD（工作目录为提交目录，stdin 为 JSON）或 EVAL_BUILDER_API_KEY。禁止写回内嵌成品。',
    );
  }
  const files = filesFromModelText(text);
  if (files) writeFiles(dest, files);
  assertSubmission(dest, engine, loadP1Task(taskId).task);
  const instructionSha = createHash('sha256').update(instruction).digest('hex');
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(
    stampPath,
    `${JSON.stringify({ source: 'model', taskId, engine, instruction_sha256: instructionSha }, null, 2)}\n`,
  );
  return { dest, stampPath, prompt };
}
