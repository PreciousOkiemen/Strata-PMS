const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query, tx, audit } = require('../lib/db');
const { sign, requireAuth, isAdmin } = require('../lib/auth');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });

const pub = (u) => ({ id: u.id, email: u.email, name: u.name, job_title: u.job_title, practice: u.practice,
  role: u.role, must_change_password: u.must_change_password, is_admin: isAdmin(u) });

router.post('/login', limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query('SELECT * FROM users WHERE lower(email)=$1', [email]);
    const u = rows[0];
    const ok = u && u.active && (await bcrypt.compare(password, u.password_hash));
    if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
    await tx((c) => audit(c, { actor: u.id, action: 'login' }));
    res.json({ token: sign(u), user: pub(u) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: pub(req.user) }));

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (typeof new_password !== 'string' || new_password.length < 10)
      return res.status(400).json({ error: 'New password must be at least 10 characters.' });
    const { rows } = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    if (!(await bcrypt.compare(String(current_password || ''), rows[0].password_hash)))
      return res.status(400).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(new_password, 12);
    await tx(async (c) => {
      await c.query('UPDATE users SET password_hash=$1, must_change_password=false WHERE id=$2', [hash, req.user.id]);
      await audit(c, { actor: req.user.id, action: 'password_changed' });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = router;
