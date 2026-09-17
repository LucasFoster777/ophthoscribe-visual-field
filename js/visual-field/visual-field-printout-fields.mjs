// [Active · lazy 'pipeline' group] P2 printout field readers: the protocol parsers (text → typed cell | NOT_PRESENT |
// NOT_EXTRACTED), the probability-glyph classifier (ink fraction bands) and the ink-geometry detectors (minus sign,
// lone dash, chevron). Pure — no DOM, no OCR; the pipeline hands it text and image data. Every vocabulary (strategy,
// GHT, sex, eye, pattern, probability) resolves through the loaded directories on the provider seam's `directories` slot
// (native-entity spec §4/§8.3) — no table of clinical tokens lives here.
import { api as recordApi } from './visual-field-record.mjs';
import { get as providerGet } from './visual-field-provider.mjs';
function rec() { return recordApi; }
function directories() {
  var d = providerGet('directories');
  if (!d) throw new Error('visual-field directories are not loaded');
  return d;
}
var MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

// token(vocabulary, text) → the directory id whose alias the text contains (longest alias wins), else NOT_EXTRACTED.
function token(name, text) { var id = directories().resolve(name, text); return id ? { value: id } : rec().NOT_EXTRACTED; }
function isoDate(text) {
  var iso = /\b(20\d{2}|19\d{2})[-/]([01]\d)[-/]([0-3]\d)\b/.exec(text);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var named = /\b([A-Z][a-z]{2})\s+(\d{1,2}),\s*((?:19|20)\d{2})\b/.exec(text);
  return named && MONTHS[named[1]] ? named[3] + '-' + MONTHS[named[1]] + '-' + String(named[2]).padStart(2, '0') : '';
}
// A printed significance (`P < 5%`) → the probability directory's token, '' when the printout's level is not one.
function probability(text) {
  var match = /P\s*<\s*(\d+(?:\.\d+)?)\s*%/i.exec(text);
  return match ? directories().resolve('probability', 'p<' + match[1] + '%') || '' : '';
}
function dark(data, index) { return (data[index * 4] + data[index * 4 + 1] + data[index * 4 + 2]) / 3 < 128; }
function inkFraction(data, width, height, insetX, insetY) {
  var ink = 0, total = 0;
  for (var y = insetY; y < height - insetY; y += 1) for (var x = insetX; x < width - insetX; x += 1) { total += 1; if (dark(data, y * width + x)) ink += 1; }
  return total ? ink / total : 0;
}
// Bands re-derived 2026-08-27 from the real Zeiss FORUM Overview glyphs (both zeiss_multi fixtures, every TD/PD cell,
// scale 2, inset 2): dot 0.01 · "::" 0.06 · light hatch 0.23–0.26 · dark hatch 0.49–0.54 · solid 0.72–0.81. Cuts sit at
// the cluster midpoints. The earlier 0.08/0.38/0.62/0.88 cuts came from a synthetic printout and read "::" as normal.
// The bands live on the probability directory entries (`glyphInkMax`, ascending); a level without one (p<10%) is
// printed as text only. Below BLANK_INK the cell is blank → 'absent'.
var BLANK_INK = 0.005;
function classifyProbability(fraction) {
  if (fraction < BLANK_INK) return 'absent';
  var levels = (directories().vocabulary('probability') || []).filter(function (e) { return typeof e.glyphInkMax === 'number'; })
    .sort(function (a, b) { return a.glyphInkMax - b.glyphInkMax; });
  var hit = levels.find(function (e) { return fraction < e.glyphInkMax; }) || levels[levels.length - 1];
  return hit ? hit.id : 'absent';
}
// Column ink profile: per column the top/bottom of dark pixels (null when blank).
function columnProfile(data, width, height) {
  var columns = [];
  for (var x = 0; x < width; x += 1) {
    var top = -1, bottom = -1;
    for (var y = 0; y < height; y += 1) if (dark(data, y * width + x)) { if (top < 0) top = y; bottom = y; }
    columns.push(top < 0 ? null : { top: top, bottom: bottom });
  }
  return columns;
}
// A minus sign is the leftmost run of SHORT ink columns (<= 40 % of the tallest column) that is wide (>= 1.5x its
// own height), sits at mid-height of the ink, and is followed by tall (digit) columns. Working on the column
// profile rather than connected components means a dash that touches its digit after thresholding (the real
// 9-pt "-8" does) still reads; a 7's top bar (top of the ink) and a 1's flag (narrow) do not.
function hasLeadingMinus(data, width, height) {
  var columns = columnProfile(data, width, height), first = -1, maxHeight = 0, inkTop = height, inkBottom = -1;
  columns.forEach(function (column, x) {
    if (!column) return;
    if (first < 0) first = x;
    maxHeight = Math.max(maxHeight, column.bottom - column.top + 1); inkTop = Math.min(inkTop, column.top); inkBottom = Math.max(inkBottom, column.bottom);
  });
  if (first < 0) return false;
  var x = first, runTop = height, runBottom = -1, heights = [];
  while (x < width && columns[x] && columns[x].bottom - columns[x].top + 1 <= 0.4 * maxHeight) {
    runTop = Math.min(runTop, columns[x].top); runBottom = Math.max(runBottom, columns[x].bottom); heights.push(columns[x].bottom - columns[x].top + 1); x += 1;
  }
  if (!heights.length) return false;
  // The run's height is its median column height — where the dash meets the digit the last columns grow.
  var runHeight = heights.slice().sort(function (a, b) { return a - b; })[Math.floor(heights.length / 2)];
  var relativeCenter = ((runTop + runBottom) / 2 - inkTop) / Math.max(1, inkBottom - inkTop + 1);
  var tallerFollows = columns.slice(x).some(function (column) { return column && column.bottom - column.top + 1 > 0.5 * maxHeight; });
  // Arial-Bold-class dashes at 9 pt measure ~1.45–1.6x their stroke; the digit-relative centre sits at 0.55–0.65.
  return heights.length >= 4 && heights.length >= 1.3 * runHeight && relativeCenter > 0.25 && relativeCenter < 0.75 && tallerFollows;
}
// A printed `--` (absent point): the only ink is short (<= 20 % of the crop) and at least twice as wide as tall.
// Tesseract returns nothing for a lone `--`, so the cell must be read from its ink.
function isDashOnly(data, width, height) {
  var columns = columnProfile(data, width, height), first = -1, last = -1, maxHeight = 0;
  columns.forEach(function (column, x) {
    if (!column) return;
    if (first < 0) first = x;
    last = x; maxHeight = Math.max(maxHeight, column.bottom - column.top + 1);
  });
  return first >= 0 && maxHeight <= 0.2 * height && last - first + 1 >= 2 * maxHeight;
}
// A printed `<` before the digit (censored `<0`): the leftmost ink component is a chevron — its column heights rise
// gradually (<= 4 px per column) from under 35 % to 50–90 % of the tallest column, then a blank gap, then the digit.
// A digit's own flag (the `1`) jumps to full height in one column and never passes.
function hasLeadingLess(data, width, height) {
  var columns = columnProfile(data, width, height), first = -1, maxHeight = 0;
  columns.forEach(function (column, x) { if (!column) return; if (first < 0) first = x; maxHeight = Math.max(maxHeight, column.bottom - column.top + 1); });
  if (first < 0) return false;
  var x = first, heights = [], maxStep = 0, peak = 0;
  while (x < width && columns[x]) {
    var h = columns[x].bottom - columns[x].top + 1;
    if (heights.length) maxStep = Math.max(maxStep, h - heights[heights.length - 1]);
    heights.push(h); peak = Math.max(peak, h); x += 1;
  }
  var tallerFollows = columns.slice(x).some(function (column) { return column && column.bottom - column.top + 1 > 0.6 * maxHeight; });
  return heights.length >= 12 && heights[0] <= 0.35 * maxHeight && peak >= 0.5 * maxHeight && peak < 0.9 * maxHeight &&
    peak - heights[0] >= 0.35 * maxHeight && maxStep <= 4 && tallerFollows;
}
// --- Protocol parsers (extraction-protocols spec §4.2): named, pure, text → typed cell | NOT_PRESENT | NOT_EXTRACTED.
// A name may carry one argument after a colon (`dbLabelled:MD`). The extractor never calls a parser with empty text.
function stripLabel(text, label) {
  var match = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^:]*:\\s*(.*)$', 'i').exec(text);
  return match ? match[1].trim() : text.trim();
}
function flagged(text) { return /\bXX\b/.test(text); }
var PROTOCOL_PARSERS = {
  text: function (text) { return text.trim() ? { value: text.trim() } : rec().NOT_EXTRACTED; },
  deviationCell: function (text) {
    var value = text.trim();
    if (!value || /^[\u2012-\u2015\u2212-]{1,3}$/.test(value)) return rec().NOT_PRESENT;
    value = value.replace(/^\u2212/, '-');
    return /^[+-]?\d+$/.test(value) ? { value: Number(value), unit: 'dB' } : rec().NOT_EXTRACTED;
  },
  labelledText: function (text, label) { var v = stripLabel(text, label); return v ? { value: v } : rec().NOT_EXTRACTED; },
  isoDate: function (text) { var v = isoDate(text); return v ? { value: v } : rec().NOT_EXTRACTED; },
  // enum:eye | enum:sex — the states directory's vocabularies (eyes keep their clinical OD/OS tokens, matched whole).
  enum: function (text, kind) {
    if (kind === 'eye') { var m = /\b(O[DS])\b/.exec(text); return m && directories().entry('eyes', m[1]) ? { value: m[1] } : rec().NOT_EXTRACTED; }
    if (kind === 'sex') return token('sex', text);
    return rec().NOT_EXTRACTED;
  },
  strategy: function (text) { return token('strategies', text); },
  ght: function (text) { return token('ght', stripLabel(text, 'GHT')); },
  percentLabelled: function (text, label) {
    var m = /(-?\d+(?:\.\d+)?)\s*%/.exec(stripLabel(text, label));
    return m ? { value: Number(m[1]), unit: '%' } : rec().NOT_EXTRACTED;
  },
  dbLabelled: function (text, label) {
    var body = stripLabel(text, label);
    if (/^[-—–]{1,3}(\s|$)/.test(body)) return rec().NOT_PRESENT;
    var m = /([+-]?\d+(?:\.\d+)?)\s*dB/i.exec(body);
    if (!m) return rec().NOT_EXTRACTED;
    var cell = { value: Number(m[1]), unit: 'dB' }, p = probability(body);
    if (p) cell.probability = p;
    return cell;
  },
  // The pattern printed inside a label (`MD24-2:`): a directory pattern whose alias sits in the text, not preceded or
  // followed by another digit (so `124-2` is not `24-2`).
  patternFromLabel: function (text) {
    var found = (directories().vocabulary('patterns') || []).find(function (p) {
      return (p.aliases || []).some(function (alias) { return new RegExp('(?:^|[^0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])', 'i').test(text); });
    });
    return found ? { value: found.id } : rec().NOT_EXTRACTED;
  },
  fovea: function (text) {
    var body = stripLabel(text, 'Fovea');
    if (/^off\b/i.test(body)) return rec().NOT_PRESENT;
    var m = /(-?\d+)\s*dB/i.exec(body); return m ? { value: Number(m[1]), unit: 'dB' } : rec().NOT_EXTRACTED;
  },
  fraction: function (text, label) {
    var m = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(stripLabel(text, label));
    if (!m) return rec().NOT_EXTRACTED;
    // `FL: 0/0` is printed when no fixation checks ran: the ratio is undefined, the counts are real.
    return { value: Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null, numerator: Number(m[1]), denominator: Number(m[2]), excessive: flagged(text) };
  },
  percentFlagged: function (text, label) {
    var m = /(\d{1,3})\s*%/.exec(stripLabel(text, label));
    return m ? { value: Number(m[1]), unit: '%', excessive: flagged(text) } : rec().NOT_EXTRACTED;
  },
  pupilMm: function (text) { var m = /(\d+(?:\.\d+)?)\s*mm(\s*\*)?/i.exec(text); return m ? { value: Number(m[1]), unit: 'mm', flagged: !!m[2] } : rec().NOT_EXTRACTED; },
  flag: function (text, needle) { return text.toLowerCase().indexOf(needle.toLowerCase()) >= 0 ? { value: true } : rec().NOT_EXTRACTED; },
  thresholdCell: function (text) {
    var t = text.replace(/\s+/g, '');
    if (/^<0$/.test(t)) return { value: 0, unit: 'dB', censored: true };
    if (/^-?\d{1,2}$/.test(t)) { var n = Number(t); return n >= -1 && n <= 60 ? { value: n, unit: 'dB' } : rec().NOT_EXTRACTED; }
    return rec().NOT_EXTRACTED;
  },
  // The raster-glyph reader hands over the class string ('' = blank cell → absent); a numeric ink fraction is
  // still accepted so a reader may defer classification to the parser. Classes are the probability directory's ids.
  probabilityGlyph: function (text) {
    var t = String(text || '').trim();
    if (!t) return rec().NOT_PRESENT;
    var level = directories().entry('probability', t);
    if (level && typeof level.glyphInkMax === 'number') return { value: t };  // only a level the plot draws as a glyph
    var fraction = Number(t); if (!isFinite(fraction)) return rec().NOT_EXTRACTED;
    var tier = classifyProbability(fraction); return tier === 'absent' ? rec().NOT_PRESENT : { value: tier };
  },
  version: function (text) { var m = /(\d+(?:\.\d+)+)/.exec(text); return m ? { value: m[1] } : rec().NOT_EXTRACTED; },
  createdAt: function (text) {
    var m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2}:\d{2})/.exec(text);
    return m ? { value: m[3] + '-' + m[1] + '-' + m[2] + 'T' + m[4] } : rec().NOT_EXTRACTED;
  },
  pageOf: function (text) { var m = /Page\s+(\d+)\s+of\s+(\d+)/i.exec(text); return m ? { value: { page: Number(m[1]), of: Number(m[2]) } } : rec().NOT_EXTRACTED; }
};
function parseWith(name, text) {
  var colon = String(name).indexOf(':'), base = colon < 0 ? name : name.slice(0, colon), arg = colon < 0 ? undefined : name.slice(colon + 1);
  var parser = PROTOCOL_PARSERS[base];
  if (!parser) throw new Error('Unknown extraction parser: ' + name);
  return parser(String(text || ''), arg);
}
var api = Object.freeze({ inkFraction: inkFraction, classifyProbability: classifyProbability, hasLeadingMinus: hasLeadingMinus, isDashOnly: isDashOnly,
  hasLeadingLess: hasLeadingLess, parseWith: parseWith, PROTOCOL_PARSER_NAMES: Object.keys(PROTOCOL_PARSERS) });
export { api, api as 'module.exports' };
