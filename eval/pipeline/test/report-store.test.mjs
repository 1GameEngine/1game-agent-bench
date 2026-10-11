import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initializeReportStore, commitReportCheckpoint, readReportCheckpoint, rebuildProductReports, createSuiteProgressWriter } from '../src/report-store.mjs';
import { buildProduct100, pendingRow, P1_TASKS } from '../src/product-100.mjs';
import { runProduct100 } from '../src/product-run.mjs';
import { runP1Compare } from '../src/p1-run.mjs';

const policy = { revision: 'execution-test/1', stage_budgets_ms: { builder: 1234 } };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (body) => createHash('sha256').update(body).digest('hex');

function fixture(t, runId = 'reports') {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-records-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  initializeReportStore(runId, { workDir, executionPolicy: policy });
  return { workDir, runId, dir: path.join(workDir, runId) };
}

function checkpoint(f, status = 'RUNNING', taskResults = {}, packs = []) {
  const rows = Object.keys(taskResults).flatMap(id => ['onegame', 'godot'].map(engine => pendingRow(id, engine, 'REPLAY_TIMEOUT')));
  const report = buildProduct100({ runId: f.runId, rows });
  report.status = status;
  report.stage_warnings = [{ engine: 'onegame', primary: 'STAGE_VALIDATION_INCOMPLETE' }];
  return commitReportCheckpoint(f.runId, { workDir: f.workDir, taskResults,
    input: { rows, packs }, reports: { 'PRODUCT_100.json': report,
      'COMPARE_SCALAR.json': { status, headline: '0/0' }, 'RUN_STATE.json': { status } } });
}

test('complete checkpoint is coherent and reconstruction preserves state, policy and immutable results', (t) => {
  const f = fixture(t);
  const first = checkpoint(f, 'RUNNING', { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'REPLAY_TIMEOUT' } });
  const taskPath = path.join(f.dir, 'tasks/p1-chart-rush/RESULT.json');
  const originalResult = fs.readFileSync(taskPath, 'utf8');
  const last = checkpoint(f, 'FAILED', { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'REPLAY_TIMEOUT' } });
  assert.notEqual(first.generation_id, last.generation_id);
  assert.equal(fs.readFileSync(taskPath, 'utf8'), originalResult);
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, last.generation_id);
  for (const name of ['PRODUCT_100.json', 'COMPARE_SCALAR.json', 'RUN_STATE.json']) {
    assert.equal(read(path.join(f.dir, name)).generation_id, last.generation_id);
    fs.writeFileSync(path.join(f.dir, name), '{broken');
  }
  fs.unlinkSync(taskPath);
  fs.unlinkSync(path.join(f.dir, 'report/index.html'));
  const result = rebuildProductReports(f.runId, f);
  assert.equal(result.report.status, 'FAILED');
  assert.equal(result.report.comparable, false);
  assert.deepEqual(result.report.product_100, { onegame: null, godot: null });
  assert.deepEqual(result.report.execution_policy, policy);
  assert.equal(result.report.execution_policy_revision, policy.revision);
  assert.equal(fs.readFileSync(taskPath, 'utf8'), originalResult);
  assert.equal(result.generationId, last.generation_id);
  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), new RegExp(last.generation_id));
  assert.deepEqual(result.report, last.reports['PRODUCT_100.json']);
});

test('unpublished generations and interrupted root projections cannot become completed suites', (t) => {
  const f = fixture(t);
  const accepted = checkpoint(f);
  const orphan = path.join(f.dir, '.report-store/generations/orphan');
  fs.mkdirSync(orphan);
  fs.writeFileSync(path.join(orphan, 'CHECKPOINT.json'), JSON.stringify({ ...accepted, status: 'COMPLETE' }));
  fs.writeFileSync(path.join(f.dir, 'PRODUCT_100.json'), JSON.stringify({ status: 'COMPLETE', generation_id: 'orphan' }));
  const result = rebuildProductReports(f.runId, f);
  assert.equal(result.report.status, 'RUNNING');
  assert.equal(result.generationId, accepted.generation_id);
  assert.equal(read(path.join(f.dir, 'RUN_STATE.json')).status, 'RUNNING');
  assert.equal(result.report.winner, false);
});

