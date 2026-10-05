#!/usr/bin/env node
/**
 * Write .response.json for a pending cloud-agent builder request after boot passes.
 * Usage: node scripts/fulfill-cloud-request.mjs <request.json path>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pipeline = path.resolve(here, '..');

async function main() {
  const reqPath = process.argv[2];
  if (!reqPath) {
    console.error('usage: fulfill-cloud-request.mjs <path-to-request.json>');
    process.exit(1);
  }
  const req = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  const { spec } = req;
  const id = req.id || path.basename(reqPath).replace(/\.request\.json$/, '');
  const dir = path.dirname(reqPath);
  const resPath = path.join(dir, `${id}.response.json`);

  if (spec.role === 'looks') {
    const stdout = process.env.LOOKS_STDOUT || '';
    fs.writeFileSync(resPath, `${JSON.stringify({ stdout, exitCode: 0 })}\n`);
    console.log('wrote looks response', resPath);
    return;
  }
  if (spec.role !== 'builder') {
    console.error('only builder/looks supported');
    process.exit(1);
  }

  const { checkOnegameBoot } = await import(path.join(pipeline, 'src/p1-onegame.mjs'));
  const { checkGodotBoot } = await import(path.join(pipeline, 'src/p1-godot.mjs'));
  const { auditModelSubmission } = await import(path.join(pipeline, 'src/model-builder.mjs'));

  try {
    auditModelSubmission(spec.workspace, spec.engine, spec.taskId);
  } catch (err) {
    console.error('audit failed', err.message);
    fs.writeFileSync(resPath, `${JSON.stringify({ stdout: '', exitCode: 1, stderr: String(err.message) })}\n`);
    process.exit(1);
  }
  const boot =
    spec.engine === 'onegame'
      ? await checkOnegameBoot(spec.workspace)
      : await checkGodotBoot(spec.workspace, spec.taskId);
  if (!boot.ok) {
    console.error('boot failed', boot);
    fs.writeFileSync(
      resPath,
      `${JSON.stringify({ stdout: '', exitCode: 1, stderr: (boot.notes || []).join('\n') })}\n`,
    );
    process.exit(1);
  }
  fs.writeFileSync(resPath, `${JSON.stringify({ stdout: '', exitCode: 0 })}\n`);
  console.log('wrote builder response', resPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
