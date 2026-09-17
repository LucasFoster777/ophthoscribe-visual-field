// [Active] Pinned dependency-free matrix/L-BFGS implementation used only by the analysis worker.
function dot(a, b) { var out = 0; for (var i = 0; i < a.length; i += 1) out += a[i] * b[i]; return out; }
function norm(a) { return Math.sqrt(dot(a, a)); }
function finite(values) { return values.every(Number.isFinite); }
function cholesky(matrix) {
  var n = matrix.length, lower = Array.from({ length: n }, function () { return Array(n).fill(0); });
  for (var row = 0; row < n; row += 1) {
    for (var col = 0; col <= row; col += 1) {
      var sum = matrix[row][col];
      for (var k = 0; k < col; k += 1) sum -= lower[row][k] * lower[col][k];
      if (row === col) {
        if (!Number.isFinite(sum) || sum <= 1e-12) return null;
        lower[row][col] = Math.sqrt(sum);
      } else lower[row][col] = sum / lower[col][col];
    }
  }
  return lower;
}
function solveLower(lower, value) {
  var out = Array(value.length).fill(0);
  for (var i = 0; i < value.length; i += 1) {
    var sum = value[i]; for (var j = 0; j < i; j += 1) sum -= lower[i][j] * out[j];
    out[i] = sum / lower[i][i];
  }
  return out;
}
function solveUpperFromLower(lower, value) {
  var out = Array(value.length).fill(0);
  for (var i = value.length - 1; i >= 0; i -= 1) {
    var sum = value[i]; for (var j = i + 1; j < value.length; j += 1) sum -= lower[j][i] * out[j];
    out[i] = sum / lower[i][i];
  }
  return out;
}
function inverseSpd(matrix) {
  var lower = cholesky(matrix); if (!lower) return null;
  var n = matrix.length, inverse = Array.from({ length: n }, function () { return Array(n).fill(0); });
  for (var col = 0; col < n; col += 1) {
    var basis = Array(n).fill(0); basis[col] = 1;
    var solution = solveUpperFromLower(lower, solveLower(lower, basis));
    for (var row = 0; row < n; row += 1) inverse[row][col] = solution[row];
  }
  return inverse;
}
function lineSearch(x, current, direction, slope, evaluate) {
  var step = 1;
  while (step >= 1e-8) {
    var nextX = x.map(function (value, i) { return value + step * direction[i]; });
    var tested = evaluate(nextX);
    if (Number.isFinite(tested.value) && finite(tested.gradient) &&
        tested.value <= current.value + 1e-4 * step * slope) return { x: nextX, result: tested };
    step *= 0.5;
  }
  return null;
}
function lbfgs(initial, evaluate, options) {
  options = options || {};
  var maxIterations = options.maxIterations || 90, memory = options.memory || 7;
  var tolerance = options.tolerance || 1e-4, x = initial.slice(), current = evaluate(x);
  var sHistory = [], yHistory = [], rhoHistory = [];
  if (!Number.isFinite(current.value) || !finite(current.gradient)) return { success: false, reason: 'non-finite-initial' };
  for (var iteration = 0; iteration < maxIterations; iteration += 1) {
    if (norm(current.gradient) <= tolerance * Math.max(1, norm(x))) {
      return { success: true, value: current.value, x: x, gradient: current.gradient, iterations: iteration };
    }
    var q = current.gradient.slice(), alpha = [];
    for (var h = sHistory.length - 1; h >= 0; h -= 1) {
      alpha[h] = rhoHistory[h] * dot(sHistory[h], q);
      q = q.map(function (value, i) { return value - alpha[h] * yHistory[h][i]; });
    }
    var scale = 1;
    if (sHistory.length) {
      var last = sHistory.length - 1;
      scale = dot(sHistory[last], yHistory[last]) / Math.max(dot(yHistory[last], yHistory[last]), 1e-12);
    }
    var direction = q.map(function (value) { return value * scale; });
    for (var f = 0; f < sHistory.length; f += 1) {
      var beta = rhoHistory[f] * dot(yHistory[f], direction);
      direction = direction.map(function (value, i) { return value + sHistory[f][i] * (alpha[f] - beta); });
    }
    direction = direction.map(function (value) { return -value; });
    var slope = dot(current.gradient, direction);
    if (!Number.isFinite(slope) || slope >= 0) { direction = current.gradient.map(function (value) { return -value; }); slope = -dot(current.gradient, current.gradient); }
    var candidate = lineSearch(x, current, direction, slope, evaluate);
    if (!candidate) {
      if (norm(current.gradient) <= 5 * tolerance * Math.max(1, norm(x))) {
        return { success: true, value: current.value, x: x, gradient: current.gradient, iterations: iteration };
      }
      return { success: false, reason: 'line-search-failed', iterations: iteration };
    }
    var s = candidate.x.map(function (value, i) { return value - x[i]; });
    var y = candidate.result.gradient.map(function (value, i) { return value - current.gradient[i]; });
    var curvature = dot(s, y);
    if (curvature > 1e-10) {
      sHistory.push(s); yHistory.push(y); rhoHistory.push(1 / curvature);
      if (sHistory.length > memory) { sHistory.shift(); yHistory.shift(); rhoHistory.shift(); }
    }
    x = candidate.x; current = candidate.result;
  }
  return { success: false, reason: 'iteration-limit', iterations: maxIterations };
}
var api = Object.freeze({ dot: dot, finite: finite, cholesky: cholesky, inverseSpd: inverseSpd, lbfgs: lbfgs });
export { api, api as 'module.exports' };
