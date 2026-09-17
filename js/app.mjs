import { Session } from './session.mjs';
import { renderReport, renderSource } from './display.mjs';
const session = new Session();
const $ = id => document.getElementById(id);
const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
let selected, door = 'view', version = 0, dispose = () => {}, importing = false;
const retryFiles = new Map(), busy = new Set(), attempted = new Set();
const status = message => { $('status').textContent = message; };
const guard = action => async () => { try { await action(); } catch (error) { if (error.name !== 'AbortError') status(error.message); } };
function outcomes() {
  $('outcomes').replaceChildren();
  for (const outcome of session.snapshot.outcomes || []) {
    const row = node('li', `${outcome.name || outcome.fileName || ''} · ${outcome.status || ''} · ${outcome.format || ''} · ${outcome.examinationIds?.length ?? outcome.examinations?.length ?? outcome.examinationCount ?? 0} examinations · ${outcome.message || outcome.reason || ''} ${(outcome.warnings || []).join('; ')}`);
    const file = retryFiles.get(outcome.name || outcome.fileName);
    if (file && !['accepted','duplicate'].includes(outcome.status)) { const retry = node('button', 'Retry with current context'); retry.onclick = guard(() => { file.importContext = { ...(file.importContext || {}), subject: $('subject').value.trim() }; return importFiles([file]); }); row.append(retry); }
    $('outcomes').append(row);
  }
}
function update(preferred = selected?.id) {
  outcomes();
  const entries = session.snapshot.examinations.filter(e => (!$('eye').value || e.eye === $('eye').value) && (!$('pattern').value || e.pattern === $('pattern').value));
  $('workspace').hidden = !session.snapshot.examinations.length;
  $('examination').replaceChildren(...entries.map(e => { const option = node('option', `${e.subject} · ${e.date} · ${e.eye} · ${e.pattern} · ${e.id.slice(-8)}`); option.value = e.id; return option; }));
  selected = entries.find(e => e.id === preferred) || entries[0];
  if (selected) $('examination').value = selected.id;
  render();
}
async function inspect(current) {
  const host = $('source'); host.replaceChildren();
  if (host.hidden || !selected) return;
  const examination = selected, source = session.snapshot.sources.find(s => s.id === examination.sourceId);
  host.append(node('h2', 'Source inspection'), node('p', `${source.format} · ${source.name} · ${source.hasOriginal ? 'Original bytes retained' : 'Original bytes unavailable; structured source retained'}`));
  const details = node('details', ''); details.append(node('summary', 'Normalized values, source locations and provenance'), node('pre', JSON.stringify({ source: { id: source.id, provenance: source.provenance, document: source.document }, examination }, null, 2))); host.append(details);
  if (/pdf|zeiss/i.test(source.format) && source.hasOriginal && examination.graphTest) {
    const target = node('div', ''); host.append(target);
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    const task = pdfjs.getDocument({ url: `/api/sources/${encodeURIComponent(source.id)}/original`, isEvalSupported: false, standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href });
    try { const pdf = await task.promise; if (current !== version) return; await renderSource(target, { test: examination.graphTest, pdf }); } finally { await task.destroy(); }
  } else {
    const table = node('table', ''); table.className = 'vf-point-table';
    const head = node('tr', ''); for (const label of ['Point', 'Coordinates', 'Value / missingness', 'Source location', 'Normalization']) head.append(node('th', label)); table.append(head);
    for (const p of examination.measurements) { const row = node('tr', ''); for (const value of [p.id, `${p.x}, ${p.y}`, p.value == null ? p.absenceReason : `${p.censored ? '<' : ''}${p.value} ${p.unit}`, JSON.stringify(p.sourceLocation), JSON.stringify(p.normalization)]) row.append(node('td', value)); table.append(row); } host.append(table);
  }
}
function render() {
  const current = ++version; dispose();
  $('report').replaceChildren(); $('analysis-status').textContent = '';
  $('zeiss').setAttribute('aria-pressed', String(door === 'view')); $('dev').setAttribute('aria-pressed', String(door === 'dev')); $('dev-controls').hidden = door !== 'dev';
  if (!selected) return;
  const examination = selected, source = session.snapshot.sources.find(s => s.id === examination.sourceId), blocks = session.blocks(examination), oldBlock = $('block').value;
  $('zeiss').textContent = examination.analyses.some(b => b.origin === 'device-reported') ? 'Zeiss View' : 'Normal View';
  $('original').hidden = !source.hasOriginal; $('original').href = `/api/sources/${encodeURIComponent(source.id)}/original`;
  $('block').replaceChildren(...blocks.map(b => { const option = node('option', b.id); option.value = b.id; return option; }));
  $('block').value = blocks.some(b => b.id === oldBlock) ? oldBlock : blocks.at(-1)?.id || '';
  $('recompute').disabled = !!examination.eligibility || busy.has(examination.id);
  const test = session.projectedTest(examination);
  const draw = grayscale => { if (current !== version) return; dispose(); dispose = renderReport($('report'), { test, door, blockIndex: blocks.findIndex(b => b.id === $('block').value), directories: session.directories, grayscale, examination, source }); };
  if (test?.measurement) { draw(session.grayscales.get(test.identifier)); if (door === 'dev' && !session.grayscales.has(test.identifier)) session.grayscale(test).then(draw).catch(() => {}); }
  else $('report').append(node('pre', JSON.stringify(examination, null, 2)));
  inspect(current).catch(error => { if (current === version) $('source').append(node('p', `Source rendering unavailable: ${error.message}`)); });
  if (door === 'dev') { $('analysis-status').textContent = examination.eligibility || (busy.has(examination.id) ? 'Calculating…' : ''); if (!examination.eligibility && !blocks.length && !busy.has(examination.id) && !attempted.has(examination.id)) compute(false); }
  const history = $('analysis-selection'), old = history.value;
  history.replaceChildren(...[['source-only','Source only'],['all','All calculation history'],...blocks.map(b => [b.id,b.id])].map(([value,label]) => { const option = node('option',label); option.value=value; return option; })); history.value = [...history.options].some(o => o.value === old) ? old : 'all';
}
async function compute(force, batch = false) {
  const examination = batch ? null : selected, key = examination?.id || 'batch', generation = session.generation;
  if (busy.has(key)) return; busy.add(key); if (examination) attempted.add(examination.id); if (!batch) render();
  try { const result = await session.compute(examination, force); if (generation === session.generation) { const outcomes = Array.isArray(result) ? result : result.outcomes || []; const counts = outcomes.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] || 0) + 1 }), {}); status(Object.entries(counts).map(([kind,count]) => `${count} ${kind}`).join(' · ') || 'No examinations selected for analysis.'); $('calculation-outcomes').replaceChildren(...outcomes.map(item => node('li', `${session.snapshot.examinations.filter(e => e.id === item.id).map(e => `${e.subject} · ${e.date} · ${e.eye}`).join('') || item.id} · ${item.status}${item.reason ? ' · ' + item.reason : ''}${item.analysisId ? ' · ' + item.analysisId : ''}`))); } }
  catch (error) { if (error.name !== 'AbortError') status(error.message); }
  finally { busy.delete(key); if (generation === session.generation) { if (force) $('block').value = ''; update(examination?.id); } }
}
async function importFiles(files) {
  if (importing) return; importing = true; $('upload').disabled = $('examples').disabled = true;
  const generation = session.generation;
  try { for (const file of files) { if (generation !== session.generation) break; retryFiles.set(file.name,file); status(`Importing ${file.name}…`); try { await session.importFile(file, file.importContext || { subject: $('subject').value.trim() }); } catch (error) { if (error.name === 'AbortError') break; status(error.message); } if (generation === session.generation) update(); } if (generation === session.generation) status(`${session.snapshot.sources.length} sources · ${session.snapshot.examinations.length} examinations. Review the extraction outcomes below.`); }
  finally { if (generation === session.generation) { importing = false; $('upload').disabled = $('examples').disabled = false; $('upload').value = ''; } }
}
function exportUrl() { const params = new URLSearchParams({ format: $('output-format').value, analysis: $('analysis-selection').value }); if ($('output-scope').value === 'selected' && selected) params.set('examinationIds',selected.id); return '/api/export?' + params; }
$('upload').onchange = guard(() => importFiles([...$('upload').files]));
$('examples').onclick = guard(async () => {
  const response = await fetch('/examples/manifest.json'); if (!response.ok) throw new Error('Examples manifest unavailable.');
  const manifest = await response.json(); const files = [];
  for (const entry of manifest.files || manifest) { const path = typeof entry === 'string' ? entry : entry.path; const response = await fetch(path); if (!response.ok) throw new Error(`Example unavailable: ${path}`); const file = new File([await response.blob()], path.split('/').at(-1)); file.importContext = typeof entry === 'object' && entry.context ? entry.context : (/\.pdf$/i.test(path) ? { subject: 'synthetic-reviewer-a' } : {}); files.push(file); }
  await importFiles(files);
});
for (const id of ['eye','pattern']) $(id).onchange = () => update();
$('examination').onchange = () => update($('examination').value);
$('zeiss').onclick = () => { door = 'view'; render(); }; $('dev').onclick = () => { door = 'dev'; render(); };
$('block').onchange = render; $('recompute').onclick = () => compute(true); $('analyze-all').onclick = () => compute(false,true);
$('source-toggle').onclick = () => { $('source').hidden = !$('source').hidden; $('source-toggle').setAttribute('aria-expanded',String(!$('source').hidden)); render(); };
$('reset').onclick = guard(async () => { await session.reset(); importing = false; busy.clear(); attempted.clear(); retryFiles.clear(); $('upload').disabled = $('examples').disabled = false; door = 'view'; $('preview').textContent = ''; $('calculation-outcomes').replaceChildren(); update(); status('Session reset. In-flight work was cancelled.'); });
$('export').onclick = () => { const link = node('a',''); link.href = exportUrl(); link.download = ''; link.click(); };
$('preview-output').onclick = guard(async () => { const response = await fetch(exportUrl()); const text = await response.text(); $('preview').textContent = text.length > 80000 ? text.slice(0,80000) + '\n[Preview truncated; download contains the full output.]' : text; });
$('query-run').onclick = guard(async () => { const result = await session.request('/graphql', { query: $('query').value }); $('query-result').textContent = JSON.stringify(result,null,2); });
$('query-example').onchange = () => { $('query').value = $('query-example').value; };
session.ready().then(() => { update(); status('Local service ready. Import files or load the synthetic demonstration.'); }).catch(error => status(`Startup failed: ${error.message}. Reload to retry after starting npm start.`));
