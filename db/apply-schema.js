const fs = require('fs'), path = require('path');
const { getPool } = require('../lib/db');
(async () => {
  await getPool().query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Schema applied.');
  await getPool().end();
})().catch((e) => { console.error(e.message); process.exit(1); });
