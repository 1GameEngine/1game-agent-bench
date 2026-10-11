import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { WORK_DIR } from './paths.mjs';
import { writeReport } from './report.mjs';
import { buildScoreboardView, renderScoreboardHtml, packSides, writeScoreboardFromRun } from './scoreboard.mjs';
import { EvalError } from './util.mjs';

const STORE = '.report-store';
const SCHEMA = 'eval.report-checkpoint/1';
const REPORT_NAMES = new Set(['PRODUCT_100.json', 'COMPARE_SCALAR.json', 'P0_report.json', 'RUN_STATE.json']);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (body) => createHash('sha256').update(body).digest('hex');

function component(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new EvalError('EVAL_REPORT_INVALID', 'report ids must be single safe path components');
  }
  return value;
}

function locations(runId, workDir) {
  const dir = path.join(workDir, component(runId));
  return { dir, store: path.join(dir, STORE) };
}

function atomicText(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, body, { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

function withProjectionLock(store, operation) {
  const file = path.join(store, 'projection.lock');
  let fd;
  try {
    // Keep one permanent inode. flock owns the shared open-file description
    // inherited as fd 3, so its lock survives the helper's exit until we close
    // our fd. The kernel releases it on a crash, including before any metadata
    // could be written; no PID probing or competing unlink/reclaim is needed.
    if (process.platform !== 'linux') throw new EvalError('EVAL_REPORT_LOCK_FAILED', 'report locking requires Linux flock');
    fd = fs.openSync(file, 'a+');
    const lock = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8', timeout: 1000,
      killSignal: 'SIGKILL', maxBuffer: 4096,
    });
    if (!lock.error && lock.status === 1) throw new EvalError('EVAL_REPORT_BUSY', 'report projection is already active');
    if (lock.error || lock.status !== 0) {
      throw new EvalError('EVAL_REPORT_LOCK_FAILED', `cannot acquire report lock: ${lock.error?.message ?? lock.stderr ?? lock.signal}`);
    }
    return operation();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function initializeReportStore(runId, { workDir = WORK_DIR, kind = 'product', executionPolicy } = {}) {
  const { dir, store } = locations(runId, workDir);
  if (!['product', 'compare'].includes(kind)) throw new EvalError('EVAL_REPORT_INVALID', 'unsupported report store kind');
  fs.mkdirSync(workDir, { recursive: true });
  try { fs.mkdirSync(dir); }
  catch (err) {
    if (err.code === 'EEXIST') throw new EvalError('RUN_ALREADY_EXISTS', `run-id already exists: ${runId}; use a new run-id`);
    throw err;
  }
  fs.mkdirSync(store);
  const metadata = { schema: 'eval.report-store/1', run_id: runId, kind, created_at: new Date().toISOString(), execution_policy: executionPolicy };
  fs.writeFileSync(path.join(store, 'STORE.json'), json(metadata), { flag: 'wx' });
  return metadata;
}

export function readReportCheckpoint(runId, { workDir = WORK_DIR } = {}) {
  const { store } = locations(runId, workDir);
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(store, 'LATEST.json'), 'utf8'));
    if (pointer.schema !== 'eval.report-pointer/1') throw new Error('unknown checkpoint pointer');
    const generation = component(pointer.generation_id);
    const body = fs.readFileSync(path.join(store, 'generations', generation, 'CHECKPOINT.json'), 'utf8');
    if (pointer.sha256 !== digest(body)) throw new Error('checkpoint digest mismatch');
    const record = JSON.parse(body);
    if (record.schema !== SCHEMA || record.run_id !== runId || record.generation_id !== generation ||
        !['product', 'compare'].includes(record.kind) || !['RUNNING', 'COMPLETE', 'FAILED'].includes(record.status) ||
        !record.reports || Object.values(record.reports).some((r) => r.generation_id !== generation || r.status && r.status !== record.status)) {
      throw new Error('checkpoint identity or state mismatch');
    }
    return record;
  } catch (err) {
    if (err instanceof EvalError) throw err;
    throw new EvalError('EVAL_REPORT_INVALID', `cannot read complete checkpoint for ${runId}: ${err.message}`);
  }
}

