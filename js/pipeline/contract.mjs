export const SESSION_SCHEMA = 'ophthoscribe-vf-session';
export const SESSION_VERSION = 1;
export const ADAPTER_VERSION = '0.2.0';
export const COORDINATE_CONVENTION = 'degrees-od-normalized';
export function requiredContext(context) {
  if (typeof context.subject !== 'string' || !context.subject.trim()) throw new Error('missing-required-context: explicit synthetic subject is required');
  if (!['OD', 'OS'].includes(context.eye)) throw new Error('missing-required-context: eye must explicitly be OD or OS');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.date || '') || new Date(context.date).toISOString().slice(0, 10) !== context.date) throw new Error('missing-required-context: valid date YYYY-MM-DD is required');
  if (!['24-2', '30-2'].includes(context.pattern)) throw new Error('pattern must be 24-2 or 30-2');
  if (context.age != null && (!Number.isFinite(context.age) || context.age < 0 || context.age > 130)) throw new Error('age must be numeric 0–130 or null');
}
export function analysisFromLegacy(b, origin, id, provenance = {}) {
  const { points = [], ...globals } = b.values || {};
  return { id, origin, globals: structuredClone(globals), points: structuredClone(points), legacyBlock: structuredClone(b), provenance };
}
export function normalizeGraph(graph, { subject, origin = 'source-supplied', provenanceUnknown = false } = {}) {
  return graph.tests.map((original, index) => {
    const test = structuredClone(original);
    const context = { subject: subject || test.subject || graph.source.subject, eye: test.measurement.eye, date: test.acquisition.testDate, pattern: test.testDefinition.pattern, age: test.acquisition.ageYears?.value ?? null };
    requiredContext(context);
    const coordinates = new Map(test.measurement.grid.points.map(p => [p.id, p]));
    const examinations = { ...context, id: test.identifier || `exam-${index}`, sourceId: graph.source.identifier || '', coordinateConvention: COORDINATE_CONVENTION,
      measurements: test.measurement.points.map(p => {
        const c = p.threshold, coord = coordinates.get(p.id);
        return { id: p.id, x: coord.x, y: coord.y, value: c?.value ?? null, unit: c?.unit || 'dB', absenceReason: c?.value == null ? c?.state || 'not-supplied' : null, censored: !!c?.censored,
          sourceLocation: { kind: 'pdf', page: test.extraction?.page, points: (test.extraction?.points || []).filter(v => v.id === `measurement.threshold.${p.id}` || v.home === `measurement.points.${p.id}.threshold`) }, normalization: [] };
      }), reliability: structuredClone(test.measurement.reliability), attestations: [],
      analyses: test.analyses.map((b, i) => analysisFromLegacy(b, b.origin === 'computed' ? 'computed' : origin, `${test.identifier || index}-analysis-${i}`, { established: !provenanceUnknown, adapterVersion: ADAPTER_VERSION })),
      provenance: { adapterVersion: ADAPTER_VERSION, established: !provenanceUnknown }, graphTest: test };
    // A legacy rendering helper must never mistake supplied values for device output.
    test.analyses = examinations.analyses.map(b => ({ ...b.legacyBlock, origin: b.origin }));
    return examinations;
  });
}
export function makeExamination({ context, measurements, model, analyses = [], attestations = [] }) {
  requiredContext(context);
  const test = model.emptyTest(context.pattern, context.eye);
  test.subject = context.subject; test.acquisition.testDate = context.date;
  test.acquisition.ageYears = context.age == null ? model.NOT_PRESENT : { value: context.age };
  const supplied = new Map(measurements.map(p => [p.id, p]));
  test.measurement.points = test.measurement.points.map(p => {
    const m = supplied.get(p.id); return { ...p, threshold: m?.value == null ? { state: 'not-present-in-source' } : { value: m.value, unit: m.unit, ...(m.censored ? { censored: true } : {}) } };
  });
  const all = test.measurement.grid.points.map(g => supplied.get(g.id) || { id: g.id, x: g.x, y: g.y, value: null, unit: 'dB', absenceReason: 'not-supplied', censored: false, sourceLocation: null, normalization: [] });
  return { ...context, id: '', sourceId: '', coordinateConvention: COORDINATE_CONVENTION, measurements: all, analyses, attestations, reliability: structuredClone(test.measurement.reliability), graphTest: test, provenance: { adapterVersion: ADAPTER_VERSION } };
}
export function validateExamination(exam) {
  const errors = [];
  try { requiredContext(exam); } catch (e) { errors.push(e.message); }
  if (!Array.isArray(exam.measurements) || !Array.isArray(exam.analyses)) errors.push('measurements and analyses must be arrays');
  for (const p of exam.measurements || []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.value !== null && !Number.isFinite(p.value)) || p.unit !== 'dB') errors.push('invalid measurement');
    if (p.value === null && !p.absenceReason) errors.push('absent measurement needs absenceReason');
  }
  for (const b of exam.analyses || []) if (!['device-reported', 'source-supplied', 'computed'].includes(b.origin)) errors.push('invalid analysis origin');
  return { ok: !errors.length, errors };
}
export function validateSession(session, directories) {
  const errors = [], sourceIds = new Set(), ids = new Set(), blocks = new Set();
  if (session?.schema !== SESSION_SCHEMA || session.version !== SESSION_VERSION || !Array.isArray(session.sources) || !Array.isArray(session.examinations)) return { ok: false, errors: ['Invalid session contract'] };
  for (const source of session.sources) {
    if (typeof source.id !== 'string' || !source.id || sourceIds.has(source.id)) errors.push('Invalid or duplicate source id');
    sourceIds.add(source.id);
  }
  for (const exam of session.examinations) {
    errors.push(...validateExamination(exam).errors);
    if (typeof exam.id !== 'string' || !exam.id || ids.has(exam.id) || !sourceIds.has(exam.sourceId)) errors.push('Invalid examination id/source reference');
    ids.add(exam.id);
    const grid = directories?.patternPoints(exam.pattern, exam.eye), byId = new Map((exam.measurements || []).map(p => [p.id, p]));
    if (byId.size !== exam.measurements?.length || (grid && grid.length !== byId.size)) errors.push('Duplicate or missing measurement identities');
    if (grid) for (const g of grid) { const p = byId.get(g.id); if (!p || g.x !== p.x || g.y !== p.y) errors.push('Measurement coordinates disagree with pattern/laterality'); }
    const t = exam.graphTest;
    if (!t || t.measurement?.eye !== exam.eye || t.acquisition?.testDate !== exam.date || t.testDefinition?.pattern !== exam.pattern || (t.acquisition?.ageYears?.value ?? null) !== (exam.age ?? null)) errors.push('graphTest context disagrees with canonical examination');
    else {
      if (t.measurement.points.length !== byId.size) errors.push('graphTest measurement count mismatch');
      if (grid && (JSON.stringify(t.measurement.grid.points) !== JSON.stringify(grid) || t.measurement.points.some((p, i) => p.id !== grid[i]?.id) || exam.measurements.some((p, i) => p.id !== grid[i]?.id))) errors.push('graphTest point order or grid disagrees with canonical pattern');
      for (const p of t.measurement.points) { const c = byId.get(p.id); if (!c || (p.threshold?.value ?? null) !== c.value || !!p.threshold?.censored !== !!c.censored) errors.push('graphTest threshold disagrees with canonical measurement'); }
      if (JSON.stringify(t.measurement.reliability) !== JSON.stringify(exam.reliability)) errors.push('graphTest reliability disagrees with canonical reliability');
    }
    for (const b of exam.analyses || []) {
      if (typeof b.id !== 'string' || !b.id || blocks.has(b.id)) errors.push('Invalid or duplicate analysis id'); blocks.add(b.id);
      if (!b.provenance || !b.globals || !Array.isArray(b.points)) errors.push('Analysis requires globals, points and provenance');
      if (b.legacyBlock) {
        const expected = analysisFromLegacy(b.legacyBlock, b.origin, b.id);
        if (JSON.stringify(expected.globals) !== JSON.stringify(b.globals) || JSON.stringify(expected.points) !== JSON.stringify(b.points)) errors.push('Analysis projection disagrees with legacy block');
      }
      if (b.origin === 'device-reported' && session.sources.find(s => s.id === exam.sourceId)?.format !== 'zeiss-pdf') errors.push('Device origin requires supported Zeiss source provenance');
    }
  }
  return { ok: !errors.length, errors: [...new Set(errors)] };
}
