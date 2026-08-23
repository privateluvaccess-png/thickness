const supabase = require('../../supabase');
const { awardXp } = require('../xp');
const { getAdSettings } = require('../adSettings');
const { recordMissionAction } = require('../missions');

// Extracts the telegram user id we embedded as a prefix when the
// frontend generated the ymid (see frontend: `u${telegramId}-...`).
// We do this instead of relying solely on Monetag's {telegram_id}
// macro, since their own docs warn it isn't always present.
function parseUserIdFromYmid(ymid) {
  const match = /^u(\d+)-/.exec(ymid || '');
  return match ? match[1] : null;
}

async function getTodayAdEventCount(userId) {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('reward_ad_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('points_awarded', 'is', null)
    .gte('created_at', startOfDayUtc.toISOString());

  if (error) throw error;
  return count || 0;
}

// Most recent successful (rewarded) ad watch, across all time — not
// scoped to "today", since the cooldown needs to work correctly even
// right after a midnight rollover (e.g. watched at 11:50pm, cooldown
// shouldn't reset to zero just because the calendar day changed).
async function getLastRewardedAdAt(userId) {
  const { data, error } = await supabase
    .from('reward_ad_events')
    .select('created_at')
    .eq('user_id', userId)
    .not('points_awarded', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows, expected for a new user
  return data?.created_at || null;
}

// Spreads the daily allowance evenly across 24h rather than letting
// someone burn through all of them back-to-back — e.g. a 5-per-day
// cap means one ad roughly every 4.8 hours.
function cooldownMsFor(dailyLimit) {
  return (24 * 60 * 60 * 1000) / Math.max(1, dailyLimit);
}

// Public status for the frontend button: how many rewarded ads this
// user has already had counted today, the configured daily cap, when
// the daily count resets (next UTC midnight), and — separately —
// when the *next single ad* becomes available if they're currently
// in the per-ad cooldown window. The UI shows whichever countdown is
// actually blocking them.
async function getAdWatchStatus(userId) {
  const settings = await getAdSettings();
  const [used, lastRewardedAt] = await Promise.all([
    getTodayAdEventCount(userId),
    getLastRewardedAdAt(userId),
  ]);

  const resetsAt = new Date();
  resetsAt.setUTCHours(24, 0, 0, 0); // next UTC midnight

  const cooldownMs = cooldownMsFor(settings.daily_ad_limit);
  const nextAvailableAt = lastRewardedAt
    ? new Date(new Date(lastRewardedAt).getTime() + cooldownMs)
    : null;
  const cooldownActive = !!nextAvailableAt && nextAvailableAt.getTime() > Date.now();

  return {
    used,
    limit: settings.daily_ad_limit,
    remaining: Math.max(0, settings.daily_ad_limit - used),
    resetsAt: resetsAt.toISOString(),
    cooldownActive,
    nextAvailableAt: cooldownActive ? nextAvailableAt.toISOString() : null,
  };
}

// Processes one confirmed Monetag postback. Always returns a result
// object rather than throwing for "expected" non-grant outcomes
// (not a valued event, over daily cap, already processed) — those are
// not errors, they're just events that don't earn a reward. The
// caller (route) still responds 200 OK in all of these cases, since a
// non-2xx tells Monetag to retry, which we only want on genuine
// server failure.
async function processMonetagPostback({ ymid, telegramIdFromMacro, format, eventType, rewardEventType, estimatedPrice }) {
  const userId = parseUserIdFromYmid(ymid) || telegramIdFromMacro;
  if (!ymid || !userId) {
    return { granted: false, reason: 'missing ymid or resolvable user id' };
  }

  // Only a confirmed-billable event ever grants a reward. Confirmed
  // directly from live production logs (Aug 23) that this zone sends
  // the literal string "valued" (not "not_valued") for a real reward
  // event — the Monetag dashboard's own description text ("yes"/"no")
  // was simply inaccurate for this product. Trust the logs over the
  // dashboard copy if this ever seems to stop working again.
  const isRewardable = rewardEventType === 'valued';
  if (!isRewardable) {
    await _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points: null });
    return { granted: false, reason: `reward_event_type was "${rewardEventType}", not "valued"` };
  }

  const settings = await getAdSettings();
  const todayCount = await getTodayAdEventCount(userId);
  if (todayCount >= settings.daily_ad_limit) {
    await _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points: null });
    return { granted: false, reason: 'daily ad limit reached' };
  }

  // Server-side enforcement of the spacing — this is the real gate,
  // not just the frontend countdown (which is only a UI convenience
  // and could otherwise be bypassed by calling the ad SDK directly).
  const lastRewardedAt = await getLastRewardedAdAt(userId);
  if (lastRewardedAt) {
    const cooldownMs = cooldownMsFor(settings.daily_ad_limit);
    const elapsedMs = Date.now() - new Date(lastRewardedAt).getTime();
    if (elapsedMs < cooldownMs) {
      await _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points: null });
      return { granted: false, reason: `cooldown active, ${Math.ceil((cooldownMs - elapsedMs) / 60000)} min remaining` };
    }
  }

  const points = settings.xp_per_rewarded_ad;

  // Award XP first — its own unique constraint on (user_id, source,
  // reference_id=ymid) is the real duplicate-prevention backstop, in
  // case this postback is ever retried by Monetag.
  const xpResult = await awardXp(userId, points, 'rewarded_ad', ymid);

  if (xpResult.awarded) {
    // Also counts toward any active "watch ads" mission — the ymid
    // itself is the dedup key, so a retried postback can't double-count.
    recordMissionAction(userId, 'watch_ad', ymid).catch(err =>
      console.error('[rewardedAds] recordMissionAction failed:', err.message)
    );
  }

  await _recordEvent({
    userId, ymid, format, eventType, rewardEventType, estimatedPrice,
    points: xpResult.awarded ? points : null,
  });

  return {
    granted: xpResult.awarded,
    reason: xpResult.awarded ? null : 'already processed (duplicate postback)',
    points: xpResult.awarded ? points : 0,
  };
}

async function _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points }) {
  // ON CONFLICT DO NOTHING equivalent: Supabase JS doesn't expose
  // upsert-ignore directly for a plain insert, so we catch the unique
  // violation and treat it as a no-op (the event was already logged).
  const { error } = await supabase.from('reward_ad_events').insert({
    user_id: userId,
    ad_network: 'monetag',
    ad_event_id: ymid,
    format: format || null,
    event_type: eventType || null,
    reward_event_type: rewardEventType || null,
    estimated_price: estimatedPrice || null,
    points_awarded: points,
  });
  // Postgres unique_violation is code 23505 — safe to ignore here.
  if (error && error.code !== '23505') throw error;
}

module.exports = { processMonetagPostback, parseUserIdFromYmid, getAdWatchStatus };
