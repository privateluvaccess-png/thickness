// Single shared Channel Admin authorization check.
//
// This formalizes the pattern already used ad-hoc in posts.js/admin.js
// (compare an `x-admin-secret` header to process.env.ADMIN_SECRET) into
// one reusable middleware, so every future admin/gamification-config
// endpoint authenticates the same way instead of duplicating the check.
//
// Intentionally NOT a new admin system: same secret, same env var,
// same trust model already in use — just centralized.
function requireAdmin(req, res, next) {
  const adminSecret = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'];

  if (!adminSecret || provided !== adminSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  next();
}

module.exports = requireAdmin;
