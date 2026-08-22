const supabase = require('../../supabase');

// ── Paid / Lifetime Premium (existing `subscriptions` table) ───────────────
// Untouched by earned-reward code. This remains the single source of
// truth for Telegram Stars purchases and lifetime grants.

async function getPaidSubscription(telegramId) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', telegramId)
    .single();

  return data || null;
}

async function activateSubscription(telegramId, days) {
  const isLifetime = days === null;
  const expiresAt = isLifetime
    ? null
    : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', telegramId)
    .single();

  if (existing) {
    await supabase
      .from('subscriptions')
      .update({
        is_lifetime: isLifetime,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', telegramId);
  } else {
    await supabase.from('subscriptions').insert({
      user_id: telegramId,
      is_lifetime: isLifetime,
      expires_at: expiresAt,
    });
  }

  return { success: true };
}

// ── Earned Premium (Gift Hunt, Weekly Challenge, manual admin grants) ──────
// Lives in its own table so it can never overwrite or shorten a paid
// subscription. Stacks non-destructively: a new grant always extends
// from whichever is later — "now", the user's current earned expiry,
// or their current paid expiry — so a reward is never wasted and a
// user's effective access stays continuous.

async function getEarnedPremium(telegramId) {
  const { data } = await supabase
    .from('earned_premium')
    .select('*')
    .eq('user_id', telegramId)
    .single();

  return data || null;
}

async function _writeEarnedPremium(telegramId, newExpiresAt) {
  const { data: existing } = await supabase
    .from('earned_premium')
    .select('*')
    .eq('user_id', telegramId)
    .single();

  if (existing) {
    await supabase
      .from('earned_premium')
      .update({ expires_at: newExpiresAt, updated_at: new Date().toISOString() })
      .eq('user_id', telegramId);
  } else {
    await supabase.from('earned_premium').insert({
      user_id: telegramId,
      expires_at: newExpiresAt,
    });
  }
}

async function _logEarnedPremiumEvent(event) {
  await supabase.from('earned_premium_events').insert(event);
}

// Grants `days` of earned Premium, stacking on top of whichever window
// (now / current earned expiry / current paid expiry) already extends
// furthest into the future. `source` identifies the system granting it
// (e.g. 'gift_hunt', 'weekly_challenge') for the audit trail.
async function grantEarnedPremium(telegramId, days, source, opts = {}) {
  if (!days || days <= 0) throw new Error('days must be a positive number');

  const [paid, earned] = await Promise.all([
    getPaidSubscription(telegramId),
    getEarnedPremium(telegramId),
  ]);

  // A lifetime user doesn't need earned Premium extended — still log
  // the event for the audit trail, but don't create a meaningless row.
  if (paid?.is_lifetime) {
    await _logEarnedPremiumEvent({
      user_id: telegramId,
      action: opts.adminTelegramId ? 'manual_grant' : 'grant',
      source,
      days_granted: days,
      previous_expires_at: earned?.expires_at || null,
      new_expires_at: earned?.expires_at || new Date().toISOString(),
      admin_telegram_id: opts.adminTelegramId || null,
      note: opts.note || 'user already has lifetime Premium — no-op',
    });
    return { alreadyLifetime: true };
  }

  const now = Date.now();
  const paidExpiresMs = paid?.expires_at ? new Date(paid.expires_at).getTime() : 0;
  const earnedExpiresMs = earned?.expires_at ? new Date(earned.expires_at).getTime() : 0;
  const base = Math.max(now, paidExpiresMs, earnedExpiresMs);

  const previousExpiresAt = earned?.expires_at || null;
  const newExpiresAt = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();

  await _writeEarnedPremium(telegramId, newExpiresAt);
  await _logEarnedPremiumEvent({
    user_id: telegramId,
    action: opts.adminTelegramId ? 'manual_grant' : 'grant',
    source,
    days_granted: days,
    previous_expires_at: previousExpiresAt,
    new_expires_at: newExpiresAt,
    admin_telegram_id: opts.adminTelegramId || null,
    note: opts.note || null,
  });

  return { expiresAt: newExpiresAt };
}

// Admin-only: revoke earned Premium (e.g. an incorrectly granted
// reward). Only ever touches the earned track — paid subscriptions
// are never affected by this function.
async function revokeEarnedPremium(telegramId, adminTelegramId, note) {
  const earned = await getEarnedPremium(telegramId);
  const previousExpiresAt = earned?.expires_at || null;
  const now = new Date().toISOString();

  await _writeEarnedPremium(telegramId, now);
  await _logEarnedPremiumEvent({
    user_id: telegramId,
    action: 'manual_revoke',
    source: 'manual',
    days_granted: null,
    previous_expires_at: previousExpiresAt,
    new_expires_at: now,
    admin_telegram_id: adminTelegramId,
    note: note || null,
  });

  return { revoked: true };
}

async function getEarnedPremiumHistory(telegramId, limit = 20) {
  const { data } = await supabase
    .from('earned_premium_events')
    .select('*')
    .eq('user_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 50));

  return data || [];
}

// ── Combined Premium status ─────────────────────────────────────────────────
// Premium = Lifetime OR Paid active OR Earned active.
// `checkSubscription` keeps its existing response shape (isPremium,
// isLifetime, expiresAt) so nothing calling it today needs to change —
// `expiresAt` becomes whichever of paid/earned extends furthest, purely
// for display; the two underlying windows are never merged in storage.
async function checkSubscription(telegramId) {
  const [paid, earned] = await Promise.all([
    getPaidSubscription(telegramId),
    getEarnedPremium(telegramId),
  ]);

  if (paid?.is_lifetime) {
    return { isPremium: true, isLifetime: true };
  }

  const now = Date.now();
  const paidExpiresMs = paid?.expires_at ? new Date(paid.expires_at).getTime() : 0;
  const earnedExpiresMs = earned?.expires_at ? new Date(earned.expires_at).getTime() : 0;

  const isPremium = paidExpiresMs > now || earnedExpiresMs > now;
  const effectiveMs = Math.max(paidExpiresMs, earnedExpiresMs);

  return {
    isPremium,
    expiresAt: effectiveMs > 0 ? new Date(effectiveMs).toISOString() : null,
  };
}

// Detailed breakdown for the Channel Admin panel — shows paid and
// earned windows separately rather than the merged view above.
async function getPremiumBreakdown(telegramId) {
  const [paid, earned] = await Promise.all([
    getPaidSubscription(telegramId),
    getEarnedPremium(telegramId),
  ]);

  const now = Date.now();
  const paidExpiresMs = paid?.expires_at ? new Date(paid.expires_at).getTime() : 0;
  const earnedExpiresMs = earned?.expires_at ? new Date(earned.expires_at).getTime() : 0;

  return {
    isLifetime: !!paid?.is_lifetime,
    paidActive: paidExpiresMs > now,
    paidExpiresAt: paid?.expires_at || null,
    earnedActive: earnedExpiresMs > now,
    earnedExpiresAt: earned?.expires_at || null,
    isPremium: !!paid?.is_lifetime || paidExpiresMs > now || earnedExpiresMs > now,
  };
}

module.exports = {
  checkSubscription,
  activateSubscription,
  grantEarnedPremium,
  revokeEarnedPremium,
  getEarnedPremiumHistory,
  getPremiumBreakdown,
};
