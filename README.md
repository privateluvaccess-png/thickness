# Thickness — Architecture & Ground Rules

This document exists so any developer or AI assistant touching this codebase
understands how it fits together *before* changing anything. This app has
grown a lot over time, has real paying users, and has already suffered one
serious security incident (see "Security lessons learned" below) from a
debug feature that leaked into production. Read this fully before editing.

## What this app is

A Telegram Mini App ("Thickness") — content posted in a Telegram channel is
mirrored into a web app with a Free tier and a paid Premium tier, plus a
gamification layer (daily missions, streaks, levels, weekly challenges,
"gift hunt") designed to drive engagement and reward users with premium
access without requiring payment, when the admin chooses to.

## Tech stack & where each piece lives

| Layer | Service | Repo path |
|---|---|---|
| Frontend (React + Vite) | **Vercel** | `frontend/` |
| Backend (Express + Telegraf bot) | **Render** | `backend/` |
| Database | **Supabase** (Postgres) | — |
| Media storage/CDN | **Cloudflare R2** | — |
| Payments | **Telegram Stars** (native, no third-party provider) | — |

**Critical rule: never mix these up.**
- `VITE_*` env vars → Vercel only. These get baked into the public JS bundle
  at build time — anyone can read them in browser devtools. **Never put a
  real secret in a `VITE_` var.** (This is exactly how a past incident
  happened — see below.)
- Everything else (`BOT_TOKEN`, `SUPABASE_SERVICE_KEY`, `R2_*`,
  `ADMIN_TELEGRAM_IDS`, etc.) → Render only, read via `process.env`.

## How content gets in

1. Admin posts a photo/video/text in the **Telegram channel(s)** — a Free
   channel and a Premium channel, IDs set via `FREE_CHANNEL_ID` /
   `PREMIUM_CHANNEL_ID`.
2. `backend/bot.js` listens for `channel_post` events via Telegraf.
3. `backend/modules/posts/index.js` → `syncPost()` runs:
   - Determines `tier` (`free`/`premium`) from which channel it came from.
   - Downloads the file from Telegram, uploads it to R2
     (`backend/modules/r2.js` → `uploadToR2()`), and stores the resulting
     public URL in `posts.media_url`.
   - If the R2 upload fails for any reason, `media_url` stays `null` and
     the post silently falls back to being served through
     `/api/posts/media/:file_id` (a proxy that re-fetches from Telegram on
     every request). **This fallback exists on purpose** — don't remove it
     without a plan for handling R2 outages — but it does mean any post
     with a `null` media_url is costing you bandwidth on Render instead of
     R2's free egress. Check periodically with:
     ```sql
     SELECT COUNT(*) FROM posts WHERE media_url IS NULL AND file_id IS NOT NULL;
     ```
4. Inserts the row into the `posts` table.

## Free vs Premium — how gating works

- `posts.tier` = `'free'` or `'premium'`.
- `GET /api/posts/feed?tier=free|premium` (`backend/modules/posts/index.js`
  → `getFeed()`) filters server-side by tier. **Do not** go back to
  fetching "everything" and filtering client-side — that was a real bug
  that caused premium posts to silently vanish once enough free posts
  pushed them out of a limit window. Always filter at the query level.
- Frontend (`Feed.jsx`) decides what a user can actually *see* based on
  `isPremium` (from `checkSubscription()`) or `isAdmin` (Telegram ID in
  `VITE_ADMIN_TELEGRAM_ID`, admin always sees everything).

## Premium access — TWO separate tracks, on purpose

This separation is intentional and important — don't merge these tables.

1. **`subscriptions` table** — real, paid access.
   - Written to *only* by `modules/subscriptions/index.js` →
     `activateSubscription()`, called *only* from
     `modules/payments/index.js` → `fulfillPayment()`, called *only* after
     Telegram confirms a real Stars payment (`bot.js`'s
     `successful_payment` handler).
   - `is_lifetime` + `expires_at` columns.

2. **`earned_premium` table** — free access granted through legitimate
   engagement (missions, gift hunt, weekly challenge, or a manual admin
   grant). Has its own audit log, `earned_premium_events`, recording who
   granted what, when, and why (including `revokeEarnedPremium()` for
   correcting mistakes).
   - `checkSubscription()` (in `modules/subscriptions`) checks **both**
     tables and returns whichever gives the longer/valid access.

