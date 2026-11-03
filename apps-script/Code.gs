/**
 * In a Sea of Stars — Google Apps Script backend
 *
 * Stores visitor notes, released (uploaded) stars and, later, model predictions in
 * the project's Google Sheet; uploaded images go to a Drive folder.
 *
 * DEPLOY
 *  1. Open the Sheet → Extensions → Apps Script. Replace Code.gs with this file.
 *  2. Run `setup` once (choose it in the toolbar, press Run, accept the permissions).
 *     It creates the Archive / Responses / Uploads tabs, a Drive folder for images,
 *     and an ADMIN_KEY (shown in the execution log) for writing predictions.
 *  3. Deploy → New deployment → type "Web app"
 *        Execute as: Me      Who has access: Anyone
 *     Copy the /exec URL into the project's .env as VITE_SHEETS_ENDPOINT.
 *  4. After editing this file: Deploy → Manage deployments → edit → New version
 *     (the /exec URL stays the same).
 *
 * MODERATION
 *  Set the `status` cell of any row in Responses or Uploads to "hidden" and it
 *  disappears from the sea. Nothing is ever deleted automatically.
 */

const SHEETS = {
  Archive:   ['star_id', 'tm_json', 'clip_json', 'mn_json', 'analysis_status', 'model_version', 'updated_at'],
  Responses: ['response_id', 'star_id', 'timestamp', 'text', 'client_id', 'status'],
  Uploads:   ['star_id', 'file_id', 'image_url', 'title', 'x', 'z', 'timestamp', 'client_id', 'status']
};

const LIMITS = {
  noteLength: 500,
  titleLength: 120,
  imageBytes: 4 * 1024 * 1024,         // after the browser downscales to 1024px
  notesPerClientPerMinute: 4,
  uploadsPerClientPerHour: 6,
  writesPerMinuteOverall: 60
};

const STAR_ID = /^(star|upload)_[a-z0-9]{3,20}$/;
const PROPS = PropertiesService.getScriptProperties();

// ------------------------------------------------------------------ setup

function setup() {
  const book = SpreadsheetApp.getActive();
  for (const [name, header] of Object.entries(SHEETS)) {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(header);
      sheet.setFrozenRows(1);
    }
  }
  if (!PROPS.getProperty('FOLDER_ID')) {
    const folder = DriveApp.createFolder('In a Sea of Stars — released stars');
    PROPS.setProperty('FOLDER_ID', folder.getId());
  }
  if (!PROPS.getProperty('ADMIN_KEY')) PROPS.setProperty('ADMIN_KEY', Utilities.getUuid());
  Logger.log('Ready. Drive folder: %s', PROPS.getProperty('FOLDER_ID'));
  Logger.log('ADMIN_KEY (keep private, only for the local prediction tool): %s', PROPS.getProperty('ADMIN_KEY'));
}

// ------------------------------------------------------------------ routes

function doGet(e) {
  return respond(() => {
    const p = e.parameter || {};
    switch (p.action) {
      case 'ping':        return { message: 'The sea is listening.' };
      case 'responses':   return { responses: listResponses(requireStarId(p.starId)) };
      case 'uploads':     return { uploads: listUploads() };
      case 'predictions': return { predictions: listPredictions() };
      default: throw new Error('Unknown action');
    }
  });
}

function doPost(e) {
  return respond(() => {
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (err) { throw new Error('Invalid request'); }
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      rateLimit('all', LIMITS.writesPerMinuteOverall, 60);
      switch (body.action) {
        case 'addResponse':     return addResponse(body);
        case 'uploadStar':      return uploadStar(body);
        case 'savePredictions': return savePredictions(body);
        default: throw new Error('Unknown action');
      }
    } finally {
      lock.releaseLock();
    }
  });
}

// ------------------------------------------------------------------ notes

function addResponse(body) {
  const starId = requireStarId(body.starId);
  const text = clean(body.text, LIMITS.noteLength);
  if (!text) throw new Error('The note is empty.');
  const client = clientOf(body);
  rateLimit('note:' + client, LIMITS.notesPerClientPerMinute, 60);
  const id = 'r_' + Utilities.getUuid().slice(0, 8);
  sheet('Responses').appendRow([id, starId, new Date(), asText(text), client, 'visible']);
  return { responseId: id };
}

