// [Active · lazy 'viewer' group] Extraction region overlay — one box per STORED extraction Point with a rect (the test
// entity's `extraction.points`, native-entity spec §5): the region each value was read from, on the page it was read
// from. This module never reads the live protocol, so a test extracted under an older protocol shows ITS regions.
// Percent-of-page boxes so they track the canvas at any CSS size; pageSizes are in pdf points (canvas px / render scale).
function boxes(rec, pageSizes) {
  var points = rec && rec.extraction && Array.isArray(rec.extraction.points) ? rec.extraction.points : [];
  return points.filter(function (p) { return p && p.rect && Number.isFinite(p.rect.x) && Number.isFinite(p.rect.y) && p.page; }).map(function (p) {
    var size = (pageSizes || [])[p.page - 1] || { width: 871, height: 1209 };
    return { fieldId: String(p.id), page: p.page, left: p.rect.x / size.width * 100, top: p.rect.y / size.height * 100,
      width: (p.rect.w || 0) / size.width * 100, height: (p.rect.h || 0) / size.height * 100, rawText: String(p.raw || '') };
  });
}
function wrap(canvas, index) {
  var parent = canvas.parentNode, wrapper = parent && parent.classList && parent.classList.contains('vf-region-page') ? parent : null;
  if (!wrapper) { wrapper = document.createElement('div'); wrapper.className = 'vf-region-page'; parent.insertBefore(wrapper, canvas); wrapper.appendChild(canvas); }
  Array.prototype.slice.call(wrapper.querySelectorAll('.vf-region')).forEach(function (node) { node.remove(); });
  wrapper.setAttribute('data-page', String(index + 1));
  return wrapper;
}
// Draws the record's boxes over the page canvases already rendered into pagesHost (pipeline.renderOriginal order).
function mount(pagesHost, rec, renderScale) {
  var canvases = Array.prototype.slice.call(pagesHost.querySelectorAll('canvas')), scale = renderScale || 1;
  var wrappers = canvases.map(wrap);
  var list = boxes(rec, canvases.map(function (canvas) { return { width: canvas.width / scale, height: canvas.height / scale }; }));
  list.forEach(function (box) {
    var wrapper = wrappers[box.page - 1]; if (!wrapper) return;
    var node = document.createElement('div'); node.className = 'vf-region';
    node.setAttribute('data-field-id', box.fieldId); node.title = box.fieldId + ' · ' + box.rawText;
    node.style.left = box.left + '%'; node.style.top = box.top + '%'; node.style.width = box.width + '%'; node.style.height = box.height + '%';
    wrapper.appendChild(node);
  });
  return list.length;
}
var api = Object.freeze({ boxes: boxes, mount: mount });
export { api, api as 'module.exports' };
