// Scoring rules. Rating bands are configurable via RATING_BANDS env (JSON) if the policy changes.
const DEFAULT_BANDS = [
  { min: 4.5, label: 'Outstanding' },
  { min: 3.5, label: 'Exceeds Expectation' },
  { min: 2.5, label: 'Meets Expectation' },
  { min: 0, label: 'Below Expectation' },
];
const BANDS = (() => {
  try { return process.env.RATING_BANDS ? JSON.parse(process.env.RATING_BANDS) : DEFAULT_BANDS; }
  catch { return DEFAULT_BANDS; }
})().sort((a, b) => b.min - a.min);

const ratingFor = (score) => (score == null ? null : BANDS.find((b) => score >= b.min).label);
const r2 = (n) => Math.round(n * 100) / 100;

// A KPI row is {position, parent_position, category, category_weight, weight_in_category, <score field>}.
// parent_position = null -> main KPI (counts in its category).
// parent_position = n    -> sub-KPI of the main KPI at position n. Its weight is its share (out of 100%) of that
//                           main KPI, so sub-KPIs can never push a category over its weight.
const posOf = (k, i) => (k.position == null ? i : k.position);
function structure(kpis) {
  const byPos = new Map(kpis.map((k, i) => [posOf(k, i), k]));
  const kids = new Map();
  for (const [i, k] of kpis.entries()) {
    if (k.parent_position == null) continue;
    const p = byPos.get(k.parent_position);
    if (!p) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(k);
  }
  return { mains: kpis.filter((k) => k.parent_position == null), kids, byPos };
}

function weightErrors(kpis) {
  const errs = [];
  if (!kpis.length) return ['Add at least one KPI.'];
  const { mains, kids, byPos } = structure(kpis);
  for (const k of kpis) {
    if (k.parent_position == null) continue;
    const p = byPos.get(k.parent_position);
    if (!p || p.parent_position != null) errs.push('A sub-KPI must sit directly under a main KPI.');
  }
  if (!mains.length) return errs.concat('Add at least one main KPI.');
  const cats = new Map();
  for (const k of mains) {
    if (!cats.has(k.category)) cats.set(k.category, { w: Number(k.category_weight), wic: 0 });
    const c = cats.get(k.category);
    if (Number(k.category_weight) !== c.w) errs.push(`Category "${k.category}" has different weights on its rows.`);
    c.wic += Number(k.weight_in_category);
  }
  const total = [...cats.values()].reduce((s, c) => s + c.w, 0);
  if (Math.abs(total - 100) > 0.001) errs.push(`Category weights add up to ${total}%, they must total 100%.`);
  for (const [name, c] of cats)
    if (Math.abs(c.wic - 100) > 0.001) errs.push(`KPI weights in "${name}" add up to ${c.wic}%, they must total 100%.`);
  for (const [p, list] of kids) {
    const s = list.reduce((a, k) => a + Number(k.weight_in_category), 0);
    if (Math.abs(s - 100) > 0.001) errs.push(`Sub-KPIs under "${p.kpi}" add up to ${s}%, they must total 100%.`);
  }
  return errs;
}

// Score of a main KPI: its own score, or, when it has sub-KPIs, the weighted score of its sub-KPIs.
function mainScore(k, kids, field) {
  const list = kids.get(k);
  if (!list || !list.length) return k[field] == null ? null : Number(k[field]);
  let s = 0;
  for (const c of list) { if (c[field] == null) return null; s += (Number(c.weight_in_category) * Number(c[field])) / 100; }
  return s;
}
// true when any scoreable KPI (a sub-KPI, or a main KPI without sub-KPIs) has no score yet
function missingScores(kpis, field) {
  const { mains, kids } = structure(kpis);
  return mains.some((k) => mainScore(k, kids, field) == null);
}
function total(kpis, field) {
  const { mains, kids } = structure(kpis);
  if (!mains.length) return null;
  const cats = new Map();
  for (const k of mains) {
    const s = mainScore(k, kids, field);
    if (s == null) return null;
    if (!cats.has(k.category)) cats.set(k.category, { w: Number(k.category_weight), s: 0 });
    cats.get(k.category).s += (Number(k.weight_in_category) * s) / 100;
  }
  return r2([...cats.values()].reduce((s, c) => s + (c.w * c.s) / 100, 0));
}
module.exports = { BANDS, ratingFor, weightErrors, total, missingScores };