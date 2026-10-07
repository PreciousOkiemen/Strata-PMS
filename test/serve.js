// Starts a throwaway Postgres + the app for manual/UI testing. Run: node test/serve.js
const EmbeddedPostgres = require('embedded-postgres').default;
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-pg-'));
  const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), initdbFlags: ['--locale=C', '--lc-messages=C'], user: 'postgres', password: 'pw', port: 54330, persistent: false });
  await pg.initialise(); await pg.start(); await pg.createDatabase('pms');
  process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:54330/pms';
  process.env.JWT_SECRET = 'x'.repeat(40); process.env.EXTERNAL_API_KEYS = 'testkey';
  const { execSync } = require('child_process');
  execSync('node ' + path.join(__dirname, '..', 'db', 'apply-schema.js'), { env: process.env });
  execSync('node ' + path.join(__dirname, '..', 'db', 'seed.js'), { env: process.env, cwd: dir });
  fs.copyFileSync(path.join(dir, 'seed-credentials.txt'), '/tmp/pms-creds.txt'); fs.chmodSync('/tmp/pms-creds.txt', 0o644);
  require('../server').listen(3111, () => console.log('READY http://localhost:3111'));
})().catch((e) => { console.error(e); process.exit(1); });
