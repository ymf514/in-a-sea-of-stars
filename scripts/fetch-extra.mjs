// Finds more openly licensed images for the archive through the Openverse API
// (Creative Commons search across Flickr, Wikimedia and others).
//
//   node scripts/fetch-extra.mjs
//
// Writes originals to ../STARS/data/pic_extra/ and a manifest with full credits
// (pic_manifest_extra.csv, same columns as pic_manifest_255-700.csv). Images already
// in the original manifest are skipped. Existing files are never touched; re-running
// tops each category up to PER_CATEGORY and keeps what was already downloaded.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(ROOT, '../STARS/data');
const OUT = path.join(DATA, 'pic_extra');
const MANIFEST = path.join(DATA, 'pic_manifest_extra.csv');
const PER_CATEGORY = 44;
const PER_QUERY = 6;
const LICENSES = 'by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd,cc0,pdm';

// New search words per human category (none repeat the original manifest's queries).
const QUERIES = {
  '01_Direct': ['star anise spice', 'starfish aquarium', 'star cookies baking', 'star shaped lights', 'star garland', 'star confetti', 'starfruit slice', 'star shaped cookie cutter', 'sea star tide pool', 'star quilt', 'star tile pattern', 'star balloon', 'shooting star', 'star sticker', 'star shaped window', 'star christmas lights', 'star pinata', 'star embroidery'],
  '02_Named': ['starbucks cafe', 'star wars figure', 'star trek', 'starbucks drink', 'star wars poster', 'starliner', 'star ferry hong kong', 'star alliance airplane', 'lone star beer', 'star wars cosplay', 'starbucks logo', 'star trek convention', 'starling bird', 'star magnolia flower', 'starship enterprise model', 'star market'],
  '03_Represented': ['red carpet', 'celebrity', 'concert singer', 'award trophy', 'olympic medal', 'paparazzi', 'gold star chart classroom', 'five star hotel entrance', 'trophy winner', 'medal ceremony', 'concert crowd fans', 'autograph signing', 'film festival red carpet', 'champion celebration', 'idol concert', 'fan meeting'],
  '04_Associated': ['night sky', 'moon', 'astronomy', 'space art', 'sparkle lights', 'wish lantern', 'fireflies night', 'full moon night', 'dream catcher', 'snowflake macro', 'glow in the dark stars ceiling', 'meteor shower', 'campfire night sky', 'night light lamp', 'moon lamp'],
  '05_Unrelated': ['fork', 'kettle', 'scissors', 'bucket', 'tomato', 'door', 'teacup', 'stapler', 'garden hose', 'rubber duck', 'paper clips', 'parking lot', 'office chair', 'spoon', 'traffic cone', 'socks', 'onion', 'notebook desk']
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const csv = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');

const original = await fs.readFile(path.join(DATA, 'pic_manifest_255-700.csv'), 'utf8');
const seen = new Set(original.match(/https?:\/\/[^,"\n]+/g) || []);
await fs.mkdir(OUT, { recursive: true });

// Keep what an earlier run already downloaded.
const rows = (await fs.readFile(MANIFEST, 'utf8').catch(() => '')).split('\n').slice(1).filter(Boolean)
  .map(line => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, 8).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
rows.forEach(r => { seen.add(r[4]); seen.add(r[5]); });
let n = rows.reduce((m, r) => Math.max(m, Number(r[0].slice(1, 4)) || 0), 0);
for (const [category, queries] of Object.entries(QUERIES)) {
  let got = rows.filter(r => r[1] === category).length;
  for (const q of queries) {
    if (got >= PER_CATEGORY) break;
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=${LICENSES}&page_size=20&mature=false`;
    let results = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': 'in-a-sea-of-stars student project' } });
      if (res.status === 429) { console.log('    (rate limited — waiting a minute)'); await sleep(60000); continue; }
      if (res.ok) results = (await res.json()).results || [];
      break;
    }
    let fromQuery = 0;
    for (const r of results) {
      if (got >= PER_CATEGORY || fromQuery >= PER_QUERY) break;
      if (!r.url || seen.has(r.url) || seen.has(r.foreign_landing_url)) continue;
      if ((r.width && r.width < 400) || (r.height && r.height < 300)) continue;
      try {
        const res = await fetch(r.url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(buf).metadata();                   // must be a real, decodable image
        if (!meta.width || meta.width < 300 || meta.height < 300) continue;
        const file = `x${String(++n).padStart(3, '0')}.jpg`;
        await sharp(buf).rotate().jpeg({ quality: 90 }).toFile(path.join(OUT, file));
        seen.add(r.url); seen.add(r.foreign_landing_url);
        rows.push([file, category, q, r.title || q, r.url, r.foreign_landing_url, r.license, r.creator || '']);
        got++; fromQuery++;
      } catch { /* skip images that cannot be downloaded or decoded */ }
    }
    console.log(`  ${category} · "${q}" → ${fromQuery} (${got}/${PER_CATEGORY})`);
    await sleep(6000);                                              // stay well under the API rate limit
  }
  if (got < PER_CATEGORY) console.warn(`! ${category}: only ${got} images found`);
}

await fs.writeFile(MANIFEST, ['file,category,query,title,image_url,source_page,license,creator', ...rows.map(r => r.map(csv).join(','))].join('\n') + '\n');
console.log(`✓ ${rows.length} images → ${path.relative(ROOT, OUT)} · credits in ${path.relative(ROOT, MANIFEST)}`);
