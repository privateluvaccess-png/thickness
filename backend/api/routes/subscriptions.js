const router = require('express').Router();
const { checkSubscription } = require('../../modules/subscriptions');

router.get('/:telegram_id', async (req, res) => {
  try {
    const status = await checkSubscription(req.params.telegram_id);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
