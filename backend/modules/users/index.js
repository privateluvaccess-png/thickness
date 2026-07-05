const crypto = require('crypto');
const supabase = require('../../supabase');

// Verifies that the request actually came from Telegram
function verifyTelegramInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    params.delete('hash');

    const checkString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(process.env.BOT_TOKEN)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    if (expectedHash !== hash) return null;

    const userParam = params.get('user');
    return userParam ? JSON.parse(userParam) : null;
  } catch {
    return null;
  }
}

async function getOrCreateUser(telegramUser) {
  const { id, username, first_name } = telegramUser;

  const { data: existing } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', id)
    .single();

  if (existing) return existing;

  const { data: newUser } = await supabase
    .from('users')
    .insert({ telegram_id: id, username, first_name, notifications_enabled: true })
    .select()
    .single();

  return newUser;
}

async function setNotificationsEnabled(telegramId, enabled) {
  const { data } = await supabase
    .from('users')
    .update({ notifications_enabled: enabled })
    .eq('telegram_id', telegramId)
    .select()
    .single();

  return data;
}

async function getUserById(telegramId) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  return data;
}

module.exports = { getOrCreateUser, getUserById, verifyTelegramInitData, setNotificationsEnabled };