export function createSuiteProgressWriter(runId, { workDir = WORK_DIR } = {}) {
  const { dir, store } = locations(runId, workDir);
  const metadata = JSON.parse(fs.readFileSync(path.join(store, 'STORE.json'), 'utf8'));
  const stages = Object.create(null);
  return (event) => {
    if (event?.schema !== 'eval.stage-event/1' || typeof event.stage_id !== 'string' || !event.stage_id) {
      throw new EvalError('EVAL_REPORT_INVALID', 'invalid observed stage event');
    }
    const observed = { ...event, suite_run_id: runId };
    fs.appendFileSync(path.join(dir, 'STAGE_PROGRESS.jsonl'), `${JSON.stringify(observed)}\n`);
    stages[event.stage_id] = { ...(stages[event.stage_id] ?? {}), ...observed };
    writeReport(path.join(dir, 'STAGE_PROGRESS.json'), { schema: 'eval.suite-stage-progress/1', run_id: runId,
      execution_policy_revision: metadata.execution_policy?.revision, updated_at: event.observed_at,
      observational_only: true, stages: Object.values(stages) });
  };
}

function evidenceError(message) { return new EvalError('EVAL_REPORT_EVIDENCE_INVALID', message); }

function evidenceTarget({ task_id, engine, still_id }) {
  try { return `${component(task_id)}__${component(engine)}__${component(still_id)}.png`; }
  catch { throw evidenceError('evidence identity contains an unsafe path component'); }
}

function evidenceEntries(manifest) {
  if (!Array.isArray(manifest)) throw evidenceError('checkpoint has no archived evidence manifest');
  const entries = new Map();
  for (const entry of manifest) {
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') ||
        entry.archive_path !== `evidence/${entry.sha256}.png` || entry.target_filename !== evidenceTarget(entry) ||
        entries.has(entry.target_filename)) {
      throw evidenceError('evidence manifest has an invalid path, digest or duplicate identity');
    }
    entries.set(entry.target_filename, entry);
  }
  return entries;
}

function readArchivedEvidence(entry, store) {
  const file = path.join(store, entry.archive_path);
  try {
    const evidenceDir = fs.lstatSync(path.join(store, 'evidence'));
    const stat = fs.lstatSync(file);
    if (!evidenceDir.isDirectory() || evidenceDir.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('archive is not a regular stored file');
    }
    const body = fs.readFileSync(file);
    if (digest(body) !== entry.sha256) throw new Error('archive digest mismatch');
    return body;
  } catch (err) { throw evidenceError(`cannot verify archived evidence ${entry.target_filename}: ${err.message}`); }
}

function validateArchivedEvidence(manifest, store) {
  const entries = evidenceEntries(manifest);
  const bytes = new Map();
  for (const entry of entries.values()) {
    if (!bytes.has(entry.sha256)) bytes.set(entry.sha256, readArchivedEvidence(entry, store));
  }
  return { entries, bytes };
}

