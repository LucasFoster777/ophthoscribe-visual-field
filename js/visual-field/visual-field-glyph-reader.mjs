// [Active · lazy 'pipeline' group] raster-glyph reader: the protocol's second reader for DRAWN items (TD/PD probability
// glyphs). Deterministic by construction — integer pixel counts on a page rendered at a fixed integer scale; no OCR.
// Spec: 2026-08-27-visual-field-source-registration-design.md §4 (glyph reader) / ruling 4.
import { api as printoutFieldsApi } from './visual-field-printout-fields.mjs';
function fields() { return printoutFieldsApi; }
// image: { data: Uint8ClampedArray (RGBA), width, height } of the WHOLE page at `scale` px per PDF point (y-down).
function createGlyphReader(options) {
  var image = options && options.image, scale = options && options.scale;
  if (!image || !image.data || !(scale > 0) || scale !== Math.floor(scale)) throw new Error('Glyph reader needs an image and an integer scale.');
  function read(rect) {
    var x0 = Math.round(rect.x * scale), y0 = Math.round(rect.y * scale), w = Math.round(rect.w * scale), h = Math.round(rect.h * scale);
    if (w <= 0 || h <= 0 || x0 < 0 || y0 < 0 || x0 + w > image.width || y0 + h > image.height) return '';
    var crop = new Uint8ClampedArray(w * h * 4);
    for (var y = 0; y < h; y += 1) {
      var src = ((y0 + y) * image.width + x0) * 4, dst = y * w * 4;
      crop.set(image.data.subarray(src, src + w * 4), dst);
    }
    var inset = Math.max(1, scale); // ignore the printed cell border
    var fraction = fields().inkFraction(crop, w, h, inset, inset), cls = fields().classifyProbability(fraction);
    return cls === 'absent' ? '' : cls;
  }
  return Object.freeze({ read: read });
}
var RENDER_SCALE = 2; // px per PDF point; the classifier bands in printout-fields were derived at this scale
var api = Object.freeze({ createGlyphReader: createGlyphReader, RENDER_SCALE: RENDER_SCALE });
export { api, api as 'module.exports' };
