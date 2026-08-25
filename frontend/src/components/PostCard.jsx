import React, { useState, useEffect, useRef } from 'react';
import PostActions from './PostActions';
import LinkPreview from './LinkPreview';
import { deletePost } from '../api';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

export default function PostCard({ post, isPremium, userId, onLockTap, isAdmin, initData, onDeleted, postRef, adUrl }) {
  const isLocked = post.tier === 'premium' && !isPremium;
  const [mediaUrl, setMediaUrl]     = useState(null);
  const [mediaError, setMediaError] = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [muted, setMuted]           = useState(true);
  const [shouldLoad, setShouldLoad] = useState(false);
  const videoElRef = useRef(null);
  const wrapperRef  = useRef(null);

  useEffect(() => {
    if (isLocked) return;
    if (post.media_url) {
      setMediaUrl(post.media_url);            // new posts: served straight from R2
    } else if (post.file_id) {
      setMediaUrl(`${BACKEND}/api/posts/media/${post.file_id}`); // old posts: old proxy
    }
  }, [post.media_url, post.file_id, isLocked]);

  async function handleDelete() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deletePost(post.id, initData);
      onDeleted?.(post.id);
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to delete post.');
      setDeleting(false);
    }
  }

  // Ad delivery is now handled globally by the inApp interstitial
  // (see App.jsx), which manages its own frequency/capping/interval —
  // no per-tap popup trigger needed here anymore.
  function handleMediaTap() {}

  // Only start fetching/downloading a video once it's about to come into
  // view (roughly one screen away) — NOT the instant the feed renders.
  // Every video hitting the backend/Telegram at once was the cause of the
  // slow, stuck loading.
  useEffect(() => {
    if (post.type !== 'video' || isLocked) return;
    const el = wrapperRef.current;
    if (!el || shouldLoad) return;

    const loadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            loadObserver.disconnect();
          }
        });
      },
      { rootMargin: '150% 0px' }
    );
    loadObserver.observe(el);
    return () => loadObserver.disconnect();
  }, [post.type, isLocked, shouldLoad]);

  // TikTok-style behavior: once loaded, the video plays the instant it's
  // mostly in view (muted, so browsers allow it without a tap), and pauses
  // the moment it scrolls out.
  useEffect(() => {
    if (post.type !== 'video' || isLocked || !shouldLoad) return;
    const el = wrapperRef.current;
    const video = videoElRef.current;
    if (!el || !video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            video.play().catch(() => {}); // ignore autoplay-blocked errors
          } else {
            video.pause();
          }
        });
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [post.type, isLocked, shouldLoad, mediaUrl]);

  function renderMedia() {
    if (isLocked) {
      return (
        <button
          onClick={onLockTap}
          className="flex flex-col items-center gap-2 text-amber-400"
        >
          <span className="text-4xl">🔒</span>
          <span className="text-sm font-semibold">Premium</span>
        </button>
      );
    }

    if (!post.file_id) return null;

    if (mediaError) {
      return <span className="text-gray-600 text-sm">Media unavailable</span>;
    }

    if (post.type === 'video') {
      return (
        <div ref={wrapperRef} className="relative w-full" style={{ minHeight: 220 }}>
          {shouldLoad ? (
            <>
              <video
                ref={videoElRef}
                src={mediaUrl}
                muted={muted}
                loop
                playsInline
                webkit-playsinline="true"
                preload="auto"
                className="w-full max-h-[400px] object-contain"
                onError={() => setMediaError(true)}
                onPlaying={handleMediaTap}
              />
              <button
                onClick={(e) => { e.stopPropagation(); setMuted(m => !m); }}
                aria-label={muted ? 'Unmute' : 'Mute'}
                className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white text-sm flex items-center justify-center"
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </>
          ) : (
            <div className="w-full h-[220px] flex items-center justify-center text-gray-600 text-xs">
              ▶
            </div>
          )}
        </div>
      );
    }

    return (
      <img
        src={mediaUrl}
        alt={post.caption || 'post'}
        className="w-full max-h-[400px] object-contain cursor-pointer"
        onClick={handleMediaTap}
        onError={() => setMediaError(true)}
      />
    );
  }

  if (deleting) return null;

  return (
    <>
      <div ref={postRef} className="bg-card border border-border rounded-2xl overflow-hidden mb-4">

        {/* Media */}
        <div className="relative bg-[#111] min-h-[180px] flex items-center justify-center">
          {renderMedia()}

          {/* Tier badge */}
          {post.tier === 'premium' && (
            <span className="absolute top-2 right-2 bg-amber-500 text-black text-xs font-bold px-2 py-0.5 rounded-full">
              ⭐ Premium
            </span>
          )}

          {/* Admin delete button */}
          {isAdmin && (
            <button
              onClick={handleDelete}
              className="absolute top-2 left-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-2 py-1 rounded-full"
            >
              🗑 Delete
            </button>
          )}
        </div>

        {/* Caption */}
        {(() => {
          const text = post.caption?.replace(/https?:\/\/[^\s]+/g, '').trim();
          if (!text) return null;
          return (
            <div className="p-3 text-sm text-gray-300">
              {isLocked ? text.slice(0, 60) + '...' : text}
            </div>
          );
        })()}

        {/* Link preview */}
        {!isLocked && extractUrl(post.caption) && (
          <LinkPreview url={extractUrl(post.caption)} />
        )}

        {/* Date */}
        <div className="px-3 pb-2 text-xs text-gray-600">
          {new Date(post.created_at).toLocaleDateString()}
        </div>

        {/* Actions */}
        <PostActions post={post} userId={userId} />
      </div>
    </>
  );
}
