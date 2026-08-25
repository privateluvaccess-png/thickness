const { activateSubscription } = require('../subscriptions');
const { recordMissionAction } = require('../missions');
const PRODUCTS = require('../../config/products');

async function fulfillPayment(productKey, telegramId, ctx) {
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
