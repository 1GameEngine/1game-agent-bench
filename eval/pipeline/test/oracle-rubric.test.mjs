import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadP1Task } from '../src/p1-load.mjs';
import { buildChartOracleTraces, rubricWitnessIssues } from '../src/chart-oracle.mjs';
import { auditTrace, readTraces } from '../src/p1-trace.mjs';
import { oracleGodot } from '../src/paths.mjs';
import { godotBin, judgeTraceEvents, makeTraceJob, runGodotJob, stageGodotProject } from '../src/p1-godot.mjs';

test('chart oracle traces cover every rubric item scenario', () => {
  const bundle = loadP1Task('p1-chart-rush');
  const expected = buildChartOracleTraces();
  const dir = path.join(oracleGodot('p1-chart-rush'), 'demo_outputs');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  assert.deepEqual(
    files.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))),
    expected,
  );
  const traces = expected.map((trace) => ({ trace, audit: auditTrace(trace) }));
  assert.deepEqual(rubricWitnessIssues({ rubric: bundle.rubric, traces }), []);
  for (const item of traces) assert.equal(item.audit.ok, true, item.audit.issues.join(','));
});

test('chart oracle replay stills witness every rubric item', { timeout: 180_000 }, (t) => {
  const bin = godotBin();
  if (!fs.existsSync(bin)) {
    t.skip('Godot 4.4.1 binary is not installed');
    return;
  }
  const bundle = loadP1Task('p1-chart-rush');
  const runId = `oracle-witness-${process.pid}`;
  const staged = stageGodotProject({
    taskId: 'p1-chart-rush',
    runId,
    srcDir: oracleGodot('p1-chart-rush'),
  });
  assert.equal(staged.tamper, false);
  assert.deepEqual(staged.leak, []);
  const traces = readTraces(path.join(staged.dest, 'demo_outputs'));
  const stillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-oracle-stills-'));
  const outPath = path.join(stillsDir, 'events.jsonl');
  const job = runGodotJob({
    projectDir: staged.dest,
    job: makeTraceJob({ traces, stillsDir }),
    outPath,
    timeoutMs: 180_000,
  });
  const judged = judgeTraceEvents(job.events || [], stillsDir);
  assert.equal(job.ok, true, `${judged.primary} ${(job.notes || []).join('; ')} ${(judged.notes || []).join('; ')}`);
  assert.equal(judged.g0_ok, 1);
  assert.deepEqual(judged.samples, []);
  assert.deepEqual(
    rubricWitnessIssues({ rubric: bundle.rubric, traces, stills: judged.stills }),
    [],
  );
});
