import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOOKS_ITEMS,
  aggregateLooks,
  buildLooksUserPrompt,
  gameplayView,
  parseLooksVerdict,
  promptHasBannedWords,
  stripInstruction,
} from '../src/looks-rubric.mjs';
import { encodePngRgba } from '../src/png-nn.mjs';
import { buildLooksJob, looksBackend, scoreVisuals, setLooksInvoker } from '../src/looks-judge.mjs';

test('parseLooksVerdict extracts JSON and quantizes 0/0.5/1', () => {
  const text = 'ok\n{"scores":{"V1":0.9,"V2":0.4,"V3":0.1,"V4":1,"A1":0.5,"A2":2,"A3":0,"A4":0.2,"D1":0.8}}\n';
  const parsed = parseLooksVerdict(text);
  assert.equal(parsed.scores.V1, 1);
  assert.equal(parsed.scores.V2, 0.5);
  assert.equal(parsed.scores.V3, 0);
  assert.equal(parsed.scores.A2, 1);
  assert.equal(parsed.scores.A4, 0);
  assert.equal(parsed.scores.D1, 1);
});

test('aggregateLooks averages V/A; D1 only when hasDepth', () => {
  const scores = {
    V1: 1,
    V2: 1,
    V3: 0,
    V4: 1,
    A1: 0.5,
    A2: 0.5,
    A3: 0.5,
    A4: 0.5,
    D1: 1,
  };
  const withD = aggregateLooks(scores, { hasDepth: true });
  assert.equal(withD.V, 0.75);
  assert.equal(withD.A, 0.5);
  assert.equal(withD.D_visual, 1);
  const noD = aggregateLooks(scores, { hasDepth: false });
  assert.equal(noD.D_visual, undefined);
});

test('stripInstruction drops 实现约束; gameplayView drops eval.*', () => {
  const md = 'Play a lamp.\n\n## 实现约束\nGodot ColorRect forbidden';
  assert.equal(stripInstruction(md), 'Play a lamp.');
  assert.deepEqual(gameplayView({ on: true, 'eval.schema_id': 'x', 'eval.schema_sha256': 'y' }), { on: true });
});

test('looks job prompt is per-scenario play tags, not engine APIs', () => {
  const job = buildLooksJob({
    taskId: 'p1-night-stall',
    engine: 'godot',
    scenario: 'intro',
    instruction: 'Toggle the lamp. ## 实现约束\nUse Sprite2D',
    geometry: { labels: { lamp: 'LAMP' }, regions: { lamp: { x: 0, y: 0, w: 10, h: 10 } } },
    stills: [{ id: 'intro_f0', path: '/tmp/final.png', dump: { scenario: 'intro', frame: 0, t_ms: 0, on: true, 'eval.schema_id': 'hide' }, dump_ok: 1, ok: true }],
  });
  const prompt = buildLooksUserPrompt(job);
  assert.match(prompt, /scenario="intro"/);
  assert.match(prompt, /Play tag:/);
  assert.doesNotMatch(prompt, /"on":true/);
  assert.doesNotMatch(prompt, /eval\.schema_id/);
  assert.doesNotMatch(prompt, /Sprite2D/);
  assert.equal(promptHasBannedWords(prompt).length, 0);
  assert.equal(LOOKS_ITEMS.some((i) => i.id === 'V3'), true);
});

test('NODE_TEST_CONTEXT backend is heuristic', () => {
  assert.equal(looksBackend(), 'heuristic');
});

test('EVAL_LOOKS_BACKEND=subagent with no invoker is SUBAGENT_UNAVAILABLE', async () => {
  const prev = process.env.EVAL_LOOKS_BACKEND;
  const prevReq = process.env.EVAL_LOOKS_REQUIRE_EXTERNAL;
  process.env.EVAL_LOOKS_BACKEND = 'subagent';
  process.env.EVAL_LOOKS_REQUIRE_EXTERNAL = '1';
  setLooksInvoker(null);
  try {
    const vis = await scoreVisuals({
      stills: [{ ok: true, path: '/tmp/missing-still.png', dump: { on: false } }],
      geometry: { regions: {} },
      instruction: 'lamp',
      taskId: 'p1-rail-desk',
    });
    assert.equal(vis.looks_status, 'CAPTURE_FAIL');
    const tmp = path.join(os.tmpdir(), `looks-${process.pid}.png`);
    fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex'));
    const vis2 = await scoreVisuals({
      stills: [{ ok: true, path: tmp, dump: { on: false } }],
      geometry: { regions: {} },
      instruction: 'lamp',
      taskId: 'p1-rail-desk',
    });
    assert.equal(vis2.looks_status, 'SUBAGENT_UNAVAILABLE');
    assert.equal(vis2.V, 0);
    assert.equal(vis2.A, 0);
    assert.equal(vis2.source, 'subagent');
    fs.unlinkSync(tmp);
  } finally {
    if (prev === undefined) delete process.env.EVAL_LOOKS_BACKEND;
    else process.env.EVAL_LOOKS_BACKEND = prev;
    if (prevReq === undefined) delete process.env.EVAL_LOOKS_REQUIRE_EXTERNAL;
    else process.env.EVAL_LOOKS_REQUIRE_EXTERNAL = prevReq;
    setLooksInvoker(null);
  }
});

