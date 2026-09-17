// [Active] Strict, PHI-minimized visual-field-source/v1 and visual-field-report/v1 contracts.
import { api as recordApi } from './visual-field-record.mjs';
import { get as providerGet } from './visual-field-provider.mjs';

var SCHEMA = 'visual-field-report/v1';
var EXTRACTION_SCHEMA = 'visual-field-extraction/v1';
var SOURCE_SCHEMA = 'visual-field-source/v1';
var ORIGINS = ['device-export', 'ocr', 'manual', 'synthetic', 'dataset'];
var EXPORT_FORMATS = ['hfa-xml', 'dicom-opv', 'forum-json', 'ophthoscribe-ocr', 'tds-csv', 'other'];
var TEST_PARAMETER_KEYS = ['strategy', 'stimulus', 'background', 'fixationTarget'];
var EYES = ['OD', 'OS'];
// Vocabularies (pattern → point count, GHT, probability) come from the directories the facade / protocols.load publish
// on the provider seam's `directories` slot (native-entity spec §4/§8.3); a contract check without them refuses rather than guesses.
function directories() { var d = providerGet('directories'); if (!d) throw new Error('visual-field directories are not loaded'); return d; }
function tokenIds(name) { return (directories().vocabulary(name) || []).map(function (e) { return e.id; }).concat(['not-read']); }
// The pattern names the grid: its point count sizes every per-point array. 0 = unknown pattern (already reported).
function pointCountOf(pattern) { var found = directories().pattern(String(pattern || '')); return found ? Number(found.pointCount || 0) : 0; }
function sized(value, count, path, errors) { if (!Array.isArray(value) || (count > 0 && value.length !== count)) errors.push(path + ' must contain ' + count + ' entries'); }
var READ_STATES = ['read', 'not-read'];
var LIFECYCLES = ['preliminary', 'submitted-for-cosign', 'original-only', 'final', 'entered-in-error'];
var GLOBAL_KEYS = ['md', 'psd', 'vfi', 'fp', 'fn', 'fl'];
var FORBIDDEN_KEYS = /^(patientName|name|dob|birthDate|filename|rawOcr|ocrText|pageBitmap|boundingBoxes|bbox)$/i;

function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }

function exactKeys(value, allowed, path, errors) {
  if (!plain(value)) { errors.push(path + ' must be an object'); return false; }
  Object.keys(value).forEach(function (key) {
    if (allowed.indexOf(key) < 0) errors.push(path + ' contains unsupported key ' + key);
  });
  return true;
}

function required(value, keys, path, errors) {
  keys.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(path + '.' + key + ' is required');
  });
}

function finiteOrNull(value, path, errors) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(path + ' must be a finite number or null');
  }
}

function validateReading(reading, path, errors, range) {
  if (!exactKeys(reading, ['value', 'state', 'censored'], path, errors)) return;
  required(reading, ['value', 'state'], path, errors);
  finiteOrNull(reading.value, path + '.value', errors);
  if (READ_STATES.indexOf(reading.state) < 0) errors.push(path + '.state is invalid');
  if (reading.state === 'not-read' && reading.value !== null) errors.push(path + ' not-read value must be null');
  if (reading.state === 'read' && reading.value === null) errors.push(path + ' read value must be numeric');
  if (reading.censored !== undefined && typeof reading.censored !== 'boolean') errors.push(path + '.censored must be boolean');
  if (reading.value !== null && range && (reading.value < range[0] || reading.value > range[1])) {
    errors.push(path + '.value is outside the allowed range');
  }
}

// Report points carry sourceProbability; source/v1 points (source === true) carry only the three readings.
function validatePoint(point, index, path, errors, source) {
  var keys = ['id', 'threshold', 'totalDeviation', 'patternDeviation'].concat(source ? [] : ['sourceProbability']);
  if (!exactKeys(point, keys, path, errors)) return;
  required(point, keys, path, errors);
  var expected = 'p' + String(index).padStart(2, '0');
  if (point.id !== expected) errors.push(path + '.id must be ' + expected);
  validateReading(point.threshold, path + '.threshold', errors, [-1, 60]);
  validateReading(point.totalDeviation, path + '.totalDeviation', errors, [-60, 60]);
  validateReading(point.patternDeviation, path + '.patternDeviation', errors, [-60, 60]);
  if (!source && tokenIds('probability').indexOf(point.sourceProbability) < 0) errors.push(path + '.sourceProbability is invalid');
}

