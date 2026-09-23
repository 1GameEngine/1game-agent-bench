import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameplayView } from './looks-rubric.mjs';
import { hasDepth, WEIGHTS } from './product-100.mjs';

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scoreboard.template.html');

export const ENGINE_PACK_KEYS = {
  onegame: 'og',
  godot: 'gd',
};

export const ENGINE_DISPLAY = {
  onegame: { label: '1Game', color: '#6ea8ff' },
  godot: { label: 'Godot', color: '#3dd68c' },
};

export const ENGINE_PALETTE = ['#6ea8ff', '#3dd68c', '#ffb020', '#e879f9', '#67e8f9', '#fb7185'];

export const LOOKS_ZH = {
  V1: 'V1 开局能认',
  V2: 'V2 局内过程能看懂',
  V3: 'V3 图对得上 dump',
  V4: 'V4 必要 UI 没被挡住',
  A1: 'A1 风格统一',
  A2: 'A2 画过而不只是色块',
  A3: 'A3 状态有外观',
  A4: 'A4 HUD 有主题',
  D1: 'D1 选项能分开',
};

export const METRIC_DEFS = [
  { key: 'G', label: '能跑起来 G' },
  { key: 'M', label: '机械对错 M' },
  { key: 'M_pos', label: '正例切片', optional: true },
  { key: 'M_neg', label: '负例切片', optional: true },
  { key: 'D', label: '深度 D', optional: true },
  { key: 'D_mech', label: '机械深度', optional: true },
  { key: 'D_looks', label: '观感深度', optional: true },
  { key: 'V', label: '能看清 V' },
  { key: 'A', label: '好看 A' },
  { key: 'product_100', label: '本题 S' },
];

export const STILL_LABELS = {
  init: '开局',
  after_start: '点过 Start',
  final: '终局',
};

export function packSides(pack) {
  if (Array.isArray(pack?.sides) && pack.sides.length) return pack.sides;
  const out = [];
  const seen = new Set();
  for (const [id, key] of Object.entries(ENGINE_PACK_KEYS)) {
    if (pack?.[key]) {
      out.push({ engine: id, ...pack[key] });
      seen.add(id);
    }
  }
  for (const [k, v] of Object.entries(pack ?? {})) {
    if (['id', 'bundle', 'og', 'gd', 'sides'].includes(k)) continue;
    if (v && typeof v === 'object' && (Array.isArray(v.stills) || v.jobDir || v.G != null)) {
      if (!seen.has(k)) {
        out.push({ engine: k, ...v });
        seen.add(k);
      }
    }
  }
  return out;
}

export function engineDisplay(id, index = 0) {
  const known = ENGINE_DISPLAY[id];
  if (known) return { id, ...known };
  return {
    id,
    label: id,
    color: ENGINE_PALETTE[index % ENGINE_PALETTE.length],
  };
}

export function parseTaskCopy(instruction, fallbackId) {
  const text = String(instruction ?? '');
  const title =
    (text.match(/^标题：\s*(.+)/m) || [])[1]?.trim() ||
    (text.match(/^#\s+(.+)/m) || [])[1]?.trim() ||
    fallbackId;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('标题：') && !l.startsWith('#'));
  const blurb = lines[0] ?? '';
  return { title, blurb };
}

export function dumpCaption(dump) {
  const view = gameplayView(dump);
  const parts = Object.entries(view).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return parts.join(' · ') || 'dump';
}

export function stillRel(taskId, engine, stillId) {
  return `stills/${taskId}__${engine}__${stillId}.png`;
}

function readLooksItems(side) {
  if (side?.looks_items && typeof side.looks_items === 'object') return side.looks_items;
  const verdictPath = side?.verdictPath || (side?.jobDir ? path.join(side.jobDir, 'looks-verdict.json') : null);
  if (verdictPath && fs.existsSync(verdictPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
      return data.scores ?? data;
    } catch {
      return null;
    }
  }
  return null;
}

export function orderedEngineIds({ report, rows, packs }) {
  const ids = [];
  const add = (id) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const id of Object.keys(ENGINE_DISPLAY)) add(id);
  for (const id of Object.keys(report?.engines ?? {})) add(id);
  for (const id of Object.keys(report?.product_100 ?? {})) add(id);
  for (const r of rows ?? []) add(r.engine);
  for (const pack of packs ?? []) {
    for (const side of packSides(pack)) add(side.engine);
  }
  const present = new Set([
    ...Object.keys(report?.engines ?? {}),
    ...Object.keys(report?.product_100 ?? {}),
    ...(rows ?? []).map((r) => r.engine),
    ...(packs ?? []).flatMap((p) => packSides(p).map((s) => s.engine)),
  ]);
  const filtered = ids.filter((id) => present.has(id));
  return filtered.length ? filtered : ids;
}

