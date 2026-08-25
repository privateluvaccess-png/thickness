const router = require('express').Router();
const { getUserMissionsToday, recordMissionAction } = require('../../modules/missions');

router.get('/today/:user_id', async (req, res) => {
  try {
    const missions = await getUserMissionsToday(req.params.user_id);
    res.json({ success: true, missions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sharing happens entirely client-side (opens Telegram's native share
// sheet), so there's nothing else on the server to hook this into —
// the frontend calls this right after the share sheet opens, to give
// mission credit. refId is the post that was shared, so sharing the
// same post twice in one day only counts once (same dedup rule as
// likes/bookmarks/ads).
router.post('/share/:user_id', async (req, res) => {
  try {
    const { post_id } = req.body;
    if (!post_id) return res.status(400).json({ error: 'Missing post_id' });
    const result = await recordMissionAction(req.params.user_id, 'share', post_id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
