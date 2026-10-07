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

// kpis: [{category, category_weight, weight_in_category, <field>}]
function weightErrors(kpis) {
  const errs = [];
  if (!kpis.length) return ['Add at least one KPI.'];
  const cats = new Map();
  for (const k of kpis) {
    if (!cats.has(k.category)) cats.set(k.category, { w: Number(k.category_weight), wic: 0 });
    const c = cats.get(k.category);
    if (Number(k.category_weight) !== c.w) errs.push(`Category "${k.category}" has different weights on its rows.`);
    c.wic += Number(k.weight_in_category);
  }
  const total = [...cats.values()].reduce((s, c) => s + c.w, 0);
  if (Math.abs(total - 100) > 0.001) errs.push(`Category weights add up to ${total}%, they must total 100%.`);
  for (const [name, c] of cats)
    if (Math.abs(c.wic - 100) > 0.001) errs.push(`KPI weights in "${name}" add up to ${c.wic}%, they must total 100%.`);
  return errs;
}

function total(kpis, field) {
  if (kpis.some((k) => k[field] == null)) return null;
  const cats = new Map();
  for (const k of kpis) {
    if (!cats.has(k.category)) cats.set(k.category, { w: Number(k.category_weight), s: 0 });
    cats.get(k.category).s += (Number(k.weight_in_category) * Number(k[field])) / 100;
  }
  return r2([...cats.values()].reduce((s, c) => s + (c.w * c.s) / 100, 0));
}
module.exports = { BANDS, ratingFor, weightErrors, total };
