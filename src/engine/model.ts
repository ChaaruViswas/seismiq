/**
 * L2-regularised logistic regression fitted with Newton's method (IRLS).
 *
 * With a dozen features the Hessian is tiny, so Newton converges in a handful
 * of iterations where gradient descent would need thousands — and the result
 * is deterministic. A linear model is also the right call for the product:
 * every prediction decomposes exactly into per-feature contributions, which is
 * what the UI shows as "why this test".
 */
import { sigmoid } from './stats';

export interface LogisticModel {
  /** Weights in standardised feature space. */
  weights: number[];
  bias: number;
  mean: number[];
  scale: number[];
  iterations: number;
  rows: number;
  positives: number;
}

/** Solve `A x = b` in place by Gaussian elimination with partial pivoting. `A` is row-major `n×n`. */
export function solveLinear(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row * n + col]!) > Math.abs(A[pivot * n + col]!)) pivot = row;
    }
    if (Math.abs(A[pivot * n + col]!) < 1e-12) A[pivot * n + col] = 1e-12;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const tmp = A[col * n + k]!;
        A[col * n + k] = A[pivot * n + k]!;
        A[pivot * n + k] = tmp;
      }
      const tmp = b[col]!;
      b[col] = b[pivot]!;
      b[pivot] = tmp;
    }
    for (let row = col + 1; row < n; row++) {
      const factor = A[row * n + col]! / A[col * n + col]!;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) A[row * n + k]! -= factor * A[col * n + k]!;
      b[row]! -= factor * b[col]!;
    }
  }
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let acc = b[row]!;
    for (let k = row + 1; k < n; k++) acc -= A[row * n + k]! * x[k]!;
    x[row] = acc / A[row * n + row]!;
  }
  return x;
}

/**
 * Fit the model. `X` is row-major `rows × nFeat`; `weight` lets a subsampled
 * majority class count for the rows it stands in for, which keeps predicted
 * probabilities calibrated. Returns null when a class is missing.
 */
export function trainLogistic(
  X: Float32Array,
  y: Uint8Array,
  weight: Float32Array | null,
  nFeat: number,
  l2 = 1,
): LogisticModel | null {
  const rows = y.length;
  let positives = 0;
  for (let i = 0; i < rows; i++) positives += y[i]!;
  if (positives === 0 || positives === rows) return null;

  const w = (i: number) => (weight ? weight[i]! : 1);
  let totalW = 0;
  for (let i = 0; i < rows; i++) totalW += w(i);

  const mean = new Array<number>(nFeat).fill(0);
  const scale = new Array<number>(nFeat).fill(0);
  for (let i = 0; i < rows; i++) for (let j = 0; j < nFeat; j++) mean[j]! += w(i) * X[i * nFeat + j]!;
  for (let j = 0; j < nFeat; j++) mean[j]! /= totalW;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < nFeat; j++) scale[j]! += w(i) * (X[i * nFeat + j]! - mean[j]!) ** 2;
  }
  for (let j = 0; j < nFeat; j++) scale[j] = Math.sqrt(scale[j]! / totalW) || 1;

  const Z = new Float64Array(rows * nFeat);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < nFeat; j++) Z[i * nFeat + j] = (X[i * nFeat + j]! - mean[j]!) / scale[j]!;
  }

  const d = nFeat + 1; // bias is the last coefficient
  let beta = new Float64Array(d);
  beta[nFeat] = Math.log(positives / (rows - positives));

  const loss = (b: Float64Array): number => {
    let total = 0;
    for (let i = 0; i < rows; i++) {
      let z = b[nFeat]!;
      for (let j = 0; j < nFeat; j++) z += b[j]! * Z[i * nFeat + j]!;
      // log(1 + e^z) - y z, computed stably
      total += w(i) * (Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z))) - y[i]! * z);
    }
    for (let j = 0; j < nFeat; j++) total += 0.5 * l2 * b[j]! * b[j]!;
    return total;
  };

  let current = loss(beta);
  let iterations = 0;
  for (; iterations < 40; iterations++) {
    const g = new Float64Array(d);
    const H = new Float64Array(d * d);
    for (let i = 0; i < rows; i++) {
      let z = beta[nFeat]!;
      for (let j = 0; j < nFeat; j++) z += beta[j]! * Z[i * nFeat + j]!;
      const p = sigmoid(z);
      const r = w(i) * (p - y[i]!);
      const s = w(i) * Math.max(p * (1 - p), 1e-9);
      for (let j = 0; j < d; j++) {
        const xj = j < nFeat ? Z[i * nFeat + j]! : 1;
        g[j]! += r * xj;
        for (let k = j; k < d; k++) H[j * d + k]! += s * xj * (k < nFeat ? Z[i * nFeat + k]! : 1);
      }
    }
    for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) H[j * d + k] = H[k * d + j]!;
    for (let j = 0; j < nFeat; j++) {
      g[j]! += l2 * beta[j]!;
      H[j * d + j]! += l2;
    }
    const step = solveLinear(H, g, d);

    // Damped Newton: halve the step until the loss actually goes down.
    let t = 1;
    let next = beta;
    let nextLoss = current;
    for (let tries = 0; tries < 12; tries++) {
      const candidate = new Float64Array(d);
      for (let j = 0; j < d; j++) candidate[j] = beta[j]! - t * step[j]!;
      const candidateLoss = loss(candidate);
      if (Number.isFinite(candidateLoss) && candidateLoss <= current) {
        next = candidate;
        nextLoss = candidateLoss;
        break;
      }
      t /= 2;
    }
    const improved = current - nextLoss;
    beta = next;
    current = nextLoss;
    if (improved < 1e-9 * Math.max(1, Math.abs(current))) {
      iterations++;
      break;
    }
  }

  return {
    weights: Array.from(beta.subarray(0, nFeat)),
    bias: beta[nFeat]!,
    mean,
    scale,
    iterations,
    rows,
    positives,
  };
}

/** Predicted probability for the feature row starting at `offset`. */
export function predict(model: LogisticModel, X: ArrayLike<number>, offset = 0): number {
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    z += (model.weights[j]! * (X[offset + j]! - model.mean[j]!)) / model.scale[j]!;
  }
  return sigmoid(z);
}

/**
 * Exact additive explanation of one prediction in log-odds: how much each
 * feature moved this row away from the average row.
 */
export function contributions(model: LogisticModel, X: ArrayLike<number>, offset = 0): number[] {
  return model.weights.map((wj, j) => (wj * (X[offset + j]! - model.mean[j]!)) / model.scale[j]!);
}

/**
 * Rule-based score used when there is not enough history to train a model
 * (for example a freshly imported project with no failures yet).
 */
export function heuristicScore(X: ArrayLike<number>, offset = 0): number {
  const target = X[offset]!;
  const coverage = X[offset + 1]!;
  const proximity = X[offset + 2]!;
  const cofail = X[offset + 5]!;
  const failRate = X[offset + 6]!;
  const score =
    0.03 * target + 0.015 * coverage + 0.01 * proximity + 0.05 * Math.min(1, cofail * 3) + 0.2 * failRate;
  return Math.min(0.99, score);
}
