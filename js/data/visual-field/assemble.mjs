// [Active · data layer · born ESM] assemble — labelled Points → one `visual-field-source` + N `visual-field-test`
// entities, through `attributes.home` (native-entity spec §5): a Point lands where the directory says its attribute
// lives; a Point whose id the directory does not name is refused. Also the JSON-lane port (source/v1 + computed
// analysis → the same graph). Pure and deterministic: identities are minted afterwards by `model.stampIdentities`.
const GRID_ID = /^(.*\.p)(\d{2})$/;

function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function attributeIdOf(pointId) { const m = GRID_ID.exec(pointId); return m ? m[1] : pointId; }
function pointIdOf(pointId) { const m = GRID_ID.exec(pointId); return m ? 'p' + m[2] : null; }
function readValue(points, id) { const p = points.find((q) => q.id === id); return p && p.status === 'read' ? p.value.value : undefined; }
function ageYears(birth, test) {
  if (!birth || !test) return null;
  const b = birth.split('-').map(Number), t = test.split('-').map(Number);
  return t[0] - b[0] - ((t[1] < b[1] || (t[1] === b[1] && t[2] < b[2])) ? 1 : 0);
}
function provenance({ id, home, page, rect, reader, raw, value, status }) { return { id, home, page, rect, reader, raw, value, status }; }
// A token attribute is typed by its directory, whatever the reader emitted: an id stays, a legacy code or the printed
// text resolves through the vocabulary, anything else is honestly not-extracted.
function typedCell(model, directories, attr, point) {
  const type = String(attr.type);
  if (model.isAbsence(point.value)) return point.value.state === 'not-extracted' ? model.NOT_EXTRACTED : model.NOT_PRESENT;
  if (!type.startsWith('token:') || !model.isTyped(point.value)) return point.value;
  const name = type.slice(6), entries = directories.vocabulary(name) || [], value = point.value.value;
  if (entries.some((e) => e.id === value)) return point.value;
  const legacy = entries.find((e) => e.legacy === value);
  const id = legacy ? legacy.id : directories.resolve(name, typeof value === 'string' ? value : point.raw);
  return id ? Object.assign({}, point.value, { value: id }) : model.NOT_EXTRACTED;
}

// Every attribute the protocol has NO region for is honestly absent: the protocol is the declaration of what the source
// prints, so `not-extracted` only ever means a region that failed to read. Bare homes and source homes are skipped.
function fillUncovered(model, directories, test, covered) {
  directories.attributes.entries.forEach((attr) => {
    if (covered.has(attr.id) || attr.home.startsWith('source.')) return;
    if (attr.grid) {
      const isMeasurement = attr.home === 'measurement.points.p';
      test.measurement.grid.points.forEach((g) => model.setHome(test, attr.home, model.NOT_PRESENT, g.id));
      if (isMeasurement) return;
    } else if (attr.home === 'acquisition.testDate' || attr.home === 'testDefinition.pattern' || attr.home === 'measurement.eye') return;
    else if (model.isAbsence(model.getHome(test, attr.home))) model.setHome(test, attr.home, model.NOT_PRESENT);
  });
}

function buildSource(model, directories, { registration, file, subject, encounter, deposit }) {
  const source = model.emptySource();
  Object.assign(source, { file: Object.assign({}, file), format: registration.format, vendor: registration.vendor || 'unknown',
    device: registration.device || '', software: registration.software || '', reportKind: registration.reportKind,
    protocol: registration.protocol ? { id: registration.protocol.id, version: registration.protocol.version } : null,
    registration: { detectedAt: registration.detectedAt || deposit.at || '', anchorsMatched: registration.anchorsMatched || 0, pageSize: registration.pageSize || null },
    subject, encounter: encounter || '', deposit: { at: deposit.at, by: deposit.by } });
  return source;
}

