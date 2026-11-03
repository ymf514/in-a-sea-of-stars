// Local inference service for stars that have no cached reading yet (mostly stars
// released by visitors). The sea keeps rendering while this works in another process.
//
//   npm run inference        → http://localhost:8787
//
// GET  /health              { ok, ready, modelVersion }
// POST /analyze             { starId, image: "data:image/…;base64,…" } → reading
//
// One image is analysed at a time (a queue); results are remembered per starId and,
// when SUPABASE_SERVICE_ROLE_KEY is in .env, saved to Supabase for every visitor.
// Listens on 127.0.0.1 only and accepts requests from local pages only.

import http from 'node:http';
import sharp from 'sharp';
import { analyse, loadModels, MODEL_VERSION } from './inference/models.mjs';
import { savePrediction, remoteEnabled } from './inference/store.mjs';

const PORT = Number(process.env.INFERENCE_PORT || 8787);
const MAX_BODY = 8 * 1024 * 1024;
const STAR_ID = /^(star|upload)_[a-z0-9]{3,20}$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let ready = false;
const results = new Map();
let queue = Promise.resolve();

// One throwaway read compiles the WASM / ONNX kernels, so the first visitor's star
// takes ~0.5 s instead of ~9 s.
const warmUp = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#1555bd' } }).png().toBuffer().then(analyse);

loadModels().then(warmUp).then(() => { ready = true; console.log(`✓ inference ready on http://localhost:${PORT}${remoteEnabled ? ' · saving to Supabase' : ''}`); })
  .catch(err => { console.error('Model loading failed:', err); process.exit(1); });

function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type' } : {})
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('Image too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  const origin = LOCAL_ORIGIN.test(req.headers.origin || '') ? req.headers.origin : null;
  if (req.headers.origin && !origin) return send(res, 403, { error: 'Local pages only' });
  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, ready, modelVersion: MODEL_VERSION }, origin);
  if (req.method !== 'POST' || req.url !== '/analyze') return send(res, 404, { error: 'Not found' }, origin);

  try {
    const { starId, image } = JSON.parse(await readBody(req));
    if (!STAR_ID.test(String(starId))) return send(res, 400, { error: 'Unknown star' }, origin);
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
    if (!match) return send(res, 400, { error: 'Expected a JPEG, PNG or WebP data URL' }, origin);
    if (results.has(starId)) return send(res, 200, results.get(starId), origin);

    const job = queue.then(async () => {
      const t = Date.now();
      const { errors, ...record } = await analyse(Buffer.from(match[2], 'base64'));
      console.log(`  ${starId} · ${record.analysisStatus} · ${Date.now() - t} ms`);
      try { await savePrediction(starId, record); } catch (err) { console.warn(`  ! ${starId} not saved: ${err.message}`); }
      results.set(starId, record);
      return record;
    });
    queue = job.catch(() => {});
    send(res, 200, await job, origin);
  } catch (err) {
    send(res, 500, { error: String(err.message || err) }, origin);
  }
}).listen(PORT, '127.0.0.1', () => console.log(`· inference server listening on http://localhost:${PORT} (loading models…)`));
