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
import { runProduct100 } from './product-run.mjs';
import { writeScoreboardFromRun } from './scoreboard.mjs';
import { aggregateLooks, buildLooksUserPrompt, parseLooksVerdict } from './looks-rubric.mjs';

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function hasFlag(argv, name) {
  return argv.includes(name);
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

export function runOracles(suiteRunId = `oracle-${Date.now()}`) {
  loadSuite();
  const rows = [];
  for (const taskId of ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play']) {
    const row = runTask({ taskId, runId: `${suiteRunId}-${taskId}`, oracle: true });
    rows.push(row);
    process.stderr.write(
      `oracle ${taskId}: create=${row.create_ok} replay=${row.replay_ok} store=${row.store_match} argv=${row.argv_ok} hygiene=${row.hygiene_ok}\n`,
    );
    if (row.notes?.length) process.stderr.write(`  notes: ${row.notes.join(' | ')}\n`);
  }
  const report = buildReport({ runId: suiteRunId, taskRows: rows });
  fs.mkdirSync(path.join(WORK_DIR, suiteRunId), { recursive: true });
  const out = path.join(WORK_DIR, suiteRunId, 'P0_report.json');
  writeReport(out, report);
  return { report, out };
}

export function auditBadTickFixture() {
  const badPlan = JSON.parse(
    fs.readFileSync(path.join(EVAL_DIR, 'examples', 'negatives', 'bad-tick-dt', 'playplan.json'), 'utf8'),
  );
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
  fs.copyFileSync(
    path.join(EVAL_DIR, 'examples', 'negatives', 'no-bindstore', 'src', 'game.tsx'),
    path.join(gameDir(runId), 'src', 'game.tsx'),
  );
  const nobind = replayJudgeHygiene({ gameDir: gameDir(runId), bundle });

  const hygRun = `${suiteRunId}-hygiene`;
  bootstrap({ taskId, runId: hygRun, instruction: bundle.instruction, oracle: true });
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
      const { report, out } = await runP1Compare(argValue(argv, '--run-id') ?? `p1-${Date.now()}`);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(`wrote ${out}\n`);
      process.exitCode = report.checkpoints_ok === report.attempts ? 0 : 1;
      return;
    }
    if (cmd === 'run-product-100') {
      if (hasFlag(argv, '--looks') || hasFlag(argv, '--mech')) {
        throw new EvalError('EVAL_INTERNAL', 'run-product-100 一次跑完。不支持 --looks / --mech，也不保存机械结果供续评。');
      }
      const runId = argValue(argv, '--run-id') ?? `p100-${Date.now()}`;
      const { report, out, htmlPath } = await runProduct100(runId);
      process.stdout.write(`${JSON.stringify({ product_100: report.product_100, winner_engine: report.winner_engine, comparable: report.comparable, looks_phase: report.looks_phase, winner_sentence: report.winner_sentence }, null, 2)}\n`);
      process.stderr.write(`wrote ${out}\n`);
      if (htmlPath) process.stderr.write(`wrote ${htmlPath}\n`);
      process.exitCode = 0;
      return;
    }
    if (cmd === 'emit-scoreboard') {
      const runId = argValue(argv, '--run-id');
      if (!runId) throw new EvalError('EVAL_INTERNAL', '--run-id required');
      const { htmlPath } = writeScoreboardFromRun(path.join(WORK_DIR, runId));
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
      `Usage: node src/cli.mjs run-oracles | run-task --task <id> [--oracle] | test-negatives | run-p1-compare | run-product-100 | emit-scoreboard --run-id <id> | looks-prompt --job <json> | apply-looks --verdict <json>\n`,
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
