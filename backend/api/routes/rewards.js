const router = require('express').Router();
const { processMonetagPostback, getAdWatchStatus } = require('../../modules/rewardedAds');

// Monetag calls this directly, server-to-server, when a Rewarded
// Interstitial or Rewarded Popup event is confirmed on their end.
// It is NOT triggered by the frontend, and the frontend's .then()
// callback (in App.jsx / wherever the ad is shown) must NOT grant
// any reward itself — only this endpoint does.
//
// ── Setup (one-time, in Monetag's "Postback for Thicknessbot" screen) ──
// That screen only exposes these macros: Telegram ID, Zone ID,
// Sub zone ID, Event type, Reward event type, Estimated price, YMID
// (no request_var here, so ad "format" — popup vs interstitial —
// won't be tracked per event; that's fine, it's non-critical metadata
// and the `format` column is nullable).
//
// In the "Your backend URL" box, type the static parts yourself and
// tap each macro chip to insert its real placeholder at the cursor:
//   https://<your-backend>/api/rewards/postback/monetag?token=<MONETAG_POSTBACK_SECRET>&ymid=[tap YMID chip]&event_type=[tap Event type chip]&reward_event_type=[tap Reward event type chip]&telegram_id=[tap Telegram ID chip]&estimated_price=[tap Estimated price chip]
// `token` is a literal value YOU choose (also set as
// MONETAG_POSTBACK_SECRET on the backend) — since it's static in the
// URL you configure, only a request coming through Monetag's
// configured postback can produce it.
router.get('/postback/monetag', async (req, res) => {
  try {
    const expectedToken = process.env.MONETAG_POSTBACK_SECRET;
    const providedToken = req.query.token;
    if (!expectedToken || providedToken !== expectedToken) {
      // Log the mismatch (not the actual secret values) so a bad
      // token is visible in Render logs instead of silently vanishing.
      console.warn('[rewards/postback/monetag] rejected: token mismatch',
        { tokenConfigured: !!expectedToken, tokenProvided: !!providedToken });
      // Still 200 — an attacker fishing for a working token shouldn't
      // learn anything from the status code, and there's nothing for
      // Monetag to usefully retry here either way.
      return res.status(200).json({ ok: false });
    }

    console.log('[rewards/postback/monetag] received:', {
      ymid: req.query.ymid,
      event_type: req.query.event_type,
      reward_event_type: req.query.reward_event_type,
      telegram_id: req.query.telegram_id,
      estimated_price: req.query.estimated_price,
    });

    const result = await processMonetagPostback({
      ymid: req.query.ymid,
      telegramIdFromMacro: req.query.telegram_id,
      format: req.query.request_var,
      eventType: req.query.event_type,
      rewardEventType: req.query.reward_event_type,
      estimatedPrice: req.query.estimated_price ? Number(req.query.estimated_price) : null,
    });

    console.log('[rewards/postback/monetag] result:', result);

    // Always 200 on a handled request — Monetag retries on non-2xx,
    // and "not granted because not valued / over cap / duplicate" is
    // a normal outcome, not a delivery failure.
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // A genuine server error (e.g. DB unreachable) — let Monetag retry.
    console.error('[rewards/postback/monetag] error:', err.message);
    res.status(500).json({ ok: false });
  }
});

// Returns the current rewarded-ad status for a user:
// how many ads they've watched today, the daily cap, when
// the daily count resets (next UTC midnight), and whether
// a per-ad cooldown is currently active.
// Used by RewardedAdButton.jsx to drive the countdown UI.
// The backend remains the real enforcement gate — this is
// only a status read so the frontend can display accurate info.
router.get('/ad-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ ok: false, error: 'userId is required' });
    }
    const statusData = await getAdWatchStatus(userId);
    res.status(200).json(statusData);
  } catch (err) {
    console.error('[rewards/ad-status] error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch ad watch status' });
  }
});

module.exports = router;