function validateMetric(metric, key, path, errors) {
  if (!exactKeys(metric, ['value', 'state', 'significance', 'unit', 'numerator', 'denominator'], path, errors)) return;
  required(metric, ['value', 'state'], path, errors);
  finiteOrNull(metric.value, path + '.value', errors);
  if (READ_STATES.indexOf(metric.state) < 0) errors.push(path + '.state is invalid');
  if (metric.state === 'not-read' && metric.value !== null) errors.push(path + ' not-read value must be null');
  if (metric.state === 'read' && metric.value === null && key !== 'fl') errors.push(path + ' read value must be numeric');
  if (metric.significance !== undefined && metric.significance !== null &&
      tokenIds('probability').indexOf(metric.significance) < 0) errors.push(path + '.significance is invalid');
  if (key === 'fl' && metric.state === 'read') {
    if (!Number.isInteger(metric.numerator) || !Number.isInteger(metric.denominator) || metric.denominator <= 0 ||
        metric.numerator < 0 || metric.numerator > metric.denominator) errors.push(path + ' requires a valid numerator/denominator');
  }
}

function validateDevice(device, path, errors) {
  var allowed = GLOBAL_KEYS.concat(['ght', 'fovea']);
  if (!exactKeys(device, allowed, path, errors)) return;
  GLOBAL_KEYS.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(device, key)) errors.push(path + '.' + key + ' is required');
    else validateMetric(device[key], key, path + '.' + key, errors);
  });
  ['ght', 'fovea'].forEach(function (key) {
    if (device[key] !== undefined) validateMetric(device[key], key, path + '.' + key, errors);
  });
}

function validateConventional(value, count, path, errors) {
  // vfi + patternProbabilities arrived with model 2.0.0 (calibrated normative table, computed VFI);
  // reports stored by 1.x lack them and stay valid — both are validated whenever present.
  if (!exactKeys(value, ['modelId', 'modelVersion', 'md', 'psd', 'vfi', 'values', 'patternValues', 'probabilities', 'patternProbabilities', 'diagnostics'], path, errors)) return;
  required(value, ['modelId', 'modelVersion', 'md', 'psd', 'values', 'patternValues', 'probabilities', 'diagnostics'], path, errors);
  if (!String(value.modelId || '') || !String(value.modelVersion || '')) errors.push(path + ' model provenance is required');
  finiteOrNull(value.md, path + '.md', errors);
  finiteOrNull(value.psd, path + '.psd', errors);
  if (value.vfi !== undefined) finiteOrNull(value.vfi, path + '.vfi', errors);
  sized(value.values, count, path + '.values', errors);
  sized(value.patternValues, count, path + '.patternValues', errors);
  sized(value.probabilities, count, path + '.probabilities', errors);
  if (value.patternProbabilities !== undefined) sized(value.patternProbabilities, count, path + '.patternProbabilities', errors);
  if (!plain(value.diagnostics)) errors.push(path + '.diagnostics must be an object');
}

function validateBayesian(value, count, path, errors) {
  if (!exactKeys(value, ['modelId', 'modelVersion', 'posteriorMd', 'values', 'probabilities', 'diagnostics'], path, errors)) return;
  required(value, ['modelId', 'modelVersion', 'posteriorMd', 'values', 'probabilities', 'diagnostics'], path, errors);
  if (!String(value.modelId || '') || !String(value.modelVersion || '')) errors.push(path + ' model provenance is required');
  if (!exactKeys(value.posteriorMd, ['mean', 'std', 'probabilityBelow'], path + '.posteriorMd', errors)) return;
  required(value.posteriorMd, ['mean', 'std', 'probabilityBelow'], path + '.posteriorMd', errors);
  finiteOrNull(value.posteriorMd.mean, path + '.posteriorMd.mean', errors);
  finiteOrNull(value.posteriorMd.std, path + '.posteriorMd.std', errors);
  if (!plain(value.posteriorMd.probabilityBelow)) errors.push(path + '.posteriorMd.probabilityBelow must be an object');
  sized(value.values, count, path + '.values', errors);
  sized(value.probabilities, count, path + '.probabilities', errors);
  if (!plain(value.diagnostics)) errors.push(path + '.diagnostics must be an object');
}

