const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query, tx, audit } = require('../lib/db');
const { sign, requireAuth, isAdmin } = require('../lib/auth');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });

const pub = async (u) => {
  const { rows } = await query(
    `SELECT lm.name AS line_manager, om.name AS overall_manager FROM users x
     LEFT JOIN users lm ON lm.id = x.line_manager_id LEFT JOIN users om ON om.id = x.overall_manager_id WHERE x.id=$1`, [u.id]);
  return { id: u.id, email: u.email, name: u.name, job_title: u.job_title, practice: u.practice,
    role: u.role, must_change_password: u.must_change_password, is_admin: isAdmin(u),
    line_manager_id: u.line_manager_id, line_manager: rows[0]?.line_manager || null, overall_manager: rows[0]?.overall_manager || null };
};

router.post('/login', limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const { rows } = await query('SELECT * FROM users WHERE lower(email)=$1', [email]);
    const u = rows[0];
    const ok = u && u.active && u.password_hash && (await bcrypt.compare(password, u.password_hash));
    if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
    await tx((c) => audit(c, { actor: u.id, action: 'login' }));
    res.json({ token: sign(u), user: await pub(u) });
  } catch (e) { next(e); }
});

router.post('/register', limiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email) return res.status(400).json({ error: 'Enter your work email.' });
    if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });

    const { rows } = await query('SELECT * FROM users WHERE lower(email)=$1', [email]);
    const u = rows[0];
    if (!u || !u.active)
      return res.status(404).json({ error: 'We could not find that email. Ask the Chief of Staff to add you first.' });
    if (u.password_hash)
      return res.status(409).json({ error: 'This account already exists. Use the Sign in tab.' });

    const hash = await bcrypt.hash(password, 12);
    const done = await tx(async (c) => {
      // password_hash IS NULL in the WHERE makes sure two people cannot register the same account at once
      const r = await c.query(
        'UPDATE users SET password_hash=$1, must_change_password=false WHERE id=$2 AND password_hash IS NULL RETURNING *',
        [hash, u.id]);
      if (!r.rows[0]) return null;
      await audit(c, { actor: u.id, action: 'account_registered' });
      return r.rows[0];
    });
    if (!done) return res.status(409).json({ error: 'This account already exists. Use the Sign in tab.' });
    res.json({ token: sign(done), user: await pub(done) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => { try { res.json({ user: await pub(req.user) }); } catch (e) { next(e); } });

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