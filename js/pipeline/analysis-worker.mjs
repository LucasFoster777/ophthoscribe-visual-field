import { parentPort, workerData } from 'node:worker_threads';
import { api as analysisCore } from '../visual-field/visual-field-analysis-core.mjs';
try {
  const result = analysisCore.analyze(workerData.input, workerData.dataset);
  const b = result.bayesian;
  const overlays = { bayesian: { modelId: b.modelId, modelVersion: b.modelVersion, posteriorMd: b.posteriorMd, values: b.values, probabilities: b.probabilities, diagnostics: b.diagnostics } };
  delete result.bayesian;
  parentPort.postMessage({ result, overlays });
} catch (error) { parentPort.postMessage({ error: error.message }); }
