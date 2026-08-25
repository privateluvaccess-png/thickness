const router = require('express').Router();
const { getFeed, getPostById, deletePostById, getPinnedNewUserPosts, getPremiumTeaserPosts } = require('../../modules/posts');
const { getUserById } = require('../../modules/users');
const { checkSubscription } = require('../../modules/subscriptions');
const { isNewUser } = require('../../modules/newUser');
const requireAdmin = require('../../middleware/requireAdmin');
const { isAdminId } = require('../../middleware/requireAdmin');

// Proxy Telegram file so the frontend can display images/videos.
// TELEGRAM_API_ROOT points at a self-hosted telegram-bot-api instance
// (see /telegram-bot-api-render) when set, which raises the file size
// cap from 20MB to 2GB. Falls back to the standard cloud Bot API.
const TELEGRAM_API_ROOT      = process.env.TELEGRAM_API_ROOT || 'https://api.telegram.org';
const TELEGRAM_FILE_API_ROOT = process.env.TELEGRAM_FILE_API_ROOT || 'https://api.telegram.org';

router.get('/media/:file_id', async (req, res) => {
  try {
    const token  = process.env.BOT_TOKEN;
    const fileId = req.params.file_id;

    // Content for a given file_id never changes, so we can tell the
    // browser to cache it "forever" and skip re-fetching + re-streaming
    // entirely on repeat views. If the browser already has it cached
    // and just wants to confirm it's still valid, answer with 304 and
    // skip hitting Telegram (and re-streaming the file) altogether.
    const etag = `"${fileId}"`;
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    // 1. Ask Telegram (or our self-hosted instance) for the file path
    const infoRes  = await fetch(
      `${TELEGRAM_API_ROOT}/bot${token}/getFile?file_id=${fileId}`
    );
    const infoJson = await infoRes.json();
    const filePath = infoJson?.result?.file_path;
    if (!filePath) return res.status(404).json({ error: 'File not found' });

    // 2. Stream the actual file back to the client
    const fileRes = await fetch(
      `${TELEGRAM_FILE_API_ROOT}/file/bot${token}/${filePath}`
    );
    if (!fileRes.ok) return res.status(502).json({ error: 'Telegram fetch failed' });

    res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'application/octet-stream');
    // 1 year + immutable: the browser won't even ask again until this
    // expires, since file_id -> bytes is a permanent mapping.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);

    const { Readable } = require('stream');
    Readable.fromWeb(fileRes.body).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/feed', async (req, res) => {
  try {
    const { tier, user_id } = req.query;

    let newUserFlag = false;
    let premiumFlag = false;
    // Admin always sees full media (they need it for moderation in the
    // Channel Admin panel), same as the free/premium tab logic on the
    // frontend already assumes.
    const adminFlag = isAdminId(user_id);
    if (user_id) {
      const [user, subscription] = await Promise.all([
        getUserById(user_id),
        checkSubscription(user_id),
      ]);
      newUserFlag = await isNewUser(user);
      premiumFlag = !!subscription.isPremium;
    }

    const posts = await getFeed(
      tier && tier !== 'all' ? tier : null,
      user_id || null,
      { isNewUser: newUserFlag, isPremiumUser: premiumFlag, isAdmin: adminFlag }
    );
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Small, capped, real-media preview of Premium posts for the free-tier
// "scroll to unlock a free video" teaser feature. Deliberately public
// (no premium check — that's the point, it's the free sample) but
// bounded server-side (see TEASER_POOL_LIMIT in modules/posts) so it
// can never become a way to pull the entire premium catalog, unlike the
// old approach of feeding the whole premium feed to the client and only
// hiding most of it in the UI.
router.get('/teaser', async (req, res) => {
  try {
    const posts = await getPremiumTeaserPosts();
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New-user onboarding posts — any existing post the admin has pinned,
// shown above the regular feed only to users still inside their
// new-user window.
router.get('/pinned-new-user/:user_id', async (req, res) => {
  try {
    const user = await getUserById(req.params.user_id);
    const eligible = await isNewUser(user);
    if (!eligible) return res.json({ success: true, posts: [] });

    const posts = await getPinnedNewUserPosts();
    res.json({ success: true, posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: delete a post by its database ID
router.delete('/:post_id', requireAdmin, async (req, res) => {
  try {
    await deletePostById(req.params.post_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Used for deep-link navigation (navigateToPostId in Feed.jsx). Same
// media-stripping rule as /feed applies here — a direct-by-ID lookup
// must not be a way around the paywall either.
router.get('/:post_id', async (req, res) => {
  try {
    const { user_id } = req.query;
    const post = await getPostById(req.params.post_id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (post.tier === 'premium') {
      const adminFlag = isAdminId(user_id);
      const subscription = user_id ? await checkSubscription(user_id) : { isPremium: false };
      if (!subscription.isPremium && !adminFlag) {
        const { media_url, file_id, ...rest } = post;
        return res.json({ success: true, post: { ...rest, locked: true } });
      }
    }

    res.json({ success: true, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
