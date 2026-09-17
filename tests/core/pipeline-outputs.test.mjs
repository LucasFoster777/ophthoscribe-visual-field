import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSession, exportCSV, exportFHIR, selectSession } from '../../js/pipeline/outputs.mjs';
import { executeQuery } from '../../js/pipeline/graphql.mjs';
const fixture = () => ({ schema: 'ophthoscribe-vf-session', version: 1, sources: [{ id: 's1', subject: '=SYNTHETIC', name: 'sample.csv', format: 'csv', originalBase64: 'YQ==', document: { original: true } }], examinations: [{ id: 'e1', sourceId: 's1', subject: '=SYNTHETIC', eye: 'OS', date: '2026-01-02', pattern: '24-2', measurements: [{ id: 'p1', x: -3, y: 3, value: 17.125, unit: 'dB', sourceLocation: { row: 2 } }, { id: 'p2', x: 3, y: 3, value: null, absenceReason: 'not-measured', unit: 'dB' }], analyses: [{ id: 'a1', origin: 'source-supplied', globals: { md: -2 } }, { id: 'a2', origin: 'computed', globals: { md: -3 }, points: [], provenance: { engine: 'test' } }] }], outcomes: [] });
test('selection is explicit, preserves originals and never mutates session', () => {
  const s = fixture(), selected = selectSession(s);
  assert.equal(selected.examinations[0].analyses.length, 1);
  assert.equal(s.examinations[0].analyses.length, 2);
  assert.equal(selected.sources[0].originalBase64, 'YQ==');
  assert.equal(JSON.parse(exportSession(s, { analysis: 'a2' })).selection.analysis, 'a2');
  assert.throws(() => selectSession(s, { examinationIds: ['bad'] }));
  assert.throws(() => selectSession(s, { analysis: 'bad' }));
});
test('relational package retains missingness precision joins and formula protection', () => {
  const csv = exportCSV(fixture(), { analysis: 'all' });
  assert.equal(Object.keys(csv).length, 6);
  assert.match(csv['examinations.csv'], /'=SYNTHETIC/);
  assert.match(csv['measurement-points.csv'], /17\.125/);
  assert.match(csv['measurement-points.csv'], /not-measured/);
  assert.match(csv['analyses.csv'], /source-supplied/);
  assert.match(csv['analyses.csv'], /computed/);
});
test('FHIR preserves source and selected computed values with date-only unknown lifecycle', () => {
  const b = exportFHIR(fixture(), { analysis: 'a2' });
  assert.equal(b.type, 'collection');
  const observations = b.entry.map(e => e.resource).filter(r => r.resourceType === 'Observation');
  assert.equal(observations.length, 3);
  assert.ok(observations.every(o => o.status === 'unknown' && o.effectiveDateTime === '2026-01-02' && !o.encounter));
  const doc = b.entry.find(e => e.resource.resourceType === 'DocumentReference').resource;
  const payload = JSON.parse(Buffer.from(doc.content[0].attachment.data, 'base64'));
  assert.equal(payload.examinations[0].measurements[0].value, 17.125);
  assert.equal(payload.selection.analysis, 'a2');
});
test('GraphQL field selections filters variables fragments missingness and analysis agree', () => {
  const result = executeQuery(fixture(), { query: 'query($eye: String){ examinations(eye:$eye){ id measurements { value absenceReason } analyses(selection:"a2") { id origin globals { md } provenance { detail } } } }', variables: { eye: 'OS' } });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.examinations[0].measurements[1].value, null);
  assert.equal(result.data.examinations[0].analyses[1].globals.md, -3);
  assert.deepEqual(Object.keys(result.data.examinations[0]), ['id','measurements','analyses']);
  assert.equal(executeQuery(fixture(), { query: '{examinations(eye:"OD"){id}}' }).data.examinations.length, 0);
});
test('GraphQL rejects writes oversized query invalid fields pagination and fragment cycles', () => {
  for (const query of ['mutation { reset }', '{sources(limit:201){id}}', '{sources{password}}', ' '.repeat(16385), '{sources{...X}} fragment X on Source { ...X }']) assert.ok(executeQuery(fixture(), { query }).errors?.length);
});
test('legacy value cells retain units and calculated deviation fields in both projections', () => {
  const s = fixture();
  s.examinations[0].analyses[1].globals = { md: { value: -3.25, unit: 'dB' } };
  s.examinations[0].analyses[1].points = [{ id: 'p1', totalDeviation: { value: -4.5, unit: 'dB' }, totalDeviationProbability: { value: 'p<0.01' } }];
  const result = executeQuery(s, { query: '{examination(id:"e1"){analyses(selection:"a2"){globals{md metrics{name unit}} points{totalDeviation totalDeviationProbability}}}}' });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.examination.analyses[1].globals.md, -3.25);
  assert.equal(result.data.examination.analyses[1].points[0].totalDeviation, -4.5);
  const obs = exportFHIR(s, { analysis: 'a2' }).entry.map(e => e.resource).find(r => r.identifier?.[0].value === 'a2');
  assert.deepEqual(obs.component[0].valueQuantity, { value: -3.25, unit: 'dB' });
  assert.equal(obs.component[1].valueQuantity.value, -4.5);
  assert.ok(executeQuery(s, { query: '{sources(limit:200){examinations(limit:200){measurements(limit:200){value}}}}' }).errors);
});
test('source-only removes computed blocks from the normalised compatibility graph', () => {
  const s = fixture();
  s.examinations[0].graphTest = { analyses: [{ origin: 'computed', values: { md: -50 } }] };
  assert.deepEqual(selectSession(s).examinations[0].graphTest.analyses, []);
  assert.equal(s.examinations[0].graphTest.analyses.length, 1);
});
test('imported source calculation agrees across JSON CSV FHIR GraphQL and replay', async () => {
  const { readFile } = await import('node:fs/promises');
  const { Pipeline } = await import('../../js/pipeline/core.mjs');
  const pipeline = new Pipeline();
  const imported = await pipeline.importFile({ name: 'source-bilateral.json', context: {subject: 'synthetic-A'}, bytes: await readFile(new URL('../../examples/source-bilateral.json', import.meta.url)) });
  assert.equal(imported.status, 'accepted', imported.reason);
  const calculated = await pipeline.analyze();
  assert.ok(calculated.some(o => o.status === 'calculated'), JSON.stringify(calculated));
  const snapshot = pipeline.snapshot({ originals: true });
  const exam = snapshot.examinations.find(e => e.analyses.some(a => a.origin === 'computed'));
  const block = exam.analyses.find(a => a.origin === 'computed');
  const options = { examinationIds: [exam.id], analysis: block.id };
  const json = JSON.parse(exportSession(snapshot, options));
  const md = json.examinations[0].analyses.find(a => a.id === block.id).globals.md.value;
  assert.equal(typeof md, 'number');
  const queried = executeQuery(snapshot, { query: 'query($id:ID!, $block:String!){examination(id:$id){analyses(selection:$block){id globals{md}}}}', variables: { id: exam.id, block: block.id } });
  assert.equal(queried.data.examination.analyses.find(a => a.id === block.id).globals.md, md);
  assert.ok(exportCSV(snapshot, options)['analyses.csv'].includes(String(md)));
  const fhir = exportFHIR(snapshot, options).entry.map(e => e.resource).find(r => r.identifier?.[0].value === block.id);
  assert.equal(fhir.component.find(c => c.code.text === 'md').valueQuantity.value, md);
  const replay = new Pipeline(), outcome = {};
  replay.replay(json, outcome);
  assert.equal(outcome.status, 'accepted');
  assert.equal(replay.examinations[0].analyses.find(a => a.id === block.id).globals.md.value, md);
});
test('GraphQL source subject filter finds subjects within multi-subject imports and availability survives light snapshots', () => {
  const s = fixture();
  s.sources[0].subject = 'synthetic-A|synthetic-B';
  delete s.sources[0].originalBase64;
  s.sources[0].hasOriginal = true;
  s.examinations[0].subject = 'synthetic-A';
  s.examinations.push({ ...s.examinations[0], id: 'e2', subject: 'synthetic-B' });
  const query = 'query($subject:String!){sources(subject:$subject){id originalAvailable}}';
  for (const subject of ['synthetic-A','synthetic-B']) {
    const result = executeQuery(s, { query, variables: { subject } });
    assert.equal(result.errors, undefined);
    assert.equal(result.data.sources.length, 1);
    assert.equal(result.data.sources[0].originalAvailable, true);
  }
  assert.equal(executeQuery(s, { query, variables: { subject: 'synthetic-C' } }).data.sources.length, 0);
  s.sources[0].hasOriginal = false;
  assert.equal(executeQuery(s, { query, variables: { subject: 'synthetic-A' } }).data.sources[0].originalAvailable, false);
});
test('GraphQL variable pagination cannot evade expanded query cost bounds', () => {
  const query = 'query($n:Int!){sources(limit:$n){examinations(limit:$n){measurements(limit:$n){value}}}}';
  assert.ok(executeQuery(fixture(), { query, variables: { n: 200 } }).errors);
  assert.equal(executeQuery(fixture(), { query, variables: { n: 2 } }).errors, undefined);
});
