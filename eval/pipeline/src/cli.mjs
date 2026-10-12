import fs from 'node:fs';
import path from 'node:path';
import { EVAL_DIR, WORK_DIR, gameDir } from './paths.mjs';
import { EvalError, assertNoForbiddenScoreKeys } from './util.mjs';
import { loadSuite, loadTaskBundle, loadArgvRules, loadYaml } from './load.mjs';
import { bootstrap } from './bootstrap.mjs';
import { replayJudgeHygiene } from './replay.mjs';
import { buildReport, writeReport } from './report.mjs';
import { primaryOf } from './verdict.mjs';
import { auditPlayplanStep, allowedClickCenters } from './argv-audit.mjs';
import { runP1Compare } from './p1-run.mjs';
import { runOracleGate, runProduct100 } from './product-run.mjs';
import { writeScoreboardFromRun } from './scoreboard.mjs';
import { aggregateLooks, buildLooksUserPrompt, parseLooksVerdict } from './looks-rubric.mjs';
import { runStageReplay } from './stage-replay.mjs';
import { validateTraces, validateStageTraces, cancelStageValidation } from './validate-traces.mjs';
import { publishStageResponse, readStageContext } from './stage-close.mjs';
import { validationBudget } from './validation-control.mjs';
import { rebuildProductReports } from './report-store.mjs';

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function withCancellation(run) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try { return await run(controller.signal); }
  finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

export function runTask({ taskId, runId, oracle = false, builderLog }) {
  const bundle = loadTaskBundle(taskId);
  const boot = bootstrap({
    taskId,
    runId,
    instruction: bundle.instruction,
    oracle,
  });
  const result = replayJudgeHygiene({
    gameDir: boot.gameDir,
    bundle,
    builderLog,
  });
  return { id: taskId, ...result };
}

export function runOracles() {
  throw new EvalError('NO_REFERENCE', '本仓不提供参考作。P0 不再重放内置成品。');
}

export function auditBadTickFixture() {
  const badPlan = {
    schema: 'eval.playplan/1',
    steps: [{ id: 'bad-dt', argv: ['1gameplay', 'step', 'out/eval.1gamerecord', '--ms', '3008'] }],
  };
  const geom = loadYaml(path.join(EVAL_DIR, 'tasks', 'p0-countdown-play', 'geometry.yaml'));
  return auditPlayplanStep(badPlan.steps[0].argv, {
    rules: loadArgvRules(),
    allowedClicks: allowedClickCenters(geom),
    recordRel: 'out/eval.1gamerecord',
  });
}

