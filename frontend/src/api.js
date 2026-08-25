import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
  timeout: 35000,
});

export const loginUser             = (initData)               => API.post('/api/users/login', { init_data: initData });
export const getUser               = (telegramId)             => API.get(`/api/users/${telegramId}`);
export const getFreeFeed           = (userId)                => API.get(`/api/posts/feed?tier=free${userId ? `&user_id=${userId}` : ''}`);
export const getFullFeed           = (userId)                => API.get(`/api/posts/feed?tier=premium${userId ? `&user_id=${userId}` : ''}`);
// Small, capped, real-media sample of Premium posts — powers the
// "scroll to unlock a free video" teaser for non-Premium users. Unlike
// getFullFeed, this is meant to return real media to non-Premium users
// (that's the whole point of the promo), but the backend caps how many
// posts it hands out so it can never become a full-catalog leak.
export const getTeaserPosts        = ()                      => API.get(`/api/posts/teaser`);
export const getPost               = (postId)                 => API.get(`/api/posts/${postId}`);
export const getSubscription       = (telegramId)             => API.get(`/api/subscriptions/${telegramId}`);
export const createInvoice         = (telegramId, productKey) => API.post('/api/payments/invoice', { telegram_id: telegramId, product_key: productKey });
export const toggleLike            = (userId, postId)         => API.post('/api/likes/toggle', { user_id: userId, post_id: postId });
export const getLikes              = (postId, userId)         => API.get(`/api/likes/${postId}?user_id=${userId}`);
export const getComments           = (postId)                 => API.get(`/api/comments/${postId}`);
export const postComment           = (userId, postId, text)   => API.post('/api/comments', { user_id: userId, post_id: postId, text });
export const toggleBookmark        = (userId, postId)         => API.post('/api/bookmarks/toggle', { user_id: userId, post_id: postId });
export const getUserBookmarks      = (userId)                 => API.get(`/api/bookmarks/user/${userId}`);
export const getNotifications      = (userId)                 => API.get(`/api/notifications/${userId}`);
export const markNotificationsRead = (userId)                 => API.post(`/api/notifications/read/${userId}`);

export const deletePost            = (postId, initData)       => API.delete(`/api/posts/${postId}`, { headers: { 'x-telegram-init-data': initData } });
export const getActiveLink = () => API.get('/api/link');
export const checkDevPassword     = (password)                => API.post('/api/auth/dev-unlock', { password });

// Admin panel — authenticated via Telegram's own signed initData
// (verified server-side against BOT_TOKEN), not a client-visible secret.
export const getAdminStats = (initData) =>
  API.get('/api/admin/stats', { headers: { 'x-telegram-init-data': initData } });
