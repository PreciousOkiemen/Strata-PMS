const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('./db');

const secret = () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  return process.env.JWT_SECRET;
};
const sign = (user) => jwt.sign({ sub: user.id, role: user.role }, secret(), { expiresIn: '12h' });

async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    const payload = jwt.verify(token, secret());
    const { rows } = await query(
      'SELECT id,email,name,job_title,practice,role,line_manager_id,overall_manager_id,must_change_password,active FROM users WHERE id=$1',
      [payload.sub]
    );
    const u = rows[0];
    if (!u || !u.active) return res.status(401).json({ error: 'Account is not active.' });
    req.user = u;
    next();
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expired. Sign in again.' });
    next(e);
  }
}
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role.' });

// Admins = emails listed in ADMIN_EMAILS (comma separated)
const adminEmails = () => (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const isAdmin = (u) => adminEmails().includes(String(u.email).toLowerCase());
const requireAdmin = (req, res, next) => (isAdmin(req.user) ? next() : res.status(403).json({ error: 'Only an administrator can do this.' }));

// Interoperability API: key-authenticated. EXTERNAL_API_KEYS = comma separated list of keys.
function requireApiKey(req, res, next) {
  const keys = (process.env.EXTERNAL_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean);
  const given = req.headers['x-api-key'] || '';
  const ok = keys.some((k) => {
    const a = crypto.createHash('sha256').update(k).digest();
    const b = crypto.createHash('sha256').update(String(given)).digest();
    return crypto.timingSafeEqual(a, b);
  });
  if (!keys.length || !ok) return res.status(401).json({ error: 'Invalid API key.' });
  next();
}
module.exports = { sign, requireAuth, requireRole, requireApiKey, isAdmin, requireAdmin };