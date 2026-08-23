import React, { useEffect, useState } from 'react';
import { getAdSettings, getAdWatchStatus } from '../api';

// IMPORTANT: this component never grants any reward itself. Tapping
// the button just triggers the Monetag ad and shows a "reward is
// being processed" message on .then() — the actual XP grant happens
// server-side only, via Monetag's postback hitting
// /api/rewards/postback/monetag, which is the only place trusted to
// award anything. This is what "never trust the client" looks like
// in practice: the UI reacts to the ad finishing, but the reward
// itself is decided entirely by the backend, moments later.
//
// The daily cap itself is also enforced server-side (ad_settings.daily_ad_limit,
// checked in the postback handler) — this component's disabled state
// and countdown are just a UI convenience so users aren't left
// tapping a button that would silently do nothing.
export default function RewardedAdButton({ telegramId, onXpRefresh }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus]     = useState('idle'); // idle | playing | done | unavailable
  const [adStatus, setAdStatus] = useState(null);    // { used, limit, remaining, resetsAt, cooldownActive, nextAvailableAt }
  const [countdown, setCountdown] = useState('');

  function refreshAdStatus() {
    if (!telegramId) return;
    getAdWatchStatus(telegramId).then(res => setAdStatus(res.data)).catch(() => {});
  }

  useEffect(() => {
    getAdSettings().then(res => setSettings(res.data.settings)).catch(() => {});
    refreshAdStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramId]);

  const dailyCapReached = !!adStatus && adStatus.remaining <= 0;
  const cooldownActive  = !!adStatus?.cooldownActive && !dailyCapReached;
  // Whichever is actually blocking the button right now — daily cap
  // (a much longer wait) takes priority if somehow both are true.
  const blockedUntil = dailyCapReached ? adStatus.resetsAt : (cooldownActive ? adStatus.nextAvailableAt : null);

  // Pure client-side ticking clock — no network call per tick, just
  // formats the time remaining until whichever deadline is blocking.
  useEffect(() => {
    if (!blockedUntil) {
      setCountdown('');
      return;
    }
    function tick() {
      const diffMs = new Date(blockedUntil).getTime() - Date.now();
      if (diffMs <= 0) {
        setCountdown('00:00:00');
        refreshAdStatus(); // the block should have lifted — pull the real state once
        return;
      }
      const h = String(Math.floor(diffMs / 3600000)).padStart(2, '0');
      const m = String(Math.floor((diffMs % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
      setCountdown(`${h}:${m}:${s}`);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [blockedUntil]);

  const popupEnabled = settings?.rewarded_popup_enabled;
  const interstitialEnabled = settings?.rewarded_interstitial_enabled;
  if (!popupEnabled && !interstitialEnabled) return null;

  function generateYmid() {
    // Prefix with the telegram id so the postback handler can always
    // resolve the user even if Monetag's {telegram_id} macro is
    // missing for some reason (their own docs warn it isn't guaranteed).
    return `u${telegramId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function watchAd(format) {
    if (dailyCapReached || cooldownActive) return;
    if (typeof show_11218209 !== 'function') {
      setStatus('unavailable');
      return;
    }
    setStatus('playing');
    const ymid = generateYmid();

    // Preload first, as Monetag's own docs recommend — this both
    // reduces latency and lets us actually detect "no ad available"
    // for this format instead of the promise silently resolving
    // without ever requesting a real ad (which is what we suspect
    // was happening before: .then() fired, but Monetag logged zero
    // impressions for these formats — check that Rewarded Popup and
    // Rewarded Interstitial are enabled/approved for this zone in the
    // Monetag dashboard if this keeps happening).
    try {
      await show_11218209({ type: 'preload', ymid });
    } catch (err) {
      console.error('[RewardedAdButton] preload failed:', err);
      setStatus('unavailable');
      return;
    }

    const call = format === 'popup'
      ? show_11218209({ type: 'pop', ymid, requestVar: 'rewarded_popup' })
      : show_11218209({ ymid, requestVar: 'rewarded_interstitial' });

    try {
      await call;
      setStatus('done');
      // The postback usually lands within a few seconds of the ad
      // finishing — a single delayed refresh is enough here; no
      // polling loop, to stay light on requests.
      setTimeout(() => {
        onXpRefresh?.();
        refreshAdStatus();
      }, 4000);
    } catch (err) {
      console.error('[RewardedAdButton] ad show failed:', err);
      setStatus('unavailable');
    }
  }

  const buttonsDisabled = status === 'playing' || dailyCapReached || cooldownActive;

  return (
    <div className="flex flex-col gap-2">
      {popupEnabled && (
        <button
          onClick={() => watchAd('popup')}
          disabled={buttonsDisabled}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Popup)
        </button>
      )}
      {interstitialEnabled && (
        <button
          onClick={() => watchAd('interstitial')}
          disabled={buttonsDisabled}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Interstitial)
        </button>
      )}

      {dailyCapReached ? (
        <p className="text-amber-400 text-xs text-center">
          Daily limit reached ({adStatus.limit}/{adStatus.limit}) — resets in {countdown || '...'}
        </p>
      ) : cooldownActive ? (
        <p className="text-amber-400 text-xs text-center">
          Next ad available in {countdown || '...'} ({adStatus.remaining} of {adStatus.limit} left today)
        </p>
      ) : adStatus ? (
        <p className="text-gray-500 text-xs text-center">
          {adStatus.remaining} of {adStatus.limit} ads left today
        </p>
      ) : null}

      {status === 'playing' && <p className="text-gray-500 text-xs text-center">Loading ad...</p>}
      {status === 'done' && <p className="text-green-400 text-xs text-center">Ad watched — reward processing...</p>}
      {status === 'unavailable' && <p className="text-gray-500 text-xs text-center">No ad available right now.</p>}
    </div>
  );
}
