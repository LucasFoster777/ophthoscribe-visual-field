import { Session } from './session.mjs';
import { renderReport, renderSource } from './display.mjs';

const session = new Session();
const $ = id => document.getElementById(id);
let entries = [], selected = null, door = 'view', blockIndex, importing = false;
let renderVersion = 0, disposeReport = () => {}, disposeSource = () => {};
const busy = new Set();
const status = text => { $('status').textContent = text; };
function importControls(value) {
  importing = value; $('examples').disabled = value; $('upload').disabled = value;
}
function updateEntries(preferred) {
  entries = session.reports.flatMap(report => report.graph.tests.map(test => ({ report, test })));
  entries.sort((a, b) => b.test.acquisition.testDate.localeCompare(a.test.acquisition.testDate) || a.test.measurement.eye.localeCompare(b.test.measurement.eye));
  $('workspace').hidden = !entries.length; $('export').disabled = !entries.length;
  const filtered = entries.filter(({ test }) => (!$('eye').value || test.measurement.eye === $('eye').value) && (!$('pattern').value || test.testDefinition.pattern === $('pattern').value));
  $('examination').replaceChildren(...filtered.map(({ test }) => {
    const option = document.createElement('option'); option.value = test.identifier;
    option.textContent = `${test.acquisition.testDate} · ${test.measurement.eye} · ${test.testDefinition.pattern}`; return option;
  }));
  const choice = filtered.find(({ test }) => test.identifier === preferred) || filtered[0];
  if (choice) $('examination').value = choice.test.identifier;
  select(choice || null);
}
function select(entry) {
  selected = entry; blockIndex = entry ? session.blocks(entry.test).length - 1 : undefined;
  render();
}
async function inspectSource(version) {
  disposeSource(); disposeSource = () => {};
  $('source').replaceChildren();
  if ($('source').hidden || !selected) return;
  const { test, report } = selected;
  const target = document.createElement('div'); $('source').append(target);
  try {
    const cleanup = await renderSource(target, { test, graph: report.graph, pdf: report.pdf });
    if (version !== renderVersion) { if (typeof cleanup === 'function') cleanup(); return; }
    disposeSource = typeof cleanup === 'function' ? cleanup : () => {};
  } catch (error) { if (version === renderVersion) target.textContent = 'Source page unavailable. Raw extraction remains in the JSON download.'; }
}
function drawReport(version, grayscale) {
  if (version !== renderVersion || !selected) return;
  disposeReport();
  disposeReport = renderReport($('report'), { test: session.projectedTest(selected.test), door, blockIndex, directories: session.directories, grayscale }) || (() => {});
}
async function render() {
  const version = ++renderVersion;
  disposeReport(); disposeReport = () => {}; $('report').replaceChildren();
  $('zeiss').setAttribute('aria-pressed', String(door === 'view')); $('dev').setAttribute('aria-pressed', String(door === 'dev'));
  $('dev-controls').hidden = door !== 'dev';
  $('analysis-status').textContent = '';
  if (!selected) { $('report').textContent = 'No examinations match these filters.'; disposeSource(); $('source').replaceChildren(); return; }
  const { test, report } = selected;
  $('original').href = report.url;
  const blocks = session.blocks(test);
  $('block').replaceChildren(...blocks.map((block, i) => {
    const option = document.createElement('option'); option.value = String(i); option.textContent = `${i + 1} · ${block.computedAt} · ${block.engineVersion}`; return option;
  }));
  if (blocks.length) { if (!(blockIndex >= 0 && blockIndex < blocks.length)) blockIndex = blocks.length - 1; $('block').value = String(blockIndex); }
  $('block').disabled = !blocks.length;
  const reason = session.eligibility(test);
  $('recompute').disabled = !!reason || busy.has(test.identifier);
  drawReport(version, session.grayscales.get(test.identifier));
  inspectSource(version);
  if (!session.grayscales.has(test.identifier)) session.grayscale(test).then(blob => drawReport(version, blob)).catch(error => {
    if (version === renderVersion && error.name !== 'AbortError') $('analysis-status').textContent = 'Grayscale unavailable; extracted values remain available.';
  });
  if (door === 'dev') {
    if (reason) $('analysis-status').textContent = reason;
    else if (busy.has(test.identifier)) $('analysis-status').textContent = 'Calculating analysis…';
    else if (!blocks.length) compute(false);
  }
}
async function compute(force) {
  if (!selected) return;
  const test = selected.test, generation = session.generation;
  if (busy.has(test.identifier)) return;
  busy.add(test.identifier); $('recompute').disabled = true; $('analysis-status').textContent = 'Calculating conventional and Bayesian analysis…';
  try {
    await session.compute(test, force);
    busy.delete(test.identifier);
    if (generation === session.generation && selected?.test === test) { blockIndex = session.blocks(test).length - 1; render(); }
  } catch (error) {
    busy.delete(test.identifier);
    if (generation === session.generation && selected?.test === test) {
      $('analysis-status').textContent = error.message + ' Extracted results remain available.';
      $('recompute').disabled = false;
    }
  }
}
async function importFiles(files) {
  if (importing) return;
  importControls(true); const generation = session.generation;
  let failures = 0;
  try {
    for (const file of files) {
      if (generation !== session.generation) return;
      try {
        await session.importPdf(file, text => { if (generation === session.generation) status(text); });
      } catch (error) {
        if (generation !== session.generation) return;
        failures++; status(error.message);
      }
    }
    if (generation !== session.generation) return;
    door = 'view'; updateEntries();
    if (!failures) status(`${entries.length} examinations extracted from ${session.reports.length} reports. Zeiss View is the default; Dev View calculates separately.`);
  } finally { if (generation === session.generation) { importControls(false); $('upload').value = ''; } }
}
$('examples').addEventListener('click', async () => {
  if (importing) return;
  const generation = session.generation; importControls(true); status('Loading local synthetic examples…');
  try {
    const files = await Promise.all(['hvf_7724798', 'hvf_7724801'].map(async name => {
      const response = await fetch(`tests/e2e/fixtures/visual-field/sources/zeiss_multi/${name}.pdf`);
      if (!response.ok) throw new Error('Synthetic example could not be loaded.');
      return new File([await response.blob()], name + '.pdf', { type: 'application/pdf' });
    }));
    if (generation !== session.generation) return;
    importControls(false); await importFiles(files);
  } catch (error) { if (generation === session.generation) { status(error.message); importControls(false); } }
});
$('upload').addEventListener('change', () => importFiles([...$('upload').files]));
for (const id of ['eye', 'pattern']) $(id).addEventListener('change', () => updateEntries(selected?.test.identifier));
$('examination').addEventListener('change', () => select(entries.find(e => e.test.identifier === $('examination').value)));
$('zeiss').addEventListener('click', () => { door = 'view'; render(); });
$('dev').addEventListener('click', () => { door = 'dev'; render(); });
$('block').addEventListener('change', () => { blockIndex = Number($('block').value); render(); });
$('recompute').addEventListener('click', () => compute(true));
$('source-toggle').addEventListener('click', () => {
  $('source').hidden = !$('source').hidden; $('source-toggle').setAttribute('aria-expanded', String(!$('source').hidden)); inspectSource(renderVersion);
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session.exportData(), null, 2)], { type: 'application/json' }));
  session.urls.add(url);
  const a = document.createElement('a'); a.href = url; a.download = 'visual-field-session.json'; a.click();
  setTimeout(() => { URL.revokeObjectURL(url); session.urls.delete(url); }, 1000);
});
$('reset').addEventListener('click', () => {
  renderVersion++; disposeReport(); disposeSource(); disposeReport = disposeSource = () => {};
  session.reset(); entries = []; selected = null; busy.clear(); door = 'view'; blockIndex = undefined;
  $('report').replaceChildren(); $('source').replaceChildren(); $('source').hidden = true;
  $('source-toggle').setAttribute('aria-expanded', 'false'); $('workspace').hidden = true; $('export').disabled = true;
  $('eye').value = ''; $('pattern').value = ''; $('examination').replaceChildren(); $('block').replaceChildren();
  $('original').removeAttribute('href'); $('upload').value = ''; importControls(false);
  status('Session cleared. Files, computed blocks, workers and object URLs released.');
});
