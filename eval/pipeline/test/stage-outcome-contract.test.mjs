import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageOutcome, StageRecorder } from '../src/stage-records.mjs';
import { executionPolicy, EXECUTION_POLICY_REVISION } from '../src/execution-policy.mjs';
import { stageResponseError } from '../src/stage-result.mjs';
import { buildProduct100, pendingRow, scoreAttempt, SUITE_TASKS } from '../src/product-100.mjs';

test('truthful negative self-check receipts complete execution without declaring a pass', () => {
  for (const role of ['builder', 'debug']) {
    for (const [kind, selfCheck] of [['validation_incomplete', 'INCOMPLETE'], ['game_validation_failed', 'REPORTED_FAIL']]) {
      const error = stageResponseError({ role, engine: 'onegame', taskId: SUITE_TASKS[0] },
        { stdout: '', exitCode: 1, failure: { kind, message: 'Actual self-check diagnostic' } });
      const outcome = stageOutcome({ role, error });
      assert.equal(outcome.execution_status, 'COMPLETED');
      assert.equal(outcome.self_check_status, selfCheck);
      assert.equal(outcome.evidence_status, 'NOT_APPLICABLE');
    }
  }
});

test('timeout and broken handoff cannot be reclassified as a self-check warning or scored zero', () => {
  const rows = SUITE_TASKS.flatMap(id => ['onegame', 'godot'].map(engine =>
    scoreAttempt({ id, engine, G: 1, M: 1, D: 1, V: 1, A: 1,
      primary: 'TRACE_OK', looks_status: 'OK', looks_source: 'subagent' })));
  for (const primary of ['BUILDER_TIMEOUT', 'BUILDER_DISPATCH_TIMEOUT', 'SUBAGENT_INVALID', 'SUBAGENT_PROCESS_FAILED']) {
    const error = { primary };
    const outcome = stageOutcome({ role: 'builder', error });
    assert.equal(outcome.execution_status, primary.endsWith('TIMEOUT') ? 'TIMED_OUT' : 'FAILED');
    assert.equal(outcome.self_check_status, 'UNAVAILABLE');
    const blocked = [...rows];
    blocked[0] = pendingRow(SUITE_TASKS[0], 'onegame', primary, error);
    const report = buildProduct100({ runId: 'outcome-contract', rows: blocked });
    assert.equal(report.tasks[0].G, null);
    assert.equal(report.tasks[0].product_100, null);
    assert.deepEqual(report.product_100, { onegame: null, godot: null });
    assert.equal(report.winner_engine, 'incomparable');
  }
});

test('completed looks execution can still have incomplete evidence', () => {
  const outcome = stageOutcome({ role: 'looks', evidenceStatus: 'INCOMPLETE' });
  assert.equal(outcome.execution_status, 'COMPLETED');
  assert.equal(outcome.self_check_status, 'NOT_APPLICABLE');
  assert.equal(outcome.evidence_status, 'INCOMPLETE');
  const row = scoreAttempt({ id: SUITE_TASKS[0], engine: 'onegame', G: 1,
    primary: 'TRACE_OK', looks_status: 'EVIDENCE_INCOMPLETE', looks_source: 'subagent' });
  assert.equal(row.G, 1);
  assert.equal(row.product_100, null);
});

test('builder success is a reported self-check pass, not independent certification', () => {
  const outcome = stageOutcome({ role: 'builder' });
  assert.equal(outcome.execution_status, 'COMPLETED');
  assert.equal(outcome.self_check_status, 'REPORTED_PASS');
  assert.equal(outcome.evidence_status, 'NOT_APPLICABLE');
});

test('terminal stage records preserve accepted publication time and cannot be revised', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-stage-contract-'));
  let current = Date.parse('2026-10-11T09:00:00.000Z');
  try {
    const recorder = new StageRecorder({ dir, runId: 'contract-run', engine: 'onegame',
      taskId: SUITE_TASKS[0], now: () => current });
    const handle = recorder.begin('builder', { attempt: 2 });
    const published = '2026-10-11T09:09:59.000Z';
    const observed = '2026-10-11T09:10:01.000Z';
    current = Date.parse(observed);
    recorder.lifecycle(handle, { schema: 'eval.cloud-stage-timing/1', id: 'transport-request', role: 'builder',
      engine: 'onegame', taskId: SUITE_TASKS[0], state: 'FAILED', response_published_at: published,
      response_observed_at: observed, finished_at: published });
    const error = stageResponseError({ role: 'builder', engine: 'onegame', taskId: SUITE_TASKS[0] },
      { stdout: '', exitCode: 1, failure: { kind: 'validation_incomplete', message: 'One scenario unfinished' } });
    const final = recorder.finish(handle, { error, submissionId: 'observed-submission' });
    assert.equal(final.state, 'COMPLETE');
    assert.equal(final.schema, 'eval.stage-record/1');
    assert.equal(final.id, handle.id);
    assert.equal(final.execution_status, 'COMPLETED');
    assert.equal(final.self_check_status, 'INCOMPLETE');
    assert.equal(final.finished_at, published);
    assert.equal(final.response_observed_at, observed);
    assert.equal(final.execution_policy_revision, EXECUTION_POLICY_REVISION);
    assert.equal(final.attempt, 2);
    assert.equal(final.submission_id, 'observed-submission');
    const bytes = fs.readFileSync(final.record_path);
    assert.throws(() => recorder.finish(handle), error => error.primary === 'EVAL_INTERNAL');
    assert.throws(() => recorder.lifecycle(handle, { state: 'RUNNING' }), error => error.primary === 'EVAL_INTERNAL');
    assert.deepEqual(fs.readFileSync(final.record_path), bytes);
    const events = fs.readFileSync(path.join(dir, 'STAGE_EVENTS.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.state), ['QUEUED', 'FAILED', 'COMPLETE']);
    assert.ok(events.every(event => event.schema === 'eval.stage-event/1' && event.stage_id === handle.id));
    assert.equal(events.at(-1).finished_at, published);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('execution policy describes existing budgets and explicitly disclaims resource isolation', () => {
  const policy = executionPolicy({});
  assert.equal(policy.revision, 'eval.execution/2');
  assert.deepEqual(policy.stage_budgets_ms, { builder: 600000, debug: 600000, replay: 1800000, looks: 600000 });
  assert.equal(policy.dispatch_budget_ms, 600000);
  assert.equal(policy.timing.self_validation, 'inside_model_budget');
  assert.equal(policy.timing.model_completion, 'atomic_response_publication');
  assert.equal(policy.recovery, 'reports_only_no_stage_resume');
  assert.equal(policy.submission_policy, 'observational_manifests_no_new_acceptance_gate');
  for (const key of ['validation_concurrency_limit', 'cross_suite_concurrency_limit', 'cpu_limit', 'memory_limit_bytes']) {
    assert.equal(policy.scheduling[key], null);
  }
  const customized = executionPolicy({ EVAL_SUBAGENT_TIMEOUT_MS: '10000', EVAL_BUILDER_TIMEOUT_MS: '2000' });
  assert.equal(customized.stage_budgets_ms.builder, 2000);
  assert.equal(customized.stage_budgets_ms.replay, 10000);
  assert.equal(customized.dispatch_budget_ms, 600000);
  assert.equal(customized.timing.wrap_up_reserve_ms.builder, 200);
  for (const bad of ['0', '-1', '1.5', 'NaN', '2147483648']) {
    assert.throws(() => executionPolicy({ EVAL_BUILDER_TIMEOUT_MS: bad }), error => error.primary === 'EVAL_INTERNAL');
  }
});