test('projection failure cannot change an already completed task identity in the failure checkpoint', (t) => {
  const f = fixture(t);
  const first = checkpoint(f);
  const html = path.join(f.dir, 'report/index.html');
  fs.unlinkSync(html);
  fs.mkdirSync(html);
  const tasks = { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'REPLAY_TIMEOUT' } };
  assert.throws(() => checkpoint(f, 'RUNNING', tasks));
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, first.generation_id);
  const taskFile = path.join(f.dir, 'tasks/p1-chart-rush/RESULT.json');
  const completed = fs.readFileSync(taskFile, 'utf8');
  fs.rmdirSync(html);
  const failed = checkpoint(f, 'FAILED', tasks);
  assert.equal(fs.readFileSync(taskFile, 'utf8'), completed);
  assert.equal(failed.status, 'FAILED');
  assert.equal(readReportCheckpoint(f.runId, f).status, 'FAILED');
});

test('corrupt canonical checkpoint is rejected before any root report is repaired', (t) => {
  const f = fixture(t);
  const record = checkpoint(f);
  const rootReport = fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8');
  fs.appendFileSync(path.join(f.dir, '.report-store/generations', record.generation_id, 'CHECKPOINT.json'), ' ');
  assert.throws(() => rebuildProductReports(f.runId, f), err => err.primary === 'EVAL_REPORT_INVALID');
  assert.equal(fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8'), rootReport);
});

test('run-id reuse preserves old files and rejects unsafe destinations', (t) => {
  const f = fixture(t);
  checkpoint(f);
  const before = fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8');
  assert.throws(() => initializeReportStore(f.runId, f), err => err.primary === 'RUN_ALREADY_EXISTS');
  assert.equal(fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8'), before);
  assert.throws(() => initializeReportStore('../escape', f), err => err.primary === 'EVAL_REPORT_INVALID');
  assert.throws(() => initializeReportStore('.', f), err => err.primary === 'EVAL_REPORT_INVALID');
});

test('completed task records and terminal runs cannot be changed or resumed', (t) => {
  const f = fixture(t);
  checkpoint(f, 'RUNNING', { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'REPLAY_TIMEOUT' } });
  assert.throws(() => checkpoint(f, 'RUNNING', { 'p1-chart-rush': { taskId: 'p1-chart-rush', primary: 'TRACE_OK' } }), err => err.primary === 'EVAL_REPORT_INVALID');
  assert.equal(readReportCheckpoint(f.runId, f).task_results['p1-chart-rush'].primary, 'REPLAY_TIMEOUT');
  checkpoint(f, 'COMPLETE');
  assert.throws(() => checkpoint(f), err => err.primary === 'EVAL_REPORT_INVALID');
});

test('a legacy report is only rendered and its historical JSON bytes remain unchanged', (t) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-reports-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const dir = path.join(workDir, 'legacy');
  fs.mkdirSync(dir);
  const report = { ...buildProduct100({ runId: 'legacy', rows: [] }), scoring_policy_revision: 'historical-revision', custom_historical_field: true };
  const bytes = ` ${JSON.stringify(report)}\n`;
  fs.writeFileSync(path.join(dir, 'PRODUCT_100.json'), bytes);
  const result = rebuildProductReports('legacy', { workDir });
  assert.equal(result.legacy, true);
  assert.equal(result.report.scoring_policy_revision, 'historical-revision');
  assert.equal(fs.readFileSync(path.join(dir, 'PRODUCT_100.json'), 'utf8'), bytes);
  assert.equal(fs.existsSync(path.join(dir, '.report-store')), false);
  assert.ok(fs.existsSync(result.htmlPath));
  assert.throws(() => rebuildProductReports('missing', { workDir }), err => err.primary === 'EVAL_REPORT_UNSUPPORTED');
});