function valuesFor(engines, pick) {
  const values = {};
  for (const e of engines) values[e.id] = pick(e.id);
  return values;
}

function disagree(engines, values) {
  const nums = engines.map((e) => values[e.id]).filter((v) => v !== '—' && v != null);
  return new Set(nums.map(String)).size > 1;
}

function gameNote(engines, scores, metrics) {
  const nums = engines.map((e) => ({ e, v: scores[e.id] })).filter((x) => typeof x.v === 'number');
  if (!nums.length) return '';
  const uniq = new Set(nums.map((x) => x.v));
  const dimDiff = (metrics ?? []).filter((r) => ['M', 'D', 'V', 'A'].includes(r.key) && disagree(engines, r.values));
  if (uniq.size === 1) {
    if (dimDiff.length) {
      return `${nums.length} 个引擎总分都是 ${nums[0].v}，但 ${dimDiff.map((r) => r.label).join('、')} 不一致，不并列。`;
    }
    return `${nums.length} 个引擎都是 ${nums[0].v} 分。`;
  }
  const max = Math.max(...nums.map((x) => x.v));
  const top = nums.filter((x) => x.v === max).map((x) => x.e.label);
  const rest = nums.filter((x) => x.v !== max).map((x) => `${x.e.label} ${x.v}`);
  const dims = dimDiff.length ? ` ${dimDiff.map((r) => r.label).join('、')} 也不一样。` : '';
  return `${top.join('、')} ${max}；其余 ${rest.join('，')}。${dims}`;
}

function looksNote(engines, looks) {
  const diffs = looks.filter((r) => disagree(engines, r.values));
  if (!diffs.length) return '';
  return diffs
    .map((r) => `${r.label}：${engines.map((e) => `${e.label} ${r.values[e.id] ?? '—'}`).join(' / ')}`)
    .join('。') + '。';
}

