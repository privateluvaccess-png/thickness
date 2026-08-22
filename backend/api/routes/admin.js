const router = require('express').Router();
const supabase = require('../../supabase');
const { uploadToR2 } = require('../../modules/r2');
const { getPostsAdmin } = require('../../modules/posts');
const {
  getPremiumBreakdown,
  grantEarnedPremium,
  revokeEarnedPremium,
  getEarnedPremiumHistory,
} = require('../../modules/subscriptions');
const { getUserXpSummary, getUserXpHistory, manualAwardXp } = require('../../modules/xp');
const requireAdmin = require('../../middleware/requireAdmin');

// ── Admin panel: paginated post list ────────────────────────────────────────
// This is the foundation the Channel Admin panel (and later gamification
// config screens) will build on. Keyset-paginated, small default page size,
// no polling expected client-side — the frontend fetches on open + on
// explicit "Load more" taps only.
// GET /api/admin/posts?limit=20&cursor=ISO_TIMESTAMP
router.get('/posts', requireAdmin, async (req, res) => {
  try {
    const { limit, cursor } = req.query;
    const result = await getPostsAdmin({ limit, cursor });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin panel: lightweight stats ──────────────────────────────────────────
// Uses `head: true` count-only queries (no rows transferred) and an
// in-memory TTL cache, so re-opening the panel doesn't re-run four count
// queries against Supabase every time — keeps us well within free-tier
// read limits even with frequent admin checks.
let statsCache = { data: null, expiresAt: 0 };
const STATS_TTL_MS = 60 * 1000;

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    if (statsCache.data && Date.now() < statsCache.expiresAt) {
      return res.json({ success: true, stats: statsCache.data, cached: true });
    }

    const [postsCount, usersCount, premiumCount, freePostsCount] = await Promise.all([
      supabase.from('posts').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('telegram_id', { count: 'exact', head: true }),
      supabase.from('subscriptions').select('user_id', { count: 'exact', head: true }),
      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('tier', 'free'),
    ]);

    const stats = {
      totalPosts: postsCount.count || 0,
      freePosts: freePostsCount.count || 0,
      premiumPosts: (postsCount.count || 0) - (freePostsCount.count || 0),
      totalUsers: usersCount.count || 0,
      subscriptionRecords: premiumCount.count || 0,
    };

    statsCache = { data: stats, expiresAt: Date.now() + STATS_TTL_MS };
    res.json({ success: true, stats, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin panel: Premium (paid / lifetime / earned breakdown + manual grant/revoke) ──
// Paid & lifetime Premium (`subscriptions` table) are never written to
// here — only the separate `earned_premium` track is. Every manual
// adjustment is written to `earned_premium_events` for audit purposes.

// GET /api/admin/premium/:user_id
router.get('/premium/:user_id', requireAdmin, async (req, res) => {
  try {
    const breakdown = await getPremiumBreakdown(req.params.user_id);
    res.json({ success: true, ...breakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/premium/:user_id/history
router.get('/premium/:user_id/history', requireAdmin, async (req, res) => {
  try {
    const history = await getEarnedPremiumHistory(req.params.user_id, parseInt(req.query.limit) || 20);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/premium/grant  { user_id, days, note }
router.post('/premium/grant', requireAdmin, async (req, res) => {
  try {
    const { user_id, days, note } = req.body;
    if (!user_id || !days || days <= 0) {
      return res.status(400).json({ error: 'user_id and a positive days value are required' });
    }
    const result = await grantEarnedPremium(user_id, Number(days), 'manual', {
      adminTelegramId: String(req.adminTelegramId),
      note,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/premium/revoke  { user_id, note }
router.post('/premium/revoke', requireAdmin, async (req, res) => {
  try {
    const { user_id, note } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const result = await revokeEarnedPremium(user_id, String(req.adminTelegramId), note);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin panel: XP ledger (lookup + manual adjustment) ─────────────────────
// Manual adjustments go through the same atomic award_xp function as
// every other XP source, tagged with the admin's telegram ID and an
// optional note — the ledger itself is the audit trail.

// GET /api/admin/xp/:user_id
router.get('/xp/:user_id', requireAdmin, async (req, res) => {
  try {
    const [summary, history] = await Promise.all([
      getUserXpSummary(req.params.user_id),
      getUserXpHistory(req.params.user_id, 20),
    ]);
    res.json({ success: true, ...summary, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/xp/grant  { user_id, points, note }
// `points` may be negative to deduct XP (e.g. correcting an exploit).
router.post('/xp/grant', requireAdmin, async (req, res) => {
  try {
    const { user_id, points, note } = req.body;
    if (!user_id || !points) {
      return res.status(400).json({ error: 'user_id and a non-zero points value are required' });
    }
    const result = await manualAwardXp(user_id, Number(points), req.adminTelegramId, note);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const TELEGRAM_API_ROOT      = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const TELEGRAM_FILE_API_ROOT = process.env.TELEGRAM_FILE_API_ROOT || 'https://api.telegram.org';

// Visit this to test whether R2 credentials/config actually work.
// Uploads a tiny 1-byte test file and reports back exactly what
// happened — success or the real error message from AWS SDK/R2.
// GET /api/admin/test-r2?secret=YOUR_ADMIN_SECRET
router.get('/test-r2', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  const envCheck = {
    R2_ACCOUNT_ID:        process.env.R2_ACCOUNT_ID ? 'set (' + process.env.R2_ACCOUNT_ID.length + ' chars)' : 'MISSING',
    R2_ACCESS_KEY_ID:     process.env.R2_ACCESS_KEY_ID ? 'set (' + process.env.R2_ACCESS_KEY_ID.length + ' chars)' : 'MISSING',
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? 'set (' + process.env.R2_SECRET_ACCESS_KEY.length + ' chars)' : 'MISSING',
    R2_BUCKET_NAME:       process.env.R2_BUCKET_NAME || 'MISSING',
    R2_PUBLIC_URL:        process.env.R2_PUBLIC_URL || 'MISSING',
  };

  try {
    const url = await uploadToR2(Buffer.from('test'), 'diagnostic-test.txt', 'text/plain');
    return res.json({ success: true, url, envCheck });
  } catch (err) {
    return res.json({
      success: false,
      errorName: err.name,
      errorMessage: err.message,
      envCheck,
    });
  }
});

// Traces the exact Telegram-fetch step for a real post, to find where
// it's failing before even reaching R2.
// GET /api/admin/test-telegram-fetch?secret=YOUR_ADMIN_SECRET&file_id=SOME_FILE_ID
router.get('/test-telegram-fetch', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  const fileId = req.query.file_id;
  if (!fileId) return res.status(400).json({ error: 'Provide ?file_id=... from a real post' });

  const diagnostics = {
    TELEGRAM_API_ROOT:      process.env.TELEGRAM_API_ROOT || '(default: api.telegram.org)',
    TELEGRAM_FILE_API_ROOT: process.env.TELEGRAM_FILE_API_ROOT || '(default: api.telegram.org)',
    BOT_TOKEN:              process.env.BOT_TOKEN ? 'set (' + process.env.BOT_TOKEN.length + ' chars)' : 'MISSING',
  };

  try {
    const token = process.env.BOT_TOKEN;
    const getFileUrl = `${process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org'}/bot${token}/getFile?file_id=${fileId}`;
    const infoRes  = await fetch(getFileUrl);
    const infoJson = await infoRes.json();

    diagnostics.getFileStatus = infoRes.status;
    diagnostics.getFileResponse = infoJson;

    const filePath = infoJson?.result?.file_path;
    if (!filePath) {
      return res.json({ success: false, stage: 'getFile', diagnostics });
    }

    const fileUrl = `${process.env.TELEGRAM_FILE_API_ROOT || 'https://api.telegram.org'}/file/bot${token}/${filePath}`;
    const fileRes = await fetch(fileUrl);
    diagnostics.fileDownloadStatus = fileRes.status;
    diagnostics.fileDownloadOk = fileRes.ok;

    if (!fileRes.ok) {
      return res.json({ success: false, stage: 'fileDownload', diagnostics });
    }

    return res.json({ success: true, diagnostics });
  } catch (err) {
    return res.json({ success: false, stage: 'exception', errorMessage: err.message, diagnostics });
  }
});


async function mirrorToR2(fileId, type) {
  const token = process.env.BOT_TOKEN;
  const infoRes  = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/getFile?file_id=${fileId}`);
  const infoJson = await infoRes.json();
  const filePath = infoJson?.result?.file_path;
  if (!filePath) return null;

  const fileRes = await fetch(`${TELEGRAM_FILE_API_ROOT}/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;

  const buffer      = Buffer.from(await fileRes.arrayBuffer());
  const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
  const ext          = filePath.split('.').pop();
  const key           = `${type}s/${fileId}.${ext}`;

  return uploadToR2(buffer, key, contentType);
}

// Visit this URL once in a browser (with your admin secret) to migrate
// existing posts' media into R2. Processes a small batch at a time to
// avoid request timeouts — keep re-visiting the same URL until it
// returns "remaining": 0.
// GET /api/admin/backfill-r2?secret=YOUR_ADMIN_SECRET&limit=5
router.get('/backfill-r2', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 5, 20);

  const { data: posts, error, count } = await supabase
    .from('posts')
    .select('id, file_id, type', { count: 'exact' })
    .is('media_url', null)
    .not('file_id', 'is', null)
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const results = { batchSize: posts.length, remaining: Math.max((count || 0) - posts.length, 0), migrated: 0, skipped: 0, failed: 0, details: [] };

  for (const post of posts) {
    try {
      const url = await mirrorToR2(post.file_id, post.type);
      if (!url) {
        results.skipped++;
        results.details.push(`⚠️ Skipped ${post.id}`);
        continue;
      }
      await supabase.from('posts').update({ media_url: url }).eq('id', post.id);
      results.migrated++;
      results.details.push(`✅ Migrated ${post.id}`);
    } catch (err) {
      results.failed++;
      results.details.push(`❌ Failed ${post.id}: ${err.message}`);
    }
  }

  res.json(results);
});

module.exports = router;
