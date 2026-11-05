// Auto-posts new FREE-channel videos to your X (Twitter) account.
//
// Rules baked in:
//  - Only videos from the FREE tier are ever posted (premium is paywalled).
//  - Posts never contain links (X charges ~13x more for posts with a URL),
//    so any URL in the caption is stripped.
//  - Hard daily cap (default 5). Once the cap is hit, new videos that day are
//    simply skipped (not queued). The count resets at midnight in your
//    timezone (default WAT, UTC+1).
//  - Nothing here can break normal uploads: every failure is caught + logged.
//
// Env vars (set on Render):
//   X_AUTOPOST_ENABLED=true        master switch (anything else = off)
//   X_API_KEY, X_API_SECRET        your X app's consumer keys
//   X_ACCESS_TOKEN, X_ACCESS_SECRET  your account's access token + secret
//   X_DAILY_LIMIT=5                optional, default 5
//   X_DAY_OFFSET_HOURS=1           optional, default 1 (WAT). Day resets at local midnight.

const crypto = require('crypto');
const supabase = require('../../supabase');

const API = 'https://api.x.com';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per APPEND (X max is 5 MB recommended)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── OAuth 1.0a signing (no extra npm package needed) ─────────────────────────
// JSON and multipart bodies are NOT part of the signature; only the URL's
// query params and the oauth_* params are.
function pct(s) {
  return encodeURIComponent(String(s)).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function authHeader(method, fullUrl) {
  const url = new URL(fullUrl);
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const all = [];
  for (const [k, v] of url.searchParams.entries()) all.push([pct(k), pct(v)]);
  for (const [k, v] of Object.entries(oauth)) all.push([pct(k), pct(v)]);
  all.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  const paramString = all.map(([k, v]) => `${k}=${v}`).join('&');
  const baseUrl = `${url.origin}${url.pathname}`;
  const baseString = [method.toUpperCase(), pct(baseUrl), pct(paramString)].join('&');
  const signingKey = `${pct(process.env.X_API_SECRET)}&${pct(process.env.X_ACCESS_SECRET)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(', ')
  );
}

async function xFetch(method, path, { json, form } = {}) {
  const url = `${API}${path}`;
  const headers = { Authorization: authHeader(method, url) };
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // fetch sets the multipart boundary itself
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const detail = data?.detail || data?.title || text.slice(0, 200);
    const err = new Error(`X ${method} ${path} -> ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Chunked video upload ─────────────────────────────────────────────────────
async function uploadVideo(buffer, mimeType) {
  const init = await xFetch('POST', '/2/media/upload/initialize', {
    json: { media_type: mimeType, total_bytes: buffer.length, media_category: 'tweet_video' },
  });
  const mediaId = init?.data?.id;
  if (!mediaId) throw new Error('X did not return a media id');

  let segment = 0;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
    const form = new FormData();
    form.append('segment_index', String(segment));
    form.append('media', new Blob([chunk], { type: mimeType }), 'chunk.mp4');
    await xFetch('POST', `/2/media/upload/${mediaId}/append`, { form });
    segment += 1;
  }

  const fin = await xFetch('POST', `/2/media/upload/${mediaId}/finalize`);
  let info = fin?.data?.processing_info;

  // Wait (max ~2 minutes) for X to finish processing the video.
  const deadline = Date.now() + 120 * 1000;
  while (info && info.state !== 'succeeded') {
    if (info.state === 'failed') {
      throw new Error(`X video processing failed: ${info.error?.message || 'unknown'}`);
    }
    if (Date.now() > deadline) throw new Error('X video processing timed out');
    await sleep(Math.max(1, info.check_after_secs || 2) * 1000);
    const status = await xFetch('GET', `/2/media/upload?command=STATUS&media_id=${mediaId}`);
    info = status?.data?.processing_info;
  }
  return mediaId;
}

// ── Daily cap (stored in Supabase so it survives Render restarts) ────────────
function dayStartUtcIso() {
  const offsetH = Number(process.env.X_DAY_OFFSET_HOURS ?? 1);
  const offsetMs = (Number.isFinite(offsetH) ? offsetH : 1) * 3600 * 1000;
  const localNow = Date.now() + offsetMs;
  const localMidnight = Math.floor(localNow / 86400000) * 86400000;
  return new Date(localMidnight - offsetMs).toISOString();
}

async function postedToday() {
  const { count, error } = await supabase
    .from('x_post_log')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'posted')
    .gte('created_at', dayStartUtcIso());
  if (error) throw error;
  return count || 0;
}

async function logResult(postId, status, tweetId, errorMsg) {
  const { error } = await supabase.from('x_post_log').insert({
    post_id: String(postId),
    status,
    tweet_id: tweetId || null,
    error: errorMsg ? String(errorMsg).slice(0, 500) : null,
  });
  if (error) console.error('x_post_log insert failed:', error.message);
}

// ── Caption: no links, max 280 chars ─────────────────────────────────────────
function buildText(caption) {
  if (!caption) return '';
  let t = caption.replace(/https?:\/\/\S+/gi, '').replace(/\bt\.me\/\S+/gi, '');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (t.length > 280) t = t.slice(0, 277).trimEnd() + '...';
  return t;
}

// ── Main entry ───────────────────────────────────────────────────────────────
// X posts run strictly one at a time, so two videos arriving together can't
// both slip past the daily cap.
let queue = Promise.resolve();

function autoPostVideoToX(post, tier) {
  queue = queue
    .then(() => run(post, tier))
    .catch((err) => console.error('X autopost error:', err.message));
  return queue;
}

async function run(post, tier) {
  if (process.env.X_AUTOPOST_ENABLED !== 'true') return;
  if (!post || post.type !== 'video') return;
  if (tier !== 'free') return;                 // never post paywalled content
  if (!post.media_url) return;                 // R2 copy missing, nothing to upload
  for (const k of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']) {
    if (!process.env[k]) { console.error(`X autopost: ${k} is not set`); return; }
  }

  const limit = Math.max(1, Number(process.env.X_DAILY_LIMIT) || 5);
  const used = await postedToday();
  if (used >= limit) {
    console.log(`X autopost: daily cap reached (${used}/${limit}), skipping post ${post.id}`);
    return;
  }

  try {
    const res = await fetch(post.media_url);
    if (!res.ok) throw new Error(`could not download video (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || '').startsWith('video/')
      ? res.headers.get('content-type').split(';')[0]
      : 'video/mp4';

    const mediaId = await uploadVideo(buffer, mime);

    const payload = { media: { media_ids: [mediaId] } };
    const text = buildText(post.caption);
    if (text) payload.text = text;

    const created = await xFetch('POST', '/2/tweets', { json: payload });
    const tweetId = created?.data?.id;
    await logResult(post.id, 'posted', tweetId, null);
    console.log(`X autopost: posted ${post.id} as tweet ${tweetId} (${used + 1}/${limit} today)`);
  } catch (err) {
    // A failure does NOT use up any of today's 5.
    await logResult(post.id, 'failed', null, err.message);
    console.error('X autopost failed:', err.message);
  }
}

module.exports = { autoPostVideoToX };
