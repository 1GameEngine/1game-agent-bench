import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EVAL_DIR } from './paths.mjs';
import { auditTrace, missingRequiredScenarios, readTraces } from './p1-trace.mjs';
import { EvalError } from './util.mjs';

const REQUIRED = {
  onegame: [
    'src/game.tsx',
    'demo_outputs/01_intro.json',
    'demo_outputs/02_loop.json',
    'demo_outputs/03_fail.json',
    'demo_outputs/04_clear.json',
  ],
  godot: [
    'project.godot',
    'game.tscn',
    'game.gd',
    'demo_outputs/01_intro.json',
    'demo_outputs/02_loop.json',
    'demo_outputs/03_fail.json',
    'demo_outputs/04_clear.json',
  ],
};

const SCENARIO_BY_FILE = {
  'demo_outputs/01_intro.json': 'intro',
  'demo_outputs/02_loop.json': 'loop',
  'demo_outputs/03_fail.json': 'fail',
  'demo_outputs/04_clear.json': 'clear',
};

export function requiredSubmissionFiles(engine) {
  const files = REQUIRED[engine];
  if (!files) throw new EvalError('EVAL_INTERNAL', `no builder file list for ${engine}`);
  return files;
}

export function buildBuilderPrompt({ engine, instruction }) {
  const promptPath = path.join(EVAL_DIR, `builder.prompt.p1.${engine}.md`);
  if (!fs.existsSync(promptPath)) {
    throw new EvalError('EVAL_INTERNAL', `missing builder prompt ${promptPath}`);
  }
  const appendix = fs.readFileSync(promptPath, 'utf8').trim();
  const files = requiredSubmissionFiles(engine).map((rel) => `- ${rel}`).join('\n');
  return `${appendix}

## 本题题面（唯一玩法来源）

${instruction.trim()}

## 本次必须重写

你是这一次跑分的 Builder。只根据上面的题面和本引擎附录，从零写出一份新提交。
不要读取 rubric、probe、oracle、评测仓，也不要照抄任何上一轮工程。

把提交写进当前工作目录。评测主进程不写游戏源码。
也可以只在标准输出打印一个 JSON 对象（仅旧的模型命令会读取它）：
{"files":{"相对路径":"文件全文"}}

必须包含：
${files}

traces 使用 schema eval.trace/1，viewport 1280×720。01 的 scenario 是 intro，02 是 loop，03 是 fail，04 是 clear。事件只有 keydown、keyup、click。
1Game 只改 src/game.tsx 和 demo_outputs，入口从 @1game/engine-bundle/runtime/worker 导入并 bindStore。方向键图用静态 import 引用 assets 里的 png。
Godot 主场景是 game.tscn，脚本 game.gd，窗口 1280×720。方向键图用 res://assets/ 下的 png。不要写 EvalProbe，不要用 CharacterBody2D 或 RigidBody 决定对错。
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

export function auditModelSubmission(dest, engine) {
  assertSubmission(dest, engine);
}

function assertSubmission(dest, engine) {
  const missing = requiredSubmissionFiles(engine).filter((rel) => !fs.existsSync(path.join(dest, rel)));
  if (missing.length) {
    throw new EvalError('BUILDER_INVALID', `model submission missing ${missing.join(', ')}`);
  }
  const blob = requiredSubmissionFiles(engine)
    .filter((rel) => rel.endsWith('.gd') || rel.endsWith('.tsx') || rel.endsWith('.ts'))
    .map((rel) => fs.readFileSync(path.join(dest, rel), 'utf8'))
    .join('\n');
  if (/class_name EvalProbe|func dump\(/.test(blob)) {
    throw new EvalError('BUILDER_INVALID', 'model submission must not implement EvalProbe');
  }
  const traces = readTraces(path.join(dest, 'demo_outputs'));
  if (!traces.length || traces.some((t) => !t.audit.ok)) {
    const issues = traces.flatMap((t) => t.audit.issues.map((issue) => `${t.file}: ${issue}`));
    throw new EvalError('BUILDER_INVALID', `model traces failed audit: ${issues.join('; ') || 'none'}`);
  }
  for (const [rel, scenario] of Object.entries(SCENARIO_BY_FILE)) {
    const hit = traces.find((t) => t.file === path.basename(rel));
    if (hit?.trace?.scenario !== scenario) {
      throw new EvalError('BUILDER_INVALID', `${rel} scenario must be ${scenario}`);
    }
  }
  const missingScenarios = missingRequiredScenarios(traces);
  if (missingScenarios.length) {
    throw new EvalError('BUILDER_INVALID', `model traces missing ${missingScenarios.join(', ')}`);
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
  const prompt = buildBuilderPrompt({ engine, instruction });
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
  assertSubmission(dest, engine);
  const instructionSha = createHash('sha256').update(instruction).digest('hex');
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(
    stampPath,
    `${JSON.stringify({ source: 'model', taskId, engine, instruction_sha256: instructionSha }, null, 2)}\n`,
  );
  return { dest, stampPath, prompt };
}
