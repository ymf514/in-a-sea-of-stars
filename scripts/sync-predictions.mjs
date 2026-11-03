// Uploads every cached reading in src/data/predictions.json to the Supabase
// `predictions` table (insert or update), 100 rows at a time.
//
//   npm run sync
//
// Needs SUPABASE_SERVICE_ROLE_KEY in .env (the secret key, never prefixed VITE_).

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.VITE_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const { stars } = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/predictions.json'), 'utf8'));
const rows = Object.entries(stars).map(([starId, r]) => ({
  star_id: starId,
  tm: r.predictions.tm, clip: r.predictions.clip, mn: r.predictions.mn,
  analysis_status: r.analysisStatus, model_version: r.modelVersion,
  updated_at: r.analyzedAt || new Date().toISOString()
}));

for (let i = 0; i < rows.length; i += 100) {
  const { error } = await db.from('predictions').upsert(rows.slice(i, i + 100));
  if (error) { console.error(`✗ rows ${i + 1}–${i + 100}: ${error.message}`); process.exit(1); }
  console.log(`  ${Math.min(i + 100, rows.length)}/${rows.length}`);
}
console.log(`✓ ${rows.length} readings saved to Supabase`);
