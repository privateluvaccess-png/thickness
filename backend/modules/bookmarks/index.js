const supabase = require('../../supabase');
const { recordMissionAction } = require('../missions');

async function toggleBookmark(userId, postId) {
  const { data: existing } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();

  if (existing) {
    await supabase.from('bookmarks').delete()
      .eq('user_id', userId)
      .eq('post_id', postId);
    return { bookmarked: false };
  }

  await supabase.from('bookmarks')
    .insert({ user_id: userId, post_id: postId });

  recordMissionAction(userId, 'bookmark_post', postId).catch(err =>
    console.error('[bookmarks] recordMissionAction failed:', err.message)
  );

  return { bookmarked: true };
}

async function getBookmarks(userId) {
  const { data } = await supabase
    .from('bookmarks')
    .select('*, posts(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function isBookmarkedByUser(userId, postId) {
  const { data } = await supabase
    .from('bookmarks')
    .select('*')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();
  return !!data;
}

async function getBookmarkCount(postId) {
  const { count } = await supabase
    .from('bookmarks')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count || 0;
}

module.exports = { toggleBookmark, getBookmarks, isBookmarkedByUser, getBookmarkCount };
