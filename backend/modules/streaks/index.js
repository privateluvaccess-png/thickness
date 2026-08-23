const supabase = require('../../supabase');
const { awardXp } = require('../xp');

let milestonesCache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getActiveMilestones() {
  if (milestonesCache.data && Date.now() < milestonesCache.expiresAt) return milestonesCache.data;

  const { data, error } = await supabase
    .from('streak_milestones')
    .select('*')
    .eq('active', true)
    .order('day_count', { ascending: true });
  if (error) throw error;

  milestonesCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

function invalidateMilestonesCache() {
  milestonesCache = { data: null, expiresAt: 0 };
}

// Called once per genuinely-new daily action (hooked in the missions
// module, which already dedupes "did something new today" via
// mission_action_log — so this never gets called twice for the same
// day's first action). Advances the streak, and if that advance lands
// exactly on a milestone day count, awards its XP.
async function recordActivity(userId) {
  const { data, error } = await supabase.rpc('update_streak', { p_user_id: userId });
  if (error) throw error;

  const row = data?.[0];
  if (!row?.streak_advanced) return row;

  const milestones = await getActiveMilestones();
  const hit = milestones.find(m => m.day_count === row.current_streak);
  if (hit) {
    const dateKey = new Date().toISOString().slice(0, 10);
    // reference_id includes the date so hitting the same milestone
    // again on a future streak (after a reset) is rewarded again,
    // but the same day can't double-award it.
    await awardXp(userId, hit.xp_reward, 'streak_milestone', `streak:${hit.day_count}:${dateKey}`);
  }

  return row;
}

async function getUserStreak(userId) {
  const [{ data: streak }, milestones] = await Promise.all([
    supabase.from('user_streaks').select('*').eq('user_id', userId).single(),
    getActiveMilestones(),
  ]);

  return {
    currentStreak: streak?.current_streak || 0,
    longestStreak: streak?.longest_streak || 0,
    milestones: milestones.map(m => ({
      dayCount: m.day_count,
      xpReward: m.xp_reward,
      badgeTitle: m.badge_title,
      achieved: (streak?.current_streak || 0) >= m.day_count,
    })),
  };
}

// ── Admin CRUD ───────────────────────────────────────────────────────────
async function adminListMilestones() {
  const { data, error } = await supabase.from('streak_milestones').select('*').order('day_count', { ascending: true });
  if (error) throw error;
  return data;
}

async function adminUpsertMilestone({ id, dayCount, xpReward, badgeTitle, active }) {
  const patch = {};
  if (Number.isInteger(Number(dayCount))) patch.day_count = Number(dayCount);
  if (Number.isInteger(Number(xpReward))) patch.xp_reward = Number(xpReward);
  if (typeof badgeTitle === 'string' || badgeTitle === null) patch.badge_title = badgeTitle;
  if (typeof active === 'boolean') patch.active = active;

  let result;
  if (id) {
    const { data, error } = await supabase.from('streak_milestones').update(patch).eq('id', id).select().single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await supabase.from('streak_milestones').insert(patch).select().single();
    if (error) throw error;
    result = data;
  }
  invalidateMilestonesCache();
  return result;
}

async function adminDeleteMilestone(id) {
  const { error } = await supabase.from('streak_milestones').delete().eq('id', id);
  if (error) throw error;
  invalidateMilestonesCache();
  return { success: true };
}

module.exports = {
  recordActivity, getUserStreak,
  adminListMilestones, adminUpsertMilestone, adminDeleteMilestone,
};
