// Second batch of archive images from Wikimedia Commons (freely licensed or public
// domain), weighted toward star artworks and everyday photographs of stars.
//
//   node scripts/fetch-commons.mjs
//
// Writes originals to ../STARS/data/pic_extra2/ and credits to pic_manifest_extra2.csv
// (same columns as the other manifests). Re-running tops up to the targets and keeps
// what is already there. Near-duplicates (e.g. many scans of the same painting) are
// skipped with a small perceptual hash, also against all earlier images.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(ROOT, '../STARS/data');
const OUT = path.join(DATA, 'pic_extra2');
const MANIFEST = path.join(DATA, 'pic_manifest_extra2.csv');
const PER_QUERY = 12;
const UA = 'in-a-sea-of-stars/0.1 (student art project, Pratt Institute)';

// [human category, target, search words]
const PLAN = [
  ['04_Associated', 200, [   // star artworks: paintings, prints, charts, textiles, children's drawings
    'starry night painting', 'stars painting', 'night sky painting', 'celestial map engraving', 'constellation chart',
    'astronomical illustration', 'star woodcut', 'moon and stars illustration', 'stained glass star', 'star mosaic',
    'islamic star pattern', 'star quilt', 'star embroidery', 'child drawing', 'zodiac illustration',
    'star wall painting', 'star ceramic tile', 'star sculpture', 'star motif textile', 'star lantern art', 'comet painting', 'star ornament folk art']],
  ['01_Direct', 200, [       // everyday photographs of star shapes
    'star shaped cookies', 'star stickers notebook', 'star shaped earrings jewelry', 'star pendant', 'star pillow', 'star fairy lights',
    'star cake', 'star sprinkles', 'star pasta', 'star print fabric', 'paper star', 'paper star garland',
    'star balloon', 'star lamp', 'star wallpaper', 'starfish on beach', 'star anise', 'star toy',
    'star badge', 'star candle', 'christmas star window', 'star decoration']],
  ['02_Named', 100, ['star wars', 'starbucks', 'star trek', 'starship', 'lone star', 'star ferry', 'starlink', 'star cinema', 'star hotel sign', 'starling']],
  ['03_Represented', 90, ['red carpet', 'walk of fame', 'award trophy', 'gold star', 'concert stage singer', 'autograph', 'star rating', 'medal ceremony', 'celebrity']],
  ['05_Unrelated', 90, ['kettle', 'scissors', 'bucket', 'tomato', 'door', 'umbrella', 'kitchen', 'pencil', 'bus stop', 'potted plant']]
];

const LICENSE = (s = '') => {
  const t = s.toLowerCase();
  if (t.includes('public domain') || t === 'pd' || t.startsWith('pd-')) return 'pdm';
  if (t.startsWith('cc0')) return 'cc0';
  const m = t.match(/cc[ -]?(by(?:-nc)?(?:-sa|-nd)?)/);
  return m ? m[1] : s;                                     // keep the original wording if unusual
};
const strip = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const csv = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
const parseLine = line => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, 8).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));

// 64-bit average hash for near-duplicate detection.
async function ahash(input) {
  const px = await sharp(input).rotate().greyscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const avg = px.reduce((a, b) => a + b, 0) / 64;
  return Array.from(px, v => (v > avg ? 1 : 0)).join('');
}
const close = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i] && ++d > 6) return false; return true; };

await fs.mkdir(OUT, { recursive: true });
const rows = (await fs.readFile(MANIFEST, 'utf8').catch(() => '')).split('\n').slice(1).filter(Boolean).map(parseLine);
const seenUrl = new Set();
for (const f of ['pic_manifest_255-700.csv', 'pic_manifest_extra.csv', 'pic_manifest_extra2.csv'])
  for (const u of (await fs.readFile(path.join(DATA, f), 'utf8').catch(() => '')).match(/https?:\/\/[^,"\n]+/g) || []) seenUrl.add(u);

// Images removed by hand after review (political, explicit, charts, blank) never come back.
for (const u of (await fs.readFile(path.join(DATA, 'pic_extra2_rejected.txt'), 'utf8').catch(() => '')).split('\n')) if (u) seenUrl.add(u.trim());

console.log('· hashing existing images for duplicate checks…');
const hashes = [];
for (const dir of ['pic', 'pic_extra', 'pic_extra2'])
  for (const f of await fs.readdir(path.join(DATA, dir)).catch(() => []))
    if (/\.(jpe?g|png|webp|avif)$/i.test(f)) hashes.push(await ahash(path.join(DATA, dir, f)).catch(() => null));

let n = rows.reduce((m, r) => Math.max(m, Number(r[0].slice(1, 5)) || 0), 0);
for (const [category, target, queries] of PLAN) {
  let got = rows.filter(r => r[1] === category).length;
  for (const q of queries) {
    if (got >= target) break;
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1024`;
    let pages = [];
    try { pages = Object.values((await (await fetch(api, { headers: { 'User-Agent': UA } })).json()).query?.pages || {}); } catch {}
    pages.sort((a, b) => a.index - b.index);
    let fromQuery = 0;
    for (const p of pages) {
      if (got >= target || fromQuery >= PER_QUERY) break;
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl || !/jpeg|png/.test(ii.mime) || ii.width < 400 || ii.height < 300) continue;
      if (seenUrl.has(ii.descriptionurl)) continue;
      const meta = ii.extmetadata || {};
      try {
        const res = await fetch(ii.thumburl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const h = await ahash(buf);
        if (hashes.some(o => o && close(o, h))) continue;          // near-duplicate
        const file = `c${String(++n).padStart(4, '0')}.jpg`;
        await sharp(buf).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(path.join(OUT, file));
        hashes.push(h); seenUrl.add(ii.descriptionurl);
        const title = strip(meta.ObjectName?.value) || p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
        rows.push([file, category, q, title, ii.thumburl, ii.descriptionurl, LICENSE(meta.LicenseShortName?.value), strip(meta.Artist?.value) || 'Wikimedia Commons']);
        got++; fromQuery++;
      } catch { /* skip */ }
      await sleep(250);
    }
    console.log(`  ${category} · "${q}" → ${fromQuery} (${got}/${target})`);
    await sleep(1000);
  }
  if (got < target) console.warn(`! ${category}: only ${got}/${target}`);
  await fs.writeFile(MANIFEST, ['file,category,query,title,image_url,source_page,license,creator', ...rows.map(r => r.map(csv).join(','))].join('\n') + '\n');
}
console.log(`✓ ${rows.length} images in ${path.relative(ROOT, OUT)} · credits in ${path.relative(ROOT, MANIFEST)}`);
