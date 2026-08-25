import React, { useState } from 'react';
import BookmarksSheet from './BookmarksSheet';
import AdminPanel from './AdminPanel';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function ProfileButton({ user, isPremium, expiresAt, onNavigate, isAdmin, initData, onOpenChallenges }) {
  const [open,          setOpen]          = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);

  const initials  = user?.first_name?.slice(0, 1).toUpperCase() || '?';
  const avatarUrl = user?.photo_url || null;


  return (
    <>
      <button
        onClick={() => setOpen(true)}
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

            <button
              onClick={() => { setOpen(false); onOpenChallenges?.(); }}
              className="w-full py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-semibold flex items-center justify-center gap-2"
            >
              🏆 View Challenges
            </button>

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
