#!/usr/bin/env node
import fs from 'node:fs';

const reqPath = process.argv[2];
const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const prompt = req.spec.prompt;
const items = [...prompt.matchAll(/- ([A-Z]\d+)（([MDVA])，场景 ([^）]+)）：/g)].map((m) => ({
  id: m[1],
  dim: m[2],
  applies: m[3].split('/'),
}));
const scenarios = {};
for (const item of items) {
  for (const sc of item.applies) {
    scenarios[sc] ??= {};
    const frames = (req.spec.stills[sc] ?? []).map((x) => x.id);
    const ev = frames[0] ?? `${sc}_f0`;
    if (item.dim === 'V') {
      const f = {};
      for (const id of frames) f[id] = 0.5;
      const mean = frames.length ? 0.5 : 0;
      scenarios[sc][item.id] = { score: mean >= 0.75 ? 1 : mean >= 0.25 ? 0.5 : 0, frames: f, evidence: [ev] };
    } else {
      scenarios[sc][item.id] = { score: 0.5, evidence: [ev] };
    }
  }
}
process.stdout.write(JSON.stringify({ scenarios }));
