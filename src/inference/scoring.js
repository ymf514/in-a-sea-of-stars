// Shared scoring rules for the three models — used by the Node inference scripts
// (scripts/inference/*) and by the browser (lighting + Polaroid).
// Ported from the "Is It a Star?" prototype (sketch.js) so results stay comparable.
//
// Unknown is not Unrelated: when MobileNet's labels match nothing in the Star
// vocabulary, its score is null ("not yet named"), never 0.

import { MODELS } from '../config.js';

export const CATEGORIES = ['Direct', 'Named', 'Represented', 'Associated', 'Unrelated'];

// CLIP prompt set. Bump PROMPT_VERSION whenever the wording changes, so stored
// results record which descriptions produced them.
export const PROMPT_VERSION = 'v1-is-it-a-star';
export const PROMPTS = [
  'A photograph or illustration of a real star, planet, celestial body, or star-shaped object.',
  'A movie poster, song cover, product or brand with star in its title or name.',
  'A star symbol used to express fame, celebrity, awards, ratings, recognition or success.',
  'An image indirectly associated with stars through culture, space aesthetics, hope or dreams.',
  'An ordinary image unrelated to stars, celestial objects, star shapes or star-related names.'
];

// Subjective experimental vocabulary — edit freely (TUNE). MobileNet labels are matched
// against these words; the highest matching score wins for each label.
export const STAR_WORDS = [
  { words: ['starfish', 'sea star'], score: 1.00 },
  { words: ['star'], score: 0.98 },
  { words: ['planet', 'moon', 'galaxy', 'nebula'], score: 0.95 },
  { words: ['solar system', 'night sky', 'constellation'], score: 0.95 },
  { words: ['sun', 'solar', 'comet', 'meteor'], score: 0.90 },
  { words: ['telescope', 'astronaut'], score: 0.78 },
  { words: ['spacecraft', 'space shuttle'], score: 0.75 },
  { words: ['rocket', 'satellite'], score: 0.65 },
  { words: ['firework', 'sparkler'], score: 0.55 },
  { words: ['medal', 'trophy', 'award'], score: 0.50 },
  { words: ['flower', 'sunflower'], score: 0.30 },
  { words: ['lamp', 'candle', 'light'], score: 0.25 },
  { words: ['person', 'human', 'face', 'portrait'], score: 0.10 },
  { words: ['coffee', 'mug', 'cup', 'cat', 'dog', 'chair', 'table', 'car'], score: 0.00 }
];

// Teachable Machine labels, including the Chinese aliases used while training.
const CATEGORY_ALIASES = [
  ['direct', '直接', '视觉', '几何', '与星星几何相关'],
  ['named', '名称', '命名', '语言', '语意', '语义', '与星星语意相关'],
  ['represented', '象征', '隐喻', '代表', '明星'],
  ['associated', '联想', '文化', '间接', '关联'],
  ['unrelated', '不相关', '无关', 'none']
];

const normalize = (values) => {
  const total = values.reduce((a, b) => a + b, 0);
  return total > 0 ? values.map(v => v / total) : values.map(() => 0);
};
const topOf = (scores) => CATEGORIES[scores.indexOf(Math.max(...scores))];
const asRecord = (scores) => Object.fromEntries(CATEGORIES.map((c, i) => [c, +scores[i].toFixed(4)]));

// [{ className, probability }] in model order → TM prediction record.
export function scoreTM(predictions) {
  const scores = Array(5).fill(0), used = new Set();
  predictions.forEach((p, order) => {
    const raw = String(p.className || '').trim().toLowerCase();
    const name = raw.replace(/^\d+\s*[/._:\- ]+\s*/, '').trim();
    let index = CATEGORY_ALIASES.findIndex(group => group.includes(name));
    if (index < 0) { const m = raw.match(/^class\s*(\d+)$/); if (m) index = Number(m[1]) - 1; }
    if (index < 0) index = order;                       // fall back to training order
    if (index >= 0 && index < 5 && !used.has(index)) { scores[index] = Number(p.probability) || 0; used.add(index); }
  });
  if (used.size !== 5) throw new Error('Teachable Machine labels could not be mapped to the five categories');
  const n = normalize(scores);
  return { scores: asRecord(n), top: topOf(n), starScore: +(1 - n[4]).toFixed(4) };
}

// [{ label, score }] from the zero-shot pipeline → CLIP prediction record.
export function scoreCLIP(results) {
  const n = normalize(PROMPTS.map(prompt => Number(results.find(r => r.label === prompt)?.score) || 0));
  return { scores: asRecord(n), top: topOf(n), starScore: +(1 - n[4]).toFixed(4), promptVersion: PROMPT_VERSION };
}

function lookupStarWord(label) {
  let best = null;
  for (const group of STAR_WORDS) for (const word of group.words) {
    const re = new RegExp('(^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z])', 'i');
    if (re.test(label) && (!best || group.score > best.score)) best = { word, score: group.score };
  }
  return best;
}

// [{ className, probability }] top-k → MobileNet record. Only matched labels count.
export function scoreMobileNet(results) {
  const labels = results.map(r => {
    const match = lookupStarWord(r.className);
    return { label: r.className, confidence: +Number(r.probability).toFixed(4), word: match?.word ?? null, wordScore: match?.score ?? null };
  });
  const matched = labels.filter(l => l.wordScore !== null);
  const weight = matched.reduce((a, l) => a + l.confidence, 0);
  const starScore = matched.length && weight > 0 ? +(matched.reduce((a, l) => a + l.wordScore * l.confidence, 0) / weight).toFixed(4) : null;
  return { labels, matched: matched.length > 0, starScore };
}

// ------------------------------------------------------------------ reading the results

export const starScoreOf = (prediction) => typeof prediction?.starScore === 'number' ? prediction.starScore : null;

// Weighted mean of the models that have a reading (MODELS.weights); null if none.
export function combinedScore(predictions) {
  let sum = 0, weight = 0;
  for (const [key, w] of Object.entries(MODELS.weights)) {
    const v = starScoreOf(predictions?.[key]);
    if (v !== null && w > 0) { sum += v * w; weight += w; }
  }
  return weight > 0 ? sum / weight : null;
}

// Spread between the highest and lowest available model score (null with < 2 readings).
export function disagreementOf(predictions) {
  const values = ['tm', 'clip', 'mn'].map(k => starScoreOf(predictions?.[k])).filter(v => v !== null);
  return values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
}

export function agreementLabel(predictions) {
  const d = disagreementOf(predictions);
  if (d === null) return null;
  if (d >= MODELS.disagreement) return 'disagree';
  if (d >= MODELS.partialAgreement) return 'partial';
  return 'agree';
}
