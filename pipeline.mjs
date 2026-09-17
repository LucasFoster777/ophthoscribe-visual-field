import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Pipeline } from './js/pipeline/core.mjs';
import { exportSession, exportCSV, exportFHIR } from './js/pipeline/outputs.mjs';

const args = process.argv.slice(2), files = [], options = { format: 'json', analysis: 'source-only' }, context = {};
let output, calculate = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help') { console.log('npm run pipeline -- [--subject synthetic-id] [--calculate] [--analysis source-only|all|block-id] [--format json|csv|fhir] [--out path] [--examination id] [--source id] files…'); process.exit(0); }
  if (arg === '--calculate') { calculate = true; continue; }
  if (arg.startsWith('--')) {
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--subject') context.subject = value;
    else if (arg === '--format') options.format = value;
    else if (arg === '--analysis') options.analysis = value;
    else if (arg === '--out') output = value;
    else if (arg === '--examination') (options.examinationIds ||= []).push(value);
    else if (arg === '--source') (options.sourceIds ||= []).push(value);
    else throw new Error(`Unknown option ${arg}`);
  } else files.push(arg);
}
if (!files.length) throw new Error('Supply input files; use --help for usage.');
if (!['json', 'csv', 'fhir'].includes(options.format)) throw new Error('Format must be json, csv, or fhir.');
const pipeline = new Pipeline();
try {
  for (const file of files) {
    let outcome;
    try { outcome = await pipeline.importFile({ bytes: new Uint8Array(await readFile(file)), name: basename(file), context }); }
    catch (error) { outcome = { name: basename(file), status: 'rejected', reason: error.message }; }
    console.error(JSON.stringify(outcome));
    if (!['accepted', 'duplicate'].includes(outcome.status)) process.exitCode = 1;
  }
  if (calculate) console.error(JSON.stringify({ analysis: await pipeline.analyze() }));
  const snapshot = pipeline.snapshot({ portable: true });
  if (options.format === 'csv') {
    if (!output) throw new Error('CSV package requires --out directory.');
    await mkdir(resolve(output), { recursive: true });
    for (const [name, content] of Object.entries(exportCSV(snapshot, options))) await writeFile(resolve(output, name), content, { flag: 'wx' });
  } else {
    const text = options.format === 'fhir' ? JSON.stringify(exportFHIR(snapshot, options), null, 2) : exportSession(snapshot, options);
    if (output) await writeFile(resolve(output), text, { flag: 'wx' }); else console.log(text);
  }
} finally { pipeline.reset(); }
