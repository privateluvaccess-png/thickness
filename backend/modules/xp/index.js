const supabase = require('../../supabase');

// ── XP / Points Ledger ──────────────────────────────────────────────────────
// This is the ONE place XP ever gets written. Every future reward
// system (Rewarded Ads, Gift Hunt, Daily Missions, Weekly Challenge)
// calls `awardXp` instead of touching any table directly.
//
// The actual insert + aggregate update happens in a single Postgres
// function (`award_xp`, see migrations/002_xp_ledger.sql) so it's
// atomic and needs one network round trip. Passing the same
// `referenceId` twice for the same user+source is a safe no-op —
// Postgres's unique constraint rejects the duplicate before anything
// is double-counted, which is what makes this safe against retries,
// replayed requests, or a flaky rewarded-ad callback firing twice.

// Award `points` XP to `userId` from `source`.
// `referenceId` should be set whenever the source represents a single
// real-world event (an ad completion ID, a "mission:date" key, a gift
// hunt claim ID) — omit it only for one-off/manual awards that are
// intentionally not deduplicated.
async function awardXp(userId, points, source, referenceId = null) {
  if (!points || points <= 0) throw new Error('points must be a positive number');

  const { data, error } = await supabase.rpc('award_xp', {
    p_user_id: userId,
    p_points: points,
    p_source: source,
    p_reference_id: referenceId,
  });
  if (error) throw error;

  const row = data?.[0] || {};
  return {
    awarded: !!row.awarded,       // false means this exact event was already rewarded — not an error
    lifetimeXp: row.lifetime_xp ?? 0,
    weeklyXp: row.weekly_xp ?? 0,
    weekKey: row.week_key ?? null,
  };
}

// Admin-only manual adjustment — still goes through the same atomic
// function and lands in the same ledger, just tagged with who did it
// and why, for the audit trail.
async function manualAwardXp(userId, points, adminTelegramId, note) {
  const { data, error } = await supabase.rpc('award_xp', {
    p_user_id: userId,
    p_points: points,
    p_source: 'manual_admin_adjustment',
    p_reference_id: null,
    p_note: note || null,
    p_admin_telegram_id: String(adminTelegramId),
  });
  if (error) throw error;

  const row = data?.[0] || {};
  return { lifetimeXp: row.lifetime_xp ?? 0, weeklyXp: row.weekly_xp ?? 0, weekKey: row.week_key ?? null };
}

async function getUserXpSummary(userId) {
  const weekKey = currentWeekKey();

  const [{ data: totals }, { data: weekly }] = await Promise.all([
    supabase.from('user_xp_totals').select('lifetime_xp').eq('user_id', userId).single(),
    supabase.from('user_xp_weekly').select('xp').eq('user_id', userId).eq('week_key', weekKey).single(),
  ]);

  return {
    lifetimeXp: totals?.lifetime_xp || 0,
    weeklyXp: weekly?.xp || 0,
    weekKey,
  };
}

async function getUserXpHistory(userId, limit = 20) {
  const { data } = await supabase
    .from('reward_points')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));

  return data || [];
}

// Mirrors the ISO-week format computed server-side in the SQL function,
// so reads for "this week" always agree with what was written.
function currentWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

module.exports = { awardXp, manualAwardXp, getUserXpSummary, getUserXpHistory, currentWeekKey };
