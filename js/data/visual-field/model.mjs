// [Active · data layer · born ESM] The visual-field native-entity model — cells, the graph shape
// (`visual-field-source` + `visual-field-test[]`), a validator generated from the attributes directory, identity
// minting from declared seeds, and the projections every surface reads (title, summarize, groupBy).
// Spec: docs/superpowers/specs/2026-08-27-visual-field-native-entity-design.md §3, §10 D1/D2. Pure and deterministic:
// no clock, no randomness, no globals — hashing is injected.
export const SOURCE_SCHEMA = 'ophthoscribe.visual-field-source.v1';
export const TEST_SCHEMA = 'ophthoscribe.visual-field-test.v1';
export const SOURCES_COLLECTION = 'visual-field-sources';
export const COORDINATE_BASIS = 'degrees-od-normalized';
export const NOT_EXTRACTED = Object.freeze({ state: 'not-extracted' });
export const NOT_PRESENT = Object.freeze({ state: 'not-present-in-source' });

const STORED_KEYS = ['id', 'meta'];
const SOURCE_KEYS = ['schema', 'identifier', 'file', 'format', 'vendor', 'device', 'software', 'reportKind', 'protocol', 'registration',
  'parseState', 'testCount', 'subject', 'encounter', 'deposit', 'facility', 'reportKindLabel', 'reportTitle', 'createdAt', 'pageOf', 'sourceFile'];
const TEST_KEYS = ['schema', 'identifier', 'source', 'subject', 'identity', 'acquisition', 'testDefinition', 'measurement', 'analyses', 'extraction', 'review', 'seams'];
const IDENTITY_KEYS = ['name', 'birthDate', 'patientId', 'sex'];
const DEVICE_KEYS = ['manufacturer', 'model', 'serial', 'software'];
const ACQUISITION_KEYS = ['device', 'testDate', 'testTime', 'durationSeconds', 'ageYears', 'pupilDiameterMm', 'refraction', 'visualAcuity', 'fixationMonitor', 'fixationTarget'];
const TEST_DEFINITION_KEYS = ['pattern', 'strategy', 'stimulus', 'background'];
const MEASUREMENT_KEYS = ['eye', 'grid', 'points', 'foveaThreshold', 'blindSpot', 'reliability', 'gaze'];
const RELIABILITY_KEYS = ['fl', 'fp', 'fn', 'message'];
const BLOCK_KEYS = ['origin', 'engineVersion', 'datasetId', 'datasetVersion', 'computedAt', 'values', 'overlays'];   // overlays: { <layerId>: payload } on computed blocks (spec §5)
const VALUE_CELLS = ['md', 'psd', 'vfi', 'ght', 'mdHemifield', 'sf', 'cpsd'];
const VALUE_POINT_CELLS = ['totalDeviation', 'patternDeviation', 'totalDeviationProbability', 'patternDeviationProbability'];
const EXTRACTION_KEYS = ['protocol', 'contentSha256', 'page', 'index', 'points'];
const POINT_KEYS = ['id', 'home', 'page', 'rect', 'reader', 'raw', 'value', 'status'];
const SEAM_KEYS = ['artifacts', 'findings', 'overlays'];
// Bare scalars on the test: structural keys the validator types directly, not cells.
const BARE_HOMES = ['acquisition.testDate', 'testDefinition.pattern', 'measurement.eye'];

