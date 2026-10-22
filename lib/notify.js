const { query } = require('./db');

// Create one notification for each user. Pass the transaction client `c` so it
// is saved together with the action; pass null to use a normal query.
async function notify(c, userIds, { type, title, body = null, scorecardId = null }) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return;
  const run = c ? c.query.bind(c) : query;
  await run(
    'INSERT INTO notifications (user_id,type,title,body,scorecard_id) SELECT unnest($1::uuid[]),$2,$3,$4,$5',
    [ids, type, title, body, scorecardId]
  );
}

// Ids of all active users with a role (calibration, cos, ceo).
async function idsWithRole(c, role) {
  const run = c ? c.query.bind(c) : query;
  const { rows } = await run('SELECT id FROM users WHERE role=$1 AND active', [role]);
  return rows.map((r) => r.id);
}

module.exports = { notify, idsWithRole };