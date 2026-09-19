import fs from 'node:fs';
import { DIMENSIONS, P0_NOTICE, PIN } from './paths.mjs';
import { assertNoForbiddenScoreKeys, EvalError } from './util.mjs';
import { primaryOf, taskPassed } from './verdict.mjs';

export function buildReport({ runId, taskRows }) {
  const tasks = taskRows.map((row) => {
    const item = {
      id: row.id,
      primary: primaryOf(row),
      create_ok: row.create_ok,
      replay_ok: row.replay_ok,
      store_match: row.store_match,
      argv_ok: row.argv_ok,
      hygiene_ok: row.hygiene_ok,
    };
    if (row.notes?.length) item.notes = row.notes;
    return item;
  });
  const report = {
    schema: 'eval.verdict/1',
    suite_id: 'eval-spec/1',
    report_id: `P0_${runId}`,
    headline_track: 'none',
    p0_in_headline: false,
    comparable_to_godot: false,
    notice: P0_NOTICE,
    npm_train: PIN,
    passed_tasks: tasks.filter((t) => taskPassed(t)).length,
    task_count: 4,
    dimensions: [...DIMENSIONS],
    tasks,
  };
  assertNoForbiddenScoreKeys(report);
  if ('overall' in report || 'total_score' in report) {
    throw new EvalError('EVAL_INTERNAL', 'report grew an overall/total_score field');
  }
  return report;
}

export function writeReport(file, report) {
  assertNoForbiddenScoreKeys(report);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}
