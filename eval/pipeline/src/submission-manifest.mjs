import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REPO_DIR, REQUIRED_ONEGAME } from './paths.mjs';
import { assetLibraryRoot, TASK_SPRITES } from './assets.mjs';
import { writeReport } from './report.mjs';

const EXCLUDED = new Set(['node_modules', '.git', '.godot', 'out', 'work', '.validation', 'cache', '.cache',
  '.aws', '.ssh', '.codex', '.agents', '.cursor', '.claude', '.report-store', 'report', 'STAGES', 'stills']);
const OUTPUTS = new Set(['SUBMISSION.json', 'REPLAY.json', 'VALIDATION.json', 'PROGRESS.json', 'VALIDATION_EVENTS.jsonl',
  'LOOKS.json', 'STAGE_ERROR.json', 'STAGE_WARNINGS.json', 'STAGE_STATE.json', 'STAGE_EVENTS.jsonl',
  'STAGE_PROGRESS.json', 'STAGE_PROGRESS.jsonl', 'PRODUCT_100.json', 'COMPARE_SCALAR.json', 'P0_report.json',
  'RUN_STATE.json', 'stdout.log', 'stderr.log']);
const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const slash = (value) => value.split(path.sep).join('/');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function excluded(name) {
  return EXCLUDED.has(name) || OUTPUTS.has(name) || name === '.env' || name.startsWith('.env.') ||
    /^builder-(?:onegame|godot)\.json$/.test(name) ||
    /\.(?:request|started|response|timing|archive|result)\.json(?:\.|$)/.test(name) ||
    [...OUTPUTS].some((output) => name.startsWith(`${output}.`) && name.endsWith('.tmp')) ||
    /^(?:credentials|secrets?)(?:\.|$)/i.test(name);
}

function kind(rel) {
  if (rel.startsWith('demo_outputs/')) return 'trace';
  if (rel.startsWith('assets/') || rel.startsWith('asset-library/')) return 'asset';
  return 'source';
}

function frameworkRevision() {
  try {
    let git = path.join(REPO_DIR, '.git');
    if (fs.statSync(git).isFile()) {
      const match = /^gitdir:\s*(.+)/m.exec(fs.readFileSync(git, 'utf8'));
      if (!match) return null;
      git = path.resolve(REPO_DIR, match[1]);
    }
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40,64}$/.test(head)) return head;
    if (!head.startsWith('ref: refs/')) return null;
    const ref = head.slice(5);
    try { return fs.readFileSync(path.join(git, ref), 'utf8').trim(); }
    catch {
      const packed = fs.readFileSync(path.join(git, 'packed-refs'), 'utf8');
      return packed.split('\n').find((line) => line.endsWith(` ${ref}`))?.split(' ')[0] ?? null;
    }
  } catch { return null; }
}

function manifestContent(manifest) {
  const { submission_id, runId, stageId, snapshot_kind, observed_at, diagnostics, ...content } = manifest;
  return content;
}

