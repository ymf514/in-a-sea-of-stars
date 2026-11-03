// Chooses which stars to leave out so the sea stays smaller and smoother to sail.
//
//   node scripts/trim-archive.mjs 800
//
// Unrelated images are always kept. Among the star-related ones, CLIP image
// embeddings find the most repetitive pictures (many starfish, many star cookies…):
// the closest remaining pair loses whichever image is more typical of the rest,
// until the archive is down to the target. Each category keeps at least MIN_PER.
// Writes scripts/archive-removed.txt (one star id per line), which build-archive.mjs
// skips. IDs of the stars that stay never change.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = Number(process.argv[2] || 800);
const MIN_PER = 100;                                   // TUNE: 每个与星星相关的类别至少保留几张
const OUT = path.join(ROOT, 'scripts/archive-removed.txt');
const CACHE = path.join(ROOT, 'scripts/.clip-embeddings.json');

const { stars } = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/archive.json'), 'utf8'));
const cache = JSON.parse(await fs.readFile(CACHE, 'utf8').catch(() => '{}'));
const candidates = stars.filter(s => !s.humanCategories.includes('Unrelated'));

if (candidates.some(s => !cache[s.id])) {
  console.log('· loading CLIP image model…');
  const processor = await AutoProcessor.from_pretrained('Xenova/clip-vit-base-patch32');
  const model = await CLIPVisionModelWithProjection.from_pretrained('Xenova/clip-vit-base-patch32', { dtype: 'q8' });
  let n = 0;
  for (const s of candidates) {
    if (cache[s.id]) continue;
    const png = await sharp(path.join(ROOT, 'Pic', s.image)).resize(224, 224, { fit: 'cover' }).png().toBuffer();
    const image = await RawImage.fromBlob(new Blob([png], { type: 'image/png' }));
    const { image_embeds } = await model(await processor(image));
    const v = Array.from(image_embeds.data), len = Math.hypot(...v);
    cache[s.id] = v.map(x => +(x / len).toFixed(5));
    if (++n % 100 === 0) { console.log(`  ${n} embedded`); await fs.writeFile(CACHE, JSON.stringify(cache)); }
  }
  await fs.writeFile(CACHE, JSON.stringify(cache));
}

const E = candidates.map(s => cache[s.id]);
const sim = E.map(a => E.map(b => a.reduce((t, x, k) => t + x * b[k], 0)));
const alive = new Set(candidates.map((_, i) => i));
const count = {};
for (const s of candidates) count[s.humanCategories[0]] = (count[s.humanCategories[0]] || 0) + 1;
const typicality = i => { let t = 0; for (const j of alive) if (j !== i) t += sim[i][j]; return t / (alive.size - 1); };

const removed = [];
let toRemove = stars.length - TARGET;
while (toRemove > 0) {
  let best = -2, pair = null;
  for (const i of alive) {
    if (count[candidates[i].humanCategories[0]] <= MIN_PER) continue;
    for (const j of alive) if (j !== i && sim[i][j] > best) { best = sim[i][j]; pair = [i, j]; }
  }
  if (!pair) { console.warn('! every category is at its minimum'); break; }
  const [i, j] = pair;
  // Drop the removable one of the pair that is more typical of the whole set.
  const canJ = count[candidates[j].humanCategories[0]] > MIN_PER;
  const drop = canJ && typicality(j) > typicality(i) ? j : i;
  alive.delete(drop); count[candidates[drop].humanCategories[0]]--;
  removed.push({ id: candidates[drop].id, like: candidates[drop === i ? j : i].id, sim: +best.toFixed(3) });
  toRemove--;
}

await fs.writeFile(OUT, removed.map(r => r.id).sort().join('\n') + '\n');
await fs.writeFile(path.join(ROOT, 'scripts/.trim-report.json'), JSON.stringify(removed, null, 1));
console.log(`✓ ${removed.length} stars left out → ${path.relative(ROOT, OUT)}  (similarity of last pair ${removed.at(-1)?.sim})`);
console.log('  kept per category:', { ...count, Unrelated: stars.length - candidates.length });
