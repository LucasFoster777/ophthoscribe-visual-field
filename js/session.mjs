// Standalone orchestration. The extraction graph is never modified by analysis.
import { loadDirectories, browserReadFile } from './data/visual-field/directories.mjs';
import { createModel } from './data/visual-field/model.mjs';
import { assembleGraph, computedBlockForTest } from './data/visual-field/assemble.mjs';
import { api as protocols } from './visual-field/visual-field-protocols.mjs';
import { api as protocol } from './visual-field/visual-field-protocol.mjs';
import { api as textLayer } from './visual-field/visual-field-text-layer.mjs';
import { api as extract } from './visual-field/visual-field-extract.mjs';
import { api as glyph } from './visual-field/visual-field-glyph-reader.mjs';
import { register } from './visual-field/visual-field-provider.mjs';
import { api as registry, bind } from './visual-field/visual-field-dev-registry.mjs';

export const SOURCE_REVISION = '478e764144fe2261b53fb477ede094a2ad4bb494';
const typed = cell => cell && typeof cell.state !== 'string' && cell.value !== undefined ? cell : null;
// Same input mapping as visual-field-dev-analysis at the source revision.
export function inputOf(test) {
  const age = typed(test.acquisition.ageYears), points = test.measurement.points || [], r = test.measurement.reliability || {};
  if (points.length !== 54 || !age || !Number.isFinite(Number(age.value))) return null;
  const fp = typed(r.fp), fn = typed(r.fn), fl = r.fl && typeof r.fl.state !== 'string' ? r.fl : null;
  return { eye: test.measurement.eye, ageYears: Number(age.value), fp: fp ? Number(fp.value) / 100 : 0, fn: fn ? Number(fn.value) / 100 : 0,
    fl: fl && Number(fl.denominator) > 0 ? Number(fl.numerator) / Number(fl.denominator) : 0, testOrdinalConfirmed: false,
    thresholds: points.map(p => { const c = typed(p.threshold); return c ? { state: 'read', value: Number(c.value), censored: !!c.censored } : { state: 'not-read', value: null }; }) };
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
const cancelled = () => new DOMException('Session reset.', 'AbortError');

export class Session {
  reports = [];
  computed = new Map();
  grayscales = new Map();
  pending = new Set();
  tasks = new Set();
  urls = new Set();
  generation = 0;
  ready() {
    if (!this.readiness) this.readiness = this.initialize().catch(error => {
      this.readiness = null;
      throw error;
    });
    return this.readiness;
  }
  async initialize() {
    const readFile = browserReadFile(globalThis);
    const directories = await loadDirectories({ readFile });
    const verdict = directories.validate();
    if (!verdict.ok) throw new Error('Invalid visual-field directories.');
    await protocols.load({ readFile, directories });
    this.model = createModel(directories);
    register('directories', directories);
    register('devRegistry', registry);
    bind({ devAnalysis: { analyze: (input, dataset) => this.ask('analysis', { input, dataset }) } });
    this.directories = directories;
  }
  ask(kind, message) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`./visual-field/visual-field-${kind}-worker.mjs`, import.meta.url), { type: 'module' });
      const id = crypto.randomUUID();
      const finish = (error, value) => {
        clearTimeout(timer); worker.terminate(); this.pending.delete(stop);
        if (error) reject(error); else resolve(value);
      };
      const stop = () => finish(cancelled());
      const timer = setTimeout(() => finish(new Error(`${kind} worker timed out.`)), 5000);
      this.pending.add(stop);
      worker.onmessage = event => {
        if (event.data?.id !== id) return;
        finish(event.data.ok ? null : new Error(event.data.error || 'Grayscale rendering failed.'), event.data);
      };
      worker.onerror = event => { event.preventDefault(); finish(new Error(`${kind} worker failed.`)); };
      worker.postMessage({ ...message, id });
    });
  }
  async importPdf(file, progress = () => {}) {
    const generation = this.generation;
    const current = () => { if (generation !== this.generation) throw cancelled(); };
    await this.ready(); current();
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs'); current();
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    const bytes = new Uint8Array(await file.arrayBuffer()); current();
    const digest = await sha256(bytes); current();
    const existing = this.reports.find(r => r.graph.source.file.sha256 === digest);
    if (existing) return existing;
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false,
      standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href });
    this.tasks.add(task);
    try {
      const pdf = await task.promise; current();
      const pages = []; let doc, pageSize;
      for (let n = 1; n <= pdf.numPages; n++) {
        current(); progress(`Extracting ${file.name}: page ${n} of ${pdf.numPages}…`);
        const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 }); current();
        const items = textLayer.normalize(await page.getTextContent(), viewport.height); current();
        if (n === 1) {
          doc = protocol.detect(protocols.all(), items);
          if (!doc) throw new Error('Unsupported PDF. This demo supports Zeiss FORUM Overview reports with the zeiss_multi protocol.');
          pageSize = { width: viewport.width, height: viewport.height };
        }
        if (Math.abs(viewport.width - doc.page.width) > doc.page.tolerance || Math.abs(viewport.height - doc.page.height) > doc.page.tolerance)
          throw new Error(`Page ${n} does not match the supported Overview page size.`);
        const readers = { 'text-layer': textLayer.createTextLayerReader(items) };
        if (protocol.needsRaster(doc)) {
          const scale = glyph.RENDER_SCALE, raster = page.getViewport({ scale });
          const canvas = document.createElement('canvas'); canvas.width = Math.round(raster.width); canvas.height = Math.round(raster.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          try {
            await page.render({ canvasContext: ctx, viewport: raster }).promise; current();
            readers['raster-glyph'] = glyph.createGlyphReader({ image: ctx.getImageData(0, 0, canvas.width, canvas.height), scale });
          } finally { canvas.width = 0; canvas.height = 0; }
        }
        pages.push({ page: n, points: await extract.extractPage(doc, n, readers, this.directories) }); current();
      }
      const kind = this.directories.reportKind(doc.source.reportKind);
      const graph = assembleGraph({ model: this.model, directories: this.directories,
        registration: { ...doc.source, protocol: { id: doc.id, version: doc.version }, format: kind.format, anchorsMatched: doc.detect.anchors.length, pageSize },
        pages, file: { name: file.name, mime: 'application/pdf', bytes: bytes.byteLength, sha256: digest, pageCount: pdf.numPages },
        subject: 'patients/standalone-demo-subject', encounter: '', deposit: { at: new Date().toISOString(), by: 'local-demo' } });
      if (!graph.tests.length) throw new Error('No supported examinations were found in this PDF.');
      await this.model.stampIdentities(graph, sha256); current();
      const verdict = this.model.validateGraph(graph);
      if (!verdict.ok) throw new Error('Extracted graph failed schema validation: ' + verdict.errors[0]);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); this.urls.add(url);
      const report = { graph, bytes, pdf, url, name: file.name };
      this.reports.push(report); return report;
    } catch (error) {
      this.tasks.delete(task); await task.destroy(); throw error;
    }
  }
  blocks(test) { return this.computed.get(test.identifier) || []; }
  projectedTest(test) { return { ...test, analyses: [...test.analyses, ...this.blocks(test)] }; }
  eligibility(test) {
    if (test.testDefinition.pattern !== '24-2') return 'No normative dataset is available for this pattern. The current engine supports 24-2 only.';
    if (!inputOf(test)) return 'Analysis requires 54 threshold locations and an available age.';
    if (!this.directories.datasetsFor(test.testDefinition.pattern).length) return 'No normative dataset is available for this test.';
    return '';
  }
  async compute(test, force = false) {
    const reason = this.eligibility(test); if (reason) throw new Error(reason);
    if (!force && this.blocks(test).length) return;
    const generation = this.generation;
    const ref = this.directories.datasetsFor(test.testDefinition.pattern)[0];
    const dataset = this.directories.dataset(ref.id, ref.version);
    const run = await registry.engine('conventional').run(inputOf(test), dataset);
    if (generation !== this.generation) throw cancelled();
    const block = computedBlockForTest(this.model, this.directories, test, run.result, { overlays: run.overlays });
    this.computed.set(test.identifier, [...this.blocks(test), block]);
  }
  async grayscale(test) {
    if (this.grayscales.has(test.identifier)) return this.grayscales.get(test.identifier);
    const generation = this.generation;
    const reply = await this.ask('grayscale', { eye: test.measurement.eye,
      thresholds: test.measurement.points.map(p => { const c = typed(p.threshold); return c ? { value: Number(c.value), state: 'read', censored: !!c.censored } : { value: null, state: 'not-read' }; }),
      coordinates: test.measurement.grid.points.map(p => ({ xOd: p.x, y: p.y })) });
    if (generation !== this.generation) throw cancelled();
    const blob = new Blob([reply.bytes], { type: 'image/png' }); this.grayscales.set(test.identifier, blob); return blob;
  }
  exportData() {
    return { sourceRevision: SOURCE_REVISION, extractedGraphs: this.reports.map(r => r.graph),
      computedAnalyses: [...this.computed].map(([testIdentifier, blocks]) => ({ testIdentifier, blocks })),
      datasets: this.directories ? this.directories.datasets.entries.map(d => this.directories.dataset(d.id, d.version)) : [] };
  }
  async reset() {
    this.generation++;
    for (const stop of [...this.pending]) stop();
    const tasks = [...this.tasks]; this.tasks.clear();
    for (const url of this.urls) URL.revokeObjectURL(url); this.urls.clear();
    this.reports = []; this.computed.clear(); this.grayscales.clear();
    await Promise.allSettled(tasks.map(task => task.destroy()));
  }
}
