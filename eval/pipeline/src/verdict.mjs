import { DIMENSIONS } from './paths.mjs';

export function primaryOf(row) {
  if (row.spec_violation) return 'SPEC_VIOLATION';
  if (row.eval_internal) return 'EVAL_INTERNAL';
  if (row.timeout) return 'TIMEOUT';
  if (row.bindstore_empty) return 'BINDSTORE_EMPTY';
  if (row.create_ok !== 1) return 'CREATE_FAIL';
  if (row.argv_ok !== 1) return 'ARGV_VIOLATION';
  if (row.replay_ok !== 1) return 'REPLAY_FAIL';
  if (row.store_match !== 1) return 'STORE_MISMATCH';
  if (row.hygiene_ok !== 1) return 'HYGIENE_FAIL';
  return 'PASS';
}

export function taskPassed(row) {
  return DIMENSIONS.every((d) => row[d] === 1);
}
