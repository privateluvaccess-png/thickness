const supabase = require('../../supabase');
const { currentWeekKey } = require('../xp');
const { grantEarnedPremium } = require('../subscriptions');

let settingsCache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getSettings() {
  if (settingsCache.data && Date.now() < settingsCache.expiresAt) return settingsCache.data;

  const { data, error } = await supabase.from('weekly_challenge_settings').select('*').eq('id', 1).single();
  if (error) throw error;

  settingsCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

async function updateSettings(fields, adminTelegramId) {
  const patch = {};
  if (typeof fields.enabled === 'boolean') patch.enabled = fields.enabled;
  for (const key of ['first_place_days', 'second_place_days', 'third_place_days']) {
    if (Number.isInteger(Number(fields[key])) && Number(fields[key]) > 0) patch[key] = Number(fields[key]);
  }

  const { data, error } = await supabase
    .from('weekly_challenge_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;

  settingsCache = { data: null, expiresAt: 0 };
  return data;
}

// Reuses the exact same ISO-week calculation as the XP ledger, just
// run against a date 7 days ago — correctly handles year boundaries
// without any bespoke "previous week" string arithmetic.
function previousWeekKey() {
  return currentWeekKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
}

// Settles the previous week's top 3 if it hasn't been settled yet.
// Called opportunistically whenever anyone loads the leaderboard —
// no cron job needed. The unique constraint on
// weekly_challenge_settlements.week_key is what actually guarantees
// "exactly once" even under concurrent calls.
async function settlePreviousWeekIfNeeded() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const weekKey = previousWeekKey();

  const { error: gateError } = await supabase
    .from('weekly_challenge_settlements')
    .insert({ week_key: weekKey });
  if (gateError) {
    if (gateError.code === '23505') return; // already settled (or being settled right now)
    throw gateError;
  }

  const { data: top3, error } = await supabase
    .from('user_xp_weekly')
    .select('user_id, xp')
    .eq('week_key', weekKey)
    .order('xp', { ascending: false })
    .limit(3);
  if (error) throw error;
  if (!top3 || top3.length === 0) return; // nobody earned XP that week — nothing to settle

  const rewardDays = [settings.first_place_days, settings.second_place_days, settings.third_place_days];

  for (let i = 0; i < top3.length; i++) {
    const { user_id, xp } = top3[i];
    const days = rewardDays[i];
    await grantEarnedPremium(user_id, days, 'weekly_challenge');
    await supabase.from('weekly_challenge_results').insert({
      week_key: weekKey, rank: i + 1, user_id, xp, reward_days: days,
    });
  }
}

// Top N for the CURRENT (still in progress) week, plus the requesting
// user's rank and how much XP separates them from #3 — all derived
// from the same small per-week table, no full-table scans.
async function getLeaderboard(userId, limit = 10) {
  await settlePreviousWeekIfNeeded().catch(err =>
    console.error('[weeklyChallenge] settlement failed:', err.message)
  );

  const weekKey = currentWeekKey();

  const { data: topRows, error } = await supabase
    .from('user_xp_weekly')
    .select('user_id, xp')
    .eq('week_key', weekKey)
    .order('xp', { ascending: false })
    .limit(Math.min(limit, 20));
  if (error) throw error;

  const userIds = (topRows || []).map(r => r.user_id);
  let usersById = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('telegram_id, username, first_name')
      .in('telegram_id', userIds);
    usersById = Object.fromEntries((users || []).map(u => [u.telegram_id, u]));
  }

  const top = (topRows || []).map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    xp: r.xp,
    displayName: usersById[r.user_id]?.username || usersById[r.user_id]?.first_name || `User ${r.user_id}`,
  }));

  let me = null;
  if (userId) {
    const { data: myRow } = await supabase
      .from('user_xp_weekly')
      .select('xp')
      .eq('user_id', userId)
      .eq('week_key', weekKey)
      .single();
    const myXp = myRow?.xp || 0;

    const { count: higherCount } = await supabase
      .from('user_xp_weekly')
      .select('user_id', { count: 'exact', head: true })
      .eq('week_key', weekKey)
      .gt('xp', myXp);

    const thirdPlaceXp = top[2]?.xp ?? 0;
    me = {
      xp: myXp,
      rank: (higherCount || 0) + 1,
      xpToThirdPlace: (higherCount || 0) >= 3 ? Math.max(0, thirdPlaceXp - myXp) : 0,
    };
  }

  return { weekKey, top, me };
}

module.exports = { getSettings, updateSettings, getLeaderboard, settlePreviousWeekIfNeeded };
