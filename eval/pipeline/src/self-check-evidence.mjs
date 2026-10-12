import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { WORK_DIR, taskDir } from './paths.mjs';
import { verifySubmissionManifest, createSubmissionManifest } from './submission-manifest.mjs';
import { loadYaml } from './load.mjs';
import { EvalError } from './util.mjs';
import { readValidationIndex, VALIDATION_TERMINAL } from './validation-control.mjs';

const incomplete = message => new EvalError('STAGE_VALIDATION_INCOMPLETE', message);
export function selfCheckEvidenceError(spec, data, { stageId = spec.stage_id, timingPath, checkWorkspace = false } = {}) {
  if (spec.self_check_contract !== 'eval.self-check/1' || !['builder','debug'].includes(spec.role)) return null;
  try {
    if (timingPath) {
      for (const entry of readValidationIndex(timingPath, stageId).sessions) {
        const p = JSON.parse(fs.readFileSync(entry.progress_path, 'utf8'));
        if (!VALIDATION_TERMINAL.has(p.state) || !p.cleanup_finished_at) throw new EvalError('SUBAGENT_PROCESS_FAILED', 'validation is still active or cleanup is unconfirmed');
      }
    }
    if (data.exitCode !== 0) return null;
    const evidence = data.self_check;
    if (!evidence || !/^validation-\d+-[a-f0-9]{12}$/.test(evidence.session_id ?? '')) throw incomplete('success needs a final validation session and visual review declaration');
    const dir = path.join(WORK_DIR, evidence.session_id);
    if (fs.realpathSync(dir) !== dir) throw new EvalError('SUBAGENT_INVALID', 'validation artifact directory must not be a symlink');
    const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const progress = read('PROGRESS.json'), report = read('VALIDATION.json'), manifest = read('SUBMISSION.json');
    if (report.schema !== 'eval.trace-validation/2' || report.diagnostic_only !== true || progress.schema !== 'eval.validation-progress/1') throw incomplete('success needs the current validation evidence schema');
    if (report.engine !== spec.engine || report.taskId !== spec.taskId || report.stage_id !== stageId || progress.stage_id !== stageId ||
        progress.session_id !== evidence.session_id || report.workspace !== path.resolve(spec.workspace)) throw new EvalError('SUBAGENT_INVALID', 'validation evidence belongs to a different stage or workspace');
    if (progress.state === 'FAILED') throw new EvalError('SUBAGENT_PROCESS_FAILED', 'final validation has an execution failure');
    if (progress.state !== 'COMPLETE' || !progress.cleanup_finished_at || report.process_exit_status !== 0 || !report.cleanup_finished_at || !report.ok || report.validation_mode !== 'full' ||
        !Number.isFinite(Date.parse(report.process_started_at)) || !Number.isFinite(Date.parse(report.process_finished_at)) ||
        Date.parse(report.cleanup_finished_at) < Date.parse(report.process_finished_at) || Date.parse(report.process_finished_at) < Date.parse(report.process_started_at)) {
      throw incomplete('success requires a complete, cleaned full validation; diagnostics and prefixes are insufficient');
    }
    if (progress.cleanup_finished_at !== report.cleanup_finished_at || progress.process_exit_status !== report.process_exit_status) throw new EvalError('SUBAGENT_INVALID','validation progress and final process result disagree');
    if (!verifySubmissionManifest(manifest) || !manifest.observation_complete || report.submission_id !== manifest.submission_id ||
        progress.submission_id !== manifest.submission_id || evidence.submission_id !== manifest.submission_id) throw incomplete('final validation candidate identity is missing or inconsistent');
    const task = loadYaml(path.join(taskDir(spec.taskId), 'task.yaml'));
    const expected = [...task.scenarios.required].sort();
    if (JSON.stringify([...report.expected_scenarios].sort()) !== JSON.stringify(expected) || !expected.every(s => report.replayed_scenarios.includes(s))) throw incomplete('final validation does not cover every required scenario');
    const ids = report.stills.map(s => s.id);
    for (const scenario of expected) {
      const n = report.trace_frames?.[scenario];
      if (!Number.isSafeInteger(n) || n < 1 || !ids.includes(`${scenario}_f0`) || !ids.includes(`${scenario}_f${n-1}`)) throw incomplete('full validation must include every scenario start and end still');
    }
    if (!Array.isArray(evidence.reviewed_still_ids) || new Set(ids).size !== ids.length ||
        JSON.stringify([...evidence.reviewed_still_ids].sort()) !== JSON.stringify([...ids].sort())) throw incomplete('visual review must cover every final validation still');
    for (const still of report.stills) {
      const file = fs.realpathSync(still.path);
      if (!still.ok || !file.startsWith(`${dir}${path.sep}`) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== still.sha256) throw incomplete('final visual evidence is missing or changed');
    }
    if (evidence.preflight?.passed !== true || !Array.isArray(evidence.preflight.checks) || !evidence.preflight.checks.length || evidence.preflight.checks.some(s=>typeof s !== 'string' || !s.trim())) throw incomplete('success needs a preflight check declaration');
    for (const scenario of expected) {
      const review = evidence.scenarios?.[scenario];
      const ownIds = new Set(ids.filter(id=>id.startsWith(`${scenario}_f`)));
      if (review?.passed !== true || !Array.isArray(review.checks) || !review.checks.length ||
          review.checks.some(c=>typeof c.requirement !== 'string' || !c.requirement.trim() || c.passed !== true || !Array.isArray(c.evidence) || !c.evidence.length || c.evidence.some(id=>!ownIds.has(id)))) throw incomplete(`success needs a gameplay review with this scenario's evidence: ${scenario}`);
    }
    if (checkWorkspace) {
      const current = createSubmissionManifest({ workspace: spec.workspace, engine: spec.engine, taskId: spec.taskId, publicTask: task });
      if (!current.observation_complete || current.submission_id !== evidence.submission_id) throw incomplete('submission changed after the final validation; verify the new candidate');
    }
    return null;
  } catch (err) {
    if (err instanceof EvalError) return err;
    if (err.code && err.code !== 'ENOENT') return new EvalError('SUBAGENT_PROCESS_FAILED', `cannot inspect validation evidence: ${err.code}`);
    return incomplete(`final validation evidence is unavailable or invalid: ${err.message}`);
  }
}
