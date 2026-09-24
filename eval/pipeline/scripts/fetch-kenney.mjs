import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'kenney-catalog.json'), 'utf8'));

function destRoot() {
  return process.env.EVAL_ASSET_LIBRARY || path.resolve(here, '../../assets/library');
}

async function download(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: { 'user-agent': 'eval-kenney-fetch/1' } });
  if (!res.ok || !res.body) throw new Error(`${url} ${res.status}`);
  await pipeline(res.body, createWriteStream(file));
}

const root = destRoot();
fs.mkdirSync(root, { recursive: true });
for (const pack of catalog) {
  const packDir = path.join(root, pack.category, pack.slug);
  if (fs.existsSync(packDir) && fs.readdirSync(packDir).length) {
    process.stderr.write(`skip ${pack.slug}\n`);
    continue;
  }
  const zip = path.join(root, pack.category, `${pack.slug}.zip`);
  process.stderr.write(`fetch ${pack.slug}\n`);
  if (!fs.existsSync(zip)) await download(pack.zip_url, zip);
  fs.mkdirSync(packDir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', packDir], { stdio: 'inherit' });
  fs.unlinkSync(zip);
  process.stderr.write(`ok ${pack.slug}\n`);
}
process.stdout.write(`${root}\n`);