**If you ever build a new "give this user premium for free" feature,
it must write to `earned_premium`, never to `subscriptions`.** Writing
free-access grants into the same table as paid purchases is exactly what
caused a critical security incident (below) — it makes fraud
indistinguishable from real revenue.

## Security lessons learned (read this before adding any "testing" shortcut)

In mid-2026, a developer-testing feature called "DevBoost" — a 7-tap logo
gesture revealing a password prompt, meant only for testing premium UI
without paying — was left in production. It had two independent bugs, both
now fixed by removal:

1. **Client-side secret**: the password was compared in the browser
   (`import.meta.env.VITE_DEV_PASSWORD`), meaning it was sitting in
   plaintext in the public JS bundle for anyone to read via devtools —
   plus a hardcoded fallback password if the env var was ever unset.
2. **Fail-open backend check**: `if (secret !== process.env.DEV_BOOST_SECRET)`
   — if that env var was ever unset on Render, `undefined !== undefined`
   evaluates `false`, meaning the check *passed* and granted free premium
   to literally anyone who called the endpoint, no password needed at all.
3. It also wrote directly into the **paid** `subscriptions` table, making
   the fraud indistinguishable from real purchases at a glance.

**Rules going forward:**
- No "testing" or "debug" auth shortcuts ship to production, ever. Test
  against real data/flows, or gate debug tools behind the *existing*
  proper admin auth (`requireAdmin` middleware, see below) — never invent
  a second, weaker auth path "just for now."
- Never compare a secret with `!==` against an env var without also
  checking the env var is actually set (`if (!process.env.X || provided !== process.env.X)`).
- A handful of older diagnostic routes (`backend/api/routes/admin.js`'s
  `/backfill-r2`, `/test-r2`, `/test-telegram-fetch`, and
  `backend/api/routes/link.js`) still use an older `?secret=` query-string
  pattern against `process.env.ADMIN_SECRET` rather than the newer
  Telegram-identity verification below. They don't touch premium/money, but
  should eventually be migrated to `requireAdmin` too, for consistency and
  to close the same class of fail-open risk.

## Admin authentication — the correct, current pattern

Real admin actions (deleting posts, managing missions/streaks/settings via
the Channel Admin panel) use **Telegram's own signed session data**, not a
typed password:

1. Frontend gets `window.Telegram.WebApp.initData` — a string Telegram
   itself cryptographically signs using your bot's token, proving which
   real Telegram account is making the request.
2. Sent as a header (`x-telegram-init-data`) on admin requests.
3. `backend/middleware/requireAdmin.js` verifies the HMAC signature using
   `BOT_TOKEN`, extracts the real Telegram user ID from it, and checks that
   ID against `ADMIN_TELEGRAM_IDS` (comma-separated list, Render env var).

This can't be faked without your actual bot token, and can't be bypassed by
reading client-side code, since the verification happens entirely
server-side against a value Telegram itself signs.

**When adding any new admin-only route, use `requireAdmin` middleware.
Never build a new secret-comparison pattern.**

## Gamification system

- **`missions`** table — admin-configurable daily tasks (title,
  `requirement_type`, `requirement_count`, `xp_reward`). Currently
  supported `requirement_type` values (must match a real event the backend
  fires — adding a new option to the admin dropdown alone does nothing
  without also wiring the trigger):
  - `watch_ad` — fired from `modules/rewardedAds`
  - `like_post` — fired from `modules/likes`
  - `bookmark_post` — fired from `modules/bookmarks`
  - `share` — fired via `POST /api/missions/share/:user_id`, called from
    `PostActions.jsx`'s share button
  - `buy_premium` — fired from `modules/payments` on real purchase only
- All of the above funnel through `modules/missions/index.js` →
  `recordMissionAction(userId, requirementType, refId)`, which dedupes by
  `(user, type, refId, day)` so repeat actions on the same thing in one day
  don't count twice, and awards XP via `modules/xp` on completion.
- **`streaks`** — daily login/activity streak, milestone rewards.
- **`levels`** — XP-based leveling, admin-configurable thresholds.
- **`giftHunt`** / **`weeklyChallenge`** — separate reward mechanics, both
  write to `earned_premium` (not `subscriptions`) when they grant premium.
  Both were reviewed and found properly gated (real user actions required,
  no obvious exploit) as of this writing.

