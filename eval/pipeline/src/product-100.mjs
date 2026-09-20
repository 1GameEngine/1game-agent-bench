export const P0_TASKS = ['p0-click-score', 'p0-hud-start', 'p0-grid-marks', 'p0-countdown-play'];

export const P1_TASKS = [
  'p1-toggle-lamp',
  'p1-counter-clamp',
  'p1-pick-slot',
  'p1-arm-fire',
  'p1-grid-step',
  'p1-seq-ab',
  'p1-tab-act',
  'p1-space-pulse',
  'p1-door-pair',
  'p1-mode-cycle',
];

export const SUITE_TASKS = [...P0_TASKS, ...P1_TASKS];

export const DEPTH_TASKS = {
  'p0-grid-marks': ['cell0', 'cell1', 'cell2'],
  'p1-pick-slot': ['slotA', 'slotB', 'slotC'],
  'p1-tab-act': ['red', 'blue'],
  'p1-door-pair': ['left', 'right'],
  'p1-mode-cycle': null,
};

export const WEIGHTS = { M: 40, D: 10, V: 20, A: 30 };

export function hasDepth(taskId) {
  return Object.prototype.hasOwnProperty.call(DEPTH_TASKS, taskId);
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

export function taskScore100({ G, M, D, V, A, hasD }) {
  if (!G) return 0;
  const m = clamp01(M);
  let a = clamp01(A);
  if (m < 0.5) a = Math.min(a, 0.5);
  const v = clamp01(V);
  const d = clamp01(D ?? 0);
  if (hasD) return 40 * m + 10 * d + 20 * v + 30 * a;
  return ((40 * m + 20 * v + 30 * a) / 90) * 100;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function winnerOf(og, gd, eps = 0.1) {
  if (Math.abs(og - gd) < eps) return 'tie';
  return og > gd ? 'onegame' : 'godot';
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
    const product_100 = roundScore(mean(list.map((r) => r.product_100)), 1);
    engines[engine] = {
      product_100,
      task_count: list.length,
    };
  }
  const winner = winnerOf(engines.onegame.product_100, engines.godot.product_100);
  const og = engines.onegame.product_100.toFixed(1);
  const gd = engines.godot.product_100.toFixed(1);
  const winner_sentence =
    winner === 'tie'
      ? `套件总分（14题算术平均，百分制）：1Game = ${og}，Godot = ${gd}。并列。`
      : `套件总分（14题算术平均，百分制）：1Game = ${og}，Godot = ${gd}。胜者是分数更高的引擎。`;
  return {
    schema: 'eval.product-100/1',
    suite_id: 'eval-spec/1',
    report_id: `P100_${runId}`,
    headline_track: 'product_100',
    winner: true,
    looks_included: true,
    still: { width: 1280, height: 720, video: false, onegame_scale: 4 },
    weights: { ...WEIGHTS },
    task_count: 14,
    task_ids: [...SUITE_TASKS],
    product_100: {
      onegame: engines.onegame.product_100,
      godot: engines.godot.product_100,
    },
    winner_engine: winner,
    winner_sentence,
    notice:
      '胜负只看 product_100。COMPARE_SCALAR 与 P0 五维表是过程指标，不得写入结论句。禁止 overall / total_score / vlm_*。',
    engines,
    tasks: [...byEngine.onegame, ...byEngine.godot],
    process_appendix: {
      winner: false,
      compare_scalar: 'COMPARE_SCALAR.json',
      p0_report: 'P0_report.json',
    },
  };
}

export function zeroRow(id, engine, primary) {
  return {
    id,
    engine,
    primary,
    G: 0,
    M: 0,
    D: hasDepth(id) ? 0 : undefined,
    V: 0,
    A: 0,
    product_100: 0,
    looks_status: 'SKIP',
    g0_ok: 0,
  };
}

export function scoreAttempt({
  id,
  engine,
  G,
  sliceScores,
  negSliceScores,
  V,
  A,
  D,
  primary,
  g0_ok,
  looks_status,
  stills,
}) {
  const pos = mean(sliceScores?.length ? sliceScores : [0]);
  const neg = negSliceScores?.length ? mean(negSliceScores) : pos;
  const M = quantize01((pos + neg) / 2);
  const hasD = hasDepth(id);
  let d = hasD ? D ?? 0 : 0;
  if (hasD && D == null) d = 0;
  const product_100 = roundScore(taskScore100({ G: G ? 1 : 0, M, D: d, V: V ?? 0, A: A ?? 0, hasD }), 1);
  const row = {
    id,
    engine,
    primary,
    G: G ? 1 : 0,
    g0_ok: g0_ok ?? (G ? 1 : 0),
    M,
    V: V ?? 0,
    A: A ?? 0,
    product_100,
    looks_status: looks_status ?? 'SKIP',
  };
  if (hasD) row.D = d;
  if (stills?.length) {
    row.stills = stills.map((s) => ({
      id: s.id,
      dump_ok: s.dump_ok ?? 0,
      png_ok: s.ok ? 1 : 0,
      sha256: s.sha256,
      scale: s.scale,
    }));
  }
  return row;
}
