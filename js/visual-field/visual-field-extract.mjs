// [Active · lazy 'pipeline' group] One code path for every region: reader → raw → parser → labelled Point. Two
// expansion passes (independent regions, then grids that depend on eye/pattern); unanchored block instances are
// dropped whole. Every Point carries the attribute `home` its region names. Extraction-protocols spec §4 / §4.3.
import { api as protocolApi } from './visual-field-protocol.mjs';
import { api as printoutFieldsApi } from './visual-field-printout-fields.mjs';
import { api as recordApi } from './visual-field-record.mjs';
function protocol() { return protocolApi; }
function fields() { return printoutFieldsApi; }
function rec() { return recordApi; }

function point(doc, pageNumber, region, raw) {
  var text = String(raw || '').trim(), status, value;
  if (!text) { status = 'absent'; value = rec().NOT_PRESENT; }
  else {
    value = fields().parseWith(region.parser, text);
    status = value === rec().NOT_EXTRACTED ? 'not-extracted' : value === rec().NOT_PRESENT ? 'absent' : 'read';
  }
  return { id: region.id, home: region.home, page: pageNumber, block: region.block, rect: region.rect, reader: region.reader, raw: text, value: value, status: status,
    protocol: { id: doc.id, version: doc.version } };
}
function readAll(doc, pageNumber, regions, readers) {
  return Promise.all(regions.map(function (region) {
    var reader = readers[region.reader];
    if (!reader) return Promise.resolve(point(doc, pageNumber, region, ''));
    return Promise.resolve(reader.read(region.rect, doc.page.tolerance, region)).then(function (raw) { return point(doc, pageNumber, region, raw); });
  }));
}
function key(id, block) { return (block ? block.index : 'page') + ':' + id; }
function resolver(points) {
  var byKey = {};
  points.forEach(function (p) { byKey[key(p.id, p.block)] = p; });
  return function (id, blockIndex) {
    var hit = byKey[blockIndex + ':' + id] || byKey['page:' + id];
    return hit && hit.status === 'read' ? hit.value.value : undefined;
  };
}
// readers: { 'text-layer': { read(rect, tolerance, region) → string | Promise<string> }, 'raster-glyph'?: … };
// directories: the loaded visual-field directories (lattices for the grids).
function extractPage(doc, pageNumber, readers, directories) {
  var first = protocol().expandPage(doc, pageNumber, function () { return undefined; }, directories);
  var anchors = {};
  first.forEach(function (r) { if (r.anchor && r.block) (anchors[r.block.index] = anchors[r.block.index] || []).push(r.id); });
  return readAll(doc, pageNumber, first, readers).then(function (points) {
    var seen = {};
    points.forEach(function (p) { seen[key(p.id, p.block)] = true; });
    var second = protocol().expandPage(doc, pageNumber, resolver(points), directories).filter(function (region) { return !seen[key(region.id, region.block)]; });
    return readAll(doc, pageNumber, second, readers).then(function (more) {
      var all = points.concat(more), anchored = {};
      all.forEach(function (p) {
        if (!p.block || (anchors[p.block.index] || []).indexOf(p.id) < 0) return;
        anchored[p.block.index] = !!anchored[p.block.index] || p.status === 'read';
      });
      return all.filter(function (p) { return !p.block || anchored[p.block.index] === true; });
    });
  });
}
var api = Object.freeze({ extractPage: extractPage });
export { api, api as 'module.exports' };
