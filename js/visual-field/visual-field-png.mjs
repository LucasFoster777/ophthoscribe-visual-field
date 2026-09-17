// [Active] Deterministic uncompressed PNG encoder and the visual-field grayscale renderer (measured thresholds in, PNG out).
function u32(value) { return Uint8Array.of(value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255); }
function concat(parts) {
  var length = parts.reduce(function (sum, part) { return sum + part.length; }, 0), out = new Uint8Array(length), offset = 0;
  parts.forEach(function (part) { out.set(part, offset); offset += part.length; }); return out;
}
function crc32(bytes) {
  var crc = 0xffffffff;
  for (var i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]; for (var bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  var a = 1, b = 0;
  for (var i = 0; i < bytes.length; i += 1) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function chunk(type, data) {
  var name = new TextEncoder().encode(type), body = concat([name, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}
function deflate(raw) {
  var parts = [Uint8Array.of(0x78, 0x01)], offset = 0;
  while (offset < raw.length) {
    var size = Math.min(65535, raw.length - offset), final = offset + size === raw.length ? 1 : 0;
    parts.push(Uint8Array.of(final, size & 255, size >>> 8, (~size) & 255, ((~size) >>> 8) & 255));
    parts.push(raw.slice(offset, offset + size)); offset += size;
  }
  parts.push(u32(adler32(raw))); return concat(parts);
}
var SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
function encode(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('RGBA size is invalid.');
  var raw = new Uint8Array(height * (1 + width * 4));
  for (var y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  var header = concat([u32(width), u32(height), Uint8Array.of(8, 6, 0, 0, 0)]);
  return concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array())]);
}
// 2-bit indexed PNG (colour type 3, PLTE + tRNS) for the three-tone grayscale: ~16× smaller than
// RGBA with the same stored (uncompressed) deflate, still byte-deterministic.
function encodeIndexed(width, height, indices, palette) {
  if (indices.length !== width * height || palette.length > 4) throw new Error('Indexed image is invalid.');
  var stride = Math.ceil(width / 4), raw = new Uint8Array(height * (1 + stride)), plte = new Uint8Array(palette.length * 3), trns = new Uint8Array(palette.length);
  palette.forEach(function (entry, i) { plte[i * 3] = entry[0]; plte[i * 3 + 1] = entry[1]; plte[i * 3 + 2] = entry[2]; trns[i] = entry[3]; });
  for (var y = 0; y < height; y += 1) for (var x = 0; x < width; x += 1) {
    raw[y * (1 + stride) + 1 + (x >> 2)] |= indices[y * width + x] << (6 - 2 * (x & 3));
  }
  var header = concat([u32(width), u32(height), Uint8Array.of(2, 3, 0, 0, 0)]);
  return concat([SIGNATURE, chunk('IHDR', header), chunk('PLTE', plte), chunk('tRNS', trns), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array())]);
}
// ── Grayscale renderer: exact port of Lucas Foster's vf_grayscale.py (reference/visual-field-analysis/
// model/probabilistic_vf/Grayscalemaker) with the clustered-dot tile from fractal_tiles.html. Everything
// the picture needs is a constant here — the only input is the 54 measured thresholds + eye.
//   quadrant grids (11 rows × 13 wide side / 11 narrow side, stairstep envelope masks), Gaussian
//   interpolation between test points (sigma 1.2 cells, radius 2.5), dB → tone through a smoothstep
//   blend, 16×16 clustered-dot (dual-cosine) threshold matrix per cell, Zeiss-style meridian bands,
//   axes and ticks, transparent outside the envelope. Output 384×352 RGBA.
var TILE = 16, DB_WHITE = 31, S_CURVE = 0.40, LEVELS = 256, SIGMA = 1.2, RADIUS = 2.5;
var WIDE_W = 13, NARROW_W = 11, HEMI_H = 11, FULL_W = WIDE_W + NARROW_W, FULL_H = HEMI_H * 2;
var COL_START = { 3: 0, 9: 3, 15: 6, 21: 9, 27: 12 }, ROW_START = { 3: 0, 9: 3, 15: 6, 21: 9 };
var WIDE_MAX_COL = [12, 12, 11, 10, 10, 9, 7, 7, 5, 4, 4], NARROW_MAX_COL = [10, 10, 10, 10, 10, 9, 7, 7, 5, 4, 4];
// 16×16 clustered-dot threshold matrix (dual-cosine spot function, period 8, from Lucas Foster's
// fractal_tiles.html), baked as data so no transcendental runs at render time and every engine
// and language produces the same tile: pixel (x, y) turns white once MATRIX[y][x] < threshold.
var MATRIX = [
  [  0,  20, 164, 223, 253, 218, 125,  38,   4,  30,  84, 235, 255, 228, 160,  13],
  [ 32,  46, 134, 185, 232, 212, 102,  61,   9,  54, 168, 196, 240, 191, 132,  70],
  [129, 181, 111, 158,  94, 136,  73, 116, 165,  96, 144,  80, 123, 171, 105, 150],
  [226, 207,  87,  57,  39,  51, 156, 192, 238, 186, 115,  67,  15,  60,  81, 200],
  [248, 234, 172,  16,   6,  11, 126, 246, 251, 242,  95,  28,   1,  21, 161, 222],
  [244, 193, 145,  41,  23,  68, 103, 208, 220, 202, 183,  52,  33,  44, 133, 184],
  [138,  75, 117, 163,  99, 141,  82, 120, 173, 107, 151,  88, 127, 176, 112, 155],
  [ 18,  66,  91, 203, 216, 198, 162,  48,  29,  42, 124, 214, 225, 209,  85,  58],
  [  2,  25, 180, 229, 254, 221, 139,   8,   5,  35,  97, 239, 249, 233, 175,  17],
  [ 36,  49, 149, 190, 236, 215, 113,  64,  12,  59,  72, 199, 243, 194, 147,  43],
  [142,  79, 121, 169, 106, 153,  86, 131, 177, 109, 157,  90, 140,  76, 118, 167],
  [230, 210,  98,  62,  10,  56, 174, 195, 241, 188, 128,  71,  19,  65,  92, 204],
  [250, 237,  74,  22,   7,  14, 143, 217, 252, 245, 108,  31,   3,  26, 182, 227],
  [247, 197, 159,  45,  27,  40, 114, 213, 224, 205,  83,  55,  37,  50, 148, 189],
  [152,  89, 130, 178, 110, 154,  93, 135,  77, 119, 166, 100, 146,  78, 122, 170],
  [ 24,  69, 104, 206, 219, 201, 179,  53,  34,  47, 137, 187, 231, 211, 101,  63]
];
// Python-style round() (half-to-even) — kept explicit so the port stays pixel-exact with the reference.
function roundHalfEven(value) {
  var floor = Math.floor(value), diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
function dbToThreshold(db) {
  db = Math.max(0, Math.min(35, db));
  var norm = Math.min(1, db / DB_WHITE), smoothed = norm * norm * (3 - 2 * norm);
  return roundHalfEven(LEVELS * ((1 - S_CURVE) * norm + S_CURVE * smoothed));
}
// Each test point owns a 2×2 block of cells (1×2 at 27°); the central four are pinned, never blended.
function placePoint(grid, point) {
  var ax = Math.abs(point.x), ay = Math.abs(point.y), colStart = COL_START[ax], rowStart = ROW_START[ay];
  if (colStart === undefined || rowStart === undefined) return;
  var blockW = ax === 27 ? 1 : 2, central = ax === 3 && ay === 3, cols = grid[0].length;
  for (var dr = 0; dr < 2; dr += 1) for (var dc = 0; dc < blockW; dc += 1) {
    var rr = rowStart + dr, cc = colStart + dc;
    if (rr < HEMI_H && cc < cols && grid[rr][cc].active) { grid[rr][cc].db = point.db; grid[rr][cc].type = central ? 'central' : 'test'; }
  }
}
// points: [{ x: screen degrees (negative = left), y: degrees (positive = superior), db }]
function quadrantGrid(quadrant, points, eye) {
  var wide = quadrant === 'SW' || quadrant === 'IW', superior = quadrant === 'SW' || quadrant === 'SN';
  var cols = wide ? WIDE_W : NARROW_W, maxCol = wide ? WIDE_MAX_COL : NARROW_MAX_COL, grid = [], r, c;
  for (r = 0; r < HEMI_H; r += 1) { grid.push([]); for (c = 0; c < cols; c += 1) grid[r].push({ active: c <= maxCol[r], db: null, type: c <= maxCol[r] ? 'gap' : 'masked' }); }
  // The wide side is screen-left for OD (its 27° points sit there) and screen-right for OS.
  points.forEach(function (point) {
    var onWide = eye === 'OD' ? point.x < 0 : point.x > 0;
    if (onWide === wide && (point.y > 0) === superior) placePoint(grid, point);
  });
  blendGaps(grid);
  return grid;
}
// Gaussian-weighted blend of every non-central active cell from the placed test points within RADIUS cells.
function blendGaps(grid) {
  var anchors = [], r, c;
  grid.forEach(function (row, rr) { row.forEach(function (cell, cc) { if ((cell.type === 'test' || cell.type === 'central') && cell.db !== null) anchors.push({ r: rr, c: cc, db: cell.db }); }); });
  for (r = 0; r < grid.length; r += 1) for (c = 0; c < grid[r].length; c += 1) {
    var cell = grid[r][c]; if (!cell.active || cell.type === 'central') continue;
    var totalW = 0, weighted = 0;
    anchors.forEach(function (a) {
      var dist = Math.sqrt((a.r - r) * (a.r - r) + (a.c - c) * (a.c - c)); if (dist > RADIUS) return;
      var w = Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA)); totalW += w; weighted += w * a.db;
    });
    if (totalW > 0) cell.db = weighted / totalW;
  }
}
function paintQuadrant(gray, alpha, width, grid, xOff, yOff, flipH, flipV) {
  var rows = grid.length, cols = grid[0].length;
  for (var r = 0; r < rows; r += 1) for (var c = 0; c < cols; c += 1) {
    var cell = grid[r][c]; if (!cell.active) continue;
    var px0 = xOff + (flipH ? cols - 1 - c : c) * TILE, py0 = yOff + (flipV ? rows - 1 - r : r) * TILE;
    var t = cell.db === null ? null : dbToThreshold(cell.db);
    for (var py = 0; py < TILE; py += 1) for (var px = 0; px < TILE; px += 1) {
      var index = (py0 + py) * width + px0 + px;
      gray[index] = t === null ? 255 : (MATRIX[py][px] < t ? 255 : 0); alpha[index] = 255;
    }
  }
}
function drawMeridians(gray, alpha, width, height, leftCells) {
  var midY = HEMI_H * TILE, midX = leftCells * TILE, BAND = 3, TICK = 3, x, y;
  function inside(px, py, value) { if (px >= 0 && px < width && py >= 0 && py < height && alpha[py * width + px] > 0) gray[py * width + px] = value; }
  function stamp(px, py) { if (px >= 0 && px < width && py >= 0 && py < height) { gray[py * width + px] = 0; alpha[py * width + px] = 255; } }
  for (y = midY - BAND; y < midY + BAND; y += 1) for (x = 0; x < width; x += 1) inside(x, y, 255);
  for (x = midX - BAND; x < midX + BAND; x += 1) for (y = 0; y < height; y += 1) inside(x, y, 255);
  for (x = 0; x < width; x += 1) inside(x, midY, 0);
  for (y = 0; y < height; y += 1) inside(midX, y, 0);
  [2, 5, 8].forEach(function (gr) { [-1, 1].forEach(function (side) {
    var ty = midY + side * gr * TILE;
    for (var dx = 0; dx < TICK; dx += 1) { stamp(midX - BAND - TICK + dx, ty); stamp(midX + BAND + dx, ty); }
  }); });
  [2, 5, 8, 11].forEach(function (gc) { [midX - gc * TILE, midX + gc * TILE].forEach(function (tx) {
    for (var dy = 0; dy < TICK; dy += 1) { stamp(tx, midY - BAND - TICK + dy); stamp(tx, midY + BAND + dy); }
  }); });
}
// thresholds: 54 readings ({ state, value } or numbers) in printout reading order; coordinates from
// VisualFieldNormative.coordinates(eye) ({ xOd, y }); unread points simply contribute no anchor.
function render(thresholds, eye, coordinates) {
  var points = [];
  thresholds.forEach(function (reading, index) {
    var value = reading && typeof reading === 'object' ? (reading.state === 'read' ? reading.value : null) : reading;
    if (value === null || value === undefined || !Number.isFinite(value)) return;
    var coordinate = coordinates[index]; points.push({ x: eye === 'OS' ? -coordinate.xOd : coordinate.xOd, y: coordinate.y, db: value });
  });
  var width = FULL_W * TILE, height = FULL_H * TILE, gray = new Uint8Array(width * height), alpha = new Uint8Array(width * height);
  gray.fill(255);
  var od = eye === 'OD', leftCells = od ? WIDE_W : NARROW_W;
  var sw = quadrantGrid('SW', points, eye), sn = quadrantGrid('SN', points, eye), iw = quadrantGrid('IW', points, eye), inn = quadrantGrid('IN', points, eye);
  paintQuadrant(gray, alpha, width, od ? sw : sn, 0, 0, true, true);
  paintQuadrant(gray, alpha, width, od ? sn : sw, leftCells * TILE, 0, false, true);
  paintQuadrant(gray, alpha, width, od ? iw : inn, 0, HEMI_H * TILE, true, false);
  paintQuadrant(gray, alpha, width, od ? inn : iw, leftCells * TILE, HEMI_H * TILE, false, false);
  drawMeridians(gray, alpha, width, height, leftCells);
  var rgba = new Uint8Array(width * height * 4), indices = new Uint8Array(width * height);
  for (var i = 0; i < width * height; i += 1) {
    rgba[i * 4] = gray[i]; rgba[i * 4 + 1] = gray[i]; rgba[i * 4 + 2] = gray[i]; rgba[i * 4 + 3] = alpha[i];
    indices[i] = alpha[i] === 0 ? 2 : (gray[i] === 0 ? 1 : 0);   // 0 white, 1 black, 2 transparent
  }
  return { width: width, height: height, rgba: rgba, png: encodeIndexed(width, height, indices, [[255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 0]]) };
}
var api = Object.freeze({ encode: encode, encodeIndexed: encodeIndexed, render: render, crc32: crc32, adler32: adler32, MATRIX: MATRIX,
  TONE: Object.freeze({ tile: TILE, dbWhite: DB_WHITE, sCurve: S_CURVE, levels: LEVELS }) });
export { api, api as 'module.exports' };
