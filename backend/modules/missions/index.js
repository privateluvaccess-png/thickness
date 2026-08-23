const supabase = require('../../supabase');
const { awardXp } = require('../xp');
const { recordActivity: recordStreakActivity } = require('../streaks');

let missionsCache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC, matches the SQL function)
}

async function getActiveMissions() {
  if (missionsCache.data && Date.now() < missionsCache.expiresAt) return missionsCache.data;

  const { data, error } = await supabase
    .from('missions')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  missionsCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

function invalidateMissionsCache() {
  missionsCache = { data: null, expiresAt: 0 };
}

// Called whenever a user does something that might count toward a
// mission (watched an ad, liked a post, bookmarked a post, ...).
// `refId` identifies the specific thing that happened (post id, ad
// ymid) so the same action can't be counted twice in one day even if
// the user repeats it (e.g. like/unlike/like).
async function recordMissionAction(userId, requirementType, refId) {
  const dateKey = todayKey();

  // Dedup first — if this exact action was already logged today,
  // stop here. Insert failing with a unique-violation IS the
  // "already counted" signal, not an error.
  const { error: logError } = await supabase.from('mission_action_log').insert({
    user_id: userId,
    requirement_type: requirementType,
    ref_id: String(refId),
    date_key: dateKey,
  });
  if (logError) {
    if (logError.code === '23505') return { counted: false, reason: 'already counted today' };
    throw logError;
  }

  // This is a genuinely new action for today (not a repeat) — counts
  // as today's "meaningful activity" for the streak too.
  recordStreakActivity(userId).catch(err =>
    console.error('[missions] recordStreakActivity failed:', err.message)
  );

  const missions = await getActiveMissions();
  const matching = missions.filter(m => m.requirement_type === requirementType);
  if (matching.length === 0) return { counted: true, missionsAffected: [] };

  const results = [];
  for (const mission of matching) {
    const { data, error } = await supabase.rpc('increment_mission_progress', {
      p_user_id: userId,
      p_mission_id: mission.id,
      p_requirement_count: mission.requirement_count,
      p_increment: 1,
    });
    if (error) throw error;

    const row = data?.[0];
    if (row?.newly_completed) {
      await awardXp(userId, mission.xp_reward, 'daily_mission', `${mission.id}:${dateKey}`);
    }
    results.push({ missionId: mission.id, title: mission.title, ...row });
  }

  return { counted: true, missionsAffected: results };
}

async function getUserMissionsToday(userId) {
  const dateKey = todayKey();
  const missions = await getActiveMissions();

  const { data: progressRows } = await supabase
    .from('mission_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('date_key', dateKey);

  const progressByMission = Object.fromEntries((progressRows || []).map(p => [p.mission_id, p]));

  return missions.map(m => ({
    id: m.id,
    title: m.title,
    requirementType: m.requirement_type,
    requirementCount: m.requirement_count,
    xpReward: m.xp_reward,
    progress: progressByMission[m.id]?.progress || 0,
    completed: progressByMission[m.id]?.completed || false,
  }));
}

// ── Admin CRUD ───────────────────────────────────────────────────────────
async function adminListMissions() {
  const { data, error } = await supabase.from('missions').select('*').order('sort_order', { ascending: true });
  if (error) throw error;
  return data;
}

async function adminCreateMission({ title, requirementType, requirementCount, xpReward, sortOrder }) {
  const { data, error } = await supabase.from('missions').insert({
    title,
    requirement_type: requirementType,
    requirement_count: requirementCount || 1,
    xp_reward: xpReward || 10,
    sort_order: sortOrder || 0,
  }).select().single();
  if (error) throw error;
  invalidateMissionsCache();
  return data;
}

async function adminUpdateMission(id, fields) {
  const patch = {};
  if (typeof fields.title === 'string') patch.title = fields.title;
  if (typeof fields.requirementType === 'string') patch.requirement_type = fields.requirementType;
  if (Number.isInteger(Number(fields.requirementCount))) patch.requirement_count = Number(fields.requirementCount);
  if (Number.isInteger(Number(fields.xpReward))) patch.xp_reward = Number(fields.xpReward);
  if (typeof fields.active === 'boolean') patch.active = fields.active;
  if (Number.isInteger(Number(fields.sortOrder))) patch.sort_order = Number(fields.sortOrder);
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('missions').update(patch).eq('id', id).select().single();
  if (error) throw error;
  invalidateMissionsCache();
  return data;
}

async function adminDeleteMission(id) {
  const { error } = await supabase.from('missions').delete().eq('id', id);
  if (error) throw error;
  invalidateMissionsCache();
  return { success: true };
}

module.exports = {
  recordMissionAction,
  getUserMissionsToday,
  getActiveMissions,
  adminListMissions,
  adminCreateMission,
  adminUpdateMission,
  adminDeleteMission,
  todayKey,
};
