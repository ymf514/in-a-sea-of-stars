// Browser side of inference: asks the local inference server (npm run inference)
// to read a star that has no cached reading. One request at a time; the 3D loop
// never waits on it. If the server is not running, stars simply stay unresolved.

const URL_ = (import.meta.env.VITE_INFERENCE_URL || 'http://localhost:8787').replace(/\/$/, '');

let health = null;
export function inferenceAvailable() {
  health ??= fetch(`${URL_}/health`, { signal: AbortSignal.timeout(1500) })
    .then(r => r.json()).then(h => Boolean(h.ok)).catch(() => false);
  return health;
}

async function asDataURL(src) {
  if (src.startsWith('data:')) return src;
  const blob = await (await fetch(src)).blob();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
}

const pending = new Map();
let chain = Promise.resolve();

// Resolves with { predictions, analysisStatus, modelVersion }; rejects if unavailable.
export function requestReading(item) {
  if (pending.has(item.id)) return pending.get(item.id);
  const job = chain.then(async () => {
    if (!(await inferenceAvailable())) throw new Error('Inference server not running');
    const res = await fetch(`${URL_}/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starId: item.id, image: await asDataURL(item.image) })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Inference failed');
    return data;
  });
  chain = job.catch(() => {});
  pending.set(item.id, job);
  job.catch(() => pending.delete(item.id));
  return job;
}
