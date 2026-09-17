// [Active · lazy 'pipeline' group] The two absence states every reader shares and the OCR geometry entry — what is
// left of visual-field-record/v1 after the native entity (2026-08-28, plan Task 12): the entity graph is validated by
// js/data/visual-field/model.mjs against the directories, so the record validator, createRecord, the analysis-block
// builder and every vocabulary constant are gone. Geometry reader / status vocabularies come from the states directory.
import { get as providerGet } from './visual-field-provider.mjs';

var NOT_EXTRACTED = Object.freeze({ state: 'not-extracted' });
var NOT_PRESENT = Object.freeze({ state: 'not-present-in-source' });
// Who placed the rectangle: the layout template, a user adjustment, or an extraction protocol region.
var GEOMETRY_SOURCES = ['template', 'user-adjusted', 'protocol'];
var GEOMETRY_KEYS = ['fieldId', 'page', 'rect', 'rawText', 'source', 'revision', 'reader', 'status', 'protocol', 'block'];
var RECT_KEYS = ['x', 'y', 'w', 'h', 'basis'];
var RECT_BASIS = 'pdf-points';

function plain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function finite(value) { return typeof value === 'number' && isFinite(value); }
function directories() {
  var d = providerGet('directories');
  if (!d) throw new Error('visual-field directories are not loaded');
  return d;
}
function exactKeys(value, allowed, path, errors) {
  if (!plain(value)) { errors.push(path + ' must be an object'); return false; }
  Object.keys(value).forEach(function (key) {
    if (allowed.indexOf(key) < 0) errors.push(path + ' contains unsupported key ' + key);
  });
  return true;
}
function oneOf(value, allowed, path, errors) {
  if (allowed.indexOf(value) < 0) errors.push(path + ' must be one of ' + allowed.join(', '));
}
function validateRect(rect, path, errors) {
  if (!exactKeys(rect, RECT_KEYS, path, errors)) return;
  ['x', 'y', 'w', 'h'].forEach(function (key) { if (!finite(rect[key])) errors.push(path + '.' + key + ' must be a finite number'); });
  if (rect.basis !== RECT_BASIS) errors.push(path + '.basis must be ' + RECT_BASIS);
}
function validateGeometryEntry(entry, path, errors) {
  if (!exactKeys(entry, GEOMETRY_KEYS, path, errors)) return;
  if (!nonEmptyString(entry.fieldId)) errors.push(path + '.fieldId must be a non-empty string');
  if (!(Number.isInteger(entry.page) && entry.page >= 1)) errors.push(path + '.page must be a positive integer');
  validateRect(entry.rect, path + '.rect', errors);
  if (typeof entry.rawText !== 'string') errors.push(path + '.rawText must be a string');
  oneOf(entry.source, GEOMETRY_SOURCES, path + '.source', errors);
  if (!(Number.isInteger(entry.revision) && entry.revision >= 0)) errors.push(path + '.revision must be a non-negative integer');
  // Protocol provenance (extraction-protocols spec §4.3): optional, validated when present against the states directory.
  if (entry.reader !== undefined) oneOf(entry.reader, directories().states.readers || [], path + '.reader', errors);
  if (entry.status !== undefined) oneOf(entry.status, directories().states.point || [], path + '.status', errors);
  if (entry.protocol !== undefined && !(plain(entry.protocol) && nonEmptyString(entry.protocol.id) && Number.isInteger(entry.protocol.version))) errors.push(path + '.protocol must carry id and version');
  if (entry.block !== undefined && !(plain(entry.block) && nonEmptyString(entry.block.id) && Number.isInteger(entry.block.index))) errors.push(path + '.block must carry id and index');
}
function makeGeometryEntry(input) {
  var spec = plain(input) ? input : {};
  var entry = { fieldId: spec.fieldId, page: spec.page, rect: spec.rect, rawText: spec.rawText,
    source: spec.source === undefined ? 'template' : spec.source, revision: spec.revision === undefined ? 0 : spec.revision };
  ['reader', 'status', 'protocol', 'block'].forEach(function (key) { if (spec[key] !== undefined) entry[key] = spec[key]; });
  var errors = [];
  validateGeometryEntry(entry, 'geometry entry', errors);
  if (errors.length) throw new Error('visual-field geometry: ' + errors.join('; '));
  return entry;
}

var api = Object.freeze({ NOT_EXTRACTED: NOT_EXTRACTED, NOT_PRESENT: NOT_PRESENT, makeGeometryEntry: makeGeometryEntry });
export { api, api as 'module.exports' };
