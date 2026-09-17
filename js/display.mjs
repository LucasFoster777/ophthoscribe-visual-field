// Read-only adaptation of the source viewer: projections retain their original provenance.
import { api as doorApi } from './visual-field/visual-field-door.mjs';
import { api as reportDoors } from './visual-field/visual-field-report-doors.mjs';
import { api as sourceTable } from './visual-field/visual-field-source-table.mjs';
import { api as regionOverlay } from './visual-field/visual-field-region-overlay.mjs';

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function displayValue(eye, index, view) {
  const point = eye.points[index];
  if (view === 'td' || view === 'pd') {
    const key = view === 'td' ? 'totalDeviation' : 'patternDeviation';
    const values = eye.conventional?.[view === 'td' ? 'values' : 'patternValues'] || [];
    if (eye.mapStates?.[key]?.[index] === 'not-extracted') return '?';
    return values[index] == null ? '' : String(Math.round(values[index]));
  }
  if (point.threshold?.state !== 'read') return view === 'bayesian' ? '—' : point.absent ? '--' : 'Not read';
  if (point.threshold.censored) return '<0';
  return view === 'bayesian' ? Number(point.threshold.value).toFixed(1) : String(point.threshold.value);
}
function map(eye, view, fallbackLayout) {
  const grid = el('div', 'vf-map' + (view === 'bayesian' ? ' vf-map-bayesian' : ''));
  const layout = eye.layout || fallbackLayout;
  grid.setAttribute('aria-label', {threshold:'Extracted thresholds', td:'Total deviation', pd:'Pattern deviation', bayesian:'Calculated Bayesian posterior'}[view]);
  grid.style.gridTemplateColumns = `repeat(${layout.columns}, 24px)`;
  grid.style.gridTemplateRows = `repeat(${layout.rows}, 24px)`;
  eye.points.forEach((point, index) => {
    const cell = el('span', 'vf-point', displayValue(eye, index, view));
    cell.dataset.pointId = point.id;
    const origin = view === 'threshold' ? 'printed' : view === 'bayesian' ? 'computed' : reportDoors.originOf(eye, index, view);
    reportDoors.ink(cell, origin);
    cell.title = `${point.id} · ${origin === 'computed' ? 'calculated' : 'extracted'} · ${cell.textContent || 'no numeric value in this layer'}`;
    reportDoors.markTier(cell, eye, index, view);
    cell.style.gridColumn = String(layout.columnOf[index]);
    cell.style.gridRow = String(layout.rowOf[index]);
    grid.append(cell);
  });
  return grid;
}
function printedText(eye, key) {
  const metric = eye.device[key];
  if (!metric || metric.state !== 'read') return 'Not read';
  if (key === 'fl') return `${metric.numerator}/${metric.denominator}`;
  return String(metric.value) + (['vfi','fp','fn'].includes(key) ? '%' : '');
}
function summary(parent, eye) {
  const strip = el('div', 'vf-summary');
  for (const [key, label] of Object.entries({md:'MD',psd:'PSD',vfi:'VFI',fp:'FP',fn:'FN',fl:'FL'})) {
    const calculated = ['md','psd','vfi'].includes(key);
    const origin = calculated ? reportDoors.originOf(eye, key) : 'printed';
    const value = eye.conventional[key];
    const text = calculated ? (!Number.isFinite(value) ? eye.absence : key === 'vfi' ? Math.round(value)+'%' : (key === 'md' && value > 0 ? '+' : '')+value.toFixed(1)+' dB') : printedText(eye,key);
    const item = el('span', 'vf-summary-item');
    item.append(el('strong','',label),reportDoors.ink(el('span','',text),origin));
    if (calculated && eye.door === 'dev' && origin === 'computed') item.append(el('small','vf-summary-secondary','device '+printedText(eye,key)));
    if (!calculated) item.append(el('small','vf-summary-secondary','device reliability'));
    strip.append(item);
  }
  parent.append(strip);
  if (eye.ght) parent.append(el('p','vf-device-ght','Device GHT · '+eye.ght));
}
export function renderReport(host, {test, door = 'view', blockIndex, directories, grayscale}) {
  host.replaceChildren();
  const eye = doorApi.eyeReportFrom(test, door, {blockIndex});
  const section = el('section','vf-demo-report');
  section.dataset.door = door;
  section.append(el('h2','',`${door === 'dev' ? 'Dev View' : 'Zeiss View'} · ${eye.eye} · ${test.acquisition.testDate} · ${test.testDefinition.pattern}`));
  section.append(el('p','vf-view-origin',door === 'dev' ? 'Calculated analysis over extracted thresholds. Device results remain separate.' : 'Device results extracted from the original report. Missing values remain missing.'));
  if (door === 'dev') section.append(el('p','vf-engine',eye.hasComputed ? `Engine ${eye.engine} · Dataset ${eye.dataset} · ${eye.block.computedAt}` : 'No calculated analysis for this examination.'));
  summary(section,eye);
  let objectUrl;
  const hooks = {el, map:(report,view)=>map(report,view,eye.layout), grayscale:(target)=>{
    if (door === 'dev' && grayscale) {
      objectUrl = URL.createObjectURL(grayscale);
      const img = el('img','vf-grayscale'); img.src=objectUrl; img.alt='Calculated grayscale from extracted thresholds';
      target.append(img,el('small','vf-summary-secondary','Calculated from thresholds'));
    } else target.append(el('p','vf-map-source-note',door === 'view' ? 'Original grayscale is available in the PDF.' : 'Calculated grayscale unavailable.'));
  }};
  section.append(reportDoors.eyeMaps({door, package:{record:test}}, eye, hooks));
  section.append(reportDoors.recordAttributes(test,el),reportDoors.provenanceLegend(eye,el));
  host.append(section);
  return ()=>{if(objectUrl) URL.revokeObjectURL(objectUrl);};
}

