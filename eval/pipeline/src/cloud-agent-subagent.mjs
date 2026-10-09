import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { WORK_DIR } from './paths.mjs';
import { EvalError } from './util.mjs';
import { stageTimeoutMs, stageProcessError } from './stage-timeout.mjs';

export function cloudTaskDir() {
  return process.env.EVAL_CLOUD_TASK_DIR || path.join(WORK_DIR, '.cloud-agent-tasks');
}

export function cloudAgentSubagentEnabled(env = process.env) {
  if (env.EVAL_CLOUD_AGENT_SUBAGENT === '0') return false;
  if (env.EVAL_CLOUD_AGENT_SUBAGENT === '1') return true;
  if (env.NODE_TEST_CONTEXT) return false;
  return env.CURSOR_AGENT === '1';
}

function stillPaths(spec) {
  const paths = [];
  for (const frames of Object.values(spec.stills ?? {})) {
    for (const frame of frames ?? []) {
      if (frame?.path) paths.push(frame.path);
    }
  }
  return paths;
}

export function cloudTaskHandoff(spec) {
  const attachments = spec.role === 'looks' ? stillPaths(spec) : [];
  const prompt = `你是当前 Cloud Agent 拉起的 subagent，只做这一阶段（role=${spec.role}，engine=${spec.engine}，task=${spec.taskId}）。
工作目录是 ${spec.workspace}。不要读评测仓，不要读另一边引擎，不要读隐藏量表文件。

${spec.prompt}

回报约定：
- builder：把提交写进工作目录。最终消息留空，或只包含一个 JSON。
- debug：按游戏需求和测试用例改当前工作目录。最终消息留空，或只包含一个 JSON。
- looks：最终消息只包含 prompt 要求的 JSON 对象，不要加解释。
- replay：不会走到这里。`;
  return {
    subagent_type: 'generalPurpose',
    description: `${spec.role} ${spec.engine} ${spec.taskId}`.slice(0, 80),
    file_attachments: attachments,
    prompt,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitCloudModel(spec) {
  const timeoutMs = stageTimeoutMs(spec.role);
  const dir = cloudTaskDir();
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`;
  const reqPath = path.join(dir, `${id}.request.json`);
  const resPath = path.join(dir, `${id}.response.json`);
  const payload = { id, spec, handoff: cloudTaskHandoff(spec) };
  fs.writeFileSync(reqPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stderr.write(`cloud-agent subagent ${spec.role} ${spec.engine} ${spec.taskId} -> ${reqPath}\n`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(resPath)) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(resPath, 'utf8'));
      } catch (err) {
        throw new EvalError('SUBAGENT_INVALID', `cloud agent response is not JSON: ${err.message}`);
      }
      fs.rmSync(reqPath, { force: true });
      fs.rmSync(resPath, { force: true });
      const exitCode = Number(data.exitCode ?? 0);
      if (exitCode !== 0) {
        throw new EvalError(
          'SUBAGENT_INVALID',
          `subagent ${spec.role} ${spec.engine} exited ${exitCode}\n${data.stderr || data.stdout || ''}`.slice(0, 2000),
        );
      }
      return data.stdout ?? '';
    }
    await delay(200);
  }
  throw new EvalError(
    `${spec.role.toUpperCase()}_TIMEOUT`,
    `当前 Cloud Agent 没有在 ${timeoutMs}ms 内完成 ${spec.role} ${spec.engine}。请求还在 ${reqPath}`,
  );
}

function runReplayArgv(spec) {
  const argv = spec.replay?.argv;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new EvalError('SUBAGENT_INVALID', 'replay spec 缺少 argv');
  }
  const timeoutMs = stageTimeoutMs(spec.role);
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: 'utf8',
    env: process.env,
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw stageProcessError(spec, result);
  return result.stdout ?? '';
}

export async function runCloudAgentSubagent(spec) {
  if (spec.role === 'replay') return runReplayArgv(spec);
  if (spec.role === 'builder' || spec.role === 'debug' || spec.role === 'looks') return waitCloudModel(spec);
  throw new EvalError('SUBAGENT_INVALID', `unknown role ${spec.role}`);
}
