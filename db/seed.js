// Seeds the starter roster from the design. Passwords are random and written to seed-credentials.txt (git-ignored).
// Replace/extend the roster with your HRIS sync (/api/v3/external/roster/sync) or edit PEOPLE below.
const fs = require('fs'), crypto = require('crypto'), bcrypt = require('bcryptjs');
const { getPool } = require('../lib/db');

const PEOPLE = [
  { email: 'hilary.daudu@strata.ng', name: 'Hilary Daudu', job_title: 'Chief Executive Officer', practice: 'Executive office', role: 'ceo' },
  { email: 'aisha@strata.ng', name: 'Aisha Hussaini', job_title: 'Chief of Staff', practice: 'Operations', role: 'cos' },
  { email: 'olusola@strata.ng', name: 'Olusola Oyekola', job_title: 'Calibration Committee', practice: 'People', role: 'calibration' },
  { email: 'abdul-matin@strata.ng', name: 'Abdul-Matin Gbadegesin', job_title: 'Practice Director', practice: 'Product', role: 'overall_manager' },
  { email: 'precious@strata.ng', name: 'Precious Okiemen', job_title: 'Software Engineer', practice: 'Product', role: 'line_manager', om: 'abdul-matin@strata.ng' },
  { email: 'Oluwatobi.omotayo@strata.ng', name: 'Oluwatobi Omotayo', job_title: 'Product Manager', practice: 'Product', role: 'employee', lm: 'precious@strata.ng', om: 'abdul-matin@strata.ng' },
];
const pwd = () => crypto.randomBytes(9).toString('base64url');

(async () => {
  const pool = getPool(), lines = [];
  const ids = {};
  for (const p of PEOPLE) {
    const pw = pwd();
    const hash = await bcrypt.hash(pw, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email,name,job_title,practice,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (email) DO NOTHING RETURNING id`, [p.email, p.name, p.job_title, p.practice, p.role, hash]);
    if (rows[0]) { ids[p.email] = rows[0].id; lines.push(`${p.email}\t${pw}`); }
    else ids[p.email] = (await pool.query('SELECT id FROM users WHERE email=$1', [p.email])).rows[0].id;
  }
  for (const p of PEOPLE)
    await pool.query('UPDATE users SET line_manager_id=$2, overall_manager_id=$3 WHERE id=$1',
      [ids[p.email], p.lm ? ids[p.lm] : null, p.om ? ids[p.om] : null]);
  const fy = new Date().getFullYear();
  const has = await pool.query('SELECT 1 FROM parent_goals WHERE fy=$1 LIMIT 1', [fy]);
  if (!has.rows[0]) {
    const co = (await pool.query("INSERT INTO parent_goals (level,title,measure,target,fy,owner_id,created_by) VALUES ('company','Grow Strata revenue 40% in FY26','Annual revenue compared with FY25','+40%',$1,$2,$2) RETURNING id", [fy, ids['hilary@strata.ng']])).rows[0].id;
    await pool.query("INSERT INTO parent_goals (level,practice,parent_id,title,fy,owner_id,created_by) VALUES ('practice','Product',$1,'Product & AI: 95% on-time delivery and measured outcomes across all client engagements',$2,$3,$3)", [co, fy, ids['abdul-matin@strata.ng']]);
  }
  if (lines.length) {
    fs.writeFileSync('seed-credentials.txt', 'email\ttemporary password (must be changed at first sign-in)\n' + lines.join('\n') + '\n', { mode: 0o600 });
    console.log(`Created ${lines.length} users. Temporary passwords saved to seed-credentials.txt. Share them securely, then delete the file.`);
  } else console.log('Roster already present, nothing created.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