test('reconstruction restores archived evidence after the live source is changed or deleted', (t) => {
  const f = fixture(t);
  const png = path.join(f.workDir, 'evidence.png');
  fs.writeFileSync(png, 'preserved-png');
  const packs = [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png, sha256: hash('preserved-png') }] } }];
  const first = checkpoint(f, 'RUNNING', {}, packs);
  assert.equal(first.evidence_manifest.length, 1);
  assert.equal(first.evidence_manifest[0].sha256, hash('preserved-png'));
  const target = path.join(f.dir, 'report/stills/p1-chart-rush__onegame__intro_f0.png');
  fs.writeFileSync(png, 'changed-live-source');
  const later = checkpoint(f, 'FAILED', {}, packs);
  assert.deepEqual(later.evidence_manifest, first.evidence_manifest);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved-png');
  fs.unlinkSync(png);
  fs.unlinkSync(target);
  rebuildProductReports(f.runId, f);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved-png');
});

test('declared source digest must match before evidence or report publication', (t) => {
  const f = fixture(t);
  const first = checkpoint(f);
  const before = fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8');
  const png = path.join(f.workDir, 'evidence.png');
  fs.writeFileSync(png, 'actual-source');
  assert.throws(() => checkpoint(f, 'RUNNING', {}, [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png, sha256: hash('different-source') }] } }]),
    err => err.primary === 'EVAL_REPORT_EVIDENCE_INVALID');
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, first.generation_id);
  assert.equal(fs.readFileSync(path.join(f.dir, 'PRODUCT_100.json'), 'utf8'), before);
});

test('corrupt or missing archived evidence fails reconstruction before altering root outputs', (t) => {
  const f = fixture(t);
  const png = path.join(f.workDir, 'evidence.png');
  fs.writeFileSync(png, 'archive-original');
  const record = checkpoint(f, 'FAILED', {}, [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png }] } }]);
  const archive = path.join(f.dir, '.report-store', record.evidence_manifest[0].archive_path);
  const rootReport = path.join(f.dir, 'PRODUCT_100.json');
  const rootImage = path.join(f.dir, 'report/stills/p1-chart-rush__onegame__intro_f0.png');
  fs.writeFileSync(rootReport, 'keep-existing-report');
  fs.writeFileSync(rootImage, 'keep-existing-image');
  fs.writeFileSync(archive, 'corrupted-archive');
  assert.throws(() => rebuildProductReports(f.runId, f), err => err.primary === 'EVAL_REPORT_EVIDENCE_INVALID');
  assert.equal(fs.readFileSync(rootReport, 'utf8'), 'keep-existing-report');
  assert.equal(fs.readFileSync(rootImage, 'utf8'), 'keep-existing-image');
  fs.unlinkSync(archive);
  assert.throws(() => rebuildProductReports(f.runId, f), err => err.primary === 'EVAL_REPORT_EVIDENCE_INVALID');
  assert.equal(fs.readFileSync(rootReport, 'utf8'), 'keep-existing-report');
  assert.equal(fs.readFileSync(rootImage, 'utf8'), 'keep-existing-image');
});

test('a later checkpoint cannot change the digest associated with a completed image identity', (t) => {
  const f = fixture(t);
  const png = path.join(f.workDir, 'evidence.png');
  fs.writeFileSync(png, 'old-image');
  const first = checkpoint(f, 'RUNNING', {}, [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png }] } }]);
  fs.writeFileSync(png, 'new-image');
  assert.throws(() => checkpoint(f, 'RUNNING', {}, [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png, sha256: hash('new-image') }] } }]),
    err => err.primary === 'EVAL_REPORT_EVIDENCE_INVALID');
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, first.generation_id);
});

