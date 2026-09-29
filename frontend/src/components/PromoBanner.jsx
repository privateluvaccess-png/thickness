import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import vibeLogo from '../assets/thicknessvibe.webp';
import { openThicknessVibe } from '../config/thicknessvibe';

const COUNTDOWN_SECONDS = 5;

// Full-screen promo popup for ThicknessVibe. Shown on app open with a
// 5-second countdown; the close button unlocks when it reaches 0.
export default function PromoBanner({ onClose }) {
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const canClose = secondsLeft <= 0;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center px-5"
      style={{ zIndex: 9999, background: 'rgba(0,0,0,0.88)' }}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl overflow-hidden text-center"
        style={{
          background: 'linear-gradient(180deg,#141414 0%,#0a0a0a 100%)',
          border: '1px solid rgba(251,191,36,0.45)',
          boxShadow: '0 0 40px rgba(251,191,36,0.25)',
        }}
      >
        {/* Countdown / close */}
        <button
          onClick={canClose ? onClose : undefined}
          disabled={!canClose}
          aria-label={canClose ? 'Close' : `Closes in ${secondsLeft}`}
          className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: canClose ? '#fff' : 'rgba(255,255,255,0.12)',
            color: canClose ? '#000' : '#fbbf24',
          }}
        >
          {canClose ? '✕' : secondsLeft}
        </button>

        <div className="px-6 pt-10 pb-7 flex flex-col items-center">
          <img
            src={vibeLogo}
            alt="ThicknessVibe"
            style={{ width: 150, height: 150, objectFit: 'contain' }}
          />

          <h2 className="text-white text-2xl font-extrabold mt-4 leading-tight">
            Discover Creators on Telegram
          </h2>
          <p className="text-gray-400 text-sm mt-2">
            ThicknessVibe is your social media discovery tool — find and
            chat with creators directly on Telegram.
          </p>

          <button
            onClick={() => { openThicknessVibe(); onClose(); }}
            className="w-full mt-6 py-3.5 rounded-2xl font-bold text-black text-base"
            style={{ background: 'linear-gradient(90deg,#fde047,#f59e0b)' }}
          >
            💬 Chat Creators Now
          </button>

          <p className="text-xs mt-4" style={{ color: canClose ? '#6b7280' : '#fbbf24' }}>
            {canClose ? 'Tap ✕ to continue' : `You can close this in ${secondsLeft}s`}
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
