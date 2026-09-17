import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadDirectories } from '../../js/data/visual-field/directories.mjs';
import { createModel } from '../../js/data/visual-field/model.mjs';
import { register } from '../../js/visual-field/visual-field-provider.mjs';
import { parseInput, parseCsv } from '../../js/pipeline/adapters.mjs';
const directories = await loadDirectories({ readFile: p => fs.readFile(new URL('../../'+p,import.meta.url),'utf8') });
register('directories', directories);
const model=createModel(directories);
const parse=(bytes,context={subject:'synthetic-A'})=>parseInput({bytes:Buffer.from(bytes),name:'input',directories,model,context});
const fixture=n=>fs.readFile(new URL('../../examples/'+n,import.meta.url));
test('all structured formats preserve precision, missingness and source origins',async()=>{
 const source=await parse(await fixture('source-bilateral.json')), matrix=await parse(await fixture('matrix-od.json')), csv=await parse(await fixture('thresholds.csv'));
 assert.equal(source.examinations.length,2);assert.equal(csv.examinations.length,2);
 assert.deepEqual(source.examinations[0].measurements.map(p=>p.value),matrix.examinations[0].measurements.map(p=>p.value));
 assert.deepEqual(csv.examinations[0].measurements.map(p=>p.value),matrix.examinations[0].measurements.map(p=>p.value));
 assert.equal(source.examinations[0].analyses[0].origin,'source-supplied');assert.equal(source.examinations[0].graphTest.analyses[0].origin,'source-supplied');
 assert.equal(matrix.examinations[0].measurements[0].value,28.125);assert.equal(matrix.examinations[0].measurements[9].value,null);assert.equal(matrix.examinations[0].measurements[10].censored,true);
});
test('CSV quoting and numeric validation; mixed success preserves valid examination',async()=>{
 assert.deepEqual(parseCsv('a,b\n"x,y","double ""quote"""\n'),[['a','b'],['x,y','double "quote"']]);
 assert.throws(()=>parseCsv('a\n"unclosed'),/Unterminated/);
 const csv=(await fixture('thresholds.csv')).toString().replace('28.125','28junk');const result=await parse(csv);
 assert.equal(result.examinations.length,1);assert.equal(result.outcomes.length,1);assert.match(result.outcomes[0].message,/invalid number/);
});
test('explicit identity and orientation required; unsupported schemas reject',async()=>{
 await assert.rejects(()=>fixture('source-bilateral.json').then(b=>parse(b,{})),/missing-required-context/);
 const matrix=JSON.parse(await fixture('matrix-od.json'));delete matrix.orientation;await assert.rejects(()=>parse(JSON.stringify(matrix)),/orientation/);
 await assert.rejects(()=>parse('{"schema":"td-only"}'),/Unsupported/);
});
test('OS visual-field coordinates mirror exactly once and retain source locations',async()=>{
 const matrix=JSON.parse(await fixture('matrix-od.json'));matrix.context.eye='OS';matrix.orientation='visual-field';matrix.matrix=matrix.matrix.map(row=>row.toReversed());
 const result=await parse(JSON.stringify(matrix));const p=result.examinations[0].measurements[0];
 assert.equal(p.x,9);assert.equal(p.sourceLocation.column,3);assert.equal(p.normalization.length,1);
});
test('legacy migration retains computed history and marks provenance unknown without mutating document',async()=>{
 const imported=await parse(await fixture('source-bilateral.json'),{subject:'patients/synthetic-A'});
 const graph=structuredClone(imported.graphs[0]);
 graph.tests.forEach(t=>t.measurement.points.forEach(p=>{if(p.threshold.value!=null)p.threshold.value=Math.round(p.threshold.value);}));
 const doc={extractedGraphs:[graph],computedAnalyses:[{testIdentifier:graph.tests[0].identifier,blocks:[{...graph.tests[0].analyses[0],origin:'computed'}]}]};
 const text=JSON.stringify(doc), result=await parse(text,{});
 assert.equal(JSON.stringify(result.document),text);
 assert.equal(result.examinations[0].analyses[0].origin,'source-supplied');
 assert.equal(result.examinations[0].analyses[1].origin,'computed');
 assert.equal(result.examinations[0].analyses[1].provenance.established,false);
 assert.equal(result.examinations[0].measurements[0].sourceLocation.kind,'json');
});
test('session validation rejects a competing graphTest store and coordinate tampering',async()=>{
 const imported=await parse(await fixture('matrix-od.json'));
 const exam={...imported.examinations[0],id:'exam-one',sourceId:'source-one'};
 const session={schema:'ophthoscribe-vf-session',version:1,sources:[{id:'source-one',format:'matrix-json'}],examinations:[exam]};
 assert.equal((await parse(JSON.stringify(session))).session.examinations.length,1);
 exam.graphTest.measurement.points[0].threshold.value=42;
 await assert.rejects(()=>parse(JSON.stringify(session)),/graphTest threshold/);
 exam.graphTest.measurement.points[0].threshold.value=exam.measurements[0].value;
 exam.measurements[0].x=-100;
 await assert.rejects(()=>parse(JSON.stringify(session)),/coordinates/);
});
test('session cannot spoof device origin; missing originals demote without changing imported document',async()=>{
 const imported=await parse(await fixture('source-bilateral.json'));
 const exam={...imported.examinations[0],id:'exam-device',sourceId:'source-device'};
 exam.analyses.forEach((b,i)=>{b.id='analysis-'+i;b.origin='device-reported';});
 const session={schema:'ophthoscribe-vf-session',version:1,sources:[{id:'source-device',format:'zeiss-pdf',subject:'synthetic-A'}],examinations:[exam]};
 const input=JSON.stringify(session), result=await parse(input);
 assert.equal(result.session.examinations[0].analyses[0].origin,'source-supplied');
 assert.equal(result.session.examinations[0].analyses[0].provenance.established,false);
 assert.equal(JSON.stringify(result.document),input);assert.equal(result.warnings.length,1);
 session.sources[0].originalBase64=Buffer.from('fake PDF').toString('base64');session.sources[0].sha256='invalid';
 await assert.rejects(()=>parse(JSON.stringify(session)),/digest mismatch/);
});
test('session rejects reversed calculation threshold order',async()=>{
 const imported=await parse(await fixture('matrix-od.json')),exam={...imported.examinations[0],id:'exam',sourceId:'source'};
 exam.graphTest.measurement.points.reverse();
 await assert.rejects(()=>parse(JSON.stringify({schema:'ophthoscribe-vf-session',version:1,sources:[{id:'source'}],examinations:[exam]})),/point order/);
});
test('portable PDF replay re-extracts and authenticates device values',async()=>{
 const {api:protocols}=await import('../../js/visual-field/visual-field-protocols.mjs');
 await protocols.load({directories,readFile:p=>fs.readFile(new URL('../../'+p,import.meta.url),'utf8')});
 const bytes=await fs.readFile(new URL('../e2e/fixtures/visual-field/sources/zeiss_multi/hvf_7724801.pdf',import.meta.url));
 const imported=await parse(bytes);
 assert.equal(imported.examinations.length,25);assert.ok(imported.examinations.every(e=>e.eye==='OS'));
 assert.ok(imported.examinations[0].measurements[0].sourceLocation.points.length);
 const {createHash}=await import('node:crypto');
 const source={id:'source-pdf',name:'synthetic.pdf',subject:'synthetic-A',format:'zeiss-pdf',sha256:createHash('sha256').update(bytes).digest('hex'),originalBase64:bytes.toString('base64')};
 const examinations=imported.examinations.map((e,i)=>({...e,id:'exam-'+i,sourceId:source.id,analyses:e.analyses.map((b,j)=>({...b,id:`analysis-${i}-${j}`}))}));
 const session={schema:'ophthoscribe-vf-session',version:1,sources:[source],examinations};
 const replay=await parse(JSON.stringify(session));assert.equal(replay.session.examinations[0].analyses[0].origin,'device-reported');
 examinations[0].measurements[0].value+=1;examinations[0].graphTest.measurement.points[0].threshold.value+=1;
 await assert.rejects(()=>parse(JSON.stringify(session)),/disagrees with original PDF/);
});
