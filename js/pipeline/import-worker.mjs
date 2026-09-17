import { parentPort, workerData } from 'node:worker_threads';
import { environment } from './environment.mjs';
import { parseInput } from './adapters.mjs';
try {
  const result = await parseInput({ ...workerData, ...await environment(), check: () => {} });
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message, code: error.code }); }
