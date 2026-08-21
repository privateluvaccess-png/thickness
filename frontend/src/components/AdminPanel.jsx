import React, { useEffect, useState } from 'react';
import { getAdminStats, getAdminPosts, deletePost } from '../api';

// Foundation panel for the (previously nonexistent) Channel Admin UI.
// This is intentionally the ONE admin surface — future systems (Gift
// Hunt config, Weekly Challenge, Missions, Leaderboard, Rewards, New
// User posts/pinning) get added as additional sections/tabs here,
// not as separate dashboards.
//
// No polling: data loads once on open, and again only on explicit
// user action (Refresh / Load more), to stay well within free-tier
// request budgets.
export default function AdminPanel({ adminSecret, onClose }) {
  const [stats, setStats]     = useState(null);
  const [posts, setPosts]     = useState([]);
  const [cursor, setCursor]   = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]     = useState('');

  async function loadInitial() {
    setLoading(true);
    setError('');
    try {
      const [statsRes, postsRes] = await Promise.all([
        getAdminStats(adminSecret),
        getAdminPosts(adminSecret),
      ]);
      setStats(statsRes.data.stats);
      setPosts(postsRes.data.posts || []);
      setCursor(postsRes.data.nextCursor);
      setHasMore(!!postsRes.data.nextCursor);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await getAdminPosts(adminSecret, cursor);
      setPosts(prev => [...prev, ...(res.data.posts || [])]);
      setCursor(res.data.nextCursor);
      setHasMore(!!res.data.nextCursor);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleDelete(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      await deletePost(postId, adminSecret);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (err) {
      alert('Failed to delete: ' + (err?.response?.data?.error || err.message));
    }
  }

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-t-2xl flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-bold text-white text-base">🛠 Channel Admin</span>
          <div className="flex items-center gap-3">
            <button onClick={loadInitial} className="text-gray-500 text-sm">Refresh</button>
            <button onClick={onClose} className="text-gray-500 text-sm">Close</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4 pb-8">
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          {loading ? (
            <p className="text-gray-500 text-sm text-center mt-8">Loading...</p>
          ) : (
            <>
              {/* Stats */}
              {stats && (
                <div className="grid grid-cols-2 gap-3">
                  <StatBox label="Total Posts" value={stats.totalPosts} />
                  <StatBox label="Users" value={stats.totalUsers} />
                  <StatBox label="Free Posts" value={stats.freePosts} />
                  <StatBox label="Premium Posts" value={stats.premiumPosts} />
                </div>
              )}

              {/* Post list */}
              <div className="flex flex-col gap-2">
                <span className="text-gray-400 text-xs font-semibold uppercase">All Posts</span>
                {posts.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center mt-4">No posts.</p>
                ) : (
                  posts.map(post => (
                    <div
                      key={post.id}
                      className="flex items-center justify-between gap-3 bg-zinc-800 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-300 truncate">
                          {post.caption || '(no caption)'}
                        </p>
                        <p className="text-xs text-gray-600 mt-0.5">
                          <span className={post.tier === 'premium' ? 'text-amber-400' : 'text-green-400'}>
                            {post.tier === 'premium' ? '⭐ Premium' : 'Free'}
                          </span>
                          {' · '}{post.type}{' · '}
                          {new Date(post.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="flex-shrink-0 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs font-bold px-3 py-1.5 rounded-full"
                      >
                        🗑 Delete
                      </button>
                    </div>
                  ))
                )}

                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="mt-2 w-full py-2.5 rounded-xl bg-zinc-800 text-gray-300 text-sm font-medium disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-zinc-800 rounded-xl px-4 py-3">
      <p className="text-white font-bold text-lg">{value}</p>
      <p className="text-gray-500 text-xs">{label}</p>
    </div>
  );
}
