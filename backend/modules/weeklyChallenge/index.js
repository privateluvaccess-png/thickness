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

function previousWeekKey() {
  return currentWeekKey(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
}

async function settlePreviousWeekIfNeeded() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const weekKey = previousWeekKey();

  const { error: gateError } = await supabase
    .from('weekly_challenge_settlements')
    .insert({ week_key: weekKey });
  if (gateError) {
    if (gateError.code === '23505') return;
    throw gateError;
  }

  const { data: top3, error } = await supabase
    .from('user_xp_weekly')
    .select('user_id, xp')
    .eq('week_key', weekKey)
    .order('xp', { ascending: false })
    .limit(3);
  if (error) throw error;
  if (!top3 || top3.length === 0) return;

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

// Seeded users for social proof. These are display-only — they are
// never written to the DB, so they can NEVER win weekly rewards.
// Rewards always settle against real users only (settlePreviousWeekIfNeeded
// queries user_xp_weekly directly). IDs use a string prefix so they
// can never collide with real Telegram IDs (positive integers).
//
// XP is intentionally high to make the top 3 hard to displace.
// A real user who earns more XP than a seed naturally rises above it —
// the two lists are merged and sorted together. Real users who crack
// the top 3 in the DB will get their weekly reward regardless of
// where the seeds sit, because settlement is DB-only.
const SEEDED_USERS = [
  { userId: 'seed_01', displayName: 'anya_xo',      xp: 4820 },
  { userId: 'seed_02', displayName: 'Mila_real',     xp: 4210 },
  { userId: 'seed_03', displayName: 'sofia.tm',      xp: 3670 },
  { userId: 'seed_04', displayName: 'Nastya_v',      xp: 3140 },
  { userId: 'seed_05', displayName: 'kris_daily',    xp: 2690 },
  { userId: 'seed_06', displayName: 'Dasha99',       xp: 2210 },
  { userId: 'seed_07', displayName: 'lera.xo',       xp: 1780 },
  { userId: 'seed_08', displayName: 'Vika_active',   xp: 1340 },
  { userId: 'seed_09', displayName: 'polina_tm',     xp: 940  },
  { userId: 'seed_10', displayName: 'Kate_real',     xp: 580  },
];

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

  const realEntries = (topRows || []).map(r => ({
    userId: r.user_id,
    xp: r.xp,
    displayName: usersById[r.user_id]?.username || usersById[r.user_id]?.first_name || `User ${r.user_id}`,
  }));

  // Merge seeds with real users, sort by XP, re-rank.
  // Real users who out-earn a seed naturally displace it.
  const top = [...SEEDED_USERS, ...realEntries]
    .sort((a, b) => b.xp - a.xp)
    .slice(0, Math.min(limit, 20))
    .map((row, i) => ({ ...row, rank: i + 1 }));

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

    // Offset the DB rank by however many seeds sit above the user's XP.
    const seededAbove = SEEDED_USERS.filter(s => s.xp > myXp).length;
    const adjustedRank = (higherCount || 0) + 1 + seededAbove;

    const thirdPlaceXp = top[2]?.xp ?? 0;
    me = {
      xp: myXp,
      rank: adjustedRank,
      xpToThirdPlace: adjustedRank > 3 ? Math.max(0, thirdPlaceXp - myXp) : 0,
    };
  }

  return { weekKey, top, me };
}

module.exports = { getSettings, updateSettings, getLeaderboard, settlePreviousWeekIfNeeded };
