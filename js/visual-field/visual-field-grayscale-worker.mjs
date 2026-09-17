// [Active · lazy 'grayscale' worker] Deterministic grayscale PNG from MEASURED thresholds and the pattern's own
// coordinates — the clinic door's rendering. Imports the PNG module only, never the engine closure
// (two-lane spec §4 "never invoked", §7 item 2). Message: { id, eye, thresholds: [{ value, state }…], coordinates: [{ xOd, y }…] }.
// Import maps do not reach workers: the module is imported once with this worker's own stamped query.
const query = self.location && self.location.search || '';
const pngModule = import(new URL('./visual-field-png.mjs' + query, self.location.href).href);
function hex(bytes) { return Array.from(bytes).map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''); }
self.onmessage = function (event) {
  var request = event.data || {};
  pngModule.then(function (mod) {
    var grayscale = mod.api.render(request.thresholds || [], request.eye, request.coordinates || []);
    return self.crypto.subtle.digest('SHA-256', grayscale.png).then(function (digest) {
      self.postMessage({ id: request.id, ok: true, width: grayscale.width, height: grayscale.height, sha256: hex(new Uint8Array(digest)), bytes: grayscale.png.buffer }, [grayscale.png.buffer]);
    });
  }).catch(function () { self.postMessage({ id: request.id, ok: false }); });
};
