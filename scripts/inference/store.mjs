// Writes machine readings to Supabase with the secret (service-role) key.
// Only local scripts use this key; it is read from .env without a VITE_ prefix,
// so Vite never ships it to the browser.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const remoteEnabled = Boolean(url && key);
const db = remoteEnabled ? createClient(url, key, { auth: { persistSession: false } }) : null;

export async function savePrediction(starId, { predictions, analysisStatus, modelVersion }) {
  if (!db) return;
  const { error } = await db.from('predictions').upsert({
    star_id: starId,
    tm: predictions.tm, clip: predictions.clip, mn: predictions.mn,
    analysis_status: analysisStatus, model_version: modelVersion,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(error.message);
}
