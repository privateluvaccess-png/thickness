const router = require('express').Router();
const { getUserMissionsToday } = require('../../modules/missions');

router.get('/today/:user_id', async (req, res) => {
  try {
    const missions = await getUserMissionsToday(req.params.user_id);
    res.json({ success: true, missions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