test('unsafe evidence paths in a digest-valid checkpoint still cannot escape the archive', (t) => {
  const f = fixture(t);
  const png = path.join(f.workDir, 'evidence.png');
  fs.writeFileSync(png, 'source');
  const record = checkpoint(f, 'RUNNING', {}, [{ id: 'p1-chart-rush', og: { stills: [{ id: 'intro_f0', path: png }] } }]);
  const checkpointFile = path.join(f.dir, '.report-store/generations', record.generation_id, 'CHECKPOINT.json');
  const pointerFile = path.join(f.dir, '.report-store/LATEST.json');
  record.evidence_manifest[0].archive_path = '../outside.png';
  const body = JSON.stringify(record);
  fs.writeFileSync(checkpointFile, body);
  const pointer = read(pointerFile);
  pointer.sha256 = hash(body);
  fs.writeFileSync(pointerFile, JSON.stringify(pointer));
  assert.throws(() => rebuildProductReports(f.runId, f), err => err.primary === 'EVAL_REPORT_EVIDENCE_INVALID');
});

test('stage progress is immediately observable without changing the score checkpoint', (t) => {
  const f = fixture(t);
  const accepted = checkpoint(f);
  const observe = createSuiteProgressWriter(f.runId, f);
  const event = { schema: 'eval.stage-event/1', stage_id: 'stage-a', run_id: 'reports-p1-chart-rush', engine: 'onegame',
    task_id: 'p1-chart-rush', role: 'builder', state: 'RUNNING', attempt: 1, observed_at: '2026-10-11T10:00:00Z' };
  observe(event);
  observe({ ...event, state: 'WARNING', primary: 'STAGE_VALIDATION_INCOMPLETE' });
  const progress = read(path.join(f.dir, 'STAGE_PROGRESS.json'));
  assert.equal(progress.observational_only, true);
  assert.equal(progress.stages.length, 1);
  assert.equal(progress.stages[0].state, 'WARNING');
  assert.equal(progress.stages[0].suite_run_id, f.runId);
  assert.equal(fs.readFileSync(path.join(f.dir, 'STAGE_PROGRESS.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(readReportCheckpoint(f.runId, f).generation_id, accepted.generation_id);
  assert.equal(read(path.join(f.dir, 'PRODUCT_100.json')).status, 'RUNNING');
});

test('compare suite records task results and preserves completed tasks on interruption', async (t) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-report-store-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(runP1Compare('compare', { workDir, signal: controller.signal, orchestrate: async ({ taskId, signal }) => {
    assert.equal(signal, controller.signal);
    calls++;
    controller.abort();
    return { failures: [], warnings: [], onegame: { replay: { attempt: { id: taskId, engine: 'onegame', primary: 'TRACE_OK', g0_ok: 1 } } },
      godot: { replay: { attempt: { id: taskId, engine: 'godot', primary: 'TRACE_OK', g0_ok: 1 } } } };
  } }), err => err.primary === 'SUBAGENT_PROCESS_FAILED');
  assert.equal(calls, 1);
  const record = readReportCheckpoint('compare', { workDir });
  assert.equal(record.status, 'FAILED');
  assert.equal(record.reports['COMPARE_SCALAR.json'].headline, '2/2');
  assert.equal(record.reports['RUN_STATE.json'].completed_task_count, 1);
  assert.equal(Object.keys(record.task_results)[0], P1_TASKS[0]);
  assert.throws(() => rebuildProductReports('compare', { workDir }), err => err.primary === 'EVAL_REPORT_UNSUPPORTED');
});

test('pre-aborted product suite records FAILED without dispatching an agent', async (t) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-report-abort-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const previous = process.env.EVAL_CLOUD_AGENT_SUBAGENT;
  process.env.EVAL_CLOUD_AGENT_SUBAGENT = '1';
  try {
    await assert.rejects(runProduct100('aborted', { workDir, signal: AbortSignal.abort(),
      orchestrate: () => assert.fail('must not dispatch') }), err => err.primary === 'SUBAGENT_PROCESS_FAILED');
    const result = rebuildProductReports('aborted', { workDir });
    assert.equal(result.report.status, 'FAILED');
    assert.equal(result.report.completed_task_count, 0);
    assert.equal(result.report.failures[0].primary, 'SUBAGENT_PROCESS_FAILED');
    assert.equal(result.report.winner, false);
  } finally {
    if (previous === undefined) delete process.env.EVAL_CLOUD_AGENT_SUBAGENT;
    else process.env.EVAL_CLOUD_AGENT_SUBAGENT = previous;
  }
});
