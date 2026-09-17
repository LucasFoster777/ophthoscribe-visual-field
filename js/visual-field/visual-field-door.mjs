// [Active · lazy 'viewer' group] The two doors (two-lane spec §4): one display grammar, values from ONE analysis
// block. View = the printed block (device-origin only); Dev View = the newest computed block. Pure over a
// visual-field-test entity; the viewer renders the eye report it returns without knowing which door opened it.
// `options.blockIndex` picks among the computed blocks (recompute keeps history, P4); `bayesian` reads the block's
// `overlays.bayesian` — the posterior's home — into the viewer's shape.
// The printed reliability indices and printed globals ALWAYS ride on `device` — Dev View shows them beneath the
// computed values so the two can be compared (Lucas, 2026-08-28).
var ABSENCE = { view: 'Not extracted', dev: 'No in-house normative established' };
function typed(cell) { return cell && typeof cell.state !== 'string' && cell.value !== undefined ? cell : null; }
function num(cell) { var c = typed(cell); return c && Number.isFinite(Number(c.value)) ? Number(c.value) : null; }
function blocksOf(test, origin) { return (test && test.analyses || []).filter(function (b) { return b && b.origin === origin; }); }
function blockOf(test, origin) { var blocks = blocksOf(test, origin); return blocks.length ? blocks[blocks.length - 1] : null; }
function computedAt(test, index) {
  var blocks = blocksOf(test, 'computed'), i = Number.isInteger(index) && index >= 0 && index < blocks.length ? index : blocks.length - 1;
  return { block: blocks.length ? blocks[i] : null, index: blocks.length ? i : -1 };
}
function metric(cell) { var c = typed(cell); return c ? { state: 'read', value: Number(c.value) } : { state: 'not-read' }; }
function ratio(cell) { var c = cell && typeof cell.state !== 'string' ? cell : null; return c && Number.isInteger(c.numerator) && Number.isInteger(c.denominator) ? { state: 'read', numerator: c.numerator, denominator: c.denominator } : { state: 'not-read' }; }
// Each door is one explicit provenance layer. Source View never borrows a computed
// value to fill a printed absence, and Dev View never disguises a printed fallback.
var ORDER = { view: ['printed'], dev: ['computed'] };
function fill(blocks, read) {
  for (var i = 0; i < blocks.length; i += 1) { var value = blocks[i] ? read(blocks[i]) : null; if (value !== null) return { value: value, origin: blocks[i].origin }; }
  return { value: null, origin: null };
}
function scalar(blocks, key) { return fill(blocks, function (b) { return num(b.values[key]); }); }
function perPoint(blocks, count, read) {
  var values = [], origins = [];
  for (var i = 0; i < count; i += 1) { var f = fill(blocks, function (b) { return b.values.points[i] ? read(b.values.points[i]) : null; }); values.push(f.value); origins.push(f.origin); }
  return { values: values, origins: origins };
}
function cellState(cell) {
  if (typed(cell)) return 'read';
  return cell && cell.state === 'not-extracted' ? 'not-extracted' : 'not-present-in-source';
}
function pointStates(block, count, key) {
  var points = block && block.values && block.values.points || [];
  return Array.from({ length: count }, function (_, i) { return cellState(points[i] && points[i][key]); });
}
function availability(states) {
  if (states.indexOf('read') >= 0) return 'read';
  return states.indexOf('not-extracted') >= 0 ? 'not-extracted' : 'not-present-in-source';
}
// Display lattice from the pattern's own grid (degrees-od-normalized; OS mirrors x, as the grayscale does): the
// 1-based CSS grid column of every point and the column count — the viewer lays any pattern (24-2, 30-2, …) with it.
function layoutOf(test) {
  var grid = test.measurement.grid && test.measurement.grid.points || [], eye = test.measurement.eye;
  if (!grid.length) return null;
  var axis = function (values) {
    var unique = values.slice().sort(function (a, b) { return a - b; }).filter(function (x, i, arr) { return i === 0 || x !== arr[i - 1]; });
    var pitch = unique.length > 1 ? unique[1] - unique[0] : 1, min = unique[0];
    return { tracks: Math.round((unique[unique.length - 1] - min) / pitch) + 1,
      at: values.map(function (value) { return Math.round((value - min) / pitch) + 1; }) };
  };
  var x = axis(grid.map(function (p) { return eye === 'OS' ? -p.x : p.x; }));
  var y = axis(grid.map(function (p) { return -p.y; }));
  if (test.testDefinition.pattern === '24-2') { if (eye === 'OS') x.at = x.at.map(function (column) { return column + 1; }); x.tracks = 10; }
  return { columns: x.tracks, rows: y.tracks, columnOf: x.at, rowOf: y.at };
}
function tier(p, key) { var c = typed(p[key]); return c ? String(c.value) : null; }
function eyeReportFrom(test, door, options) {
  var chosen = computedAt(test, options && options.blockIndex), printed = blockOf(test, 'printed'), computed = chosen.block, r = test.measurement.reliability || {};
  var overlays = door === 'dev' && computed && computed.overlays ? computed.overlays : {}, posterior = overlays.bayesian;
  var blocks = ORDER[door === 'dev' ? 'dev' : 'view'].map(function (origin) { return origin === 'printed' ? printed : computed; });
  var points = test.measurement.points.map(function (p) {
    var c = typed(p.threshold), absent = !!(p.threshold && p.threshold.state === 'not-present-in-source');
    var threshold = c ? { value: Number(c.value), state: 'read' } : { value: null, state: 'not-read' };
    if (c && c.censored) threshold.censored = true;
    return { id: p.id, threshold: threshold, absent: absent, sourceProbability: 'not-read' };
  });
  var md = scalar(blocks, 'md'), psd = scalar(blocks, 'psd'), vfi = scalar(blocks, 'vfi'), ght = printed && typed(printed.values.ght);
  var td = perPoint(blocks, points.length, function (p) { return num(p.totalDeviation); }), pd = perPoint(blocks, points.length, function (p) { return num(p.patternDeviation); });
  var tdp = perPoint(blocks, points.length, function (p) { return tier(p, 'totalDeviationProbability'); }), pdp = perPoint(blocks, points.length, function (p) { return tier(p, 'patternDeviationProbability'); });
  var active = blocks[0] || null;
  var mapStates = { totalDeviation: pointStates(active, points.length, 'totalDeviation'), patternDeviation: pointStates(active, points.length, 'patternDeviation'),
    totalDeviationProbability: pointStates(active, points.length, 'totalDeviationProbability'), patternDeviationProbability: pointStates(active, points.length, 'patternDeviationProbability') };
  var mapAvailability = { totalDeviation: availability(mapStates.totalDeviation), patternDeviation: availability(mapStates.patternDeviation),
    totalDeviationProbability: availability(mapStates.totalDeviationProbability), patternDeviationProbability: availability(mapStates.patternDeviationProbability) };
  var unread = test.measurement.points.some(function (p) { return cellState(p.threshold) === 'not-extracted'; }) ||
    Object.keys(mapStates).some(function (key) { return mapStates[key].indexOf('not-extracted') >= 0; });
  return { eye: test.measurement.eye, ageYears: num(test.acquisition.ageYears), door: door, valuesOrigin: door === 'dev' ? 'computed' : 'printed', absence: ABSENCE[door],
    engine: computed ? String(computed.engineVersion || '') : '',
    dataset: computed && computed.datasetId ? String(computed.datasetId) + '@' + String(computed.datasetVersion) : '',
    hasComputed: !!computed, points: points, ght: ght ? String(ght.value) : null, layout: layoutOf(test), mapStates: mapStates,
    mapAvailability: mapAvailability, extractionWarning: unread,
    block: computed ? { index: chosen.index, engine: String(computed.engineVersion || ''), dataset: String(computed.datasetId) + '@' + String(computed.datasetVersion), computedAt: String(computed.computedAt || '') } : null,
    overlays: overlays,
    device: { md: metric(printed && printed.values.md), psd: metric(printed && printed.values.psd), vfi: metric(printed && printed.values.vfi), fp: metric(r.fp), fn: metric(r.fn), fl: ratio(r.fl) },
    conventional: { md: md.value, psd: psd.value, vfi: vfi.value, values: td.values, patternValues: pd.values,
      probabilities: tdp.values.map(function (v) { return v === null ? 'not-read' : v; }), patternProbabilities: pdp.values.map(function (v) { return v === null ? 'not-read' : v; }) },
    origins: { md: md.origin, psd: psd.origin, vfi: vfi.origin, values: td.origins, patternValues: pd.origins, probabilities: tdp.origins, patternProbabilities: pdp.origins },
    bayesian: posterior && posterior.posteriorMd && Array.isArray(posterior.values) ? { posteriorMd: posterior.posteriorMd, values: posterior.values, probabilities: posterior.probabilities || null } : null };
}
// View exists only where a device block can exist (the clinic lane); every Dev View door answers to the flag.
function doorsFor(item, devEnabled) { return { view: !!item && item.lane === 'clinic', dev: !!devEnabled }; }
// Development preferences are available before the Settings presentation loads.
function devViewEnabled() { return true; }
var api = Object.freeze({ blockOf: blockOf, computedBlocksOf: function (test) { return blocksOf(test, 'computed'); }, eyeReportFrom: eyeReportFrom, doorsFor: doorsFor, devViewEnabled: devViewEnabled, ABSENCE: ABSENCE });
export { api, api as 'module.exports' };
