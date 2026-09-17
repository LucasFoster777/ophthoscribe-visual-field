import { api as normative } from '../visual-field/visual-field-normative.mjs';

const typed = cell => cell && typeof cell.state !== 'string' && cell.value !== undefined ? cell : null;
export function inputOf(test) {
  const age = typed(test?.acquisition?.ageYears), points = test?.measurement?.points || [], r = test?.measurement?.reliability || {};
  if (points.length !== 54 || !age || !Number.isFinite(Number(age.value))) return null;
  const fp = typed(r.fp), fn = typed(r.fn), fl = r.fl && typeof r.fl.state !== 'string' ? r.fl : null;
  return { eye: test.measurement.eye, ageYears: Number(age.value), fp: fp ? Number(fp.value) / 100 : 0, fn: fn ? Number(fn.value) / 100 : 0,
    fl: fl && Number(fl.denominator) > 0 ? Number(fl.numerator) / Number(fl.denominator) : 0, testOrdinalConfirmed: false,
    thresholds: points.map(p => { const c = typed(p.threshold); return c ? { state: 'read', value: Number(c.value), censored: !!c.censored } : { state: 'not-read', value: null }; }) };
}

export function eligibility(exam, directories) {
  if (exam.pattern !== '24-2') return 'The current normative dataset supports 24-2 only.';
  const input = inputOf(exam.graphTest);
  if (!input) return 'Analysis requires 54 threshold locations and an explicit available age.';
  const ref = directories.datasetsFor(exam.pattern)[0];
  if (!ref) return 'No normative dataset is available for this pattern.';
  try {
    const rows = normative.fromDataset(directories.dataset(ref.id, ref.version)).forEye(input.eye, input.ageYears);
    if (rows.filter((r, i) => !r.blind && input.thresholds[i].state !== 'read').length > 2) return 'Analysis allows no more than two unread non-blind threshold points.';
    if (input.thresholds.some(p => p.state === 'read' && (!Number.isFinite(p.value) || p.value < -1 || p.value > 60))) return 'Analysis thresholds must be between -1 and 60 dB.';
    const coords = exam.graphTest.measurement.grid.points;
    const expected = normative.fromDataset(directories.dataset(ref.id, ref.version)).coordinates(input.eye);
    if (coords.length !== expected.length || coords.some((p, i) => p.x !== expected[i].xOd || p.y !== expected[i].y)) return 'Analysis requires the canonical 24-2 point order and coordinates.';
  } catch (error) { return error.message; }
  return '';
}

export function assumptionsOf(test) {
  const reliability = test.measurement.reliability || {};
  return ['fp', 'fn', 'fl'].filter(key => !reliability[key] || typeof reliability[key].state === 'string')
    .map(key => ({ field: key, assumption: 'Missing reliability is treated as zero by the copied calculation input mapping; it remains absent in source data.' }))
    .concat({ field: 'testOrdinal', assumption: 'Unconfirmed test ordinal; no learning offset applied.' });
}