export function runNegatives(suiteRunId) {
  loadSuite();
  const argvAudit = auditBadTickFixture();

  let overallRejected = false;
  try {
    assertNoForbiddenScoreKeys({ overall: 1 });
  } catch {
    overallRejected = true;
  }

  const taskId = 'p0-click-score';
  const bundle = loadTaskBundle(taskId);

  const runId = `${suiteRunId}-nobind`;
  bootstrap({ taskId, runId, instruction: bundle.instruction, oracle: false });
  fs.writeFileSync(
    path.join(gameDir(runId), 'src', 'game.tsx'),
    `import { createGameStore, renderGame } from '@1game/engine-bundle/runtime/worker';

const { store, commitChange } = createGameStore({
  phase: 'ready',
  score: 0,
});

function App() {
  return (
    <scene name="main" width={1280} height={720} backgroundColor="#0f1224">
      <node
        x={0}
        y={0}
        width={1280}
        height={720}
        clickable
        onClick={() => {
          commitChange('click', (draft) => {
            draft.score += 1;
          });
        }}
      />
      <text x={48} y={32} width={1184} height={96} text={String(store.score)} textColor="#fff" textSize={64} />
    </scene>
  );
}

renderGame(() => <App />, {});
`,
  );
  const nobind = replayJudgeHygiene({ gameDir: gameDir(runId), bundle });

  const hygRun = `${suiteRunId}-hygiene`;
  bootstrap({ taskId, runId: hygRun, instruction: bundle.instruction, oracle: false });
  fs.appendFileSync(path.join(gameDir(hygRun), '.cursor', 'skills', '1game', 'SKILL.md'), '\n<!-- eval tamper -->\n');
  const hyg = replayJudgeHygiene({ gameDir: gameDir(hygRun), bundle });

  return {
    argv_ms3008_rejected: argvAudit.ok === false,
    argv_issues: argvAudit.issues,
    overall_rejected: overallRejected,
    bindstore_empty: nobind.bindstore_empty === true,
    bindstore_primary: primaryOf(nobind),
    hygiene_ok: hyg.hygiene_ok,
    hygiene_notes: hyg.notes,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  try {
    if (cmd === 'run-oracles') {
      const { report, out } = runOracles(argValue(argv, '--run-id') ?? `oracle-${Date.now()}`);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(`wrote ${out}\n`);
      process.exitCode = report.tasks.every((t) => t.primary === 'PASS') ? 0 : 1;
      return;
    }
    if (cmd === 'run-task') {
      const taskId = argValue(argv, '--task');
      const runId = argValue(argv, '--run-id') ?? `run-${Date.now()}`;
      if (!taskId) throw new EvalError('EVAL_INTERNAL', '--task required');
      const row = runTask({ taskId, runId, oracle: hasFlag(argv, '--oracle') });
      process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
      return;
    }
    if (cmd === 'run-p1-compare') {
      const { report, out } = await withCancellation(signal => runP1Compare(argValue(argv, '--run-id') ?? `p1-${Date.now()}`, { signal }));
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(`wrote ${out}\n`);
      process.exitCode = report.checkpoints_ok === report.attempts ? 0 : 1;
      return;
    }
    if (cmd === 'validate-traces') {
      for (const flag of ['--scenario','--until-frame','--checkpoints','--stage-timing','--stage-id']) {
        if (hasFlag(argv,flag) && (argValue(argv,flag) == null || argValue(argv,flag).startsWith('--'))) throw new EvalError('SUBAGENT_INVALID',`${flag} requires a value`);
      }
      const options = { engine: argValue(argv, '--engine'), taskId: argValue(argv, '--task'),
        workspace: argValue(argv, '--workspace'), scenario: argValue(argv, '--scenario'), timingPath: argValue(argv, '--stage-timing'),
        untilFrame: argValue(argv, '--until-frame'), checkpoints: argValue(argv, '--checkpoints'), stageId: argValue(argv,'--stage-id') };
      const report = options.timingPath ? await validateStageTraces(options) : validateTraces(options);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    if (cmd === 'cancel-validation') {
      const report = await cancelStageValidation({ timingPath: argValue(argv,'--stage-timing'), sessionId: argValue(argv,'--session') });
      process.stdout.write(`${JSON.stringify(report)}\n`); return;
    }
    if (cmd === 'validation-budget') {
      const ctx = readStageContext(argValue(argv,'--stage-timing'));
      if (!['builder','debug'].includes(ctx.timing.role)) throw new EvalError('SUBAGENT_INVALID','budget planning belongs to a builder/debug stage');
      process.stdout.write(`${JSON.stringify(validationBudget(ctx,ctx.timing.taskId))}\n`); return;
    }
    if (cmd === 'publish-stage-response') {
      const input = argValue(argv, '--input');
      const timingPath = argValue(argv, '--stage-timing');
      if (!input || !timingPath) throw new EvalError('SUBAGENT_INVALID', '--input and --stage-timing are required');
      const result = publishStageResponse({ timingPath, data: JSON.parse(fs.readFileSync(input, 'utf8')),
        archivePath: argValue(argv, '--archive') });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    if (cmd === 'stage-replay') {
      const engine = argValue(argv, '--engine');
      const taskId = argValue(argv, '--task');
      const workspace = argValue(argv, '--workspace');
      const out = argValue(argv, '--out');
      const token = argValue(argv, '--token');
      const runId = argValue(argv, '--run-id');
      if (!engine || !taskId || !workspace || !out || !token || !runId) {
        throw new EvalError('EVAL_INTERNAL', 'stage-replay needs --engine --task --workspace --out --token --run-id');
      }
      const doc = runStageReplay({ engine, taskId, workspace, outPath: out, token, runId });
      process.stdout.write(`${JSON.stringify({ via: doc.via, primary: doc.primary, G: doc.G })}\n`);
      return;
    }
    if (cmd === 'run-oracle-gate') {
      const taskId = argValue(argv, '--task');
      if (!taskId) throw new EvalError('EVAL_INTERNAL', '--task required');
      const runId = argValue(argv, '--run-id') ?? `oracle-${taskId}`;
      const { rows, floor } = await runOracleGate({ taskId, runId });
      process.stdout.write(`${JSON.stringify({ floor, rows }, null, 2)}\n`);
      return;
    }
    if (cmd === 'run-product-100') {
      if (hasFlag(argv, '--looks') || hasFlag(argv, '--mech')) {
        throw new EvalError('EVAL_INTERNAL', 'run-product-100 一次跑完。不支持 --looks / --mech，也不保存机械结果供续评。');
      }
      const runId = argValue(argv, '--run-id') ?? `p100-${Date.now()}`;
      const { report, out, htmlPath } = await withCancellation(signal => runProduct100(runId, { signal }));
      process.stdout.write(`${JSON.stringify({ status: report.status, product_100: report.product_100, winner_engine: report.winner_engine, comparable: report.comparable, looks_phase: report.looks_phase, winner_sentence: report.winner_sentence }, null, 2)}\n`);
      process.stderr.write(`wrote ${out}\n`);
      if (htmlPath) process.stderr.write(`wrote ${htmlPath}\n`);
      process.exitCode = report.status === 'FAILED' ? 1 : 0;
      return;
    }
    if (cmd === 'rebuild-product-reports') {
      const runId = argValue(argv, '--run-id');
      if (!runId) throw new EvalError('EVAL_INTERNAL', '--run-id required');
      const { report, out, htmlPath, generationId, legacy } = rebuildProductReports(runId);
      process.stdout.write(`${JSON.stringify({ status: report.status, out, htmlPath, generation_id: generationId, legacy }, null, 2)}\n`);
      return;
    }
    if (cmd === 'emit-scoreboard') {
      const runId = argValue(argv, '--run-id');
      if (!runId) throw new EvalError('EVAL_INTERNAL', '--run-id required');
      const runDir = path.join(WORK_DIR, runId);
      const { htmlPath } = fs.existsSync(path.join(runDir, '.report-store'))
        ? rebuildProductReports(runId) : writeScoreboardFromRun(runDir);
      process.stdout.write(`${JSON.stringify({ htmlPath }, null, 2)}\n`);
      process.stderr.write(`wrote ${htmlPath}\n`);
      return;
    }
    if (cmd === 'looks-prompt') {
      const jobPath = argValue(argv, '--job');
      if (!jobPath) throw new EvalError('EVAL_INTERNAL', '--job required');
      const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
      process.stdout.write(`${buildLooksUserPrompt(job)}\n`);
      return;
    }
    if (cmd === 'apply-looks') {
      const verdictPath = argValue(argv, '--verdict');
      if (!verdictPath) throw new EvalError('EVAL_INTERNAL', '--verdict required');
      const parsed = parseLooksVerdict(fs.readFileSync(verdictPath, 'utf8'));
      const hasDepth = !hasFlag(argv, '--no-depth');
      const agg = aggregateLooks(parsed.scores, { hasDepth });
      process.stdout.write(`${JSON.stringify({ scores: parsed.scores, ...agg }, null, 2)}\n`);
      return;
    }
    if (cmd === 'test-negatives') {
      const out = runNegatives(argValue(argv, '--run-id') ?? `neg-${Date.now()}`);
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      const ok =
        out.argv_ms3008_rejected &&
        out.overall_rejected &&
        out.bindstore_empty &&
        out.bindstore_primary === 'BINDSTORE_EMPTY' &&
        out.hygiene_ok === 0;
      process.exitCode = ok ? 0 : 1;
      return;
    }
    process.stderr.write(
      `Usage: node src/cli.mjs run-oracles | run-task --task <id> [--oracle] | test-negatives | run-p1-compare | run-product-100 | run-oracle-gate --task <id> | validate-traces --engine <onegame|godot> --task <id> --workspace <dir> [--scenario <name>] [--until-frame <inclusive-frame>] [--checkpoints <frame,...>] [--stage-timing <json>] | cancel-validation --stage-timing <json> --session <id> | validation-budget --stage-timing <json> | publish-stage-response --stage-timing <json> --input <json> [--archive <json>] | stage-replay --engine <onegame|godot> --task <id> --workspace <dir> --out <REPLAY.json> --token <token> --run-id <id> | emit-scoreboard --run-id <id> | rebuild-product-reports --run-id <id> | looks-prompt --job <json> | apply-looks --verdict <json>\n`,
    );
    process.exitCode = 2;
  } catch (err) {
    process.stderr.write(`${err.primary ?? 'EVAL_INTERNAL'}: ${err.message}\n`);
    if (err.stack) process.stderr.write(`${err.stack}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] && path.normalize(process.argv[1]) === path.normalize(new URL(import.meta.url).pathname);
if (invoked) {
  await main();
}
