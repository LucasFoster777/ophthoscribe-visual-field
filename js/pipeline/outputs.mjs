/** Portable, selection-aware projections of the shared canonical session. */
export function selectSession(snapshot, options = {}) {
  if (snapshot?.schema !== 'ophthoscribe-vf-session' || snapshot.version !== 1 || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.examinations)) throw new Error('Unsupported canonical session');
  const analysis = options.analysis ?? 'source-only';
  const sourceIds = options.sourceIds ?? snapshot.sources.map(s => s.id);
  const examinationIds = options.examinationIds ?? snapshot.examinations.filter(e => sourceIds.includes(e.sourceId)).map(e => e.id);
  if (!Array.isArray(sourceIds) || !Array.isArray(examinationIds)) throw new Error('Selection identifiers must be arrays');
  for (const id of sourceIds) if (!snapshot.sources.some(s => s.id === id)) throw new Error(`Unknown source: ${id}`);
  for (const id of examinationIds) if (!snapshot.examinations.some(e => e.id === id && sourceIds.includes(e.sourceId))) throw new Error(`Unknown or excluded examination: ${id}`);
  let examinations = snapshot.examinations.filter(e => examinationIds.includes(e.id));
  if (!['source-only', 'all'].includes(analysis) && !examinations.some(e => e.analyses.some(a => a.id === analysis))) throw new Error(`Unknown selected analysis: ${analysis}`);
  examinations = examinations.map(e => {
    const analyses = e.analyses.filter(a => a.origin !== 'computed' || analysis === 'all' || a.id === analysis);
    const graphTest = e.graphTest ? { ...e.graphTest, analyses: analyses.filter(a => a.legacyBlock).map(a => ({ ...a.legacyBlock, origin: a.origin })) } : undefined;
    return { ...e, analyses, ...(graphTest ? { graphTest } : {}) };
  });
  return structuredClone({ ...snapshot, sources: snapshot.sources.filter(s => sourceIds.includes(s.id) && (!options.examinationIds || examinations.some(e => e.sourceId === s.id))), examinations, selection: { sourceIds, examinationIds, analysis }, projection: { originalsIncluded: snapshot.sources.every(s => typeof s.originalBase64 === 'string'), note: 'Original source documents and bytes are retained as imported; analysis selection governs canonical examination analysis blocks.' } });
}
export function exportSession(snapshot, options = {}) { return JSON.stringify(selectSession(snapshot, options), null, 2); }