function validateEye(eye, expectedEye, count, path, errors) {
  if (!exactKeys(eye, ['eye', 'ageYears', 'points', 'device', 'testParameters', 'durationSeconds', 'conventional', 'bayesian', 'diagnostics', 'grayscale'], path, errors)) return;
  required(eye, ['eye', 'ageYears', 'points', 'device', 'testParameters', 'durationSeconds', 'conventional', 'bayesian', 'diagnostics', 'grayscale'], path, errors);
  if (eye.eye !== expectedEye) errors.push(path + '.eye must match the ordered study eye');
  if (!Number.isInteger(eye.ageYears) || eye.ageYears < 0 || eye.ageYears > 130) errors.push(path + '.ageYears is invalid');
  sized(eye.points, count, path + '.points', errors);
  if (Array.isArray(eye.points)) eye.points.forEach(function (point, pointIndex) { validatePoint(point, pointIndex, path + '.points[' + pointIndex + ']', errors); });
  validateDevice(eye.device, path + '.device', errors);
  if (!exactKeys(eye.testParameters, TEST_PARAMETER_KEYS, path + '.testParameters', errors)) return;
  if (eye.durationSeconds !== null && (!Number.isInteger(eye.durationSeconds) || eye.durationSeconds < 0)) errors.push(path + '.durationSeconds is invalid');
  validateConventional(eye.conventional, count, path + '.conventional', errors);
  validateBayesian(eye.bayesian, count, path + '.bayesian', errors);
  if (!plain(eye.diagnostics)) errors.push(path + '.diagnostics must be an object');
  if (!exactKeys(eye.grayscale, ['sha256', 'mimeType', 'width', 'height'], path + '.grayscale', errors)) return;
  required(eye.grayscale, ['sha256', 'mimeType', 'width', 'height'], path + '.grayscale', errors);
  if (!/^[a-f0-9]{64}$/.test(String(eye.grayscale.sha256 || '')) || eye.grayscale.mimeType !== 'image/png') errors.push(path + '.grayscale metadata is invalid');
}

function validateReview(review, path, errors) {
  if (!exactKeys(review, ['state', 'corrections', 'artifacts', 'additionalNotes'], path, errors)) return;
  required(review, ['state', 'corrections', 'artifacts', 'additionalNotes'], path, errors);
  if (LIFECYCLES.indexOf(review.state) < 0) errors.push(path + '.state is invalid');
  if (!Array.isArray(review.corrections) || !Array.isArray(review.artifacts)) errors.push(path + ' correction/artifact collections are invalid');
  if (!plain(review.additionalNotes) || Object.keys(review.additionalNotes).some(function (eye) { return EYES.indexOf(eye) < 0; })) errors.push(path + '.additionalNotes is invalid');
  var memberships = {}, names = {};
  (review.corrections || []).forEach(function (correction, index) {
    var itemPath = path + '.corrections[' + index + ']';
    if (!exactKeys(correction, ['eye', 'key', 'extractedValue', 'correctedValue', 'correctedNumerator', 'correctedDenominator', 'reason', 'editor', 'timestamp'], itemPath, errors)) return;
    required(correction, ['eye', 'key', 'extractedValue', 'correctedValue', 'reason', 'editor', 'timestamp'], itemPath, errors);
    if (EYES.indexOf(correction.eye) < 0 || GLOBAL_KEYS.indexOf(correction.key) < 0 || !String(correction.reason || '').trim()) errors.push(itemPath + ' is invalid');
    finiteOrNull(correction.extractedValue, itemPath + '.extractedValue', errors); finiteOrNull(correction.correctedValue, itemPath + '.correctedValue', errors);
  });
  (review.artifacts || []).forEach(function (artifact, index) {
    var itemPath = path + '.artifacts[' + index + ']';
    if (!exactKeys(artifact, ['id', 'eye', 'name', 'color', 'thresholdPointIds'], itemPath, errors)) return;
    required(artifact, ['id', 'eye', 'name', 'color', 'thresholdPointIds'], itemPath, errors);
    var nameKey = artifact.eye + '|' + String(artifact.name || '').trim().toLowerCase();
    if (EYES.indexOf(artifact.eye) < 0 || !nameKey.split('|')[1] || names[nameKey] || !/^#[a-f0-9]{6}$/i.test(String(artifact.color || ''))) errors.push(itemPath + ' is invalid');
    names[nameKey] = true;
    if (!Array.isArray(artifact.thresholdPointIds) || !artifact.thresholdPointIds.length) errors.push(itemPath + ' needs threshold points');
    (artifact.thresholdPointIds || []).forEach(function (pointId) {
      var key = artifact.eye + '|' + pointId;
      if (!/^p(?:[0-4]\d|5[0-3])$/.test(String(pointId || '')) || memberships[key]) errors.push(itemPath + ' has invalid/reassigned point');
      memberships[key] = artifact.id;
    });
  });
}

function validateDraft(draft) {
  var errors = [];
  if (!exactKeys(draft, ['corrections', 'artifacts', 'additionalNotes', 'updatedAt', 'taskVersion', 'analysisStale'], '$', errors)) {
    return { ok: false, errors: errors };
  }
  required(draft, ['corrections', 'artifacts', 'additionalNotes'], '$', errors);
  validateReview({ state: 'preliminary', corrections: draft.corrections, artifacts: draft.artifacts,
    additionalNotes: draft.additionalNotes }, '$', errors);
  if (draft.updatedAt !== undefined && draft.updatedAt !== '' && !/^\d{4}-\d{2}-\d{2}T/.test(String(draft.updatedAt))) errors.push('$.updatedAt is invalid');
  if (draft.taskVersion !== undefined && typeof draft.taskVersion !== 'string') errors.push('$.taskVersion is invalid');
  if (draft.analysisStale !== undefined && typeof draft.analysisStale !== 'boolean') errors.push('$.analysisStale is invalid');
  return { ok: errors.length === 0, errors: errors };
}

function findForbidden(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    var artifactName = key === 'name' && /^\$\.review\.artifacts\.\d+$/.test(path);
    if (!artifactName && FORBIDDEN_KEYS.test(key)) errors.push(path + ' contains forbidden key ' + key);
    findForbidden(value[key], path + '.' + key, errors);
  });
}

