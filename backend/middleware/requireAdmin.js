const { verifyTelegramInitData } = require('../modules/users');

// Single shared Channel Admin authorization check.
//
// This does NOT rely on a static secret sent from the browser (which,
// for a Vite app, would necessarily end up inside the public JS bundle
// and be readable by anyone). Instead it reuses the same mechanism
// already used to log users in: Telegram signs `initData` with an
// HMAC keyed on BOT_TOKEN (server-only, never shipped to the client).
// We re-verify that signature here and check the *verified* Telegram
// user ID against a server-side admin allowlist — nothing the client
// sends can forge this without BOT_TOKEN.
function getAdminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Reusable check for routes that want to know "is this a known admin
// Telegram ID" without hard-failing the request the way requireAdmin
// does (e.g. feed gating, where non-admins still get a valid response,
// just without premium media attached).
function isAdminId(telegramId) {
  if (!telegramId) return false;
  return getAdminIds().includes(String(telegramId));
}

function requireAdmin(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    const reason = 'No Telegram init data was received by the server.';
    console.warn('[requireAdmin] rejected:', reason);
    return res.status(403).json({ error: reason });
  }

  const telegramUser = verifyTelegramInitData(initData);
  if (!telegramUser) {
    const reason = 'Telegram signature verification failed (BOT_TOKEN mismatch, or the session is stale — try reopening the app).';
    console.warn('[requireAdmin] rejected:', reason);
    return res.status(403).json({ error: reason });
  }

  const adminIds = getAdminIds();
  if (adminIds.length === 0) {
    const reason = 'ADMIN_TELEGRAM_IDS is not set (or empty) on the server.';
    console.warn('[requireAdmin] rejected:', reason);
    return res.status(403).json({ error: reason });
  }
  if (!adminIds.includes(String(telegramUser.id))) {
    const reason = `Your Telegram ID (${telegramUser.id}) is not in ADMIN_TELEGRAM_IDS (currently configured: ${adminIds.join(', ')}).`;
    console.warn('[requireAdmin] rejected:', reason);
    return res.status(403).json({ error: reason });
  }

  req.adminTelegramId = telegramUser.id;
  next();
}

module.exports = requireAdmin;
module.exports.isAdminId = isAdminId;