To add a *new* mission type: (1) add the `<option>` in
`AdminPanel.jsx`'s `MissionsSection`, (2) call `recordMissionAction()` from
wherever the real action happens on the backend, (3) create the actual
mission row via the Channel Admin panel UI (or SQL insert) with a matching
`requirement_type`.

## Module map (backend)

```
backend/
├── bot.js                  Telegraf bot — channel_post, payments, /start deep links
├── index.js                Express app, mounts all routes
├── supabase.js             Supabase client
├── config/
│   ├── products.js         Premium purchase tiers (Stars pricing, days)
│   └── channels.js         Free/Premium channel ID mapping
├── middleware/
│   └── requireAdmin.js     Telegram initData verification for admin routes
├── modules/                Business logic, one folder per domain
│   ├── posts/               syncPost, getFeed, deletePostById
│   ├── subscriptions/        activateSubscription, checkSubscription (paid track)
│   ├── payments/             fulfillPayment (Stars purchase → activateSubscription)
│   ├── missions/             recordMissionAction, admin CRUD
│   ├── streaks/ levels/ xp/  gamification support
│   ├── giftHunt/ weeklyChallenge/   earned_premium sources
│   ├── likes/ bookmarks/ comments/  engagement + mission triggers
│   ├── rewardedAds/          ad-watch verification (Monetag postback)
│   ├── r2.js                 R2 upload helper
│   ├── users/                Telegram initData verification, login
│   └── notifications/ broadcast/ newUser/ link/  misc
└── api/routes/              One file per resource, thin — logic lives in modules/
```

## Module map (frontend)

```
frontend/src/
├── App.jsx                 Top-level shell, tabs, login flow
├── api.js                  All backend calls in one place
├── components/
│   ├── Feed.jsx              Free/Premium tabs, pagination, teaser-unlock feature
│   ├── PostCard.jsx           Single post render + admin delete
│   ├── PostActions.jsx        Like/Bookmark/Share buttons
│   ├── PremiumGate.jsx         Paywall shown to non-subscribers
│   ├── ProfileButton.jsx       Profile sheet, bookmarks, admin panel entry
│   ├── AdminPanel.jsx          Channel Admin — missions, streaks, settings
│   ├── ChallengesSection.jsx / ChallengeView.jsx   Gamification UI
│   ├── RewardedAdButton.jsx    Ad-watch trigger
│   └── CommentSheet.jsx / Notifications.jsx / Bookmarks*.jsx
```

## Environment variables reference

**Render (backend) — never on Vercel:**
`BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`,
`R2_PUBLIC_URL`, `FREE_CHANNEL_ID`, `PREMIUM_CHANNEL_ID`, `FRONTEND_URL`,
`ADMIN_TELEGRAM_IDS`, `ADMIN_SECRET` (legacy, only used by the 4 routes
noted above — new admin routes should use `requireAdmin` instead),
`MONETAG_POSTBACK_SECRET`, `TELEGRAM_API_ROOT` / `TELEGRAM_FILE_API_ROOT`
(optional — only if self-hosting the Telegram Bot API).

**Vercel (frontend) — no real secrets here, ever:**
`VITE_BACKEND_URL`, `VITE_BOT_USERNAME`, `VITE_ADMIN_TELEGRAM_ID` (fine to
expose — it's an ID, not a credential; actual admin actions are still
verified server-side regardless of what this says).

## Before you deploy any change

1. **Frontend and backend deploy independently** (Vercel vs Render) and
   have gotten out of sync before, causing confusing "it's fixed but
   still broken" symptoms. After pushing, verify *both* actually
   redeployed with the new commit — check each platform's dashboard, don't
   assume.
2. **New files must actually reach GitHub.** A file existing locally/in a
   zip is not the same as it being deployed — this has caused real
   confusion before (a route was "written" but never committed, so
   debugging it live went nowhere until that was caught).
3. **Long-running admin scripts will timeout** on a single request — batch
   them (see `backend/api/routes/admin.js`'s `/backfill-r2` for the
   pattern: small batch size, re-call the same URL until `remaining: 0`).
4. **Test the specific gap between "code is correct" and "code is live
   and wired to the right prop/state"** — several real bugs in this app's
   history were exactly that: correct logic that simply wasn't connected
   to what called it (missing props, stale deploys, functions that existed
   but were never invoked from the right place).