export async function renderSource(host,{test,graph,pdf}) {
  host.replaceChildren();
  const extraction = test.extraction || {};
  const protocol = extraction.protocol || {};
  host.append(el('h2','','Source inspection'),el('p','',`Protocol ${protocol.id || 'unknown'}@${protocol.version || 'unknown'} · page ${extraction.page || '?'} · block ${extraction.index ?? '?'}`));
  const body=el('div','vf-demo-source'), data=el('div','vf-source-data'), pages=el('div','vf-source-pages');
  sourceTable.renderRecord(data,test,false);
  const details=el('details','vf-extraction-details');
  details.open=true; details.append(el('summary','',`Extraction points (${(extraction.points || []).length}) · raw strings, parsed values and absence states`));
  const scroll=el('div','vf-point-table-scroll'), table=el('table','vf-point-table');
  const head=el('tr'); for(const label of ['Field / home','Raw string','Parsed value','Status','Page / rectangle']) head.append(el('th','',label)); table.append(head);
  for(const point of extraction.points || []) {
    const row=el('tr');
    for(const value of [point.id+'\n'+(point.home || ''),point.raw ?? '',JSON.stringify(point.value ?? null),point.status || '',`${point.page || ''} · ${JSON.stringify(point.rect || null)}`]) row.append(el('td','',value));
    table.append(row);
  }
  scroll.append(table); details.append(scroll); data.append(details);body.append(data,pages);host.append(body);
  if(!pdf) {pages.append(el('p','','Original PDF unavailable.')); return;}
  const pageNumber=Number(extraction.page)||1;
  const page=await pdf.getPage(pageNumber);
  const viewport=page.getViewport({scale:1.1});
  const wrapper=el('div','vf-region-page'), canvas=el('canvas');
  canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  canvas.setAttribute('aria-label',`Original PDF page ${pageNumber} with extraction regions`);
  wrapper.append(canvas); pages.append(el('h3','',`Original PDF · page ${pageNumber}`),wrapper);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const size=page.getViewport({scale:1}); const sizes=[]; sizes[pageNumber-1]={width:size.width,height:size.height};
  for(const box of regionOverlay.boxes(test,sizes).filter(box=>box.page===pageNumber)) {
    const node=el('div','vf-region'); node.dataset.fieldId=box.fieldId;node.title=box.fieldId+' · '+box.rawText;
    Object.assign(node.style,{left:box.left+'%',top:box.top+'%',width:box.width+'%',height:box.height+'%'});wrapper.append(node);
  }
  pages.append(el('p','vf-map-source-note','Hover over a region to inspect its field and raw string. Coordinates come from this extraction.'));
}
