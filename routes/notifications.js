const router = require('express').Router();
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');

router.use(requireAuth);

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));

// My latest notifications and how many are unread
router.get('/', async (req, res, next) => {
  try {
    const [list, unread] = await Promise.all([
      query(`SELECT n.id,n.type,n.title,n.body,n.scorecard_id,n.read_at,n.created_at,s.employee_id,s.fy,s.quarter
        FROM notifications n LEFT JOIN scorecards s ON s.id=n.scorecard_id
        WHERE n.user_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [req.user.id]),
      query('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.user.id]),
    ]);
    res.json({ notifications: list.rows, unread: unread.rows[0].n });
  } catch (e) { next(e); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;