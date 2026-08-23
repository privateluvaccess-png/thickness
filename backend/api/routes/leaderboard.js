const router = require('express').Router();
const { getLeaderboard } = require('../../modules/weeklyChallenge');

router.get('/', async (req, res) => {
  try {
    const { user_id, limit } = req.query;
    const result = await getLeaderboard(user_id || null, parseInt(limit) || 10);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