function validateStudy(report, errors) {
  if (!exactKeys(report.study, ['testDate', 'pattern', 'eyes', 'sourceSha256'], '$.study', errors)) return;
  required(report.study, ['testDate', 'pattern', 'eyes', 'sourceSha256'], '$.study', errors);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(report.study.testDate || ''))) errors.push('$.study.testDate is invalid');
  if (!pointCountOf(report.study.pattern)) errors.push('$.study.pattern is not a directory pattern');
  var eyes = report.study.eyes;
  var invalidEyes = !Array.isArray(eyes) || !eyes.length || eyes.length > 2;
  invalidEyes = invalidEyes || (Array.isArray(eyes) && eyes.some(function (eye) { return EYES.indexOf(eye) < 0; }));
  invalidEyes = invalidEyes || (Array.isArray(eyes) && eyes.length === 2 && eyes.join('|') !== 'OD|OS');
  if (invalidEyes) errors.push('$.study.eyes must contain OD and/or OS in canonical order');
  if (!/^[a-f0-9]{64}$/.test(String(report.study.sourceSha256 || ''))) errors.push('$.study.sourceSha256 is invalid');
}

function validateProvenance(value, path, errors) {
  if (!exactKeys(value, ['origin', 'device', 'exportFormat', 'capturedAt', 'qualityControl', 'note'], path, errors)) return;
  required(value, ['origin', 'device', 'exportFormat', 'capturedAt'], path, errors);
  if (value.note !== undefined && typeof value.note !== 'string') errors.push(path + '.note must be a string');
  if (value.qualityControl !== undefined && exactKeys(value.qualityControl, ['fixationLossesMax', 'falsePositivesMax', 'falseNegativesMax', 'attestedBy'], path + '.qualityControl', errors)) {
    var qc = value.qualityControl;
    ['fixationLossesMax', 'falsePositivesMax', 'falseNegativesMax'].forEach(function (key) { finiteOrNull(qc[key] === undefined ? null : qc[key], path + '.qualityControl.' + key, errors); });
    if (typeof qc.attestedBy !== 'string') errors.push(path + '.qualityControl.attestedBy must be a string');
  }
  if (ORIGINS.indexOf(value.origin) < 0) errors.push(path + '.origin is invalid');
  if (EXPORT_FORMATS.indexOf(value.exportFormat) < 0) errors.push(path + '.exportFormat is invalid');
  if (value.capturedAt !== null && !/^\d{4}-\d{2}-\d{2}T/.test(String(value.capturedAt))) errors.push(path + '.capturedAt is invalid');
  if (!exactKeys(value.device, ['manufacturer', 'model', 'serial', 'software'], path + '.device', errors)) return;
  ['manufacturer', 'model', 'serial', 'software'].forEach(function (key) {
    var v = value.device[key] === undefined ? null : value.device[key];
    if (v !== null && typeof v !== 'string') errors.push(path + '.device.' + key + ' must be a string or null');
  });
}

