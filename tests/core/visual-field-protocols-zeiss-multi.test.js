const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
global.window = undefined;
global.OS = { visualField: {} };
global.OS.visualField.record = require('../../js/visual-field/visual-field-record.mjs');
global.OS.visualField.printoutFields = require('../../js/visual-field/visual-field-printout-fields.mjs');
global.OS.visualField.protocol = require('../../js/visual-field/visual-field-protocol.mjs');
global.OS.visualField.protocols = require('../../js/visual-field/visual-field-protocols.mjs');
global.OS.visualField.textLayer = require('../../js/visual-field/visual-field-text-layer.mjs');
global.OS.visualField.extract = require('../../js/visual-field/visual-field-extract.mjs');
global.OS.visualField.glyphReader = require('../../js/visual-field/visual-field-glyph-reader.mjs');
const { createCanvas } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '../..');
const DIR = path.resolve(__dirname, '../e2e/fixtures/visual-field/sources/zeiss_multi');
const readFile = (rel) => fs.promises.readFile(path.join(root, rel), 'utf8');
let doc, dirs;
test.before(async () => {
  dirs = await (await import(pathToFileURL(path.join(root, 'js/data/visual-field/directories.mjs')).href)).loadDirectories({ readFile });
  const docs = await global.OS.visualField.protocols.load({ readFile, directories: dirs });
  doc = docs.find((p) => p.id === 'zeiss_multi');
});

// Same render the browser pipeline makes: PDF.js onto a canvas at the glyph reader's fixed integer scale.
async function rasterReader(page) {
  const SCALE = global.OS.visualField.glyphReader.RENDER_SCALE, viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height)), ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return global.OS.visualField.glyphReader.createGlyphReader({ image: ctx.getImageData(0, 0, canvas.width, canvas.height), scale: SCALE });
}
const cache = {};
async function run(name) {
  if (cache[name]) return cache[name];
  const pdfjs = await import(path.resolve(__dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(DIR, name + '.pdf'))), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
    const items = global.OS.visualField.textLayer.normalize(await page.getTextContent(), viewport.height);
    if (n === 1) assert.equal(global.OS.visualField.protocol.detect(global.OS.visualField.protocols.all(), items), doc);
    pages.push({ page: n, points: await global.OS.visualField.extract.extractPage(doc, n, {
      'text-layer': global.OS.visualField.textLayer.createTextLayerReader(items), 'raster-glyph': await rasterReader(page) }, dirs) });
  }
  cache[name] = pages;
  return pages;
}
function strip(points) { return points.map((p) => ({ id: p.id, home: p.home, block: p.block, raw: p.raw, status: p.status, value: p.value })); }
function tests(pages) {
  const out = [];
  pages.forEach((page) => { for (let i = 0; i < 3; i += 1) { const pts = page.points.filter((p) => p.block && p.block.index === i); if (pts.length) out.push(pts); } });
  return out;
}
const field = (pts, id) => pts.find((p) => p.id === id);
const thresholds = (pts) => pts.filter((p) => /threshold\.p/.test(p.id)).map((p) => p.raw);

for (const [name, eye] of [['hvf_7724798', 'OD'], ['hvf_7724801', 'OS']]) {
  test(`zeiss_multi reproduces the ${eye} golden exactly`, async () => {
    const golden = JSON.parse(fs.readFileSync(path.join(DIR, name + '.golden.json')));
    assert.deepEqual(golden.protocol, { id: doc.id, version: doc.version });
    const pages = await run(name);
    assert.equal(pages.length, golden.pages.length);
    pages.forEach((page, i) => assert.deepEqual(strip(page.points), golden.pages[i].points, 'page ' + (i + 1)));
  });
  test(`zeiss_multi ${eye}: 25 anchored tests, every one with a pattern and a fully read grid`, async () => {
    const pages = await run(name);
    const all = tests(pages);
    assert.equal(all.length, 25);
    all.forEach((pts) => {
      const pattern = field(pts, 'testDefinition.pattern');
      assert.equal(pattern.status, 'read');
      const cells = pts.filter((p) => /threshold\.p/.test(p.id));
      assert.equal(cells.length, pattern.value.value === '30-2' ? 76 : 54);
      assert.equal(cells.filter((c) => c.status === 'read').length, cells.length, 'every printed threshold reads');
      assert.equal(field(pts, 'acquisition.testDate').status, 'read');
      ['testDefinition.strategy', 'globals.ght', 'globals.vfi', 'globals.md', 'globals.psd', 'reliability.fl', 'reliability.fn', 'reliability.fp']
        .forEach((id) => assert.equal(field(pts, id).status, 'read', id));
    });
    assert.equal(all.filter((pts) => field(pts, 'testDefinition.pattern').value.value === '30-2').length, 6);
    pages.forEach((page) => assert.equal(field(page.points, 'identity.eye').value.value, eye));
    assert.equal(field(pages[0].points, 'identity.birthDate').value.value, '1950-05-30');
    assert.deepEqual(field(pages[8].points, 'document.page').value.value, { page: 9, of: 9 });
  });
}

// Values read off the rendered pages by eye (overlay check, 2026-08-27) — the golden is a claim; this is its evidence.
test('zeiss_multi OD 1999-11-16 (30-2): the first printed row and the globals match the page', async () => {
  const first = tests(await run('hvf_7724798'))[0];
  assert.equal(field(first, 'acquisition.testDate').value.value, '1999-11-16');
  assert.deepEqual(thresholds(first).slice(0, 4), ['23', '24', '21', '21']);
  assert.deepEqual(thresholds(first).slice(4, 10), ['28', '27', '26', '26', '29', '26']);
  assert.deepEqual(field(first, 'globals.md').value, { value: -0.4, unit: 'dB' });
  assert.deepEqual(field(first, 'globals.psd').value, { value: 1.31, unit: 'dB' });
  assert.deepEqual(field(first, 'reliability.fl').value, { value: 0, numerator: 0, denominator: 17, excessive: false });
  assert.deepEqual(field(first, 'acquisition.pupilDiameterMm').value, { value: 5.1, unit: 'mm', flagged: true });
  assert.equal(field(first, 'measurement.foveaThreshold').status, 'absent');
});

