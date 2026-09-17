// [Active · lazy 'pipeline' group] The text-layer reader: PDF.js text items normalised to y-down glyph boxes, then
// rect → raw string by item centre. Exact, ~microseconds per region. Spec §4.4.
function normalize(textContent, viewportHeight) {
  var out = [];
  (textContent && textContent.items || []).forEach(function (item) {
    if (!item || typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) return;
    var x = item.transform[4], baseline = viewportHeight - item.transform[5], w = Number(item.width) || 0, h = Number(item.height) || 0;
    out.push({ str: item.str, x: x, y: baseline - h, w: w, h: h, cx: x + w / 2, cy: baseline - h / 2 });
  });
  return out;
}
function inside(item, rect, tolerance) {
  return item.cx >= rect.x - tolerance && item.cx <= rect.x + rect.w + tolerance &&
    item.cy >= rect.y - tolerance && item.cy <= rect.y + rect.h + tolerance;
}
function createTextLayerReader(items) {
  return Object.freeze({
    read: function (rect, tolerance) {
      var hits = items.filter(function (item) { return inside(item, rect, tolerance || 0); });
      hits.sort(function (a, b) { return a.cy - b.cy > 3 ? 1 : b.cy - a.cy > 3 ? -1 : a.cx - b.cx; });
      return hits.map(function (item) { return item.str.trim(); }).join(' ').replace(/\s+/g, ' ').trim();
    }
  });
}
function hasText(items) { return Array.isArray(items) && items.length > 0; }
var api = Object.freeze({ normalize: normalize, createTextLayerReader: createTextLayerReader, hasText: hasText });
export { api, api as 'module.exports' };
