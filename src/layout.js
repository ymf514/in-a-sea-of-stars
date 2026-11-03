// Scatters archive stars over the sea. Deterministic: the same LAYOUT values always
// give the same sea, so a star keeps its place between visits.
// Density is tuned in src/config.js → LAYOUT.

import { LAYOUT } from './config.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rejection sampling in a disc. If the sea is too small for the spacing, it quietly
// grows the radius a little rather than overlapping stars.
export function scatter(count, { seaRadius, minSpacing, harbourRadius, seed } = LAYOUT) {
  const random = mulberry32(seed);
  const points = [];
  let radius = seaRadius, misses = 0;
  while (points.length < count) {
    const r = Math.sqrt(random()) * radius;
    const a = random() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x, z) < harbourRadius || points.some(p => Math.hypot(p.x - x, p.z - z) < minSpacing)) {
      if (++misses > 3000) { radius *= 1.05; misses = 0; }
      continue;
    }
    misses = 0;
    points.push({ x: +x.toFixed(2), z: +z.toFixed(2) });
  }
  return points;
}
