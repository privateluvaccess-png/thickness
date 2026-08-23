import React, { useEffect, useState } from 'react';
import { getAdSettings, getAdWatchStatus } from '../api';

// IMPORTANT:
// This component NEVER grants XP itself.
// The client only starts the Monetag rewarded ad.
// The actual XP reward is granted server-side after Monetag
// sends the confirmed postback to:
// /api/rewards/postback/monetag
//
// Rewarded ad lanes remain separate:
//   - Rewarded Popup
//   - Rewarded Interstitial
//
// This component does NOT modify your normal/in-app interstitial
// or normal popup ad system.

export default function RewardedAdButton({ telegramId, onXpRefresh }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState('idle');
  // idle | playing | done | unavailable

  const [adStatus, setAdStatus] = useState(null);
  // {
  //   used,
  //   limit,
  //   remaining,
  //   resetsAt,
  //   cooldownActive,
  //   nextAvailableAt
  // }

  const [countdown, setCountdown] = useState('');

  function refreshAdStatus() {
    if (!telegramId) return;

    getAdWatchStatus(telegramId)
      .then(res => setAdStatus(res.data))
      .catch(err => {
        console.error('[RewardedAdButton] failed to refresh ad status:', err);
      });
  }

  useEffect(() => {
    getAdSettings()
      .then(res => setSettings(res.data.settings))
      .catch(err => {
        console.error('[RewardedAdButton] failed to load ad settings:', err);
      });

    refreshAdStatus();

    // refreshAdStatus intentionally omitted from dependencies
    // because it is a local helper function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);

  const dailyCapReached =
    !!adStatus && adStatus.remaining <= 0;

  const cooldownActive =
    !!adStatus?.cooldownActive && !dailyCapReached;

  // Daily limit takes priority if both restrictions happen
  // to be active.
  const blockedUntil = dailyCapReached
    ? adStatus.resetsAt
    : cooldownActive
      ? adStatus.nextAvailableAt
      : null;

  // Client-side countdown only.
  // The actual restriction is enforced server-side.
  useEffect(() => {
    if (!blockedUntil) {
      setCountdown('');
      return;
    }

    function tick() {
      const diffMs =
        new Date(blockedUntil).getTime() - Date.now();

      if (diffMs <= 0) {
        setCountdown('00:00:00');

        // Pull the authoritative state once the timer expires.
        refreshAdStatus();
        return;
      }

      const h = String(
        Math.floor(diffMs / 3600000)
      ).padStart(2, '0');

      const m = String(
        Math.floor((diffMs % 3600000) / 60000)
      ).padStart(2, '0');

      const s = String(
        Math.floor((diffMs % 60000) / 1000)
      ).padStart(2, '0');

      setCountdown(`${h}:${m}:${s}`);
    }

    tick();

    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [blockedUntil]);

  const popupEnabled =
    settings?.rewarded_popup_enabled;

  const interstitialEnabled =
    settings?.rewarded_interstitial_enabled;

  // If neither rewarded format is enabled,
  // don't render this component.
  if (!popupEnabled && !interstitialEnabled) {
    return null;
  }

  function generateYmid() {
    // Prefix the Monetag ymid with the Telegram user ID.
    //
    // This allows the backend to recover the user even if
    // Monetag's {telegram_id} macro isn't present.
    return `u${telegramId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  async function watchAd(format) {
    // Never allow the frontend to bypass the current UI block.
    // The backend independently enforces these restrictions too.
    if (dailyCapReached || cooldownActive) {
      return;
    }

    // IMPORTANT:
    // Monetag creates show_11218209 as a browser global.
    //
    // Using window.show_11218209 instead of directly referencing
    // show_11218209 prevents Vite/Rollup from treating it as an
    // unresolved module variable during production builds.
    if (typeof window.show_11218209 !== 'function') {
      console.error(
        '[RewardedAdButton] Monetag SDK show_11218209 is not available'
      );

      setStatus('unavailable');
      return;
    }

    setStatus('playing');

    const ymid = generateYmid();

    // ------------------------------------------------------------
    // PRELOAD
    // ------------------------------------------------------------
    //
    // Preload the rewarded ad first.
    // This does NOT award XP.
    //
    // XP is only awarded after the backend receives and validates
    // Monetag's postback.
    try {
      await window.show_11218209({
        type: 'preload',
        ymid,
      });
    } catch (err) {
      console.error(
        '[RewardedAdButton] preload failed:',
        err
      );

      setStatus('unavailable');
      return;
    }

    // ------------------------------------------------------------
    // SELECT THE REWARDED AD LANE
    // ------------------------------------------------------------
    //
    // IMPORTANT:
    // These remain separate:
    //
    // popup:
    //   type: 'pop'
    //   requestVar: 'rewarded_popup'
    //
    // interstitial:
    //   requestVar: 'rewarded_interstitial'
    //
    // Your normal/in-app interstitial and normal popup
    // systems are NOT touched by this component.
    const call =
      format === 'popup'
        ? window.show_11218209({
            type: 'pop',
            ymid,
            requestVar: 'rewarded_popup',
          })
        : window.show_11218209({
            ymid,
            requestVar: 'rewarded_interstitial',
          });

    // ------------------------------------------------------------
    // SHOW REWARDED AD
    // ------------------------------------------------------------
    try {
      await call;

      setStatus('done');

      // The ad finishing on the client DOES NOT mean XP has
      // already been awarded.
      //
      // Monetag still has to send the postback to the backend.
      //
      // Wait a few seconds, then refresh the XP/status.
      setTimeout(() => {
        onXpRefresh?.();
        refreshAdStatus();
      }, 4000);
    } catch (err) {
      console.error(
        '[RewardedAdButton] ad show failed:',
        err
      );

      setStatus('unavailable');
    }
  }

  const buttonsDisabled =
    status === 'playing' ||
    dailyCapReached ||
    cooldownActive;

  return (
    <div className="flex flex-col gap-2">

      {/* --------------------------------------------------------
          REWARDED POPUP
          -------------------------------------------------------- */}
      {popupEnabled && (
        <button
          onClick={() => watchAd('popup')}
          disabled={buttonsDisabled}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Popup)
        </button>
      )}

      {/* --------------------------------------------------------
          REWARDED INTERSTITIAL
          -------------------------------------------------------- */}
      {interstitialEnabled && (
        <button
          onClick={() => watchAd('interstitial')}
          disabled={buttonsDisabled}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Interstitial)
        </button>
      )}

      {/* --------------------------------------------------------
          DAILY LIMIT MESSAGE
          -------------------------------------------------------- */}
      {dailyCapReached ? (
        <p className="text-amber-400 text-xs text-center">
          Daily limit reached ({adStatus.limit}/{adStatus.limit})
          {' '}— resets in {countdown || '...'}
        </p>
      ) : cooldownActive ? (

        /* ------------------------------------------------------
           COOLDOWN MESSAGE
           ------------------------------------------------------ */
        <p className="text-amber-400 text-xs text-center">
          Next ad available in {countdown || '...'}
          {' '}({adStatus.remaining} of {adStatus.limit} left today)
        </p>
      ) : adStatus ? (

        /* ------------------------------------------------------
           AVAILABLE MESSAGE
           ------------------------------------------------------ */
        <p className="text-gray-500 text-xs text-center">
          {adStatus.remaining} of {adStatus.limit} ads left today
        </p>
      ) : null}

      {/* --------------------------------------------------------
          AD LOADING
          -------------------------------------------------------- */}
      {status === 'playing' && (
        <p className="text-gray-500 text-xs text-center">
          Loading ad...
        </p>
      )}

      {/* --------------------------------------------------------
          REWARD PROCESSING
          -------------------------------------------------------- */}
      {status === 'done' && (
        <p className="text-green-400 text-xs text-center">
          Ad watched — reward processing...
        </p>
      )}

      {/* --------------------------------------------------------
          NO AD AVAILABLE
          -------------------------------------------------------- */}
      {status === 'unavailable' && (
        <p className="text-gray-500 text-xs text-center">
          No ad available right now.
        </p>
      )}

    </div>
  );
}
