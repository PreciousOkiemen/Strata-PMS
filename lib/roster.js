// Shared by the admin "People" page (CSV / form) and the HRIS roster sync API.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { tx, audit } = require('./db');

const ROLES = ['employee', 'line_manager', 'overall_manager', 'calibration', 'cos', 'ceo'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tempPassword = () => crypto.randomBytes(9).toString('base64url'); // 12 chars

// Returns a list of { row, email, error } (row is 1-based, matching the CSV data rows).
async function validate(c, users) {
  const errs = [];
  const seen = new Set();
  const inBatch = new Set(users.map((u) => String(u.email || '').trim().toLowerCase()));
  const dbEmails = new Set((await c.query('SELECT lower(email) e FROM users')).rows.map((r) => r.e));
  users.forEach((u, i) => {
    const email = String(u.email || '').trim().toLowerCase();
    const bad = (error) => errs.push({ row: i + 1, email: email || '(blank)', error });
    if (!EMAIL.test(email)) return bad('Email is missing or not valid.');
    if (seen.has(email)) return bad('Email appears twice in this file.');
    seen.add(email);
    if (!String(u.name || '').trim()) bad('Name is missing.');
    if (!ROLES.includes(u.role)) bad(`Role must be one of: ${ROLES.join(', ')}.`);
    for (const [f, label] of [['line_manager_email', 'Line manager'], ['overall_manager_email', 'Overall manager']]) {
      const m = String(u[f] || '').trim().toLowerCase();
      if (!m) continue;
      if (m === email) bad(`${label} cannot be the person themselves.`);
      else if (!inBatch.has(m) && !dbEmails.has(m)) bad(`${label} ${m} is not in the system or in this file.`);
    }
  });
  return errs;
}

// opts.withPasswords: give new people a temporary password and return it once.
async function syncRoster(users, { actor = null, label = null, withPasswords = false } = {}) {
  return tx(async (c) => {
    const errors = await validate(c, users);
    if (errors.length) { const e = new Error('Some rows need fixing. Nothing was saved.'); e.status = 400; e.errors = errors; throw e; }
    let created = 0, updated = 0;
    const credentials = [];
    for (const u of users) {
      const email = u.email.trim().toLowerCase();
      const active = u.active === false || String(u.active).toLowerCase() === 'false' || String(u.active).toLowerCase() === 'no' ? false : true;
      const ex = await c.query('SELECT id FROM users WHERE lower(email)=$1', [email]);
      if (ex.rows[0]) {
        await c.query('UPDATE users SET name=$2,job_title=$3,practice=$4,role=$5,active=$6 WHERE id=$1',
          [ex.rows[0].id, u.name.trim(), u.job_title || null, u.practice || null, u.role, active]); updated++;
      } else {
        const pw = withPasswords ? tempPassword() : crypto.randomBytes(24).toString('hex');
        const hash = await bcrypt.hash(pw, 10);
        await c.query('INSERT INTO users (email,name,job_title,practice,role,active,password_hash,must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
          [email, u.name.trim(), u.job_title || null, u.practice || null, u.role, active, hash]); created++;
        if (withPasswords) credentials.push({ email, name: u.name.trim(), temp_password: pw });
      }
    }
    for (const u of users) { // second pass: manager links (people may reference each other)
      const find = async (e) => (e ? (await c.query('SELECT id FROM users WHERE lower(email)=$1', [e.trim().toLowerCase()])).rows[0] : null);
      const lm = await find(u.line_manager_email), om = await find(u.overall_manager_email);
      await c.query('UPDATE users SET line_manager_id=COALESCE($2,line_manager_id), overall_manager_id=COALESCE($3,overall_manager_id) WHERE lower(email)=$1',
        [u.email.trim().toLowerCase(), lm ? lm.id : null, om ? om.id : null]);
    }
    await audit(c, { actor, label, action: 'roster_sync', detail: { created, updated } });
    return { created, updated, credentials };
  });
}
module.exports = { ROLES, syncRoster, tempPassword };