require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bot = require('./bot');
const paymentsModule = require('./api/routes/payments');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests, slow down.' },
});
app.use('/api/', limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/',       (req, res) => res.json({ status: 'Thickness Backend Running 🌟' }));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/users',         require('./api/routes/users'));
app.use('/api/posts',         require('./api/routes/posts'));
app.use('/api/subscriptions', require('./api/routes/subscriptions'));
app.use('/api/payments',      paymentsModule.router);
app.use('/api/likes',         require('./api/routes/likes'));
app.use('/api/comments',      require('./api/routes/comments'));
app.use('/api/bookmarks',     require('./api/routes/bookmarks'));
app.use('/api/notifications', require('./api/routes/notifications'));
app.use('/api/link',          require('./api/routes/link'));
app.use('/api/xp',            require('./api/routes/xp'));
app.use('/api/admin',         require('./api/routes/admin'));

// Inject bot into payments module
paymentsModule.setBot(bot);

// ── Start ─────────────────────────────────────────────────────────────────────
bot.launch();
console.log('🤖 Thickness Bot is running...');

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

app.listen(PORT, () => {
  console.log(`🌟 Thickness Backend running on port ${PORT}`);
});
