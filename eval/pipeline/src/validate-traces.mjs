import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WORK_DIR, taskDir } from './paths.mjs';
import { loadYaml } from './load.mjs';
import { assertSubmission } from './model-builder.mjs';
import { runTraceReplay } from './stage-replay.mjs';
import { EvalError } from './util.mjs';
import { writeReport } from './report.mjs';
import { readStageContext } from './stage-close.mjs';
import { runValidationProcess } from './validation-process.mjs';

const TASK_IDS = ['p1-chart-rush', 'p1-depot-skirmish', 'p1-tower-defense', 'p1-slide-puzzle'];

export async function validateStageTraces({ engine, taskId, workspace, scenario, timingPath }) {
  const ctx = readStageContext(timingPath, { engine, taskId, workspace });
  if (!['builder', 'debug'].includes(ctx.timing.role)) throw new EvalError('SUBAGENT_INVALID', 'only builder/debug can validate traces');
  const argv = [process.execPath, fileURLToPath(new URL('./cli.mjs', import.meta.url)), 'validate-traces',
    '--engine', engine, '--task', taskId, '--workspace', workspace];
  if (scenario) argv.push('--scenario', scenario);
  const result = await runValidationProcess(argv, { stopAt: ctx.validationStopAt,
    graceMs: Math.min(5000, Math.floor(ctx.timing.closing_reserve_ms / 4)) });
  if (!result.stopped) {
    try {
      const report = JSON.parse(result.stdout);
      if (report.schema !== 'eval.trace-validation/1' || result.status !== (report.ok ? 0 : 1)) throw new Error('invalid validation result');
      return report;
    } catch (err) { throw new EvalError('SUBAGENT_PROCESS_FAILED', `validation worker failed: ${result.stderr || err.message}`); }
  }
  const dir = path.join(WORK_DIR, `validation-close-${Date.now()}-${randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'stdout.log'), result.stdout);
  fs.writeFileSync(path.join(dir, 'stderr.log'), result.stderr);
  const report = { schema: 'eval.trace-validation/1', diagnostic_only: true, engine, taskId, ok: false,
    primary: 'STAGE_VALIDATION_INCOMPLETE',
    failure: { kind: 'validation_incomplete', message: '验证为预留归档时间已自动停止，全部验证进程已退出；最终自查尚未完成，不能声明通过。' },
    execution_deadline_at: ctx.timing.execution_deadline_at,
    validation_stop_at: new Date(ctx.validationStopAt).toISOString(), artifact_dir: dir };
  writeReport(path.join(dir, 'VALIDATION.json'), report);
  return report;
}

export function validateTraces({ engine, taskId, workspace, scenario } = {}) {
  if (!TASK_IDS.includes(taskId) || !['onegame', 'godot'].includes(engine) || !workspace) {
    throw new EvalError('EVAL_INTERNAL', 'validate-traces needs a supported engine, public task id and workspace');
  }
  // Only public input/trace policy. Do not load a scoring rubric for self-checks.
  const task = loadYaml(path.join(taskDir(taskId), 'task.yaml'));
  if (scenario && !task.scenarios.required.includes(scenario)) throw new EvalError('TRACE_INVALID', 'unknown scenario');
  const runId = `validation-${Date.now()}-${randomBytes(6).toString('hex')}`;
  const dir = path.join(WORK_DIR, runId);
  const copy = path.join(dir, 'submission');
  const excluded = new Set(['node_modules', '.git', '.godot', 'out', 'work', '.validation']);
  fs.cpSync(path.resolve(workspace), copy, {
    recursive: true,
    filter: (src) => !excluded.has(path.relative(path.resolve(workspace), src).split(path.sep)[0]),
  });
  if (engine === 'onegame') {
    fs.symlinkSync(path.join(path.resolve(workspace), 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  }
  assertSubmission(copy, engine, task);
  if (scenario) {
    for (const file of fs.readdirSync(path.join(copy, 'demo_outputs'))) {
      if (!file.endsWith('.json')) continue;
      const trace = JSON.parse(fs.readFileSync(path.join(copy, 'demo_outputs', file), 'utf8'));
      if (trace.scenario !== scenario) fs.unlinkSync(path.join(copy, 'demo_outputs', file));
    }
  }
  const replay = runTraceReplay({ engine, taskId, workspace: copy, runId, task, finalOnly: true });
  const expected = scenario ? [scenario] : task.scenarios.required;
  const completed = replay.replayed_scenarios ?? [];
  const report = {
    schema: 'eval.trace-validation/1', diagnostic_only: true,
    engine, taskId, primary: replay.primary,
    ok: replay.G && expected.every((name) => completed.includes(name)) && replay.stills.every((s) => s.ok),
    expected_scenarios: expected, replayed_scenarios: completed,
    notes: replay.notes, stills: replay.stills, artifact_dir: dir,
    meaning: '运行成功仅说明轨迹合法、可启动并执行，不证明玩法或终局符合题面；请检查起止静帧。此报告不是正式重放回执或评分。',
  };
  writeReport(path.join(dir, 'VALIDATION.json'), report);
  return report;
}
