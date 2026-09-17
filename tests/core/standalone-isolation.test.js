const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Pipeline } = require('../../js/pipeline/core.mjs');
const { exportSession } = require('../../js/pipeline/outputs.mjs');
const { assembleGraph } = require('../../js/data/visual-field/assemble.mjs');
const { normalizeGraph } = require('../../js/pipeline/contract.mjs');
const door = require('../../js/visual-field/visual-field-door.mjs');

test('golden graph stays immutable through server calculation history, export and reset', async () => {
  const pipeline = new Pipeline(); await pipeline.ready();
  const golden = JSON.parse(await fs.readFile(new URL('../e2e/fixtures/visual-field/sources/zeiss_multi/hvf_7724798.golden.json', pathToFileURL(__filename))));
  const graph = assembleGraph({ model: pipeline.model, directories: pipeline.directories,
    registration: { format: 'pdf-printout', vendor: 'zeiss', reportKind: 'overview', protocol: golden.protocol },
    pages: golden.pages, file: { name: 'synthetic.pdf', sha256: 'a'.repeat(64), mime: 'application/pdf', pageCount: 9, bytes: 158800 }, subject: 'patients/synthetic', deposit: { at: '2026-09-17', by: 'local-demo' } });
  const before = JSON.stringify(graph);
  pipeline.sources.push({ id: 'source', subject: 'synthetic', format: 'zeiss-pdf', graphs: [graph] });
  pipeline.examinations = normalizeGraph(graph, { subject: 'synthetic', origin: 'device-reported' }).map((e, i) => ({ ...e, id: 'exam-' + i, sourceId: 'source' }));
  const exam = pipeline.examinations.find(e => e.pattern === '24-2');
  const device = door.eyeReportFrom(exam.graphTest, 'view');
  assert.equal(device.mapAvailability.totalDeviation, 'not-present-in-source');
  assert.equal((await pipeline.analyze({ examinationIds: [exam.id] }))[0].status, 'calculated');
  assert.equal((await pipeline.analyze({ examinationIds: [exam.id], force: true }))[0].status, 'calculated');
  const blocks = exam.analyses.filter(a => a.origin === 'computed');
  assert.equal(blocks.length, 2); assert.notEqual(blocks[0].id, blocks[1].id);
  assert.equal(JSON.stringify(graph), before);
  const projected = { ...exam.graphTest, analyses: [...exam.graphTest.analyses, ...blocks.map(b => b.legacyBlock)] };
  assert.deepEqual(door.eyeReportFrom(projected, 'view').device, device.device);
  for (const index of [0, 1]) {
    const dev = door.eyeReportFrom(projected, 'dev', { blockIndex: index });
    assert.equal(dev.valuesOrigin, 'computed'); assert.ok(Number.isFinite(dev.bayesian.posteriorMd.mean));
  }
  const sourceOnly = JSON.parse(exportSession(pipeline.snapshot({ portable: true }), { analysis: 'source-only' }));
  assert.equal(sourceOnly.examinations.find(e => e.id === exam.id).analyses.some(b => b.origin === 'computed'), false);
  pipeline.reset(); assert.equal(pipeline.examinations.length, 0); assert.equal(JSON.stringify(graph), before);
});
