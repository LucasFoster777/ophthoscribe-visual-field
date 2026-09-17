// [Active] Normative-surface LOADER (two-lane spec §5, P4 Task 1 — datasets are data, not code): the table lives in
// data/directories/visual-field/datasets/<id>.v<major>.json and reaches the analysis worker inside the request
// message — nothing is fetched or baked here. `fromDataset(doc)` builds the surface the analysis core consumes
// (`forEye`, `coordinates`, `BLIND`, `ROW_COUNTS`, `PROVENANCE`); `validate(doc)` is the write gate for custom
// datasets. Point stats: ageIntercept dB, slope dB/year, sdTd, sdPd, tdCutoffs / pdCutoffs [p0.5, p1, p5] or null;
// a blind-spot point may carry null stats (borrowed from its y-mirror so no consumer sees NaN; both blind points
// are excluded from analysis anyway). Coordinates are OD-convention (xOd); the OS point at the same printout
// index mirrors x. The operator-accepted provenance (Lucas 2026-08-16) rides verbatim on the artifact and is
// enforced by scripts/check-visual-field-production.mjs.
// Node-only prerequisite loader (spec §4.3): resolved through the builtin module registry, never a static
// `node:` import a browser would fetch; null in the browser.
var nodeRequire = typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
  ? process.getBuiltinModule('node:module').createRequire(import.meta.url) : null;
var SCHEMA = 'ophthoscribe.visual-field-dataset.v1';
var SHIPPED = 'data/directories/visual-field/datasets/ophthoscribe-24-2-normative-lf.v1.json';
var STATS = ['ageIntercept', 'slope', 'sdTd', 'sdPd'];
function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function cutoffsOk(c) { return c === null || (Array.isArray(c) && c.length === 3 && c.every(Number.isFinite)); }
function idOf(index) { return 'p' + String(index).padStart(2, '0'); }
function validate(doc) {
  var errors = [];
  if (!plain(doc)) return { ok: false, errors: ['dataset document must be an object'] };
  if (doc.schema !== SCHEMA) errors.push('dataset schema must be ' + SCHEMA);
  ['id', 'version', 'pattern'].forEach(function (key) { if (typeof doc[key] !== 'string' || !doc[key]) errors.push('dataset ' + key + ' must be a non-empty string'); });
  if (!plain(doc.provenance)) errors.push('dataset provenance must be an object');
  if (!plain(doc.blindSpot) || !Array.isArray(doc.blindSpot.OD) || !Array.isArray(doc.blindSpot.OS)) errors.push('dataset blindSpot must carry OD and OS id lists');
  if (!Array.isArray(doc.points) || doc.points.length !== 54) { errors.push('dataset must carry 54 points'); return { ok: false, errors: errors }; }
  if (errors.length) return { ok: false, errors: errors };
  var blind = new Set(doc.blindSpot.OD.concat(doc.blindSpot.OS)), seen = new Set();
  doc.points.forEach(function (p, index) {
    var at = 'point ' + (plain(p) && p.id ? p.id : '#' + index);
    if (!plain(p) || p.id !== idOf(index)) { errors.push(at + ' must carry id ' + idOf(index) + ' in printout order'); return; }
    if (seen.has(p.id)) errors.push(at + ' duplicate id'); seen.add(p.id);
    if (!Number.isFinite(p.xOd) || !Number.isFinite(p.y)) errors.push(at + ' needs finite xOd and y');
    var unmodelled = STATS.every(function (key) { return p[key] === null; });
    if (unmodelled) { if (!blind.has(p.id)) errors.push(at + ' null stats are allowed only on a blind-spot point'); }
    else STATS.forEach(function (key) { if (!Number.isFinite(p[key])) errors.push(at + ' ' + key + ' must be a finite number'); });
    if (!cutoffsOk(p.tdCutoffs) || !cutoffsOk(p.pdCutoffs)) errors.push(at + ' cutoffs must be [p0.5, p1, p5] or null');
  });
  return { ok: errors.length === 0, errors: errors };
}
function fromDataset(doc) {
  var verdict = validate(doc);
  if (!verdict.ok) throw new Error('Visual-field dataset is invalid: ' + verdict.errors[0]);
  var rows = [], ys = [], byY = {}, lookup = {};
  doc.points.forEach(function (p) {
    if (!byY[p.y]) { byY[p.y] = []; rows.push(byY[p.y]); ys.push(p.y); }
    byY[p.y].push(p.xOd); lookup[p.xOd + ',' + p.y] = p;
  });
  var blindIndex = function (ids) { return ids.map(function (id) { return Number(id.slice(1)); }); };
  var BLIND = Object.freeze({ OD: blindIndex(doc.blindSpot.OD), OS: blindIndex(doc.blindSpot.OS) });
  function coordinates(eye) {
    var out = [];
    rows.forEach(function (row, rowIndex) {
      var values = eye === 'OS' ? row.slice().reverse() : row;
      values.forEach(function (x) { out.push({ xOd: x, y: ys[rowIndex] }); });
    });
    return out;
  }
  function pointStats(age, coordinate) {
    // xOd is the anatomical (OD-convention) x for BOTH eyes — coordinates('OS') mirrors each row — so the table is
    // looked up by (xOd, y), never by printout index. An unmodelled blind point borrows its y-mirror.
    var p = lookup[coordinate.xOd + ',' + coordinate.y];
    if (p.ageIntercept === null) p = lookup[coordinate.xOd + ',' + (-coordinate.y)] || p;
    var cut = function (c) { return c ? { p0_5: c[0], p1: c[1], p5: c[2] } : null; };
    return { mean: p.ageIntercept + p.slope * age, sd: p.sdTd, sdPd: p.sdPd, tdCutoffs: cut(p.tdCutoffs), pdCutoffs: cut(p.pdCutoffs) };
  }
  function forEye(eye, age) {
    if (eye !== 'OD' && eye !== 'OS') throw new Error('Analysis eye is invalid.');
    if (!Number.isFinite(age) || age < 0 || age > 130) throw new Error('Analysis age is invalid.');
    var blind = new Set(BLIND[eye]);
    return coordinates(eye).map(function (coordinate, index) {
      var eccentricity = Math.sqrt(coordinate.xOd * coordinate.xOd + coordinate.y * coordinate.y);
      return Object.assign({ id: idOf(index), blind: blind.has(index), eccentricity: eccentricity }, coordinate, pointStats(age, coordinate));
    });
  }
  return Object.freeze({ id: doc.id, version: doc.version, pattern: doc.pattern, PROVENANCE: Object.freeze(Object.assign({}, doc.provenance)), BLIND: BLIND,
    ROW_COUNTS: rows.map(function (row) { return row.length; }), coordinates: coordinates, forEye: forEye });
}
// Node only (scripts, adapters, tests): the shipped artifact. The browser never calls this — the dev group resolves
// the dataset through the directories and posts it to the worker.
function shippedDataset() {
  if (!nodeRequire) throw new Error('shippedDataset is node-only; pass the dataset in.');
  return nodeRequire('../../' + SHIPPED);
}
var api = Object.freeze({ SCHEMA: SCHEMA, SHIPPED_DATASET_PATH: SHIPPED, validate: validate, fromDataset: fromDataset, shippedDataset: shippedDataset });
export { api, api as 'module.exports' };
