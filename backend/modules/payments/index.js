const { activateSubscription } = require('../subscriptions');
const { recordMissionAction } = require('../missions');
const PRODUCTS = require('../../config/products');
const { fulfillTokenPayment } = require('../tokens');

async function fulfillPayment(productKey, telegramId, ctx, payment) {
  // Battle token pack (payload: tk_<tokenAmount>_<telegramId>)
  if (productKey.startsWith('tk_')) {
    try {
      const result = await fulfillTokenPayment(productKey, telegramId, payment);
      if (result.credited) await ctx.reply(`✅ Tokens added! Your balance is now ${result.balance} 🪙. Head to the Battle tab to vote. ⚔️`);
    } catch (err) {
      console.error('[payments] token credit failed:', err.message);
      await ctx.reply('⚠️ We received your payment but could not add the tokens. Please contact support.');
    }
    return;
  }

  const product = Object.values(PRODUCTS).find(p => p.key === productKey);
  if (!product) return;

  await activateSubscription(telegramId, product.days);

  // Real, paid purchase — safe to count toward missions since this
  // only runs after Telegram confirms payment (unlike the removed
  // DevBoost endpoint, this path can't be called for free).
  recordMissionAction(telegramId, 'buy_premium', productKey).catch(err =>
    console.error('[payments] recordMissionAction failed:', err.message)
  );

  const label = product.label;
  await ctx.reply(`✅ ${label} activated! You now have full access to premium content. 🌟`);
}

module.exports = { fulfillPayment };