function validateSourceEye(eye, expectedEye, count, path, errors) {
  var keys = ['eye', 'ageYears', 'testParameters', 'durationSeconds', 'reliability', 'printout', 'points'];
  if (!exactKeys(eye, keys, path, errors)) return;
  required(eye, ['eye', 'ageYears', 'testParameters', 'durationSeconds', 'reliability', 'points'], path, errors);
  if (eye.eye !== expectedEye) errors.push(path + '.eye must match the ordered study eye');
  if (eye.ageYears !== null && (!Number.isInteger(eye.ageYears) || eye.ageYears < 0 || eye.ageYears > 130)) errors.push(path + '.ageYears is invalid');
  if (!exactKeys(eye.testParameters, TEST_PARAMETER_KEYS, path + '.testParameters', errors)) return;
  if (eye.durationSeconds !== null && (!Number.isInteger(eye.durationSeconds) || eye.durationSeconds < 0)) errors.push(path + '.durationSeconds is invalid');
  if (exactKeys(eye.reliability, ['fp', 'fn', 'fl'], path + '.reliability', errors)) {
    ['fp', 'fn', 'fl'].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(eye.reliability, key)) errors.push(path + '.reliability.' + key + ' is required');
      else validateMetric(eye.reliability[key], key, path + '.reliability.' + key, errors);
    });
  }
  if (eye.printout !== undefined && exactKeys(eye.printout, ['md', 'psd', 'vfi', 'ght'], path + '.printout', errors)) {
    ['md', 'psd', 'vfi'].forEach(function (key) {
      if (eye.printout[key] !== undefined) validateMetric(eye.printout[key], key, path + '.printout.' + key, errors);
    });
    if (eye.printout.ght !== undefined && tokenIds('ght').indexOf(eye.printout.ght) < 0) errors.push(path + '.printout.ght is invalid');
  }
  sized(eye.points, count, path + '.points', errors);
  if (Array.isArray(eye.points)) eye.points.forEach(function (point, index) { validatePoint(point, index, path + '.points[' + index + ']', errors, true); });
}

function validateLabels(value, path, errors) {
  if (!plain(value)) { errors.push(path + ' must be an object'); return; }
  Object.keys(value).forEach(function (key) {
    var v = value[key], scalar = v === null || typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v);
    if (!scalar) errors.push(path + '.' + key + ' must be a finite number, string, boolean, or null');
  });
}

