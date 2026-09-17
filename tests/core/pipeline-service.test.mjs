import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pipeline } from '../../js/pipeline/core.mjs';
import { createService } from '../../server.mjs';
import { exportSession } from '../../js/pipeline/outputs.mjs';
import http from 'node:http';
const matrix = new Uint8Array(await readFile(new URL('../../examples/matrix-od.json', import.meta.url)));

test('shared pipeline deduplicates same bytes/context and preserves representations across replay', async () => {
  const pipeline = new Pipeline();
  const input = { bytes: matrix, name: 'matrix.json', context: {} };
  assert.equal((await pipeline.importFile(input)).status, 'accepted');
  assert.equal((await pipeline.importFile(input)).status, 'duplicate');
  assert.equal(pipeline.examinations.length, 1);
  const session = exportSession(pipeline.snapshot({ portable: true }), { analysis: 'all' });
  const restored = new Pipeline();
  const reply = await restored.importFile({ bytes: Buffer.from(session), name: 'session.json' });
  assert.equal(reply.status, 'accepted', reply.reason);
  assert.deepEqual(restored.snapshot({ portable: true }).examinations, pipeline.snapshot({ portable: true }).examinations);
  const corrupt = JSON.parse(session); corrupt.sources[0].originalBase64 = Buffer.from('tampered').toString('base64');
  assert.equal((await restored.importFile({ bytes: Buffer.from(JSON.stringify(corrupt)), name: 'tampered.json' })).status, 'rejected');
  assert.equal(restored.examinations.length, 1);
  pipeline.reset(); restored.reset();
});

test('reset cancels in-flight imports and queued imports without repopulating the session', async () => {
  const pipeline = new Pipeline(); await pipeline.ready();
  const pending = pipeline.importFile({ bytes: matrix, name: 'one.json' });
  const queued = pipeline.importFile({ bytes: matrix, name: 'two.json' });
  await new Promise(resolve => setTimeout(resolve, 5)); pipeline.reset();
  const results = await Promise.all([pending, queued]);
  assert.ok(results.every(r => r.status === 'cancelled')); assert.equal(pipeline.examinations.length, 0); assert.equal(pipeline.outcomes.length, 0);
  assert.equal((await pipeline.importFile({ bytes: matrix, name: 'retry.json' })).status, 'accepted'); pipeline.reset();
});

test('reset cancels a calculation and replay merges missing history without changing measurements', async () => {
  const pipeline = new Pipeline(); await pipeline.importFile({ bytes: matrix, name: 'matrix.json' });
  const baseline = pipeline.snapshot({ portable: true });
  const pending = pipeline.analyze();
  await new Promise(resolve => setImmediate(resolve)); pipeline.reset();
  assert.equal((await pending)[0].status, 'cancelled'); assert.equal(pipeline.examinations.length, 0);
  pipeline.replay(baseline, {});
  assert.equal((await pipeline.analyze())[0].status, 'calculated');
  const history = pipeline.snapshot({ portable: true });
  const restored = new Pipeline(); await restored.ready(); restored.replay(baseline, {});
  const outcome = {}; restored.replay(history, outcome); assert.equal(outcome.status, 'accepted');
  assert.equal(restored.examinations[0].analyses.filter(a => a.origin === 'computed').length, 1);
  assert.deepEqual(restored.examinations[0].measurements, baseline.examinations[0].measurements);
  const duplicate = {}; restored.replay(history, duplicate); assert.equal(duplicate.status, 'duplicate');
  pipeline.reset(); restored.reset();
});

test('reset while upload body is incomplete cannot revive pre-reset work', async t => {
  const { server } = await createService(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const text = JSON.stringify({ name: 'matrix.json', base64: Buffer.from(matrix).toString('base64') });
  let request;
  const reply = new Promise((resolve, reject) => {
    request = http.request(base + '/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } }, res => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) })); });
    request.on('error', reject); request.write(text.slice(0, 10));
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  await fetch(base + '/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  request.end(text.slice(10));
  assert.equal((await reply).status, 400);
  assert.equal((await (await fetch(base + '/api/session')).json()).examinations.length, 0);
});

test('loopback service rejects foreign origins hosts and hidden paths, serves UI and shared GraphQL', async t => {
  const { server } = await createService(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/node_modules/graphql/package.json')).status, 404);
  assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(base + '/api/session', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
  const post = (path, value) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal((await (await post('/api/import', { name: 'matrix.json', base64: Buffer.from(matrix).toString('base64') })).json()).status, 'accepted');
  const snapshot = await (await fetch(base + '/api/session')).json(); assert.equal(snapshot.examinations.length, 1);
  const query = await (await post('/graphql', { query: '{ examinations { id eye date measurements { id value unit absenceReason } } }' })).json();
  assert.equal(query.errors, undefined); assert.equal(query.data.examinations[0].id, snapshot.examinations[0].id);
  await post('/api/reset', {}); assert.equal((await (await fetch(base + '/api/session')).json()).examinations.length, 0);
});
