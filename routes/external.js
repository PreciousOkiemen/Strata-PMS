// Interoperability API: /api/v3/external/*  (header: x-api-key)
const router = require('express').Router();
const { query, tx, audit } = require('../lib/db');
const { requireApiKey } = require('../lib/auth');
const { stepFor } = require('../lib/workflow');
router.use(requireApiKey);

const { syncRoster } = require('../lib/roster');

// HRIS roster sync. New people get a random password they must reset (use npm run set-password).
router.post('/roster/sync', async (req, res, next) => {
  try {
    const users = Array.isArray(req.body.users) ? req.body.users : [];
    if (!users.length || users.length > 1000) return res.status(400).json({ error: 'Send 1 to 1000 users.' });
    const { created, updated } = await syncRoster(users, { label: 'HRIS' });
    res.json({ created, updated });
  } catch (e) { if (e.errors) return res.status(400).json({ error: e.message, errors: e.errors }); next(e); }
});

// Notion / LMS evidence attached to an employee's scorecard
router.post('/evidence', async (req, res, next) => {
  try {
    const { employee_email, fy, quarter, url, title, source } = req.body;
    if (!/^https:\/\//i.test(String(url || ''))) return res.status(400).json({ error: 'url must start with https://' });
    const { rows } = await query(
      'SELECT s.id FROM scorecards s JOIN users u ON u.id=s.employee_id WHERE lower(u.email)=$1 AND s.fy=$2 AND s.quarter=$3',
      [String(employee_email || '').toLowerCase(), Number(fy), quarter]);
    if (!rows[0]) return res.status(404).json({ error: 'No scorecard for that person and quarter.' });
    const item = { url, title: String(title || '').slice(0, 200), source: String(source || 'external').slice(0, 40), at: new Date().toISOString() };
    await tx(async (c) => {
      await c.query("UPDATE scorecards SET evidence_links = evidence_links || $2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify([item])]);
      await audit(c, { scorecardId: rows[0].id, label: item.source, action: 'evidence_added', detail: item });
    });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// PowerBI / ERP: final, CEO-approved scores only
router.get('/scores', async (req, res, next) => {
  try {
    const fy = Number(req.query.fy) || new Date().getFullYear();
    const { rows } = await query(
      `SELECT u.email,u.name,u.job_title,u.practice,s.fy,s.quarter,s.self_total,s.manager_total,s.final_rating,s.updated_at
       FROM scorecards s JOIN users u ON u.id=s.employee_id
       WHERE s.status='ceo_approved' AND s.fy=$1 AND ($2::text IS NULL OR s.quarter=$2) ORDER BY u.name`, [fy, req.query.quarter || null]);
    res.json({ scores: rows });
  } catch (e) { next(e); }
});

// Slack / bots: who needs to act now
router.get('/pending-actions', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id,s.status,s.fy,s.quarter,u.name AS employee,u.email AS employee_email,
              lm.email AS line_manager_email, om.email AS overall_manager_email
       FROM scorecards s JOIN users u ON u.id=s.employee_id
       LEFT JOIN users lm ON lm.id=u.line_manager_id LEFT JOIN users om ON om.id=u.overall_manager_id
       WHERE s.status NOT IN ('draft','ceo_approved') ORDER BY s.updated_at`);
    const roleFor = { submitted: 'line manager', line_scored: 'overall manager', om_approved: 'calibration', calibrated: 'cos', cos_approved: 'ceo' };
    res.json({ pending: rows.map((r) => ({ ...r, waiting_on: stepFor(r.status).label, approver_role: roleFor[r.status],
      approver_email: r.status === 'submitted' ? r.line_manager_email : r.status === 'line_scored' ? r.overall_manager_email : null })) });
  } catch (e) { next(e); }
});
module.exports = router;