const supabase = require('../../supabase');

let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getNewUserSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const { data, error } = await supabase.from('new_user_settings').select('*').eq('id', 1).single();
  if (error) throw error;

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

async function updateNewUserSettings(fields, adminTelegramId) {
  const patch = {};
  if (Number.isInteger(Number(fields.duration_days)) && Number(fields.duration_days) > 0) {
    patch.duration_days = Number(fields.duration_days);
  }

  const { data, error } = await supabase
    .from('new_user_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;

  cache = { data: null, expiresAt: 0 };
  return data;
}

// A missing/unparseable created_at is treated as "not new" — safer
// default than accidentally treating every user as new forever.
async function isNewUser(user) {
  if (!user?.created_at) return false;
  const settings = await getNewUserSettings();
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  return ageMs < settings.duration_days * 24 * 60 * 60 * 1000;
}

module.exports = { getNewUserSettings, updateNewUserSettings, isNewUser };
