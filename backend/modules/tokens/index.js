const supabase = require('../../supabase');
const { getUserById } = require('../users');

// ── Packs (what users can buy) ──────────────────────────────────────────────
async function listPacks({ activeOnly = true } = {}) {
  let q = supabase.from('token_packs').select('id, tokens, stars, active, sort_order');
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q.order('sort_order', { ascending: true }).order('tokens', { ascending: true });
  if (error) throw error;
  return data || [];
}

function cleanInt(v, max) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
}

async function createPack(tokens, stars) {
  const t = cleanInt(tokens, 1000000), s = cleanInt(stars, 100000);
  if (!t || !s) throw new Error('Tokens and Stars must be whole numbers above 0.');
  const { data: last } = await supabase.from('token_packs').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  const sort = (last?.[0]?.sort_order || 0) + 1;
  const { data, error } = await supabase.from('token_packs').insert({ tokens: t, stars: s, sort_order: sort }).select().single();
  if (error) throw error;
  return data;
}

async function updatePack(id, fields) {
  const patch = {};
  if (fields.tokens !== undefined) { const t = cleanInt(fields.tokens, 1000000); if (!t) throw new Error('Invalid tokens.'); patch.tokens = t; }
  if (fields.stars !== undefined)  { const s = cleanInt(fields.stars, 100000);  if (!s) throw new Error('Invalid Stars.');  patch.stars = s; }
  if (typeof fields.active === 'boolean') patch.active = fields.active;
  const { data, error } = await supabase.from('token_packs').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deletePack(id) {
  await supabase.from('token_packs').delete().eq('id', id);
}

// ── Balances ────────────────────────────────────────────────────────────────
async function getBalance(userId) {
  if (!userId) return 0;
  const { data } = await supabase.from('token_balances').select('balance').eq('user_id', String(userId)).maybeSingle();
  return data?.balance || 0;
}

async function credit({ userId, amount, kind, stars = 0, chargeId = null, note = null, adminId = null }) {
  const { data, error } = await supabase.rpc('token_credit', {
    p_user: String(userId), p_amount: amount, p_kind: kind, p_stars: stars,
    p_charge: chargeId, p_note: note, p_admin: adminId ? String(adminId) : null,
  });
  if (error) throw error;
  const row = data?.[0] || {};
  return { credited: !!row.ok, balance: row.new_balance ?? 0 };
}

// Called by the bot after Telegram confirms a Stars payment.
// productKey looks like "tk_500" (the token amount is baked into the invoice
// payload by OUR server when the invoice was created).
async function fulfillTokenPayment(productKey, telegramId, payment) {
  const amount = Number(productKey.split('_')[1]);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Bad token payload');
  return credit({
    userId: telegramId, amount, kind: 'purchase',
    stars: payment?.total_amount || 0, chargeId: payment?.telegram_payment_charge_id || null,
  });
}

// ── Admin ───────────────────────────────────────────────────────────────────
async function adminGrant(userId, amount, adminTelegramId, note) {
  const id = String(userId || '').trim();
  const n = Number(amount);
  if (!/^\d+$/.test(id)) throw new Error('Enter the user\'s numeric Telegram ID.');
  if (!Number.isInteger(n) || n <= 0 || n > 1000000) throw new Error('Amount must be a whole number above 0.');

  const user = await getUserById(id).catch(() => null);
  if (!user) throw new Error('No user with that Telegram ID has opened the app.');

  const result = await credit({
    userId: id, amount: n, kind: 'admin_grant', note: note || null, adminId: adminTelegramId,
  });

  // Best-effort heads-up in Telegram (fails silently if the user blocked the bot).
  try {
    const bot = require('../../bot');
    await bot.telegram.sendMessage(id, `🎁 You received ${n} battle tokens! Open the Battle tab to use them. ⚔️`);
  } catch { /* ignore */ }

  return { ...result, name: user.first_name || user.username || id };
}

async function getUserSummary(userId) {
  const id = String(userId || '').trim();
  const user = await getUserById(id).catch(() => null);
  const balance = await getBalance(id);
  const { data: history } = await supabase
    .from('token_ledger').select('delta, kind, stars, note, created_at')
    .eq('user_id', id).order('created_at', { ascending: false }).limit(10);
  return { found: !!user, name: user?.first_name || user?.username || null, balance, history: history || [] };
}

async function getStats() {
  const { data } = await supabase.rpc('token_stats');
  const r = data?.[0] || {};
  return {
    tokens_sold: Number(r.tokens_sold) || 0,
    stars_earned: Number(r.stars_earned) || 0,
    tokens_granted: Number(r.tokens_granted) || 0,
    tokens_spent: Number(r.tokens_spent) || 0,
    tokens_outstanding: Number(r.tokens_outstanding) || 0,
  };
}

module.exports = {
  listPacks, createPack, updatePack, deletePack,
  getBalance, credit, fulfillTokenPayment,
  adminGrant, getUserSummary, getStats,
};
