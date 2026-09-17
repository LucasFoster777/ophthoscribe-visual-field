// The two doors (js/visual-field/visual-field-door.mjs): one eye-report grammar from the printed or the computed block.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require('node:url');
global.window = undefined; global.OS = { visualField: {} };
const door = require('../../js/visual-field/visual-field-door.mjs');
const root = path.resolve(__dirname, '../..'), url = (rel) => pathToFileURL(path.join(root, rel)).href;
const readFile = (rel) => fs.promises.readFile(path.join(root, rel), 'utf8');
let model;
test.before(async () => {
  const dirs = await (await import(url('js/data/visual-field/directories.mjs'))).loadDirectories({ readFile });
  model = (await import(url('js/data/visual-field/model.mjs'))).createModel(dirs, { hashHex: (t) => t });
});
function clinicTest() {
  const t = model.emptyTest('24-2', 'OD');
  t.measurement.points.forEach((p, i) => { p.threshold = i === 25 ? { state: 'not-present-in-source' } : { value: 30 - (i % 5), unit: 'dB' }; });
  t.measurement.reliability = { fl: { value: 1 / 13, numerator: 1, denominator: 13 }, fp: { value: 2, unit: '%' }, fn: { value: 0, unit: '%' }, message: { state: 'not-present-in-source' } };
  t.acquisition.ageYears = { value: 64 };
  const printed = model.printedBlock(t);
  printed.values.md = { value: -2.5, unit: 'dB' }; printed.values.psd = { state: 'not-extracted' }; printed.values.vfi = { value: 97, unit: '%' }; printed.values.ght = { value: 'Within normal limits' };
  printed.values.points[0].totalDeviation = { value: -3, unit: 'dB' }; printed.values.points[0].totalDeviationProbability = { value: 'p<5%' };
  return t;
}
const absent = { state: 'not-present-in-source' };
function computedBlock(t, datasetId, md) {
  return { origin: 'computed', engineVersion: 'x@1', datasetId, datasetVersion: '1', values: { md: { value: md, unit: 'dB' }, psd: absent, vfi: absent, ght: absent, mdHemifield: absent, sf: absent, cpsd: absent,
    points: t.measurement.points.map((p) => ({ id: p.id, totalDeviation: absent, patternDeviation: absent, totalDeviationProbability: absent, patternDeviationProbability: absent })) } };
}
test('View reads the printed block; absences read Not extracted; the blank printout cell is absent', () => {
  const r = door.eyeReportFrom(clinicTest(), 'view');
  assert.equal(r.valuesOrigin, 'printed'); assert.equal(r.absence, 'Not extracted'); assert.equal(r.engine, ''); assert.equal(r.dataset, '');
  assert.equal(r.conventional.md, -2.5); assert.equal(r.conventional.psd, null); assert.equal(r.conventional.vfi, 97);
  assert.equal(r.conventional.values[0], -3); assert.equal(r.conventional.probabilities[0], 'p<5%'); assert.equal(r.conventional.probabilities[1], 'not-read');
  assert.equal(r.ght, 'Within normal limits');
  assert.equal(r.origins.md, 'printed'); assert.equal(r.origins.psd, null); assert.equal(r.origins.values[0], 'printed'); assert.equal(r.origins.values[1], null); assert.equal(r.hasComputed, false);
  assert.deepEqual(r.device.fl, { state: 'read', numerator: 1, denominator: 13 }); assert.deepEqual(r.device.fp, { state: 'read', value: 2 });
  assert.deepEqual(r.device.psd, { state: 'not-read' });
  assert.deepEqual(r.points[25].threshold, { value: null, state: 'not-read' }); assert.equal(r.points[25].absent, true);
  assert.equal(r.points[0].threshold.value, 30); assert.equal(r.points[0].absent, false); assert.equal(r.ageYears, 64); assert.equal(r.points.length, 54);
});
test('Dev View without a computed block stays empty; printed values remain only on the explicit device projection', () => {
  const r = door.eyeReportFrom(clinicTest(), 'dev');
  assert.equal(r.valuesOrigin, 'computed'); assert.equal(r.absence, 'No in-house normative established');
  assert.equal(r.conventional.psd, null); assert.equal(r.origins.psd, null); assert.deepEqual(r.device.md, { state: 'read', value: -2.5 });
  assert.equal(r.conventional.md, null); assert.equal(r.origins.md, null); assert.equal(r.conventional.values[0], null); assert.equal(r.origins.values[0], null);
});
test('View never substitutes a computed value where the printout carried nothing', () => {
  const t = clinicTest(); t.analyses.push(computedBlock(t, 'ophthoscribe-24-2', -1.1)); t.analyses[1].values.psd = { value: 2.2, unit: 'dB' };
  const r = door.eyeReportFrom(t, 'view');
  assert.equal(r.conventional.md, -2.5); assert.equal(r.origins.md, 'printed');
  assert.equal(r.conventional.psd, null); assert.equal(r.origins.psd, null); assert.equal(r.hasComputed, true); assert.equal(r.dataset, 'ophthoscribe-24-2@1');
});
test('Dev View reads the newest computed block and names engine + dataset', () => {
  const t = clinicTest();
  t.analyses.push(computedBlock(t, 'old', -9)); t.analyses.push(computedBlock(t, 'ophthoscribe-24-2', -1.1));
  const r = door.eyeReportFrom(t, 'dev');
  assert.equal(r.conventional.md, -1.1); assert.equal(r.origins.md, 'computed'); assert.equal(r.engine, 'x@1'); assert.equal(r.dataset, 'ophthoscribe-24-2@1');
  assert.equal(door.blockOf(t, 'computed').datasetId, 'ophthoscribe-24-2'); assert.equal(door.blockOf(t, 'printed').origin, 'printed');
});
test('doorsFor: clinic rows get View, development rows never do; the flag removes every Dev View', () => {
  assert.deepEqual(door.doorsFor({ lane: 'clinic' }, true), { view: true, dev: true });
  assert.deepEqual(door.doorsFor({ lane: 'development' }, true), { view: false, dev: true });
  assert.deepEqual(door.doorsFor({ lane: 'development' }, false), { view: false, dev: false });
  assert.deepEqual(door.doorsFor({ lane: 'clinic' }, false), { view: true, dev: false });
  assert.deepEqual(door.doorsFor(null, true), { view: false, dev: true });
});
test('standalone Dev View remains enabled without application settings', () => {
  assert.equal(door.devViewEnabled(), true);
  globalThis.localStorage = { getItem: () => 'off' };
  assert.equal(door.devViewEnabled(), true); delete globalThis.localStorage;
});

