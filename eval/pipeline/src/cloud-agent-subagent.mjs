import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_DIR } from './paths.mjs';
import { EvalError } from './util.mjs';
import { stageTimeoutMs, stageDispatchTimeoutMs, stageProcessError } from './stage-timeout.mjs';
import { stageResponseError } from './stage-result.mjs';
import { runProcess } from './process-supervisor.mjs';
import { stageOutcome } from './stage-records.mjs';
import { EXECUTION_POLICY_REVISION } from './execution-policy.mjs';
import { resultMetadata } from './execution-adapter.mjs';
import { selfCheckEvidenceError } from './self-check-evidence.mjs';
import { validationIndexPath } from './validation-control.mjs';

export function cloudTaskDir(env = process.env) {
  return env.EVAL_CLOUD_TASK_DIR || path.join(WORK_DIR, '.cloud-agent-tasks');
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

export function cloudTaskHandoff(spec, lifecycle) {
  const attachments = spec.role === 'looks' ? stillPaths(spec) : [];
  const timing = lifecycle ? `
## 开工计时与回执

请求 ID：${lifecycle.id}
开工回执路径：${lifecycle.start_path}
结果回执路径：${lifecycle.response_path}
计时记录路径：${lifecycle.timing_path}
真实结果归档路径：${lifecycle.archive_response_path}
派发截止时间（UTC）：${lifecycle.queue_deadline_at}
执行预算：${lifecycle.execution_timeout_ms} ms；收尾预留：${lifecycle.closing_reserve_ms} ms（包含在执行预算内）。
实际开始本阶段时，先确认派发截止时间未过且计时记录仍为 QUEUED；已失败的请求不能再开工、修改提交或补写成功回执。第一步用临时文件加原子重命名写入开工回执，内容为 {"id":"${lifecycle.id}","started_at":"开工时的 UTC ISO 时间"}。只写当前实际时间，不能提前登记、回填或重写开工时间。主代理不能代替阶段代理登记开工。
执行截止时间 = started_at + 执行预算。先计算并记录这个明确时间；计时记录会保存 execution_deadline_at。等待派发不占用执行预算，但未在派发截止前开工会失败。
开始收尾时间 = 执行截止时间 - 收尾预留。这是停止追加修改、准备归档回报的提醒，不是验证结果失效的截止时间。应提前启动最终验证；带 --stage-timing 的统一验证可在收尾期前半段继续，随后自动停止整个验证进程组，为真实回执留出后半段（默认约 30 秒，停止进程最多再用 7 秒）。不能为赶时限伪报成功；未完成全部自查就如实回报 validation_incomplete，发现玩法问题就回报 game_validation_failed。回报前停止并等待其他所有会修改提交或验证证据的子进程，避免后台继续改动。过执行截止的结果仍不接受。
收尾时将真实结果 JSON 写入自己的文件，立即执行以下可信 argv 并追加 --input <结果JSON路径>：
${JSON.stringify(lifecycle.response_publish_argv)}
该入口先原子归档，再原子发布相同回执，检查请求仍有效并拒绝覆盖；可加 --archive <交接要求的额外归档路径>。不读取这个工具的实现。工具不会替你判断或伪造验证成功。
` : '';
  const validation = spec.validation ? `\n## 统一验证入口\n\n只执行以下 argv，不读取其评测实现：\n${JSON.stringify(spec.validation.argv)}\n可加 --scenario <演示名> 单独排查，配合 --until-frame <包含的末帧> 和 --checkpoints <逗号分隔的帧号> 查看原轨迹前缀和关键帧。诊断不能替代最终全量验证，未加诊断参数的完整运行才是 full 模式。它复用正式输入、30fps和点击时序，不写正式 REPLAY.json、不读隐藏量表、不打分。运行成功只说明轨迹可执行；必须实际查看静帧，按公开题面确认每个场景和关键操作。不要抽取内部 host API、另写输入注入器或把手算当作引擎验证。
验证开工立即在 stderr 输出 session、进度/反馈路径与预算建议。当前阶段 session 索引：${spec.validation.sessions_path ?? '入口开工输出的 sessions_path'}。
每场景完成和关键帧截图会即时输出反馈。在同一阶段只能运行一个验证；不要仅 Ctrl-C 外层 shell，使用取消入口并等待返回真实清理终态，再启动新的验证。
取消 argv（追加 --session <本人session_id>）：${JSON.stringify(spec.validation.cancel_argv ?? [])}
预算查询 argv：${JSON.stringify(spec.validation.budget_argv ?? [])}
先完成依赖/构建/类型/素材检查，读取本侧 builder 已发现的问题，针对失败场景诊断并修复回归。尤其检查“普通点击→拖放→再次普通点击”是否仍能响应。随后停止修改候选，启动一次最终完整验证并查看全部起止图；必要修改之后必须重新验证新候选。预算建议按已测全量耗时+45秒看图+30秒安全余量计算最晚全量启动时间，不是只预留最后一分钟。没有足够时间就如实报告未完成，不能延长预算。
` : '';
  const context = spec.debug_context ? `\n## 本侧 builder 自查交接\n${JSON.stringify(spec.debug_context)}\n仅属于本侧本题；旧候选的通过结果不能作为当前候选的成功依据。\n` : '';
  const proof = spec.self_check_contract ? `\n成功回执另需 self_check：{"session_id":"最终session","submission_id":"该验证候选摘要","reviewed_still_ids":["全部最终静帧ID"],"preflight":{"passed":true,"checks":["真实完成的依赖、类型、构建、素材检查"]},"scenarios":{"每个必需场景":{"passed":true,"checks":[{"requirement":"公开题面的具体行为","passed":true,"evidence":["本场景静帧ID"]}]}}}。框架检查完整性与候选匹配，不代替你看图或判断玩法。缺少最终证据不能声明成功；负回执仍使用真实 failure。\n` : '';
  const prompt = `你是当前 Cloud Agent 拉起的 subagent，只做这一阶段（role=${spec.role}，engine=${spec.engine}，task=${spec.taskId}）。
工作目录是 ${spec.workspace}。不要读评测仓，不要读另一边引擎，不要读隐藏量表文件。
${timing}${validation}${context}${proof}

${spec.prompt}

回报约定：
- builder：把提交写进工作目录。最终消息留空，或只包含一个 JSON。
- debug：按游戏需求和测试用例改当前工作目录。最终消息留空，或只包含一个 JSON。
- looks：最终消息只包含 prompt 要求的 JSON 对象，不要加解释。
- replay：不会走到这里。
结果回执成功为 {"stdout":"","exitCode":0}（looks 的 stdout 为裁决 JSON 字符串）。自查未完成为 {"stdout":"","exitCode":1,"failure":{"kind":"validation_incomplete","message":"具体未完成项"}}；玩法自查失败使用 kind="game_validation_failed"。仅 builder/debug 可使用这两类，不表示通过；框架会保留问题并独立审计和启动检查，合法提交才继续正式评测。环境、工具或其他异常回报非零 exitCode 和 stderr，不伪装为自查失败。`;
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

function writeJsonAtomic(file, data) {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Atomic rename updates ctime; mtime alone may still be the temporary file's
// earlier write time, or may have been explicitly backdated.
export function receiptPublishedAt(_file, stat) {
  return Math.floor(Math.max(stat.ctimeMs, stat.mtimeMs));
}

export function readPublishedReceipt(file, label, publicationTime) {
  const fd = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(fd);
    let data;
    try { data = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch (err) { throw new EvalError('SUBAGENT_INVALID', `${label} is not JSON: ${err.message}`); }
    const after = fs.fstatSync(fd);
    if (before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      throw new EvalError('SUBAGENT_INVALID', `${label} changed while being read`);
    }
    return { data, publishedAt: publicationTime(file, after) };
  } finally { fs.closeSync(fd); }
}

// Both the supervisor and trusted tools validate the same atomic start receipt.
// Tools may read it before the supervisor's next poll; only the supervisor
// writes lifecycle transitions.
export function readStageStart(record, startPath, { now = Date.now, publicationTime = receiptPublishedAt } = {}) {
  let receipt;
  try { receipt = readPublishedReceipt(startPath, 'cloud agent start receipt', publicationTime); }
  catch (err) {
    if (err instanceof EvalError) throw err;
    throw new EvalError('SUBAGENT_INVALID', `cloud agent start receipt unavailable: ${err.message}`);
  }
  const { data: ack, publishedAt } = receipt;
  const time = now();
  const queuedAt = Date.parse(record.queued_at);
  const stamp = typeof ack?.started_at === 'string' ? Date.parse(ack.started_at) : NaN;
  if (ack?.id !== record.id || !Number.isFinite(queuedAt) || !Number.isFinite(stamp) || stamp < queuedAt || stamp > time ||
      !Number.isFinite(publishedAt) || publishedAt > time || !Number.isSafeInteger(record.queue_timeout_ms) || record.queue_timeout_ms < 1) {
    throw new EvalError('SUBAGENT_INVALID', 'cloud agent start receipt has wrong id or invalid start time');
  }
  if (stamp >= queuedAt + record.queue_timeout_ms || publishedAt >= queuedAt + record.queue_timeout_ms) {
    throw new EvalError(`${record.role.toUpperCase()}_DISPATCH_TIMEOUT`, 'cloud agent start receipt arrived after dispatch deadline',
      { stage: record.role, engine: record.engine, taskId: record.taskId, timeout_phase: 'dispatch', timeout_ms: record.queue_timeout_ms,
        timing_path: record.timing_path });
  }
  return stamp;
}

export async function waitCloudModel(spec, { env = process.env, now = Date.now, sleep = delay,
  publicationTime = receiptPublishedAt, onLifecycle = spec._onLifecycle, signal = spec._signal } = {}) {
  if (signal?.aborted) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'cloud stage interrupted before dispatch');
  const timeoutMs = stageTimeoutMs(spec.role, env);
  const dispatchMs = stageDispatchTimeoutMs(env);
  const dir = cloudTaskDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const queuedAt = now();
  const id = `${queuedAt}-${process.pid}-${randomBytes(4).toString('hex')}`;
  const reqPath = path.join(dir, `${id}.request.json`);
  const resPath = path.join(dir, `${id}.response.json`);
  const startPath = path.join(dir, `${id}.started.json`);
  const timingPath = path.join(dir, `${id}.timing.json`);
  const iso = (ms) => new Date(ms).toISOString();
  const lifecycle = {
    id, start_path: startPath, response_path: resPath, timing_path: timingPath,
    archive_response_path: path.join(dir, `${id}.archive.json`),
    response_publish_argv: [process.execPath, fileURLToPath(new URL('./cli.mjs', import.meta.url)),
      'publish-stage-response', '--stage-timing', timingPath],
    queue_deadline_at: iso(queuedAt + dispatchMs), queue_timeout_ms: dispatchMs,
    execution_timeout_ms: timeoutMs, closing_reserve_ms: Math.min(60_000, Math.floor(timeoutMs / 10)),
  };
  const record = {
    schema: 'eval.cloud-stage-timing/1', id, role: spec.role, engine: spec.engine, taskId: spec.taskId,
    stage_id: spec.stage_id ?? null, execution_policy_revision: EXECUTION_POLICY_REVISION,
    execution_status: 'QUEUED', self_check_status: 'UNAVAILABLE', evidence_status: 'NOT_APPLICABLE',
    state: 'QUEUED', queued_at: iso(queuedAt), ...lifecycle,
    started_at: null, execution_deadline_at: null, wrap_up_at: null, queue_wait_ms: null, execution_elapsed_ms: null,
  };
  writeJsonAtomic(timingPath, record);
  const { _onLifecycle, _signal, _onSelfCheck, ...publicSpec } = spec;
  const timedSpec = spec.validation ? { ...publicSpec, validation: { ...spec.validation,
    argv: [...spec.validation.argv, '--stage-timing', timingPath],
    sessions_path: validationIndexPath(timingPath),
    cancel_argv: [process.execPath, fileURLToPath(new URL('./cli.mjs',import.meta.url)), 'cancel-validation','--stage-timing',timingPath],
    budget_argv: [process.execPath, fileURLToPath(new URL('./cli.mjs',import.meta.url)), 'validation-budget','--stage-timing',timingPath] } } : publicSpec;
  const payload = { id, spec: timedSpec, lifecycle, handoff: cloudTaskHandoff(timedSpec, lifecycle) };
  writeJsonAtomic(reqPath, payload);
  process.stderr.write(`cloud-agent subagent ${spec.role} ${spec.engine} ${spec.taskId} -> ${reqPath}\n`);
  let startedAt = null;
  let responsePublishedAt = null;
  function timeout(phase) {
    const primary = `${spec.role.toUpperCase()}_${phase === 'dispatch' ? 'DISPATCH_TIMEOUT' : 'TIMEOUT'}`;
    return new EvalError(primary,
      phase === 'dispatch' ? `当前 Cloud Agent 没有在 ${dispatchMs}ms 内开工 ${spec.role} ${spec.engine}。请求还在 ${reqPath}`
        : `当前 Cloud Agent 开工后没有在 ${timeoutMs}ms 内完成 ${spec.role} ${spec.engine}。请求还在 ${reqPath}`,
      { stage: spec.role, engine: spec.engine, taskId: spec.taskId, timeout_phase: phase,
        timeout_ms: phase === 'dispatch' ? dispatchMs : timeoutMs, timing_path: timingPath });
  }
  try {
    onLifecycle?.({ ...record });
    while (true) {
      if (signal?.aborted) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'cloud stage interrupted');
      let time = now();
      if (startedAt === null && fs.existsSync(startPath)) {
        const stamp = readStageStart(record, startPath, { now, publicationTime });
        time = now();
        startedAt = stamp;
        Object.assign(record, { state: 'RUNNING', execution_status: 'RUNNING', started_at: iso(stamp),
          execution_deadline_at: iso(stamp + timeoutMs),
          wrap_up_at: iso(stamp + timeoutMs - lifecycle.closing_reserve_ms), queue_wait_ms: stamp - queuedAt });
        writeJsonAtomic(timingPath, record);
        onLifecycle?.({ ...record });
      }
      const deadline = startedAt === null ? queuedAt + dispatchMs : startedAt + timeoutMs;
      if (fs.existsSync(resPath)) {
        if (startedAt === null) throw new EvalError('SUBAGENT_INVALID', 'cloud agent response arrived without a start receipt');
        const { data, publishedAt } = readPublishedReceipt(resPath, 'cloud agent response', publicationTime);
        time = now();
        // Some Linux filesystems use a cached coarse clock for inode times.
        // Allow its small lag only for clock consistency, never at the deadline.
        if (!Number.isFinite(publishedAt) || publishedAt < startedAt - 10 || publishedAt > time) {
          throw new EvalError('SUBAGENT_INVALID', 'cloud agent response has invalid publication time');
        }
        if (publishedAt >= deadline) throw timeout('execution');
        responsePublishedAt = Math.max(startedAt, publishedAt);
        Object.assign(record, { response_published_at: iso(responsePublishedAt), response_observed_at: iso(time) });
        const shapeError = stageResponseError(spec, data);
        const responseError = shapeError?.primary === 'SUBAGENT_INVALID' ? shapeError
          : selfCheckEvidenceError(spec, data, { stageId:id,timingPath }) ?? shapeError;
        if (responseError) throw responseError;
        spec._onSelfCheck?.(data.self_check);
        Object.assign(record, stageOutcome({ role: spec.role }), { state: 'COMPLETE', finished_at: iso(responsePublishedAt), execution_elapsed_ms: responsePublishedAt - startedAt });
        writeJsonAtomic(timingPath, record);
        onLifecycle?.({ ...record });
        for (const file of [reqPath, resPath, startPath]) fs.rmSync(file, { force: true });
        return data.stdout;
      }
      if (time >= deadline) throw timeout(startedAt === null ? 'dispatch' : 'execution');
      await sleep(Math.min(200, deadline - time));
    }
  } catch (err) {
    const finishedAt = responsePublishedAt ?? now();
    Object.assign(record, stageOutcome({ role: spec.role, error: err }), { state: 'FAILED', finished_at: iso(finishedAt), primary: err.primary ?? 'EVAL_INTERNAL',
      timeout_phase: err.extra?.timeout_phase ?? null,
      queue_wait_ms: startedAt === null ? finishedAt - queuedAt : startedAt - queuedAt,
      execution_elapsed_ms: startedAt === null ? null : finishedAt - startedAt });
    writeJsonAtomic(timingPath, record);
    onLifecycle?.({ ...record });
    throw err;
  }
}

async function runReplayArgv(spec) {
  const argv = spec.replay?.argv;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new EvalError('SUBAGENT_INVALID', 'replay spec 缺少 argv');
  }
  const timeoutMs = stageTimeoutMs(spec.role);
  const startedAt = Date.now();
  spec._onLifecycle?.({ state: 'RUNNING', started_at: new Date(startedAt).toISOString(),
    execution_deadline_at: new Date(startedAt + timeoutMs).toISOString() });
  const result = await runProcess(argv, { deadline: startedAt + timeoutMs, signal: spec._signal });
  spec._onLifecycle?.({ state: 'RUNNING', process_result: resultMetadata(result) });
  if (result.stopped || result.status !== 0) throw stageProcessError(spec, {
    ...result, error: result.stopped ? { code: 'ETIMEDOUT', message: 'replay execution deadline passed' } : null,
  });
  return result.stdout ?? '';
}

export async function runCloudAgentSubagent(spec) {
  if (spec.role === 'replay') return runReplayArgv(spec);
  if (spec.role === 'builder' || spec.role === 'debug' || spec.role === 'looks') return waitCloudModel(spec);
  throw new EvalError('SUBAGENT_INVALID', `unknown role ${spec.role}`);
}
