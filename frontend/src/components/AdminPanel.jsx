import React, { useEffect, useState } from 'react';
import {
  getAdminStats, getAdminPosts, deletePost,
  getAdminPremiumBreakdown, getAdminPremiumHistory,
  grantAdminPremium, revokeAdminPremium,
  getAdminXp, grantAdminXp,
  getAdminAdSettings, updateAdminAdSettings,
  getAdminGiftHuntSettings, updateAdminGiftHuntSettings,
  getAdminMissions, createAdminMission, updateAdminMission, deleteAdminMission,
  getAdminStreakMilestones, createAdminStreakMilestone, updateAdminStreakMilestone, deleteAdminStreakMilestone,
  getAdminLevelSettings, updateAdminLevelSettings,
  getAdminNewUserSettings, updateAdminNewUserSettings,
  setAdminPostAudience, setAdminPostPin,
  getAdminWeeklyChallengeSettings, updateAdminWeeklyChallengeSettings, getAdminWeeklyChallengeResults,
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

              {/* Ad format toggles */}
              <AdsSection initData={initData} />

              {/* Gift Hunt settings */}
              <GiftHuntSection initData={initData} />

              {/* Weekly Challenge settings + recent winners */}
              <WeeklyChallengeSection initData={initData} />

              {/* Missions manager */}
              <MissionsSection initData={initData} />

              {/* Streak milestones */}
              <StreaksSection initData={initData} />

              {/* Level curve settings */}
              <LevelsSection initData={initData} />

              {/* New User settings */}
              <NewUserSection initData={initData} />

              {/* Premium lookup / manual grant-revoke */}
              <PremiumSection initData={initData} />

              {/* XP ledger lookup / manual adjustment */}
              <XpSection initData={initData} />

              {/* Post list */}
              <div className="flex flex-col gap-2">
                <span className="text-gray-400 text-xs font-semibold uppercase">All Posts</span>
                {posts.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center mt-4">No posts.</p>
                ) : (
                  posts.map(post => (
                    <div
                      key={post.id}
                      className="flex flex-col gap-2 bg-zinc-800 rounded-xl px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
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

                      <PostAudiencePinControls initData={initData} post={post} onUpdated={updated => {
                        setPosts(prev => prev.map(p => (p.id === updated.id ? { ...p, ...updated } : p)));
                      }} />
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

// Ad format toggles — auto-loads on mount (single global row, no
// per-user lookup needed). Each format is independent; the admin can
// leave any combination on, including just one.
function AdsSection({ initData }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [busyKey, setBusyKey]   = useState(null);
  const [error, setError]       = useState('');

  useEffect(() => {
    getAdminAdSettings(initData)
      .then(res => setSettings(res.data.settings))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(key) {
    setBusyKey(key);
    setError('');
    const next = !settings[key];
    try {
      const res = await updateAdminAdSettings(initData, { [key]: next });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function updateNumber(key, value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return;
    setBusyKey(key);
    setError('');
    try {
      const res = await updateAdminAdSettings(initData, { [key]: num });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  const FORMATS = [
    { key: 'inapp_interstitial_enabled', label: 'In-App Interstitial', hint: 'Auto-scheduled background ad (current default)' },
    { key: 'rewarded_popup_enabled', label: 'Rewarded Popup', hint: "Verified via Monetag postback" },
    { key: 'rewarded_interstitial_enabled', label: 'Rewarded Interstitial', hint: 'Verified via Monetag postback' },
  ];

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">Ad Formats</span>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {FORMATS.map(f => (
            <div key={f.key} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium">{f.label}</p>
                <p className="text-gray-500 text-[11px]">{f.hint}</p>
              </div>
              <button
                onClick={() => toggle(f.key)}
                disabled={busyKey === f.key}
                className={`flex-shrink-0 w-12 h-7 rounded-full transition-colors relative disabled:opacity-50 ${
                  settings[f.key] ? 'bg-green-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${
                    settings[f.key] ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">XP per rewarded ad</span>
            <input
              type="number"
              min="1"
              defaultValue={settings.xp_per_rewarded_ad}
              onBlur={e => updateNumber('xp_per_rewarded_ad', e.target.value)}
              className="w-16 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Daily ad limit (per user)</span>
            <input
              type="number"
              min="1"
              defaultValue={settings.daily_ad_limit}
              onBlur={e => updateNumber('daily_ad_limit', e.target.value)}
              className="w-16 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Gift Hunt config — enabled/disabled, required actions, reward days.
// Progress itself is derived server-side from the XP ledger, so
// there's nothing to configure here about tracking — just the rules.
function GiftHuntSection({ initData }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [busyKey, setBusyKey]   = useState(null);
  const [error, setError]       = useState('');

  useEffect(() => {
    getAdminGiftHuntSettings(initData)
      .then(res => setSettings(res.data.settings))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleEnabled() {
    setBusyKey('enabled');
    try {
      const res = await updateAdminGiftHuntSettings(initData, { enabled: !settings.enabled });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function updateNumber(key, value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return;
    setBusyKey(key);
    try {
      const res = await updateAdminGiftHuntSettings(initData, { [key]: num });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">Daily Gift Hunt</span>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Enabled</span>
            <button
              onClick={toggleEnabled}
              disabled={busyKey === 'enabled'}
              className={`w-12 h-7 rounded-full relative disabled:opacity-50 ${settings.enabled ? 'bg-green-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Required actions</span>
            <input
              type="number" min="1"
              defaultValue={settings.required_actions}
              onBlur={e => updateNumber('required_actions', e.target.value)}
              className="w-16 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Reward (days Premium)</span>
            <input
              type="number" min="1"
              defaultValue={settings.reward_days}
              onBlur={e => updateNumber('reward_days', e.target.value)}
              className="w-16 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Weekly Challenge config — reward days for 1st/2nd/3rd, plus a peek
// at recent settled weeks. Settlement itself happens automatically
// (lazily, on leaderboard load) — nothing to trigger manually here.
function WeeklyChallengeSection({ initData }) {
  const [settings, setSettings] = useState(null);
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busyKey, setBusyKey]   = useState(null);
  const [error, setError]       = useState('');

  useEffect(() => {
    Promise.all([
      getAdminWeeklyChallengeSettings(initData),
      getAdminWeeklyChallengeResults(initData),
    ])
      .then(([settingsRes, resultsRes]) => {
        setSettings(settingsRes.data.settings);
        setResults(resultsRes.data.results || []);
      })
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleEnabled() {
    setBusyKey('enabled');
    try {
      const res = await updateAdminWeeklyChallengeSettings(initData, { enabled: !settings.enabled });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  async function updateDays(key, value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return;
    setBusyKey(key);
    try {
      const res = await updateAdminWeeklyChallengeSettings(initData, { [key]: num });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">Weekly Challenge</span>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Enabled</span>
            <button
              onClick={toggleEnabled}
              disabled={busyKey === 'enabled'}
              className={`w-12 h-7 rounded-full relative disabled:opacity-50 ${settings.enabled ? 'bg-green-600' : 'bg-zinc-700'}`}
            >
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform ${settings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {[
            ['first_place_days', '🥇 1st place (days)'],
            ['second_place_days', '🥈 2nd place (days)'],
            ['third_place_days', '🥉 3rd place (days)'],
          ].map(([key, label]) => (
            <div key={key} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
              <span className="text-white text-sm">{label}</span>
              <input
                type="number" min="1"
                defaultValue={settings[key]}
                onBlur={e => updateDays(key, e.target.value)}
                className="w-16 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
              />
            </div>
          ))}

          {results.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-gray-500 text-xs">Recent winners</span>
              {results.map(r => (
                <div key={r.id} className="text-xs text-gray-400 bg-zinc-900 rounded-lg px-3 py-2">
                  {r.week_key} · #{r.rank} · user {r.user_id} · {r.xp} XP · +{r.reward_days}d Premium
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Missions manager — list, add, toggle active, delete. Note:
// requirementType must match a type the backend actually tracks
// (watch_ad, like_post, bookmark_post, share, buy_premium) or
// progress will never move.
function MissionsSection({ initData }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType]   = useState('watch_ad');
  const [newCount, setNewCount] = useState('2');
  const [newXp, setNewXp]       = useState('15');
  const [busy, setBusy]         = useState(false);

  function load() {
    setLoading(true);
    getAdminMissions(initData)
      .then(res => setMissions(res.data.missions || []))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(mission) {
    setBusy(true);
    try {
      await updateAdminMission(initData, mission.id, { active: !mission.active });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this mission?')) return;
    setBusy(true);
    try {
      await deleteAdminMission(initData, id);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      await createAdminMission(initData, {
        title: newTitle.trim(),
        requirementType: newType,
        requirementCount: Number(newCount) || 1,
        xpReward: Number(newXp) || 10,
      });
      setNewTitle('');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-xs font-semibold uppercase">Daily Missions</span>
        <button onClick={() => setShowAdd(v => !v)} className="text-gray-400 text-xs">
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}

      {showAdd && (
        <div className="flex flex-col gap-2 bg-zinc-900 rounded-lg p-2.5">
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Mission title"
            className="bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
          />
          <select
            value={newType}
            onChange={e => setNewType(e.target.value)}
            className="bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
          >
            <option value="watch_ad">Watch rewarded ads</option>
            <option value="like_post">Like posts</option>
            <option value="bookmark_post">Bookmark posts</option>
            <option value="share">Share posts</option>
            <option value="buy_premium">Buy Premium</option>
          </select>
          <div className="flex gap-2">
            <input
              type="number" min="1" value={newCount}
              onChange={e => setNewCount(e.target.value)}
              placeholder="Count"
              className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
            <input
              type="number" min="1" value={newXp}
              onChange={e => setNewXp(e.target.value)}
              placeholder="XP reward"
              className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={busy || !newTitle.trim()}
            className="w-full py-2 rounded-lg bg-green-600/20 text-green-400 text-sm font-bold disabled:opacity-50"
          >
            Add Mission
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : missions.length === 0 ? (
        <p className="text-gray-500 text-xs">No missions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {missions.map(m => (
            <div key={m.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${m.active ? 'text-white' : 'text-gray-500 line-through'}`}>{m.title}</p>
                <p className="text-gray-500 text-[11px]">{m.requirement_type} · {m.requirement_count}x · +{m.xp_reward} XP</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleActive(m)}
                  disabled={busy}
                  className={`w-10 h-6 rounded-full relative disabled:opacity-50 ${m.active ? 'bg-green-600' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${m.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  disabled={busy}
                  className="text-red-400 text-xs font-bold"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Streak milestones manager — same list/add/toggle/delete pattern as
// Missions. XP rewards here award through the same ledger, tagged
// with source 'streak_milestone'.
function StreaksSection({ initData }) {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showAdd, setShowAdd]       = useState(false);
  const [newDays, setNewDays]       = useState('7');
  const [newXp, setNewXp]           = useState('50');
  const [newBadge, setNewBadge]     = useState('');
  const [busy, setBusy]             = useState(false);

  function load() {
    setLoading(true);
    getAdminStreakMilestones(initData)
      .then(res => setMilestones(res.data.milestones || []))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(m) {
    setBusy(true);
    try {
      await updateAdminStreakMilestone(initData, m.id, { active: !m.active });
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this milestone?')) return;
    setBusy(true);
    try {
      await deleteAdminStreakMilestone(initData, id);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!newDays) return;
    setBusy(true);
    try {
      await createAdminStreakMilestone(initData, {
        dayCount: Number(newDays),
        xpReward: Number(newXp) || 0,
        badgeTitle: newBadge.trim() || null,
      });
      setNewBadge('');
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-xs font-semibold uppercase">Streak Milestones</span>
        <button onClick={() => setShowAdd(v => !v)} className="text-gray-400 text-xs">
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}

      {showAdd && (
        <div className="flex flex-col gap-2 bg-zinc-900 rounded-lg p-2.5">
          <div className="flex gap-2">
            <input
              type="number" min="1" value={newDays}
              onChange={e => setNewDays(e.target.value)}
              placeholder="Day count"
              className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
            <input
              type="number" min="0" value={newXp}
              onChange={e => setNewXp(e.target.value)}
              placeholder="XP reward"
              className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
          </div>
          <input
            value={newBadge}
            onChange={e => setNewBadge(e.target.value)}
            placeholder="Badge title (optional)"
            className="bg-zinc-800 text-white text-sm rounded-lg px-3 py-2 outline-none"
          />
          <button
            onClick={handleAdd}
            disabled={busy || !newDays}
            className="w-full py-2 rounded-lg bg-green-600/20 text-green-400 text-sm font-bold disabled:opacity-50"
          >
            Add Milestone
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : milestones.length === 0 ? (
        <p className="text-gray-500 text-xs">No milestones yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {milestones.map(m => (
            <div key={m.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${m.active ? 'text-white' : 'text-gray-500 line-through'}`}>
                  Day {m.day_count}{m.badge_title ? ` · ${m.badge_title}` : ''}
                </p>
                <p className="text-gray-500 text-[11px]">+{m.xp_reward} XP</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => toggleActive(m)}
                  disabled={busy}
                  className={`w-10 h-6 rounded-full relative disabled:opacity-50 ${m.active ? 'bg-green-600' : 'bg-zinc-700'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${m.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <button onClick={() => handleDelete(m.id)} disabled={busy} className="text-red-400 text-xs font-bold">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Level curve settings — two numbers define the whole curve, no
// per-level table to manage.
function LevelsSection({ initData }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [busyKey, setBusyKey]   = useState(null);

  useEffect(() => {
    getAdminLevelSettings(initData)
      .then(res => setSettings(res.data.settings))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateNumber(key, value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) return;
    setBusyKey(key);
    try {
      const res = await updateAdminLevelSettings(initData, { [key]: num });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">Level Curve</span>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">Base XP (Level 1→2)</span>
            <input
              type="number" min="1"
              defaultValue={settings.xp_base}
              onBlur={e => updateNumber('xp_base', e.target.value)}
              className="w-20 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
          <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
            <span className="text-white text-sm">XP increment per level</span>
            <input
              type="number" min="0"
              defaultValue={settings.xp_increment}
              onBlur={e => updateNumber('xp_increment', e.target.value)}
              className="w-20 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// New User window — one number, how many days after signup a user
// counts as "new" for audience targeting and pinned onboarding posts.
function NewUserSection({ initData }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    getAdminNewUserSettings(initData)
      .then(res => setSettings(res.data.settings))
      .catch(err => setError(err?.response?.data?.error || err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateDays(value) {
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) return;
    setBusy(true);
    try {
      const res = await updateAdminNewUserSettings(initData, { duration_days: num });
      setSettings(res.data.settings);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">New User Window</span>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      {loading ? (
        <p className="text-gray-500 text-xs">Loading...</p>
      ) : (
        <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2.5">
          <span className="text-white text-sm">New user for (days)</span>
          <input
            type="number" min="1"
            defaultValue={settings.duration_days}
            onBlur={e => updateDays(e.target.value)}
            disabled={busy}
            className="w-20 bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 text-center outline-none disabled:opacity-50"
          />
        </div>
      )}
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

// XP ledger lookup + manual adjustment (positive to grant, negative to
// deduct — e.g. correcting an exploit). Every adjustment goes through
// the same atomic award_xp function as every other XP source, so the
// ledger itself is the audit trail — no separate log to check here.
function XpSection({ initData }) {
  const [userId, setUserId]     = useState('');
  const [summary, setSummary]   = useState(null);
  const [history, setHistory]   = useState([]);
  const [points, setPoints]     = useState('50');
  const [note, setNote]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true);
    setError('');
    setSummary(null);
    try {
      const res = await getAdminXp(initData, userId.trim());
      setSummary(res.data);
      setHistory(res.data.history || []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdjust() {
    const pts = Number(points);
    if (!pts) return;
    setBusy(true);
    try {
      await grantAdminXp(initData, userId.trim(), pts, note || undefined);
      setNote('');
      await lookup();
    } catch (err) {
      alert('Adjustment failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 bg-zinc-800/50 rounded-xl p-3">
      <span className="text-gray-400 text-xs font-semibold uppercase">XP Lookup</span>

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

      {summary && (
        <div className="flex flex-col gap-3 mt-1">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">Lifetime XP</p>
              <p className="text-white font-semibold">{summary.lifetimeXp}</p>
            </div>
            <div className="bg-zinc-900 rounded-lg px-3 py-2">
              <p className="text-gray-500">This week ({summary.weekKey})</p>
              <p className="text-white font-semibold">{summary.weeklyXp}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={points}
                onChange={e => setPoints(e.target.value)}
                className="w-24 bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 outline-none"
              />
              <span className="text-gray-500 text-xs">XP (negative to deduct)</span>
            </div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional, for audit log)"
              className="bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 outline-none"
            />
            <button
              onClick={handleAdjust}
              disabled={busy}
              className="w-full bg-amber-600/20 text-amber-400 text-sm font-bold py-2 rounded-lg disabled:opacity-50"
            >
              Apply Adjustment
            </button>
          </div>

          {history.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-gray-500 text-xs">Recent activity</span>
              {history.map(h => (
                <div key={h.id} className="text-xs text-gray-400 bg-zinc-900 rounded-lg px-3 py-2">
                  <span className={h.points >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                    {h.points >= 0 ? `+${h.points}` : h.points}
                  </span>
                  {' · '}{h.source}
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

// Inline audience + pin controls for one post row in the admin list.
// Audience is orthogonal to `tier` (free/premium feed tab) — a post
// can be free-tier AND new-users-only, for example.
function PostAudiencePinControls({ initData, post, onUpdated }) {
  const [busy, setBusy] = useState(false);

  async function changeAudience(e) {
    const audience = e.target.value;
    setBusy(true);
    try {
      const res = await setAdminPostAudience(initData, post.id, audience);
      onUpdated(res.data.post);
    } catch (err) {
      alert('Failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  async function togglePin() {
    setBusy(true);
    try {
      const res = await setAdminPostPin(initData, post.id, !post.pinned_for_new_users, post.pin_priority || 0);
      onUpdated(res.data.post);
    } catch (err) {
      alert('Failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  async function changePriority(e) {
    const priority = Number(e.target.value);
    if (!Number.isInteger(priority)) return;
    setBusy(true);
    try {
      const res = await setAdminPostPin(initData, post.id, post.pinned_for_new_users, priority);
      onUpdated(res.data.post);
    } catch (err) {
      alert('Failed: ' + (err?.response?.data?.error || err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={post.audience || 'everyone'}
        onChange={changeAudience}
        disabled={busy}
        className="bg-zinc-900 text-gray-300 text-xs rounded-lg px-2 py-1.5 outline-none disabled:opacity-50"
      >
        <option value="everyone">Everyone</option>
        <option value="new_users">New Users</option>
        <option value="premium">Premium</option>
      </select>

      <button
        onClick={togglePin}
        disabled={busy}
        className={`text-xs font-medium px-2 py-1.5 rounded-lg disabled:opacity-50 ${
          post.pinned_for_new_users ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-900 text-gray-400'
        }`}
      >
        📌 {post.pinned_for_new_users ? 'Pinned' : 'Pin for New Users'}
      </button>

      {post.pinned_for_new_users && (
        <input
          type="number" min="0"
          defaultValue={post.pin_priority || 0}
          onBlur={changePriority}
          disabled={busy}
          title="Priority (lower shows first)"
          className="w-14 bg-zinc-900 text-gray-300 text-xs rounded-lg px-2 py-1.5 text-center outline-none disabled:opacity-50"
        />
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
