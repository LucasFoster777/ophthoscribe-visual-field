// [Active] Lazy worker boundary for qualified analysis and deterministic grayscale bytes (rendered from the measured
// thresholds). The request carries the normative DATASET document (P4: nothing is fetched or baked in the worker);
// the reply carries the engine result and its display overlays (Bayesian's home on the computed block).
// Import maps do not reach workers: the closure is imported once with this worker's own stamped query.
const query = self.location && self.location.search || '';
const closure = import(new URL('./analysis-worker-closure.mjs' + query, self.location.href).href);
function hex(bytes) { return Array.from(bytes).map(function (value) { return value.toString(16).padStart(2, '0'); }).join(''); }
function overlaysOf(result) {
  var b = result.bayesian;
  return { bayesian: { modelId: b.modelId, modelVersion: b.modelVersion, posteriorMd: b.posteriorMd, values: b.values, probabilities: b.probabilities, diagnostics: b.diagnostics } };
}
self.onmessage = function (event) {
  var request = event.data || {}, started = Date.now();
  closure.then(function (deps) {
    if (request.validate !== undefined) { self.postMessage({ id: request.id, ok: true, verdict: deps.normative.validate(request.validate) }); return; }
    var result = deps.analysisCore.analyze(request.input, request.dataset), overlays = overlaysOf(result);
    delete result.bayesian;   // the posterior is a display overlay on the computed block, not a conventional value
    var coordinates = deps.normative.fromDataset(request.dataset).coordinates(request.input.eye);
    var grayscale = deps.png.render(request.input.thresholds, request.input.eye, coordinates);   // measured thresholds, never the posterior
    return self.crypto.subtle.digest('SHA-256', grayscale.png).then(function (digest) {
      if (Date.now() - started > 1000) throw new Error('Visual-field analysis exceeded one second.');
      self.postMessage({ id: request.id, ok: true, result: result, overlays: overlays, grayscale: {
        width: grayscale.width, height: grayscale.height, sha256: hex(new Uint8Array(digest)), bytes: grayscale.png.buffer
      } }, [grayscale.png.buffer]);
    });
  }).catch(function () {
    self.postMessage({ id: request.id, ok: false, error: 'Structured visual-field analysis failed.' });
  });
};
