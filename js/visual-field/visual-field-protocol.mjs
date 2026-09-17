// [Active · lazy 'pipeline' group] Extraction protocols: schema validation against the visual-field directories,
// page expansion (blocks → instances, grids → atomic cells), and source detection by text anchors. Pure — no DOM,
// no PDF, no OCR. Protocols are DATA (data/directories/visual-field/protocols/*.json): every region and grid names
// the attribute `home` its Point fills; lattices come from the patterns directory. Specs:
// 2026-08-27-visual-field-extraction-protocols-design.md §4.2/§4.5, 2026-08-27-visual-field-native-entity-design.md §4.
var SCHEMA = 'visual-field-extraction-protocol/v1';
var READERS = ['text-layer', 'raster-glyph'];
var TOP_KEYS = ['protocol', 'id', 'version', 'source', 'page', 'detect', 'reader', 'regions', 'blocks'];
var REGION_KEYS = ['id', 'home', 'rect', 'parser', 'reader', 'mode', 'anchor'];
var GRID_KEYS = ['idPrefix', 'home', 'origin', 'pitch', 'cell', 'parser', 'reader', 'variants', 'layout', 'rowOffset', 'mirror'];
var BLOCK_KEYS = ['id', 'origin', 'pitch', 'count', 'regions', 'grids'];

function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function finite(v) { return typeof v === 'number' && isFinite(v); }
function text(v) { return typeof v === 'string' && v.length > 0; }
function exactKeys(value, allowed, path, errors) {
  if (!plain(value)) { errors.push(path + ' must be an object'); return false; }
  Object.keys(value).forEach(function (key) { if (allowed.indexOf(key) < 0) errors.push(path + ' contains unsupported key ' + key); });
  return true;
}
function validRect(rect) { return Array.isArray(rect) && rect.length === 4 && rect.every(finite) && rect[2] > 0 && rect[3] > 0; }
function validPoint(p) { return plain(p) && finite(p.x) && finite(p.y); }
function lattice(directories, layout) { var p = directories.pattern(layout); return p && p.lattice ? p.lattice : null; }

