const { Pool, types } = require('pg');
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric -> number

let pool;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: local ? false : { rejectUnauthorized: false }, // Supabase pooler (port 6543)
      max: Number(process.env.PG_POOL_MAX || 5),
    });
  }
  return pool;
}
const query = (text, params) => getPool().query(text, params);
async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
async function audit(c, { scorecardId = null, actor = null, label = null, action, detail = {} }) {
  await c.query(
    'INSERT INTO audit_logs (scorecard_id, actor_id, actor_label, action, detail) VALUES ($1,$2,$3,$4,$5)',
    [scorecardId, actor, label, action, JSON.stringify(detail)]
  );
}
module.exports = { query, tx, audit, getPool };
