// Replays a demo trace against src/game.tsx through the headless 1gameplay CLI.
// usage: node scripts/replay.mjs <trace.json> <out.1gamerecord> [probeEveryFrames] [shotFrames,comma]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

const [, , tracePath, recPath, probeEvery = '30', shots = ''] = process.argv;
const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
const MS = 33;
const surf = process.env.SURFACE ? ['--surface', process.env.SURFACE] : [];
const evFile = `/tmp/replay-ev-${trace.scenario}-${process.pid}.json`;
const planFile = `/tmp/replay-plan-${trace.scenario}-${process.pid}.json`;
const DRAG_FRAMES = 4;

function run(args) {
  return execFileSync('pnpm', ['exec', '1gameplay', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

const byFrame = new Map();
function add(frame, ev) {
  if (!byFrame.has(frame)) byFrame.set(frame, []);
  byFrame.get(frame).push(ev);
}
for (const ev of trace.events) {
  if (ev.type === 'keydown') add(ev.frame, { type: 'keydown', data: { code: ev.code } });
  else if (ev.type === 'keyup') add(ev.frame, { type: 'keyup', data: { code: ev.code } });
  else if (ev.type === 'click') {
    add(ev.frame, { type: 'pointer.down', data: { id: 1, x: ev.x, y: ev.y } });
    if (ev.toX === undefined) {
      add(ev.frame + 1, { type: 'pointer.up', data: { id: 1, x: ev.x, y: ev.y } });
    } else {
      for (let i = 1; i <= DRAG_FRAMES - 1; i++) {
        const k = i / (DRAG_FRAMES - 1);
        add(ev.frame + i, {
          type: 'pointer.move',
          data: { id: 1, x: Math.round(ev.x + (ev.toX - ev.x) * k), y: Math.round(ev.y + (ev.toY - ev.y) * k) },
        });
      }
      add(ev.frame + DRAG_FRAMES, { type: 'pointer.up', data: { id: 1, x: ev.toX, y: ev.toY } });
    }
  }
}

mkdirSync('out', { recursive: true });
rmSync(recPath, { force: true });
rmSync(recPath + '.swp', { force: true });
run(['create', '--entry', 'src/game.tsx', '--out', recPath]);

let frame = 0;
let idle = 0;
const flush = () => {
  if (idle > 0) {
    run(['step', recPath, '--ms', String(MS), '--repeat', String(idle), ...surf]);
    frame += idle;
    idle = 0;
  }
};
const natural = Math.max(trace.frames, ...[...byFrame.keys()].map((k) => k + 1));
const last = process.env.CUT ? Number(process.env.CUT) : natural;
for (let f = 0; f < last; f++) {
  const evs = byFrame.get(f);
  if (!evs) {
    idle++;
    continue;
  }
  flush();
  writeFileSync(evFile, JSON.stringify(evs));
  run(['step', recPath, '--ms', String(MS), '--event-file', evFile, ...surf]);
  frame += 1;
}
flush();

const out = JSON.parse(run(['frames', 'list', recPath]));
const seqs = (out.result?.frames ?? out.frames ?? []).length;
console.log('frames recorded', seqs, 'expected', last + 1);

const tasks = [];
const every = Number(probeEvery);
for (let s = every; s <= last; s += every) tasks.push({ taskId: `s${s}`, type: 'query', at: s, select: ['store:state'] });
tasks.push({ taskId: 'last', type: 'query', at: 'last', select: ['store:state'] });
writeFileSync(planFile, JSON.stringify({ schema: '1gameplay.frame.plan', tasks }));
const batch = JSON.parse(run(['frame', 'batch', recPath, '--plan-file', planFile, '--payload', 'full']));
const results = batch.result?.tasks ?? batch.tasks ?? batch.result?.results ?? [];
const brief = (st) =>
  `${st.screen}/${st.phase} open=${st.open} dp=${6 + st.gain - st.gainOffset - st.dpSpent} base=${st.base} nx=${st.nextSpawn} msg="${st.msg}" ` +
  `defs=[${st.defs.map((d) => `${d.kind}${d.up ? '+' : ''}@${d.col},${d.row}${d.kind === 'wall' ? ':' + d.hp : ''}`).join(' ')}] ` +
  `en=[${st.enemies.map((e) => `${e.name}${e.hp}@${e.col}`).join(' ')}] shots=${st.shots.length} sel=${st.selected}`;
for (const t of results) {
  const st = t.result?.select?.['store:state'] ?? t.select?.['store:state'];
  if (st) console.log(String(t.taskId).padEnd(6), brief(st));
  else console.log(t.taskId, JSON.stringify(t).slice(0, 300));
}

for (const s of shots.split(',').filter(Boolean)) {
  run(['frame', 'screenshot', recPath, '--at', s, '--out', process.env.SHOT_OUT ?? `out/shot-${trace.scenario}-${s}.png`, '--width', '1280', '--height', '720']);
}
