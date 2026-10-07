// usage: npm run set-password -- someone@strata.ng   (prints a new temporary password)
const crypto = require('crypto'), bcrypt = require('bcryptjs');
const { getPool } = require('../lib/db');
(async () => {
  const email = (process.argv[2] || '').toLowerCase();
  if (!email) { console.error('Give an email address.'); process.exit(1); }
  const pw = crypto.randomBytes(9).toString('base64url');
  const r = await getPool().query('UPDATE users SET password_hash=$1, must_change_password=true WHERE lower(email)=$2 RETURNING email', [await bcrypt.hash(pw, 12), email]);
  console.log(r.rowCount ? `New temporary password for ${email}: ${pw}` : 'No such user.');
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