function cell(value) {
  if (value == null) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value !== 'number' && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function table(columns, rows) { return [columns.join(','), ...rows.map(row => columns.map(c => cell(row[c])).join(','))].join('\r\n') + '\r\n'; }
export function exportCSV(snapshot, options = {}) {
  const session = selectSession(snapshot, options);
  const examinations = [], measurements = [], analyses = [], points = [], provenance = [];
  for (const s of session.sources) provenance.push({ id: s.id, sourceId: s.id, kind: 'source', origin: s.format, location: s.name, detail: { sha256: s.sha256, provenance: s.provenance, warnings: s.warnings } });
  for (const e of session.examinations) {
    examinations.push({ ...e, analysisSelection: session.selection.analysis });
    for (const p of e.measurements) measurements.push({ ...p, examinationId: e.id, sourceId: e.sourceId, origin: 'source-measurement' });
    for (const a of e.analyses) {
      analyses.push({ ...a, examinationId: e.id, sourceId: e.sourceId });
      provenance.push({ id: a.id, sourceId: e.sourceId, examinationId: e.id, kind: 'analysis', origin: a.origin, detail: a.provenance, assumptions: a.assumptions });
      for (const [i, p] of (a.points ?? []).entries()) points.push({ ...p, id: p.id ?? `${a.id}-point-${i}`, analysisId: a.id, examinationId: e.id, sourceId: e.sourceId, origin: a.origin, detail: p });
    }
  }
  return {
    'selection.json': JSON.stringify(session.selection, null, 2),
    'examinations.csv': table(['id','sourceId','subject','eye','date','pattern','age','analysisSelection'], examinations),
    'measurement-points.csv': table(['id','examinationId','sourceId','x','y','value','unit','absenceReason','censored','origin','sourceLocation','normalization'], measurements),
    'analyses.csv': table(['id','examinationId','sourceId','origin','globals','engine','dataset','assumptions','provenance'], analyses),
    'analysis-points.csv': table(['id','analysisId','examinationId','sourceId','x','y','value','unit','absenceReason','censored','origin','detail'], points),
    'provenance.csv': table(['id','sourceId','examinationId','kind','origin','location','detail','assumptions'], provenance),
  };
}
export const FHIR_LIMITATIONS = [
  'Generic FHIR R4 collection for inspection; no IRIS-specific profile or registry acceptance is claimed.',
  'Point absence reasons, censoring detail, coordinates, normalization and full analysis provenance are preserved in the canonical JSON attachment; not all are structurally mapped.',
  'Clinical Observation status is unknown unless explicitly supplied. Export does not finalize an examination. Date-only acquisition values remain date-only.',
  'Original bytes and source graphs are retained in the canonical attachment. DocumentReference current describes the exported document, not clinical review.',
];
export function exportFHIR(snapshot, options = {}) {
  const session = selectSession(snapshot, options), entry = [];
  const ref = (type, id) => `${type}/${id}`;
  // Sequential local resource IDs avoid imposing FHIR ID constraints on caller identifiers.
  const subjects = new Map([...new Set(session.examinations.map(e => e.subject))].map((s, i) => [s, `subject-${i + 1}`]));
  const add = resource => { entry.push({ fullUrl: `https://ophthoscribe.local/fhir/${resource.resourceType}/${resource.id}`, resource }); return ref(resource.resourceType, resource.id); };
  for (const [subject, id] of subjects) add({ resourceType: 'Patient', id, identifier: [{ system: 'urn:ophthoscribe:visual-field:synthetic-subject', value: subject }] });
  const canonical = add({ resourceType: 'DocumentReference', id: 'canonical-session', status: 'current', description: FHIR_LIMITATIONS.join('\n'), content: [{ attachment: { contentType: 'application/json', title: 'Selected canonical visual-field session', data: Buffer.from(JSON.stringify(session)).toString('base64') } }] });
  let index = 0;
  for (const e of session.examinations) {
    const blocks = [{ id: `${e.id}-measurements`, origin: 'source-measurement', points: e.measurements }, ...e.analyses];
    for (const a of blocks) {
      const id = `observation-${++index}`;
      const component = [];
      for (const [key, cell] of Object.entries(a.globals ?? {})) {
        const value = typeof cell === 'number' ? cell : cell?.value;
        if (typeof value === 'number' && Number.isFinite(value)) component.push({ code: { text: key }, valueQuantity: { value, ...(cell?.unit ? { unit: cell.unit } : {}) } });
      }
      for (const p of a.points ?? []) for (const key of ['totalDeviation', 'patternDeviation']) {
        const cell = p[key];
        if (typeof cell?.value === 'number' && Number.isFinite(cell.value)) component.push({ code: { text: `${key} at point ${p.id}` }, valueQuantity: { value: cell.value, ...(cell.unit ? { unit: cell.unit } : {}) } });
      }
      for (const p of a.points ?? []) if (typeof p.value === 'number' && Number.isFinite(p.value)) component.push({ code: { text: `Threshold at (${p.x}, ${p.y})` }, valueQuantity: { value: p.value, ...(p.unit ? { unit: p.unit } : {}), ...(['<','<=','>=','>'].includes(p.censored) ? { comparator: p.censored } : {}) } });
      const observation = { resourceType: 'Observation', id, identifier: [{ system: 'urn:ophthoscribe:visual-field:analysis', value: a.id }], status: ['registered','preliminary','final','amended','corrected','cancelled','entered-in-error','unknown'].includes(e.status) ? e.status : 'unknown', code: { text: `Visual field ${e.pattern}: ${a.origin}` }, subject: { reference: ref('Patient', subjects.get(e.subject)) }, bodySite: { text: e.eye }, derivedFrom: [{ reference: canonical }], note: [{ text: `Source ${e.sourceId}; examination ${e.id}; analysis ${a.id}; origin ${a.origin}. See canonical attachment for units and semantics of analysis globals and all unmapped data.` }] };
      if (e.date) observation.effectiveDateTime = e.date;
      if (component.length) observation.component = component;
      add(observation);
      add({ resourceType: 'Provenance', id: `provenance-${index}`, target: [{ reference: ref('Observation', id) }], recorded: new Date().toISOString(), activity: { text: `Export projection of ${a.origin}` }, agent: [{ who: { display: 'OphthoScribe standalone local export service' } }], entity: [{ role: 'source', what: { reference: canonical, display: `Source ${e.sourceId}; analysis ${a.id}` } }] });
    }
  }
  return { resourceType: 'Bundle', type: 'collection', entry };
}
