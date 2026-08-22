import React, { useEffect, useState } from 'react';
import {
  getAdminStats, getAdminPosts, deletePost,
  getAdminPremiumBreakdown, getAdminPremiumHistory,
  grantAdminPremium, revokeAdminPremium,
} from '../api';

// Foundation panel for the (previously nonexistent) Channel Admin UI.
// This is intentionally the ONE admin surface — future systems (Gift
// Hunt config, Weekly Challenge, Missions, Leaderboard, Rewards, New
// User posts/pinning) get added as additional sections/tabs here,
// not as separate dashboards.
//
// No polling: data loads once on open, and again only on explicit
// user action (Refresh / Load more), to stay well within free-tier
// request budgets.
export default function AdminPanel({ initData, onClose }) {
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
        getAdminStats(initData),
        getAdminPosts(initData),
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
      const res = await getAdminPosts(initData, cursor);
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
      await deletePost(postId, initData);
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

              {/* Premium lookup / manual grant-revoke */}
              <PremiumSection initData={initData} />

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

// Looks up a single user's Premium breakdown (paid / lifetime / earned,
// kept as separate windows — never merged) and lets an admin manually
// grant or revoke earned Premium. Only queries on explicit action
// (Look up / Grant / Revoke) — no background polling.
function PremiumSection({ initData }) {
  const [userId, setUserId]         = useState('');
  const [breakdown, setBreakdown]   = useState(null);
  const [history, setHistory]       = useState([]);
  const [grantDays, setGrantDays]   = useState('7');
  const [note, setNote]             = useState('');
  const [loading, setLoading]       = useState(false);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true);
    setError('');
    setBreakdown(null);
    try {
      const [breakdownRes, historyRes] = await Promise.all([
        getAdminPremiumBreakdown(initData, userId.trim()),
        getAdminPremiumHistory(initData, userId.trim()),
      ]);
      setBreakdown(breakdownRes.data);
      setHistory(historyRes.data.history || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGrant() {
    const days = Number(grantDays);
    if (!days || days <= 0) return;
    setBusy(true);
    try {
      await grantAdminPremium(initData, userId.trim(), days, note || undefined);
      setNote('');
      await lookup();
    } catch (err) {
      alert('Grant failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke this user\'s earned Premium? Paid/lifetime Premium is never affected.')) return;
    setBusy(true);
    try {
      await revokeAdminPremium(initData, userId.trim(), note || undefined);
      setNote('');
      await lookup();
    } catch (err) {
      alert('Revoke failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">Premium Lookup</span>

      <div className="flex gap-2">
        <input
          value={userId}
          onChange={e => setUserId(e.target.value)}
          placeholder="Telegram user ID"
          className="flex-1 bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 outline-none"
        />
        <button
          onClick={lookup}
          disabled={loading || !userId.trim()}
          className="bg-zinc-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {loading ? '...' : 'Look up'}
        </button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {breakdown && (
        <div className="flex flex-col gap-3 mt-1">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">Lifetime</p>
              <p className="text-white font-semibold">{breakdown.isLifetime ? 'Yes' : 'No'}</p>
            </div>
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">Overall Premium</p>
              <p className={breakdown.isPremium ? 'text-green-400 font-semibold' : 'text-gray-400 font-semibold'}>
                {breakdown.isPremium ? 'Active' : 'Not active'}
              </p>
            </div>
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">Paid expires</p>
              <p className="text-white">
                {breakdown.paidExpiresAt ? new Date(breakdown.paidExpiresAt).toLocaleString() : '—'}
              </p>
            </div>
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">Earned expires</p>
              <p className="text-white">
                {breakdown.earnedExpiresAt ? new Date(breakdown.earnedExpiresAt).toLocaleString() : '—'}
              </p>
            </div>
          </div>

          {/* Manual grant/revoke — only affects the earned track */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <input
                type="number"
                min="1"
                value={grantDays}
                onChange={e => setGrantDays(e.target.value)}
                className="w-20 bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 outline-none"
              />
              <span className="text-gray-500 text-xs">days earned Premium</span>
            </div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional, for audit log)"
              className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleGrant}
                disabled={busy}
                className="flex-1 bg-green-600/20 text-green-400 text-sm font-bold py-2 rounded-lg disabled:opacity-50"
              >
                Grant
              </button>
              <button
                onClick={handleRevoke}
                disabled={busy}
                className="flex-1 bg-red-600/20 text-red-400 text-sm font-bold py-2 rounded-lg disabled:opacity-50"
              >
                Revoke earned
              </button>
            </div>
          </div>

          {/* Audit history */}
          {history.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">Recent activity</span>
              {history.map(h => (
                <div key={h.id} className="text-xs text-gray-400 bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-gray-300 font-medium">{h.action}</span>
                  {' · '}{h.source}
                  {h.days_granted ? ` · +${h.days_granted}d` : ''}
                  {' · '}{new Date(h.created_at).toLocaleDateString()}
                  {h.note ? ` · "${h.note}"` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
