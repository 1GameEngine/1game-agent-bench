export const LOOKS_ITEMS = [
  {
    id: 'V1',
    dim: 'V',
    description:
      'Named controls sit in the stated rectangles. Button/label text matches the given labels character-for-character (no translation). Score 0 if a required control is missing or the label is wrong. Score 0.5 if the control is present but misplaced, cropped, or hard to find. Score 1 if placement and text both match.',
  },
  {
    id: 'V2',
    dim: 'V',
    description:
      'HUD / status text is readable at 1280x720 without overlap: the player can read the current gameplay state from the still. Score 0 if status is absent or illegible. Score 0.5 if text exists but is cramped, tiny, or ambiguous. Score 1 if status is immediately readable.',
  },
  {
    id: 'V3',
    dim: 'V',
    description:
      'This still matches the recorded dump for this freeze: every listed field is visually consistent with the dump (e.g. dump on=true means the lamp/indicator looks on). Score 0 if the picture contradicts the dump. Score 0.5 if the dump state is only weakly suggested. Score 1 if picture and dump agree without guessing.',
  },
  {
    id: 'V4',
    dim: 'V',
    description:
      'Nothing full-screen hides the required UI. Decorative extras are allowed. Score 0 if required UI is covered. Score 0.5 if clutter hurts reading. Score 1 if hierarchy is clear.',
  },
  {
    id: 'A1',
    dim: 'A',
    description:
      'Visual language is coherent (palette, type, spacing) across this still. Score 0 for a blank or default-grey debug screen. Score 0.5 for mixed or unfinished styling. Score 1 for a consistent mini-game look.',
  },
  {
    id: 'A2',
    dim: 'A',
    description:
      'Play objects show authored internal structure (edges, icons, pixel art, illustration), not only unstructured flat fills. Judge the pixels, not any engine API. Axis-aligned blocky pixels from integer 4x upscale are not a defect. Score 0.5 at most if the still is mostly unstructured flat fills. Score 1 if main objects look drawn on purpose.',
  },
  {
    id: 'A3',
    dim: 'A',
    description:
      'State changes have a designed look (light vs dark lamp, marks in cells, pressed/mode), not only a number changing. Score 0 if only raw text changes. Score 0.5 if a color swap. Score 1 if the state is graphically designed.',
  },
  {
    id: 'A4',
    dim: 'A',
    description:
      'HUD/panels look themed rather than leftover defaults. Score 0 for unstyled default widgets dominating the screen. Score 0.5 for partial chrome. Score 1 for themed HUD.',
  },
  {
    id: 'D1',
    dim: 'D',
    description:
      'When variant regions are listed, they are visually distinguishable as different options/objects, not identical clones. Score 0 if they look the same. Score 0.5 if only a slight color/name change. Score 1 if a player can tell them apart at a glance. If no variant regions are listed, omit D1 or score 1.',
  },
];

export const BANNED_LOOKS_WORDS = [
  'ColorRect',
  'napi-canvas',
  'Godot',
  '1Game',
  '1game',
  'Autoload',
  'bindStore',
  'EvalProbe',
  'Sprite2D',
  'CharacterBody2D',
];

export function stripInstruction(instruction) {
  const text = String(instruction ?? '');
  const cut = text.search(/\n## 实现约束/);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  return head.trim().slice(0, 2500);
}

export function gameplayView(dump) {
  if (!dump || typeof dump !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(dump)) {
    if (k.startsWith('eval.')) continue;
    out[k] = v;
  }
  return out;
}

export function quantizeLooks(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n >= 0.75) return 1;
  if (n >= 0.25) return 0.5;
  return 0;
}

export function parseLooksVerdict(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in looks verdict');
  const data = JSON.parse(raw.slice(start, end + 1));
  const scores = data.scores && typeof data.scores === 'object' ? data.scores : data;
  return { scores: normalizeLooksScores(scores), raw: data };
}

export function normalizeLooksScores(scores) {
  const out = {};
  for (const item of LOOKS_ITEMS) {
    out[item.id] = quantizeLooks(scores?.[item.id]);
  }
  return out;
}

export function aggregateLooks(itemScores, { hasDepth = false } = {}) {
  const vIds = LOOKS_ITEMS.filter((i) => i.dim === 'V').map((i) => i.id);
  const aIds = LOOKS_ITEMS.filter((i) => i.dim === 'A').map((i) => i.id);
  const V = avg(vIds.map((id) => itemScores[id] ?? 0));
  const A = avg(aIds.map((id) => itemScores[id] ?? 0));
  const result = { V: quantizeLooks(V), A: quantizeLooks(A), items: itemScores };
  if (hasDepth) result.D_visual = quantizeLooks(itemScores.D1 ?? 0);
  return result;
}

function avg(xs) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildLooksUserPrompt(job) {
  const frames = (job.stills ?? []).map((s, i) => {
    const dump = JSON.stringify(s.dump ?? {}, null, 0);
    return `Frame ${i + 1}: freeze_id=${s.id}\nDump for this freeze: ${dump}\nImage file: ${s.path}`;
  });
  const labels = job.labels && Object.keys(job.labels).length ? JSON.stringify(job.labels) : '{}';
  const regions = job.regions && Object.keys(job.regions).length ? JSON.stringify(job.regions) : '{}';
  const variants = job.variant_regions?.length ? job.variant_regions.join(', ') : '(none — skip D1 or score 1)';
  const reqs = LOOKS_ITEMS.map((i) => `- ${i.id}: ${i.description}`).join('\n');
  return [
    'You are a strict but fair still-frame game evaluator. Score only what is visible in the attached 1280x720 stills.',
    'The image may be a 4x nearest-neighbor upscale from 320x180. Blocky pixels are normal, not blur.',
    'Do not name engines or widget APIs. Do not compare two engines. Score this submission alone.',
    'Use only 0, 0.5, or 1 per item.',
    '',
    'Task instruction (playable spec only):',
    job.instruction || '(none)',
    '',
    `Labels: ${labels}`,
    `Geometry rectangles: ${regions}`,
    `Variant regions for D1: ${variants}`,
    '',
    frames.join('\n\n'),
    '',
    'Requirements:',
    reqs,
    '',
    'Return JSON only, shape:',
    '{"scores":{"V1":0,"V2":0,"V3":0,"V4":0,"A1":0,"A2":0,"A3":0,"A4":0,"D1":0},"rationales":{"V3":"<one sentence>"}}',
  ].join('\n');
}

export function promptHasBannedWords(text) {
  return BANNED_LOOKS_WORDS.filter((w) => text.includes(w));
}
