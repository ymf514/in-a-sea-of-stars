// Loads Teachable Machine, CLIP and MobileNet once, in Node, and analyses images.
// Rendering never waits on this: the browser only reads cached results.
//
// Preprocessing mirrors the browser libraries used in the "Is It a Star?" prototype:
//   TM        — centre square crop → 224 → pixels / 127 − 1 (as @teachablemachine/image)
//   MobileNet — @tensorflow-models/mobilenet v2 (alpha 1.0), top-k labels
//   CLIP      — Xenova/clip-vit-base-patch32, q8, zero-shot against PROMPTS

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-wasm';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { pipeline, env, RawImage } from '@huggingface/transformers';
import sharp from 'sharp';
import { PROMPTS, PROMPT_VERSION, scoreTM, scoreCLIP, scoreMobileNet } from '../../src/inference/scoring.js';
import { MODELS } from '../../src/config.js';

export const TM_URL = 'https://teachablemachine.withgoogle.com/models/8-twB42kE/';
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
export const MODEL_VERSION = `tm:8-twB42kE · clip:${CLIP_MODEL}@q8 · mn:mobilenet_v2_1.0 · prompts:${PROMPT_VERSION}`;

env.allowRemoteModels = true;

let loaded = null;

export function loadModels(log = console.log) {
  loaded ??= (async () => {
    // WASM is several times faster than the pure-JS CPU backend; fall back if unavailable.
    if (!(await tf.setBackend('wasm').catch(() => false))) await tf.setBackend('cpu');
    await tf.ready();
    log(`· TensorFlow.js backend: ${tf.getBackend()}`);

    log('· loading Teachable Machine…');
    const tmModel = await tf.loadLayersModel(TM_URL + 'model.json');
    const tmLabels = (await (await fetch(TM_URL + 'metadata.json')).json()).labels;

    log('· loading MobileNet…');
    const mnModel = await mobilenet.load({ version: 2, alpha: 1.0 });

    log('· loading CLIP (first run downloads ~90 MB, then it is cached)…');
    const clip = await pipeline('zero-shot-image-classification', CLIP_MODEL, { device: 'cpu', dtype: 'q8' });

    log(`✓ models ready · TM labels: ${tmLabels.join(', ')}`);
    return { tmModel, tmLabels, mnModel, clip };
  })();
  return loaded;
}

async function pixels(input, side, fit) {
  const { data, info } = await sharp(input).rotate().removeAlpha()
    .resize(side, side, { fit, position: 'centre' }).raw().toBuffer({ resolveWithObject: true });
  return tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
}

// input: file path or image Buffer. Each model fails independently — a failed model
// is recorded as null with an error note, never as a low score.
export async function analyse(input) {
  const { tmModel, tmLabels, mnModel, clip } = await loadModels();
  const out = { tm: null, clip: null, mn: null, errors: {} };

  try {
    const img = await pixels(input, 224, 'cover');
    const values = tf.tidy(() => tmModel.predict(img.toFloat().div(127).sub(1).expandDims(0)).dataSync());
    img.dispose();
    out.tm = scoreTM(tmLabels.map((className, i) => ({ className, probability: values[i] })));
  } catch (err) { out.errors.tm = String(err.message || err); }

  try {
    const img = await pixels(input, 224, 'cover');
    const results = await mnModel.classify(img, MODELS.mobilenetTopK);
    img.dispose();
    out.mn = scoreMobileNet(results);
  } catch (err) { out.errors.mn = String(err.message || err); }

  try {
    const png = await sharp(input).rotate().removeAlpha().png().toBuffer();
    const image = await RawImage.fromBlob(new Blob([png], { type: 'image/png' }));
    out.clip = scoreCLIP(await clip(image, PROMPTS));
  } catch (err) { out.errors.clip = String(err.message || err); }

  const done = ['tm', 'clip', 'mn'].filter(k => out[k]);
  const scored = ['tm', 'clip', 'mn'].filter(k => typeof out[k]?.starScore === 'number');
  const status = done.length === 0 ? 'failed'
    : scored.length < 2 ? 'uncertain'                       // too few models could read it
    : 'completed';
  if (!Object.keys(out.errors).length) delete out.errors;
  return { predictions: { tm: out.tm, clip: out.clip, mn: out.mn }, analysisStatus: status, modelVersion: MODEL_VERSION, errors: out.errors };
}
