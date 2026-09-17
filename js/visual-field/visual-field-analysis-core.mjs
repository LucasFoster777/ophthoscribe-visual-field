// [Active] Qualified 52-point conventional/Bayesian development model for the lazy worker.
import { api as matrix } from './visual-field-matrix.mjs';
import { api as loader } from './visual-field-normative.mjs';
// The normative surface is an argument (P4 Task 1): `analyze(input, dataset)` takes the dataset DOCUMENT and builds
// the surface once per document (WeakMap); the worker receives the document inside its message.
var surfaces = typeof WeakMap === 'function' ? new WeakMap() : null;
function surfaceOf(dataset) {
  if (!dataset || typeof dataset !== 'object') throw new Error('Analysis dataset is required.');
  var cached = surfaces && surfaces.get(dataset); if (cached) return cached;
  var built = loader.fromDataset(dataset); if (surfaces) surfaces.set(dataset, built);
  return built;
}
// 2.0.0 (Lucas ruling 2026-08-16): conventional layer runs on the calibrated normative table —
// MD weighted by 1/sdTd², PSD by 1/sdPd², TD/PD probability from per-location empirical cutoffs,
// VFI (Bengtsson & Heijl 2008) computed. Only the 54 thresholds, eye, age and reliability come in.
var MODEL = Object.freeze({ id: 'ophthoscribe-vf-24-2', version: '2.0.0' });
var SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function sigmoid(value) { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }
function logit(value) { value = Math.max(1e-7, Math.min(1 - 1e-7, value)); return Math.log(value / (1 - value)); }
function erf(value) {
  var sign = value < 0 ? -1 : 1, x = Math.abs(value), t = 1 / (1 + 0.3275911 * x);
  var polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}
