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

// Edit or delete a goal: the same roles that can create that level. Team goals can only be changed by their owner.
async function editable(req, res) {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ error: 'Goal not found.' }); return null; }
  const { rows } = await query('SELECT * FROM parent_goals WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) { res.status(404).json({ error: 'Goal not found.' }); return null; }
  if (!WHO[g.level].includes(req.user.role) || (g.level === 'team' && g.owner_id !== req.user.id)) {
    res.status(403).json({ error: 'Your role cannot change this goal.' }); return null;
  }
  return g;
}
router.put('/:id', async (req, res, next) => {
  try {
    const g = await editable(req, res); if (!g) return;
    const b = req.body;
    const title = String(b.title || '').trim().slice(0, 400);
    if (!title) return res.status(400).json({ error: 'Add the goal.' });
    let parent = b.parent_id === undefined ? g.parent_id : (b.parent_id || null);
    if (parent) {
      const p = await query('SELECT level FROM parent_goals WHERE id=$1', [parent]);
      const want = { practice: 'company', team: 'practice' }[g.level];
      if (!p.rows[0] || p.rows[0].level !== want) return res.status(400).json({ error: `A ${g.level} goal must link to a ${want} goal.` });
    }
    const practice = g.level === 'practice' ? String(b.practice || g.practice || '').trim().slice(0, 120) : g.practice;
    if (g.level === 'practice' && !practice) return res.status(400).json({ error: 'Choose the practice.' });
    await tx(async (c) => {
      await c.query('UPDATE parent_goals SET title=$1, measure=$2, target=$3, practice=$4, parent_id=$5 WHERE id=$6',
        [title, String(b.measure ?? g.measure ?? '').slice(0, 300) || null, String(b.target ?? g.target ?? '').slice(0, 200) || null, practice, parent, g.id]);
      await audit(c, { actor: req.user.id, action: 'goal_updated', detail: { level: g.level, title, was: g.title } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const g = await editable(req, res); if (!g) return;
    await tx(async (c) => {
      // goals linked below it stay, but become unlinked (nothing else is deleted)
      await c.query('UPDATE parent_goals SET parent_id=NULL WHERE parent_id=$1', [g.id]);
      await c.query('DELETE FROM parent_goals WHERE id=$1', [g.id]);
      await audit(c, { actor: req.user.id, action: 'goal_deleted', detail: { level: g.level, title: g.title } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = router;