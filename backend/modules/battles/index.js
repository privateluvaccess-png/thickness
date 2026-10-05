const supabase = require('../../supabase');
const { getBalance, listPacks } = require('../tokens');
const { awardXp } = require('../xp');
const { checkSubscription } = require('../subscriptions');

// ── Settings (single row, id = 1) ───────────────────────────────────────────
let settingsCache = { data: null, expiresAt: 0 };

async function getBattleSettings() {
  if (settingsCache.data && Date.now() < settingsCache.expiresAt) return settingsCache.data;
  const { data, error } = await supabase.from('battle_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  settingsCache = { data, expiresAt: Date.now() + 15 * 1000 };
  return data;
}

async function updateBattleSettings(fields, adminTelegramId) {
  const patch = {};
  if (typeof fields.enabled === 'boolean') patch.enabled = fields.enabled;
  const ints = { vote_cost_tokens: 1, round_hours: 1, free_votes_per_battle: 0, winner_xp: 1 };
  for (const [key, min] of Object.entries(ints)) {
    if (fields[key] === undefined) continue;
    const n = Number(fields[key]);
    if (!Number.isInteger(n) || n < min || n > 100000) throw new Error(`${key} must be a whole number of at least ${min}.`);
    patch[key] = n;
  }
  const { data, error } = await supabase
    .from('battle_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: String(adminTelegramId) })
    .eq('id', 1).select().single();
  if (error) throw error;
  settingsCache = { data: null, expiresAt: 0 };
  return data;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const POST_FIELDS = 'id, type, tier, caption, media_url, file_id, audience';

async function getPostsByIds(ids) {
  const clean = [...new Set(ids.filter(Boolean).map(String))];
  if (!clean.length) return {};
  const { data, error } = await supabase.from('posts').select(POST_FIELDS).in('id', clean);
  if (error) throw error;
  return Object.fromEntries((data || []).map(p => [String(p.id), p]));
}

// Premium videos never leave the server for non-premium viewers.
function shapePost(post, canSeePremium) {
  if (!post) return null;
  if (post.tier === 'premium' && !canSeePremium) {
    return { id: post.id, type: post.type, tier: post.tier, caption: post.caption, locked: true };
  }
  const { audience, ...rest } = post;
  return rest;
}

function label(post) {
  return (post?.caption || '(no caption)').slice(0, 60);
}

// ── Round lifecycle (lazy: runs whenever the battle is viewed) ──────────────
async function settleBattle(battle) {
  // Compare-and-set so two requests can't settle (and pay out) the same round.
  const winner = battle.votes_a === battle.votes_b ? null : (battle.votes_a > battle.votes_b ? 'a' : 'b');
  const { data: claimed, error } = await supabase
    .from('battles')
    .update({
      status: 'settled',
      winner_side: winner,
      // Ending early? Record the real end time so "last battle" ordering stays correct.
      ends_at: new Date(Math.min(Date.now(), new Date(battle.ends_at).getTime())).toISOString(),
    })
    .eq('id', battle.id).eq('status', 'active')
    .select().maybeSingle();
  if (error) throw error;
  if (!claimed) return; // someone else already settled it

  if (!winner) return;
  const settings = await getBattleSettings();
  const { data: votes } = await supabase
    .from('battle_votes').select('user_id').eq('battle_id', battle.id).eq('side', winner);
  const voters = [...new Set((votes || []).map(v => v.user_id))];
  for (const userId of voters) {
    try {
      await awardXp(userId, settings.winner_xp, 'battle_winner', `battle:${battle.id}`);
    } catch (err) {
      console.error('[battles] XP payout failed for', userId, err.message);
    }
  }
}

async function startBattle(battle, hours) {
  const now = new Date();
  const { data, error } = await supabase
    .from('battles')
    .update({
      status: 'active',
      starts_at: now.toISOString(),
      ends_at: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
    })
    .eq('id', battle.id).eq('status', 'queued')
    .select().maybeSingle();
  // A unique-index error just means another request already started one.
  if (error && error.code !== '23505') throw error;
  return data || null;
}

// If nothing is queued, pick two random FREE videos that were not just used.
async function autoPick(hours) {
  const { data: recent } = await supabase
    .from('battles').select('post_a, post_b').order('created_at', { ascending: false }).limit(6);
  const used = new Set((recent || []).flatMap(b => [String(b.post_a), String(b.post_b)]));

  const { data: vids } = await supabase
    .from('posts').select('id, audience')
    .eq('type', 'video').eq('tier', 'free')
    .order('created_at', { ascending: false }).limit(200);

  const pool = (vids || []).filter(p => (!p.audience || p.audience === 'everyone'));
  let fresh = pool.filter(p => !used.has(String(p.id)));
  if (fresh.length < 2) fresh = pool;
  if (fresh.length < 2) return null;

  const shuffled = [...fresh].sort(() => Math.random() - 0.5);
  const now = new Date();
  const { data, error } = await supabase.from('battles').insert({
    post_a: String(shuffled[0].id), post_b: String(shuffled[1].id),
    status: 'active', auto_picked: true,
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
  }).select().maybeSingle();
  if (error && error.code !== '23505') throw error;
  return data || null;
}

async function ensureRoundState() {
  const settings = await getBattleSettings();

  const { data: active } = await supabase.from('battles').select('*').eq('status', 'active').maybeSingle();
  if (active && new Date(active.ends_at) <= new Date()) {
    await settleBattle(active);
  } else if (active) {
    return;
  }
  if (!settings.enabled) return;

  const { data: stillActive } = await supabase.from('battles').select('id').eq('status', 'active').maybeSingle();
  if (stillActive) return;

  const { data: next } = await supabase
    .from('battles').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (next) {
    await startBattle(next, settings.round_hours);
  } else {
    await autoPick(settings.round_hours);
  }
}

// ── What the Battle tab shows ───────────────────────────────────────────────
async function getBattleView(userId, { isAdmin = false } = {}) {
  await ensureRoundState();

  const settings = await getBattleSettings();
  const [packs, balance, activeRes, prevRes, sub] = await Promise.all([
    listPacks({ activeOnly: true }),
    userId ? getBalance(userId) : 0,
    supabase.from('battles').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('battles').select('*').eq('status', 'settled').order('ends_at', { ascending: false }).limit(1).maybeSingle(),
    userId ? checkSubscription(userId).catch(() => ({ isPremium: false })) : { isPremium: false },
  ]);

  const canSeePremium = isAdmin || !!sub.isPremium;
  const active = activeRes.data;
  const prev = prevRes.data;

  const posts = await getPostsByIds([active?.post_a, active?.post_b, prev?.post_a, prev?.post_b]);

  let current = null;
  if (settings.enabled && active) {
    let myA = 0, myB = 0, freeUsed = 0;
    if (userId) {
      const { data: mine } = await supabase
        .from('battle_votes').select('side, weight, kind').eq('battle_id', active.id).eq('user_id', String(userId));
      for (const v of mine || []) {
        if (v.side === 'a') myA += v.weight; else myB += v.weight;
        if (v.kind === 'free') freeUsed += v.weight;
      }
    }
    current = {
      id: active.id,
      ends_at: active.ends_at,
      votes_a: active.votes_a,
      votes_b: active.votes_b,
      post_a: shapePost(posts[String(active.post_a)], canSeePremium),
      post_b: shapePost(posts[String(active.post_b)], canSeePremium),
      my_votes_a: myA,
      my_votes_b: myB,
      free_votes_left: Math.max(0, settings.free_votes_per_battle - freeUsed),
    };
  }

  let previous = null;
  if (prev) {
    const winnerPost = prev.winner_side ? posts[String(prev.winner_side === 'a' ? prev.post_a : prev.post_b)] : null;
    previous = {
      id: prev.id,
      votes_a: prev.votes_a,
      votes_b: prev.votes_b,
      winner_side: prev.winner_side,
      winner_post: winnerPost ? { caption: winnerPost.caption } : null,
    };
  }

  return {
    enabled: settings.enabled,
    vote_cost_tokens: settings.vote_cost_tokens,
    winner_xp: settings.winner_xp,
    free_votes_per_battle: settings.free_votes_per_battle,
    balance,
    packs,
    current,
    previous,
  };
}

// ── Voting ──────────────────────────────────────────────────────────────────
async function castTokenVote({ battleId, userId, side, qty }) {
  const n = Number(qty);
  if (!['a', 'b'].includes(side)) throw new Error('Invalid side.');
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('Invalid number of votes.');

  const settings = await getBattleSettings();
  if (!settings.enabled) return { ok: false, reason: 'ended', balance: 0 };

  const cost = n * settings.vote_cost_tokens;
  const { data, error } = await supabase.rpc('battle_vote_tokens', {
    p_battle: battleId, p_user: String(userId), p_side: side, p_weight: n, p_cost: cost,
  });
  if (error) throw error;
  const row = data?.[0] || {};
  return { ok: !!row.ok, reason: row.reason || null, balance: Number(row.new_balance) || 0, cost };
}

async function castFreeVote({ battleId, userId, side }) {
  const settings = await getBattleSettings();
  const { data, error } = await supabase.rpc('battle_cast_vote', {
    p_battle: battleId, p_user: String(userId), p_side: side, p_weight: 1,
    p_stars: 0, p_charge: null, p_kind: 'free', p_free_limit: settings.free_votes_per_battle,
  });
  if (error) throw error;
  const row = data?.[0] || {};
  return { counted: !!row.counted, reason: row.reason || null };
}

// ── Admin ───────────────────────────────────────────────────────────────────
async function adminListBattles() {
  const { data, error } = await supabase
    .from('battles').select('*').order('created_at', { ascending: false }).limit(15);
  if (error) throw error;
  const rows = data || [];
  const posts = await getPostsByIds(rows.flatMap(b => [b.post_a, b.post_b]));
  return {
    battles: rows.map(b => ({
      id: b.id, status: b.status, auto_picked: b.auto_picked,
      votes_a: b.votes_a, votes_b: b.votes_b, tokens_total: b.tokens_total,
      label_a: label(posts[String(b.post_a)]), label_b: label(posts[String(b.post_b)]),
    })),
  };
}

async function adminCreateBattle(postA, postB, adminTelegramId) {
  if (!postA || !postB) throw new Error('Pick two videos.');
  if (String(postA) === String(postB)) throw new Error('Pick two different videos.');
  const posts = await getPostsByIds([postA, postB]);
  const a = posts[String(postA)], b = posts[String(postB)];
  if (!a || !b) throw new Error('One of those videos no longer exists.');
  if (a.type !== 'video' || b.type !== 'video') throw new Error('Battles are for videos only.');

  const { data, error } = await supabase.from('battles').insert({
    post_a: String(postA), post_b: String(postB), status: 'queued', created_by: String(adminTelegramId),
  }).select().single();
  if (error) throw error;

  await ensureRoundState(); // starts it right away if nothing is running
  return data;
}

async function adminDeleteQueued(id) {
  const { error } = await supabase.from('battles').delete().eq('id', id).eq('status', 'queued');
  if (error) throw error;
}

async function adminEndNow(id) {
  const { data: battle } = await supabase.from('battles').select('*').eq('id', id).eq('status', 'active').maybeSingle();
  if (battle) await settleBattle(battle);
  await ensureRoundState();
}

module.exports = {
  getBattleSettings, updateBattleSettings,
  getBattleView, castTokenVote, castFreeVote,
  adminListBattles, adminCreateBattle, adminDeleteQueued, adminEndNow,
};
