const router = require('express').Router();
const { verifyTelegramInitData } = require('../../modules/users');
const { isAdminId } = require('../../middleware/requireAdmin');
const { getBattleView, castTokenVote, castFreeVote, getBattleSettings } = require('../../modules/battles');
const { listPacks } = require('../../modules/tokens');

// Voting spends tokens and rewards XP, so unlike most routes in this app the
// user's identity here comes from the SIGNED Telegram initData, never from a
// user_id the client simply claims.
function verifiedUser(req) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return null;
  return verifyTelegramInitData(initData);
}

// Current battle + token balance + packs + last result.
// (Starting/settling battles happens lazily in here.)
router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    const view = await getBattleView(user_id || null, { isAdmin: isAdminId(user_id) });
    res.json({ success: true, ...view });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Spend tokens: { battle_id, side, qty }
router.post('/vote', async (req, res) => {
  try {
    const tgUser = verifiedUser(req);
    if (!tgUser) return res.status(403).json({ error: 'Please reopen the app and try again.' });

    const { battle_id, side, qty } = req.body;
    const r = await castTokenVote({ battleId: battle_id, userId: tgUser.id, side, qty });
    if (!r.ok) {
      const msg = r.reason === 'insufficient' ? 'Not enough tokens.'
        : r.reason === 'ended' ? 'This battle has ended.' : 'Vote not counted.';
      return res.status(400).json({ error: msg, reason: r.reason, balance: r.balance });
    }
    res.json({ success: true, balance: r.balance, spent: r.cost });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Creates a Stars invoice for one token pack: { pack_id }.
// Tokens are only credited after Telegram confirms payment (see bot.js).
router.post('/tokens/invoice', async (req, res) => {
  try {
    const tgUser = verifiedUser(req);
    if (!tgUser) return res.status(403).json({ error: 'Please reopen the app and try again.' });

    const packs = await listPacks({ activeOnly: true });
    const pack = packs.find(p => String(p.id) === String(req.body.pack_id));
    if (!pack) return res.status(400).json({ error: 'That pack is no longer available.' });

    const bot = require('../../bot'); // lazy: bot.js loads modules that load this route
    const invoice = await bot.telegram.createInvoiceLink({
      title: `${pack.tokens} Battle Tokens`,
      description: 'Tokens to vote in Thickness Video Battles',
      payload: `tk_${pack.tokens}_${tgUser.id}`,
      currency: 'XTR',
      prices: [{ label: `${pack.tokens} tokens`, amount: pack.stars }],
    });
    res.json({ success: true, invoice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Free votes (only if the admin gave some per battle; default is 0).
router.post('/free-vote', async (req, res) => {
  try {
    const tgUser = verifiedUser(req);
    if (!tgUser) return res.status(403).json({ error: 'Please reopen the app and try again.' });

    const settings = await getBattleSettings();
    if (!settings.enabled || settings.free_votes_per_battle <= 0) {
      return res.status(400).json({ error: 'Free votes are not available.' });
    }
    const { battle_id, side } = req.body;
    if (!['a', 'b'].includes(side)) return res.status(400).json({ error: 'Invalid side.' });

    const result = await castFreeVote({ battleId: battle_id, userId: tgUser.id, side });
    if (!result.counted) {
      const msg = result.reason === 'no_free_votes' ? 'You have used your free votes for this battle.'
        : result.reason === 'ended' ? 'This battle has ended.' : 'Vote not counted.';
      return res.status(400).json({ error: msg });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
