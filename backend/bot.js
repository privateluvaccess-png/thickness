const { Telegraf } = require('telegraf');
const { getOrCreateUser, setNotificationsEnabled } = require('./modules/users');
const { syncPost, deletePost } = require('./modules/posts');
const { setActiveLink } = require('./modules/link');
const { fulfillPayment } = require('./modules/payments');
const { broadcastNewPost } = require('./modules/broadcast');
const { FREE_CHANNEL_ID, PREMIUM_CHANNEL_ID } = require('./config/channels');

const bot = new Telegraf(process.env.BOT_TOKEN);

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

function isLinkOnlyPost(message) {
  // No media attached
  if (message.photo || message.video || message.document) return false;
  // Has text or caption that contains a URL
  const text = message.text || message.caption || '';
  const url = extractUrl(text);
  // Only consider it "link only" if the whole message is essentially just the URL
  // (text with no other words beyond the URL itself)
  if (!url) return false;
  const stripped = text.replace(url, '').trim();
  return stripped.length === 0;
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const user = ctx.from;
  await getOrCreateUser(user);

  // Shared-post deep link: /start post_<id> (sent when someone taps a
  // "Share" button on a post). Opens the Mini App straight to that post
  // instead of the generic welcome screen.
  const payload = ctx.startPayload || '';
  const sharedPostId = payload.startsWith('post_') ? payload.slice('post_'.length) : null;

  if (sharedPostId) {
    await ctx.reply(
      `👀 Someone shared a post with you on *Thickness!*\n\nTap below to view it.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🌟 Open Post', web_app: { url: `${process.env.FRONTEND_URL}?post=${encodeURIComponent(sharedPostId)}` } }
          ]]
        }
      }
    );
    return;
  }

  await ctx.reply(
    `Welcome to *Thickness!* 🌟\n\nBrowse free content or unlock premium for exclusive posts.\n\nTap below to open the app!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🌟 Open Thickness', web_app: { url: process.env.FRONTEND_URL } }
        ]]
      }
    }
  );
});

// ── Notification opt-out/opt-in ───────────────────────────────────────────────
bot.command('notifications', async (ctx) => {
  const arg = ctx.message.text.split(' ')[1]?.toLowerCase();

  if (arg === 'off') {
    await setNotificationsEnabled(ctx.from.id, false);
    return ctx.reply('🔕 New content alerts are now off. Send /notifications on to turn them back on.');
  }

  if (arg === 'on') {
    await setNotificationsEnabled(ctx.from.id, true);
    return ctx.reply('🔔 New content alerts are on. You\'ll get a message whenever new content drops.');
  }

  return ctx.reply('Use /notifications on or /notifications off to control new-content alerts.');
});

// ── Channel post listener ─────────────────────────────────────────────────────
bot.on('channel_post', async (ctx) => {
  const message = ctx.channelPost;
  const chatId = String(message.chat.id);
  const tier = chatId === String(FREE_CHANNEL_ID) ? 'free'
             : chatId === String(PREMIUM_CHANNEL_ID) ? 'premium'
             : null;

  if (!tier) return;

  // If it's a link-only post, save as active link — don't add to feed
  if (isLinkOnlyPost(message)) {
    const text = message.text || message.caption || '';
    const url = extractUrl(text);
    await setActiveLink(url, tier);
    return;
  }

  // Otherwise sync as a normal post
  const post = await syncPost(message, tier);

  // Let every bot user know new content just went up
  if (post) {
    broadcastNewPost(bot, post, tier).catch((err) =>
      console.error('broadcastNewPost error:', err.message)
    );
  }
});

// ── Channel post deleted ──────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const update = ctx.update;
  if (update.channel_post_deleted || update.deleted_channel_post) {
    try {
      const messageId =
        update.deleted_channel_post?.message_id ||
        update.channel_post_deleted?.message_id;
      if (messageId) await deletePost(messageId);
    } catch (err) {
      console.error('Delete sync error:', err.message);
    }
    return;
  }
  return next();
});

// ── Telegram Stars payments ───────────────────────────────────────────────────
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('message', async (ctx) => {
  const payment = ctx.message?.successful_payment;
  if (!payment) return;

  const payload = payment.invoice_payload;
  const parts = payload.split('_');
  const telegramId = parts[parts.length - 1];
  const productKey = parts.slice(0, -1).join('_');

  await fulfillPayment(productKey, telegramId, ctx);
});

module.exports = bot;