test('zeiss_multi OS 2026-04-28 (24-2, last page): censored cells, p-values, no pupil printed', async () => {
  const last = tests(await run('hvf_7724801'))[24];
  assert.equal(field(last, 'acquisition.testDate').value.value, '2026-04-28');
  const cells = thresholds(last);
  assert.deepEqual(cells.slice(0, 4), ['14', '18', '19', '17']);
  assert.deepEqual(cells.slice(18, 27), ['28', '25', '27', '28', '27', '28', '25', '<0', '<0'], 'the mirrored nasal row of nine ends in two censored cells');
  assert.deepEqual(field(last, 'globals.md').value, { value: -5.06, unit: 'dB', probability: 'p<0.5%' });
  assert.deepEqual(field(last, 'globals.vfi').value, { value: 90, unit: '%' });
  assert.deepEqual(field(last, 'measurement.foveaThreshold').value, { value: 22, unit: 'dB' });
  assert.equal(field(last, 'globals.ght').value.value, 'outside-normal-limits');
  assert.equal(field(last, 'acquisition.pupilDiameterMm').status, 'absent');
});

test('zeiss_multi OS 2007-04-04: FL 0/0 keeps its counts, PSD carries p<10%, 2008 is flagged low reliability', async () => {
  const all = tests(await run('hvf_7724801'));
  const t2007 = all.find((pts) => field(pts, 'acquisition.testDate').value.value === '2007-04-04');
  assert.deepEqual(field(t2007, 'reliability.fl').value, { value: null, numerator: 0, denominator: 0, excessive: false });
  assert.deepEqual(field(t2007, 'globals.psd').value, { value: 1.95, unit: 'dB', probability: 'p<10%' });
  assert.equal(field(t2007, 'globals.ght').value.value, 'borderline');
  const t2008 = all.find((pts) => field(pts, 'acquisition.testDate').value.value === '2008-05-15');
  assert.deepEqual(field(t2008, 'reliability.lowReliability').value, { value: true });
  assert.deepEqual(field(t2008, 'reliability.fl').value, { value: 3 / 14, numerator: 3, denominator: 14, excessive: true });
});

// Native entity (spec §4): every Point names the attribute home it fills, so assembly is a lookup, never a mapping.
test('every Point names a home that is an attribute', async () => {
  const homes = new Set(dirs.attributes.entries.map((a) => a.home));
  for (const name of ['hvf_7724798', 'hvf_7724801']) {
    const points = (await run(name)).flatMap((p) => p.points);
    assert.ok(points.length > 4000, name);
    points.forEach((p) => assert.ok(typeof p.home === 'string' && homes.has(p.home), name + ' ' + p.id + ' → ' + p.home));
  }
});

// Ruling 0 (source-registration spec): every printed item on the source maps to a Point; the TD/PD probability plots
// are read cell by cell through the raster-glyph reader; nothing is left not-extracted.
test('coverage proof: every printed item on both fixtures maps to a Point; not-extracted == 0', async () => {
  for (const name of ['hvf_7724798', 'hvf_7724801']) {
    const pages = await run(name);
    const all = pages.flatMap((p) => p.points);
    assert.equal(all.filter((p) => p.status === 'not-extracted').length, 0, name + ' has not-extracted points');
    for (const pts of tests(pages)) {
      const n = field(pts, 'testDefinition.pattern').value.value === '30-2' ? 76 : 54;
      for (const grid of ['analysis.totalDeviationProbability', 'analysis.patternDeviationProbability']) {
        const cells = pts.filter((p) => p.id.indexOf(grid + '.p') === 0);
        assert.equal(cells.length, n, name + ' ' + grid);
        assert.ok(cells.every((c) => c.status === 'read' || c.status === 'absent'), grid + ' cells are read or honestly absent');
        assert.ok(cells.some((c) => c.status === 'read'), grid + ' reads at least one glyph');
        assert.ok(cells.every((c) => c.reader === 'raster-glyph'), grid + ' cells come from the raster-glyph reader');
      }
    }
  }
});

test('complete PDF extraction assembles graphs conforming to the preserved schema', async () => {
  const { createModel } = await import(pathToFileURL(path.join(root, 'js/data/visual-field/model.mjs')).href);
  const { assembleGraph } = await import(pathToFileURL(path.join(root, 'js/data/visual-field/assemble.mjs')).href);
  const hash = text => require('node:crypto').createHash('sha256').update(text).digest('hex');
  for (const name of ['hvf_7724798', 'hvf_7724801']) {
    const bytes = fs.readFileSync(path.join(DIR, name + '.pdf'));
    const model = createModel(dirs);
    const graph = assembleGraph({ model, directories: dirs, registration: {
      ...doc.source, format: 'pdf-printout', protocol: { id: doc.id, version: doc.version }, anchorsMatched: doc.detect.anchors.length
    }, pages: await run(name), file: { name: name + '.pdf', sha256: hash(bytes), mime: 'application/pdf', bytes: bytes.length, pageCount: 9 },
    subject: 'patients/standalone-demo-subject', deposit: { at: '2026-09-17', by: 'local-demo' } });
    await model.stampIdentities(graph, async text => hash(text));
    const verdict = model.validateGraph(graph);
    assert.equal(verdict.ok, true, verdict.errors.slice(0, 5).join('; '));
  }
});
