// Standalone dataset validation needs no OphthoScribe history or checkout.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const normative = require('../../js/visual-field/visual-field-normative.mjs');
const root = path.resolve(__dirname, '../..');
const DATASET = 'data/directories/visual-field/datasets/ophthoscribe-24-2-normative-lf.v1.json';
const doc = () => JSON.parse(fs.readFileSync(path.join(root, DATASET), 'utf8'));

test('the unchanged shipped artifact validates and retains its provenance statuses', () => {
  const dataset = doc();
  assert.deepEqual(normative.validate(dataset), { ok: true, errors: [] });
  assert.equal(dataset.provenance.redistributionRights, 'derived-from-suny-iu-visualfields-gpl3-unverified');
  assert.equal(dataset.provenance.clinicalValidation, 'not-validated');
});

test('fromDataset retains coordinates, blind points, age behavior and dataset identity', () => {
  const after = normative.fromDataset(doc());
  assert.deepEqual(after.BLIND, { OD: [25, 34], OS: [19, 28] });
  assert.deepEqual(after.ROW_COUNTS, [4, 6, 8, 9, 9, 8, 6, 4]);
  assert.equal(after.coordinates('OD').length, 54);
  assert.equal(after.coordinates('OS').length, 54);
  assert.equal(after.id, 'ophthoscribe-24-2-normative-lf'); assert.equal(after.version, '1.0.0');
  assert.deepEqual(after.PROVENANCE, doc().provenance);
  assert.throws(() => after.forEye('OU', 60), /eye is invalid/); assert.throws(() => after.forEye('OD', 200), /age is invalid/);
});

test('coordinates(OS) mirrors x row by row', () => {
  const surface = normative.fromDataset(doc()); let offset = 0;
  surface.ROW_COUNTS.forEach((count) => {
    const od = surface.coordinates('OD').slice(offset, offset + count).map((p) => p.xOd), os = surface.coordinates('OS').slice(offset, offset + count).map((p) => p.xOd);
    assert.deepEqual(os, od.reverse()); offset += count;
  });
});

test('validate refuses a short table, ids out of printout order, non-finite stats, malformed cutoffs, and null stats off the blind spot', () => {
  const short = doc(); short.points.pop(); assert.match(normative.validate(short).errors[0], /54 points/);
  const order = doc(); order.points[1].id = 'p00'; assert.match(normative.validate(order).errors[0], /must carry id p01 in printout order/);
  const nan = doc(); nan.points[0].sdTd = 'x'; assert.match(normative.validate(nan).errors[0], /p00/);
  const cut = doc(); cut.points[0].tdCutoffs = [1, 2]; assert.match(normative.validate(cut).errors[0], /cutoffs/);
  const hole = doc(); hole.points[3].ageIntercept = null; assert.match(normative.validate(hole).errors[0], /p03/);
  assert.match(normative.validate(null).errors[0], /document/); assert.match(normative.validate({ ...doc(), schema: 'x' }).errors[0], /schema/);
  assert.throws(() => normative.fromDataset(short), /dataset is invalid/);
});

test('shippedDataset() (node only) returns the artifact; the loader bakes no table', () => {
  assert.equal(normative.shippedDataset().id, 'ophthoscribe-24-2-normative-lf');
  const source = fs.readFileSync(path.join(root, 'js/visual-field/visual-field-normative.mjs'), 'utf8');
  assert.doesNotMatch(source, /30\.2207/); assert.doesNotMatch(source, /mode:\s*['"]operator-accepted/);
  assert.equal(normative.PROVENANCE, undefined); assert.equal(normative.forEye, undefined);
});