// Optional per-field OCR extraction geometry (two-lane spec §3.5) — additive on source/v1, validated when present
// through the record contract (visual-field-record.js loads beside this module in the persistence closure).
function validateGeometry(list, path, errors) {
  if (!Array.isArray(list)) { errors.push(path + ' must be an array'); return; }
  var record = recordApi;
  list.forEach(function (entry, index) {
    try { if (record) record.makeGeometryEntry(entry); else if (!plain(entry)) throw new Error('must be an object'); }
    catch (error) { errors.push(path + '[' + index + '] ' + error.message); }
  });
}
function validateSource(doc) {
  var errors = [];
  if (!exactKeys(doc, ['schema', 'study', 'provenance', 'eyes', 'labels', 'extractionGeometry'], '$', errors)) return { ok: false, errors: errors };
  required(doc, ['schema', 'study', 'provenance', 'eyes'], '$', errors);
  if (doc.labels !== undefined) validateLabels(doc.labels, '$.labels', errors);
  if (doc.extractionGeometry !== undefined) validateGeometry(doc.extractionGeometry, '$.extractionGeometry', errors);
  if (doc.schema !== SOURCE_SCHEMA) errors.push('$.schema must be ' + SOURCE_SCHEMA);
  if (exactKeys(doc.study, ['testDate', 'pattern', 'eyes'], '$.study', errors)) {
    validateStudy({ study: Object.assign({ sourceSha256: 'a'.repeat(64) }, doc.study) }, errors);
  }
  if (plain(doc.provenance)) validateProvenance(doc.provenance, '$.provenance', errors); else errors.push('$.provenance must be an object');
  if (!Array.isArray(doc.eyes) || !doc.eyes.length || doc.eyes.length > 2) errors.push('$.eyes must contain one or two eyes');
  else doc.eyes.forEach(function (eye, index) { validateSourceEye(eye, doc.study && doc.study.eyes && doc.study.eyes[index], pointCountOf(doc.study && doc.study.pattern), '$.eyes[' + index + ']', errors); });
  if (doc.study && Array.isArray(doc.study.eyes) && Array.isArray(doc.eyes) &&
      doc.study.eyes.join('|') !== doc.eyes.map(function (eye) { return eye.eye; }).join('|')) errors.push('$.study.eyes must match $.eyes');
  findForbidden(doc, '$', errors);
  return { ok: errors.length === 0, errors: errors };
}

function modelEligibilityFromSource(doc) {
  var verdict = validateSource(doc);
  if (!verdict.ok) return { eligible: false, reason: 'schema-invalid', errors: verdict.errors };
  for (var i = 0; i < doc.eyes.length; i += 1) {
    var eye = doc.eyes[i], unread = unreadThresholdCount(eye);
    if (unread > 2) return { eligible: false, reason: 'too-many-unread-thresholds', eye: eye.eye, unreadCount: unread,
      pointIds: eye.points.filter(function (point) { return point.threshold.state === 'not-read'; }).map(function (point) { return point.id; }) };
    if (!Number.isInteger(eye.ageYears)) return { eligible: false, reason: 'age-not-read', eye: eye.eye };
    // Publisher-attested reliability (provenance.qualityControl) stands in for unread FP/FN/FL (Lucas 2026-08-25).
    for (var j = 0; j < 3 && !doc.provenance.qualityControl; j += 1) {
      var key = ['fp', 'fn', 'fl'][j];
      if (eye.reliability[key].state !== 'read') return { eligible: false, reason: key + '-not-read', eye: eye.eye };
    }
  }
  return { eligible: true };
}

function validateExtraction(value) {
  var errors = [];
  if (!exactKeys(value, ['schema', 'pages'], '$', errors)) return { ok: false, errors: errors };
  required(value, ['schema', 'pages'], '$', errors);
  if (value.schema !== EXTRACTION_SCHEMA) errors.push('$.schema must be ' + EXTRACTION_SCHEMA);
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > 2) errors.push('$.pages must contain one or two pages');
  else value.pages.forEach(function (page, index) {
    var path = '$.pages[' + index + ']';
    if (!exactKeys(page, ['eye', 'testDate', 'pattern', 'ageYears', 'points', 'device', 'testParameters', 'durationSeconds', 'ght'], path, errors)) return;
    required(page, ['eye', 'testDate', 'pattern', 'ageYears', 'points', 'device', 'testParameters', 'durationSeconds'], path, errors);
    if (page.eye !== EYES[index] && !(value.pages.length === 1 && EYES.indexOf(page.eye) >= 0)) errors.push(path + '.eye is not in canonical order');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(page.testDate || '')) || !pointCountOf(page.pattern)) errors.push(path + ' is not a dated page of a directory pattern');
    if (!Number.isInteger(page.ageYears) || page.ageYears < 0 || page.ageYears > 130) errors.push(path + '.ageYears is invalid');
    sized(page.points, pointCountOf(page.pattern), path + '.points', errors);
    if (Array.isArray(page.points)) page.points.forEach(function (point, pointIndex) { validatePoint(point, pointIndex, path + '.points[' + pointIndex + ']', errors); });
    validateDevice(page.device, path + '.device', errors);
    if (!plain(page.testParameters)) errors.push(path + '.testParameters must be an object');
  });
  findForbidden(value, '$', errors);
  return { ok: errors.length === 0, errors: errors };
}

