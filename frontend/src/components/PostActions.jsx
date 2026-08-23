import React, { useState } from 'react';
import { toggleLike, toggleBookmark } from '../api';

const BOT_USERNAME = import.meta.env.VITE_BOT_USERNAME;

export default function PostActions({ post, userId }) {
  const realLikes     = post.real_likes     || 0;
  const realBookmarks = post.real_bookmarks || 0;

  const [liked,      setLiked]      = useState(post.user_liked      || false);
  const [bookmarked, setBookmarked] = useState(post.user_bookmarked || false);
  const [likes,      setLikes]      = useState((post.seed_likes     || 0) + realLikes);
  const [bookmarks,  setBookmarks]  = useState((post.seed_bookmarks || 0) + realBookmarks);

  async function handleLike() {
    const next = !liked;
    setLiked(next);
    setLikes(prev => next ? prev + 1 : prev - 1);
    try {
      await toggleLike(userId, post.id);
    } catch {
      setLiked(!next);
      setLikes(prev => next ? prev - 1 : prev + 1);
    }
  }

  async function handleBookmark() {
    const next = !bookmarked;
    setBookmarked(next);
    setBookmarks(prev => next ? prev + 1 : prev - 1);
    try {
      await toggleBookmark(userId, post.id);
    } catch {
      setBookmarked(!next);
      setBookmarks(prev => next ? prev - 1 : prev + 1);
    }
  }

  // Free posts only — tapping a shared link for a premium post
  // wouldn't be useful to a friend who hasn't unlocked Premium anyway.
  // Opens Telegram's own native share sheet (pick any chat/friend),
  // sharing a bot deep link that opens the Mini App straight to this
  // post (handled by bot.js's /start post_<id> handler).
  function handleShare() {
    if (!BOT_USERNAME) {
      alert('Sharing is not configured yet.');
      return;
    }
    const deepLink = `https://t.me/${BOT_USERNAME}?start=post_${post.id}`;
    const shareText = post.caption ? post.caption.slice(0, 120) : 'Check this out on Thickness!';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(shareText)}`;

    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else if (navigator.share) {
      navigator.share({ title: 'Thickness', text: shareText, url: deepLink }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(deepLink);
      alert('Link copied!');
    }
  }

  return (
    <div className="flex items-center gap-5 px-3 py-2 border-t border-border">

      {/* Like */}
      <button onClick={handleLike} className="flex items-center gap-1.5 text-sm transition">
        <span className={`text-lg ${liked ? 'scale-125' : ''} transition-transform`}>
          {liked ? '❤️' : '🤍'}
        </span>
        <span className={liked ? 'text-red-400' : 'text-gray-500'}>{likes}</span>
      </button>

      {/* Share — free posts only */}
      {post.tier === 'free' && (
        <button onClick={handleShare} className="flex items-center gap-1.5 text-sm transition text-gray-500">
          <span className="text-lg">↗️</span>
        </button>
      )}

      {/* Bookmark */}
      <button onClick={handleBookmark} className="flex items-center gap-1.5 text-sm transition ml-auto">
        <span className={`text-lg ${bookmarked ? 'scale-125' : ''} transition-transform`}>
          {bookmarked ? '🔖' : '🏷️'}
        </span>
        <span className={bookmarked ? 'text-amber-400' : 'text-gray-500'}>{bookmarks}</span>
      </button>

    </div>
  );
}
