import React, { useEffect, useState, useRef } from 'react';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import Feed from './components/Feed';
import ChallengeView from './components/ChallengeView';
import SubscriptionBadge from './components/SubscriptionBadge';
import { loginUser, getSubscription, getAdSettings } from './api';
import { languageLabels, languageOrder } from './i18n/translations';
import logo from './assets/logo.webp';
import ProfileButton from './components/ProfileButton';

function AppInner({
  user,
  isPremium,
  setIsPremium,
  expiresAt,
  initData,
  sharedPostId
}) {
  const { lang, setLang } = useLanguage();

  const [isDark, setIsDark] = useState(true);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [navigateToPostId, setNavigateToPostId] = useState(null);
  const [activeSection, setActiveSection] = useState('feed');

  // If the app was opened via a shared-post link, make sure we're on
  // the Feed tab and tell Feed to scroll to that post once loaded.
  useEffect(() => {
    if (sharedPostId) {
      setActiveSection('feed');
      setNavigateToPostId(sharedPostId);
    }
  }, [sharedPostId]);

  const ADMIN_TG_ID =
    import.meta.env.VITE_ADMIN_TELEGRAM_ID;


  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  }, [isDark]);

  const isAdmin =
    ADMIN_TG_ID &&
    String(user?.telegram_id) === String(ADMIN_TG_ID);

  return (
    <div
      className="flex flex-col bg-dark text-white max-w-md mx-auto"
      style={{
        height: '100dvh',
        overflow: 'hidden'
      }}
    >

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 border-b border-border relative flex-shrink-0"
        style={{ height: 56 }}
      >
        <img
          src={logo}
          alt="Thickness"
          style={{
            height: 36,
            width: 'auto',
            maxWidth: '55%',
            objectFit: 'contain',
            objectPosition: 'left center'
          }}
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
                    onClick={() => {
                      setLang(code);
                      setShowLangMenu(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-sm font-medium transition hover:bg-zinc-700 ${
                      lang === code
                        ? 'text-amber-400'
                        : 'text-white'
                    }`}
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
            onNavigate={(postId) =>
              setNavigateToPostId(postId)
            }
            isAdmin={isAdmin}
            initData={initData}
            onOpenChallenges={() =>
              setActiveSection('challenge')
            }
          />
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        style={{ minHeight: 0 }}
      >
        <div
          className={
            activeSection === 'feed'
              ? 'flex-1 overflow-hidden px-4 pt-4'
              : 'hidden'
          }
          style={{ minHeight: 0 }}
        >
          <Feed
            isPremium={isPremium}
            telegramId={user?.telegram_id}
            onUnlocked={() => setIsPremium(true)}
            isAdmin={isAdmin}
            initData={initData}
            navigateToPostId={navigateToPostId}
            onNavigated={() =>
              setNavigateToPostId(null)
            }
          />
        </div>

        {activeSection === 'challenge' && (
          <ChallengeView
            telegramId={user?.telegram_id}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <div
        className="flex border-t border-border flex-shrink-0"
        style={{ height: 56 }}
      >
        <button
          onClick={() => setActiveSection('feed')}
          className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium ${
            activeSection === 'feed'
              ? 'text-white'
              : 'text-gray-500'
          }`}
        >
          📺 Feed
        </button>

        <button
          onClick={() =>
            setActiveSection('challenge')
          }
          className={`flex-1 flex items-center justify-center gap-2 text-sm font-medium ${
            activeSection === 'challenge'
              ? 'text-amber-400'
              : 'text-gray-500'
          }`}
        >
          🏆 Challenge
        </button>
      </div>

    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Telegram raw signed initData string.
  const [initData, setInitData] = useState(null);

  // Shared post ID.
  const [sharedPostId] = useState(() =>
    new URLSearchParams(window.location.search).get('post')
  );

  // ------------------------------------------------------------
  // EXISTING IN-APP INTERSTITIAL
  // ------------------------------------------------------------
  //
  // IMPORTANT:
  // This remains the SAME in-app interstitial lane.
  //
  // We are ONLY changing:
  //
  //     show_11218209
  //
  // to:
  //
  //     window.show_11218209
  //
  // This prevents Vite/Rollup from treating the Monetag browser
  // global as an unresolved JavaScript variable during build.
  //
  // The actual ad settings remain unchanged:
  //
  // type: 'inApp'
  // frequency: 2
  // capping: 0.1
  // interval: 30
  // timeout: 5
  // everyPage: false
  //
  // This does NOT affect:
  // - Rewarded Popup
  // - Rewarded Interstitial
  // - Normal popup ads
  // - Any other ad lane
  // ------------------------------------------------------------

  useEffect(() => {
    async function maybeStartInAppAd() {
      let enabled = true;

      try {
        const res = await getAdSettings();

        enabled =
          res.data.settings
            ?.inapp_interstitial_enabled !== false;
      } catch {
        // Keep default enabled if settings fetch fails.
      }

      if (
        enabled &&
        typeof window.show_11218209 === 'function'
      ) {
        window.show_11218209({
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
    }

    maybeStartInAppAd();
  }, []);

  // ------------------------------------------------------------
  // TELEGRAM / USER INITIALIZATION
  // ------------------------------------------------------------

  useEffect(() => {
    async function init() {
      try {
        const tg = window.Telegram?.WebApp;

        tg?.expand();

        const initDataStr = tg?.initData;

        if (!initDataStr) {
          setError(
            'Open this app inside Telegram.'
          );
          setLoading(false);
          return;
        }

        const loginRes =
          await loginUser(initDataStr);

        const userData =
          loginRes.data.user;

        setUser(userData);
        setInitData(initDataStr);

        const subRes =
          await getSubscription(
            userData.telegram_id
          );

        setIsPremium(
          subRes.data.isPremium || false
        );

        setExpiresAt(
          subRes.data.expiresAt || null
        );

      } catch (err) {
        console.error(err);

        setError(
          'Failed to load. Please try again.'
        );
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  // ------------------------------------------------------------
  // LOADING
  // ------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark">
        <p className="text-gray-400 text-sm animate-pulse">
          Loading...
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------
  // ERROR
  // ------------------------------------------------------------

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-dark">
        <p className="text-red-400 text-sm text-center px-6">
          {error}
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------
  // MAIN APP
  // ------------------------------------------------------------

  return (
    <LanguageProvider>
      <AppInner
        user={user}
        isPremium={isPremium}
        setIsPremium={setIsPremium}
        expiresAt={expiresAt}
        initData={initData}
        sharedPostId={sharedPostId}
      />
    </LanguageProvider>
  );
}
