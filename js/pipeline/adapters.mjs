import { createHash } from 'node:crypto';
import { api as schema } from '../visual-field/visual-field-schema.mjs';
import { assembleFromSourceDocument } from '../data/visual-field/assemble.mjs';
import { parsePdf } from './pdf.mjs';
import { SESSION_SCHEMA, SESSION_VERSION, ADAPTER_VERSION, normalizeGraph, makeExamination, validateExamination, analysisFromLegacy, validateSession } from './contract.mjs';
const number = (value, label) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error(`${label}: invalid number`);
  const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${label}: invalid number`); return n;
};
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else cell += c; }
    else if (c === '"') { if (cell || closed) throw new Error('Malformed CSV quoting'); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ''; closed = false;
      if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; if (row.some(v => v !== '')) rows.push(row); row = []; }
    } else { if (closed) throw new Error('Unexpected text after CSV quote'); cell += c; }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  row.push(cell); if (row.some(v => v !== '')) rows.push(row);
  return rows;
}
function csvExaminations(text, options) {
  const [header, ...rows] = parseCsv(text); if (!header) throw new Error('Empty CSV');
  const needed = ['examination', 'subject', 'eye', 'date', 'pattern', 'x', 'y', 'value', 'unit', 'absenceReason', 'censored'];
  for (const k of needed) if (!header.includes(k)) throw new Error(`CSV missing column ${k}`);
  if (new Set(header).size !== header.length) throw new Error('Duplicate CSV header');
  const groups = new Map(), failures = [];
  rows.forEach((values, i) => {
    const row = Object.fromEntries(header.map((h, n) => [h, values[n]]));
    const key = row.examination || `row-${i + 2}`;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ row, values, line: i + 2 });
  });
  const examinations = [];
  for (const [key, entries] of groups) {
    try {
      const r = entries[0].row;
      const context = { subject: r.subject || options.context.subject, eye: r.eye, date: r.date, pattern: r.pattern, age: r.age ? number(r.age, 'age') : options.context.age ?? null };
      const grid = options.directories.patternPoints(context.pattern, context.eye), seen = new Set();
      const measurements = entries.map(({ row, values, line }) => {
        if (values.length !== header.length) throw new Error(`CSV row ${line}: incorrect column count`);
        for (const k of ['subject', 'eye', 'date', 'pattern', 'age']) if ((row[k] || '') !== (r[k] || '')) throw new Error(`CSV examination ${key}: conflicting ${k}`);
        const x = number(row.x, 'x'), y = number(row.y, 'y'), g = grid.find(p => p.x === x && p.y === y);
        if (!g || seen.has(g.id)) throw new Error(`CSV row ${line}: unsupported or duplicate coordinate`); seen.add(g.id);
        if (row.unit !== 'dB') throw new Error(`CSV row ${line}: unit must be dB`);
        if (!['true', 'false'].includes(row.censored)) throw new Error(`CSV row ${line}: censored must be true or false`);
        const value = row.value.trim() === '' ? null : number(row.value, 'threshold');
        if (value === null && !row.absenceReason) throw new Error(`CSV row ${line}: blank value requires absenceReason`);
        if (value !== null && row.absenceReason) throw new Error(`CSV row ${line}: present value cannot have absenceReason`);
        if (value === null && row.censored === 'true') throw new Error(`CSV row ${line}: absent value cannot be censored`);
        if (value !== null && (value < -1 || value > 60)) throw new Error(`CSV row ${line}: threshold out of range`);
        return { id: g.id, x, y, value, unit: 'dB', absenceReason: row.absenceReason || null, censored: row.censored === 'true', sourceLocation: { kind: 'csv', row: line, column: 'value', examination: key }, normalization: [] };
      });
      examinations.push(makeExamination({ context, measurements, model: options.model }));
    } catch (error) { failures.push({ examination: key, status: error.message.includes('missing-required-context') ? 'missing-required-context' : 'rejected', message: error.message }); }
  }
  return { examinations, outcomes: failures };
}
function matrixExamination(doc, options) {
  if (doc.schema !== 'visual-field-matrix/v1') throw new Error('Unsupported matrix schema');
  if (!['od-normalized', 'visual-field'].includes(doc.orientation)) throw new Error('Matrix requires explicit orientation: od-normalized or visual-field');
  const context = { ...options.context, ...doc.context };
  if (context.pattern !== '24-2') throw new Error('Matrix supports 24-2 only');
  if (doc.unit !== 'dB') throw new Error('Matrix unit must be dB');
  if (!Array.isArray(doc.matrix) || doc.matrix.length !== 8 || doc.matrix.some(row => !Array.isArray(row) || row.length !== 10)) throw new Error('Matrix must have 8 rows and 10 columns');
  const grid = options.directories.patternPoints('24-2', context.eye), used = new Set();
  const measurements = grid.map(g => {
    const x = doc.orientation === 'visual-field' && context.eye === 'OS' ? -g.x : g.x;
    const row = (21 - g.y) / 6, column = (x + 27) / 6;
    used.add(`${row},${column}`);
    const cell = doc.matrix[row][column], object = cell !== null && typeof cell === 'object';
    const value = cell === null || (object && cell.value === null) ? null : number(object ? cell.value : cell, 'matrix threshold');
    if (value !== null && (value < -1 || value > 60)) throw new Error('Matrix threshold out of range');
    if (object && cell.censored !== undefined && typeof cell.censored !== 'boolean') throw new Error('Matrix censoring must be boolean');
    if (value === null && object && cell.censored) throw new Error('Absent matrix value cannot be censored');
    return { id: g.id, x: g.x, y: g.y, value, unit: 'dB', absenceReason: value === null ? cell?.absenceReason || 'not-supplied' : null, censored: !!cell?.censored,
      sourceLocation: { kind: 'matrix', path: `$.matrix[${row}][${column}]`, row, column }, normalization: doc.orientation === 'visual-field' && context.eye === 'OS' ? ['x mirrored to degrees-od-normalized'] : [] };
  });
  doc.matrix.forEach((row, r) => row.forEach((v, c) => { if (!used.has(`${r},${c}`) && v !== null) throw new Error(`Matrix outside-pattern cell [${r}][${c}] must be null`); }));
  return makeExamination({ context, measurements, model: options.model, attestations: doc.attestations || [] });
}
async function verifyDeviceReplay(document, options) {
  const session = structuredClone(document), warnings = [];
  const hash = data => createHash('sha256').update(data).digest('hex');
  const signature = exam => JSON.stringify({ eye: exam.eye, date: exam.date, pattern: exam.pattern, age: exam.age,
    reliability: exam.reliability, measurements: exam.measurements.map(p => ({ id: p.id, x: p.x, y: p.y, value: p.value, unit: p.unit, absenceReason: p.absenceReason, censored: p.censored })) });
  for (const source of session.sources) {
    const examinations = session.examinations.filter(e => e.sourceId === source.id && e.analyses.some(b => b.origin === 'device-reported'));
    if (!examinations.length) continue;
    if (!source.originalBase64) {
      for (const exam of examinations) {
        for (const block of exam.analyses.filter(b => b.origin === 'device-reported')) {
          block.origin = 'source-supplied'; block.provenance = { ...block.provenance, established: false, reason: 'Original PDF unavailable to verify device origin' };
          if (block.legacyBlock) block.legacyBlock.origin = 'source-supplied';
        }
        for (const block of exam.graphTest?.analyses || []) if (['printed', 'device-reported'].includes(block.origin)) block.origin = 'source-supplied';
      }
      warnings.push(`Source ${source.id}: original PDF unavailable; device claims imported as source-supplied with unestablished provenance.`);
      continue;
    }
    const bytes = new Uint8Array(Buffer.from(source.originalBase64, 'base64'));
    if (hash(bytes) !== source.sha256) throw new Error('Device provenance: original PDF digest mismatch');
    const graph = await parsePdf({ ...options, bytes, name: source.name || 'replayed.pdf', context: { subject: source.subject || examinations[0].subject } });
    const verified = normalizeGraph(graph, { subject: source.subject, origin: 'device-reported' });
    for (const exam of examinations) {
      options.check?.();
      const matching = verified.filter(e => signature(e) === signature(exam));
      if (!matching.length) throw new Error('Device provenance: examination disagrees with original PDF');
      for (const block of exam.analyses.filter(b => b.origin === 'device-reported')) {
        if (!matching.some(e => e.analyses.some(b => JSON.stringify(b.globals) === JSON.stringify(block.globals) && JSON.stringify(b.points) === JSON.stringify(block.points))))
          throw new Error('Device provenance: analysis disagrees with original PDF');
      }
    }
  }
  for (const exam of session.examinations) if (exam.graphTest) exam.graphTest.analyses = exam.analyses.map(b => ({ ...(b.legacyBlock || { values: { ...b.globals, points: b.points } }), origin: b.origin }));
  return { session, warnings };
}
export async function parseInput(options) {
  const { bytes, name = '', directories, model, check = () => {} } = options;
  const context = options.context || {}; options = { ...options, context };
  const base = { warnings: [], provenance: { adapterVersion: ADAPTER_VERSION } }; check();
  const prefix = new TextDecoder().decode(bytes.slice(0, 10));
  if (prefix.startsWith('%PDF-')) {
    const graph = await parsePdf(options); return { ...base, format: 'zeiss-pdf', document: graph, graphs: [graph], examinations: normalizeGraph(graph, { subject: context.subject, origin: 'device-reported' }) };
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('[')) {
    if (!text.split(/\r?\n/, 1)[0].includes('examination,')) throw new Error('Unsupported input: expected PDF, source/session/matrix JSON, or measured-threshold CSV; XML, DICOM, E2E and TD-only research inputs are unsupported');
    return { ...base, format: 'threshold-csv', document: text, ...csvExaminations(text, options) };
  }
  const doc = JSON.parse(text); check();
  if (doc.schema === SESSION_SCHEMA) {
    if (doc.version !== SESSION_VERSION || !Array.isArray(doc.sources) || !Array.isArray(doc.examinations)) throw new Error('Invalid session version or collections');
    const sessionVerdict = validateSession(doc, directories); if (!sessionVerdict.ok) throw new Error(sessionVerdict.errors.join('; '));
    const replay = await verifyDeviceReplay(doc, options);
    return { ...base, ...replay, format: 'session-json', document: doc, examinations: [] };
  }
  if (doc.schema === 'visual-field-matrix/v1') return { ...base, format: 'matrix-json', document: doc, examinations: [matrixExamination(doc, options)] };
  if (doc.schema === 'visual-field-source/v1') {
    const verdict = schema.validateSource(doc); if (!verdict.ok) throw new Error('Invalid source JSON: ' + verdict.errors.join('; '));
    if (!context.subject?.trim()) throw new Error('missing-required-context: explicit synthetic subject is required');
    const hash = data => createHash('sha256').update(data).digest('hex');
    const graph = assembleFromSourceDocument({ model, directories, sourceDoc: doc, file: { name, mime: 'application/json', bytes: bytes.length, sha256: hash(bytes), pageCount: 0 }, subject: context.subject, encounter: '', deposit: { at: '', by: 'local-demo' } });
    await model.stampIdentities(graph, hash);
    const examinations = normalizeGraph(graph, { subject: context.subject });
    examinations.forEach((e, i) => { e.attestations = doc.provenance.qualityControl ? [structuredClone(doc.provenance.qualityControl)] : []; e.measurements.forEach((p, j) => { p.sourceLocation = { kind: 'json', path: `$.eyes[${i}].points[${j}].threshold` }; }); });
    return { ...base, format: 'source-json', document: doc, graphs: [graph], examinations };
  }
  const graphs = doc.extractedGraphs || (doc.source && Array.isArray(doc.tests) ? [doc] : null);
  if (graphs) {
    const examinations = graphs.flatMap(graph => {
      const verdict = model.validateGraph(graph); if (!verdict.ok) throw new Error('Invalid legacy graph: ' + verdict.errors[0]);
      return normalizeGraph(graph, { subject: context.subject, provenanceUnknown: true });
    });
    for (const history of doc.computedAnalyses || []) {
      const e = examinations.find(x => x.id === history.testIdentifier); if (!e) continue;
      for (const block of history.blocks || []) e.analyses.push(analysisFromLegacy(block, 'computed', `${e.id}-migration-${e.analyses.length}`, { established: false, adapterVersion: ADAPTER_VERSION }));
    }
    examinations.forEach(e => e.measurements.forEach(p => { p.sourceLocation = { kind: 'json', originalLocation: p.sourceLocation }; }));
    return { ...base, format: 'legacy-session-json', document: doc, graphs, examinations, warnings: ['Legacy export provenance cannot establish device origin; imported source values are source-supplied. Original source bytes may be unavailable.'] };
  }
  throw new Error('Unsupported or ambiguous JSON schema');
}