function assembleTest(model, directories, { source, page, index, pagePoints, instancePoints, registration }) {
  const eye = readValue(pagePoints, 'identity.eye');
  if (eye !== 'OD' && eye !== 'OS') throw new Error('assembly: eye unread on page ' + page);
  const pattern = readValue(instancePoints, 'testDefinition.pattern');
  if (!pattern || !directories.pattern(pattern)) throw new Error('assembly: pattern unread on page ' + page + ' block ' + index);
  const test = model.emptyTest(pattern, eye), covered = new Set();
  test.subject = source.subject;
  pagePoints.concat(instancePoints).forEach((p) => {
    const attr = directories.attribute(attributeIdOf(p.id));
    if (!attr) throw new Error('assembly: Point ' + p.id + ' is not an attribute');
    if (attr.home !== p.home) throw new Error('assembly: Point ' + p.id + ' names home ' + p.home + ', the directory says ' + attr.home);
    covered.add(attr.id);
    if (attr.home.startsWith('source.')) return;
    model.setHome(test, attr.home, typedCell(model, directories, attr, p), attr.grid ? pointIdOf(p.id) : undefined);
  });
  fillUncovered(model, directories, test, covered);
  const vendor = directories.entry('vendors', registration.vendor);
  if (vendor && vendor.id !== 'unknown') test.acquisition.device.manufacturer = model.cell(vendor.label);
  const years = ageYears(readValue(pagePoints, 'identity.birthDate'), test.acquisition.testDate);
  if (years !== null) test.acquisition.ageYears = { value: years, derived: true };
  const software = test.acquisition.device.software;
  const printed = model.printedBlock(test);
  printed.engineVersion = model.isTyped(software) ? String(software.value) : '';
  test.extraction = { protocol: source.protocol, contentSha256: source.file.sha256, page, index, points: instancePoints.concat(pagePoints).map(provenance) };
  return test;
}

// registration = { protocol: { id, version } | null, format, vendor, device, software, reportKind, anchorsMatched, pageSize, detectedAt? }
// pages = [{ page, points }] from the extractor; page-scoped Points (no block) fill the source and every test of the
// page; block Points fill their test. An unanchored instance never reaches here (extract drops it).
export function assembleGraph({ model, directories, registration, pages, file, subject, encounter, deposit }) {
  if (!registration || !file || !subject) throw new Error('assembleGraph needs registration, file and subject');
  const source = buildSource(model, directories, { registration, file, subject, encounter, deposit });
  const tests = [];
  (pages || []).forEach((entry) => {
    const pagePoints = entry.points.filter((p) => !p.block), instances = new Map();
    entry.points.forEach((p) => { if (p.block) { if (!instances.has(p.block.index)) instances.set(p.block.index, []); instances.get(p.block.index).push(p); } });
    pagePoints.forEach((p) => {
      const attr = directories.attribute(attributeIdOf(p.id));
      if (!attr) throw new Error('assembly: Point ' + p.id + ' is not an attribute');
      // page-scoped source cells: the first page that reads a value wins
      if (attr.home.startsWith('source.') && model.isAbsence(model.getSourceHome(source, attr.home))) model.setSourceHome(source, attr.home, typedCell(model, directories, attr, p));
    });
    [...instances.keys()].sort((a, b) => a - b).forEach((index) => {
      tests.push(assembleTest(model, directories, { source, page: entry.page, index, pagePoints, instancePoints: instances.get(index), registration }));
    });
  });
  // source cells no page Point named are honestly absent
  directories.attributes.entries.filter((a) => a.home.startsWith('source.')).forEach((a) => {
    if (model.getSourceHome(source, a.home) === model.NOT_EXTRACTED) model.setSourceHome(source, a.home, model.NOT_PRESENT);
  });
  source.parseState = tests.length ? 'parsed' : 'unparsed';
  source.testCount = tests.length;
  return { source, tests };
}

