const supabase = require('../../supabase');
const { grantEarnedPremium } = require('../subscriptions');

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getGiftHuntSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const { data, error } = await supabase.from('gift_hunt_settings').select('*').eq('id', 1).single();
  if (error) throw error;

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

async function updateGiftHuntSettings(fields, adminTelegramId) {
  const patch = {};
  if (typeof fields.enabled === 'boolean') patch.enabled = fields.enabled;
  if (Number.isInteger(Number(fields.required_actions)) && Number(fields.required_actions) > 0) {
    patch.required_actions = Number(fields.required_actions);
  }
  if (Number.isInteger(Number(fields.reward_days)) && Number(fields.reward_days) > 0) {
    patch.reward_days = Number(fields.reward_days);
  }

  const { data, error } = await supabase
    .from('gift_hunt_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;

  cache = { data: null, expiresAt: 0 };
  return data;
}

// Progress = how many 'rewarded_ad' + 'daily_mission' XP events this
// user has earned today. Nothing to keep in sync — it's read straight
// from the ledger that already exists, using the same
// (user_id, created_at) index the ledger was built with.
async function getTodayProgress(userId) {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('reward_points')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('source', ['rewarded_ad', 'daily_mission'])
    .gte('created_at', startOfDayUtc.toISOString());
  if (error) throw error;

  return count || 0;
}

async function getStatus(userId) {
  const [settings, progress] = await Promise.all([
    getGiftHuntSettings(),
    getTodayProgress(userId),
  ]);

  const dateKey = todayKey();
  const { data: claim } = await supabase
    .from('gift_hunt_claims')
    .select('*')
    .eq('user_id', userId)
    .eq('date_key', dateKey)
    .single();

  return {
    enabled: settings.enabled,
    progress: Math.min(progress, settings.required_actions),
    required: settings.required_actions,
    rewardDays: settings.reward_days,
    readyToClaim: progress >= settings.required_actions && !claim,
    alreadyClaimedToday: !!claim,
  };
}

// Atomic, once-per-day claim. The unique constraint on
// (user_id, date_key) in gift_hunt_claims is the real guarantee here —
// even if this function were somehow called twice concurrently for
// the same user, only one insert succeeds.
async function claim(userId) {
  const settings = await getGiftHuntSettings();
  if (!settings.enabled) return { claimed: false, reason: 'gift hunt is disabled' };

  const progress = await getTodayProgress(userId);
  if (progress < settings.required_actions) {
    return { claimed: false, reason: 'not enough progress yet', progress, required: settings.required_actions };
  }

  const dateKey = todayKey();
  const { error: insertError } = await supabase.from('gift_hunt_claims').insert({
    user_id: userId,
    date_key: dateKey,
    reward_days: settings.reward_days,
  });

  if (insertError) {
    if (insertError.code === '23505') return { claimed: false, reason: 'already claimed today' };
    throw insertError;
  }

  const result = await grantEarnedPremium(userId, settings.reward_days, 'gift_hunt');
  return { claimed: true, rewardDays: settings.reward_days, ...result };
}

module.exports = { getGiftHuntSettings, updateGiftHuntSettings, getStatus, claim };
