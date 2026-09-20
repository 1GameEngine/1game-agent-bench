import { createHash } from 'node:crypto';
import fs from 'node:fs';

export function schemaSha256(schemaObj) {
  const canonical = JSON.stringify(schemaObj);
  return createHash('sha256').update(canonical).digest('hex');
}

export function gameplayKeys(schema) {
  return Object.keys(schema.properties).filter((k) => k !== 'eval.schema_id' && k !== 'eval.schema_sha256');
}

export function projectDump(store, schema, sha) {
  const keys = gameplayKeys(schema);
  const dump = {
    'eval.schema_id': schema.$id,
    'eval.schema_sha256': sha,
  };
  const missing = [];
  if (store === undefined || store === null || typeof store !== 'object' || Array.isArray(store)) {
    return { dump: null, missing: keys, extras: [] };
  }
  for (const k of keys) {
    if (!(k in store) || store[k] === undefined) missing.push(k);
    else dump[k] = store[k];
  }
  return { dump, missing, extras: [] };
}

export function validateDump(dump, schema, sha) {
  const notes = [];
  if (!dump || typeof dump !== 'object') return { ok: false, code: 'SCHEMA_MISSING', notes: ['dump missing'] };
  if (dump['eval.schema_id'] !== schema.$id) notes.push('schema_id mismatch');
  if (dump['eval.schema_sha256'] !== sha) notes.push('schema_sha256 mismatch');
  const allowed = new Set(['eval.schema_id', 'eval.schema_sha256', ...gameplayKeys(schema)]);
  for (const k of Object.keys(dump)) {
    if (!allowed.has(k)) notes.push(`extra field ${k}`);
  }
  for (const k of gameplayKeys(schema)) {
    if (!(k in dump) || dump[k] === undefined || dump[k] === null) notes.push(`missing ${k}`);
  }
  if (notes.some((n) => n.startsWith('extra'))) return { ok: false, code: 'SCHEMA_MISMATCH', notes };
  if (notes.some((n) => n.startsWith('missing'))) return { ok: false, code: 'SCHEMA_MISSING', notes };
  if (notes.length) return { ok: false, code: 'SCHEMA_MISMATCH', notes };
  return { ok: true, code: 'G0_OK', notes };
}

export function checkpointMatch(dump, expected, compare = null, opts = {}) {
  const errors = [];
  for (const [k, v] of Object.entries(expected)) {
    if (JSON.stringify(dump[k]) !== JSON.stringify(v)) {
      errors.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(dump[k])}`);
    }
  }
  if (opts.isFinal && compare?.remainMs_lte != null) {
    if (typeof dump?.remainMs !== 'number' || dump.remainMs > compare.remainMs_lte) {
      errors.push(`remainMs_lte: ${dump?.remainMs} > ${compare.remainMs_lte}`);
    }
  }
  return errors;
}

export function loadSchemaFile(file) {
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sha = schemaSha256(schema);
  return { schema, sha };
}
