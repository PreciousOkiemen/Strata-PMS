const router = require('express').Router();
const { query, tx, audit } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const fy = Number(req.query.fy) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT g.id,g.level,g.practice,g.parent_id,g.title,g.measure,g.target,g.fy,g.owner_id,u.name AS owner
       FROM parent_goals g LEFT JOIN users u ON u.id=g.owner_id WHERE g.fy=$1 ORDER BY g.level, g.created_at`, [fy]);
    res.json({ goals: rows });
  } catch (e) { next(e); }
});

// company: CEO. practice: Overall manager or Chief of Staff. team: Line manager.
const WHO = { company: ['ceo'], practice: ['overall_manager', 'cos'], team: ['line_manager'] };
router.post('/', async (req, res, next) => {
  try {
    const b = req.body, level = b.level;
    if (!WHO[level]) return res.status(400).json({ error: 'Unknown goal level.' });
    if (!WHO[level].includes(req.user.role)) return res.status(403).json({ error: 'Your role cannot set this level of goal.' });
    const title = String(b.title || '').trim().slice(0, 400);
    if (!title) return res.status(400).json({ error: 'Add the goal.' });
    const fy = Number(b.fy) || new Date().getFullYear();
    let practice = null, parent = b.parent_id || null;
    if (level === 'practice') { practice = String(b.practice || '').trim().slice(0, 120); if (!practice) return res.status(400).json({ error: 'Choose the practice.' }); }
    if (level === 'team') practice = req.user.practice;
    if (parent) {
      const p = await query('SELECT level FROM parent_goals WHERE id=$1', [parent]);
      const want = { practice: 'company', team: 'practice' }[level];
      if (!p.rows[0] || (want && p.rows[0].level !== want)) return res.status(400).json({ error: `A ${level} goal must link to a ${want} goal.` });
    }
    const id = await tx(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO parent_goals (level,practice,owner_id,parent_id,title,measure,target,fy,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3) RETURNING id',
        [level, practice, req.user.id, parent, title, String(b.measure || '').slice(0, 300) || null, String(b.target || '').slice(0, 200) || null, fy]);
      await audit(c, { actor: req.user.id, action: 'goal_created', detail: { level, title, practice } });
      return rows[0].id;
    });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});
module.exports = router;