// An observation and version association, not an ACL, attestation, or acceptance gate.
// External links are never traversed except for the configured public asset library.
export function createSubmissionManifest({ workspace, engine, taskId, runId = null, stageId = null,
  snapshotKind = 'observed_workspace', publicTask = null, runtime = {} } = {}) {
  const root = path.resolve(workspace);
  const files = [];
  const diagnostics = [];
  const note = (rel, code) => diagnostics.push({ path: slash(rel), code });
  let library;
  try { library = fs.realpathSync(assetLibraryRoot()); } catch { library = null; }
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { realRoot = root; }

  function hashFile(file, rel, extra = {}) {
    try {
      const before = fs.statSync(file);
      // Do not read FIFOs/devices or other potentially blocking inputs.
      if (!before.isFile()) { note(rel, 'unsupported_file_type'); return; }
      const sha256 = digest(fs.readFileSync(file));
      const after = fs.statSync(file);
      const entry = { path: slash(rel), kind: kind(slash(rel)), size: after.size, sha256, ...extra };
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        entry.unstable = true;
        note(rel, 'changed_while_reading');
      }
      files.push(entry);
    } catch (err) { note(rel, err.code ?? 'unreadable'); }
  }

  function visit(full, rel, ancestors = new Set()) {
    try {
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(full); }
        catch (err) {
          files.push({ path: slash(rel), kind: kind(slash(rel)), link: 'unresolved' });
          note(rel, err.code ?? 'unresolved_symlink'); return;
        }
        const scope = inside(realRoot, target) ? 'workspace' : library && inside(library, target) ? 'asset_library' : 'external';
        const targetRoot = scope === 'workspace' ? realRoot : library;
        files.push({ path: slash(rel), kind: kind(slash(rel)), link: scope,
          target: scope === 'external' ? digest(fs.readlinkSync(full)) : slash(path.relative(targetRoot, target)) });
        note(rel, 'symlink_not_isolation');
        if (scope === 'external') { note(rel, 'external_symlink_not_hashed'); return; }
        if (scope === 'workspace' && path.relative(realRoot, target).split(path.sep).some(excluded)) {
          note(rel, 'excluded_symlink_target'); return;
        }
        if (ancestors.has(target)) { note(rel, 'symlink_cycle'); return; }
        if (fs.statSync(target).isFile()) { hashFile(target, rel, { linked_content: true }); return; }
        if (scope === 'asset_library') {
          // Hash bounded, task-provided sources rather than recursively reading a shared library.
          for (const selected of [...new Set((TASK_SPRITES[taskId] ?? []).map((sprite) => sprite.src))].sort()) {
            const source = path.join(library, selected);
            let actual;
            try { actual = fs.realpathSync(source); } catch (err) { note(`${rel}/${selected}`, err.code ?? 'unreadable'); continue; }
            if (!inside(library, actual)) { note(`${rel}/${selected}`, 'external_symlink_not_hashed'); continue; }
            hashFile(actual, `${rel}/${selected}`, { shared_library_source: true });
          }
          note(rel, 'shared_library_only_task_sources_hashed');
          return;
        }
        visit(target, rel, ancestors);
        return;
      }
      if (stat.isDirectory()) {
        const resolved = fs.realpathSync(full);
        if (ancestors.has(resolved)) { note(rel, 'symlink_cycle'); return; }
        const next = new Set([...ancestors, resolved]);
        for (const name of fs.readdirSync(full).sort()) {
          if (!excluded(name)) visit(path.join(full, name), rel ? `${rel}/${name}` : name, next);
        }
      } else hashFile(full, rel);
    } catch (err) { note(rel, err.code ?? 'unreadable'); }
  }
  visit(root, '');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en') || Boolean(a.linked_content) - Boolean(b.linked_content));

  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); }
  catch (err) { if (engine === 'onegame') note('package.json', err.code ?? 'invalid_package_json'); }
  const packages = {};
  if (engine === 'onegame') {
    for (const name of REQUIRED_ONEGAME) {
      const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? null;
      let installed = null;
      try {
        const found = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
        if (typeof found === 'string' && VERSION.test(found)) installed = found;
      } catch { /* Absent dependencies remain an observation, not a new rejection. */ }
      packages[name] = { declared: typeof declared === 'string' && VERSION.test(declared) ? declared : null,
        declared_digest: declared === null ? null : digest(String(declared)), installed };
    }
  }
  const godotName = path.basename(process.env.GODOT_BIN ?? '');
  const manifest = {
    schema: 'eval.submission-manifest/1', engine, taskId,
    observation_complete: !diagnostics.some(({ code }) => !['symlink_not_isolation', 'shared_library_only_task_sources_hashed'].includes(code)),
    files, dependencies: { packages, locks: files.filter((file) => /^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file.path)) },
    runtime: { node: process.version, platform: process.platform, arch: process.arch,
      ...(engine === 'godot' ? { godot_executable: godotName || null,
        godot_version_hint: /(?:^|v)(\d+\.\d+(?:\.\d+)?)/.exec(godotName)?.[1] ?? null } : {}),
      ...(typeof runtime.godot_version === 'string' && VERSION.test(runtime.godot_version) ? { godot_version: runtime.godot_version } : {}) },
    framework_revision: frameworkRevision(), public_task_digest: publicTask === null ? null : digest(JSON.stringify(canonical(publicTask))),
    limitations: ['observed_files_not_atomic_snapshot', 'hashes_are_not_security_isolation', 'dependencies_not_content_addressed',
      'godot_version_hint_not_runtime_attestation', 'shared_library_only_task_sources_hashed'],
    runId, stageId, snapshot_kind: snapshotKind, observed_at: new Date().toISOString(), diagnostics,
  };
  manifest.submission_id = digest(JSON.stringify(canonical(manifestContent(manifest))));
  return manifest;
}

export function writeSubmissionManifest(file, manifest) {
  writeReport(file, manifest);
  return { submission_id: manifest.submission_id, manifest_path: file, snapshot_kind: manifest.snapshot_kind };
}

export function verifySubmissionManifest(manifest) {
  if (manifest?.schema !== 'eval.submission-manifest/1' || typeof manifest.submission_id !== 'string') return false;
  return manifest.submission_id === digest(JSON.stringify(canonical(manifestContent(manifest))));
}

export function compareSubmissionManifests(before, after) {
  const keyed = (manifest) => new Map((manifest.files ?? []).map((file) => [`${file.path}:${Boolean(file.linked_content)}`, file]));
  const a = keyed(before), b = keyed(after);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((key) =>
    JSON.stringify(canonical(a.get(key))) !== JSON.stringify(canonical(b.get(key))))
    .map((key) => (a.get(key) ?? b.get(key)).path);
  return { same: before.submission_id === after.submission_id, changed_files: [...new Set(changed)].sort(),
    before_submission_id: before.submission_id, after_submission_id: after.submission_id };
}
