const supabase = require('../../supabase');
const { uploadToR2 } = require('../r2');

const TELEGRAM_API_ROOT      = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const TELEGRAM_FILE_API_ROOT = process.env.TELEGRAM_FILE_API_ROOT || 'https://api.telegram.org';

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Downloads a file from Telegram by file_id and uploads it to R2.
 * Returns the public R2 URL, or null if anything goes wrong (in which
 * case we just fall back to serving via the old Telegram proxy).
 */
async function mirrorToR2(fileId, type) {
  try {
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

    return await uploadToR2(buffer, key, contentType);
  } catch (err) {
    console.error('mirrorToR2 error:', err.message);
    return null;
  }
}

async function syncPost(message, tier) {
  const fileId =
    message.photo?.[message.photo.length - 1]?.file_id ||
    message.video?.file_id ||
    message.document?.file_id ||
    null;

  const type = message.photo
    ? 'image'
    : message.video
    ? 'video'
    : message.document
    ? 'document'
    : 'text';

  // Put the actual bytes in R2 right away, so the app never has to
  // stream them through Render. If this fails for any reason (R2 down,
  // file too big, etc.) media_url just stays null and the app quietly
  // falls back to the old Telegram-proxy route for this post.
  const mediaUrl = fileId ? await mirrorToR2(fileId, type) : null;

  const { data } = await supabase
    .from('posts')
    .insert({
      telegram_message_id: message.message_id,
      tier,
      type,
      file_id: fileId,
      media_url: mediaUrl,
      caption: message.caption || message.text || null,
      seed_likes:     randomBetween(50, 500),
      seed_comments:  randomBetween(5, 80),
      seed_bookmarks: randomBetween(2, 60),
    })
    .select()
    .single();

  return data;
}

async function getFeed(tier, userId, { isNewUser = false, isPremiumUser = false } = {}) {
  let query = supabase
    .from('posts')
    .select('*');

  if (tier === 'free' || tier === 'premium') {
    query = query.eq('tier', tier);
  }

  const { data: allPosts } = await query
    .order('created_at', { ascending: false })
    .limit(50);

  if (!allPosts) return [];

  // Audience filtering: 'everyone' always shows; 'new_users' only to
  // users still inside their new-user window; 'premium' only to
  // Premium users (orthogonal to `tier`, which drives the free/premium
  // feed tabs themselves — a post can be free-tier AND premium-audience).
  const posts = allPosts.filter(p => {
    if (p.audience === 'new_users') return isNewUser;
    if (p.audience === 'premium') return isPremiumUser;
    return true;
  });

  // If userId provided, fetch which posts the user liked and bookmarked
  if (userId) {
    const postIds = posts.map(p => p.id);

    const [likesRes, bookmarksRes] = await Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', userId).in('post_id', postIds),
      supabase.from('bookmarks').select('post_id').eq('user_id', userId).in('post_id', postIds),
    ]);

    const likedSet     = new Set((likesRes.data     || []).map(r => r.post_id));
    const bookmarkedSet = new Set((bookmarksRes.data || []).map(r => r.post_id));

    return posts.map(p => ({
      ...p,
      user_liked:      likedSet.has(p.id),
      user_bookmarked: bookmarkedSet.has(p.id),
    }));
  }

  return posts;
}

async function getPostById(postId) {
  const { data } = await supabase
    .from('posts')
    .select('*')
    .eq('id', postId)
    .single();

  return data;
}

// Pinned onboarding posts for eligible new users — any existing post
// can be pinned (doesn't duplicate it), shown above the regular feed.
// Capped at 5 by convention (enforced in the admin UI, not the DB —
// an admin could technically pin more, it just won't look great).
async function getPinnedNewUserPosts() {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('pinned_for_new_users', true)
    .order('pin_priority', { ascending: true })
    .limit(5);
  if (error) throw error;
  return data || [];
}

// Admin: set a post's audience (everyone / new_users / premium).
async function setPostAudience(postId, audience) {
  const allowed = ['everyone', 'new_users', 'premium'];
  if (!allowed.includes(audience)) throw new Error(`audience must be one of: ${allowed.join(', ')}`);

  const { data, error } = await supabase
    .from('posts')
    .update({ audience })
    .eq('id', postId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Admin: pin/unpin a post for new users, with a display priority
// (lower = shown first).
async function setPostPin(postId, pinned, priority = 0) {
  const { data, error } = await supabase
    .from('posts')
    .update({ pinned_for_new_users: !!pinned, pin_priority: Number(priority) || 0 })
    .eq('id', postId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Admin: paginated list across all tiers, newest first.
// Uses keyset ("cursor") pagination on the indexed created_at column
// instead of OFFSET, so pages stay cheap even as the table grows —
// important on Supabase's free-tier compute/row-read limits.
async function getPostsAdmin({ limit = 20, cursor = null } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), 50);

  let query = supabase
    .from('posts')
    .select('id, tier, type, caption, created_at, audience, pinned_for_new_users, pin_priority')
    .order('created_at', { ascending: false })
    .limit(safeLimit + 1); // fetch one extra to know if there's a next page

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;
  if (error) throw error;

  const hasMore = data.length > safeLimit;
  const posts = hasMore ? data.slice(0, safeLimit) : data;
  const nextCursor = hasMore ? posts[posts.length - 1].created_at : null;

  return { posts, nextCursor };
}

// Delete by telegram_message_id (used by bot on channel post delete)
async function deletePost(telegramMessageId) {
  await supabase
    .from('posts')
    .delete()
    .eq('telegram_message_id', telegramMessageId);
}

// Delete by database UUID (used by admin panel)
async function deletePostById(postId) {
  await supabase
    .from('posts')
    .delete()
    .eq('id', postId);
}

module.exports = {
  syncPost, deletePost, deletePostById, getFeed, getPostById, getPostsAdmin,
  getPinnedNewUserPosts, setPostAudience, setPostPin,
};
