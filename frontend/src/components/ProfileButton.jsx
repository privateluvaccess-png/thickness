import React, { useState } from 'react';
import BookmarksSheet from './BookmarksSheet';
import AdminPanel from './AdminPanel';
import RewardedAdButton from './RewardedAdButton';
import { getMyXp } from '../api';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function ProfileButton({ user, isPremium, expiresAt, devBoostUnlocked, onDevBoost, onNavigate, isAdmin, initData }) {
  const [open,          setOpen]          = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [boosting,      setBoosting]      = useState(false);
  const [boostMsg,      setBoostMsg]      = useState('');
  const [showSecretPrompt, setShowSecretPrompt] = useState(false);
  const [boostSecret,   setBoostSecret]   = useState('');
  const [xp, setXp] = useState(null);

  function refreshXp() {
    if (!user?.telegram_id) return;
    getMyXp(user.telegram_id).then(res => setXp(res.data)).catch(() => {});
  }

  const initials  = user?.first_name?.slice(0, 1).toUpperCase() || '?';
  const avatarUrl = user?.photo_url || null;

  async function handleDevBoost() {
    setBoosting(true);
    setBoostMsg('');
    try {
      const res  = await fetch(`${BACKEND}/api/subscriptions/devboost`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegram_id: user?.telegram_id,
          secret: boostSecret,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setBoostMsg('✅ Premium unlocked for 24h!');
        setShowSecretPrompt(false);
        setBoostSecret('');
        onDevBoost?.();
      } else {
        setBoostMsg('❌ ' + (json.error || 'Failed'));
        setBoostSecret('');
      }
    } catch (err) {
      setBoostMsg('❌ ' + err.message);
    } finally {
      setBoosting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); refreshXp(); }}
        className="relative w-9 h-9 rounded-full overflow-hidden border-2 border-border flex items-center justify-center bg-zinc-800 flex-shrink-0"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="profile" className="w-full h-full object-cover" />
        ) : (
          <span className="text-white font-bold text-sm">{initials}</span>
        )}
        {isPremium && (
          <span className="absolute -bottom-0.5 -right-0.5 text-[10px]">⭐</span>
        )}
      </button>

      {open && !showBookmarks && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60" onClick={() => setOpen(false)}>
          <div className="bg-zinc-900 rounded-t-2xl p-6 pb-10 flex flex-col gap-4" onClick={e => e.stopPropagation()}>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-border bg-zinc-800 flex items-center justify-center flex-shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-white font-bold text-2xl">{initials}</span>
                )}
              </div>
              <div>
                <p className="text-white font-bold text-lg">
                  {user?.first_name} {user?.last_name || ''}
                </p>
                {user?.username && (
                  <p className="text-gray-400 text-sm">@{user.username}</p>
                )}
              </div>
            </div>

            <div className="bg-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-gray-400 text-sm">Subscription</span>
              {isPremium ? (
                <span className="text-amber-400 font-semibold text-sm">
                  ⭐ Premium
                  {expiresAt && (
                    <span className="text-gray-500 font-normal">
                      {' '}· expires {new Date(expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-gray-500 text-sm">Free</span>
              )}
            </div>

            {xp && (
              <div className="bg-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-gray-400 text-sm">XP</span>
                <span className="text-white font-semibold text-sm">
                  {xp.lifetimeXp} lifetime · {xp.weeklyXp} this week
                </span>
              </div>
            )}

            <RewardedAdButton telegramId={user?.telegram_id} onXpRefresh={refreshXp} />

            <button
              onClick={() => setShowBookmarks(true)}
              className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2"
            >
              🔖 Saved Posts
            </button>

            {/* Channel Admin — only for the admin Telegram account */}
            {isAdmin && initData && (
              <button
                onClick={() => setShowAdminPanel(true)}
                className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2"
              >
                🛠 Channel Admin
              </button>
            )}

            {/* DevBoost — only visible after secret logo tap */}
            {devBoostUnlocked && !isPremium && (
              <div className="flex flex-col gap-2">
                {!showSecretPrompt ? (
                  <button
                    onClick={() => { setShowSecretPrompt(true); setBoostMsg(''); }}
                    className="w-full py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    ⚡ DevBoost — Unlock Premium (24h)
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <input
                      type="password"
                      autoFocus
                      value={boostSecret}
                      onChange={e => setBoostSecret(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleDevBoost()}
                      placeholder="Enter DevBoost secret"
                      className="w-full py-3 px-4 rounded-xl bg-zinc-800 text-white text-sm border border-amber-500/40 focus:outline-none"
                    />
                    <button
                      onClick={handleDevBoost}
                      disabled={boosting || !boostSecret}
                      className="w-full py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 text-sm font-semibold disabled:opacity-50"
                    >
                      {boosting ? '⏳ Activating...' : 'Confirm'}
                    </button>
                  </div>
                )}
                {boostMsg && (
                  <p className="text-xs text-center text-gray-400">{boostMsg}</p>
                )}
              </div>
            )}

            <button
              onClick={() => setOpen(false)}
              className="w-full py-3 rounded-xl bg-zinc-800 text-gray-400 text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showBookmarks && (
        <BookmarksSheet
          userId={user?.telegram_id}
          onClose={() => setShowBookmarks(false)}
          onNavigate={onNavigate}
        />
      )}

      {showAdminPanel && (
        <AdminPanel
          initData={initData}
          onClose={() => setShowAdminPanel(false)}
        />
      )}
    </>
  );
}
