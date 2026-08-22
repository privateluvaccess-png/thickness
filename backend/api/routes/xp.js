const router = require('express').Router();
const { getUserXpSummary, getUserXpHistory } = require('../../modules/xp');

router.get('/:telegram_id', async (req, res) => {
  try {
    const summary = await getUserXpSummary(req.params.telegram_id);
    res.json({ success: true, ...summary });
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
