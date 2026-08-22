const supabase = require('../../supabase');
const { recordMissionAction } = require('../missions');

async function toggleLike(userId, postId) {
  const { data: existing } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();

  if (existing) {
    await supabase.from('likes').delete()
      .eq('user_id', userId)
      .eq('post_id', postId);
    return { liked: false };
  }

  await supabase.from('likes').insert({ user_id: userId, post_id: postId });

  // Count toward any active "like posts" mission — deduped per post
  // per day inside recordMissionAction, so like/unlike/like spam
  // can't farm progress.
  recordMissionAction(userId, 'like_post', postId).catch(err =>
    console.error('[likes] recordMissionAction failed:', err.message)
  );

  // Notify post owner
  const { data: post } = await supabase
    .from('posts').select('*').eq('id', postId).single();
  if (post) {
    await supabase.from('notifications').insert({
      user_id: userId,
      message: `Someone liked your post ❤️`,
      read: false,
    });
  }

  return { liked: true };
}

async function getLikeCount(postId) {
  const { count } = await supabase
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count || 0;
}

async function isLikedByUser(userId, postId) {
  const { data } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();
  return !!data;
}

module.exports = { toggleLike, getLikeCount, isLikedByUser };
