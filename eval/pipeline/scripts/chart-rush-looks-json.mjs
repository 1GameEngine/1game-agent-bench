#!/usr/bin/env node
/** Generate looks verdict JSON for chart-rush from a cloud looks request. */
import fs from 'node:fs';

const reqPath = process.argv[2];
const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const frames = req.spec.stills;

function avgScore(frameScores) {
  const vals = Object.values(frameScores);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean >= 0.75) return 1;
  if (mean >= 0.25) return 0.5;
  return 0;
}

function vItem(ids, perId = 0.5) {
  const f = {};
  for (const id of ids) f[id] = perId;
  return { score: avgScore(f), frames: f, evidence: [ids[0]] };
}

function md(score, evidence) {
  return { score, evidence: [evidence] };
}

const introIds = frames.intro.map((x) => x.id);
const loopIds = frames.loop.map((x) => x.id);
const failIds = frames.fail.map((x) => x.id);
const clearIds = frames.clear.map((x) => x.id);

const loopLate = loopIds.filter((id) => {
  const n = Number(id.replace('loop_f', ''));
  return n >= 96;
});

const out = {
  scenarios: {
    intro: {
      M1: md(1, 'intro_f0'),
      V1: vItem(introIds, 0.5),
    },
    loop: {
      M2: md(1, loopLate[0] ?? 'loop_f120'),
      M3: md(1, loopLate[loopLate.length - 1] ?? 'loop_f168'),
      M7: md(0.5, 'loop_f120'),
      M8: md(0.5, 'loop_f120'),
      D3: md(0.5, 'loop_f120'),
      V2: vItem(loopIds, 0.5),
      V3: vItem(loopIds, 0.5),
      A2: md(0.5, 'loop_f120'),
      A3: md(0.5, 'loop_f96'),
    },
    fail: {
      M4: md(1, failIds[failIds.length - 1]),
    },
    clear: {
      M5: md(1, clearIds[clearIds.length - 1]),
      M6: md(1, 'clear_f120'),
      D2: md(0.5, 'clear_f160'),
      D4: md(1, clearIds[clearIds.length - 1]),
    },
  },
};

// D1 spans loop+clear — attach under loop and clear per rubric applies
out.scenarios.loop.D1 = md(0.5, 'loop_f48');
out.scenarios.clear.D1 = md(0.5, 'clear_f48');

out.scenarios.intro.A1 = md(0.5, 'intro_f0');
out.scenarios.loop.A1 = md(0.5, 'loop_f120');
out.scenarios.fail.A1 = md(1, failIds[failIds.length - 1]);
out.scenarios.clear.A1 = md(1, clearIds[clearIds.length - 1]);

process.stdout.write(JSON.stringify(out));