// The home a region/grid names must be an attribute home, and the attribute named by the id (regions) or idPrefix
// (grids) must own exactly that home — so a protocol can never emit a Point the directory does not name.
function validateHome(owner, idKey, path, errors, directories) {
  if (!text(owner.home)) { errors.push(path + '.home must name the attribute home'); return; }
  if (!directories.attributes.entries.some(function (a) { return a.home === owner.home; })) errors.push(path + '.home ' + owner.home + ' is not an attribute');
  var attribute = directories.attribute(owner[idKey]);
  if (!attribute) errors.push(path + '.' + idKey + ' ' + owner[idKey] + ' is not an attribute');
  else if (attribute.home !== owner.home) errors.push(path + '.home must be ' + attribute.home + ' (the home of ' + owner[idKey] + ')');
}
function validateRegion(region, path, seen, errors, directories) {
  if (!exactKeys(region, REGION_KEYS, path, errors)) return;
  if (!text(region.id)) errors.push(path + '.id must be a non-empty string');
  else if (seen[region.id]) errors.push(path + '.id duplicates ' + region.id); else seen[region.id] = true;
  validateHome(region, 'id', path, errors, directories);
  if (!validRect(region.rect)) errors.push(path + '.rect must be [x, y, w, h] with positive w and h');
  if (!text(region.parser)) errors.push(path + '.parser must name a parser');
  if (region.reader !== undefined && READERS.indexOf(region.reader) < 0) errors.push(path + '.reader must be one of ' + READERS.join(', '));
}
function validateShape(shape, path, errors, directories) {
  if (!exactKeys(shape, ['layout', 'rowOffset', 'mirror'], path, errors)) return;
  if (!lattice(directories, shape.layout)) errors.push(path + '.layout must be a patterns token with a lattice (got ' + shape.layout + ')');
  if (!(Number.isInteger(shape.rowOffset) && shape.rowOffset >= 0)) errors.push(path + '.rowOffset must be a non-negative integer');
  if (!plain(shape.mirror) || typeof shape.mirror.OD !== 'boolean' || typeof shape.mirror.OS !== 'boolean') errors.push(path + '.mirror needs boolean OD and OS');
}
function validateGrid(grid, path, ids, errors, directories) {
  if (!exactKeys(grid, GRID_KEYS, path, errors)) return;
  if (!text(grid.idPrefix)) errors.push(path + '.idPrefix must be a non-empty string');
  else { var attribute = directories.attribute(grid.idPrefix); if (attribute && !attribute.grid) errors.push(path + '.idPrefix ' + grid.idPrefix + ' is not a grid attribute'); }
  validateHome(grid, 'idPrefix', path, errors, directories);
  if (!validPoint(grid.origin) || !validPoint(grid.pitch)) errors.push(path + ' origin and pitch must be {x, y}');
  if (!plain(grid.cell) || !(grid.cell.w > 0) || !(grid.cell.h > 0)) errors.push(path + '.cell must have positive w and h');
  if (!text(grid.parser)) errors.push(path + '.parser must name a parser');
  if (grid.reader !== undefined && READERS.indexOf(grid.reader) < 0) errors.push(path + '.reader must be one of ' + READERS.join(', '));
  if (grid.variants !== undefined) {
    if (!plain(grid.variants) || !text(grid.variants.by) || !plain(grid.variants.cases)) { errors.push(path + '.variants needs by and cases'); return; }
    if (!ids[grid.variants.by]) errors.push(path + '.variants.by must name a region in scope: ' + grid.variants.by);
    Object.keys(grid.variants.cases).forEach(function (key) { validateShape(grid.variants.cases[key], path + '.variants.cases.' + key, errors, directories); });
  } else validateShape({ layout: grid.layout, rowOffset: grid.rowOffset, mirror: grid.mirror }, path, errors, directories);
}
function validateSource(source, errors, directories) {
  if (!plain(source) || !text(source.vendor) || !text(source.device) || !text(source.reportKind)) { errors.push('source needs vendor, device, reportKind tokens'); return; }
  var vendor = directories.entry('vendors', source.vendor);
  if (!vendor) { errors.push('source.vendor ' + source.vendor + ' is not a vendors token'); return; }
  var device = (vendor.devices || []).find(function (d) { return d.id === source.device; });
  if (!device) errors.push('source.device ' + source.device + ' is not a device of ' + source.vendor);
  else if (source.software !== undefined && !(device.software || []).some(function (s) { return s.id === source.software; })) errors.push('source.software ' + source.software + ' is not a software token of ' + source.device);
  if (!directories.reportKind(source.reportKind)) errors.push('source.reportKind ' + source.reportKind + ' is not a report-kinds token');
}
function validateBlocks(doc, pageIds, errors, directories) {
  doc.blocks.forEach(function (block, b) {
    var path = 'blocks[' + b + ']';
    if (!exactKeys(block, BLOCK_KEYS, path, errors)) return;
    if (!text(block.id)) errors.push(path + '.id must be a non-empty string');
    if (!validPoint(block.origin) || !validPoint(block.pitch)) errors.push(path + ' origin and pitch must be {x, y}');
    if (!(Number.isInteger(block.count) && block.count >= 1)) errors.push(path + '.count must be a positive integer');
    if (block.count > 1 && !(validPoint(block.pitch) && (block.pitch.y > 0 || block.pitch.x > 0))) errors.push(path + '.pitch must be positive when count > 1');
    var ids = Object.assign({}, pageIds);
    if (!Array.isArray(block.regions)) errors.push(path + '.regions must be an array');
    else block.regions.forEach(function (region, i) { validateRegion(region, path + '.regions[' + i + ']', ids, errors, directories); });
    if (!Array.isArray(block.grids)) errors.push(path + '.grids must be an array');
    else block.grids.forEach(function (grid, i) { validateGrid(grid, path + '.grids[' + i + ']', ids, errors, directories); });
  });
}
function validateProtocol(doc, directories) {
  if (!directories || typeof directories.attribute !== 'function') throw new Error('validateProtocol needs the visual-field directories');
  var errors = [];
  if (!exactKeys(doc, TOP_KEYS, 'protocol', errors)) return { ok: false, errors: errors };
  if (doc.protocol !== SCHEMA) errors.push('protocol must be ' + SCHEMA);
  if (!text(doc.id) || !/^[a-z0-9_-]+$/.test(doc.id)) errors.push('id must be a lowercase slug');
  if (!(Number.isInteger(doc.version) && doc.version >= 1)) errors.push('version must be a positive integer');
  validateSource(doc.source, errors, directories);
  if (!plain(doc.page) || !(doc.page.width > 0) || !(doc.page.height > 0) || !(doc.page.tolerance >= 0)) errors.push('page needs width, height, tolerance');
  if (!plain(doc.detect) || !Array.isArray(doc.detect.anchors) || !doc.detect.anchors.length) errors.push('detect.anchors must be a non-empty array');
  else doc.detect.anchors.forEach(function (anchor, i) {
    if (!plain(anchor) || !finite(anchor.x) || !finite(anchor.y) || !(text(anchor.text) || text(anchor.textPrefix) || text(anchor.textSuffix))) {
      errors.push('detect.anchors[' + i + '] needs x, y and text/textPrefix/textSuffix');
    }
  });
  if (!plain(doc.reader) || READERS.indexOf(doc.reader.default) < 0) errors.push('reader.default must be one of ' + READERS.join(', '));
  var pageIds = {};
  if (!Array.isArray(doc.regions)) errors.push('regions must be an array');
  else doc.regions.forEach(function (region, i) { validateRegion(region, 'regions[' + i + ']', pageIds, errors, directories); });
  if (!Array.isArray(doc.blocks)) errors.push('blocks must be an array');
  else validateBlocks(doc, pageIds, errors, directories);
  return { ok: errors.length === 0, errors: errors };
}

