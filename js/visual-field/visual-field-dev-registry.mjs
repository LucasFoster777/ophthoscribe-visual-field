// [Active · lazy 'dev' group] The development extension registry (two-lane spec §5, P4): ENGINES compute a test's
// analysis (`run(input, dataset) → Promise<{ result, overlays }>` — one computed block per run, prior blocks kept) and
// DISPLAY LAYERS present overlay payloads in Dev View (`slot: tab | panel | grid-overlay`, `render(host, eyeReport,
// block, hooks)`). Built-ins register at load: the conventional engine over the analysis worker, and the Bayesian tab
// layer over `overlays.bayesian` — the posterior's home on the computed block. View never loads this group.
// Cycle break (DELIV-03 VF migration): dev-analysis imports this module, so the group entry binds it here.
var devAnalysisApi = null;
export function bind(deps) { devAnalysisApi = deps.devAnalysis; }
var SLOTS = ['tab', 'panel', 'grid-overlay'];
var engines = {}, layers = {};
function registerEngine(engine) {
  if (!engine || typeof engine.id !== 'string' || !engine.id || typeof engine.run !== 'function') throw new Error('An engine needs an id and a run(input, dataset) function.');
  if (engines[engine.id]) throw new Error('Engine already registered: ' + engine.id);
  engines[engine.id] = Object.freeze({ id: engine.id, version: String(engine.version || ''), run: engine.run });
}
function registerLayer(layer) {
  if (!layer || typeof layer.id !== 'string' || !layer.id || typeof layer.render !== 'function') throw new Error('A layer needs an id and a render(host, eyeReport, block, hooks) function.');
  if (SLOTS.indexOf(layer.slot) < 0) throw new Error('A layer slot must be one of ' + SLOTS.join(', '));
  if (layers[layer.id]) throw new Error('Layer already registered: ' + layer.id);
  layers[layer.id] = Object.freeze({ id: layer.id, label: String(layer.label || layer.id), slot: layer.slot, render: layer.render });
}
function engine(id) { return engines[id] || null; }
function list(map) { return Object.keys(map).map(function (id) { return map[id]; }); }
function layersOf(slot) { return list(layers).filter(function (l) { return !slot || l.slot === slot; }); }

// Built-in engine: the in-house conventional model (the analysis worker over the measured thresholds and the dataset).
registerEngine({ id: 'conventional', version: 'ophthoscribe-vf-24-2@2.0.0', run: function (input, dataset) {
  return devAnalysisApi.analyze(input, dataset).then(function (reply) { return { result: reply.result, overlays: reply.overlays || {} }; });
} });
// Built-in layer: the Bayesian block — the posterior map and its MD, appended to Dev View's tabless workspace.
registerLayer({ id: 'bayesian', label: 'Bayesian', slot: 'tab', render: function (host, eyeReport, block, hooks) {
  var b = eyeReport.bayesian; if (!b) return;
  var copy = hooks.el('div', 'vf-bayesian-copy'); copy.textContent = 'Posterior MD ' + Number(b.posteriorMd.mean).toFixed(1) + ' dB';
  host.append(copy, hooks.map({ eye: eyeReport.eye, points: eyeReport.points.map(function (point, i) {
    return Object.assign({}, point, { threshold: { value: b.values[i], state: b.values[i] === null || b.values[i] === undefined ? 'not-read' : 'read' } });
  }) }, 'bayesian'));
} });

var api = Object.freeze({ registerEngine: registerEngine, registerLayer: registerLayer, engine: engine, engines: function () { return list(engines); }, layers: layersOf, SLOTS: SLOTS });
export { api, api as 'module.exports' };
