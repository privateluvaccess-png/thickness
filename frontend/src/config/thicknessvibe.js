// ThicknessVibe — social media discovery tool for Telegram creators.
export const THICKNESSVIBE_URL = 'https://t.me/Thicknessvibebot';

// Opens the bot inside Telegram (no browser bounce). Falls back to a
// normal link when running outside Telegram.
export function openThicknessVibe() {
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(THICKNESSVIBE_URL);
  } else {
    window.open(THICKNESSVIBE_URL, '_blank', 'noopener');
  }
}