function rect(x, y, w, h) { return { x: x, y: y, w: w, h: h, basis: 'pdf-points' }; }
function region(doc, source, offset, block) {
  return { id: source.id, home: source.home, rect: rect(source.rect[0] + offset.x, source.rect[1] + offset.y, source.rect[2], source.rect[3]),
    parser: source.parser, reader: source.reader || doc.reader.default, mode: source.mode || null, block: block, anchor: !!source.anchor, dependsOn: [] };
}
function gridShape(grid, resolve, index) {
  if (!grid.variants) return { shape: { layout: grid.layout, rowOffset: grid.rowOffset, mirror: grid.mirror }, deps: ['identity.eye'] };
  var key = resolve(grid.variants.by, index);
  return { shape: key !== undefined ? grid.variants.cases[String(key)] || null : null, deps: ['identity.eye', grid.variants.by] };
}
// columnStarts are the OD (right-eye) printed layout on the lattice; a mirrored eye starts at columns - start - count
// so the nasal row of nine sits on the other side while symmetric rows stay put.
function expandGrid(doc, grid, offset, block, resolve, directories) {
  var picked = gridShape(grid, resolve, block.index), eye = resolve('identity.eye', block.index), out = [];
  if (!picked.shape || (eye !== 'OD' && eye !== 'OS')) return out;
  var layout = lattice(directories, picked.shape.layout), mirrored = picked.shape.mirror[eye], index = 0;
  if (!layout) return out;
  layout.rows.forEach(function (count, r) {
    var start = mirrored ? layout.columns - layout.columnStarts[r] - count : layout.columnStarts[r];
    for (var i = 0; i < count; i += 1) {
      var col = start + i, row = picked.shape.rowOffset + r;
      var cx = grid.origin.x + offset.x + col * grid.pitch.x, cy = grid.origin.y + offset.y + row * grid.pitch.y;
      out.push({ id: grid.idPrefix + String(index).padStart(2, '0'), home: grid.home, rect: rect(cx - grid.cell.w / 2, cy - grid.cell.h / 2, grid.cell.w, grid.cell.h),
        parser: grid.parser, reader: grid.reader || doc.reader.default, mode: null, block: block, anchor: false, dependsOn: picked.deps.slice() });
      index += 1;
    }
  });
  return out;
}
// resolve(regionId, blockIndex) → the parsed value of an already-extracted region in scope, or undefined.
function expandPage(doc, pageNumber, resolve, directories) {
  if (!directories) throw new Error('expandPage needs the visual-field directories');
  var out = [], zero = { x: 0, y: 0 };
  doc.regions.forEach(function (source) { out.push(region(doc, source, zero, null)); });
  doc.blocks.forEach(function (block) {
    for (var i = 0; i < block.count; i += 1) {
      var offset = { x: block.origin.x + i * block.pitch.x, y: block.origin.y + i * block.pitch.y }, tag = { id: block.id, index: i };
      block.regions.forEach(function (source) { out.push(region(doc, source, offset, tag)); });
      block.grids.forEach(function (grid) { out.push.apply(out, expandGrid(doc, grid, offset, tag, resolve, directories)); });
    }
  });
  return out;
}

// Anchors are authored at the printed string's left edge and baseline. An item that carries its left x must sit
// within tolerance; an item that only carries its centre may sit anywhere in a 200-pt window to the right.
function anchorMatches(anchor, items, tolerance) {
  return items.some(function (item) {
    var str = String(item.str || '');
    var textOk = anchor.text ? str === anchor.text
      : (!anchor.textPrefix || str.indexOf(anchor.textPrefix) === 0) && (!anchor.textSuffix || str.slice(-anchor.textSuffix.length) === anchor.textSuffix);
    if (!textOk || Math.abs(item.cy - anchor.y) > tolerance + 8) return false;
    if (typeof item.x === 'number') return Math.abs(item.x - anchor.x) <= tolerance + 3;
    return item.cx >= anchor.x - tolerance && item.cx <= anchor.x + 200;
  });
}
function detect(protocols, pageItems) {
  var matches = protocols.filter(function (doc) {
    return doc.detect.anchors.every(function (anchor) { return anchorMatches(anchor, pageItems, doc.page.tolerance); });
  });
  if (matches.length > 1) throw new Error('Extraction protocol detection is ambiguous: ' + matches.map(function (m) { return m.id; }).join(', '));
  return matches[0] || null;
}

// True when any region or grid reads through the raster-glyph reader — the pipeline then renders the page once.
function needsRaster(doc) {
  var hit = function (r) { return !!r && r.reader === 'raster-glyph'; };
  if (doc.reader && doc.reader.default === 'raster-glyph') return true;
  return (doc.regions || []).some(hit) || (doc.blocks || []).some(function (b) { return (b.regions || []).some(hit) || (b.grids || []).some(hit); });
}
var api = Object.freeze({ SCHEMA: SCHEMA, validateProtocol: validateProtocol, expandPage: expandPage, detect: detect, needsRaster: needsRaster });
export { api, api as 'module.exports' };
