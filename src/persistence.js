// Visitor notes, released stars and stored machine readings — backed by Supabase.
// Configure VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env (see .env.example).
// The anon / publishable key is meant to be public: what visitors may do is enforced by
// the row-level security in supabase/schema.sql. Never put the service-role key in a
// VITE_ variable — those ship to the browser.
// Without configuration, notes fall back to this browser's localStorage and released
// stars only live for the current session.

import { createClient } from '@supabase/supabase-js';

const URL_ = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const isRemote = Boolean(URL_ && KEY);
const db = isRemote ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null;

const BUCKET = 'released-stars';
const LOCAL_KEY = 'sea-stars-notes';
const clientId = (() => {
  try {
    let id = localStorage.getItem('sea-stars-client');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('sea-stars-client', id); }
    return id;
  } catch { return 'anonymous'; }
})();

// Postgres errors raised by our rate-limit trigger are already visitor-friendly.
function check({ data, error }) {
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'The sea could not be reached just now.');
  return data;
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}

export async function loadNotes(starId) {
  if (!isRemote) return (readLocal()[starId] || []).map(text => ({ text }));
  return check(await db.from('responses').select('text, created_at').eq('star_id', starId).order('created_at'));
}

export async function saveNote(starId, text) {
  if (!isRemote) {
    const all = readLocal();
    (all[starId] ??= []).push(text);
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch {}
    return;
  }
  check(await db.from('responses').insert({ star_id: starId, text, client_id: clientId }));
}

const imageUrlFor = id => db.storage.from(BUCKET).getPublicUrl(`${id}.jpg`).data.publicUrl;

// Stars other visitors released.
export async function loadReleasedStars() {
  if (!isRemote) return [];
  const rows = check(await db.from('released_stars').select('id, title, x, z').order('created_at'));
  return rows.map(r => ({ starId: r.id, title: r.title, x: r.x, z: r.z, imageUrl: imageUrlFor(r.id) }));
}

// The row goes first (it carries the rate limit); storage only accepts an image
// for a freshly created row. Returns { starId, imageUrl }, or null when local-only.
export async function releaseStar({ imageDataURL, title, x, z }) {
  if (!isRemote) return null;
  const id = 'upload_' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  check(await db.from('released_stars').insert({ id, title, x, z, client_id: clientId }));
  const blob = await (await fetch(imageDataURL)).blob();
  const { error } = await db.storage.from(BUCKET).upload(`${id}.jpg`, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('The image could not be kept.');
  return { starId: id, imageUrl: imageUrlFor(id) };
}

// { [starId]: { predictions: {tm, clip, mn}, analysisStatus, modelVersion } }
export async function loadPredictions() {
  if (!isRemote) return {};
  // Supabase returns at most 1000 rows per request, so read in pages.
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await db.from('predictions').select('star_id, tm, clip, mn, analysis_status, model_version').order('star_id').range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return Object.fromEntries(rows.map(r => [r.star_id, {
    predictions: { tm: r.tm, clip: r.clip, mn: r.mn },
    analysisStatus: r.analysis_status,
    modelVersion: r.model_version
  }]));
}

// Downscale before upload/display so a 12 MB photo becomes a few hundred KB.
export async function shrinkImage(file, maxSide = 1024, quality = .82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
