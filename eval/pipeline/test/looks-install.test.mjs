import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installLooksVerdicts } from '../src/looks-install.mjs';

test('installLooksVerdicts writes only complete still evidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-install-'));
  const jobDir = path.join(dir, 'intro');
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'looks-request.json'),
    JSON.stringify({
      rubric: {
        requirements: [
          { id: 'V1', description: 'see' },
          { id: 'A1', description: 'art' },
        ],
      },
    }),
  );
  const jobs = [
    {
      taskId: 'p1-chart-rush',
      engine: 'onegame',
      scenario: 'intro',
      jobDir,
      stills: [{ id: 'intro_f0' }],
    },
  ];
  const bad = installLooksVerdicts({
    jobs,
    verdicts: [
      {
        taskId: 'p1-chart-rush',
        engine: 'onegame',
        scenario: 'intro',
        scores: { V1: { score: 1, evidence: ['other'] }, A1: { score: 1, evidence: ['intro_f0'] } },
      },
    ],
    write: false,
  });
  assert.equal(bad.ok, false);
  assert.equal(fs.existsSync(path.join(jobDir, 'looks-verdict.json')), false);
  const good = installLooksVerdicts({
    jobs,
    verdicts: [
      {
        taskId: 'p1-chart-rush',
        engine: 'onegame',
        scenario: 'intro',
        scores: {
          V1: { score: 1, evidence: ['intro_f0'] },
          A1: { score: 0.5, evidence: ['intro_f0'] },
        },
      },
    ],
  });
  assert.equal(good.ok, true);
  const saved = JSON.parse(fs.readFileSync(path.join(jobDir, 'looks-verdict.json'), 'utf8'));
  assert.equal(saved.scores.A1.score, 0.5);
});
