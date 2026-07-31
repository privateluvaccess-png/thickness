// Run this once, from the backend folder: node scripts/backfill-r2.js
// It finds every post that still only has a Telegram file_id (no
// media_url yet), mirrors it into R2, and fills in the column.
require('dotenv').config();
const supabase = require('../supabase');
const { uploadToR2 } = require('../modules/r2');

const TELEGRAM_API_ROOT      = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const TELEGRAM_FILE_API_ROOT = process.env.TELEGRAM_FILE_API_ROOT || 'https://api.telegram.org';

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

async function run() {
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, file_id, type')
    .is('media_url', null)
    .not('file_id', 'is', null);

  if (error) throw error;
  console.log(`Found ${posts.length} posts to backfill.`);

  for (const post of posts) {
    try {
      const url = await mirrorToR2(post.file_id, post.type);
      if (!url) {
        console.log(`⚠️  Skipped ${post.id} (couldn't fetch from Telegram)`);
        continue;
      }
      await supabase.from('posts').update({ media_url: url }).eq('id', post.id);
      console.log(`✅ Migrated ${post.id}`);
    } catch (err) {
      console.log(`❌ Failed ${post.id}: ${err.message}`);
    }
    // small pause so we don't hammer Telegram's API
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('Done.');
}

run();
