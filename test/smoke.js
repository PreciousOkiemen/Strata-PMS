// End-to-end API test on a throwaway embedded Postgres. Run: npm test
const EmbeddedPostgres = require('embedded-postgres').default;
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pms-pg-'));
  const pg = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), initdbFlags: ['--locale=C', '--lc-messages=C'], user: 'postgres', password: 'pw', port: 54329, persistent: false });
  await pg.initialise(); await pg.start(); await pg.createDatabase('pms');
  process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:54329/pms';
  process.env.JWT_SECRET = 'x'.repeat(40); process.env.EXTERNAL_API_KEYS = 'testkey';
  const { execSync } = require('child_process');
  execSync('node db/apply-schema.js', { stdio: 'inherit', env: process.env });
  execSync('node ' + path.join(__dirname, '..', 'db', 'seed.js'), { stdio: 'inherit', env: process.env, cwd: dir });
  const creds = Object.fromEntries(fs.readFileSync(path.join(dir, 'seed-credentials.txt'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t')));
  const app = require('../server');
  const srv = app.listen(0); const base = `http://localhost:${srv.address().port}`;
  const call = async (m, p, body, tok, extra = {}) => {
    const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const login = async (email) => {
    let r = await call('POST', '/api/v1/auth/login', { email, password: creds[email] });
    assert.equal(r.status, 200, 'login ' + email);
    assert.equal(r.body.user.must_change_password, true);
    let t = r.body.token;
    r = await call('POST', '/api/v1/auth/change-password', { current_password: creds[email], new_password: 'NewPassw0rd!x' }, t); assert.equal(r.status, 200);
    return t;
  };
  assert.equal((await call('POST', '/api/v1/auth/login', { email: 'tobi@strata.ng', password: 'wrong' })).status, 401);
  assert.equal((await call('GET', '/api/v1/scorecards')).status, 401);
  const T = {}; for (const e of Object.keys(creds)) T[e.split('@')[0]] = await login(e);

  // employee: create, fill, submit
  let r = await call('POST', '/api/v1/scorecards', { fy: 2026, quarter: 'Q2' }, T.tobi); assert.equal(r.status, 201);
  const id = r.body.id;
  r = await call('GET', '/api/v1/scorecards/' + id, null, T.tobi); assert.equal(r.status, 200);
  const kpis = r.body.kpis.map((k) => ({ ...k, self_score: 4 }));
  r = await call('POST', `/api/v1/scorecards/${id}/submit`, null, T.tobi); assert.equal(r.status, 422, 'cannot submit without proof/scores');
  r = await call('PUT', `/api/v1/scorecards/${id}/self`, { kpis, proof_of_work_url: 'http://bad' }, T.tobi); assert.equal(r.status, 400, 'https only');
  r = await call('PUT', `/api/v1/scorecards/${id}/self`, { kpis, proof_of_work_url: 'https://www.notion.so/strata/q2' }, T.tobi); assert.equal(r.status, 200);
  const bad = kpis.map((k, i) => (i === 0 ? { ...k, weight_in_category: 10 } : k));
  r = await call('PUT', `/api/v1/scorecards/${id}/self`, { kpis: bad, proof_of_work_url: 'https://n.so/x' }, T.tobi); assert.equal(r.status, 200);
  r = await call('POST', `/api/v1/scorecards/${id}/submit`, null, T.tobi); assert.equal(r.status, 422, 'weights must total 100'); assert.match(r.body.error, /100%/);
  await call('PUT', `/api/v1/scorecards/${id}/self`, { kpis, proof_of_work_url: 'https://www.notion.so/strata/q2' }, T.tobi);
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/submit`, null, T.tobi)).status, 200);
  assert.equal((await call('PUT', `/api/v1/scorecards/${id}/self`, { kpis }, T.tobi)).status, 409, 'locked after submit');

  // RBAC
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/approve`, null, T.tobi)).status, 403, 'self approve');
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/approve`, null, T.hilary)).status, 403, 'ceo too early');
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/approve`, null, T.abdulmatin)).status, 403, 'om too early');
  r = await call('GET', '/api/v1/scorecards?fy=2026', null, T.aisha); assert.equal(r.body.scorecards.length, 1);

  // line manager scores (manager scores 4,3,4,4,4,3 -> 3.70)
  let d = (await call('GET', '/api/v1/scorecards/' + id, null, T.precious)).body;
  assert.equal(d.scorecard.my_action, true);
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/approve`, null, T.precious)).status, 422, 'must score all');
  const mscores = [4, 3, 4, 4, 4, 3];
  r = await call('PUT', `/api/v1/scorecards/${id}/manager-scores`, { scores: d.kpis.map((k, i) => ({ id: k.id, manager_score: mscores[i] })) }, T.precious); assert.equal(r.status, 200);
  // return then re-submit path
  r = await call('POST', `/api/v1/scorecards/${id}/return`, { reason: 'Add proof for scope' }, T.precious); assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/v1/scorecards/' + id, null, T.tobi)).body.scorecard.status, 'draft');
  assert.equal((await call('GET', '/api/v1/scorecards/' + id, null, T.abdulmatin)).status, 404, 'drafts are private');
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/submit`, null, T.tobi)).status, 200);
  d = (await call('GET', '/api/v1/scorecards/' + id, null, T.precious)).body;
  await call('PUT', `/api/v1/scorecards/${id}/manager-scores`, { scores: d.kpis.map((k, i) => ({ id: k.id, manager_score: mscores[i] })) }, T.precious);
  r = await call('POST', `/api/v1/scorecards/${id}/approve`, null, T.precious); assert.equal(r.status, 200); assert.equal(r.body.manager_total, 3.7);
  for (const who of ['abdulmatin', 'olusola', 'aisha', 'hilary']) {
    r = await call('POST', `/api/v1/scorecards/${id}/approve`, null, T[who]); assert.equal(r.status, 200, 'approve by ' + who);
  }
  d = (await call('GET', '/api/v1/scorecards/' + id, null, T.hilary)).body;
  assert.equal(d.scorecard.status, 'ceo_approved'); assert.equal(d.scorecard.final_rating, 'Exceeds Expectation');
  assert.ok(d.audit.length >= 10 && d.signatures.length >= 6);
  assert.equal((await call('POST', `/api/v1/scorecards/${id}/comments`, { body: 'Well done' }, T.hilary)).status, 201);

  // goals
  assert.equal((await call('POST', '/api/v1/goals', { level: 'company', title: 'x' }, T.precious)).status, 403);
  r = await call('GET', '/api/v1/goals?fy=' + new Date().getFullYear(), null, T.precious); const company = r.body.goals.find((g) => g.level === 'company');
  const practice = r.body.goals.find((g) => g.level === 'practice');
  assert.equal((await call('POST', '/api/v1/goals', { level: 'team', title: 'AI Transformation: ship live use cases', parent_id: practice.id }, T.precious)).status, 201);
  assert.equal((await call('POST', '/api/v1/goals', { level: 'team', title: 'bad link', parent_id: company.id }, T.precious)).status, 400);

  // external API
  assert.equal((await call('GET', '/api/v3/external/scores?fy=2026')).status, 401);
  r = await call('GET', '/api/v3/external/scores?fy=2026', null, null, { 'x-api-key': 'testkey' }); assert.equal(r.body.scores.length, 1);
  r = await call('POST', '/api/v3/external/roster/sync', { users: [{ email: 'new.hire@strata.ng', name: 'New Hire', role: 'employee', line_manager_email: 'precious@strata.ng' }] }, null, { 'x-api-key': 'testkey' });
  assert.deepEqual(r.body, { created: 1, updated: 0 });
  r = await call('POST', '/api/v3/external/evidence', { employee_email: 'tobi@strata.ng', fy: 2026, quarter: 'Q2', url: 'https://notion.so/p', source: 'notion' }, null, { 'x-api-key': 'testkey' }); assert.equal(r.status, 201);
  r = await call('GET', '/api/v3/external/pending-actions', null, null, { 'x-api-key': 'testkey' }); assert.equal(r.status, 200);
  console.log('ALL API CHECKS PASSED');
  srv.close(); await require('../lib/db').getPool().end(); await pg.stop(); process.exit(0);
})().catch(async (e) => { console.error('FAILED:', e); process.exit(1); });
