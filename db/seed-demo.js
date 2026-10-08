// Demo data: made-up people with scorecards at every stage, scores, approvals, audit trail, comments and goals,
// so the dashboards look like the design. Everything is tagged so it can be removed cleanly.
//   node db/seed-demo.js            add (or rebuild) the demo data
//   node db/seed-demo.js --remove   delete ALL demo data (run this before real use)
// Demo people have emails ending @demo.strata.ng. Demo goals have the measure "DEMO-DATA".
const crypto = require('crypto'), bcrypt = require('bcryptjs');
const { getPool } = require('../lib/db');
const { total, ratingFor } = require('../lib/scoring');
const { ORDER, FLOW } = require('../lib/workflow');

const DOMAIN = '@demo.strata.ng', MARK = 'DEMO-DATA';
const REMOVE = process.argv.includes('--remove');

async function remove(c) {
  const demo = "SELECT id FROM users WHERE email LIKE '%" + DOMAIN + "'";
  await c.query("DELETE FROM parent_goals WHERE measure=$1", [MARK]);
  await c.query(`DELETE FROM scorecards WHERE employee_id IN (${demo})`); // kpis, signatures, comments, audit follow
  await c.query(`DELETE FROM audit_logs WHERE actor_id IN (${demo})`);
  await c.query(`UPDATE users SET line_manager_id=NULL, overall_manager_id=NULL WHERE email LIKE '%${DOMAIN}'`);
  const r = await c.query(`DELETE FROM users WHERE email LIKE '%${DOMAIN}'`);
  return r.rowCount;
}

// deterministic "random" so the demo looks the same every time
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// main KPIs; the first has two sub-KPIs. [category, categoryWeight, kpi, weightInCategory, subs?]
const KPIS = [
  ['Core role delivery', 50, 'Milestone delivery', 40, [['Delivery', 'Sprint predictability', 60], ['Quality', 'Release quality', 40]]],
  ['Core role delivery', 50, 'Scope integrity', 30],
  ['Core role delivery', 50, 'Outcome achievement', 30],
  ['Strategic / cross-functional', 20, 'Client stakeholder satisfaction', 100],
  ['People, culture & values', 15, 'Collaboration & values', 100],
  ['Capability & development', 15, 'Capability development', 100],
];
function buildKpis(rand, bias) {
  const rows = [];
  for (const [category, category_weight, kpi, wic, subs] of KPIS) {
    const base = rows.length;
    rows.push({ position: base, parent_position: null, sub_category: null, category, category_weight, kpi, weight_in_category: wic });
    for (const [sc, name, w] of subs || [])
      rows.push({ position: rows.length, parent_position: base, sub_category: sc, category, category_weight, kpi: name, weight_in_category: w });
  }
  const hasKids = new Set(rows.filter((r) => r.parent_position != null).map((r) => r.parent_position));
  for (const r of rows) {
    if (hasKids.has(r.position)) { r.self_score = null; r.manager_score = null; continue; }
    const self = Math.max(1, Math.min(5, Math.round(3.4 + bias + (rand() - 0.5) * 2)));
    r.self_score = self;
    r.manager_score = Math.max(1, Math.min(5, self + (rand() < 0.35 ? -1 : 0)));
  }
  return rows;
}

// [name, title, practice, line manager key, status, bias, note]
const EMP = [
  ['Adaeze Okonkwo', 'Product Analyst', 'Product', 'real', 'ceo_approved', 0.6],
  ['Tunde Bakare', 'Backend Engineer', 'Product', 'real', 'ceo_approved', 0.2],
  ['Ngozi Eze', 'Data Analyst', 'Product', 'real', 'cos_approved', 0.5],
  ['Ibrahim Musa', 'QA Engineer', 'Product', 'real', 'calibrated', 0.0],
  ['Funke Adeyemi', 'UX Designer', 'Product', 'real', 'om_approved', 0.3],
  ['Chinedu Obi', 'Frontend Engineer', 'Product', 'real', 'line_scored', 0.1],
  ['Kemi Balogun', 'Product Manager', 'Product', 'real', 'submitted', -0.2, 'returned'],
  ['Femi Coker', 'Support Engineer', 'Product', 'real', 'draft', 0],
  ['Segun Alabi', 'Delivery Lead', 'Advisory', 'chioma', 'calibrated', 0.4],
  ['Zainab Lawal', 'Consultant', 'Advisory', 'chioma', 'om_approved', -0.3],
  ['Uche Nnamdi', 'Consultant', 'Advisory', 'chioma', 'line_scored', 0.2],
  ['Bola Ige', 'Analyst', 'Advisory', 'emeka', 'submitted', 0.0],
  ['Hauwa Garba', 'Associate', 'Advisory', 'emeka', 'cos_approved', 0.7],
];

