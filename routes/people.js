// Admin: manage people. Admins are listed in ADMIN_EMAILS.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query, tx, audit } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { syncRoster, tempPassword } = require('../lib/roster');
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id,u.email,u.name,u.job_title,u.practice,u.role,u.active,lm.email AS line_manager_email,om.email AS overall_manager_email
       FROM users u LEFT JOIN users lm ON lm.id=u.line_manager_id LEFT JOIN users om ON om.id=u.overall_manager_id ORDER BY u.name`);
    res.json({ people: rows });
  } catch (e) { next(e); }
});

// Add one person (form) or many (CSV). Same endpoint: an existing email is updated.
router.post('/import', async (req, res, next) => {
  try {
    const people = Array.isArray(req.body.people) ? req.body.people : [];
    if (!people.length || people.length > 1000) return res.status(400).json({ error: 'Send 1 to 1000 people.' });
    const out = await syncRoster(people, { actor: req.user.id, withPasswords: true });
    res.json(out);
  } catch (e) { if (e.errors) return res.status(400).json({ error: e.message, errors: e.errors }); next(e); }
});

router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const pw = tempPassword();
    const hash = await bcrypt.hash(pw, 10);
    const r = await tx(async (c) => {
      const u = (await c.query('UPDATE users SET password_hash=$2, must_change_password=true WHERE id=$1 RETURNING email,name', [req.params.id, hash])).rows[0];
      if (u) await audit(c, { actor: req.user.id, action: 'password_reset', detail: { email: u.email } });
      return u;
    });
    if (!r) return res.status(404).json({ error: 'Person not found.' });
    res.json({ email: r.email, name: r.name, temp_password: pw });
  } catch (e) { if (e.code === '22P02') return res.status(404).json({ error: 'Person not found.' }); next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'active must be true or false.' });
    if (req.params.id === req.user.id && !req.body.active) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    const u = await tx(async (c) => {
      const row = (await c.query('UPDATE users SET active=$2 WHERE id=$1 RETURNING email', [req.params.id, req.body.active])).rows[0];
      if (row) await audit(c, { actor: req.user.id, action: req.body.active ? 'person_activated' : 'person_deactivated', detail: { email: row.email } });
      return row;
    });
    if (!u) return res.status(404).json({ error: 'Person not found.' });
    res.json({ ok: true });
  } catch (e) { if (e.code === '22P02') return res.status(404).json({ error: 'Person not found.' }); next(e); }
});
module.exports = router;