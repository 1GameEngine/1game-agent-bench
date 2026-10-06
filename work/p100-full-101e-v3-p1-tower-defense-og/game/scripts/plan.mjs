import { out } from './gen-traces.mjs';
import { simulate, brief } from './sim.mjs';
const only = process.argv[2];
const every = Number(process.argv[3] ?? 15);
for (const [name, trace] of Object.entries(out)) {
  if (name.startsWith('__') || (only && !name.includes(only))) continue;
  console.log('==', name, trace.frames, 'frames');
  let prev = '';
  simulate(trace, 1000 / 30, (d, f) => {
    const b = brief(d);
    if (f % every === 0 || f === trace.frames - 1) console.log(String(f).padStart(4), b);
  });
}
