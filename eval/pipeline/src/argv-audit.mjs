function hasFlag(argv, name) {
  return argv.some((a) => a === name || a.startsWith(`${name}=`));
}

function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  if (idx >= 0) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  return undefined;
}

function eventish(argv) {
  return argv.some((a) => a === '--event' || a.startsWith('--event'));
}

function untilish(argv) {
  return argv.some((a) => a === '--until' || a.startsWith('--until'));
}

export function regionCenter(region) {
  const x = region.x + region.w / 2;
  const y = region.y + region.h / 2;
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return `${Math.round(x)},${Math.round(y)}`;
  }
  return `${x},${y}`;
}

export function allowedClickCenters(geometry) {
  const set = new Set();
  for (const region of Object.values(geometry?.regions ?? {})) {
    if (region && Number.isFinite(region.x) && Number.isFinite(region.w)) {
      set.add(regionCenter(region));
    }
  }
  for (const extra of geometry?.frozen_click_centers ?? []) {
    set.add(String(extra));
  }
  return set;
}

export function auditMutex(argv) {
  const issues = [];
  const click = hasFlag(argv, '--click');
  const event = eventish(argv);
  const until = untilish(argv);
  const repeat = hasFlag(argv, '--repeat');
  if (click && until) issues.push('mutex: --click and --until');
  if (event && until) issues.push('mutex: --event* and --until');
  if (until && repeat) issues.push('mutex: --until and --repeat');
  if (click && event) issues.push('mutex: --click and --event');
  return issues;
}

export function auditReplayArgv(argv, { rules, allowedClicks, recordRel, role }) {
  const issues = [];
  if (!Array.isArray(argv) || argv.length < 2 || argv.some((a) => typeof a !== 'string')) {
    return { ok: false, issues: ['argv must be string[]'] };
  }
  if (argv.some((a) => /[\n\r]/.test(a))) {
    return { ok: false, issues: ['argv tokens must not contain newlines'] };
  }

  const heads = rules.allowed_heads.map((h) => h.join('\0'));
  let matched = null;
  for (const head of rules.allowed_heads) {
    if (argv.length >= head.length && head.every((tok, i) => argv[i] === tok)) {
      matched = head;
      break;
    }
  }
  if (!matched) {
    issues.push(`argv head not allowed: ${argv.slice(0, 3).join(' ')}`);
  }

  const isScreenshot = argv[1] === 'frame' && argv[2] === 'screenshot';
  if (role === 'judge' && argv.some((a) => a === 'screenshot' || a === 'paint')) {
    issues.push('Judge path must not screenshot/paint');
  }
  if (isScreenshot && role !== 'capture') {
    issues.push('frame screenshot is capture-only');
  }
  if (role === 'capture' && !isScreenshot) {
    issues.push('capture role may only run frame screenshot');
  }

  for (const tok of rules.p0_forbidden_tokens ?? []) {
    if (argv.includes(tok) || argv.some((a) => a.startsWith(`${tok}=`))) {
      issues.push(`P0 forbids token ${tok}`);
    }
  }
  issues.push(...auditMutex(argv));

  if (matched && matched[1] === 'step') {
    const stepIssues = auditPlayplanStep(argv, { rules, allowedClicks, recordRel });
    issues.push(...stepIssues.issues);
  }

  if (matched && matched[1] === 'frame' && matched[2] === 'query') {
    const select = flagValue(argv, '--select');
    if (select && select !== rules.judge_select) {
      issues.push(`frame query --select must be ${rules.judge_select}`);
    }
  }

  if (matched && matched[1] === 'frame' && matched[2] === 'screenshot') {
    if (!argv.includes('--at') || !argv.includes('--out')) {
      issues.push('screenshot must pass --at and --out');
    }
  }

  if (matched && matched[1] === 'create') {
    if (!argv.includes('--entry') || !argv.includes('--out')) {
      issues.push('create must pass --entry and --out');
    }
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function auditPlayplanStep(argv, { rules, allowedClicks, recordRel }) {
  const issues = [];
  if (argv[0] !== '1gameplay' || argv[1] !== 'step') {
    issues.push('playplan step head must be 1gameplay step');
    return { ok: false, issues };
  }
  if (argv[2] !== recordRel) {
    issues.push(`record path must be ${recordRel}`);
  }
  issues.push(...auditMutex(argv));
  if (untilish(argv)) issues.push('P0 track disables --until');
  if (hasFlag(argv, '--from-frame')) issues.push('P0 forbids --from-frame');
  if (hasFlag(argv, '--dry-run')) issues.push('P0 forbids --dry-run');
  if (hasFlag(argv, '--surface')) issues.push('P0 forbids --surface');
  if (argv.includes('frames') && argv.includes('delete')) issues.push('P0 forbids frames delete');
  if (argv.some((a) => a === 'branch' || a.startsWith('--branch'))) issues.push('P0 forbids branch');

  const click = hasFlag(argv, '--click');
  if (click) {
    if (hasFlag(argv, '--ms')) issues.push('P0 click steps must not include --ms');
    if (hasFlag(argv, '--repeat')) issues.push('P0 click steps must not include --repeat');
    const coord = flagValue(argv, '--click');
    const re = new RegExp(rules.p0_step.click.coord_pattern);
    if (!coord || !re.test(coord)) {
      issues.push(`invalid --click ${coord}`);
    } else if (allowedClicks && !allowedClicks.has(coord)) {
      issues.push(`click ${coord} is not a region center or frozen playplan center`);
    }
    const allowed = new Set(['1gameplay', 'step', recordRel, '--click', coord]);
    for (const tok of argv) {
      if (!allowed.has(tok)) issues.push(`unexpected click argv token ${tok}`);
    }
  } else {
    const ms = flagValue(argv, '--ms');
    if (ms == null) issues.push('tick must pass explicit --ms');
    else if (ms !== rules.p0_step.tick.required_ms) {
      issues.push(`tick --ms must be ${rules.p0_step.tick.required_ms}, got ${ms}`);
    }
    if (hasFlag(argv, '--repeat')) {
      const n = flagValue(argv, '--repeat');
      if (!/^[1-9]\d*$/.test(n ?? '')) issues.push('--repeat must be a positive integer');
    }
    const allowed = new Set(['1gameplay', 'step', recordRel, '--ms', ms, '--repeat', flagValue(argv, '--repeat')]);
    for (const tok of argv) {
      if (!allowed.has(tok)) issues.push(`unexpected tick argv token ${tok}`);
    }
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function pnpmExecArgv(playArgv) {
  return ['exec', ...playArgv];
}
