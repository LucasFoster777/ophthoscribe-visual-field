// [Active · lazy 'persistence' group] visual-field-source/v1 mapping: extraction pages → source doc,
// source eye → report-eye scaffold / analysis input. Pure; no I/O.
var NOT_READ = { value: null, state: 'not-read' };
var OCR_PROVENANCE = Object.freeze({ origin: 'ocr', device: { manufacturer: null, model: null, serial: null, software: null },
  exportFormat: 'ophthoscribe-ocr', capturedAt: null });

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function metricOrNotRead(value) { return value && value.state === 'read' ? copy(value) : copy(NOT_READ); }
function testParameters(value) {
  var out = { strategy: String(value && value.strategy || ''), stimulus: String(value && value.stimulus || ''),
    background: String(value && value.background || '') };
  if (value && value.fixationTarget !== undefined) out.fixationTarget = String(value.fixationTarget || '');
  return out;
}
function sourcePoint(point) {
  return { id: point.id, threshold: copy(point.threshold), totalDeviation: copy(point.totalDeviation), patternDeviation: copy(point.patternDeviation) };
}
function fromPages(pages, provenance) {
  var ordered = pages.slice().sort(function (a, b) { return a.eye === b.eye ? 0 : a.eye === 'OD' ? -1 : 1; });
  return {
    schema: 'visual-field-source/v1',
    study: { testDate: ordered[0].testDate, pattern: String(ordered[0].pattern || ''), eyes: ordered.map(function (page) { return page.eye; }) },
    provenance: copy(provenance || OCR_PROVENANCE),
    eyes: ordered.map(function (page) {
      var device = page.device || {};
      return { eye: page.eye, ageYears: Number.isInteger(page.ageYears) ? page.ageYears : null,
        testParameters: testParameters(page.testParameters), durationSeconds: Number.isInteger(page.durationSeconds) ? page.durationSeconds : null,
        reliability: { fp: metricOrNotRead(device.fp), fn: metricOrNotRead(device.fn), fl: metricOrNotRead(device.fl) },
        printout: { md: metricOrNotRead(device.md), psd: metricOrNotRead(device.psd), vfi: metricOrNotRead(device.vfi),
          ght: typeof page.ght === 'string' && page.ght ? page.ght : 'not-read' },
        points: page.points.map(sourcePoint) };
    })
  };
}
function reportEye(sourceEye) {
  var printout = sourceEye.printout || {};
  return { eye: sourceEye.eye, ageYears: sourceEye.ageYears,
    points: sourceEye.points.map(function (point) { return Object.assign(sourcePoint(point), { sourceProbability: 'not-read' }); }),
    device: { md: metricOrNotRead(printout.md), psd: metricOrNotRead(printout.psd), vfi: metricOrNotRead(printout.vfi),
      fp: copy(sourceEye.reliability.fp), fn: copy(sourceEye.reliability.fn), fl: copy(sourceEye.reliability.fl) },
    testParameters: testParameters(sourceEye.testParameters), durationSeconds: sourceEye.durationSeconds };
}
// Unread reliability indices enter the worker as 0 (the conventional layer ignores them; the Bayesian
// artifact scores treat 0 as "no artifact evidence"); eligibility decides whether analysis runs at all.
function fraction(metric, divisor) { return metric && metric.state === 'read' ? metric.value / divisor : 0; }
function analysisInput(sourceEye) {
  return { eye: sourceEye.eye, ageYears: sourceEye.ageYears, fp: fraction(sourceEye.reliability.fp, 100),
    fn: fraction(sourceEye.reliability.fn, 100), fl: fraction(sourceEye.reliability.fl, 1),
    thresholds: sourceEye.points.map(function (point) { return copy(point.threshold); }), testOrdinalConfirmed: false };
}
function serialize(doc) { return new TextEncoder().encode(JSON.stringify(doc)); }

var api = Object.freeze({ OCR_PROVENANCE: OCR_PROVENANCE, fromPages: fromPages, reportEye: reportEye,
  analysisInput: analysisInput, serialize: serialize });
export { api, api as 'module.exports' };