function archiveEvidence(input, previous, store) {
  const prior = previous ? validateArchivedEvidence(previous.evidence_manifest, store).entries : new Map();
  const entries = new Map(prior);
  for (const pack of input.packs ?? []) {
    for (const side of packSides(pack)) {
      for (const still of side.stills ?? []) {
        if (!still?.id || !still.path) continue;
        const identity = { task_id: pack.id, engine: side.engine, still_id: still.id };
        const target = evidenceTarget(identity);
        let declared;
        if (still.sha256 !== undefined) {
          if (typeof still.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(still.sha256)) throw evidenceError(`invalid declared digest: ${target}`);
          declared = still.sha256.toLowerCase();
        }
        const existing = entries.get(target);
        if (prior.has(target)) {
          if (declared && declared !== existing.sha256) throw evidenceError(`completed evidence identity cannot change: ${target}`);
          continue;
        }
        let body;
        try { body = fs.readFileSync(still.path); }
        catch (err) { throw evidenceError(`cannot archive source evidence ${target}: ${err.message}`); }
        const hash = digest(body);
        if (declared && declared !== hash) throw evidenceError(`source evidence digest mismatch: ${target}`);
        if (existing) {
          if (existing.sha256 !== hash) throw evidenceError(`duplicate evidence identity has different bytes: ${target}`);
          continue;
        }
        const entry = { ...identity, sha256: hash, archive_path: `evidence/${hash}.png`, target_filename: target };
        const dest = path.join(store, entry.archive_path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(dest)) readArchivedEvidence(entry, store);
        else {
          const temp = `${dest}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
          try {
            fs.writeFileSync(temp, body, { flag: 'wx' });
            // Hard-link publication refuses to replace an existing archive.
            try { fs.linkSync(temp, dest); }
            catch (err) { if (err.code !== 'EEXIST') throw err; readArchivedEvidence(entry, store); }
          } finally { fs.rmSync(temp, { force: true }); }
        }
        entries.set(target, entry);
      }
    }
  }
  return [...entries.values()];
}

function project(record, dir, { repair = false } = {}) {
  // Read and verify every image before modifying reports or evidence copies.
  // Keeping verified bytes also closes the gap between verification and copy.
  const evidence = validateArchivedEvidence(record.evidence_manifest, path.join(dir, STORE));
  // The root files are compatibility projections, not a multi-file transaction.
  // Readers needing one coherent generation use readReportCheckpoint().
  for (const [name, report] of Object.entries(record.reports)) {
    if (!REPORT_NAMES.has(name)) throw new EvalError('EVAL_REPORT_INVALID', 'unknown report projection');
    writeReport(path.join(dir, name), report);
  }
  for (const [taskId, result] of Object.entries(record.task_results)) {
    const file = path.join(dir, 'tasks', component(taskId), 'RESULT.json');
    if (fs.existsSync(file)) {
      if (repair) {
        // Rebuild repairs this compatibility projection, never the immutable
        // completed-tasks record or the accepted checkpoint it was derived from.
        atomicText(file, json(result));
      } else if (json(JSON.parse(fs.readFileSync(file, 'utf8'))) !== json(result)) {
        throw new EvalError('EVAL_REPORT_INVALID', `completed task result cannot be overwritten: ${taskId}`);
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      atomicText(file, json(result));
    }
  }
  if (record.scoreboard_view) {
    const stillsDir = path.join(dir, 'report', 'stills');
    fs.mkdirSync(stillsDir, { recursive: true });
    for (const entry of evidence.entries.values()) {
      atomicText(path.join(stillsDir, entry.target_filename), evidence.bytes.get(entry.sha256));
    }
    atomicText(path.join(dir, 'report', 'index.html'), renderScoreboardHtml(record.scoreboard_view));
  }
}

export function commitReportCheckpoint(runId, { workDir = WORK_DIR, input = {}, reports, taskResults = {} } = {}) {
  const { dir, store } = locations(runId, workDir);
  return withProjectionLock(store, () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(store, 'STORE.json'), 'utf8'));
    if (metadata.schema !== 'eval.report-store/1' || metadata.run_id !== runId) throw new EvalError('EVAL_REPORT_INVALID', 'report store identity mismatch');
    const previous = fs.existsSync(path.join(store, 'LATEST.json')) ? readReportCheckpoint(runId, { workDir }) : null;
    if (previous && previous.status !== 'RUNNING') throw new EvalError('EVAL_REPORT_INVALID', 'a terminal suite cannot be resumed or overwritten');
    const status = reports?.['RUN_STATE.json']?.status;
    if (!['RUNNING', 'COMPLETE', 'FAILED'].includes(status)) throw new EvalError('EVAL_REPORT_INVALID', 'checkpoint requires suite execution state');
    const generation = `${Date.now()}-${randomBytes(8).toString('hex')}`;
    const finalReports = Object.fromEntries(Object.entries(reports).map(([name, value]) => [name, { ...value,
      generation_id: generation, execution_policy_revision: metadata.execution_policy?.revision,
      execution_policy: metadata.execution_policy }]));
    const results = { ...(previous?.task_results ?? {}) };
    for (const [taskId, result] of Object.entries(taskResults)) {
      component(taskId);
      const completedFile = path.join(store, 'completed-tasks', `${taskId}.json`);
      const completed = fs.existsSync(completedFile) ? JSON.parse(fs.readFileSync(completedFile, 'utf8')) : results[taskId];
      if (completed) {
        const { generation_id: _ignored, ...existing } = completed;
        if (json(existing) !== json(result)) throw new EvalError('EVAL_REPORT_INVALID', `completed task result cannot be changed: ${taskId}`);
        results[taskId] = completed;
      } else {
        results[taskId] = { ...result, generation_id: generation };
        // Task completion is its own immutable fact. Keep its identity even if
        // a report projection fails before publishing the suite pointer.
        atomicText(completedFile, json(results[taskId]));
      }
    }
    const record = { schema: SCHEMA, run_id: runId, kind: metadata.kind, generation_id: generation,
      status, committed_at: new Date().toISOString(), input, reports: finalReports, task_results: results,
      evidence_manifest: archiveEvidence(input, previous, store) };
    if (metadata.kind === 'product') {
      if (!finalReports['PRODUCT_100.json']) throw new EvalError('EVAL_REPORT_INVALID', 'product checkpoint is missing its score report');
      record.scoreboard_view = { ...buildScoreboardView({ report: finalReports['PRODUCT_100.json'], rows: input.rows, packs: input.packs }), generation_id: generation };
    }
    const body = json(record);
    const generationDir = path.join(store, 'generations', generation);
    fs.mkdirSync(generationDir, { recursive: true });
    fs.writeFileSync(path.join(generationDir, 'CHECKPOINT.json'), body, { flag: 'wx' });
    project(record, dir);
    // Publish last: every accepted pointer names one complete immutable record.
    atomicText(path.join(store, 'LATEST.json'), json({ schema: 'eval.report-pointer/1', generation_id: generation, sha256: digest(body) }));
    return record;
  });
}

export function rebuildProductReports(runId, { workDir = WORK_DIR } = {}) {
  const { dir, store } = locations(runId, workDir);
  if (!fs.existsSync(store)) {
    if (!fs.existsSync(path.join(dir, 'PRODUCT_100.json'))) throw new EvalError('EVAL_REPORT_UNSUPPORTED', 'legacy run has no existing PRODUCT_100.json to render');
    // Preserve historical scores and policies byte-for-byte. This is rendering,
    // not re-evaluation under whichever scoring policy is installed today.
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'PRODUCT_100.json'), 'utf8'));
    const html = writeScoreboardFromRun(dir);
    return { report, out: path.join(dir, 'PRODUCT_100.json'), htmlPath: html.htmlPath, legacy: true };
  }
  return withProjectionLock(store, () => {
    const record = readReportCheckpoint(runId, { workDir });
    if (record.kind !== 'product') throw new EvalError('EVAL_REPORT_UNSUPPORTED', 'this run is a process comparison, not a product report');
    project(record, dir, { repair: true });
    return { report: record.reports['PRODUCT_100.json'], compare: record.reports['COMPARE_SCALAR.json'],
      out: path.join(dir, 'PRODUCT_100.json'), htmlPath: path.join(dir, 'report', 'index.html'), generationId: record.generation_id, legacy: false };
  });
}