function listResponses(starId) {
  return rows('Responses')
    .filter(r => r.star_id === starId && r.status !== 'hidden')
    .map(r => ({ text: String(r.text), timestamp: r.timestamp }));
}

// ------------------------------------------------------------------ released stars

function uploadStar(body) {
  const client = clientOf(body);
  rateLimit('upload:' + client, LIMITS.uploadsPerClientPerHour, 3600);

  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!match) throw new Error('Please release a JPEG, PNG or WebP image.');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > LIMITS.imageBytes) throw new Error('This image is too large.');

  const x = Number(body.x), z = Number(body.z);
  if (!isFinite(x) || !isFinite(z) || Math.abs(x) > 200 || Math.abs(z) > 200) throw new Error('Invalid position.');

  const starId = 'upload_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const title = clean(body.title, LIMITS.titleLength) || 'A released star';
  const blob = Utilities.newBlob(bytes, 'image/' + match[1], starId + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1]));
  const file = DriveApp.getFolderById(PROPS.getProperty('FOLDER_ID')).createFile(blob);
  // Needed so the browser can show it; personal Google accounts allow this,
  // some school / work accounts block "anyone with the link" sharing.
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const imageUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1024';

  sheet('Uploads').appendRow([starId, file.getId(), imageUrl, asText(title), x, z, new Date(), client, 'visible']);
  return { starId, imageUrl };
}

function listUploads() {
  return rows('Uploads')
    .filter(r => r.status !== 'hidden' && r.star_id)
    .map(r => ({ starId: r.star_id, imageUrl: r.image_url, title: String(r.title), x: Number(r.x), z: Number(r.z) }));
}

// ------------------------------------------------------------------ predictions (admin only)

// Called by the local inference tool, never by visitors: requires ADMIN_KEY.
function savePredictions(body) {
  if (!body.adminKey || body.adminKey !== PROPS.getProperty('ADMIN_KEY')) throw new Error('Not allowed');
  const starId = requireStarId(body.starId);
  const p = body.predictions || {};
  const record = [
    starId,
    p.tm == null ? '' : JSON.stringify(p.tm),
    p.clip == null ? '' : JSON.stringify(p.clip),
    p.mn == null ? '' : JSON.stringify(p.mn),
    clean(body.analysisStatus, 20) || 'completed',
    clean(body.modelVersion, 80),
    new Date()
  ];
  const archive = sheet('Archive');
  const ids = archive.getRange(1, 1, Math.max(archive.getLastRow(), 1), 1).getValues().map(r => r[0]);
  const at = ids.indexOf(starId);
  if (at > 0) archive.getRange(at + 1, 1, 1, record.length).setValues([record]);
  else archive.appendRow(record);
  return { starId };
}

function listPredictions() {
  const parse = v => (v === '' || v == null ? null : JSON.parse(v));
  return rows('Archive').map(r => ({
    starId: r.star_id,
    predictions: { tm: parse(r.tm_json), clip: parse(r.clip_json), mn: parse(r.mn_json) },
    analysisStatus: r.analysis_status,
    modelVersion: r.model_version
  }));
}

// ------------------------------------------------------------------ helpers

function respond(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const s = SpreadsheetApp.getActive().getSheetByName(name);
  if (!s) throw new Error('Run setup() first.');
  return s;
}

function rows(name) {
  const values = sheet(name).getDataRange().getValues();
  const [header, ...body] = values;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function requireStarId(id) {
  id = String(id || '');
  if (!STAR_ID.test(id)) throw new Error('Unknown star');
  return id;
}

function clientOf(body) {
  return String(body.clientId || 'anonymous').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'anonymous';
}

function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

// Stop a note beginning with = + - @ from being read as a spreadsheet formula.
function asText(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function rateLimit(key, max, seconds) {
  const cache = CacheService.getScriptCache();
  const k = 'rl:' + key;
  const n = Number(cache.get(k) || 0);
  if (n >= max) throw new Error('The sea needs a moment. Please try again shortly.');
  cache.put(k, String(n + 1), seconds);
}
