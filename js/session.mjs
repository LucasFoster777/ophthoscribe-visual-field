// Read-only browser projection of the session owned by the local service.
import { loadDirectories, browserReadFile } from './data/visual-field/directories.mjs';
import { api as registry } from './visual-field/visual-field-dev-registry.mjs';
import { register } from './visual-field/visual-field-provider.mjs';
export const SOURCE_REVISION = '478e764144fe2261b53fb477ede094a2ad4bb494';
const cancelled = () => new DOMException('Session reset', 'AbortError');
const typed = cell => cell && typeof cell.state !== 'string' && cell.value !== undefined ? cell : null;
export class Session {
  snapshot = { sources: [], examinations: [], outcomes: [] };
  generation = 0;
  pending = new Set();
  grayscales = new Map();
  async request(path, body) {
    const generation = this.generation;
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (generation !== this.generation) throw cancelled();
    if (!response.ok) throw new Error(data.error || 'Local service request failed.');
    return data;
  }
  async ready() {
    if (!this.directories) {
      this.directories = await loadDirectories({ readFile: browserReadFile(globalThis) });
      register('directories', this.directories);
      register('devRegistry', registry);
    }
    await this.refresh();
  }
  async refresh() { this.snapshot = await this.request('/api/session'); }
  async importFile(file, context) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const result = await this.request('/api/import', { name: file.name, base64: btoa(binary), context });
    await this.refresh(); return result;
  }
  blocks(examination) { return examination.analyses.filter(block => block.origin === 'computed'); }
  projectedTest(examination) {
    if (!examination.graphTest) return null;
    const test = structuredClone(examination.graphTest);
    test.identifier = examination.id;
    test.analyses = examination.analyses.filter(block => ['device-reported', 'computed'].includes(block.origin) && block.legacyBlock).map(block => ({ ...block.legacyBlock, origin: block.origin === 'computed' ? 'computed' : 'printed' }));
    return test;
  }
  async compute(examination, force = false) {
    const result = await this.request('/api/analyze', { examinationIds: examination ? [examination.id] : undefined, force });
    await this.refresh(); return result;
  }
  async reset() {
    this.generation++;
    for (const stop of [...this.pending]) stop();
    this.grayscales.clear();
    await this.request('/api/reset', {}); await this.refresh();
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
  async grayscale(test) {
    if (this.grayscales.has(test.identifier)) return this.grayscales.get(test.identifier);
    const generation = this.generation;
    const reply = await this.ask('grayscale', { eye: test.measurement.eye,
      thresholds: test.measurement.points.map(p => { const c = typed(p.threshold); return c ? { value: Number(c.value), state: 'read', censored: !!c.censored } : { value: null, state: 'not-read' }; }),
      coordinates: test.measurement.grid.points.map(p => ({ xOd: p.x, y: p.y })) });
    if (generation !== this.generation) throw cancelled();
    const blob = new Blob([reply.bytes], { type: 'image/png' }); this.grayscales.set(test.identifier, blob); return blob;
  }
}
