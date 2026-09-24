import fs from 'node:fs';
import path from 'node:path';

export function jobKey(job) {
  return `${job.taskId}\0${job.engine}\0${job.scenario}`;
}

function requirementIds(job) {
  const reqPath = path.join(job.jobDir, 'looks-request.json');
  if (!fs.existsSync(reqPath)) return null;
  const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  const ids = (req.rubric?.requirements ?? []).map((r) => r.id).filter(Boolean);
  return ids.length ? ids : null;
}

export function checkLooksVerdict(job, scores) {
  const issues = [];
  const stillIds = new Set((job.stills ?? []).map((s) => s.id).filter(Boolean));
  const ids = requirementIds(job);
  if (!ids) {
    issues.push('missing looks-request rubric');
    return issues;
  }
  for (const id of ids) {
    const raw = scores?.[id];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`${id} needs {score, evidence}`);
      continue;
    }
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.map(String) : [];
    if (!evidence.some((e) => stillIds.has(e))) issues.push(`${id} evidence not in this job`);
  }
  return issues;
}

export function installLooksVerdicts({ jobs, verdicts, write = true }) {
  const index = new Map((jobs ?? []).map((job) => [jobKey(job), job]));
  const seen = new Set();
  const issues = [];
  const written = [];
  for (const verdict of verdicts ?? []) {
    const key = jobKey(verdict);
    const job = index.get(key);
    const label = `${verdict.taskId} ${verdict.engine} ${verdict.scenario}`;
    if (!job) {
      issues.push(`unknown job ${label}`);
      continue;
    }
    if (seen.has(key)) issues.push(`duplicate ${label}`);
    seen.add(key);
    const jobIssues = checkLooksVerdict(job, verdict.scores);
    if (jobIssues.length) {
      issues.push(...jobIssues.map((item) => `${label}: ${item}`));
      continue;
    }
    const out = path.join(job.jobDir, 'looks-verdict.json');
    if (write) {
      fs.mkdirSync(job.jobDir, { recursive: true });
      fs.writeFileSync(out, `${JSON.stringify({ scores: verdict.scores }, null, 2)}\n`);
    }
    written.push(out);
  }
  for (const job of jobs ?? []) {
    if (!seen.has(jobKey(job))) issues.push(`missing verdict ${job.taskId} ${job.engine} ${job.scenario}`);
  }
  return { ok: issues.length === 0, issues, written };
}
