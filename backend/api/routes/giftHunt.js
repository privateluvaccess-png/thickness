const router = require('express').Router();
const { getStatus, claim } = require('../../modules/giftHunt');

router.get('/status/:user_id', async (req, res) => {
  try {
    const status = await getStatus(req.params.user_id);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/claim', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    const result = await claim(user_id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
