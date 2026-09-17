import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { environment } from './environment.mjs';
import { inputOf, eligibility, assumptionsOf } from './analysis.mjs';
import { computedBlockForTest } from '../data/visual-field/assemble.mjs';
import { validateSession } from './contract.mjs';

export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_SESSION_BYTES = 128 * 1024 * 1024;
export const hash = value => createHash('sha256').update(value).digest('hex');
const cancelled = () => Object.assign(new Error('Session reset; operation cancelled.'), { code: 'CANCELLED' });
const clone = value => structuredClone(value);

export class Pipeline {
  sources = [];
  examinations = [];
  outcomes = [];
  generation = 0;
  jobs = new Set();
  queue = Promise.resolve();
  ready() { return this.readiness ||= environment().then(value => Object.assign(this, value)).catch(error => { this.readiness = null; throw error; }); }
  runWorker(name, data, timeout) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(`./${name}-worker.mjs`, import.meta.url), { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 512 } });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true; clearTimeout(timer); this.jobs.delete(stop); void worker.terminate();
        error ? reject(error) : resolve(value);
      };
      const stop = () => finish(cancelled());
      const timer = setTimeout(() => finish(new Error(`${name} exceeded its local execution limit.`)), timeout);
      this.jobs.add(stop);
      worker.once('message', reply => finish(reply.error ? Object.assign(new Error(reply.error), { code: reply.code }) : null, reply.result ? reply : reply));
      worker.once('error', error => finish(error));
      worker.once('exit', code => { if (!settled) finish(new Error(`${name} worker exited (${code}).`)); });
    });
  }
  snapshot({ portable = false } = {}) {
    return clone({ schema: 'ophthoscribe-vf-session', version: 1,
      sources: this.sources.map(source => {
        const { originalBase64, ...rest } = source;
        return { ...rest, hasOriginal: !!originalBase64, ...(portable && originalBase64 ? { originalBase64 } : {}) };
      }), examinations: this.examinations.map(exam => ({ ...exam, eligibility: eligibility(exam, this.directories) })), outcomes: this.outcomes });
  }
  importFile(input) {
    const generation = this.generation;
    const task = this.queue.catch(() => {}).then(() => this.importOne(input, generation));
    this.queue = task;
    return task;
  }
  async importOne({ bytes, name, context = {} }, generation) {
    const current = () => { if (generation !== this.generation) throw cancelled(); };
    const outcome = { name: String(name || 'unnamed'), status: 'rejected', examinationCount: 0, warnings: [], examinations: [] };
    try {
      current(); await this.ready(); current();
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_SESSION_BYTES) throw new Error('Input exceeds the 128 MiB portable-session limit.');
      if (bytes.length > MAX_FILE_BYTES) {
        let envelope; try { envelope = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error('Non-session input exceeds 32 MiB.'); }
        if (envelope?.schema !== 'ophthoscribe-vf-session') throw new Error('Non-session input exceeds 32 MiB.');
      }
      if (this.sources.length >= 100 || this.examinations.length >= 2000) throw new Error('Session limit reached; download and reset before continuing.');
      const sha256 = hash(bytes);
      const duplicate = this.sources.find(source => source.sha256 === sha256 && source.subject === context.subject);
      if (duplicate) Object.assign(outcome, { status: 'duplicate', sourceId: duplicate.id, format: duplicate.format, examinationCount: 0 });
      else {
        const { result } = await this.runWorker('import', { bytes, name: outcome.name, context }, 120000); current();
        outcome.format = result.format;
        outcome.warnings = result.warnings || [];
        outcome.examinations = result.outcomes || [];
        if (result.session) this.replay(result.session, outcome);
        else {
          const exams = result.examinations || [];
          if (!exams.length) throw new Error('No valid examinations found.');
          const subjects = [...new Set(exams.map(e => e.subject))];
          const subject = context.subject || (subjects.length === 1 ? subjects[0] : subjects.sort().join('|'));
          const id = 'src-' + hash(`${sha256}\n${subject}`).slice(0, 32);
          if (this.sources.some(s => s.id === id)) Object.assign(outcome, { status: 'duplicate', sourceId: id });
          else {
            const source = { id, subject, name: outcome.name, format: result.format, sha256, originalBase64: Buffer.from(bytes).toString('base64'),
              document: result.document ?? null, graphs: result.graphs || [], provenance: result.provenance || {}, warnings: outcome.warnings };
            if (this.sources.reduce((sum, s) => sum + (s.originalBase64?.length || 0), source.originalBase64.length) > 180 * 1024 * 1024) throw new Error('Session original-source capacity reached; download and reset.');
            const normalized = exams.map((exam, i) => {
              const examId = 'exam-' + hash(`${id}\n${exam.id || i}\n${i}`).slice(0, 32);
              return { ...exam, id: examId, sourceId: id, ...(exam.graphTest ? { graphTest: { ...exam.graphTest, identifier: examId } } : {}), analyses: (exam.analyses || []).map((block, j) => ({ ...block, id: `${examId}-source-${j + 1}` })) };
            });
            if (this.examinations.length + normalized.length > 2000) throw new Error('Session examination limit is 2000.');
            this.sources.push(source); this.examinations.push(...normalized);
            Object.assign(outcome, { status: 'accepted', sourceId: id, examinationCount: normalized.length,
              examinations: [...normalized.map(e => ({ id: e.id, status: 'accepted', eye: e.eye, date: e.date, warnings: eligibility(e, this.directories) ? [eligibility(e, this.directories)] : [] })), ...(result.outcomes || []).filter(o => o.status !== 'accepted')] });
          }
        }
      }
    } catch (error) {
      if (error.code === 'CANCELLED' || generation !== this.generation) return { ...outcome, status: 'cancelled', reason: 'Session reset.' };
      outcome.status = /context|required subject|subject.*required/i.test(error.message) ? 'missing-required-context' : 'rejected';
      outcome.reason = error.message;
    }
    current(); this.outcomes.push(outcome); return clone(outcome);
  }
  replay(session, outcome) {
    const verdict = validateSession(session, this.directories);
    if (!verdict.ok) throw new Error(verdict.errors.join('; '));
    if (session.schema !== 'ophthoscribe-vf-session' || session.version !== 1 || !Array.isArray(session.sources) || !Array.isArray(session.examinations)) throw new Error('Unsupported session contract.');
    if (session.sources.length + this.sources.length > 100 || session.examinations.length + this.examinations.length > 2000) throw new Error('Session capacity exceeded.');
    const sourceIds = new Set(), examIds = new Set(), blockIds = new Set();
    for (const source of session.sources) {
      if (typeof source.id !== 'string' || !source.id || sourceIds.has(source.id)) throw new Error('Invalid or duplicate source identifier.');
      sourceIds.add(source.id);
      if (source.originalBase64 && hash(Buffer.from(source.originalBase64, 'base64')) !== source.sha256) throw new Error('Original source bytes do not match their digest.');
      const existing = this.sources.find(s => s.id === source.id);
      if (existing && (existing.sha256 !== source.sha256 || existing.subject !== source.subject)) throw new Error('Source identifier collision.');
    }
    for (const exam of session.examinations) {
      if (typeof exam.id !== 'string' || !exam.id || examIds.has(exam.id) || !sourceIds.has(exam.sourceId)) throw new Error('Invalid examination identity or source reference.');
      examIds.add(exam.id);
      if (!exam.subject || !['OD', 'OS'].includes(exam.eye) || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date) || !['24-2', '30-2'].includes(exam.pattern) || !Array.isArray(exam.measurements) || !Array.isArray(exam.analyses)) throw new Error('Invalid canonical examination.');
      for (const point of exam.measurements) if ((point.value !== null && !Number.isFinite(point.value)) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.unit !== 'dB' || (point.value === null && !point.absenceReason)) throw new Error('Invalid canonical measurement.');
      for (const block of exam.analyses) {
        if (!block.id || blockIds.has(block.id) || !['device-reported', 'source-supplied', 'computed'].includes(block.origin)) throw new Error('Invalid analysis identity or origin.');
        blockIds.add(block.id);
      }
    }
    // Validate all collisions before mutation. Replay can append new history, never replace facts.
    const newSources = session.sources.filter(s => !this.sources.some(old => old.id === s.id));
    const exams = [], additions = [];
    for (const incoming of session.examinations) {
      const existing = this.examinations.find(e => e.id === incoming.id);
      if (!existing) { exams.push(incoming); continue; }
      for (const key of ['sourceId', 'subject', 'eye', 'date', 'pattern', 'age', 'measurements', 'reliability', 'attestations']) if (JSON.stringify(existing[key]) !== JSON.stringify(incoming[key])) throw new Error('Examination identifier conflicts with existing source facts.');
      for (const block of incoming.analyses) {
        const old = existing.analyses.find(b => b.id === block.id);
        if (old && JSON.stringify(old) !== JSON.stringify(block)) throw new Error('Analysis identifier conflicts with existing history.');
        if (!old) additions.push({ existing, block });
      }
      if (existing.analyses.length + additions.filter(a => a.existing === existing).length > 100) throw new Error('Calculation history exceeds 100 blocks.');
    }
    if ([...this.sources, ...newSources].reduce((sum, s) => sum + (s.originalBase64?.length || 0), 0) > 180 * 1024 * 1024) throw new Error('Session original-source capacity exceeded.');
    this.sources.push(...clone(newSources)); this.examinations.push(...clone(exams));
    for (const { existing, block } of additions) existing.analyses.push(clone(block));
    Object.assign(outcome, { status: newSources.length || exams.length || additions.length ? 'accepted' : 'duplicate', examinationCount: exams.length,
      examinations: exams.map(e => ({ id: e.id, status: 'accepted' })) });
  }
  async analyze({ examinationIds, force = false } = {}) {
    const generation = this.generation; await this.ready();
    if (generation !== this.generation) return [{ status: 'cancelled', reason: 'Session reset.' }];
    if (examinationIds && (!Array.isArray(examinationIds) || examinationIds.some(id => !this.examinations.some(e => e.id === id)))) throw new Error('Unknown examination selection.');
    const exams = this.examinations.filter(e => !examinationIds || examinationIds.includes(e.id));
    const outcomes = [];
    for (const exam of exams) {
      if (generation !== this.generation) break;
      const reason = eligibility(exam, this.directories);
      if (reason) { outcomes.push({ id: exam.id, status: 'ineligible', reason }); continue; }
      if (!force && exam.analyses.some(b => b.origin === 'computed')) { outcomes.push({ id: exam.id, status: 'existing' }); continue; }
      if (exam.analyses.length >= 100) { outcomes.push({ id: exam.id, status: 'failed', reason: 'Calculation history limit reached (100 blocks per examination).' }); continue; }
      try {
        const ref = this.directories.datasetsFor(exam.pattern)[0], dataset = this.directories.dataset(ref.id, ref.version);
        const { result, overlays } = await this.runWorker('analysis', { input: inputOf(exam.graphTest), dataset }, 10000);
        if (generation !== this.generation) break;
        const legacyBlock = computedBlockForTest(this.model, this.directories, exam.graphTest, result, { overlays });
        const id = `${exam.id}-computed-${exam.analyses.filter(b => b.origin === 'computed').length + 1}`;
        exam.analyses.push({ id, origin: 'computed', globals: Object.fromEntries(Object.entries(legacyBlock.values).filter(([key]) => key !== 'points')), points: legacyBlock.values.points, legacyBlock,
          provenance: { ...result.provenance, calculatedAt: new Date().toISOString(), assumptions: assumptionsOf(exam.graphTest) }, overlays });
        outcomes.push({ id: exam.id, status: 'calculated', analysisId: id });
      } catch (error) { outcomes.push({ id: exam.id, status: error.code === 'CANCELLED' ? 'cancelled' : 'failed', reason: error.message }); }
    }
    return outcomes;
  }
  reset() { this.generation++; for (const stop of [...this.jobs]) stop(); this.sources = []; this.examinations = []; this.outcomes = []; this.queue = Promise.resolve(); }
}