async function seed(c) {
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const ceo = await one("SELECT id FROM users WHERE role='ceo' AND active AND email NOT LIKE $1 ORDER BY created_at LIMIT 1", ['%' + DOMAIN]);
  const cos = await one("SELECT id FROM users WHERE role='cos' AND active AND email NOT LIKE $1 ORDER BY created_at LIMIT 1", ['%' + DOMAIN]);
  const cal = await one("SELECT id FROM users WHERE role='calibration' AND active AND email NOT LIKE $1 ORDER BY created_at LIMIT 1", ['%' + DOMAIN]);
  const om = await one("SELECT id,name,practice FROM users WHERE role='overall_manager' AND active AND email NOT LIKE $1 ORDER BY created_at LIMIT 1", ['%' + DOMAIN]);
  const lm = await one("SELECT id,name FROM users WHERE role='line_manager' AND active AND email NOT LIKE $1 ORDER BY created_at LIMIT 1", ['%' + DOMAIN]);
  if (!ceo || !cos || !cal || !om || !lm) throw new Error('The demo needs one CEO, Chief of Staff, calibration, overall manager and line manager already in the People list.');

  const pwHash = await bcrypt.hash(crypto.randomBytes(18).toString('base64url'), 10);
  const mk = async (email, name, title, practice, role, lmId, omId) =>
    (await one(`INSERT INTO users (email,name,job_title,practice,role,line_manager_id,overall_manager_id,password_hash,must_change_password)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`, [email + DOMAIN, name, title, practice, role, lmId, omId, pwHash])).id;
  const lms = { real: lm.id,
    chioma: await mk('chioma.eze', 'Chioma Eze', 'Team Lead', 'Advisory', 'line_manager', null, om.id),
    emeka: await mk('emeka.nwosu', 'Emeka Nwosu', 'Team Lead', 'Advisory', 'line_manager', null, om.id) };
  const lmName = { real: lm.name, chioma: 'Chioma Eze', emeka: 'Emeka Nwosu' };

  // goals (company -> practice -> team), shown in every employee's goal alignment
  const fy = new Date().getFullYear(), quarter = 'Q' + (Math.floor(new Date().getMonth() / 3) + 1);
  const goal = async (level, practice, parent, owner, title, target) =>
    (await one(`INSERT INTO parent_goals (level,practice,parent_id,owner_id,title,measure,target,fy,created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4) RETURNING id`, [level, practice, parent, owner, title, MARK, target || null, fy])).id;
  // reuse real goals when they exist so nothing is duplicated; only add what is missing
  const realGoal = async (level, practice) => (await one(
    "SELECT id FROM parent_goals WHERE level=$1 AND fy=$2 AND COALESCE(measure,'')<>$3 AND ($4::text IS NULL OR lower(practice)=lower($4)) ORDER BY created_at LIMIT 1", [level, fy, MARK, practice]))?.id;
  const gC1 = (await realGoal('company', null)) || await goal('company', null, null, ceo.id, 'Grow Strata revenue 40% in FY' + String(fy).slice(2), '+40%');
  const gPp = (await realGoal('practice', 'Product')) || await goal('practice', 'Product', gC1, om.id, 'Product & AI: 95% on-time delivery and measured outcomes across all client engagements');
  const gPa = await goal('practice', 'Advisory', gC1, om.id, 'Advisory: win and retain three anchor clients with measurable results');
  await goal('team', 'Product', gPp, lm.id, 'AI Transformation: every engagement ships live use cases with proven value');
  await goal('team', 'Advisory', gPa, lms.chioma, 'Discovery sprints completed within 3 weeks for every new client');
  await goal('team', 'Advisory', gPa, lms.emeka, 'Client success reviews held monthly for every active account');

  const stageActor = (e) => ({ line: e.lmId, om: om.id, cal: cal.id, cos: cos.id, ceo: ceo.id });
  const at = (daysAgo, h = 10) => new Date(Date.now() - daysAgo * 86400000 + h * 3600000);
  let n = 0;
  for (const [i, [name, title, practice, lmKey, status, bias, note]] of EMP.entries()) {
    const rand = rng(1000 + i * 17);
    const first = name.split(' ')[0].toLowerCase();
    const uid = await mk(first, name, title, practice, 'employee', lms[lmKey], om.id);
    const e = { lmId: lms[lmKey] }, actors = stageActor(e);
    const kpis = buildKpis(rand, bias);
    const idx = ORDER.indexOf(status);
    const submitted = idx >= 1, scored = idx >= 2 || note === 'returned';
    const selfT = submitted ? total(kpis, 'self_score') : null;
    const mgrT = scored ? total(kpis, 'manager_score') : null;
    const sc = await one(`INSERT INTO scorecards (employee_id,fy,quarter,status,proof_of_work_url,self_total,manager_total,final_rating,submitted_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [uid, fy, quarter, status, 'https://www.notion.so/strata/' + first + '-proof-of-work', selfT, mgrT,
       status === 'ceo_approved' ? ratingFor(mgrT) : null, submitted ? at(30) : null, at(40), at(Math.max(1, 28 - idx * 4))]);
    for (const k of kpis)
      await c.query(`INSERT INTO kpis (scorecard_id,position,parent_position,sub_category,category,category_weight,kpi,weight_in_category,self_score,manager_score)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [sc.id, k.position, k.parent_position, k.sub_category, k.category, k.category_weight, k.kpi, k.weight_in_category, k.self_score, scored ? k.manager_score : null]);
    const log = (actor, action, detail, when) => c.query('INSERT INTO audit_logs (scorecard_id,actor_id,action,detail,created_at) VALUES ($1,$2,$3,$4,$5)', [sc.id, actor, action, JSON.stringify(detail || {}), when]);
    await log(uid, 'scorecard_created', { fy, quarter }, at(40));
    await log(uid, 'draft_saved', {}, at(35));
    if (submitted) await log(uid, 'submitted', { self_total: selfT }, at(30));
    let day = 27;
    for (const f of FLOW) {
      if (ORDER.indexOf(f.to) > idx) break;
      const actor = actors[f.stage], when = at(day);
      if (f.stage === 'line') await log(actor, 'manager_scores_saved', {}, at(day + 0.1));
      await c.query("INSERT INTO signatures (scorecard_id,stage,signer_id,decision,signed_at) VALUES ($1,$2,$3,'approved',$4)", [sc.id, f.stage, actor, when]);
      await log(actor, 'approved', { stage: f.stage, label: f.label, manager_total: mgrT }, when);
      day -= 4;
    }
    if (note === 'returned') { // line manager scored it, then the overall manager sent it back
      await log(actors.line, 'manager_scores_saved', {}, at(12.1));
      await c.query("INSERT INTO signatures (scorecard_id,stage,signer_id,decision,signed_at) VALUES ($1,'line',$2,'approved',$3)", [sc.id, actors.line, at(12)]);
      await log(actors.line, 'approved', { stage: 'line', label: 'Line manager score', manager_total: mgrT }, at(12));
      const when = at(6);
      await c.query("INSERT INTO signatures (scorecard_id,stage,signer_id,decision,signed_at) VALUES ($1,'om',$2,'returned',$3)", [sc.id, om.id, when]);
      await c.query('INSERT INTO evaluation_comments (scorecard_id,author_id,body,created_at) VALUES ($1,$2,$3,$4)', [sc.id, om.id, 'Returned: Please re-check the Scope integrity score and add proof of work.', when]);
      await log(om.id, 'returned', { stage: 'om', to: 'submitted', reason: 'Please re-check the Scope integrity score and add proof of work.' }, when);
    }
    if (submitted) {
      await c.query('INSERT INTO evaluation_comments (scorecard_id,author_id,body,created_at) VALUES ($1,$2,$3,$4)', [sc.id, lms[lmKey], 'Your team goal links well to the practice goal. Please keep the proof of work up to date.', at(29)]);
      await c.query('INSERT INTO evaluation_comments (scorecard_id,author_id,body,created_at) VALUES ($1,$2,$3,$4)', [sc.id, uid, 'Thank you. Proof of work is updated on the Notion link.', at(28.5)]);
    }
    n++;
  }
  return n;
}

(async () => {
  const pool = getPool(), c = await pool.connect();
  try {
    await c.query('BEGIN');
    const removed = await remove(c);
    if (REMOVE) { await c.query('COMMIT'); console.log(`Removed demo data (${removed} demo people and everything linked to them).`); }
    else { const n = await seed(c); await c.query('COMMIT'); console.log(`Demo data ready: ${n} demo employees and 2 demo line managers (emails end ${DOMAIN}) with scorecards, approvals, audit trails and goals for ${new Date().getFullYear()}.\nTo remove it all later: npm run db:demo:remove`); }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error(e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();