const test = require('node:test');
const assert = require('node:assert/strict');
const loader = require('../../js/visual-field/visual-field-normative.mjs');
const dataset = loader.shippedDataset(), normative = loader.fromDataset(dataset);
const analysis = require('../../js/visual-field/visual-field-analysis-core.mjs');
const png = require('../../js/visual-field/visual-field-png.mjs');
const crypto = require('node:crypto');

function input(eye = 'OD') {
  return { eye, ageYears: 60, fp: 0.03, fn: 0.02, fl: 0.05,
    thresholds: Array.from({ length: 54 }, (_, index) => ({ value: 28 - index % 4, state: 'read' })) };
}

test('analyze requires the dataset and stamps its identity into the provenance', () => {
  assert.throws(() => analysis.analyze(input()), /dataset is required/);
  assert.throws(() => analysis.analyze(input(), { schema: 'x' }), /dataset is invalid/);
  const result = analysis.analyze(input(), dataset);
  assert.equal(result.provenance.datasetId, 'ophthoscribe-24-2-normative-lf'); assert.equal(result.provenance.datasetVersion, '1.0.0');
  assert.deepEqual(result.provenance.normative, dataset.provenance);
  assert.equal(result.provenance.id, 'ophthoscribe-vf-24-2');
});

test('maps every OD/OS point and excludes both anatomical blind points', () => {
  const od = analysis.analyze(input('OD'), dataset);
  const os = analysis.analyze(input('OS'), dataset);
  assert.deepEqual(od.provenance.blindPointIds, ['p25', 'p34']);
  assert.deepEqual(os.provenance.blindPointIds, ['p19', 'p28']);
  assert.equal(od.bayesian.diagnostics.analyzedPoints, 52);
  assert.equal(os.bayesian.diagnostics.analyzedPoints, 52);
  let offset = 0;
  normative.ROW_COUNTS.forEach((count) => {
    const odRow = normative.coordinates('OD').slice(offset, offset + count).map((point) => point.xOd);
    const osRow = normative.coordinates('OS').slice(offset, offset + count).map((point) => point.xOd);
    assert.deepEqual(osRow, odRow.reverse());
    offset += count;
  });
});

test('keeps censored zero in the likelihood and allows up to two unread points', () => {
  const value = input();
  value.thresholds[0] = { value: 0, state: 'read', censored: true };
  value.thresholds[1] = { value: null, state: 'not-read' };
  value.thresholds[2] = { value: null, state: 'not-read' };
  const result = analysis.analyze(value, dataset);
  assert.equal(result.bayesian.diagnostics.analyzedPoints, 50);
  assert.equal(result.bayesian.values[0] !== null, true);
  assert.equal(result.bayesian.values[1], null);
  value.thresholds[3] = { value: null, state: 'not-read' };
  assert.throws(() => analysis.analyze(value, dataset), /no more than two unread/);
});

test('uses zero learning offset unless a test ordinal is explicitly confirmed', () => {
  assert.equal(analysis.analyze(input(), dataset).provenance.learningOffset, 0);
  const confirmed = input(); confirmed.testOrdinalConfirmed = true; confirmed.testOrdinal = 1;
  assert.equal(analysis.analyze(confirmed, dataset).provenance.learningOffset, 2);
});

test('rejects optimizer failure and emits finite conventional/Bayesian outputs', () => {
  const result = analysis.analyze(input(), dataset);
  assert.equal(Number.isFinite(result.conventional.md), true);
  assert.equal(Number.isFinite(result.conventional.psd), true);
  assert.equal(Number.isFinite(result.bayesian.posteriorMd.mean), true);
  const failed = input(); failed.forceOptimizerFailure = true;
  assert.throws(() => analysis.analyze(failed, dataset), /did not converge/);
});

test('renders byte-stable RGBA and PNG grayscale', () => {
  const value = analysis.analyze(input(), dataset);
  const first = png.render(value.bayesian.values, 'OD', normative.coordinates('OD'));
  const second = png.render(value.bayesian.values, 'OD', normative.coordinates('OD'));
  assert.deepEqual(first.rgba, second.rgba);
  assert.deepEqual(first.png, second.png);
  assert.equal(first.png.length < 250 * 1024, true);
  assert.equal(crypto.createHash('sha256').update(first.png).digest('hex'),
    crypto.createHash('sha256').update(second.png).digest('hex'));
});
