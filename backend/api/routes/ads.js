const router = require('express').Router();
const { getAdSettings } = require('../../modules/adSettings');

router.get('/settings', async (req, res) => {
  try {
    const settings = await getAdSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
