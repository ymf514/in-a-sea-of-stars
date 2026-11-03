// Runs the three models over every archive star once and caches the readings.
//
//   npm run analyze              analyse stars that have no cached reading yet
//   npm run analyze -- --force   re-analyse everything (e.g. after changing PROMPTS)
//
// Results go to src/data/predictions.json (read by the site). If .env contains
// SUPABASE_SERVICE_ROLE_KEY (the secret key — never prefix it with VITE_), each
// reading is also upserted into the Supabase `predictions` table.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, loadModels } from './inference/models.mjs';
import { savePrediction, remoteEnabled } from './inference/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = path.join(ROOT, 'src/data/archive.json');
const CACHE = path.join(ROOT, 'src/data/predictions.json');
const FORCE = process.argv.includes('--force');

const archive = JSON.parse(await fs.readFile(ARCHIVE, 'utf8')).stars;
const cache = await fs.readFile(CACHE, 'utf8').then(JSON.parse, () => ({ stars: {} }));
const todo = archive.filter(s => FORCE || !cache.stars[s.id]);
console.log(`${todo.length} of ${archive.length} stars to analyse${remoteEnabled ? ' · syncing to Supabase' : ' · local cache only'}`);
if (!todo.length) process.exit(0);

await loadModels();
const write = () => fs.writeFile(CACHE, JSON.stringify({ updated: new Date().toISOString(), stars: cache.stars }, null, 1));
const started = Date.now();
for (const [i, star] of todo.entries()) {
  const result = await analyse(path.join(ROOT, 'Pic', star.image));
  if (result.errors) console.warn(`  ! ${star.id}`, result.errors);
  const { errors, ...record } = result;
  cache.stars[star.id] = { ...record, analyzedAt: new Date().toISOString() };
  try { await savePrediction(star.id, record); } catch (err) { console.warn(`  ! ${star.id} not synced: ${err.message}`); }
  if ((i + 1) % 10 === 0 || i === todo.length - 1) {
    await write();
    const each = (Date.now() - started) / (i + 1) / 1000;
    console.log(`  ${i + 1}/${todo.length} · ${each.toFixed(1)}s each · ~${Math.ceil(each * (todo.length - i - 1) / 60)} min left`);
  }
}
console.log(`✓ readings cached in ${path.relative(ROOT, CACHE)}`);
