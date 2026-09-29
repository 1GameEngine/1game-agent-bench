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
  return `${appendix}

## 本题题面（唯一玩法来源）

${instruction.trim()}

## 本次必须重写

你是这一次跑分的 Builder。只根据上面的题面和本引擎附录，从零写出一份新提交。
不要读取量表、评测仓，也不要照抄任何上一轮工程。

把提交写进当前工作目录。评测主进程不写游戏源码。
也可以只在标准输出打印一个 JSON 对象（仅旧的模型命令会读取它）：
{"files":{"相对路径":"文件全文"}}

必须包含：
${files}

traces 使用 schema eval.trace/1，viewport 1280×720。${names}。事件只有题面允许的 keydown、keyup、click。
1Game 只改 src/game.tsx 和 demo_outputs，入口从 @1game/engine-bundle/runtime/worker 导入并绑定 store。方向键图用静态 import 引用 assets 里的 png。
Godot 主场景是 game.tscn，脚本 game.gd，窗口 1280×720。方向键图用 res://assets/ 下的 png。不要写探测脚本，不要用 CharacterBody2D 或 RigidBody 决定对错。
`;
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

function assertSubmission(dest, engine, task) {
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
