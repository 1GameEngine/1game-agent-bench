// Generates demo_outputs/*.json (eval.trace/1) from scripted timelines.
import { mkdirSync, writeFileSync } from 'node:fs';

const MAX_FRAMES = 565;
const CELL = 72;
const cx = (col) => 352 + col * CELL + 36;
const cy = (row) => 148 + row * CELL + 36;
const CARD = { gun: [178, 188], wall: [178, 256], cannon: [178, 324] };
const BTN = {
  straight: [340, 250],
  bend: [900, 250],
  save: [180, 448],
  wipe: [400, 448],
  load: [620, 448],
  start: [640, 655],
  step: [180, 655],
  retry: [1040, 655],
  maps: [1130, 428],
  upgrade: [1130, 188],
};

function timeline(scenario) {
  const events = [];
  let f = 0;
  const api = {
    get f() {
      return f;
    },
    wait(n) {
      f += n;
    },
    click(x, y, gap = 3) {
      events.push({ frame: f, type: 'click', x, y });
      f += gap;
    },
    btn(name, gap) {
      api.click(...BTN[name], gap);
    },
    cell(col, row, gap) {
      api.click(cx(col), cy(row), gap);
    },
    drag(card, col, row, gap = 4) {
      const [x, y] = CARD[card];
      events.push({ frame: f, type: 'click', x, y, toX: cx(col), toY: cy(row) });
      f += 4 + gap;
    },
    dragTo(card, x, y, gap = 4) {
      const [sx, sy] = CARD[card];
      events.push({ frame: f, type: 'click', x: sx, y: sy, toX: x, toY: y });
      f += 4 + gap;
    },
    press(code, gap = 3) {
      events.push({ frame: f, type: 'keydown', code });
      events.push({ frame: f + 2, type: 'keyup', code });
      f += 2 + gap;
    },
    finish(tail = 0) {
      f += tail;
      if (f > MAX_FRAMES) throw new Error(`${scenario}: ${f} frames > ${MAX_FRAMES}`);
      return {
        schema: 'eval.trace/1',
        scenario,
        fps: 30,
        viewport: { width: 1280, height: 720 },
        frames: f,
        events,
      };
    },
  };
  return api;
}

const out = {};

{
  const t = timeline('intro');
  t.wait(30);
  t.btn('bend');
  t.wait(40);
  t.btn('straight');
  t.wait(30);
  t.press('Enter');
  t.wait(200);
  out['01_intro'] = t.finish(10);
}

{
  const t = timeline('fail');
  t.wait(20);
  t.btn('straight');
  t.wait(20);
  t.press('Enter');
  t.wait(20);
  for (let i = 0; i < 12; i++) {
    t.press('Space', i % 2 ? 14 : 16);
  }
  t.wait(30);
  t.btn('retry');
  t.wait(40);
  out['03_fail'] = t.finish();
}

{
  const t = timeline('loop');
  t.wait(15);
  t.btn('straight');
  t.wait(15);
  t.press('Enter');
  t.wait(12);
  t.dragTo('wall', cx(2), cy(1));
  t.wait(14);
  t.drag('wall', 3, 2);
  t.wait(8);
  t.cell(3, 2);
  t.wait(6);
  t.btn('upgrade');
  t.wait(8);
  t.drag('gun', 5, 1);
  t.wait(10);
  for (let i = 0; i < 10; i++) t.press('Space', 15 + (i % 3) * 2);
  t.wait(20);
  out['02_loop'] = t.finish();
}

{
  const t = timeline('clear');
  t.wait(10);
  t.btn('straight');
  t.wait(10);
  t.press('Enter');
  t.wait(6);
  t.drag('cannon', 3, 1);
  t.drag('gun', 3, 3);
  t.wait(40);
  t.drag('wall', 5, 2);
  t.wait(6);
  for (let i = 0; i < 11; i++) t.press('Space', 12);
  out.__afterSteps = t.f;
  t.wait(20);
  t.btn('maps');
  t.wait(24);
  t.btn('save');
  t.wait(14);
  t.btn('wipe');
  t.wait(14);
  t.btn('load');
  t.wait(20);
  t.btn('bend');
  t.wait(40);
  out['04_clear'] = t.finish();
}

export { timeline, out };

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync('demo_outputs', { recursive: true });
  for (const [name, trace] of Object.entries(out)) {
    if (name.startsWith('__')) continue;
    writeFileSync(`demo_outputs/${name}.json`, JSON.stringify(trace, null, 1) + '\n');
    console.log(name, trace.frames, 'frames', trace.events.length, 'events');
  }
}