export function buildScoreboardView({ report, rows, packs }) {
  const taskRows = rows ?? report?.tasks ?? [];
  const engineIds = orderedEngineIds({ report, rows: taskRows, packs });
  const engines = engineIds.map((id, i) => {
    const d = engineDisplay(id, i);
    const product_100 = report?.engines?.[id]?.product_100 ?? report?.product_100?.[id] ?? null;
    return { ...d, product_100 };
  });
  const nums = engines.map((e) => e.product_100).filter((v) => typeof v === 'number');
  const max = nums.length ? Math.max(...nums) : null;
  const comparable = report?.comparable !== false;
  let winnerIds =
    comparable && max != null ? engines.filter((e) => e.product_100 === max).map((e) => e.id) : [];
  if (report?.winner_engine === 'onegame' || report?.winner_engine === 'godot') {
    winnerIds = [report.winner_engine];
  } else if (winnerIds.length > 1 && new Set(nums).size === 1) {
    winnerIds = [];
  }

  const taskIds = report?.task_ids?.length
    ? [...report.task_ids]
    : [...new Set(taskRows.map((r) => r.id))];
  const packById = Object.fromEntries((packs ?? []).map((p) => [p.id, p]));
  const w = report?.weights ?? WEIGHTS;
  const games = taskIds.map((taskId) => {
    const pack = packById[taskId];
    const sides = pack ? packSides(pack) : [];
    const copy = parseTaskCopy(pack?.bundle?.instruction, taskId);
    const byEngine = {};
    for (const e of engines) {
      byEngine[e.id] =
        taskRows.find((r) => r.id === taskId && r.engine === e.id) ??
        { id: taskId, engine: e.id, product_100: null };
    }
    const scores = valuesFor(engines, (id) => byEngine[id].product_100);
    const metrics = METRIC_DEFS.map((m) => {
      const values = valuesFor(engines, (id) => {
        const row = byEngine[id];
        if (m.key === 'D' && row.D == null && !hasDepth(taskId)) return '—';
        const v = row[m.key];
        return v == null ? '—' : v;
      });
      return { key: m.key, label: m.label, values };
    });
    const looksKeys = [];
    for (const e of engines) {
      const side = sides.find((s) => s.engine === e.id);
      const items = byEngine[e.id].looks_items ?? readLooksItems(side) ?? {};
      for (const k of Object.keys(items)) {
        if (!looksKeys.includes(k)) looksKeys.push(k);
      }
    }
    const looks = looksKeys.map((k) => ({
      label: LOOKS_ZH[k] || k,
      values: valuesFor(engines, (id) => {
        const side = sides.find((s) => s.engine === id);
        const items = byEngine[id].looks_items ?? readLooksItems(side);
        return items?.[k] ?? '—';
      }),
    }));
    const freezeIds = [];
    for (const side of sides) {
      for (const s of side.stills ?? []) {
        if (s?.id && !freezeIds.includes(s.id)) freezeIds.push(s.id);
      }
    }
    if (!freezeIds.length) {
      for (const e of engines) {
        for (const s of byEngine[e.id].stills ?? []) {
          if (s?.id && !freezeIds.includes(s.id)) freezeIds.push(s.id);
        }
      }
    }
    const stills = freezeIds.map((fid) => ({
      label: STILL_LABELS[fid] || fid,
      shots: engines
        .map((e) => {
          const side = sides.find((s) => s.engine === e.id);
          const still = (side?.stills ?? []).find((s) => s.id === fid);
          if (!still && !(byEngine[e.id].stills ?? []).some((s) => s.id === fid)) return null;
          return {
            engine: e.id,
            src: stillRel(taskId, e.id, fid),
            caption: dumpCaption(still?.dump),
          };
        })
        .filter(Boolean),
    }));
    return {
      id: taskId,
      title: copy.title,
      blurb: copy.blurb,
      scores,
      missing: Object.fromEntries(engines.map((e) => [e.id, byEngine[e.id].missing_scenarios ?? []])),
      note: gameNote(engines, scores, metrics),
      metrics,
      looks,
      looksNote: looksNote(engines, looks),
      stills,
    };
  });

  const runId = String(report?.report_id ?? '').replace(/^P100_/, '') || 'run';
  const looksPhase = report?.looks_phase ?? (comparable ? 'scored' : 'blocked');
  const headerMeta =
    looksPhase === 'scored'
      ? '可比 · 真实 looks'
      : looksPhase === 'pending'
        ? '观感未评'
        : looksPhase === 'unpaired'
          ? '观感不成对'
          : looksPhase === 'evidence'
            ? '证据不全'
            : '不可比';
  return {
    schema: 'eval.scoreboard/1',
    runId,
    comparable,
    looksPhase,
    headerMeta,
    meta: `跑次 ${runId} · ${headerMeta}。百分制只在 looks subagent 成对后出现。橙色数字表示引擎之间不一致。`,
    formula: `S = G × (${w.M}M + ${w.D}D + ${w.V}V + ${w.A}A)。V2=0 时 M/D 封顶 0.5，V 取 V1/V2 低值，A2=0 时 A 封顶 0.5。M/D 探针不能单独把循环空场打满分。`,
    engines,
    winnerIds: winnerIds.length === engines.length ? [] : winnerIds,
    games,
  };
}

export function renderScoreboardHtml(view) {
  const tpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!tpl.includes('__VIEW_JSON__')) {
    throw new Error('scoreboard template missing __VIEW_JSON__');
  }
  const json = JSON.stringify(view).replace(/</g, '\\u003c');
  return tpl.replace('__VIEW_JSON__', json);
}

export function writeScoreboard({ dir, report, rows, packs }) {
  const view = buildScoreboardView({ report, rows, packs });
  const outDir = path.join(dir, 'report');
  const stillsDir = path.join(outDir, 'stills');
  fs.mkdirSync(stillsDir, { recursive: true });
  for (const pack of packs ?? []) {
    for (const side of packSides(pack)) {
      for (const still of side.stills ?? []) {
        if (!still?.id || !still.path || !fs.existsSync(still.path)) continue;
        const dest = path.join(stillsDir, `${pack.id}__${side.engine}__${still.id}.png`);
        fs.copyFileSync(still.path, dest);
      }
    }
  }
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, renderScoreboardHtml(view));
  return { htmlPath, view };
}

export function writeScoreboardFromRun(runDir) {
  const report = JSON.parse(fs.readFileSync(path.join(runDir, 'PRODUCT_100.json'), 'utf8'));
  return writeScoreboard({ dir: runDir, report, rows: report.tasks, packs: [] });
}
