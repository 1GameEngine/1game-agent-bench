import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePngRgba } from './png-nn.mjs';

const PIPELINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVAL_DIR = path.resolve(PIPELINE_DIR, '..');

export function assetLibraryRoot() {
  return process.env.EVAL_ASSET_LIBRARY || path.join(EVAL_DIR, 'assets', 'library');
}

const CELL = 16;
const STEP = 17;

export const TASK_SPRITES = {
  'p1-night-stall': [
    { src: '2D/pixel-platformer-food-expansion/Tiles/tile_0004.png', name: 'bun.png' },
    { src: '2D/pixel-platformer-food-expansion/Tiles/tile_0020.png', name: 'noodle.png' },
    { src: '2D/pixel-platformer-food-expansion/Tiles/tile_0030.png', name: 'tea.png' },
  ],
  'p1-vault-crawl': [
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'wall.png', cell: [0, 0] },
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'floor.png', cell: [1, 0] },
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'door.png', cell: [7, 0] },
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'door-open.png', cell: [8, 0] },
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'chest.png', cell: [13, 0] },
    { src: '2D/roguelike-caves-dungeons/Spritesheet/roguelikeDungeon_transparent.png', name: 'key.png', cell: [15, 0] },
    { src: '2D/roguelike-characters/Spritesheet/roguelikeChar_transparent.png', name: 'player.png', cell: [0, 0] },
    { src: '2D/roguelike-characters/Spritesheet/roguelikeChar_transparent.png', name: 'guard.png', cell: [7, 0] },
  ],
  'p1-chart-rush': [
    // Spritesheet row 4, confirmed by glyph: 166 up, 167 right, 168 down, 169 left.
    { src: '2D/input-prompts-pixel/Tiles/tile_0169.png', name: 'arrow-left.png' },
    { src: '2D/input-prompts-pixel/Tiles/tile_0168.png', name: 'arrow-down.png' },
    { src: '2D/input-prompts-pixel/Tiles/tile_0166.png', name: 'arrow-up.png' },
    { src: '2D/input-prompts-pixel/Tiles/tile_0167.png', name: 'arrow-right.png' },
  ],
};

function rgbaPng(file) {
  const buf = fs.readFileSync(file);
  try {
    return decodePng(buf);
  } catch {
    const tmp = `${file}.rgba.png`;
    const proc = spawnSync('ffmpeg', ['-y', '-i', file, '-pix_fmt', 'rgba', '-update', '1', tmp], {
      stdio: 'ignore',
    });
    if (proc.status !== 0 || !fs.existsSync(tmp)) {
      throw new Error(`cannot decode ${file}`);
    }
    const img = decodePng(fs.readFileSync(tmp));
    fs.unlinkSync(tmp);
    return img;
  }
}

function sliceCell(img, col, row) {
  const x0 = col * STEP;
  const y0 = row * STEP;
  const out = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      const di = (y * CELL + x) * 4;
      if (sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      out[di] = img.rgba[si];
      out[di + 1] = img.rgba[si + 1];
      out[di + 2] = img.rgba[si + 2];
      out[di + 3] = img.rgba[si + 3];
    }
  }
  return toIndexedPng(encodePngRgba(CELL, CELL, out));
}

function toIndexedPng(png) {
  const dir = fs.mkdtempSync(path.join('/tmp', 'kenney-'));
  const raw = path.join(dir, 'raw.png');
  const pal = path.join(dir, 'pal.png');
  const out = path.join(dir, 'out.png');
  fs.writeFileSync(raw, png);
  const gen = spawnSync(
    'ffmpeg',
    ['-y', '-i', raw, '-vf', 'palettegen=reserve_transparent=1', pal],
    { stdio: 'ignore' },
  );
  const use = spawnSync(
    'ffmpeg',
    ['-y', '-i', raw, '-i', pal, '-lavfi', 'paletteuse', out],
    { stdio: 'ignore' },
  );
  if (gen.status !== 0 || use.status !== 0 || !fs.existsSync(out)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return png;
  }
  const indexed = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return indexed;
}

export function mountAssetLibrary(gameDir, taskId) {
  const root = assetLibraryRoot();
  if (!fs.existsSync(root)) return { ok: false, reason: 'library-missing', copied: [] };
  const link = path.join(gameDir, 'asset-library');
  if (!fs.existsSync(link)) {
    fs.symlinkSync(root, link);
  }
  const spec = TASK_SPRITES[taskId] ?? [];
  const dest = path.join(gameDir, 'assets');
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  const cache = new Map();
  for (const item of spec) {
    const from = path.join(root, item.src);
    if (!fs.existsSync(from)) throw new Error(`missing kenney file ${item.src}`);
    const out = path.join(dest, item.name);
    if (item.cell) {
      let img = cache.get(from);
      if (!img) {
        img = rgbaPng(from);
        cache.set(from, img);
      }
      fs.writeFileSync(out, sliceCell(img, item.cell[0], item.cell[1]));
    } else {
      fs.copyFileSync(from, out);
    }
    copied.push(item.name);
  }
  return { ok: true, copied, library: link };
}
