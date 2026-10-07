// Approval chain: Employee -> Line manager -> Overall manager -> Calibration -> Chief of Staff -> CEO
const ORDER = ['draft', 'submitted', 'line_scored', 'om_approved', 'calibrated', 'cos_approved', 'ceo_approved'];
const FLOW = [
  { from: 'submitted', to: 'line_scored', stage: 'line', label: 'Line manager score',
    canAct: (sc, u) => u.id === sc.line_manager_id },
  { from: 'line_scored', to: 'om_approved', stage: 'om', label: 'Overall manager approval',
    canAct: (sc, u) => u.id === sc.overall_manager_id },
  { from: 'om_approved', to: 'calibrated', stage: 'cal', label: 'Calibration committee',
    canAct: (sc, u) => u.role === 'calibration' },
  { from: 'calibrated', to: 'cos_approved', stage: 'cos', label: 'Chief of Staff review',
    canAct: (sc, u) => u.role === 'cos' },
  { from: 'cos_approved', to: 'ceo_approved', stage: 'ceo', label: 'CEO final approval',
    canAct: (sc, u) => u.role === 'ceo' },
];
const stepFor = (status) => FLOW.find((f) => f.from === status) || null;
module.exports = { ORDER, FLOW, stepFor };
