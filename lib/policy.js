// Reads an uploaded policy file (PDF, Word or text), splits it into sections, and finds the sections that match a question.
const mammoth = require('mammoth');

const MAX_CHARS = 200000;

async function extractText(buf, filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  let text;
  if (ext === 'docx') {
    text = (await mammoth.convertToMarkdown({ buffer: buf })).value;
  } else if (ext === 'pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js'); // the package root runs a debug file when imported
    try { text = (await pdf(buf)).text; }
    catch (err) { const e = new Error('That PDF could not be read. Upload the Word version, or save the PDF again and retry.'); e.status = 400; throw e; }
  } else if (['txt', 'md'].includes(ext)) {
    text = buf.toString('utf8');
  } else {
    const e = new Error('Upload a PDF, Word (.docx) or text file.'); e.status = 400; throw e;
  }
  text = text.replace(/\\([.\-()#*_>!+])/g, '$1').replace(/\*\*|__/g, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 50) { const e = new Error('No readable text was found in that file. If it is a scan, upload a text-based PDF or a Word file.'); e.status = 400; throw e; }
  return text.slice(0, MAX_CHARS);
}

const HEADING = [
  /^#{1,4}\s+(.+)$/,                                              // Word heading styles (after conversion)
  /^((?:section|part|article|chapter)\s+\d+[.:)]?\s+.{2,80})$/i,    // "Section 3: Scoring"
  /^(\d+(?:\.\d+){0,2}[.)]?\s+[A-Z].{1,80})$/,                    // "3. Scoring", "3.1 Weights"
  /^([A-Z][A-Z0-9 &/,\-:()']{3,80})$/,                            // ALL CAPS
];
function headingOf(line) {
  const t = line.trim();
  if (!t || t.length > 95) return null;
  for (const re of HEADING) {
    const m = t.match(re);
    if (!m) continue;
    const h = m[1].replace(/^#+\s*/, '').trim();
    if (re === HEADING[2] && /[.;,]$/.test(h) && h.length > 60) continue; // a numbered sentence, not a heading
    if (/^\d+$/.test(h) || h.split(/\s+/).length > 14) continue;
    return h;
  }
  return null;
}

// A short title-like line followed by a full sentence. Used only when no clearer headings exist (typical of PDFs).
function looseHeading(line, next) {
  const t = line.trim(), n = String(next || '').trim();
  if (!t || t.length > 50 || t.split(/\s+/).length > 7 || /[.,;:?!]$/.test(t) || !/^[A-Z0-9]/.test(t)) return null;
  return n.length > t.length + 20 && /[.:;]$|\s/.test(n) ? t : null;
}

function cut(text, loose) {
  const lines = text.split('\n'), out = [];
  let cur = { heading: 'Introduction', lines: [] };
  lines.forEach((line, i) => {
    const nextLine = lines.slice(i + 1).find((l) => l.trim());
    const h = headingOf(line) || (loose ? looseHeading(line, nextLine) : null);
    if (h) { if (cur.lines.join('').trim()) out.push(cur); cur = { heading: h, lines: [] }; }
    else cur.lines.push(line);
  });
  if (cur.lines.join('').trim()) out.push(cur);
  if (out.length > 1 && out[0].heading === 'Introduction' && out[0].lines.join(' ').trim().length < 60) out.shift(); // just a document title
  return out.map((s) => ({ heading: s.heading, body: s.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() })).filter((s) => s.body);
}

// Returns [{ heading, body }]. Falls back to equal-sized parts when the file has no recognisable headings.
function splitSections(text) {
  let secs = cut(text, false);
  if (secs.length < 2) secs = cut(text, true);
  if (secs.length < 2) { // no headings found: chunk by paragraphs
    secs = []; let buf = '', n = 1;
    for (const para of text.split(/\n\s*\n/)) {
      if (buf && buf.length + para.length > 1500) { secs.push({ heading: `Part ${n++}`, body: buf.trim() }); buf = ''; }
      buf += para + '\n\n';
    }
    if (buf.trim()) secs.push({ heading: `Part ${n}`, body: buf.trim() });
  }
  return secs.slice(0, 200);
}

const STOP = new Set('a an the is are was were be been do does did how what when who which why can could should would will i my me we our you your it its of to in on for and or if at by with from as about this that there their they them than then so not no any'.split(' '));
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
const terms = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w) && w.length > 1).map(stem);

// Best-matching sections for a question: [{ heading, body, score }]
function search(sections, question, n = 2) {
  const q = [...new Set(terms(question))];
  if (!q.length) return [];
  return sections.map((s) => {
    const body = terms(s.body), head = terms(s.heading);
    let score = 0;
    for (const t of q) score += body.filter((x) => x === t).length + 4 * head.filter((x) => x === t).length;
    return { ...s, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
}

module.exports = { extractText, splitSections, search };