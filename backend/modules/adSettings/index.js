const supabase = require('../../supabase');

// One row, three independent on/off flags — one per Monetag ad format
// (zone 11218209, called differently depending on format):
//   inapp_interstitial_enabled    -> show_11218209({ type: 'inApp', ... })
//   rewarded_popup_enabled        -> show_11218209('pop')
//   rewarded_interstitial_enabled -> show_11218209()
//
// Cached briefly in memory: every user's app load reads this, so
// without a cache we'd hit Supabase on every single open.
let cache = { data: null, expiresAt: 0 };
const CACHE_TTL_MS = 30 * 1000;

async function getAdSettings() {
  if (cache.data && Date.now() < cache.expiresAt) return cache.data;

  const { data, error } = await supabase
    .from('ad_settings')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) throw error;

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

// Partial update — only the fields present in `fields` are changed.
async function updateAdSettings(fields, adminTelegramId) {
  const allowed = ['inapp_interstitial_enabled', 'rewarded_popup_enabled', 'rewarded_interstitial_enabled'];
  const patch = {};
  for (const key of allowed) {
    if (typeof fields[key] === 'boolean') patch[key] = fields[key];
  }

  const { data, error } = await supabase
    .from('ad_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;

  cache = { data: null, expiresAt: 0 }; // invalidate so the next read is fresh
  return data;
}

module.exports = { getAdSettings, updateAdSettings };