test('looks-job worker scores stills when no external invoker', async () => {
  const prev = process.env.EVAL_LOOKS_BACKEND;
  const prevAllow = process.env.EVAL_LOOKS_ALLOW_WORKER;
  process.env.EVAL_LOOKS_BACKEND = 'subagent';
  process.env.EVAL_LOOKS_ALLOW_WORKER = '1';
  setLooksInvoker(null);
  try {
    const w = 1280;
    const h = 720;
    const rgba = Buffer.alloc(w * h * 4, 15);
    for (let y = 32; y < 128; y++) {
      for (let x = 48; x < 400; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }
    }
    for (let y = 280; y < 440; y++) {
      for (let x = 440; x < 840; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = 37;
        rgba[i + 1] = 99;
        rgba[i + 2] = 235;
        rgba[i + 3] = 255;
      }
    }
    const tmp = path.join(os.tmpdir(), `looks-worker-${process.pid}.png`);
    fs.writeFileSync(tmp, encodePngRgba(w, h, rgba));
    const vis = await scoreVisuals({
      stills: [{ ok: true, path: tmp, dump: { on: false }, dump_ok: 1 }],
      geometry: { labels: { toggle: 'Toggle' }, regions: { toggle: { x: 440, y: 280, w: 400, h: 160 } } },
      instruction: 'lamp',
      taskId: 'p1-rail-desk',
    });
    assert.equal(vis.looks_status, 'OK');
    assert.equal(vis.source, 'worker');
    assert.ok(vis.V >= 0.5);
    fs.unlinkSync(tmp);
  } finally {
    if (prev === undefined) delete process.env.EVAL_LOOKS_BACKEND;
    else process.env.EVAL_LOOKS_BACKEND = prev;
    if (prevAllow === undefined) delete process.env.EVAL_LOOKS_ALLOW_WORKER;
    else process.env.EVAL_LOOKS_ALLOW_WORKER = prevAllow;
    setLooksInvoker(null);
  }
});

test('registered invoker scores V3 from dump match items', async () => {
  const prev = process.env.EVAL_LOOKS_BACKEND;
  process.env.EVAL_LOOKS_BACKEND = 'subagent';
  setLooksInvoker(async () => ({
    scores: { V1: 1, V2: 1, V3: 1, V4: 1, A1: 0.5, A2: 0.5, A3: 0.5, A4: 0.5, D1: 0 },
  }));
  try {
    const tmp = path.join(os.tmpdir(), `looks-ok-${process.pid}.png`);
    fs.writeFileSync(tmp, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex'));
    const vis = await scoreVisuals({
      stills: [{ ok: true, path: tmp, dump: { on: true } }],
      geometry: { regions: {} },
      instruction: 'lamp',
      taskId: 'p1-rail-desk',
    });
    assert.equal(vis.looks_status, 'OK');
    assert.equal(vis.source, 'subagent');
    assert.equal(vis.V, 1);
    assert.equal(vis.A, 0.5);
    fs.unlinkSync(tmp);
  } finally {
    if (prev === undefined) delete process.env.EVAL_LOOKS_BACKEND;
    else process.env.EVAL_LOOKS_BACKEND = prev;
    setLooksInvoker(null);
  }
});

test('paired looks zeros both when one side has no stills', async () => {
  const { scorePairedLooks, stillsComplete } = await import('../src/looks-pair.mjs');
  assert.equal(stillsComplete([{ ok: true, path: '/nope.png' }]), false);
  const png = path.join(os.tmpdir(), `pair-${process.pid}.png`);
  fs.writeFileSync(
    png,
    Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex',
    ),
  );
  const vis = await scorePairedLooks({
    taskId: 'p1-rail-desk',
    instruction: 'lamp',
    geometry: { regions: {} },
    og: { G: 1, stills: [{ ok: true, path: png }] },
    gd: { G: 1, stills: [{ ok: false, status: 'CAPTURE_FAIL' }] },
  });
  assert.equal(vis.pair, 'INCOMPARABLE_VISUAL');
  assert.equal(vis.og.V, 0);
  assert.equal(vis.gd.V, 0);
  assert.equal(vis.og.looks_status, 'INCOMPARABLE_VISUAL');
  fs.unlinkSync(png);
});
