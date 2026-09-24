export const PROCESS_P0_TASKS = ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play'];
export const P0_TASKS = [];

export const P1_TASKS = ['p1-chart-rush'];

export const SUITE_TASKS = [...P1_TASKS];

export const WEIGHTS = { M: 15, D: 35, V: 15, A: 35 };

export function hasDepth(_taskId) {
  return true;
}

export function roundScore(x, digits = 1) {
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

export function quantize01(x) {
  if (x >= 0.75) return 1;
  if (x >= 0.25) return 0.5;
  return 0;
}

export function mean(vals) {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function taskScore100({ G, M, D, V, A }) {
  if (!G) return 0;
  return 15 * clamp01(M) + 35 * clamp01(D) + 15 * clamp01(V) + 35 * clamp01(A);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function winnerOf(og, gd, eps = 0.1) {
  if (Math.abs(og - gd) < eps) return 'tie';
  return og > gd ? 'onegame' : 'godot';
}

export function dimensionTally(og, gd) {
  let onegame = 0;
  let godot = 0;
  const lead = [];
  for (const k of ['M', 'D', 'V', 'A']) {
    const a = og?.[k];
    const b = gd?.[k];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (a > b) {
      onegame += 1;
      lead.push(`${k} 1Game`);
    } else if (b > a) {
      godot += 1;
      lead.push(`${k} Godot`);
    }
  }
  return { onegame, godot, lead };
}

export function visibilityLead(og, gd) {
  for (const k of ['V', 'A']) {
    const a = og?.[k];
    const b = gd?.[k];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (b > a) return 'godot';
    if (a > b) return 'onegame';
  }
  return 'tie';
}

export function buildProduct100({ runId, rows }) {
  const byEngine = { onegame: [], godot: [] };
  for (const taskId of SUITE_TASKS) {
    for (const engine of ['onegame', 'godot']) {
      const row =
        rows.find((r) => r.id === taskId && r.engine === engine) ??
        zeroRow(taskId, engine, 'ENGINE_TASK_UNSUPPORTED');
      byEngine[engine].push(row);
    }
  }
  const engines = {};
  for (const engine of ['onegame', 'godot']) {
    const list = byEngine[engine];
    const nums = list.map((r) => r.product_100).filter((v) => typeof v === 'number');
    const product_100 = nums.length === list.length ? roundScore(mean(nums), 1) : null;
    engines[engine] = {
      product_100,
      task_count: list.length,
    };
  }
  const { comparable, reasons } = suiteComparableFromRows(rows);
  const looks_phase = classifyLooksPhase(comparable, reasons);
  const fmt = (x) => (typeof x === 'number' ? x.toFixed(1) : '未出分');
  const og = fmt(engines.onegame.product_100);
  const gd = fmt(engines.godot.product_100);
  let winner_engine;
  let winner_sentence;
  if (!comparable) {
    winner_engine = 'incomparable';
    const sample = reasons
      .slice(0, 3)
      .map((r) => `${r.id}:${r.reason}`)
      .join('；');
    const head =
      looks_phase === 'pending'
        ? '观感未评，百分制不可比。同一次跑分里没有 looks subagent，不保存机械结果再续评。'
        : looks_phase === 'unpaired'
          ? '观感不成对，百分制不可比。静帧或 looks job 两边不一致，不得宣布胜者。'
          : looks_phase === 'evidence'
            ? '观感证据不全，百分制不可比。裁决没有对上本 job 的静帧 id，不得宣布胜者。'
            : '产物分不可比（静帧或 looks Judge 未成对）。';
    winner_sentence = `${head}1Game = ${og}，Godot = ${gd}。${sample}`;
  } else {
    winner_engine = winnerOf(engines.onegame.product_100, engines.godot.product_100);
    const n = SUITE_TASKS.length;
    if (winner_engine === 'tie') {
      const ogRow = byEngine.onegame[0];
      const gdRow = byEngine.godot[0];
      const dims = dimensionTally(ogRow, gdRow);
      let dimWinner = 'tie';
      if (dims.godot > dims.onegame) dimWinner = 'godot';
      else if (dims.onegame > dims.godot) dimWinner = 'onegame';
      else dimWinner = visibilityLead(ogRow, gdRow);
      if (dimWinner === 'godot' || dimWinner === 'onegame') {
        winner_engine = dimWinner;
        winner_sentence = `套件总分相同（1Game = ${og}，Godot = ${gd}）。${dims.lead.join('，') || '观感维更高'}，不并列。`;
      } else {
        winner_sentence = `套件总分（${n}题算术平均，百分制）：1Game = ${og}，Godot = ${gd}。并列。`;
      }
    } else {
      winner_sentence = `套件总分（${n}题算术平均，百分制）：1Game = ${og}，Godot = ${gd}。胜者是分数更高的引擎。`;
    }
  }
  return {
    schema: 'eval.product-100/1',
    suite_id: 'eval-spec/1',
    report_id: `P100_${runId}`,
    headline_track: 'product_100',
    winner: comparable,
    comparable,
    looks_phase,
    incomparable_reasons: comparable ? [] : reasons,
    looks_included: true,
    still: {
      width: 1280,
      height: 720,
      window_lock: true,
      video: false,
      looks: 'subagent',
      replay_fps: 30,
      traces: 'submitted',
    },
    weights: { ...WEIGHTS },
    task_count: SUITE_TASKS.length,
    task_ids: [...SUITE_TASKS],
    product_100: {
      onegame: engines.onegame.product_100,
      godot: engines.godot.product_100,
    },
    winner_engine,
    winner_sentence,
    notice:
      `胜负只看可比的 product_100（${SUITE_TASKS.length} 题等权）。每题 S = G × (15M + 35D + 15V + 35A)。M/D/V/A 都由 looks subagent 看重放静帧打出，条目 0/0.5/1；只属于一个场景的条目取最高，贯穿多段的条目取平均。缺证据的条目为 0，不再按字段名封顶。G 要求能启动且至少一条轨迹重放成功。两边都 G=1 时必须抽帧成对且 looks_source=subagent。禁止 overall / total_score / vlm_*。`,
    engines,
    tasks: [...byEngine.onegame, ...byEngine.godot],
    process_appendix: {
      winner: false,
      compare_scalar: 'COMPARE_SCALAR.json',
      p0_report: 'P0_report.json',
    },
  };
}

export function classifyLooksPhase(comparable, reasons) {
  if (comparable) return 'scored';
  const texts = (reasons ?? []).map((r) => String(r.reason ?? ''));
  if (texts.length && texts.every((t) => /PENDING|SUBAGENT_UNAVAILABLE/.test(t))) return 'pending';
  if (texts.length && texts.every((t) => /EVIDENCE_INCOMPLETE/.test(t))) return 'evidence';
  if (texts.some((t) => t.includes('INCOMPARABLE'))) return 'unpaired';
  return 'blocked';
}

function suiteComparableFromRows(rows) {
  const reasons = [];
  for (const id of SUITE_TASKS) {
    const og = rows.find((r) => r.id === id && r.engine === 'onegame') ?? zeroRow(id, 'onegame', 'ENGINE_TASK_UNSUPPORTED');
    const gd = rows.find((r) => r.id === id && r.engine === 'godot') ?? zeroRow(id, 'godot', 'ENGINE_TASK_UNSUPPORTED');
    if (!og.G && !gd.G) continue;
    if (og.G !== gd.G) continue;
    if (og.looks_status === 'INCOMPARABLE_VISUAL' || gd.looks_status === 'INCOMPARABLE_VISUAL') {
      reasons.push({ id, reason: 'INCOMPARABLE_VISUAL' });
      continue;
    }
    if (og.looks_status === 'INCOMPARABLE_LOOKS' || gd.looks_status === 'INCOMPARABLE_LOOKS') {
      reasons.push({ id, reason: 'INCOMPARABLE_LOOKS' });
      continue;
    }
    if (og.looks_status !== 'OK' || gd.looks_status !== 'OK') {
      reasons.push({ id, reason: `${og.looks_status}/${gd.looks_status}` });
      continue;
    }
    if (og.looks_source !== 'subagent' || gd.looks_source !== 'subagent') {
      reasons.push({ id, reason: `looks_source=${og.looks_source}/${gd.looks_source}` });
      continue;
    }
    if (typeof og.product_100 !== 'number' || typeof gd.product_100 !== 'number') {
      reasons.push({ id, reason: 'product_100_withheld' });
    }
  }
  return { comparable: reasons.length === 0, reasons };
}

export function zeroRow(id, engine, primary) {
  return {
    id,
    engine,
    primary,
    G: 0,
    M: 0,
    D: 0,
    V: 0,
    A: 0,
    product_100: 0,
    looks_status: 'SKIP',
    looks_source: 'none',
    g0_ok: 0,
  };
}

export function scoreAttempt({
  id,
  engine,
  G,
  M,
  D,
  V,
  A,
  primary,
  g0_ok,
  looks_status,
  looks_source,
  stills,
  looks_items,
  scenarios,
  missing_scenarios,
}) {
  const g = G ? 1 : 0;
  const judged =
    looks_source === 'subagent' &&
    looks_status === 'OK' &&
    [M, D, V, A].every((v) => v != null && Number.isFinite(v));
  const m = judged ? roundScore(clamp01(M), 3) : null;
  const d = judged ? roundScore(clamp01(D), 3) : null;
  const v = judged ? roundScore(clamp01(V), 3) : null;
  const a = judged ? roundScore(clamp01(A), 3) : null;
  const product_100 = g === 0 ? 0 : judged ? roundScore(taskScore100({ G: g, M: m, D: d, V: v, A: a }), 1) : null;
  const row = {
    id,
    engine,
    primary,
    G: g,
    g0_ok: g0_ok ?? g,
    M: m,
    D: d,
    V: v,
    A: a,
    product_100,
    looks_status: looks_status ?? 'SKIP',
    looks_source: looks_source ?? 'none',
    scenarios: scenarios ?? [],
  };
  if (missing_scenarios?.length) row.missing_scenarios = missing_scenarios;
  if (stills?.length) {
    row.stills = stills.map((s) => ({
      id: s.id,
      dump_ok: s.dump_ok ?? 0,
      png_ok: s.ok ? 1 : 0,
      sha256: s.sha256,
      scale: s.scale,
    }));
  }
  if (looks_items && typeof looks_items === 'object') row.looks_items = looks_items;
  return row;
}
