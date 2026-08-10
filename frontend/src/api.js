import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
  timeout: 35000,
});

export const loginUser             = (initData)               => API.post('/api/users/login', { init_data: initData });
export const getUser               = (telegramId)             => API.get(`/api/users/${telegramId}`);
export const getFreeFeed           = (userId)                => API.get(`/api/posts/feed?tier=free${userId ? `&user_id=${userId}` : ''}`);
export const getFullFeed           = (userId)                => API.get(`/api/posts/feed?tier=premium${userId ? `&user_id=${userId}` : ''}`);
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

export const deletePost            = (postId, adminSecret)    => API.delete(`/api/posts/${postId}`, { headers: { 'x-admin-secret': adminSecret } });
export const getActiveLink = () => API.get('/api/link');
export const checkDevPassword     = (password)                => API.post('/api/auth/dev-unlock', { password });
