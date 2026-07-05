const supabase = require('../../supabase');

const BATCH_SIZE = 25;       // how many sends to fire before pausing
const BATCH_DELAY_MS = 1000; // pause between batches (stays under Telegram's ~30 msg/sec limit)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function labelForType(type) {
  if (type === 'image') return 'photo';
  if (type === 'video') return 'video';
  if (type === 'document') return 'file';
  return 'post';
}

function buildMessage(post, tier) {
  const kind = labelForType(post?.type);
  const tierLabel = tier === 'premium' ? 'Premium 🌟' : 'Free';
  return (
    `🔥 New ${kind} just dropped!\n\n` +
    `Tier: ${tierLabel}\n\n` +
    `Tap below to check it out.`
  );
}

// Returns today's date as YYYY-MM-DD (UTC).
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Atomically claims "today" as already-notified.
// Returns true if THIS call is the first one to claim it today (so we should send),
// false if something already claimed today (so we should skip).
// Relies on `date` being a UNIQUE/PRIMARY KEY column on daily_broadcasts,
// so concurrent posts can't both win the race.
async function claimTodaysBroadcast() {
  const { error } = await supabase
    .from('daily_broadcasts')
    .insert({ date: todayKey() });

  // No error → we were first to insert today's row → we're clear to notify.
  // Unique violation (code 23505) → someone already notified today → skip.
  if (!error) return true;
  if (error.code === '23505') return false;

  console.error('broadcast: daily gate check failed:', error.message);
  return false; // fail safe: don't spam if we're unsure
}

// Fetch every user who has ever /start'ed the bot and still has notifications on.
async function getSubscribedUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('telegram_id')
    .eq('notifications_enabled', true);

  if (error) {
    console.error('broadcast: failed to load users:', error.message);
    return [];
  }

  return data || [];
}

// Turn a user off after Telegram tells us the chat is gone / bot was blocked,
// so we stop wasting calls on them on every future post.
async function disableNotifications(telegramId) {
  await supabase
    .from('users')
    .update({ notifications_enabled: false })
    .eq('telegram_id', telegramId);
}

/**
 * Notify every bot user that a new piece of content was posted.
 * Call this right after a post is successfully synced into the `posts` table.
 *
 * @param {import('telegraf').Telegraf} bot
 * @param {object} post - the row returned from posts.syncPost
 * @param {'free'|'premium'} tier
 */
async function broadcastNewPost(bot, post, tier) {
  if (!bot || !post) return;

  const isFirstToday = await claimTodaysBroadcast();
  if (!isFirstToday) return; // already notified everyone once today

  const users = await getSubscribedUsers();
  if (!users.length) return;

  const text = buildMessage(post, tier);
  const keyboard = {
    inline_keyboard: [[
      { text: '🌟 Open Thickness', web_app: { url: process.env.FRONTEND_URL } }
    ]]
  };

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async ({ telegram_id }) => {
      try {
        await bot.telegram.sendMessage(telegram_id, text, { reply_markup: keyboard });
      } catch (err) {
        const code = err?.response?.error_code;
        // 403 = bot blocked by user, 400 = chat not found/deactivated account
        if (code === 403 || code === 400) {
          await disableNotifications(telegram_id);
        } else {
          console.error(`broadcast: failed to notify ${telegram_id}:`, err.message);
        }
      }
    }));

    if (i + BATCH_SIZE < users.length) await sleep(BATCH_DELAY_MS);
  }
}

module.exports = { broadcastNewPost };
