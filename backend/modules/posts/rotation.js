// Feed shuffle + "rest weeks" logic.
//
// 1. SHUFFLE: every viewer gets their own order, re-rolled once per day
//    (UTC). The order is derived from a seeded PRNG (seed = user + tier +
//    day), so it is stable while they page through the feed all day —
//    page 2 never repeats page 1 — but different tomorrow and different
//    from other users.
//
// 2. REST WEEKS: every post belongs to a fixed "cohort" (hash of its id).
//    Each week, a window of cohorts is hidden from everyone. The window
//    moves one cohort forward per week, so each cohort rests for
//    `restWeeks` weeks in a row and then comes back.
//        cohorts = restWeeks * 100 / restPercent   (e.g. 2 wks @ 25% -> 8)
//    Cycle length = number of cohorts, in weeks.
//
// 3. FRESH: posts uploaded in the last FRESH_HOURS always show first
//    (newest first) and are never put to rest, so new uploads get seen.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Monday 00:00 UTC — fixed anchor so "week N" is the same for everybody.
const WEEK_ANCHOR = Date.UTC(2024, 0, 1);
const FRESH_HOURS = 48;

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seedStr) {
  const rand = mulberry32(hash32(seedStr));
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function getRotationConfig(settings) {
  const enabled = settings?.feed_shuffle_enabled !== false;
  const restWeeks = Math.min(Math.max(parseInt(settings?.feed_rest_weeks) || 2, 1), 8);
  const restPercent = Math.min(Math.max(parseInt(settings?.feed_rest_percent) || 25, 1), 90);
  const cohorts = Math.max(Math.round((restWeeks * 100) / restPercent), restWeeks + 1);
  return { enabled, restWeeks, cohorts };
}

function isResting(postId, weekIndex, { restWeeks, cohorts }) {
  const cohort = hash32(String(postId)) % cohorts;
  // hidden cohorts this week: weekIndex, weekIndex+1, ... (restWeeks of them)
  const offset = (((cohort - weekIndex) % cohorts) + cohorts) % cohorts;
  return offset < restWeeks;
}

/**
 * rows: [{ id, created_at }] — already limited to what this viewer may see.
 * Returns the ordered rows for this viewer (resting posts removed, fresh
 * posts first, the rest shuffled).
 */
function arrangeFeed(rows, { viewerKey, tier, config, now = Date.now() }) {
  const byNewest = rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!config.enabled) return byNewest;

  const weekIndex = Math.floor((now - WEEK_ANCHOR) / WEEK_MS);
  const dayIndex = Math.floor(now / DAY_MS);
  const freshCutoff = now - FRESH_HOURS * 60 * 60 * 1000;

  const fresh = [];
  const rest = [];
  for (const r of byNewest) {
    if (new Date(r.created_at).getTime() >= freshCutoff) fresh.push(r);
    else if (!isResting(r.id, weekIndex, config)) rest.push(r);
  }
  return [...fresh, ...seededShuffle(rest, `${viewerKey}:${tier || 'all'}:${dayIndex}`)];
}

module.exports = { arrangeFeed, getRotationConfig, isResting };