export const getAdminPosts = (initData, cursor) =>
  API.get(`/api/admin/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
    headers: { 'x-telegram-init-data': initData },
  });

// Admin panel — Premium (paid/lifetime/earned breakdown, manual grant/revoke)
export const getAdminPremiumBreakdown = (initData, userId) =>
  API.get(`/api/admin/premium/${userId}`, { headers: { 'x-telegram-init-data': initData } });
export const getAdminPremiumHistory = (initData, userId) =>
  API.get(`/api/admin/premium/${userId}/history`, { headers: { 'x-telegram-init-data': initData } });
export const grantAdminPremium = (initData, userId, days, note) =>
  API.post('/api/admin/premium/grant', { user_id: userId, days, note }, { headers: { 'x-telegram-init-data': initData } });
export const revokeAdminPremium = (initData, userId, note) =>
  API.post('/api/admin/premium/revoke', { user_id: userId, note }, { headers: { 'x-telegram-init-data': initData } });

// Admin panel — XP ledger lookup + manual adjustment
export const getAdminXp = (initData, userId) =>
  API.get(`/api/admin/xp/${userId}`, { headers: { 'x-telegram-init-data': initData } });
export const grantAdminXp = (initData, userId, points, note) =>
  API.post('/api/admin/xp/grant', { user_id: userId, points, note }, { headers: { 'x-telegram-init-data': initData } });

// Read a user's own XP summary (used by the future Level/XP display)
export const getMyXp = (userId) => API.get(`/api/xp/${userId}`);

// Ad format settings — public read (frontend decides which show_11218209
// calls to make); admin write (toggle formats on/off).
export const getAdSettings = () => API.get('/api/ads/settings');

// Rewarded-ad status for a user: daily usage, cap, reset time, cooldown.
// Used by RewardedAdButton to drive the countdown UI.
// The backend remains the real enforcement gate — this is a read-only status call.
export const getAdWatchStatus = (userId) =>
  API.get(`/api/rewards/ad-status/${userId}`);
export const getAdminAdSettings = (initData) =>
  API.get('/api/admin/ads/settings', { headers: { 'x-telegram-init-data': initData } });
export const updateAdminAdSettings = (initData, settings) =>
  API.post('/api/admin/ads/settings', settings, { headers: { 'x-telegram-init-data': initData } });

// Gift Hunt — public status/claim
export const getGiftHuntStatus = (userId) => API.get(`/api/gift-hunt/status/${userId}`);
export const claimGiftHunt = (userId) => API.post('/api/gift-hunt/claim', { user_id: userId });

// Gift Hunt — admin settings
export const getAdminGiftHuntSettings = (initData) =>
  API.get('/api/admin/gift-hunt/settings', { headers: { 'x-telegram-init-data': initData } });
export const updateAdminGiftHuntSettings = (initData, settings) =>
  API.post('/api/admin/gift-hunt/settings', settings, { headers: { 'x-telegram-init-data': initData } });

// Missions — public read
export const getMissionsToday = (userId) => API.get(`/api/missions/today/${userId}`);
export const recordShare = (userId, postId) =>
  API.post(`/api/missions/share/${userId}`, { post_id: postId });

// Missions — admin CRUD
export const getAdminMissions = (initData) =>
  API.get('/api/admin/missions', { headers: { 'x-telegram-init-data': initData } });
export const createAdminMission = (initData, mission) =>
  API.post('/api/admin/missions', mission, { headers: { 'x-telegram-init-data': initData } });
export const updateAdminMission = (initData, id, fields) =>
  API.patch(`/api/admin/missions/${id}`, fields, { headers: { 'x-telegram-init-data': initData } });
export const deleteAdminMission = (initData, id) =>
  API.delete(`/api/admin/missions/${id}`, { headers: { 'x-telegram-init-data': initData } });

// Pinned new-user onboarding posts (public — server checks eligibility)
export const getPinnedNewUserPosts = (userId) => API.get(`/api/posts/pinned-new-user/${userId}`);

// Streak milestones — admin CRUD
export const getAdminStreakMilestones = (initData) =>
  API.get('/api/admin/streaks/milestones', { headers: { 'x-telegram-init-data': initData } });
export const createAdminStreakMilestone = (initData, milestone) =>
  API.post('/api/admin/streaks/milestones', milestone, { headers: { 'x-telegram-init-data': initData } });
export const updateAdminStreakMilestone = (initData, id, fields) =>
  API.patch(`/api/admin/streaks/milestones/${id}`, fields, { headers: { 'x-telegram-init-data': initData } });
export const deleteAdminStreakMilestone = (initData, id) =>
  API.delete(`/api/admin/streaks/milestones/${id}`, { headers: { 'x-telegram-init-data': initData } });

// Level curve — admin settings
export const getAdminLevelSettings = (initData) =>
  API.get('/api/admin/levels/settings', { headers: { 'x-telegram-init-data': initData } });
export const updateAdminLevelSettings = (initData, settings) =>
  API.post('/api/admin/levels/settings', settings, { headers: { 'x-telegram-init-data': initData } });

// New User — admin settings
export const getAdminNewUserSettings = (initData) =>
  API.get('/api/admin/new-user/settings', { headers: { 'x-telegram-init-data': initData } });
export const updateAdminNewUserSettings = (initData, settings) =>
  API.post('/api/admin/new-user/settings', settings, { headers: { 'x-telegram-init-data': initData } });

// Post audience + pin-for-new-users — admin
export const setAdminPostAudience = (initData, postId, audience) =>
  API.post(`/api/admin/posts/${postId}/audience`, { audience }, { headers: { 'x-telegram-init-data': initData } });
export const setAdminPostPin = (initData, postId, pinned, priority) =>
  API.post(`/api/admin/posts/${postId}/pin`, { pinned, priority }, { headers: { 'x-telegram-init-data': initData } });

// Weekly leaderboard — public read
export const getWeeklyLeaderboard = (userId) =>
  API.get(`/api/leaderboard${userId ? `?user_id=${userId}` : ''}`);

// Weekly Challenge — admin settings + results
export const getAdminWeeklyChallengeSettings = (initData) =>
  API.get('/api/admin/weekly-challenge/settings', { headers: { 'x-telegram-init-data': initData } });
export const updateAdminWeeklyChallengeSettings = (initData, settings) =>
  API.post('/api/admin/weekly-challenge/settings', settings, { headers: { 'x-telegram-init-data': initData } });
export const getAdminWeeklyChallengeResults = (initData, weekKey) =>
  API.get(`/api/admin/weekly-challenge/results${weekKey ? `?week_key=${weekKey}` : ''}`, { headers: { 'x-telegram-init-data': initData } });
