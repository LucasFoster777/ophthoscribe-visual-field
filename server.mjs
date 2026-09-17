import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline, MAX_SESSION_BYTES } from './js/pipeline/core.mjs';
import { ROOT } from './js/pipeline/environment.mjs';
import { exportSession, exportCSV, exportFHIR } from './js/pipeline/outputs.mjs';
import { executeQuery } from './js/pipeline/graphql.mjs';

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.csv': 'text/csv', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.bcmap': 'application/octet-stream' };
const json = (response, data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
async function body(request, limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw Object.assign(new Error('Use application/json.'), { status: 415 });
  if (Number(request.headers['content-length'] || 0) > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
  let length = 0; const chunks = [];
  for await (const chunk of request) { length += chunk.length; if (length > limit) throw Object.assign(new Error('Request too large.'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid JSON request.'); }
}
export async function createService({ pipeline = new Pipeline() } = {}) {
  await pipeline.ready();
  let mutations = 0;
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
    const port = server.address()?.port;
    const origin = `http://127.0.0.1:${port}`;
    try {
      if (request.headers.host !== `127.0.0.1:${port}`) return json(response, { error: 'Use the displayed 127.0.0.1 application address.' }, 403);
      if ((request.headers.origin && request.headers.origin !== origin) || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) return json(response, { error: 'Cross-origin access is not permitted.' }, 403);
      const url = new URL(request.url, origin), path = decodeURIComponent(url.pathname);
      if (request.method === 'GET' && path === '/api/session') return json(response, pipeline.snapshot());
      if (request.method === 'GET' && path === '/api/outcomes') return json(response, pipeline.snapshot().outcomes);
      if (request.method === 'GET' && path === '/api/examinations') return json(response, pipeline.snapshot().examinations);
      if (request.method === 'GET' && path.startsWith('/api/sources/') && path.endsWith('/original')) {
        const id = path.slice('/api/sources/'.length, -'/original'.length), source = pipeline.sources.find(s => s.id === id);
        if (!source?.originalBase64) return json(response, { error: 'Original bytes unavailable for this source.' }, 404);
        const type = source.format === 'zeiss-pdf' || source.format === 'pdf' ? 'application/pdf' : 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}` });
        return response.end(Buffer.from(source.originalBase64, 'base64'));
      }
      if (request.method === 'GET' && path === '/api/export') {
        const options = { analysis: url.searchParams.get('analysis') || 'source-only' };
        for (const key of ['sourceIds', 'examinationIds']) if (url.searchParams.has(key)) options[key] = url.searchParams.get(key).split(',').filter(Boolean);
        const snapshot = pipeline.snapshot({ portable: true }), format = url.searchParams.get('format') || 'json';
        const data = format === 'json' ? exportSession(snapshot, options) : format === 'csv' ? JSON.stringify(exportCSV(snapshot, options), null, 2) : format === 'fhir' ? JSON.stringify(exportFHIR(snapshot, options), null, 2) : null;
        if (data === null) throw new Error('Unknown export format.');
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="visual-field-${format}.json"` }); return response.end(data);
      }
      if (request.method === 'POST' && path === '/graphql') return json(response, await executeQuery(pipeline.snapshot(), await body(request, 65536)));
      if (request.method === 'POST' && path === '/api/reset') { await body(request, 1024); pipeline.reset(); return json(response, { reset: true }); }
      if (request.method === 'POST' && ['/api/import', '/api/analyze'].includes(path)) {
        if (mutations) return json(response, { error: 'An import or calculation is already running. Retry when it finishes, or reset.' }, 409);
        mutations++;
        const generation = pipeline.generation;
        const current = () => { if (generation !== pipeline.generation) throw new Error('Session reset; request cancelled.'); };
        try {
          if (path === '/api/analyze') { const input = await body(request, 65536); current(); return json(response, await pipeline.analyze(input)); }
          const input = await body(request, Math.ceil(MAX_SESSION_BYTES * 4 / 3) + 65536);
          current();
          if (typeof input.base64 !== 'string' || input.base64.length % 4 !== 0) throw new Error('Invalid base64 input.');
          const bytes = Buffer.from(input.base64, 'base64');
          if (bytes.toString('base64') !== input.base64) throw new Error('Invalid base64 input.');
          return json(response, await pipeline.importFile({ bytes: new Uint8Array(bytes), name: input.name, context: input.context }));
        } finally { mutations--; }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, { error: 'Method not allowed.' }, 405);
      // Serve only the application's public assets, never repository metadata, dependency trees, or local paths.
      const relative = path === '/' ? 'index.html' : path.slice(1);
      if (!(relative === 'index.html' || /^(js|css|data\/directories|examples|tests\/e2e\/fixtures\/visual-field\/sources\/zeiss_multi)\//.test(relative)) || relative.split('/').some(s => s.startsWith('.')) || relative.startsWith('js/pipeline/')) return json(response, { error: 'Not found.' }, 404);
      const target = await realpath(resolve(ROOT, relative));
      if (!target.startsWith(ROOT + sep) && !target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return json(response, { error: 'Not found.' }, 404);
      const content = await readFile(target);
      response.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' }); response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!response.headersSent) json(response, { error: error.code === 'ENOENT' ? 'Not found.' : error.message }, error.status || (error.code === 'ENOENT' ? 404 : 400)); else response.end(); }
  });
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.maxHeadersCount = 50;
  server.on('close', () => pipeline.reset());
  return { server, pipeline };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const { server } = await createService();
  server.listen(port, '127.0.0.1', () => console.log(`Visual-field pipeline: http://127.0.0.1:${port}`));
}
