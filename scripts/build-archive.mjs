// Builds the explorable archive from the original STARS collection.
//
//   npm run build:archive
//
// - Picks a balanced, deterministic selection from the manifest (same seed → same stars).
// - Compresses each original into Pic/star_###.webp (originals are never modified),
//   plus a square Pic/thumb/star_###.webp that is wrapped onto the 3D paper star.
// - Writes src/data/archive.json with persistent IDs, human categories, credits and
//   empty prediction slots. Predictions are filled later by the inference module.
// - Positions on the sea are NOT stored here: src/layout.js scatters the stars at
//   runtime from src/config.js, so density can be tuned without rebuilding.
//
// Re-running keeps IDs stable as long as SEED / PER_CATEGORY / the manifest stay the same.
// Already-compressed images are skipped; pass --force to recompress them all.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(ROOT, '../STARS/data/pic');
const MANIFEST = path.resolve(ROOT, '../STARS/data/pic_manifest_255-700.csv');
// Extra openly licensed batches (optional), appended in this order after the original
// selection so earlier IDs never change: star_001–300 original, 301–520 batch 1
// (scripts/fetch-extra.mjs, Openverse), 521– batch 2 (scripts/fetch-commons.mjs, Wikimedia Commons).
const EXTRAS = [
  { dir: 'pic_extra', manifest: 'pic_manifest_extra.csv' },
  { dir: 'pic_extra2', manifest: 'pic_manifest_extra2.csv' }
].map(e => ({ dir: path.resolve(ROOT, '../STARS/data', e.dir), manifest: path.resolve(ROOT, '../STARS/data', e.manifest), name: e.dir }));
const OUT_IMAGES = path.join(ROOT, 'Pic');
const OUT_JSON = path.join(ROOT, 'src/data/archive.json');

const SEED = 20261028;
const PER_CATEGORY = 60;          // TUNE: 每类图片数量 · 5 categories × 60 = 300 stars
const MAX_SIDE = 640;             // TUNE: 压缩后最长边（px）
const WEBP_QUALITY = 78;          // TUNE: WebP 质量 0–100（越高越清晰、文件越大）
const THUMB_SIDE = 256;           // TUNE: 贴在 3D 星星上的方形小图边长（px）· 越大越清晰、显存越多
const FORCE = process.argv.includes('--force');

// ---------------------------------------------------------------- helpers

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Minimal RFC-4180 CSV parser (titles contain quoted commas).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ---------------------------------------------------------------- build

const manifest = parseCSV(await fs.readFile(MANIFEST, 'utf8'));
const byCategory = new Map();
for (const row of manifest) {
  const name = row.category.replace(/^\d+_/, '');       // "01_Direct" → "Direct"
  if (!byCategory.has(name)) byCategory.set(name, []);
  byCategory.get(name).push(row);
}

let picked = [];
for (const [name, rows] of byCategory) {
  const chosen = shuffle(rows).slice(0, PER_CATEGORY);
  if (chosen.length < PER_CATEGORY) console.warn(`! ${name}: only ${chosen.length} images available`);
  picked.push(...chosen.map(row => ({ row, category: name })));
}
picked = shuffle(picked);                                 // mix categories across the sea
picked.forEach(p => { p.dir = SOURCE_DIR; });

// Each batch has its own seeded shuffle, so adding a batch never changes earlier stars.
for (const [b, extra] of EXTRAS.entries()) {
  const rows = await fs.readFile(extra.manifest, 'utf8').then(parseCSV, () => []);
  if (!rows.length) continue;
  const extraRandom = mulberry32(SEED + 1 + b);
  const mixed = rows.map(row => ({ row, category: row.category.replace(/^\d+_/, ''), dir: extra.dir, batch: extra.name, k: extraRandom() }))
    .sort((a, b2) => a.k - b2.k);
  picked.push(...mixed);
  console.log(`+ ${mixed.length} extra images from ${path.relative(ROOT, extra.manifest)}`);
}

await fs.mkdir(path.join(OUT_IMAGES, 'thumb'), { recursive: true });
await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });

// Stars left out to keep the sea light (scripts/trim-archive.mjs). Their numbers stay
// unused, so every other star keeps its ID.
const removed = new Set((await fs.readFile(path.join(ROOT, 'scripts/archive-removed.txt'), 'utf8').catch(() => '')).split('\n').filter(Boolean));

const archive = [];
let bytesIn = 0, bytesOut = 0;
for (const [i, { row, category, dir, batch }] of picked.entries()) {
  const id = `star_${String(i + 1).padStart(3, '0')}`;
  if (removed.has(id)) continue;
  const src = path.join(dir, row.file);
  const dest = path.join(OUT_IMAGES, `${id}.webp`);

  const exists = await fs.stat(dest).then(() => true, () => false);
  if (FORCE || !exists) {
    await sharp(src, { failOn: 'none' })
      .rotate()                                            // respect EXIF orientation
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(dest);
  }
  const thumb = path.join(OUT_IMAGES, 'thumb', `${id}.webp`);
  if (FORCE || !(await fs.stat(thumb).then(() => true, () => false))) {
    await sharp(dest)
      .resize(THUMB_SIDE, THUMB_SIDE, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 80 })
      .toFile(thumb);
  }
  // Dominant colour tints the star's light pool on the water.
  const { dominant } = await sharp(thumb).stats();
  const color = '#' + [dominant.r, dominant.g, dominant.b].map(v => v.toString(16).padStart(2, '0')).join('');
  bytesIn += (await fs.stat(src)).size;
  bytesOut += (await fs.stat(dest)).size + (await fs.stat(thumb)).size;

  archive.push({
    id,
    image: `${id}.webp`,
    thumb: `thumb/${id}.webp`,
    color,
    title: row.title || row.query || id,
    humanCategories: [category],
    originalFile: batch ? `${batch}/${row.file}` : row.file,
    source: {
      query: row.query || null,
      page: row.source_page || null,
      license: row.license || null,
      creator: row.creator || null
    },
    analysisStatus: 'pending',
    predictions: { tm: null, clip: null, mn: null }
  });
  if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${picked.length}`);
}

await fs.writeFile(OUT_JSON, JSON.stringify({
  version: 1,
  generated: new Date().toISOString(),
  seed: SEED,
  note: 'predictions are null until real inference runs; null means "not analysed", never "unrelated".',
  stars: archive
}, null, 1));

const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
console.log(`✓ ${archive.length} stars · originals ${mb(bytesIn)} → compressed ${mb(bytesOut)}`);
console.log(`  images → ${path.relative(ROOT, OUT_IMAGES)}/   data → ${path.relative(ROOT, OUT_JSON)}`);
