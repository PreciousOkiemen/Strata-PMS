const router = require('express').Router();
const { query, tx, audit } = require('../lib/db');
const { requireAuth, requireRole } = require('../lib/auth');
const { ratingFor, weightErrors, total, missingScores, BANDS } = require('../lib/scoring');
const { ORDER, FLOW, stepFor } = require('../lib/workflow');

router.use(requireAuth);

const BASE = `
  SELECT s.*, e.name AS employee_name, e.email AS employee_email, e.job_title, e.practice,
         e.line_manager_id, e.overall_manager_id, e.role AS employee_role,
         lm.name AS line_manager_name, om.name AS overall_manager_name
  FROM scorecards s
  JOIN users e ON e.id = s.employee_id
  LEFT JOIN users lm ON lm.id = e.line_manager_id
  LEFT JOIN users om ON om.id = e.overall_manager_id`;

// Who can see a scorecard: owner, their line/overall manager, and the review roles (never drafts).
function canView(sc, u) {
  if (sc.employee_id === u.id) return true;
  if (sc.status === 'draft') return false;
  return sc.line_manager_id === u.id || sc.overall_manager_id === u.id ||
    ['calibration', 'cos', 'ceo'].includes(u.role);
}
const shape = (sc, u) => {
  const step = stepFor(sc.status);
  return {
    id: sc.id, fy: sc.fy, quarter: sc.quarter, status: sc.status,
    employee: { id: sc.employee_id, name: sc.employee_name, email: sc.employee_email, job_title: sc.job_title,
      practice: sc.practice, line_manager: sc.line_manager_name, overall_manager: sc.overall_manager_name },
    proof_of_work_url: sc.proof_of_work_url, evidence_links: sc.evidence_links,
    self_total: sc.self_total, manager_total: sc.manager_total,
    rating: ratingFor(sc.manager_total), final_rating: sc.final_rating,
    submitted_at: sc.submitted_at, updated_at: sc.updated_at,
    waiting_on: step ? step.label : null,
    my_action: !!(step && step.canAct(sc, u) && sc.employee_id !== u.id),
  };
};
async function load(id, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(BASE + ' WHERE s.id=$1', [id]);
  return rows[0];
}
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));

router.get('/config', async (req, res, next) => {
  try {
    const { rows } = await query("SELECT name, role FROM users WHERE active AND role IN ('calibration','cos','ceo') ORDER BY name");
    const roles = {};
    for (const r of rows) roles[r.role] = roles[r.role] ? roles[r.role] + ', ' + r.name : r.name;
    res.json({ bands: BANDS, flow: FLOW.map((f) => ({ from: f.from, to: f.to, stage: f.stage, label: f.label })), order: ORDER, roles });
  } catch (e) { next(e); }
});

