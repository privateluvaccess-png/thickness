const router = require('express').Router();
const supabase = require('../../supabase');
const { uploadToR2 } = require('../../modules/r2');

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
