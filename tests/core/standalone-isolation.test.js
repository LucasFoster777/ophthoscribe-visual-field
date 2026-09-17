const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const door = require('../../js/visual-field/visual-field-door.mjs');
const analysis = require('../../js/visual-field/visual-field-analysis-core.mjs');
const root = path.resolve(__dirname, '../..');
const url = rel => pathToFileURL(path.join(root, rel)).href;
const readFile = rel => fs.promises.readFile(path.join(root, rel), 'utf8');

// Golden extraction remains immutable while real calculations use the same selected-test input mapping as the UI.
test('golden graph keeps device absences through calculation, recomputation, selection, export and reset', async () => {
  const { Session, inputOf } = await import(url('js/session.mjs'));
  const { loadDirectories } = await import(url('js/data/visual-field/directories.mjs'));
  const { createModel } = await import(url('js/data/visual-field/model.mjs'));
  const { assembleGraph } = await import(url('js/data/visual-field/assemble.mjs'));
  const { bind, api: registry } = await import(url('js/visual-field/visual-field-dev-registry.mjs'));
  const directories = await loadDirectories({ readFile });
  const model = createModel(directories, { hashHex: text => text });
  const golden = JSON.parse(await readFile('tests/e2e/fixtures/visual-field/sources/zeiss_multi/hvf_7724798.golden.json'));
  const graph = assembleGraph({ model, directories,
    registration: { format: 'pdf-printout', vendor: 'zeiss', reportKind: 'overview', protocol: golden.protocol },
    pages: golden.pages, file: { name: 'hvf_7724798.pdf', sha256: 'a'.repeat(64), mime: 'application/pdf', pageCount: 9, bytes: 158800 }, subject: 'patients/standalone-demo', deposit: { at: '2026-09-17', by: 'local-demo' } });
  await model.stampIdentities(graph, async text => require('node:crypto').createHash('sha256').update(text).digest('hex'));
  // Golden files intentionally omit page/rect/reader; browser imports validate full extraction provenance.
  assert.equal(graph.tests.length, 25);
  const session = new Session(); session.model = model; session.directories = directories; session.reports = [{ graph }];
  bind({ devAnalysis: { analyze: async (input, dataset) => {
    const result = analysis.analyze(input, dataset); return { result, overlays: { bayesian: result.bayesian } };
  } } });
  const eligible = graph.tests.find(t => t.testDefinition.pattern === '24-2' && inputOf(t));
  assert.ok(eligible);
  const before = JSON.stringify(graph), deviceBefore = door.eyeReportFrom(eligible, 'view');
  assert.equal(deviceBefore.mapAvailability.totalDeviation, 'not-present-in-source');
  assert.equal(deviceBefore.mapAvailability.patternDeviation, 'not-present-in-source');
  assert.equal(deviceBefore.mapAvailability.totalDeviationProbability, 'read');
  await session.compute(eligible);
  await session.compute(eligible, true);
  assert.equal(session.blocks(eligible).length, 2);
  assert.equal(JSON.stringify(graph), before);
  const device = door.eyeReportFrom(session.projectedTest(eligible), 'view');
  assert.deepEqual(device.conventional, deviceBefore.conventional);
  assert.deepEqual(device.device, deviceBefore.device);
  assert.equal(device.mapAvailability.totalDeviation, 'not-present-in-source');
  assert.equal(device.bayesian, null);
  for (const index of [0, 1]) {
    const derived = door.eyeReportFrom(session.projectedTest(eligible), 'dev', { blockIndex: index });
    assert.equal(derived.valuesOrigin, 'computed');
    assert.equal(derived.block.index, index);
    assert.equal(derived.origins.md, 'computed');
    assert.ok(derived.conventional.values.some(Number.isFinite));
    assert.ok(Number.isFinite(derived.bayesian.posteriorMd.mean));
    assert.equal(derived.bayesian.values.length, 54);
    assert.match(derived.dataset, /ophthoscribe-24-2-normative-lf@1.0.0/);
  }
  assert.ok(registry.layers().some(layer => layer.id === 'bayesian'));
  const ineligible = graph.tests.find(t => t.testDefinition.pattern === '30-2');
  assert.match(session.eligibility(ineligible), /24-2 only/);
  await assert.rejects(session.compute(ineligible), /24-2 only/);
  const exported = session.exportData();
  assert.equal(JSON.stringify(exported.extractedGraphs[0]), before);
  assert.equal(exported.computedAnalyses[0].blocks.length, 2);
  assert.equal(exported.computedAnalyses[0].testIdentifier, eligible.identifier);
  await session.reset();
  assert.equal(session.reports.length, 0); assert.equal(session.computed.size, 0);
  assert.equal(JSON.stringify(graph), before);
});

test('reset during protocol initialization keeps new callers waiting for a complete model', async () => {
  const { Session } = await import(url('js/session.mjs'));
  const { api: protocols } = await import(url('js/visual-field/visual-field-protocols.mjs'));
  protocols._resetForTest();
  const originalFetch = globalThis.fetch;
  let release, announce;
  const held = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { announce = resolve; });
  globalThis.fetch = async resource => {
    if (resource.pathname.endsWith('/protocols/index.v1.json')) { announce(); await held; }
    return { ok: true, text: () => fs.promises.readFile(resource, 'utf8') };
  };
  const session = new Session();
  let initial;
  try {
    initial = session.ready();
    await reached;
    await session.reset();
    let complete = false;
    const afterReset = session.ready().then(() => { complete = true; });
    await Promise.resolve();
    assert.equal(complete, false, 'new import must await protocol loading');
    assert.equal(session.model, undefined);
    release();
    await Promise.all([initial, afterReset]);
    assert.ok(session.model);
    assert.ok(session.directories);
    assert.equal(protocols.loaded(), true);
  } finally {
    release();
    await initial?.catch(() => {});
    globalThis.fetch = originalFetch;
    protocols._resetForTest();
  }
});

test('a failed protocol initialization can be retried without reloading the application', async () => {
  const { Session } = await import(url('js/session.mjs'));
  const { api: protocols } = await import(url('js/visual-field/visual-field-protocols.mjs'));
  protocols._resetForTest();
  const originalFetch = globalThis.fetch;
  let protocolRequests = 0;
  globalThis.fetch = async resource => {
    if (resource.pathname.endsWith('/protocols/index.v1.json') && ++protocolRequests === 1) throw new Error('Simulated protocol fetch failure');
    return { ok: true, text: () => fs.promises.readFile(resource, 'utf8') };
  };
  try {
    const session = new Session();
    await assert.rejects(session.ready(), /Simulated protocol fetch failure/);
    assert.equal(session.model, undefined);
    assert.equal(session.directories, undefined);
    await session.ready();
    assert.equal(protocolRequests, 2);
    assert.ok(session.model);
    assert.ok(session.directories);
    assert.equal(protocols.loaded(), true);
  } finally {
    globalThis.fetch = originalFetch;
    protocols._resetForTest();
  }
});