function normalCdf(value) { return 0.5 * (1 + erf(value / Math.SQRT2)); }
function normalPdf(value) { return Math.exp(-0.5 * value * value) / SQRT_TWO_PI; }
function logSumExp(a, b) { var high = Math.max(a, b); return high + Math.log(Math.exp(a - high) + Math.exp(b - high)); }
// Probability category from the location's empirical cutoffs (deviation at/below the cutoff).
function category(value, cutoffs) {
  if (value === null || !cutoffs) return 'not-read';
  if (value <= cutoffs.p0_5) return 'p<0.5%';
  if (value <= cutoffs.p1) return 'p<1%';
  if (value <= cutoffs.p5) return 'p<5%';
  return 'normal';
}
// Visual Field Index (Bengtsson & Heijl 2008): each analysed point scores 100·(1 − |TD|/expected);
// points within normal limits score 100 (PD map when MD > −20 dB, TD map otherwise); weighted mean
// with the eccentricity-band weights 3.29 / 1.28 / 0.79 / 0.57 / 0.45 (<6°, 6–12, 12–18, 18–24, 24–30).
function vfiWeight(eccentricity) {
  return eccentricity < 6 ? 3.29 : eccentricity < 12 ? 1.28 : eccentricity < 18 ? 0.79 : eccentricity < 24 ? 0.57 : 0.45;
}
function visualFieldIndex(active, md) {
  var usePd = md > -20, numerator = 0, denominator = 0;
  active.forEach(function (row) {
    var normal = (usePd ? row.pdCategory : row.tdCategory) === 'normal', weight = vfiWeight(row.eccentricity);
    var score = normal ? 100 : Math.max(0, Math.min(100, 100 * (1 - Math.abs(row.td) / row.mean)));
    numerator += weight * score; denominator += weight;
  });
  return denominator > 0 ? numerator / denominator : null;
}
function percentile(values, fraction) {
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}
function weighted(values, weights) {
  var numerator = 0, denominator = 0;
  values.forEach(function (value, index) { numerator += value * weights[index]; denominator += weights[index]; });
  return numerator / denominator;
}
function inputRows(input, normative) {
  if (!input || !Array.isArray(input.thresholds) || input.thresholds.length !== 54) throw new Error('Analysis requires 54 threshold readings.');
  var rows = normative.forEye(input.eye, input.ageYears);
  var active = [];
  rows.forEach(function (row, index) {
    var reading = input.thresholds[index];
    if (!reading || !['read', 'not-read'].includes(reading.state)) throw new Error('Threshold reading state is invalid.');
    if (reading.state === 'not-read') { row.value = null; return; }
    if (!Number.isFinite(reading.value) || reading.value < -1 || reading.value > 60) throw new Error('Threshold value is invalid.');
    row.value = reading.value; row.censored = reading.value <= 0 || reading.censored === true;
    if (!row.blind) active.push(row);
  });
  var unread = rows.filter(function (row) { return !row.blind && row.value === null; }).length;
  if (unread > 2) throw new Error('Analysis allows no more than two unread threshold points.');
  if (![input.fp, input.fn, input.fl].every(Number.isFinite)) throw new Error('FP, FN, and FL are required.');
  return { rows: rows, active: active };
}
function conventional(rows, active) {
  active.forEach(function (row) { row.td = row.value - row.mean; });
  var generalHeight = percentile(active.map(function (row) { return row.td; }), 0.85);
  active.forEach(function (row) {
    row.pd = row.td - generalHeight;
    row.tdCategory = category(row.td, row.tdCutoffs); row.pdCategory = category(row.pd, row.pdCutoffs);
  });
  var md = weighted(active.map(function (row) { return row.td; }), active.map(function (row) { return 1 / (row.sd * row.sd); }));
  var psd = Math.sqrt(weighted(active.map(function (row) { return row.pd * row.pd; }), active.map(function (row) { return 1 / (row.sdPd * row.sdPd); })));
  function expand(key) { return rows.map(function (row) { return row.blind || row.value === null ? null : row[key]; }); }
  function categories(key) { return rows.map(function (row) { return row.blind || row.value === null ? 'not-read' : row[key]; }); }
  return { modelId: MODEL.id, modelVersion: MODEL.version, md: md, psd: psd, vfi: visualFieldIndex(active, md),
    values: expand('td'), patternValues: expand('pd'),
    probabilities: categories('tdCategory'), patternProbabilities: categories('pdCategory'),
    diagnostics: { generalHeight: generalHeight, analyzedPoints: active.length } };
}
function artifactScores(active, fp) {
  var superior = active.filter(function (row) { return row.y >= 21; });
  var peripheral = active.filter(function (row) { return row.eccentricity > 25; });
  var lidFraction = superior.length ? superior.filter(function (row) { return row.mean - row.value > 5; }).length / superior.length : 0;
  var rimFraction = peripheral.length ? peripheral.filter(function (row) { return row.mean - row.value > 5; }).length / peripheral.length : 0;
  var elevated = active.filter(function (row) { return row.value > row.mean + row.sd; }).length / active.length;
  active.forEach(function (row) {
    var lid = row.y >= 21 ? sigmoid((row.mean - row.value) - 5) * lidFraction : 0;
    var rim = row.eccentricity > 25 ? sigmoid((row.mean - row.value) - 5) * rimFraction : 0;
    row.artifact = Math.min(0.85, 1 - (1 - Math.min(1, lid)) * (1 - Math.min(1, rim)));
  });
  return { lid: lidFraction, rim: rimFraction, triggerHappy: fp >= 0.15 && elevated > 0.3, elevated: elevated };
}
function pairs(active) {
  var out = [];
  for (var i = 0; i < active.length; i += 1) for (var j = i + 1; j < active.length; j += 1) {
    var dx = active[i].xOd - active[j].xOd, dy = active[i].y - active[j].y;
    if (Math.sqrt(dx * dx + dy * dy) <= 8.5) out.push([i, j]);
  }
  return out;
}
function objective(active, reliability, neighborPairs) {
  var lower = 0, uppers = active.map(function (row) { return Math.min(40, row.mean + 5 * row.sd); });
  return function (psi) {
    var theta = [], derivative = [], value = 0, gradientTheta = Array(active.length).fill(0);
    psi.forEach(function (raw, index) {
      var s = sigmoid(raw), span = uppers[index] - lower;
      theta[index] = lower + span * s; derivative[index] = span * s * (1 - s);
      value += Math.log(Math.max(derivative[index], 1e-300));
    });
    active.forEach(function (row, index) {
      var base = 1.5 + 2 * row.eccentricity / 30;
      var upperSigma = base * (1 + 3 * reliability.fn);
      var triggerFactor = reliability.triggerHappy ? 1 + 2 * Math.max(0, reliability.fp - 0.15) : 1;
      var lowerSigma = base * (1 + 3 * reliability.fp) * triggerFactor;
      if (row.censored) {
        var z = (lower - theta[index]) / lowerSigma;
        var cdf = Math.max(normalCdf(z), 1e-300);
        value += Math.log(cdf); gradientTheta[index] -= normalPdf(z) / (lowerSigma * cdf);
      } else {
        var sigma = row.value >= theta[index] ? upperSigma : lowerSigma;
        value += Math.log(2 / (upperSigma + lowerSigma)) - Math.log(SQRT_TWO_PI) - 0.5 * Math.pow((row.value - theta[index]) / sigma, 2);
        gradientTheta[index] += (row.value - theta[index]) / (sigma * sigma);
      }
      var pathSd = 8, artifactSd = 2.5, a = row.artifact;
      var pathLog = Math.log(Math.max(1 - a, 1e-12)) - Math.log(pathSd * SQRT_TWO_PI) - 0.5 * Math.pow((theta[index] - row.mean) / pathSd, 2);
      var artifactLog = Math.log(Math.max(a, 1e-12)) - Math.log(artifactSd * SQRT_TWO_PI) - 0.5 * Math.pow((theta[index] - row.mean) / artifactSd, 2);
      var mixture = logSumExp(pathLog, artifactLog), artifactWeight = Math.exp(artifactLog - mixture);
      value += mixture;
      gradientTheta[index] += (1 - artifactWeight) * (row.mean - theta[index]) / (pathSd * pathSd) +
        artifactWeight * (row.mean - theta[index]) / (artifactSd * artifactSd);
    });
    neighborPairs.forEach(function (pair) {
      var delta = theta[pair[0]] - theta[pair[1]], strength = 0.02;
      value -= 0.5 * strength * delta * delta;
      gradientTheta[pair[0]] -= strength * delta; gradientTheta[pair[1]] += strength * delta;
    });
    var gradient = psi.map(function (raw, index) {
      return -(gradientTheta[index] * derivative[index] + 1 - 2 * sigmoid(raw));
    });
    return { value: -value, gradient: gradient, theta: theta, uppers: uppers };
  };
}
function covariance(active, reliability, neighborPairs) {
  var precision = Array.from({ length: active.length }, function () { return Array(active.length).fill(0); });
  active.forEach(function (row, index) {
    var base = 1.5 + 2 * row.eccentricity / 30;
    var sigma = row.censored ? base * (1 + 3 * reliability.fp) : base * (1 + 3 * Math.max(reliability.fp, reliability.fn));
    precision[index][index] = 1 / (sigma * sigma) + 1 / 64 + row.artifact / 6.25 + 1e-4;
  });
  neighborPairs.forEach(function (pair) {
    precision[pair[0]][pair[0]] += 0.02; precision[pair[1]][pair[1]] += 0.02;
    precision[pair[0]][pair[1]] -= 0.02; precision[pair[1]][pair[0]] -= 0.02;
  });
  var result = matrix.inverseSpd(precision);
  if (!result || !result.every(function (row) { return matrix.finite(row); })) throw new Error('Analysis Hessian/covariance is invalid.');
  return result;
}
function bayesian(rows, active, input, diagnostics) {
  var neighborPairs = pairs(active), reliability = { fp: input.fp, fn: input.fn, fl: input.fl, triggerHappy: diagnostics.triggerHappy };
  var evaluate = objective(active, reliability, neighborPairs);
  var initial = active.map(function (row) {
    var upper = Math.min(40, row.mean + 5 * row.sd), guess = row.censored ? 0.5 : Math.max(0.5, Math.min(upper - 0.5, row.value));
    return logit(guess / upper);
  });
  var optimized = input.forceOptimizerFailure ? { success: false, reason: 'forced-failure' } : matrix.lbfgs(initial, evaluate);
  if (!optimized.success) throw new Error('Analysis optimizer did not converge: ' + optimized.reason);
  var evaluated = evaluate(optimized.x), cov = covariance(active, reliability, neighborPairs);
  if (!matrix.finite(evaluated.theta)) throw new Error('Analysis output is non-finite.');
  var weights = active.map(function (row) { return 1 / (row.sd * row.sd); }), totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
  var normalized = weights.map(function (value) { return value / totalWeight; });
  var md = weighted(evaluated.theta.map(function (value, index) { return value - active[index].mean; }), weights);
  var variance = 0;
  for (var i = 0; i < cov.length; i += 1) for (var j = 0; j < cov.length; j += 1) variance += normalized[i] * cov[i][j] * normalized[j];
  if (!Number.isFinite(variance) || variance <= 0) throw new Error('Analysis MD covariance is invalid.');
  var values = Array(54).fill(null), probabilities = Array(54).fill(null);
  active.forEach(function (row, index) {
    var pointIndex = Number(row.id.slice(1)); values[pointIndex] = evaluated.theta[index];
    probabilities[pointIndex] = normalCdf((row.mean - 2 * row.sd - evaluated.theta[index]) / Math.sqrt(cov[index][index]));
  });
  return { modelId: MODEL.id, modelVersion: MODEL.version, posteriorMd: { mean: md, std: Math.sqrt(variance),
    probabilityBelow: { '0': normalCdf((0 - md) / Math.sqrt(variance)), '-5': normalCdf((-5 - md) / Math.sqrt(variance)), '-10': normalCdf((-10 - md) / Math.sqrt(variance)) } },
  values: values, probabilities: probabilities, diagnostics: { iterations: optimized.iterations, analyzedPoints: active.length } };
}
function analyze(input, dataset) {
  var normative = surfaceOf(dataset);
  var prepared = inputRows(input, normative), conventionalResult = conventional(prepared.rows, prepared.active);
  var diagnostics = artifactScores(prepared.active, input.fp);
  diagnostics.learningOffset = input.testOrdinalConfirmed && Number.isInteger(input.testOrdinal) && input.testOrdinal < 3
    ? (input.testOrdinal === 1 ? 2 : 1) : 0;
  if (!input.testOrdinalConfirmed) diagnostics.learningOffset = 0;
  var bayesianResult = bayesian(prepared.rows, prepared.active, input, diagnostics);
  return { eye: input.eye, conventional: conventionalResult, bayesian: bayesianResult,
    diagnostics: { automated: diagnostics, physicianArtifacts: [] }, provenance: Object.assign({}, MODEL, {
      normative: normative.PROVENANCE, datasetId: normative.id, datasetVersion: normative.version, censoredLikelihood: true, artifactMixture: 'explicit-two-component',
      blindPointIds: normative.BLIND[input.eye].map(function (index) { return 'p' + String(index).padStart(2, '0'); }),
      learningOffset: diagnostics.learningOffset
    }) };
}
var api = Object.freeze({ MODEL: MODEL, analyze: analyze, category: category, normalCdf: normalCdf });
export { api, api as 'module.exports' };
