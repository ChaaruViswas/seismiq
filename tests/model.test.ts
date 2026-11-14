import { describe, expect, it } from 'vitest';
import { contributions, predict, solveLinear, trainLogistic } from '../src/engine/model';
import { Rng } from '../src/engine/rng';
import { auc, sigmoid } from '../src/engine/stats';

describe('solveLinear', () => {
  it('solves a system that needs pivoting', () => {
    // 0x + 2y = 4 ; 3x + 1y = 5  →  x = 1, y = 2
    const x = solveLinear(Float64Array.from([0, 2, 3, 1]), Float64Array.from([4, 5]), 2);
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
  });
});

describe('trainLogistic', () => {
  const make = (n: number, seed: number) => {
    const rng = new Rng(seed);
    const X = new Float32Array(n * 3);
    const y = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = rng.normal();
      const noise = rng.normal();
      X.set([a, b, noise], i * 3);
      // true model: logit = -1 + 2a - 1.5b ; third feature is irrelevant
      y[i] = rng.chance(sigmoid(-1 + 2 * a - 1.5 * b)) ? 1 : 0;
    }
    return { X, y };
  };

  it('recovers the generating coefficients', () => {
    const { X, y } = make(20_000, 1);
    const m = trainLogistic(X, y, null, 3, 1e-6)!;
    // Features are ~N(0,1), so standardised weights are close to the raw ones.
    expect(m.weights[0]! / m.scale[0]!).toBeCloseTo(2, 0);
    expect(m.weights[1]! / m.scale[1]!).toBeCloseTo(-1.5, 0);
    expect(Math.abs(m.weights[2]!)).toBeLessThan(0.1);
    expect(m.iterations).toBeLessThan(15);
  });

  it('generalises to unseen data and is calibrated', () => {
    const train = make(8000, 2);
    const test = make(8000, 3);
    const m = trainLogistic(train.X, train.y, null, 3)!;
    const scores = Array.from({ length: 8000 }, (_, i) => predict(m, test.X, i * 3));
    expect(auc(scores, test.y)).toBeGreaterThan(0.85);
    const meanPredicted = scores.reduce((a, b) => a + b, 0) / scores.length;
    const meanObserved = test.y.reduce((a, b) => a + b, 0) / test.y.length;
    expect(Math.abs(meanPredicted - meanObserved)).toBeLessThan(0.02);
  });

  it('stays calibrated when negatives are subsampled and re-weighted', () => {
    const { X, y } = make(30_000, 4);
    const rng = new Rng(5);
    const keep: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < y.length; i++) {
      if (y[i] === 1) {
        keep.push(i);
        weights.push(1);
      } else if (rng.chance(0.2)) {
        keep.push(i);
        weights.push(5);
      }
    }
    const Xs = new Float32Array(keep.length * 3);
    keep.forEach((k, i) => {
      Xs.set(X.subarray(k * 3, k * 3 + 3), i * 3);
    });
    const m = trainLogistic(Xs, Uint8Array.from(keep.map((k) => y[k]!)), Float32Array.from(weights), 3)!;
    let predicted = 0;
    for (let i = 0; i < y.length; i++) predicted += predict(m, X, i * 3);
    const observed = y.reduce((a, b) => a + b, 0);
    expect(predicted / observed).toBeGreaterThan(0.93);
    expect(predicted / observed).toBeLessThan(1.07);
  });

  it('does not blow up on perfectly separable data', () => {
    const X = Float32Array.from([0, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 1]);
    const y = Uint8Array.from([0, 0, 0, 0, 1, 1, 1, 1]);
    const m = trainLogistic(X, y, null, 1)!;
    expect(Number.isFinite(m.weights[0])).toBe(true);
    expect(predict(m, [0.05])).toBeLessThan(0.5);
    expect(predict(m, [0.95])).toBeGreaterThan(0.5);
  });

  it('returns null when only one class is present', () => {
    expect(trainLogistic(Float32Array.from([1, 2, 3]), Uint8Array.from([0, 0, 0]), null, 1)).toBeNull();
    expect(trainLogistic(Float32Array.from([1, 2, 3]), Uint8Array.from([1, 1, 1]), null, 1)).toBeNull();
  });

  it('explains a prediction exactly: bias + contributions = log-odds', () => {
    const { X, y } = make(2000, 6);
    const m = trainLogistic(X, y, null, 3)!;
    const row = [0.4, -1.2, 0.3];
    const z = m.bias + contributions(m, row).reduce((a, b) => a + b, 0);
    expect(sigmoid(z)).toBeCloseTo(predict(m, row), 12);
  });
});
