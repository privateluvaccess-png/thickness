const router = require('express').Router();
const { getUserXpSummary, getUserXpHistory } = require('../../modules/xp');
const { getLevelInfo } = require('../../modules/levels');
const { getUserStreak } = require('../../modules/streaks');

router.get('/:telegram_id', async (req, res) => {
  try {
    const summary = await getUserXpSummary(req.params.telegram_id);
    const [levelInfo, streak] = await Promise.all([
      getLevelInfo(summary.lifetimeXp),
      getUserStreak(req.params.telegram_id),
    ]);
    res.json({ success: true, ...summary, ...levelInfo, streak });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:telegram_id/history', async (req, res) => {
  try {
    const history = await getUserXpHistory(req.params.telegram_id, parseInt(req.query.limit) || 20);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
