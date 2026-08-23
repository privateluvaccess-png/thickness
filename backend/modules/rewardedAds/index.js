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

  // Only a confirmed-billable event ever grants a reward. This
  // specific Monetag product (Telegram Mini App postback) reports
  // this as the literal string "yes" / "no" — NOT "valued", which is
  // what their general web-widget docs describe. Confirm against your
  // own postback config screen if this ever seems to stop working.
  const isRewardable = rewardEventType === 'yes';
  if (!isRewardable) {
    await _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points: null });
    return { granted: false, reason: `reward_event_type was "${rewardEventType}", not "yes"` };
  }

  const settings = await getAdSettings();
  const todayCount = await getTodayAdEventCount(userId);
  if (todayCount >= settings.daily_ad_limit) {
    await _recordEvent({ userId, ymid, format, eventType, rewardEventType, estimatedPrice, points: null });
    return { granted: false, reason: 'daily ad limit reached' };
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

module.exports = { processMonetagPostback, parseUserIdFromYmid };
