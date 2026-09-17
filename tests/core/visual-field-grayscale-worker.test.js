// The clinic door's grayscale worker (js/visual-field/visual-field-grayscale-worker.mjs): PNG module only, never the
// normative table or the analysis core (two-lane spec §7 item 2). A module worker since the DELIV-03 Visual Field
// migration (slice 2): it imports its closure once with its own stamped query, so the test gives it a `self` whose
// location is the worker file itself and lets the real PNG module render.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const { pathToFileURL } = require('node:url');
const WORKER = path.resolve(__dirname, '../../js/visual-field/visual-field-grayscale-worker.mjs');
const src = fs.readFileSync(WORKER, 'utf8');
test('the grayscale worker imports only the PNG module — never the normative table or the analysis core', () => {
  const imports = [...src.matchAll(/import\(new URL\('([^']+)'/g)].map((m) => m[1]).join(' ');
  assert.equal(imports, './visual-field-png.mjs'); assert.doesNotMatch(src, /normative|analysis-core|matrix|importScripts/);
});
let workerImports = 0;
async function bootWorker(posted, digest) {
  global.self = { location: { search: '', href: pathToFileURL(WORKER).href }, postMessage: (m) => posted.push(m),
    crypto: { subtle: { digest: digest || (async () => new Uint8Array(32).buffer) } } };
  await import(pathToFileURL(WORKER).href + '?t=' + (workerImports += 1));
  return global.self;
}
test('renders from thresholds + coordinates and posts the bytes with a sha256', async () => {
  const posted = [];
  const self = await bootWorker(posted);
  self.onmessage({ data: { id: 'a', eye: 'OD', thresholds: Array(54).fill({ value: 30, state: 'read' }), coordinates: Array.from({ length: 54 }, (_, i) => ({ xOd: (i % 9) * 6 - 24, y: Math.floor(i / 9) * 6 - 15 })) } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posted[0].ok, true); assert.equal(posted[0].id, 'a'); assert.ok(posted[0].width > 0); assert.equal(posted[0].sha256.length, 64);
  assert.ok(posted[0].bytes instanceof ArrayBuffer);
});
test('a render failure posts ok:false for the same id', async () => {
  const posted = [];
  const self = await bootWorker(posted, async () => { throw new Error('x'); });
  self.onmessage({ data: { id: 'b', eye: 'OD', thresholds: [{ value: 30, state: 'read' }], coordinates: [{ xOd: 0, y: 0 }] } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(posted[0].id, 'b'); assert.equal(posted[0].ok, false);
});
