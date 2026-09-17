// Read-only display helpers selectively copied from source revision 478e764.
import { api as doorApi } from './visual-field-door.mjs';
import { get as providerGet } from './visual-field-provider.mjs';
import { api as sourceTableApi } from './visual-field-source-table.mjs';
var TIER_SHADE = { 'p<5%': '5', 'p<2%': '2', 'p<1%': '1', 'p<0.5%': '0.5' };
function door() { return doorApi; }
function registry() { return providerGet('devRegistry') || null; }
function devLayers(state, slot) { var r = state.door === 'dev' ? registry() : null; return r ? r.layers(slot) : []; }
function layerCarried(state, eyeReport, layer) { return !!(eyeReport.overlays && eyeReport.overlays[layer.id]); }
function sourceTable() { return sourceTableApi; }
function originOf(eyeReport, keyOrIndex, view) {
  var o = eyeReport.origins;
  if (!o) return eyeReport.valuesOrigin === 'computed' ? 'computed' : null;
  if (view === undefined) return o[keyOrIndex] || null;
  var list = { td: o.values, pd: o.patternValues }[view];
  return list ? list[keyOrIndex] || null : null;
}
function ink(node, origin) { if (origin) node.classList.add('vf-origin-' + origin); return node; }
function markTier(cell, eyeReport, index, view) {
  if (view !== 'td' && view !== 'pd') return;
  var c = eyeReport.conventional || {}, tier = ((view === 'td' ? c.probabilities : c.patternProbabilities) || [])[index];
  if (!TIER_SHADE[tier]) return;
  cell.setAttribute('data-p', TIER_SHADE[tier]);
  var mapName = view === 'td' ? 'Total Deviation' : 'Pattern Deviation';
  var label = mapName + (cell.textContent ? ' ' + cell.textContent + ' decibels' : ' with no numeric value printed') + ', ' + tier.replace('<', ' less than ');
  cell.title = label; cell.setAttribute('aria-label', label);
}
function significanceLegend(hooks) {
  var legend = hooks.el('aside', 'vf-significance-legend');
  legend.setAttribute('aria-label', 'Statistical significance of sensitivity loss');
  legend.appendChild(hooks.el('p', '', 'Statistical significance of sensitivity loss — lower p means stronger evidence of abnormality.'));
  var tiers = hooks.el('div', 'vf-significance-tiers');
  [['5', 'p<5%', 'p less than 5 percent'], ['2', 'p<2%', 'p less than 2 percent'], ['1', 'p<1%', 'p less than 1 percent'], ['0.5', 'p<0.5%', 'p less than 0.5 percent']].forEach(function (tier) {
    var item = hooks.el('span', 'vf-significance-tier', tier[1]); item.setAttribute('data-p', tier[0]); item.setAttribute('aria-label', tier[2]); tiers.appendChild(item);
  });
  legend.appendChild(tiers); return legend;
}
function eyeMaps(state, eyeReport, hooks) {
  var maps = hooks.el('div', 'vf-eye-maps');
  var block = function (label, fill) { var b = hooks.el('div', 'vf-map-block'); b.appendChild(hooks.el('h5', 'vf-map-label', label)); if (fill) b.appendChild(fill); return b; };
  var grayscale = block('Grayscale'); hooks.grayscale(grayscale, eyeReport); maps.appendChild(grayscale);
  maps.append(block('Threshold', hooks.map(eyeReport, 'threshold')), block('Total Deviation', hooks.map(eyeReport, 'td')), block('Pattern Deviation', hooks.map(eyeReport, 'pd')));
  var body = hooks.el('div'), layer = renderLayer(state, body, eyeReport, hooks);
  if (layer) maps.appendChild(block(layer.label, body));
  var availability = eyeReport.mapAvailability || {};
  if (availability.totalDeviation === 'not-present-in-source' && availability.patternDeviation === 'not-present-in-source' &&
      (availability.totalDeviationProbability === 'read' || availability.patternDeviationProbability === 'read'))
    maps.appendChild(hooks.el('p', 'vf-map-source-note', 'This Overview printout provides significance maps, not numeric deviation values.'));
  if (eyeReport.extractionWarning) maps.appendChild(hooks.el('p', 'vf-map-warning', 'Some printed values could not be read — review original.'));
  maps.appendChild(significanceLegend(hooks));
  return maps;
}
function renderLayer(state, panel, eyeReport, hooks) {
  var carried = devLayers(state, 'tab').filter(function (l) { return layerCarried(state, eyeReport, l); });
  var layer = carried.find(function (l) { return l.id === state.devLayer; }) || carried[0];
  if (!layer) return false;
  var block = eyeReport.block && state.package.record ? door().computedBlocksOf(state.package.record)[eyeReport.block.index] : null;
  layer.render(panel, eyeReport, block || null, hooks); return layer;
}
function recordAttributes(record, el) {
  var details = el('details', 'vf-report-attributes'), table = el('table', 'vf-record-table');
  details.appendChild(el('summary', '', 'Report data'));
  sourceTable().recordRows(record).forEach(function (row) { var tr = el('tr'); tr.append(el('td', '', row[0]), el('td', row[2] ? 'vf-record-absent' : '', row[1])); table.appendChild(tr); });
  details.appendChild(table); return details;
}
function provenanceLegend(eyeReport, el) {
  var legend = el('div', 'vf-legend'), item = function (origin, text) { var span = el('span', 'vf-legend-item'); span.append(el('span', 'vf-legend-swatch vf-origin-' + origin), el('span', '', text)); return span; };
  legend.appendChild(item('printed', 'Extracted from the report'));
  legend.appendChild(item('computed', 'Computed by OphthoScribe' + (eyeReport.engine ? ' · ' + eyeReport.engine + (eyeReport.dataset ? ' · ' + eyeReport.dataset : '') : '')));
  legend.appendChild(el('span', 'vf-legend-item', '-- not on the printout · ' + door().ABSENCE.view + ' / ' + door().ABSENCE.dev + ' as written'));
  var shades = el('span', 'vf-legend-item'); shades.appendChild(el('span', '', 'TD/PD shade: '));
  [['5', 'p<5%'], ['1', 'p<1%'], ['0.5', 'p<0.5%']].forEach(function (t) { var s = el('span', 'vf-legend-shade', t[1]); s.setAttribute('data-p', t[0]); shades.appendChild(s); });
  legend.appendChild(shades);
  return legend;
}
const api = Object.freeze({door, registry, devLayers, layerCarried, sourceTable, originOf, ink, markTier, significanceLegend, eyeMaps, renderLayer, recordAttributes, provenanceLegend});
export { api };
