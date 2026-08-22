const router = require('express').Router();
const { processMonetagPostback } = require('../../modules/rewardedAds');

// Monetag calls this directly, server-to-server, when a Rewarded
// Interstitial or Rewarded Popup event is confirmed on their end.
// It is NOT triggered by the frontend, and the frontend's .then()
// callback (in App.jsx / wherever the ad is shown) must NOT grant
// any reward itself — only this endpoint does.
//
// ── Setup (one-time, done in the Monetag SSP dashboard) ────────────
// Configure the postback URL for zone 11218209 as:
//   https://<your-backend>/api/rewards/postback/monetag
//     ?token=<MONETAG_POSTBACK_SECRET>
//     &ymid={ymid}
//     &event_type={event_type}
//     &reward_event_type={reward_event_type}
//     &request_var={request_var}
//     &telegram_id={telegram_id}
//     &estimated_price={estimated_price}
// The `token` is a literal value YOU choose (set as MONETAG_POSTBACK_SECRET
// on the backend) — it's static in the URL you configure, so only
// Monetag's server (calling the URL you set up) can produce a request
// with the correct token. Everything else is a Monetag macro that
// gets substituted with real values per event.
router.get('/postback/monetag', async (req, res) => {
  try {
    const expectedToken = process.env.MONETAG_POSTBACK_SECRET;
    const providedToken = req.query.token;
    if (!expectedToken || providedToken !== expectedToken) {
      // Still 200 — an attacker fishing for a working token shouldn't
      // learn anything from the status code, and there's nothing for
      // Monetag to usefully retry here either way.
      return res.status(200).json({ ok: false });
    }

    const result = await processMonetagPostback({
      ymid: req.query.ymid,
      telegramIdFromMacro: req.query.telegram_id,
      format: req.query.request_var,
      eventType: req.query.event_type,
      rewardEventType: req.query.reward_event_type,
      estimatedPrice: req.query.estimated_price ? Number(req.query.estimated_price) : null,
    });

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

module.exports = router;