// List: ?fy=&quarter=
router.get('/', async (req, res, next) => {
  try {
    const u = req.user;
    const fy = Number(req.query.fy) || new Date().getFullYear();
    const q = req.query.quarter || null;
    const { rows } = await query(
      BASE + ` WHERE s.fy=$1 AND ($2::text IS NULL OR s.quarter=$2)
        AND (s.employee_id=$3
          OR (s.status<>'draft' AND (e.line_manager_id=$3 OR e.overall_manager_id=$3
              OR $4 IN ('calibration','cos','ceo'))))
      ORDER BY s.updated_at DESC`, [fy, q, u.id, u.role]);
    // my most recent decision on each scorecard: drives "Approved by you" and "Sent for revision"
    const last = await query(
      `SELECT DISTINCT ON (g.scorecard_id) g.scorecard_id, g.decision FROM signatures g
       JOIN scorecards s ON s.id=g.scorecard_id WHERE g.signer_id=$1 AND s.fy=$2
       ORDER BY g.scorecard_id, g.signed_at DESC`, [u.id, fy]);
    const mine = new Map(last.rows.map((r) => [r.scorecard_id, r.decision]));
    res.json({ scorecards: rows.map((r) => ({ ...shape(r, u), approved_by_me: mine.get(r.id) === 'approved', returned_by_me: mine.get(r.id) === 'returned' })) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const sc = await load(req.params.id);
    if (!sc || !canView(sc, req.user)) return res.status(404).json({ error: 'Not found.' });
    const [kpis, comments, audits, sigs] = await Promise.all([
      query('SELECT id,position,parent_position,sub_category,category,category_weight,kpi,weight_in_category,self_score,manager_score FROM kpis WHERE scorecard_id=$1 ORDER BY position', [sc.id]),
      query(`SELECT c.id,c.parent_id,c.body,c.created_at,u.name AS author,u.role AS author_role
             FROM evaluation_comments c JOIN users u ON u.id=c.author_id WHERE scorecard_id=$1 ORDER BY c.created_at`, [sc.id]),
      query(`SELECT a.id,a.action,a.detail,a.created_at,COALESCE(u.name,a.actor_label,'System') AS actor
             FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.scorecard_id=$1 ORDER BY a.created_at DESC, a.id DESC`, [sc.id]),
      query(`SELECT s.stage,s.decision,s.signed_at,u.name AS signer FROM signatures s JOIN users u ON u.id=s.signer_id
             WHERE scorecard_id=$1 ORDER BY signed_at`, [sc.id]),
    ]);
    res.json({ scorecard: shape(sc, req.user), kpis: kpis.rows, comments: comments.rows, audit: audits.rows, signatures: sigs.rows });
  } catch (e) { next(e); }
});

// Create my scorecard for a quarter (employee roles only; calibration & CEO do not have one)
router.post('/', requireRole('employee', 'line_manager', 'overall_manager', 'cos'), async (req, res, next) => {
  try {
    const fy = Number(req.body.fy), quarter = req.body.quarter;
    if (!fy || !['Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) return res.status(400).json({ error: 'Choose a year and quarter.' });
    const out = await tx(async (c) => {
      const ex = await c.query('SELECT id FROM scorecards WHERE employee_id=$1 AND fy=$2 AND quarter=$3', [req.user.id, fy, quarter]);
      if (ex.rows[0]) return { id: ex.rows[0].id, existing: true };
      const { rows } = await c.query('INSERT INTO scorecards (employee_id,fy,quarter) VALUES ($1,$2,$3) RETURNING id', [req.user.id, fy, quarter]);
      const template = [
        ['Core role delivery', 50, 'Milestone delivery', 40], ['Core role delivery', 50, 'Scope integrity', 30],
        ['Core role delivery', 50, 'Outcome achievement', 30], ['Strategic / cross-functional', 20, 'Client stakeholder satisfaction', 100],
        ['People, culture & values', 15, 'Collaboration & values', 100], ['Capability & development', 15, 'Capability development', 100]];
      for (let i = 0; i < template.length; i++)
        await c.query('INSERT INTO kpis (scorecard_id,position,category,category_weight,kpi,weight_in_category) VALUES ($1,$2,$3,$4,$5,$6)',
          [rows[0].id, i, ...template[i]]);
      await audit(c, { scorecardId: rows[0].id, actor: req.user.id, action: 'scorecard_created', detail: { fy, quarter } });
      return { id: rows[0].id };
    });
    res.status(201).json(out);
  } catch (e) { next(e); }
});

const cleanKpi = (k) => ({
  parent_position: k.parent_position === '' || k.parent_position == null ? null : Number(k.parent_position),
  sub_category: String(k.sub_category || '').trim().slice(0, 120) || null,
  category: String(k.category || '').trim().slice(0, 120), category_weight: Number(k.category_weight),
  kpi: String(k.kpi || '').trim().slice(0, 300), weight_in_category: Number(k.weight_in_category),
  self_score: k.self_score === '' || k.self_score == null ? null : Number(k.self_score),
});
// Sub-KPIs inherit the category and weight of the main KPI above them, and a main KPI with sub-KPIs gets its score from them.
function linkSubKpis(kpis) {
  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i];
    k.position = i;
    if (k.parent_position == null) continue;
    const p = kpis[k.parent_position];
    if (!Number.isInteger(k.parent_position) || k.parent_position < 0 || k.parent_position >= i || !p || p.parent_position != null) return false;
    k.category = p.category; k.category_weight = p.category_weight;
  }
  for (const k of kpis) if (k.parent_position != null) kpis[k.parent_position].self_score = null;
  return true;
}
const validKpi = (k) => k.category && k.kpi && Number.isFinite(k.category_weight) && Number.isFinite(k.weight_in_category) &&
  k.category_weight >= 0 && k.category_weight <= 100 && k.weight_in_category >= 0 && k.weight_in_category <= 100 &&
  (k.self_score === null || (Number.isInteger(k.self_score) && k.self_score >= 1 && k.self_score <= 5));

// Employee edits their draft (or returned) scorecard
router.put('/:id/self', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const kpis = (Array.isArray(req.body.kpis) ? req.body.kpis : []).map(cleanKpi);
    if (!linkSubKpis(kpis)) return res.status(400).json({ error: 'A sub-KPI must sit directly under a main KPI.' });
    if (kpis.length > 60 || !kpis.every(validKpi)) return res.status(400).json({ error: 'Check KPI names, weights (0 to 100) and scores (1 to 5).' });
    const url = req.body.proof_of_work_url ? String(req.body.proof_of_work_url).trim().slice(0, 500) : null;
    if (url && !/^https:\/\//i.test(url)) return res.status(400).json({ error: 'Proof of work must be a link starting with https://' });
    await tx(async (c) => {
      const sc = await load(req.params.id, c);
      if (!sc || sc.employee_id !== req.user.id) throw Object.assign(new Error('Not found.'), { status: 404 });
      if (sc.status !== 'draft') throw Object.assign(new Error('This scorecard is already submitted.'), { status: 409 });
      await c.query('DELETE FROM kpis WHERE scorecard_id=$1', [sc.id]);
      for (let i = 0; i < kpis.length; i++) {
        const k = kpis[i];
        await c.query('INSERT INTO kpis (scorecard_id,position,parent_position,sub_category,category,category_weight,kpi,weight_in_category,self_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [sc.id, i, k.parent_position, k.sub_category, k.category, k.category_weight, k.kpi, k.weight_in_category, k.self_score]);
      }
      await c.query('UPDATE scorecards SET proof_of_work_url=$1, self_total=$2, updated_at=now() WHERE id=$3', [url, total(kpis, 'self_score'), sc.id]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'draft_saved' });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/submit', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    await tx(async (c) => {
      const sc = await load(req.params.id, c);
      if (!sc || sc.employee_id !== req.user.id) throw Object.assign(new Error('Not found.'), { status: 404 });
      if (sc.status !== 'draft') throw Object.assign(new Error('Already submitted.'), { status: 409 });
      const { rows: kpis } = await c.query('SELECT * FROM kpis WHERE scorecard_id=$1 ORDER BY position', [sc.id]);
      const errs = weightErrors(kpis);
      if (missingScores(kpis, 'self_score')) errs.push('Give every KPI a self score from 1 to 5.');
      if (!sc.proof_of_work_url) errs.push('Add your proof of work link.');
      if (!sc.line_manager_id) errs.push('No line manager is assigned to you yet. Ask HR to update the roster.');
      if (errs.length) throw Object.assign(new Error(errs.join(' ')), { status: 422 });
      await c.query("UPDATE scorecards SET status='submitted', submitted_at=now(), self_total=$2, updated_at=now() WHERE id=$1", [sc.id, total(kpis, 'self_score')]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'submitted', detail: { self_total: total(kpis, 'self_score') } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Line manager saves manager scores while status = submitted
router.put('/:id/manager-scores', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const scores = Array.isArray(req.body.scores) ? req.body.scores : [];
    await tx(async (c) => {
      const sc = await load(req.params.id, c);
      if (!sc || !canView(sc, req.user)) throw Object.assign(new Error('Not found.'), { status: 404 });
      if (sc.status !== 'submitted' || sc.line_manager_id !== req.user.id)
        throw Object.assign(new Error('Only the line manager can score a submitted scorecard.'), { status: 403 });
      for (const s of scores) {
        const v = s.manager_score === '' || s.manager_score == null ? null : Number(s.manager_score);
        if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 5)) throw Object.assign(new Error('Scores must be whole numbers from 1 to 5.'), { status: 400 });
        if (!isUuid(s.id)) throw Object.assign(new Error('Bad KPI id.'), { status: 400 });
        await c.query('UPDATE kpis SET manager_score=$1 WHERE id=$2 AND scorecard_id=$3', [v, s.id, sc.id]);
      }
      await c.query('UPDATE scorecards SET updated_at=now() WHERE id=$1', [sc.id]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'manager_scores_saved' });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Approve at the current stage (for 'submitted' this finalises the line manager score)
router.post('/:id/approve', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const out = await tx(async (c) => {
      const sc = await load(req.params.id, c);
      if (!sc || !canView(sc, req.user)) throw Object.assign(new Error('Not found.'), { status: 404 });
      const step = stepFor(sc.status);
      if (!step) throw Object.assign(new Error('Nothing to approve at this stage.'), { status: 409 });
      if (sc.employee_id === req.user.id || !step.canAct(sc, req.user))
        throw Object.assign(new Error('This step is not yours to approve.'), { status: 403 });
      const { rows: kpis } = await c.query('SELECT * FROM kpis WHERE scorecard_id=$1 ORDER BY position', [sc.id]);
      let managerTotal = sc.manager_total;
      if (step.stage === 'line') {
        if (missingScores(kpis, 'manager_score')) throw Object.assign(new Error('Score every KPI before sending on.'), { status: 422 });
        managerTotal = total(kpis, 'manager_score');
      }
      const finalRating = step.stage === 'ceo' ? ratingFor(managerTotal) : sc.final_rating;
      await c.query('UPDATE scorecards SET status=$1, manager_total=$2, final_rating=$3, updated_at=now() WHERE id=$4',
        [step.to, managerTotal, finalRating, sc.id]);
      await c.query("INSERT INTO signatures (scorecard_id,stage,signer_id,decision) VALUES ($1,$2,$3,'approved')", [sc.id, step.stage, req.user.id]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'approved', detail: { stage: step.stage, label: step.label, manager_total: managerTotal } });
      return { status: step.to, manager_total: managerTotal };
    });
    res.json(out);
  } catch (e) { next(e); }
});

// Return one step back with a reason
router.post('/:id/return', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const reason = String(req.body.reason || '').trim().slice(0, 1000);
    if (!reason) return res.status(400).json({ error: 'Say why you are returning it.' });
    await tx(async (c) => {
      const sc = await load(req.params.id, c);
      if (!sc || !canView(sc, req.user)) throw Object.assign(new Error('Not found.'), { status: 404 });
      const step = stepFor(sc.status);
      if (!step || sc.employee_id === req.user.id || !step.canAct(sc, req.user))
        throw Object.assign(new Error('This step is not yours.'), { status: 403 });
      const prev = ORDER[ORDER.indexOf(sc.status) - 1];
      await c.query('UPDATE scorecards SET status=$1, updated_at=now() WHERE id=$2', [prev, sc.id]);
      if (prev === 'draft') await c.query('UPDATE kpis SET manager_score=NULL WHERE scorecard_id=$1', [sc.id]);
      await c.query("INSERT INTO signatures (scorecard_id,stage,signer_id,decision) VALUES ($1,$2,$3,'returned')", [sc.id, step.stage, req.user.id]);
      await c.query('INSERT INTO evaluation_comments (scorecard_id,author_id,body) VALUES ($1,$2,$3)', [sc.id, req.user.id, `Returned: ${reason}`]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'returned', detail: { stage: step.stage, to: prev, reason } });
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/comments', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Write a comment first.' });
    const sc = await load(req.params.id);
    if (!sc || !canView(sc, req.user)) return res.status(404).json({ error: 'Not found.' });
    const parent = req.body.parent_id && isUuid(req.body.parent_id) ? req.body.parent_id : null;
    await tx(async (c) => {
      await c.query('INSERT INTO evaluation_comments (scorecard_id,author_id,parent_id,body) VALUES ($1,$2,$3,$4)', [sc.id, req.user.id, parent, body]);
      await audit(c, { scorecardId: sc.id, actor: req.user.id, action: 'commented' });
    });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
module.exports = router;