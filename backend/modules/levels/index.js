const supabase = require('../../supabase');

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getLevelSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const { data, error } = await supabase.from('level_settings').select('*').eq('id', 1).single();
  if (error) throw error;

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

async function updateLevelSettings(fields, adminTelegramId) {
  const patch = {};
  if (Number.isInteger(Number(fields.xp_base)) && Number(fields.xp_base) > 0) patch.xp_base = Number(fields.xp_base);
  if (Number.isInteger(Number(fields.xp_increment)) && Number(fields.xp_increment) >= 0) {
    patch.xp_increment = Number(fields.xp_increment);
  }

  const { data, error } = await supabase
    .from('level_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;

  cache = { data: null, expiresAt: 0 };
  return data;
}

// XP needed to go from level N to N+1 = xp_base + (N-1) * xp_increment.
// Derived purely from lifetime_xp — nothing about "level" is ever
// stored, so changing the curve retroactively re-levels everyone
// consistently rather than needing a migration.
const MAX_ITERATIONS = 2000; // safety cap against pathological settings

function computeLevel(lifetimeXp, xpBase, xpIncrement) {
  let level = 1;
  let remaining = lifetimeXp;
  let xpForNext = xpBase;
  let iterations = 0;

  while (remaining >= xpForNext && iterations < MAX_ITERATIONS) {
    remaining -= xpForNext;
    level++;
    xpForNext = xpBase + (level - 1) * xpIncrement;
    iterations++;
  }

  return { level, xpIntoLevel: remaining, xpForNextLevel: xpForNext };
}

async function getLevelInfo(lifetimeXp) {
  const settings = await getLevelSettings();
  return computeLevel(lifetimeXp, settings.xp_base, settings.xp_increment);
}

module.exports = { getLevelSettings, updateLevelSettings, getLevelInfo, computeLevel };