function plain(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function has(v, key) { return plain(v) && Object.prototype.hasOwnProperty.call(v, key); }
function isAbsence(v) { return plain(v) && (v.state === 'not-extracted' || v.state === 'not-present-in-source') && Object.keys(v).length === 1; }
function isTyped(v) { return has(v, 'value') && !('state' in v); }
function isCell(v) { return isAbsence(v) || isTyped(v); }
function text(v) { return typeof v === 'string' && v.length > 0; }
function finite(v) { return typeof v === 'number' && isFinite(v); }
function isoDate(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
function cell(value, unit) { return unit === undefined ? { value } : { value, unit }; }
function show(v) { try { return JSON.stringify(v); } catch (_) { return String(v); } }

export function createModel(directories, { hashHex } = {}) {
  const states = directories.states;
  const probabilityIds = (directories.vocabulary('probability') || []).map((e) => e.id);
  const tokenIds = (name) => (directories.vocabulary(name) || []).map((e) => e.id);
  const attributes = directories.attributes.entries;

  // ---- construction -------------------------------------------------------------------------------------------
  function emptySource() {
    return { schema: SOURCE_SCHEMA, identifier: '', file: { sha256: '', name: '', mime: '', bytes: 0, pageCount: 0 },
      format: 'pdf-printout', vendor: 'unknown', device: '', software: '', reportKind: 'unrecognised', protocol: null,
      registration: { detectedAt: '', anchorsMatched: 0, pageSize: null }, parseState: 'unparsed', testCount: 0,
      subject: '', encounter: '', deposit: { at: '', by: '' },
      facility: { name: NOT_EXTRACTED, address: NOT_EXTRACTED, phone: NOT_EXTRACTED },
      reportKindLabel: NOT_EXTRACTED, reportTitle: NOT_EXTRACTED, createdAt: NOT_EXTRACTED, pageOf: NOT_EXTRACTED };
  }
  function emptyTest(patternId, eye) {
    const grid = directories.patternPoints(patternId, eye), NE = NOT_EXTRACTED, NP = NOT_PRESENT;
    return { schema: TEST_SCHEMA, identifier: '', source: '', subject: '',
      identity: { name: NE, birthDate: NE, patientId: NE, sex: NE },
      acquisition: { device: { manufacturer: NE, model: NE, serial: NE, software: NE }, testDate: '', testTime: NE, durationSeconds: NE, ageYears: NE,
        pupilDiameterMm: NE, refraction: NE, visualAcuity: NE, fixationMonitor: NE, fixationTarget: NE },
      testDefinition: { pattern: patternId, strategy: NE, stimulus: NE, background: NE },
      measurement: { eye, grid: { pattern: patternId, coordinateBasis: COORDINATE_BASIS, points: grid },
        points: grid.map((g) => ({ id: g.id, threshold: NE, stimulusResult: NP })),
        foveaThreshold: NE, blindSpot: NP, reliability: { fl: NE, fp: NE, fn: NE, message: NP }, gaze: NP },
      analyses: [], extraction: { protocol: null, contentSha256: '', page: 0, index: 0, points: [] },
      review: { state: 'awaiting-review', at: '', by: '' }, seams: { artifacts: [], findings: [], overlays: [] } };
  }
  function emptyBlock(test, origin) {
    const NE = origin === 'printed' ? NOT_EXTRACTED : NOT_PRESENT;
    return { origin, engineVersion: '', values: { md: NE, psd: NE, vfi: NE, ght: NE, mdHemifield: NOT_PRESENT, sf: NOT_PRESENT, cpsd: NOT_PRESENT,
      points: test.measurement.grid.points.map((g) => ({ id: g.id, totalDeviation: NE, patternDeviation: NE, totalDeviationProbability: NE, patternDeviationProbability: NE })) } };
  }
  function printedBlock(test) {
    let block = test.analyses.find((b) => b.origin === 'printed');
    if (!block) { block = emptyBlock(test, 'printed'); test.analyses.unshift(block); }
    return block;
  }

  // ---- homes ----------------------------------------------------------------------------------------------------
  // Grammar: 'a.b.c' = a scalar on the test; 'analyses.printed.<key>' = the printed block's values; '<…>.points.p[.<field>]'
  // = one point by id (the field defaults to `threshold` on the measurement grid). Source homes are 'source.<…>'.
  function locate(test, home, pointId) {
    const parts = String(home).split('.');
    let node = test;
    if (parts[0] === 'analyses' && parts[1] === 'printed') { node = printedBlock(test).values; parts.splice(0, 2); }
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i] === 'points' && parts[i + 1] === 'p') {
        if (!Array.isArray(node.points)) throw new Error('bad home ' + home);
        const point = node.points.find((p) => p.id === pointId);
        if (!point) throw new Error('unknown point ' + pointId + ' for ' + home);
        const field = parts[i + 2] || (node === test.measurement ? 'threshold' : null);
        if (!field || !has(point, field)) throw new Error('bad home ' + home);
        return { node: point, key: field };
      }
      if (i === parts.length - 1) { if (!has(node, parts[i])) throw new Error('bad home ' + home); return { node, key: parts[i] }; }
      node = plain(node) ? node[parts[i]] : undefined;
      if (node === undefined) throw new Error('bad home ' + home);
    }
    throw new Error('bad home ' + home);
  }
  // Bare homes take the cell's value (an absence becomes ''); every other home stores the cell itself.
  function setHome(test, home, value, pointId) {
    const { node, key } = locate(test, home, pointId);
    node[key] = BARE_HOMES.indexOf(home) < 0 ? value : isTyped(value) ? value.value : isAbsence(value) ? '' : value;
  }
  function getHome(test, home, pointId) { const { node, key } = locate(test, home, pointId); return node[key]; }
  function setSourceHome(source, home, value) {
    const parts = String(home).replace(/^source\./, '').split('.');
    let node = source;
    for (let i = 0; i < parts.length - 1; i += 1) { node = plain(node) ? node[parts[i]] : undefined; if (node === undefined) throw new Error('bad home ' + home); }
    if (!has(node, parts[parts.length - 1])) throw new Error('bad home ' + home);
    node[parts[parts.length - 1]] = value;
  }
  function getSourceHome(source, home) {
    let node = source;
    String(home).replace(/^source\./, '').split('.').forEach((key) => { node = plain(node) ? node[key] : undefined; });
    return node;
  }

  // ---- identities -------------------------------------------------------------------------------------------------
  const sourceSeed = ({ sha256, patientId }) => sha256 + '|' + patientId;
  // A test's identity carries the patient like its source's: the same file dropped on a second patient must mint NEW
  // tests — a conditional create on a patient-blind identity would silently bind them to the first patient's.
  const testSeed = ({ sourceSha256, patientId, eye, testDate, testTime, page, index }) => [sourceSha256, patientId || '', eye, testDate, testTime || '', page + ':' + index].join('|');
  function requireHash() { if (typeof hashHex !== 'function') throw new Error('createModel needs a hashHex(text) for synchronous identities'); return hashHex; }
  const sourceIdentity = (seed) => 'vfs-' + requireHash()(sourceSeed(seed)).slice(0, 48);
  const testIdentity = (seed) => 'vft-' + requireHash()(testSeed(seed)).slice(0, 48);
  function testSeedOf(source, test) {
    const time = test.acquisition.testTime;
    return { sourceSha256: source.file.sha256, patientId: patientIdOf(source.subject), eye: test.measurement.eye, testDate: test.acquisition.testDate,
      testTime: isTyped(time) ? String(time.value) : '', page: test.extraction.page, index: test.extraction.index };
  }
  const patientIdOf = (subject) => String(subject || '').split('/')[1] || '';
  // The browser hashes asynchronously (crypto.subtle); every identity seed is hashed in one pass, then linked.
  async function stampIdentities(graph, sha256HexAsync) {
    const [sourceHash, ...testHashes] = await Promise.all([sourceSeed({ sha256: graph.source.file.sha256, patientId: patientIdOf(graph.source.subject) })]
      .concat(graph.tests.map((t) => testSeed(testSeedOf(graph.source, t)))).map((seed) => sha256HexAsync(seed)));
    graph.source.identifier = 'vfs-' + sourceHash.slice(0, 48);
    graph.tests.forEach((t, i) => { t.identifier = 'vft-' + testHashes[i].slice(0, 48); t.source = SOURCES_COLLECTION + '/' + graph.source.identifier; t.subject = graph.source.subject; });
    return graph;
  }

  // ---- validation ---------------------------------------------------------------------------------------------------
  function exactKeys(value, allowed, path, errors, stored) {
    if (!plain(value)) { errors.push(path + ' must be an object'); return false; }
    Object.keys(value).forEach((key) => { if (allowed.indexOf(key) < 0 && !(stored && STORED_KEYS.indexOf(key) >= 0)) errors.push(path + ' contains unsupported key ' + key); });
    return true;
  }
  function cellsAt(node, keys, path, errors) { keys.forEach((key) => { if (!isCell(node[key])) errors.push(path + '.' + key + ' must be a typed cell or an absence'); }); }
  function oneOf(value, allowed, path, errors) { if (allowed.indexOf(value) < 0) errors.push(path + ' must be one of ' + allowed.join(', ') + ' (got ' + show(value) + ')'); }
  function typedValue(v, attr) {
    const type = String(attr.type);
    if (type.startsWith('token:')) return tokenIds(type.slice(6)).indexOf(v) >= 0 ? null : show(v) + ' is not a ' + type.slice(6) + ' token';
    const ok = type === 'integer' ? Number.isInteger(v) : type === 'decimal' ? finite(v) : type === 'date' ? isoDate(v)
      : type === 'time' ? typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v) : type === 'flag' ? typeof v === 'boolean'
        : type === 'version' ? typeof v === 'string' && /^\d+(\.\d+)+$/.test(v) : type === 'pageOf' ? plain(v) && Number.isInteger(v.page) && Number.isInteger(v.of)
          : type === 'probability' ? probabilityIds.indexOf(v) >= 0 : type === 'struct' ? plain(v) : type === 'text' ? typeof v === 'string' : type === 'ratio' ? v === null || finite(v) : false;
    return ok ? null : 'expected ' + type + ', got ' + show(v);
  }
  function checkCell(value, attr, path, errors) {
    if (isAbsence(value)) return;
    if (!isTyped(value)) { errors.push(path + ' must be a typed cell or an absence'); return; }
    if (attr.type === 'ratio' && !(Number.isInteger(value.numerator) && Number.isInteger(value.denominator))) errors.push(path + ': ratio needs numerator and denominator');
    const problem = typedValue(value.value, attr);
    if (problem) errors.push(path + ': ' + problem);
  }
  function checkBare(value, attr, path, errors) {
    const problem = typedValue(value, attr);
    if (problem) errors.push(path + ': ' + problem);
  }
  // Every attribute in the directory types the cell(s) at its home — on the source, on the test, in every analysis block.
  function checkAttributes(source, test, index, errors) {
    const at = (path) => 'tests[' + index + '].' + path;
    attributes.forEach((attr) => {
      if (attr.home.startsWith('source.')) { if (test === null) checkCell(getSourceHome(source, attr.home), attr, 'source.' + attr.home.slice(7), errors); return; }
      if (test === null) return;
      if (attr.home.startsWith('analyses.printed.')) {
        const rest = attr.home.slice('analyses.printed.'.length).split('.');
        test.analyses.forEach((block, b) => {
          if (!plain(block.values)) return;
          if (rest[0] === 'points') block.values.points.forEach((p, i) => checkCell(p[rest[2]], attr, at('analyses[' + b + '].values.points[' + i + '].' + rest[2]), errors));
          else checkCell(block.values[rest[0]], attr, at('analyses[' + b + '].values.' + rest[0]), errors);
        });
        return;
      }
      if (attr.grid) { test.measurement.points.forEach((p, i) => checkCell(p.threshold, attr, at('measurement.points[' + i + '].threshold'), errors)); return; }
      let node = test;
      const parts = attr.home.split('.');
      for (let i = 0; i < parts.length - 1; i += 1) node = plain(node) ? node[parts[i]] : undefined;
      if (!plain(node)) return;  // the structural pass already reported the missing section
      const value = node[parts[parts.length - 1]];
      if (BARE_HOMES.indexOf(attr.home) >= 0) checkBare(value, attr, at(attr.home), errors); else checkCell(value, attr, at(attr.home), errors);
    });
  }
  function checkSource(source, errors) {
    if (!exactKeys(source, SOURCE_KEYS, 'source', errors, true)) return;
    if (source.schema !== SOURCE_SCHEMA) errors.push('source.schema must be ' + SOURCE_SCHEMA);
    if (!/^vfs-[0-9a-f]{48}$/.test(String(source.identifier))) errors.push('source.identifier must be vfs-<48 hex>');
    if (exactKeys(source.file, ['sha256', 'name', 'mime', 'bytes', 'pageCount'], 'source.file', errors)) {
      if (!/^[0-9a-f]{64}$/.test(String(source.file.sha256))) errors.push('source.file.sha256 must be 64 hex characters');
      if (typeof source.file.name !== 'string' || typeof source.file.mime !== 'string') errors.push('source.file.name and mime must be strings');
      if (!Number.isInteger(source.file.bytes) || !Number.isInteger(source.file.pageCount)) errors.push('source.file.bytes and pageCount must be integers');
    }
    if (source.sourceFile !== undefined && !(plain(source.sourceFile) && /^[0-9a-f]{64}$/.test(String(source.sourceFile.sha256)) && text(source.sourceFile.mime))) errors.push('source.sourceFile needs sha256 and mime');
    oneOf(source.format, tokenIds('formats'), 'source.format', errors);
    oneOf(source.vendor, tokenIds('vendors'), 'source.vendor', errors);
    if (typeof source.device !== 'string' || typeof source.software !== 'string') errors.push('source.device and software must be tokens or empty strings');
    const kind = directories.reportKind(source.reportKind);
    if (!kind) errors.push('source.reportKind ' + show(source.reportKind) + ' is not a report-kinds token');
    else if (kind.format !== source.format) errors.push('source.format ' + source.format + ' must be the report kind\'s format ' + kind.format + ' (' + source.reportKind + ')');
    if (source.protocol !== null && !(plain(source.protocol) && text(source.protocol.id) && Number.isInteger(source.protocol.version))) errors.push('source.protocol must be null or { id, version }');
    if (exactKeys(source.registration, ['detectedAt', 'anchorsMatched', 'pageSize'], 'source.registration', errors)) {
      if (typeof source.registration.detectedAt !== 'string' || !Number.isInteger(source.registration.anchorsMatched)) errors.push('source.registration needs detectedAt and anchorsMatched');
      if (source.registration.pageSize !== null && !(plain(source.registration.pageSize) && finite(source.registration.pageSize.width) && finite(source.registration.pageSize.height))) errors.push('source.registration.pageSize must be null or { width, height }');
    }
    oneOf(source.parseState, states.parse, 'source.parseState', errors);
    if (!Number.isInteger(source.testCount) || source.testCount < 0) errors.push('source.testCount must be a non-negative integer');
    if (!/^patients\/[^/]+$/.test(String(source.subject))) errors.push('source.subject must be patients/<id>');
    if (source.encounter !== '' && !/^encounters\/[^/]+$/.test(String(source.encounter))) errors.push('source.encounter must be empty or encounters/<id>');
    if (exactKeys(source.deposit, ['at', 'by'], 'source.deposit', errors) && (typeof source.deposit.at !== 'string' || typeof source.deposit.by !== 'string')) errors.push('source.deposit needs at and by strings');
    if (exactKeys(source.facility, ['name', 'address', 'phone'], 'source.facility', errors)) cellsAt(source.facility, ['name', 'address', 'phone'], 'source.facility', errors);
    cellsAt(source, ['reportKindLabel', 'reportTitle', 'createdAt', 'pageOf'], 'source', errors);
  }
  function checkPoints(points, ids, keys, cellKeys, path, errors) {
    if (!Array.isArray(points) || points.length !== ids.length) { errors.push(path + ' must carry one entry per grid point'); return; }
    points.forEach((point, i) => {
      const itemPath = path + '[' + i + ']';
      if (!exactKeys(point, keys, itemPath, errors)) return;
      if (point.id !== ids[i]) errors.push(itemPath + '.id must be ' + ids[i]);
      cellsAt(point, cellKeys, itemPath, errors);
    });
  }
  function checkMeasurement(m, at, errors) {
    if (!exactKeys(m, MEASUREMENT_KEYS, at('measurement'), errors)) return [];
    oneOf(m.eye, states.eyes, at('measurement.eye'), errors);
    if (!exactKeys(m.grid, ['pattern', 'coordinateBasis', 'points'], at('measurement.grid'), errors)) return [];
    if (m.grid.coordinateBasis !== COORDINATE_BASIS) errors.push(at('measurement.grid.coordinateBasis') + ' must be ' + COORDINATE_BASIS);
    const lattice = directories.patternPoints(m.grid.pattern, m.eye);
    if (!lattice.length) errors.push(at('measurement.grid.pattern') + ' ' + show(m.grid.pattern) + ' is not a patterns token');
    else if (JSON.stringify(m.grid.points) !== JSON.stringify(lattice)) errors.push(at('measurement.grid.points') + ' must be the ' + m.grid.pattern + ' lattice for ' + m.eye);
    const ids = lattice.map((p) => p.id);
    checkPoints(m.points, ids, ['id', 'threshold', 'stimulusResult'], ['threshold', 'stimulusResult'], at('measurement.points'), errors);
    cellsAt(m, ['foveaThreshold', 'blindSpot', 'gaze'], at('measurement'), errors);
    if (exactKeys(m.reliability, RELIABILITY_KEYS, at('measurement.reliability'), errors)) cellsAt(m.reliability, RELIABILITY_KEYS, at('measurement.reliability'), errors);
    return ids;
  }
  function checkBlock(block, ids, path, errors) {
    if (!exactKeys(block, BLOCK_KEYS, path, errors)) return;
    oneOf(block.origin, states.analysisOrigins, path + '.origin', errors);
    if (typeof block.engineVersion !== 'string') errors.push(path + '.engineVersion must be a string');
    ['datasetId', 'datasetVersion', 'computedAt'].forEach((key) => { if (block[key] !== undefined && !text(block[key])) errors.push(path + '.' + key + ' must be a non-empty string when present'); });
    if (block.origin === 'computed' && !(text(block.datasetId) && text(block.datasetVersion))) errors.push(path + ' computed blocks carry datasetId and datasetVersion');
    if (block.overlays !== undefined && !plain(block.overlays)) errors.push(path + '.overlays must be a plain object keyed by layer id');
    if (!exactKeys(block.values, VALUE_CELLS.concat(['points']), path + '.values', errors)) return;
    cellsAt(block.values, VALUE_CELLS, path + '.values', errors);
    checkPoints(block.values.points, ids, ['id'].concat(VALUE_POINT_CELLS), VALUE_POINT_CELLS, path + '.values.points', errors);
  }
  function checkExtraction(extraction, at, errors) {
    if (!exactKeys(extraction, EXTRACTION_KEYS, at('extraction'), errors)) return;
    if (extraction.protocol !== null && !(plain(extraction.protocol) && text(extraction.protocol.id) && Number.isInteger(extraction.protocol.version))) errors.push(at('extraction.protocol') + ' must be null or { id, version }');
    if (typeof extraction.contentSha256 !== 'string') errors.push(at('extraction.contentSha256') + ' must be a string');
    if (!Number.isInteger(extraction.page) || !Number.isInteger(extraction.index)) errors.push(at('extraction.page') + ' and index must be integers');
    if (!Array.isArray(extraction.points)) { errors.push(at('extraction.points') + ' must be an array'); return; }
    extraction.points.forEach((p, i) => {
      const path = at('extraction.points[' + i + ']');
      if (!exactKeys(p, POINT_KEYS, path, errors)) return;
      if (!text(p.id) || !text(p.home)) errors.push(path + ' needs id and home');
      if (!Number.isInteger(p.page) || p.page < 1) errors.push(path + '.page must be a positive integer');
      if (!(plain(p.rect) && finite(p.rect.x) && finite(p.rect.y) && finite(p.rect.w) && finite(p.rect.h) && p.rect.basis === 'pdf-points')) errors.push(path + '.rect must be { x, y, w, h, basis: pdf-points }');
      oneOf(p.reader, states.readers, path + '.reader', errors);
      if (typeof p.raw !== 'string') errors.push(path + '.raw must be a string');
      if (!isCell(p.value)) errors.push(path + '.value must be a typed cell or an absence');
      oneOf(p.status, states.point, path + '.status', errors);
    });
  }
  function checkTest(test, index, source, errors) {
    const at = (path) => 'tests[' + index + '].' + path;
    if (!exactKeys(test, TEST_KEYS, 'tests[' + index + ']', errors, true)) return;
    if (test.schema !== TEST_SCHEMA) errors.push(at('schema') + ' must be ' + TEST_SCHEMA);
    if (!/^vft-[0-9a-f]{48}$/.test(String(test.identifier))) errors.push(at('identifier') + ' must be vft-<48 hex>');
    if (test.source !== SOURCES_COLLECTION + '/' + source.identifier) errors.push(at('source') + ' link must be ' + SOURCES_COLLECTION + '/<the source identifier>');
    if (test.subject !== source.subject) errors.push(at('subject') + ' must be the source subject ' + show(source.subject));
    if (exactKeys(test.identity, IDENTITY_KEYS, at('identity'), errors)) cellsAt(test.identity, IDENTITY_KEYS, at('identity'), errors);
    if (exactKeys(test.acquisition, ACQUISITION_KEYS, at('acquisition'), errors)) {
      if (exactKeys(test.acquisition.device, DEVICE_KEYS, at('acquisition.device'), errors)) cellsAt(test.acquisition.device, DEVICE_KEYS, at('acquisition.device'), errors);
      cellsAt(test.acquisition, ACQUISITION_KEYS.slice(2), at('acquisition'), errors);
    }
    if (exactKeys(test.testDefinition, TEST_DEFINITION_KEYS, at('testDefinition'), errors)) {
      cellsAt(test.testDefinition, TEST_DEFINITION_KEYS.slice(1), at('testDefinition'), errors);
      if (plain(test.measurement) && plain(test.measurement.grid) && test.measurement.grid.pattern !== test.testDefinition.pattern) errors.push(at('measurement.grid.pattern') + ' must equal testDefinition.pattern');
    }
    const ids = checkMeasurement(test.measurement, at, errors);
    if (!Array.isArray(test.analyses)) errors.push(at('analyses') + ' must be an array');
    else test.analyses.forEach((block, b) => checkBlock(block, ids, at('analyses[' + b + ']'), errors));
    checkExtraction(test.extraction, at, errors);
    if (exactKeys(test.review, ['state', 'at', 'by'], at('review'), errors)) {
      oneOf(test.review.state, states.review, at('review.state'), errors);
      if (typeof test.review.at !== 'string' || typeof test.review.by !== 'string') errors.push(at('review') + ' needs at and by strings');
    }
    if (exactKeys(test.seams, SEAM_KEYS, at('seams'), errors)) SEAM_KEYS.forEach((key) => { if (!Array.isArray(test.seams[key])) errors.push(at('seams.' + key) + ' must be an array'); });
    checkAttributes(source, test, index, errors);
  }
  function validateGraph(graph) {
    const errors = [];
    if (!plain(graph) || !plain(graph.source) || !Array.isArray(graph.tests)) return { ok: false, errors: ['graph must be { source, tests[] }'] };
    checkSource(graph.source, errors);
    if (plain(graph.source.facility)) checkAttributes(graph.source, null, -1, errors);
    graph.tests.forEach((test, index) => checkTest(test, index, graph.source, errors));
    const identifiers = graph.tests.map((t) => t && t.identifier);
    if (new Set(identifiers).size !== identifiers.length) errors.push('tests carry duplicate identifiers');
    if (graph.source.testCount !== graph.tests.length) errors.push('source.testCount ' + show(graph.source.testCount) + ' must equal tests.length ' + graph.tests.length);
    if (graph.source.parseState === 'unparsed' && graph.tests.length) errors.push('an unparsed source carries no tests');
    return { ok: errors.length === 0, errors };
  }
  function validateTest(test, source) { const errors = []; checkTest(test, 0, source, errors); return { ok: errors.length === 0, errors }; }

  // ---- projections ---------------------------------------------------------------------------------------------------
  // Every not-extracted cell on the test outside its extraction provenance (the completion bar of a protocol).
  function countNotExtracted(test) {
    let count = 0;
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!plain(node)) return;
      if (isAbsence(node)) { if (node.state === 'not-extracted') count += 1; return; }
      Object.keys(node).forEach((key) => { if (node !== test || key !== 'extraction') walk(node[key]); });
    };
    walk(test);
    return count;
  }
  function summarize(graph) {
    const tests = graph.tests || [], eyes = [], patterns = [], dates = [];
    tests.forEach((t) => {
      if (eyes.indexOf(t.measurement.eye) < 0) eyes.push(t.measurement.eye);
      if (t.testDefinition.pattern && patterns.indexOf(t.testDefinition.pattern) < 0) patterns.push(t.testDefinition.pattern);
      if (t.acquisition.testDate && dates.indexOf(t.acquisition.testDate) < 0) dates.push(t.acquisition.testDate);
    });
    eyes.sort((a, b) => states.eyes.indexOf(a) - states.eyes.indexOf(b));
    dates.sort();
    return { eyes, patterns, testDates: dates, testCount: tests.length, parseState: graph.source.parseState };
  }
  const year = (iso) => String(iso || '').slice(0, 4);
  function span(dates) { const a = year(dates[0]), b = year(dates[dates.length - 1]); return !a ? '' : a === b ? a : a + '–' + b; }
  function title(source, tests) {
    const kind = directories.reportKind(source.reportKind) || directories.reportKind('unrecognised');
    if (source.parseState === 'unparsed') return { long: kind.label + ' · ' + String(source.file.name || ''), short: 'VF ?' };
    const s = summarize({ source, tests }), vendor = directories.entry('vendors', source.vendor);
    const prefix = source.protocol && vendor && vendor.short ? vendor.short + ' ' + kind.short : 'Visual field';
    const eyes = s.eyes.join('/'), count = s.testCount;
    const parts = [prefix, eyes, s.patterns.join('/'), count + ' test' + (count === 1 ? '' : 's'), span(s.testDates)].filter((p) => p);
    const partial = source.parseState === 'partial' || source.parseState === 'failed';
    if (partial) parts.push(source.parseState);
    const tail = count > 1 ? ' ×' + count : s.patterns.length === 1 ? ' ' + s.patterns[0] : '';
    return { long: parts.join(' · '), short: 'VF' + (eyes ? ' ' + eyes : '') + tail + (partial ? ' !' : '') };
  }
  function keyOf(value) { return isAbsence(value) ? '' : isTyped(value) ? String(value.value) : value === null || value === undefined ? '' : String(value); }
  function valueAt(node, parts) { let v = node; parts.forEach((p) => { v = plain(v) ? v[p] : undefined; }); return v; }
  // 'source.<path>' partitions by the source attribute; 'test.<path>' by each test's — a graph lands in every group one
  // of its tests belongs to. Keys are the stringified scalar, the cell's value, or '' for an absence.
  function groupBy(graphs, path) {
    const parts = String(path).split('.'), scope = parts.shift(), groups = new Map();
    const add = (key, graph) => { if (!groups.has(key)) groups.set(key, []); if (groups.get(key).indexOf(graph) < 0) groups.get(key).push(graph); };
    graphs.forEach((graph) => {
      if (scope === 'source') add(keyOf(valueAt(graph.source, parts)), graph);
      else if (scope === 'test') graph.tests.forEach((t) => add(keyOf(valueAt(t, parts)), graph));
      else throw new Error('groupBy path must start with source. or test.: ' + path);
    });
    return groups;
  }

  return Object.freeze({
    SOURCE_SCHEMA, TEST_SCHEMA, SOURCES_COLLECTION, NOT_EXTRACTED, NOT_PRESENT, cell, isAbsence, isTyped, isCell,
    emptySource, emptyTest, emptyBlock, printedBlock, setHome, getHome, setSourceHome, getSourceHome,
    sourceIdentity, testIdentity, sourceSeed, testSeed, testSeedOf, stampIdentities,
    validateGraph, validateTest, countNotExtracted, summarize, title, groupBy, directories
  });
}
