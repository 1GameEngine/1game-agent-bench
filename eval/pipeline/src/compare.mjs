export function subsetMatch(expected, actual, path = '') {
  const errs = [];
  if (expected === null || typeof expected !== 'object') {
    if (expected !== actual) {
      errs.push(`${path || '$'}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
    return errs;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      errs.push(`${path || '$'}: expected array`);
      return errs;
    }
    if (actual.length !== expected.length) {
      errs.push(`${path || '$'}: array length ${actual.length} !== ${expected.length}`);
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      if (expected[i] !== actual[i]) {
        errs.push(`${path}[${i}]: expected ${JSON.stringify(expected[i])} got ${JSON.stringify(actual[i])}`);
      }
    }
    return errs;
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    errs.push(`${path || '$'}: expected object`);
    return errs;
  }
  for (const [key, value] of Object.entries(expected)) {
    const next = path ? `${path}.${key}` : key;
    errs.push(...subsetMatch(value, actual[key], next));
  }
  return errs;
}

export function compareCheckpointSlice(expected, actual, compare, { isFinal = false } = {}) {
  const errors = subsetMatch(expected, actual);
  if (isFinal && compare?.remainMs_lte != null) {
    if (typeof actual?.remainMs !== 'number' || actual.remainMs > compare.remainMs_lte) {
      errors.push(`remainMs_lte: ${actual?.remainMs} > ${compare.remainMs_lte}`);
    }
  }
  return errors;
}
