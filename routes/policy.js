const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, tx, audit } = require('../lib/db');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { extractText, splitSections, search } = require('../lib/policy');
const { askGemini } = require('../lib/gemini');

const router = express.Router();
router.use(express.json({ limit: '4mb' })); // policy files arrive as base64 text
router.use(requireAuth);

const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s));
const MAX_FILE = 3 * 1024 * 1024;
const ACTIVE = 'SELECT id,version,title,filename,created_at,published_at FROM policy_docs WHERE active';
const sectionsOf = async (docId) => (await query('SELECT heading,body FROM policy_sections WHERE doc_id=$1 ORDER BY position', [docId])).rows;
const excerpt = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);

// What the chat window needs: is there a policy, and some starter questions
router.get('/current', async (req, res, next) => {
  try {
    const doc = (await query(ACTIVE)).rows[0];
    if (!doc) return res.json({ policy: null, suggestions: [] });
    const secs = await sectionsOf(doc.id);
    const suggestions = secs.map((s) => s.heading).filter((h) => h.length <= 40).slice(0, 4).map((h) => `What does the policy say about ${h.toLowerCase()}?`);
    res.json({ policy: { version: doc.version, title: doc.title, published_at: doc.published_at }, suggestions });
  } catch (e) { next(e); }
});

const askLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, keyGenerator: (req) => req.user.id, validate: false,
  handler: (req, res) => res.status(429).json({ error: 'Too many questions. Wait a minute and try again.' }) });

router.post('/ask', askLimiter, async (req, res, next) => {
  try {
    const question = String(req.body.question || '').trim().slice(0, 500);
    if (!question) return res.status(400).json({ error: 'Type your question first.' });
    const doc = (await query(ACTIVE)).rows[0];
    if (!doc) return res.status(404).json({ error: 'No policy has been published yet.' });
    const secs = await sectionsOf(doc.id);
    if (process.env.GEMINI_API_KEY) {
      try {
        const r = await askGemini({ sections: secs, question });
        return res.json({ answer: r.answer, source: r.source ? `Performance policy, ${r.source}` : null, mode: 'ai' });
      } catch (e) { console.error('[gemini]', e.message); } // fall through to the plain search answer
    }
    const hit = search(secs, question, 1)[0];
    if (!hit) return res.json({ answer: 'I could not find that in the performance policy. Try different words, or ask your line manager.', source: null, mode: 'search' });
    res.json({ answer: excerpt(hit.body, 900), source: `Performance policy, ${hit.heading}`, mode: 'search' });
  } catch (e) { next(e); }
});

// ----- Chief of Staff only -----
router.get('/versions', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.id,d.version,d.title,d.filename,d.active,d.created_at,d.published_at,u.name AS uploaded_by,
              (SELECT count(*)::int FROM policy_sections s WHERE s.doc_id=d.id) AS sections
       FROM policy_docs d LEFT JOIN users u ON u.id=d.uploaded_by ORDER BY d.created_at DESC LIMIT 30`);
    res.json({ versions: rows });
  } catch (e) { next(e); }
});

// Upload creates a draft. It goes live only when published.
router.post('/upload', requireAdmin, async (req, res, next) => {
  try {
    const filename = String(req.body.filename || '').trim().slice(0, 200);
    const buf = Buffer.from(String(req.body.data || ''), 'base64');
    if (!filename || !buf.length) return res.status(400).json({ error: 'Choose a file to upload.' });
    if (buf.length > MAX_FILE) return res.status(413).json({ error: 'That file is too large. The limit is 3 MB.' });
    const text = await extractText(buf, filename);
    const secs = splitSections(text);
    const title = filename.replace(/\.[^.]+$/, '').slice(0, 120) || 'Performance policy';
    const id = await tx(async (c) => {
      await c.query('DELETE FROM policy_docs WHERE published_at IS NULL'); // earlier unpublished drafts
      const { rows } = await c.query('INSERT INTO policy_docs (version,title,filename,content,active,uploaded_by) VALUES (0,$1,$2,$3,false,$4) RETURNING id', [title, filename, text, req.user.id]);
      for (let i = 0; i < secs.length; i++) await c.query('INSERT INTO policy_sections (doc_id,position,heading,body) VALUES ($1,$2,$3,$4)', [rows[0].id, i, secs[i].heading.slice(0, 200), secs[i].body]);
      await audit(c, { actor: req.user.id, action: 'policy_uploaded', detail: { filename, sections: secs.length } });
      return rows[0].id;
    });
    res.status(201).json({ id, title, filename, sections: secs.map((s) => ({ heading: s.heading, chars: s.body.length, excerpt: excerpt(s.body, 160) })) });
  } catch (e) { next(e); }
});

router.get('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const doc = (await query('SELECT id,version,title,filename,active,published_at FROM policy_docs WHERE id=$1', [req.params.id])).rows[0];
    if (!doc) return res.status(404).json({ error: 'Not found.' });
    const secs = await sectionsOf(doc.id);
    res.json({ ...doc, sections: secs.map((s) => ({ heading: s.heading, chars: s.body.length, excerpt: excerpt(s.body, 160) })) });
  } catch (e) { next(e); }
});

// Make this version the live one: publishes a new draft, or switches back to an earlier version.
router.post('/:id/publish', requireAdmin, async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found.' });
    const out = await tx(async (c) => {
      const doc = (await c.query('SELECT id,version,filename,published_at FROM policy_docs WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      if (!doc) throw Object.assign(new Error('Not found.'), { status: 404 });
      let version = doc.version;
      if (!doc.published_at) version = (await c.query('SELECT coalesce(max(version),0)+1 AS v FROM policy_docs WHERE published_at IS NOT NULL')).rows[0].v;
      await c.query('UPDATE policy_docs SET active=false WHERE active');
      await c.query('UPDATE policy_docs SET active=true, version=$2, published_at=coalesce(published_at, now()) WHERE id=$1', [doc.id, version]);
      await audit(c, { actor: req.user.id, action: 'policy_published', detail: { version, filename: doc.filename } });
      return { version };
    });
    res.json({ ok: true, ...out });
  } catch (e) { next(e); }
});

router.use((err, req, res, next) => (err.type === 'entity.too.large' ? res.status(413).json({ error: 'That file is too large. The limit is 3 MB.' }) : next(err)));

module.exports = router;