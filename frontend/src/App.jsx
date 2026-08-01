// trigger redeploy

import React, { useEffect, useState, useRef } from 'react';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import Feed from './components/Feed';
import SubscriptionBadge from './components/SubscriptionBadge';
import { loginUser, getSubscription } from './api';
import { languageLabels, languageOrder } from './i18n/translations';
import logo from './assets/logo.webp';
import ProfileButton from './components/ProfileButton';

function AppInner({ user, isPremium, setIsPremium, expiresAt, devBoostUnlocked, setDevBoost }) {
  const { lang, setLang } = useLanguage();
  const [isDark, setIsDark]             = useState(true);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [navigateToPostId, setNavigateToPostId] = useState(null);
  const [showDevPrompt, setShowDevPrompt] = useState(false);
  const [devPassword, setDevPassword]   = useState('');
  const [devError, setDevError]         = useState('');

  const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD || 'thickness_dev';
  const ADMIN_TG_ID  = import.meta.env.VITE_ADMIN_TELEGRAM_ID;
  const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET;

  const tapCount = useRef(0);
  const tapTimer = useRef(null);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  }, [isDark]);

  function handleLogoTap() {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      setShowDevPrompt(true);
      setDevPassword('');
      setDevError('');
    } else {
      tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    }
  }

  function handleDevPasswordSubmit() {
    if (devPassword === DEV_PASSWORD) {
      setDevBoost(true);
      setShowDevPrompt(false);
      setDevError('');
    } else {
      setDevError('Wrong password.');
      setDevPassword('');
    }
  }

  const isAdmin = ADMIN_TG_ID && String(user?.telegram_id) === String(ADMIN_TG_ID);

  return (
    <div className="flex flex-col bg-dark text-white max-w-md mx-auto" style={{ height: '100dvh', overflow: 'hidden' }}>

      {/* Header — fixed height, no overflow */}
      <div className="flex items-center justify-between px-4 border-b border-border relative flex-shrink-0" style={{ height: 56 }}>
        <img
          src={logo}
          alt="Thickness"
          onClick={handleLogoTap}
          style={{ height: 36, width: 'auto', maxWidth: '55%', objectFit: 'contain', objectPosition: 'left center', cursor: 'pointer' }}
        />

        {/* Right side icons */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {/* Language picker */}
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(v => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-800 text-base"
              title="Change language"
            >
              🌐
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-11 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden z-50 shadow-xl">
                {languageOrder.map(code => (
                  <button
                    key={code}
                    onClick={() => { setLang(code); setShowLangMenu(false); }}
                    className={`block w-full text-left px-4 py-2 text-sm font-medium transition hover:bg-zinc-700 ${lang === code ? 'text-amber-400' : 'text-white'}`}
                  >
                    {languageLabels[code]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dark/Light toggle */}
          <button
            onClick={() => setIsDark(v => !v)}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-800 text-base"
            title="Toggle theme"
          >
            {isDark ? '☀️' : '🌙'}
          </button>

          <ProfileButton
            user={user}
            isPremium={isPremium}
            expiresAt={expiresAt}
            devBoostUnlocked={devBoostUnlocked}
            onDevBoost={() => setDevBoost(true)}
            onNavigate={(postId) => setNavigateToPostId(postId)}
          />
        </div>
      </div>

      {/* Feed — takes remaining space, clips internally */}
      <div className="flex-1 overflow-hidden px-4 pt-4" style={{ minHeight: 0 }}>
        <Feed
          isPremium={isPremium}
          telegramId={user?.telegram_id}
          onUnlocked={() => setIsPremium(true)}
          isAdmin={isAdmin}
          adminSecret={ADMIN_SECRET}
          navigateToPostId={navigateToPostId}
          onNavigated={() => setNavigateToPostId(null)}
        />
      </div>

      {/* DevBoost password modal */}
      {showDevPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-8" style={{ touchAction: 'none' }}>
          <div className="bg-zinc-900 rounded-2xl p-6 w-full flex flex-col gap-4 border border-zinc-700">
            <p className="text-white font-bold text-center text-base">🔐 Developer Access</p>
            <input
              type="password"
              value={devPassword}
              onChange={e => { setDevPassword(e.target.value); setDevError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleDevPasswordSubmit()}
              placeholder="Enter password"
              autoFocus
              className="bg-zinc-800 text-white text-sm rounded-xl px-4 py-3 outline-none border border-zinc-700 placeholder-gray-600"
            />
            {devError && (
              <p className="text-red-400 text-xs text-center">{devError}</p>
            )}
            <button
              onClick={handleDevPasswordSubmit}
              className="w-full py-3 rounded-xl bg-amber-500 text-black text-sm font-bold"
            >
              Unlock
            </button>
            <button
              onClick={() => setShowDevPrompt(false)}
              className="w-full py-2 text-gray-500 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default function App() {
  const [user, setUser]             = useState(null);
  const [isPremium, setIsPremium]   = useState(false);
  const [expiresAt, setExpiresAt]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [devBoostUnlocked, setDevBoost] = useState(false);

  // Start the in-app interstitial ad session once, globally.
  // This replaces the old per-tap popup: the SDK now manages its own
  // schedule (frequency / capping / interval / timeout) automatically.
  useEffect(() => {
    if (typeof show_11218209 === 'function') {
      show_11218209({
        type: 'inApp',
        inAppSettings: {
          frequency: 2,
          capping: 0.1,
          interval: 30,
          timeout: 5,
          everyPage: false,
        },
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const tg = window.Telegram?.WebApp;
        tg?.expand();

        const initData = tg?.initData;

        if (!initData) {
          setError('Open this app inside Telegram.');
          setLoading(false);
          return;
        }

        const loginRes = await loginUser(initData);
        const userData = loginRes.data.user;
        setUser(userData);

        const subRes = await getSubscription(userData.telegram_id);
        setIsPremium(subRes.data.isPremium || false);
        setExpiresAt(subRes.data.expiresAt || null);
      } catch (err) {
        console.error(err);
        setError('Failed to load. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark">
        <p className="text-gray-400 text-sm animate-pulse">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark">
        <p className="text-red-400 text-sm text-center px-6">{error}</p>
      </div>
    );
  }

  return (
    <LanguageProvider>
      <AppInner
        user={user}
        isPremium={isPremium}
        setIsPremium={setIsPremium}
        expiresAt={expiresAt}
        devBoostUnlocked={devBoostUnlocked}
        setDevBoost={setDevBoost}
      />
    </LanguageProvider>
  );
}
