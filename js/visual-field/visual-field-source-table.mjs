// [Active · lazy 'viewer' group] Read-only projections behind "View source data" / "View original": the stored
// visual-field-record/v1 (every printed field with its honest absence state, the numeric and probability grids) beside
// the original's page canvases carrying the OCR region overlay — P2's debugging instrument (two-lane spec §7.3/§7.8).
// The legacy source/v1 table (render) stays for original-only rows.
import { get as providerGet } from './visual-field-provider.mjs';
// The printed lattice of a pattern comes from the patterns directory (rows / columnStarts / columns) — never a table
// in code; the directories ride the provider seam's `directories` slot (the store facade registers them before any grid renders).
function lattice(pattern) {
  var d = providerGet('directories'), found = d && d.pattern(String(pattern || ''));
  if (!found || !found.lattice) throw new Error('visual-field pattern ' + pattern + ' is not in the directories');
  return found.lattice;
}
var KEYS = [['threshold', 'Threshold (dB)'], ['totalDeviation', 'Total deviation'], ['patternDeviation', 'Pattern deviation']];
var ABSENT_TEXT = { 'not-extracted': 'not extracted', 'not-present-in-source': 'not in source' };
var GLYPHS = { normal: '·', 'p<5%': ':', 'p<2%': '▒', 'p<1%': '▓', 'p<0.5%': '█' };
function cell(reading) { return reading && reading.state === 'read' && reading.value !== null ? String(reading.value) : '·'; }
// rows × columns of the pattern's lattice; '' outside the grid. The nasal step of the nine-point rows sits on the OD
// side (documents are stored in canonical point order regardless of eye).
function gridRows(points, textOf, pattern) {
  var shape = lattice(pattern), out = [], index = 0;
  shape.rows.forEach(function (count, row) {
    var line = Array(shape.columns).fill('');
    for (var i = 0; i < count; i += 1) line[shape.columnStarts[row] + i] = textOf(points[index++]);
    out.push(line);
  });
  return out;
}
function rows(sourceEye, key, pattern) { return gridRows(sourceEye.points, function (point) { return cell(point[key]); }, pattern); }
function el(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function gridTable(lines, key, label) {
  var table = el('table', 'vf-source-grid'); table.setAttribute('data-vf-source-key', key);
  table.appendChild(el('caption', '', label));
  lines.forEach(function (line) {
    var tr = el('tr'); line.forEach(function (value) { tr.appendChild(el('td', value === '' ? 'vf-source-blank' : '', value)); }); table.appendChild(tr);
  });
  return table;
}
function grid(sourceEye, key, label, pattern) { return gridTable(rows(sourceEye, key, pattern), key, label); }
function metricText(metric) { return metric && metric.state === 'read' ? String(metric.value) : 'Not read'; }
function provenanceText(doc) {
  var p = doc.provenance || {}, device = p.device || {};
  return 'Source: ' + String(p.origin || '') + ' · ' + String(p.exportFormat || '') +
    (device.manufacturer ? ' · ' + device.manufacturer + ' ' + (device.model || '') : '') + ' · ' + doc.study.testDate + ' · ' + doc.study.pattern;
}
function render(host, doc) {
  var section = el('section', 'vf-source-table');
  section.appendChild(el('p', 'vf-source-provenance', provenanceText(doc)));
  if (doc.provenance && doc.provenance.note) section.appendChild(el('p', 'vf-source-provenance', doc.provenance.note));
  doc.eyes.forEach(function (sourceEye) {
    var r = sourceEye.reliability;
    section.appendChild(el('h4', '', sourceEye.eye + (Number.isInteger(sourceEye.ageYears) ? ' · age ' + sourceEye.ageYears : '')));
    section.appendChild(el('p', 'vf-source-reliability', 'FP ' + metricText(r.fp) + ' · FN ' + metricText(r.fn) +
      ' · FL ' + (r.fl.state === 'read' ? r.fl.numerator + '/' + r.fl.denominator : 'Not read')));
    KEYS.forEach(function (pair) { section.appendChild(grid(sourceEye, pair[0], pair[1], doc.study.pattern)); });
  });
  host.appendChild(section);
}

// --- visual-field-record/v1 projection ---
function isAbsent(c) { return !c || typeof c.state === 'string'; }
// Record cell → text; absences render their own words so a doctor never mistakes "not read" for "not printed".
function cellText(c) {
  if (isAbsent(c)) return ABSENT_TEXT[c && c.state] || ABSENT_TEXT['not-extracted'];
  var v = c.value, text;
  if (c.censored) text = '<0';
  else if (c.numerator !== undefined) text = c.numerator + '/' + c.denominator;
  else if (v && typeof v === 'object' && 'sphere' in v) text = v.sphere + ' DS ' + v.cylinder + ' DC x ' + v.axis;
  else if (v && typeof v === 'object') text = Object.keys(v).map(function (k) { return v[k]; }).join(' ');
  else text = String(v);
  if (c.unit) text += (c.unit === '%' ? '' : ' ') + c.unit;
  if (c.probability) text += ' (' + c.probability + ')';
  if (c.excessive) text += ' XX';
  return text;
}
// The printed analysis block: `printed` on a visual-field-test entity, `device` on a legacy visual-field-record/v1.
function deviceBlock(record) { return (record.analyses || []).find(function (block) { return block.origin === 'printed' || block.origin === 'device'; }) || null; }
function isEntity(record) { return /visual-field-test/.test(String(record && record.schema || '')); }
function provenanceRow(record) {
  var x = record.extraction || {};
  if (isEntity(record)) return { value: x.protocol ? x.protocol.id + '@' + x.protocol.version + ' · page ' + x.page + ' · block ' + x.index : 'source document' };
  return { value: x.sourceFormat + ' · ' + x.extractorVersion };
}
function recordRows(record) {
  var a = record.acquisition, d = a.device, t = record.testDefinition, m = record.measurement, r = m.reliability, i = record.identity;
  var block = deviceBlock(record), values = block ? block.values : {}, none = { state: 'not-present-in-source' };
  var rowsOut = [['Patient', i.name], ['DOB', i.birthDate], ['ID', i.patientId], ['Sex', i.sex],
    ['Test date', { value: a.testDate }], ['Time', a.testTime], ['Duration (s)', a.durationSeconds], ['Age', a.ageYears],
    ['Pattern', { value: t.pattern }], ['Strategy', t.strategy], ['Stimulus', t.stimulus], ['Background', t.background],
    ['Fixation monitor', a.fixationMonitor], ['Fixation target', a.fixationTarget], ['Pupil', a.pupilDiameterMm], ['Rx', a.refraction], ['VA', a.visualAcuity],
    ['Fovea', m.foveaThreshold], ['FP', r.fp], ['FN', r.fn], ['FL', r.fl],
    ['MD', values.md || none], ['PSD', values.psd || none], ['VFI', values.vfi || none], ['GHT', values.ght || none],
    ['Device', d.model], ['Serial', d.serial], ['Software', d.software]]
    .concat(isEntity(record) ? [] : [['Lane', { value: record.lane }]])
    .concat([['Source', provenanceRow(record)],
      ['Analyses', { value: (record.analyses || []).map(function (b) { return (b.origin + ' ' + (b.engineVersion || '')).trim(); }).join(' · ') || 'none' }]]);
  return rowsOut.map(function (pair) { return [pair[0], cellText(pair[1]), isAbsent(pair[1])]; });
}
function thresholdText(c) { return isAbsent(c) ? (c && c.state === 'not-present-in-source' ? '--' : '?') : cellText(c); }
function glyphText(c) { return isAbsent(c) ? (c && c.state === 'not-present-in-source' ? '--' : '?') : GLYPHS[c.value] || String(c.value); }
function renderRecord(host, record, stored) {
  var section = el('section', 'vf-source-table'), block = deviceBlock(record), points = block ? block.values.points : null;
  var pattern = record.testDefinition && record.testDefinition.pattern, grids = function (list, textOf) { return gridRows(list, textOf, pattern); };
  section.appendChild(el('h4', '', record.measurement.eye + (isEntity(record) ? ' · visual-field-test · extracted' : ' · visual-field-record/v1 · ' + (stored ? 'stored record' : 'assembled from the legacy source (fallback)'))));
  var table = el('table', 'vf-record-table');
  recordRows(record).forEach(function (row) {
    var tr = el('tr'); tr.append(el('td', '', row[0]), el('td', row[2] ? 'vf-record-absent' : '', row[1])); table.appendChild(tr);
  });
  section.appendChild(table);
  section.appendChild(gridTable(grids(record.measurement.points, function (p) { return thresholdText(p.threshold); }), 'threshold', 'Threshold (dB) — measurement'));
  if (points) {
    section.appendChild(gridTable(grids(points, function (p) { return thresholdText(p.totalDeviation); }), 'totalDeviation', 'Total deviation — device'));
    section.appendChild(gridTable(grids(points, function (p) { return glyphText(p.totalDeviationProbability); }), 'totalDeviationProbability', 'TD probability — device'));
    section.appendChild(gridTable(grids(points, function (p) { return thresholdText(p.patternDeviation); }), 'patternDeviation', 'Pattern deviation — device'));
    section.appendChild(gridTable(grids(points, function (p) { return glyphText(p.patternDeviationProbability); }), 'patternDeviationProbability', 'PD probability — device'));
  } else section.appendChild(el('p', 'vf-source-provenance', 'No device analysis block on this record.'));
  host.appendChild(section);
}


const api = Object.freeze({ rows, render, cellText, recordRows, renderRecord });
export { api };
