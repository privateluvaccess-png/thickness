import React, { useEffect, useState } from 'react';
import { getAdSettings, getMyXp } from '../api';

// IMPORTANT: this component never grants any reward itself. Tapping
// the button just triggers the Monetag ad and shows a "reward is
// being processed" message on .then() — the actual XP grant happens
// server-side only, via Monetag's postback hitting
// /api/rewards/postback/monetag, which is the only place trusted to
// award anything. This is what "never trust the client" looks like
// in practice: the UI reacts to the ad finishing, but the reward
// itself is decided entirely by the backend, moments later.
export default function RewardedAdButton({ telegramId, onXpRefresh }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus]     = useState('idle'); // idle | playing | done | unavailable

  useEffect(() => {
    getAdSettings().then(res => setSettings(res.data.settings)).catch(() => {});
  }, []);

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
    if (typeof show_11218209 !== 'function') {
      setStatus('unavailable');
      return;
    }
    setStatus('playing');
    const ymid = generateYmid();

    const call = format === 'popup'
      ? show_11218209({ type: 'pop', ymid, requestVar: 'rewarded_popup' })
      : show_11218209({ ymid, requestVar: 'rewarded_interstitial' });

    try {
      await call;
      setStatus('done');
      // The postback usually lands within a few seconds of the ad
      // finishing — a single delayed refresh is enough here; no
      // polling loop, to stay light on requests.
      setTimeout(() => onXpRefresh?.(), 4000);
    } catch {
      setStatus('unavailable');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {popupEnabled && (
        <button
          onClick={() => watchAd('popup')}
          disabled={status === 'playing'}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Popup)
        </button>
      )}
      {interstitialEnabled && (
        <button
          onClick={() => watchAd('interstitial')}
          disabled={status === 'playing'}
          className="w-full py-3 rounded-xl bg-zinc-800 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          🎬 Watch Ad for XP (Interstitial)
        </button>
      )}
      {status === 'playing' && <p className="text-gray-500 text-xs text-center">Loading ad...</p>}
      {status === 'done' && <p className="text-green-400 text-xs text-center">Ad watched — reward processing...</p>}
      {status === 'unavailable' && <p className="text-gray-500 text-xs text-center">No ad available right now.</p>}
    </div>
  );
}