function modelEligibilityFromExtraction(value) {
  var verdict = validateExtraction(value);
  if (!verdict.ok) return { eligible: false, reason: 'schema-invalid', errors: verdict.errors };
  for (var i = 0; i < value.pages.length; i += 1) {
    var page = value.pages[i], unread = unreadThresholdCount(page);
    if (unread > 2) return { eligible: false, reason: 'too-many-unread-thresholds', eye: page.eye,
      unreadCount: unread, pointIds: page.points.filter(function (point) { return point.threshold.state === 'not-read'; })
        .map(function (point) { return point.id; }) };
    if (!Number.isInteger(page.ageYears)) return { eligible: false, reason: 'age-not-read', eye: page.eye };
    for (var j = 0; j < 3; j += 1) {
      var key = ['fp', 'fn', 'fl'][j];
      if (page.device[key].state !== 'read') return { eligible: false, reason: key + '-not-read', eye: page.eye };
    }
  }
  return { eligible: true };
}

function validate(report) {
  var errors = [];
  if (!exactKeys(report, ['schema', 'study', 'modelProvenance', 'eyes', 'review'], '$', errors)) return { ok: false, errors: errors };
  required(report, ['schema', 'study', 'modelProvenance', 'eyes', 'review'], '$', errors);
  if (report.schema !== SCHEMA) errors.push('$.schema must be ' + SCHEMA);
  validateStudy(report, errors);
  if (!plain(report.modelProvenance)) errors.push('$.modelProvenance must be an object');
  if (!Array.isArray(report.eyes) || !report.eyes.length || report.eyes.length > 2) errors.push('$.eyes must contain one or two eyes');
  else report.eyes.forEach(function (eye, index) { validateEye(eye, report.study && report.study.eyes && report.study.eyes[index], pointCountOf(report.study && report.study.pattern), '$.eyes[' + index + ']', errors); });
  if (report.study && Array.isArray(report.study.eyes) && Array.isArray(report.eyes) &&
      report.study.eyes.join('|') !== report.eyes.map(function (eye) { return eye.eye; }).join('|')) errors.push('$.study.eyes must match $.eyes');
  validateReview(report.review, '$.review', errors);
  findForbidden(report, '$', errors);
  try {
    if (new TextEncoder().encode(JSON.stringify(report)).byteLength > 500 * 1024) errors.push('$ exceeds 500 KB');
  } catch (_) { errors.push('$ cannot be serialized'); }
  return { ok: errors.length === 0, errors: errors };
}

function unreadThresholdCount(eye) {
  return (eye && Array.isArray(eye.points) ? eye.points : []).filter(function (point) {
    return !point || !point.threshold || point.threshold.state === 'not-read';
  }).length;
}

function modelEligibility(report) {
  var verdict = validate(report);
  if (!verdict.ok) return { eligible: false, reason: 'schema-invalid', errors: verdict.errors };
  var requiredGlobals = ['fp', 'fn', 'fl'];
  for (var i = 0; i < report.eyes.length; i += 1) {
    var eye = report.eyes[i];
    if (unreadThresholdCount(eye) >= 3) return { eligible: false, reason: 'too-many-unread-thresholds', eye: eye.eye };
    if (!Number.isInteger(eye.ageYears)) return { eligible: false, reason: 'age-not-read', eye: eye.eye };
    for (var j = 0; j < requiredGlobals.length; j += 1) {
      if (eye.device[requiredGlobals[j]].state !== 'read') return { eligible: false, reason: requiredGlobals[j] + '-not-read', eye: eye.eye };
    }
  }
  return { eligible: true };
}

var api = Object.freeze({
  SCHEMA: SCHEMA, EXTRACTION_SCHEMA: EXTRACTION_SCHEMA, SOURCE_SCHEMA: SOURCE_SCHEMA,
  ORIGINS: ORIGINS.slice(), EXPORT_FORMATS: EXPORT_FORMATS.slice(), EYES: EYES.slice(), GLOBAL_KEYS: GLOBAL_KEYS.slice(),
  validate: validate, validateSource: validateSource, validateExtraction: validateExtraction, validateDraft: validateDraft,
  modelEligibility: modelEligibility, modelEligibilityFromSource: modelEligibilityFromSource,
  modelEligibilityFromExtraction: modelEligibilityFromExtraction, unreadThresholdCount: unreadThresholdCount
});
export { api, api as 'module.exports' };