// ---- JSON lane: source/v1 (+ an in-house computed analysis) → the same graph (port of record-assembly#buildRecord) ----
const CLINIC_ORIGINS = ['ocr', 'device-export'];
function isRead(cell) { return plain(cell) && cell.state === 'read' && cell.value !== null && cell.value !== undefined; }
function readCell(cell, unit, absence) {
  if (!isRead(cell)) return absence;
  const typed = unit === undefined ? { value: cell.value } : { value: cell.value, unit };
  if (cell.censored) typed.censored = true;
  if (Number.isFinite(cell.numerator) && Number.isFinite(cell.denominator)) { typed.numerator = cell.numerator; typed.denominator = cell.denominator; }
  if (typeof cell.significance === 'string') typed.probability = cell.significance;
  return typed;
}
function valueCell(value, unit, absence) { return value === null || value === undefined || value === '' ? absence : (unit === undefined ? { value } : { value, unit }); }
function tokenCell(directories, name, text, absence) {
  if (text === null || text === undefined || text === '') return absence;
  const legacy = (directories.vocabulary(name) || []).find((e) => e.legacy === text);
  const id = legacy ? legacy.id : directories.resolve(name, text);
  return id ? { value: id } : { state: 'not-extracted' };
}
function stimulusCell(directories, text, absence) {
  if (!text) return absence;
  const size = directories.resolve('stimuli', text), color = directories.resolve('stimuli.colors', text);
  return size ? { value: { size, color: color || '' } } : { state: 'not-extracted' };
}
function backgroundCell(text, absence) {
  if (!text) return absence;
  const m = /(\d+(?:\.\d+)?)\s*asb/i.exec(String(text));
  return m ? { value: Number(m[1]), unit: 'asb' } : { state: 'not-extracted' };
}
function deviceTokens(directories, device) {
  const manufacturer = plain(device) && plain(device.manufacturer) ? device.manufacturer.value : null;
  const vendor = manufacturer ? directories.resolve('vendors', String(manufacturer)) : null;
  const entry = vendor ? directories.entry('vendors', vendor) : null;
  const modelText = plain(device) && plain(device.model) ? String(device.model.value || '') : '';
  const hit = entry ? (entry.devices || []).find((d) => (d.aliases || []).some((a) => modelText.toLowerCase().indexOf(a) >= 0)) : null;
  return { vendor: vendor || 'unknown', device: hit ? hit.id : '', software: '' };
}
function printedBlockFromSource(model, sourceEye, absence) {
  const printout = sourceEye.printout || {};
  const hasValues = ['md', 'psd', 'vfi'].some((key) => isRead(printout[key])) || (printout.ght && printout.ght !== 'not-read') ||
    sourceEye.points.some((point) => isRead(point.totalDeviation) || isRead(point.patternDeviation));
  if (!hasValues) return null;
  return { origin: 'printed', engineVersion: '', values: {
    md: readCell(printout.md, 'dB', absence), psd: readCell(printout.psd, 'dB', absence), vfi: readCell(printout.vfi, '%', absence),
    ght: typeof printout.ght === 'string' && printout.ght !== 'not-read' ? { value: printout.ght } : absence,
    mdHemifield: model.NOT_PRESENT, sf: model.NOT_PRESENT, cpsd: model.NOT_PRESENT,
    points: sourceEye.points.map((point) => ({ id: point.id, totalDeviation: readCell(point.totalDeviation, 'dB', absence), patternDeviation: readCell(point.patternDeviation, 'dB', absence),
      totalDeviationProbability: model.NOT_PRESENT, patternDeviationProbability: model.NOT_PRESENT })) } };
}
// A computed block from the engine's result: values by point INDEX in `pointIds` order; a probability that is not a
// vocabulary token (the engine marks blind-spot cells 'not-read') is an absence. Shared by the JSON lane at deposit
// and Dev View's on-demand analysis of a clinic-lane test (two-lane spec §4).
function computedBlockOf(model, pointIds, result, probabilityOk, computedAt) {
  const provenance = result.provenance || {}, conventional = result.conventional, normative = provenance.normative || {};
  const none = model.NOT_PRESENT, at = (list, index, unit) => valueCell(list && list[index], unit, none);
  const probability = (list, index) => { const v = list && list[index]; return v && probabilityOk(v) ? { value: v } : none; };
  const block = { origin: 'computed', engineVersion: String(conventional.modelId + '@' + conventional.modelVersion),
    datasetId: String(provenance.datasetId || normative.id || 'unknown'), datasetVersion: String(provenance.datasetVersion || normative.version || 'unknown'),
    values: { md: valueCell(conventional.md, 'dB', none), psd: valueCell(conventional.psd, 'dB', none), vfi: valueCell(conventional.vfi, '%', none),
      ght: none, mdHemifield: none, sf: none, cpsd: none,
      points: pointIds.map((id, index) => ({ id, totalDeviation: at(conventional.values, index, 'dB'), patternDeviation: at(conventional.patternValues, index, 'dB'),
        totalDeviationProbability: probability(conventional.probabilities, index), patternDeviationProbability: probability(conventional.patternProbabilities, index) })) } };
  if (computedAt) block.computedAt = String(computedAt);
  return block;
}
function probabilityTokens(directories) { const set = new Set((directories.vocabulary('probability') || []).map((e) => e.id)); return (v) => set.has(v); }
function computedBlock(model, directories, sourceEye, computed) {
  const result = computed && computed.result ? computed.result : computed;
  return computedBlockOf(model, sourceEye.points.map((p) => p.id), result, probabilityTokens(directories), undefined);
}
// Dev View: the engine's { conventional, provenance } over a stored test → a provenance-stamped computed block.
export function computedBlockForTest(model, directories, test, result, { now, overlays } = {}) {
  const block = computedBlockOf(model, test.measurement.points.map((p) => p.id), result, probabilityTokens(directories), (now || (() => new Date().toISOString()))());
  if (overlays && typeof overlays === 'object' && !Array.isArray(overlays) && Object.keys(overlays).length) block.overlays = overlays;
  return block;
}
function testFromSourceEye(model, directories, { sourceDoc, sourceEye, index, computed, source }) {
  const clinic = CLINIC_ORIGINS.indexOf(sourceDoc.provenance.origin) >= 0, absence = clinic ? model.NOT_EXTRACTED : model.NOT_PRESENT;
  const test = model.emptyTest(sourceDoc.study.pattern, sourceEye.eye), device = sourceDoc.provenance.device || {}, parameters = sourceEye.testParameters || {};
  test.subject = source.subject;
  ['name', 'birthDate', 'patientId', 'sex'].forEach((key) => { test.identity[key] = absence; });
  ['manufacturer', 'model', 'serial', 'software'].forEach((key) => { test.acquisition.device[key] = valueCell(plain(device[key]) ? device[key].value : undefined, undefined, absence); });
  test.acquisition.testDate = sourceDoc.study.testDate;
  ['testTime', 'pupilDiameterMm', 'refraction', 'visualAcuity', 'fixationMonitor'].forEach((key) => { test.acquisition[key] = absence; });
  test.acquisition.durationSeconds = valueCell(sourceEye.durationSeconds, 's', absence);
  test.acquisition.ageYears = valueCell(sourceEye.ageYears, undefined, absence);
  test.acquisition.fixationTarget = tokenCell(directories, 'fixation.targets', parameters.fixationTarget, absence);
  test.testDefinition.strategy = tokenCell(directories, 'strategies', parameters.strategy, absence);
  test.testDefinition.stimulus = stimulusCell(directories, parameters.stimulus, absence);
  test.testDefinition.background = backgroundCell(parameters.background, absence);
  const reliability = sourceEye.reliability || {};
  const byId = new Map(sourceEye.points.map((p) => [p.id, p]));
  test.measurement.points = test.measurement.grid.points.map((g) => {
    const point = byId.get(g.id);
    return { id: g.id, threshold: point ? readCell(point.threshold, 'dB', model.NOT_EXTRACTED) : model.NOT_EXTRACTED, stimulusResult: absence };
  });
  test.measurement.foveaThreshold = absence; test.measurement.blindSpot = absence; test.measurement.gaze = model.NOT_PRESENT;
  test.measurement.reliability = { fl: readCell(reliability.fl, undefined, absence), fp: readCell(reliability.fp, '%', absence), fn: readCell(reliability.fn, '%', absence), message: absence };
  const printed = printedBlockFromSource(model, sourceEye, absence);
  if (printed) test.analyses.push(printed);
  if (computed) test.analyses.push(computedBlock(model, directories, sourceEye, computed));
  test.extraction = { protocol: null, contentSha256: source.file.sha256, page: 0, index, points: [] };
  return test;
}
// sourceDoc = visual-field-source/v1; computed = [perEye { result: { conventional, provenance } }] | null.
export function assembleFromSourceDocument({ model, directories, sourceDoc, computed, file, subject, encounter, deposit }) {
  const format = directories.resolve('formats', String(sourceDoc.provenance.exportFormat || '')) || 'threshold-json';
  const kind = directories.reportKinds.entries.find((k) => k.format === format && k.protocolId === null) || directories.reportKind('threshold-json');
  const tokens = deviceTokens(directories, sourceDoc.provenance.device);
  const source = buildSource(model, directories, { registration: { protocol: null, format: kind.format, vendor: tokens.vendor, device: tokens.device, software: tokens.software,
    reportKind: kind.id, anchorsMatched: 0, pageSize: null }, file, subject, encounter, deposit });
  directories.attributes.entries.filter((a) => a.home.startsWith('source.')).forEach((a) => model.setSourceHome(source, a.home, model.NOT_PRESENT));
  const tests = sourceDoc.eyes.map((sourceEye, index) => testFromSourceEye(model, directories, { sourceDoc, sourceEye, index, computed: Array.isArray(computed) ? computed[index] : null, source }));
  source.parseState = tests.length ? 'parsed' : 'unparsed';
  source.testCount = tests.length;
  return { source, tests };
}