test('Dev View reads overlays.bayesian into the viewer shape; blockIndex selects among computed blocks (newest by default)', () => {
  const t = clinicTest();
  const older = computedBlock(t, 'A', -1); older.computedAt = '2026-08-28T01:00:00Z';
  const newer = computedBlock(t, 'B', -2); newer.computedAt = '2026-08-28T02:00:00Z'; newer.overlays = { bayesian: { posteriorMd: { mean: -1.5, std: 0.4 }, values: Array(54).fill(-1), probabilities: Array(54).fill(0.1) } };
  t.analyses.push(older, newer);
  const r = door.eyeReportFrom(t, 'dev');
  assert.equal(r.conventional.md, -2); assert.equal(r.dataset, 'B@1'); assert.deepEqual(r.block, { index: 1, engine: 'x@1', dataset: 'B@1', computedAt: '2026-08-28T02:00:00Z' });
  assert.equal(r.bayesian.values.length, 54); assert.equal(r.bayesian.posteriorMd.mean, -1.5); assert.deepEqual(Object.keys(r.overlays), ['bayesian']);
  const first = door.eyeReportFrom(t, 'dev', { blockIndex: 0 });
  assert.equal(first.conventional.md, -1); assert.equal(first.dataset, 'A@1'); assert.equal(first.block.index, 0); assert.equal(first.bayesian, null); assert.deepEqual(first.overlays, {});
  assert.equal(door.eyeReportFrom(t, 'dev', { blockIndex: 9 }).block.index, 1, 'an out-of-range index reads the newest');
  assert.deepEqual(door.computedBlocksOf(t).map((b) => b.datasetId), ['A', 'B']);
  const view = door.eyeReportFrom(t, 'view');
  assert.equal(view.bayesian, null, 'View never carries a posterior');
});
test('layout projects every point into explicit rows and columns for 24-2 and 30-2', () => {
  const p24 = door.eyeReportFrom(clinicTest(), 'view').layout;
  assert.equal(p24.columns, 10); assert.equal(p24.rows, 8); assert.equal(p24.columnOf.length, 54); assert.equal(p24.rowOf.length, 54);
  assert.deepEqual(p24.rowOf.slice(0, 10), [1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
  const t30 = model.emptyTest('30-2', 'OS'); const p30 = door.eyeReportFrom(t30, 'view').layout;
  assert.equal(p30.columns, 10); assert.equal(p30.rows, 10); assert.equal(p30.columnOf.length, 76); assert.equal(p30.rowOf.length, 76);
  assert.deepEqual(new Set(p30.rowOf), new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
});
test('map availability distinguishes a source absence from an unread extraction', () => {
  const t = clinicTest(), printed = door.blockOf(t, 'printed');
  printed.values.points.forEach((point) => {
    point.totalDeviation = absent; point.patternDeviation = absent;
    point.totalDeviationProbability = { value: 'normal' }; point.patternDeviationProbability = { value: 'normal' };
  });
  let r = door.eyeReportFrom(t, 'view');
  assert.deepEqual(r.mapAvailability, { totalDeviation: 'not-present-in-source', patternDeviation: 'not-present-in-source', totalDeviationProbability: 'read', patternDeviationProbability: 'read' });
  printed.values.points[4].patternDeviation = { state: 'not-extracted' }; r = door.eyeReportFrom(t, 'view');
  assert.equal(r.mapAvailability.patternDeviation, 'not-extracted'); assert.equal(r.extractionWarning, true);
});
