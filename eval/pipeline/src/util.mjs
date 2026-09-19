export class EvalError extends Error {
  constructor(primary, message, extra = {}) {
    super(message);
    this.primary = primary;
    this.extra = extra;
  }
}

export function parseCliJson(stdout) {
  const text = String(stdout ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new EvalError('EVAL_INTERNAL', 'CLI stdout had no JSON object', { stdout: text.slice(0, 400) });
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new EvalError('EVAL_INTERNAL', `CLI JSON parse failed: ${err.message}`, { stdout: text.slice(0, 400) });
  }
}

export function assertNoForbiddenScoreKeys(value, path = '$') {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenScoreKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === 'overall' || lower === 'total_score' || lower.startsWith('vlm_')) {
      throw new EvalError(
        'EVAL_INTERNAL',
        `forbidden score key ${key} at ${path}; P0 reports must not contain overall / total_score / vlm_*`,
      );
    }
    assertNoForbiddenScoreKeys(child, `${path}.${key}`);
  }
}

export function readStoreState(queryJson) {
  if (!queryJson || queryJson.ok !== true || queryJson.schema !== '1gameplay.frame') {
    return { empty: true, value: undefined, reason: 'query not 1gameplay.frame ok' };
  }
  const value = queryJson.result?.select?.['store:state'];
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { empty: true, value, reason: 'BINDSTORE_EMPTY' };
  }
  return { empty: false, value };
}
