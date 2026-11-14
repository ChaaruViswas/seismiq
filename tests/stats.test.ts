import { describe, expect, it } from 'vitest';
import { apfd, auc, median, quantile, rocCurve, wilson } from '../src/engine/stats';

describe('quantile', () => {
  it('interpolates between order statistics', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48);
  });
  it('is 0 for an empty sample and clamps q', () => {
    expect(median([])).toBe(0);
    expect(quantile([1, 2, 3], 2)).toBe(3);
  });
});

describe('wilson', () => {
  it('matches a known interval (8 of 100, 95%)', () => {
    const { lower, upper } = wilson(8, 100);
    expect(lower).toBeCloseTo(0.0411, 3);
    expect(upper).toBeCloseTo(0.15, 2);
  });
  it('stays inside [0, 1] at the extremes', () => {
    expect(wilson(0, 20).lower).toBe(0);
    expect(wilson(0, 20).upper).toBeGreaterThan(0);
    expect(wilson(20, 20).upper).toBe(1);
    expect(wilson(0, 0)).toEqual({ lower: 0, upper: 1 });
  });
});

describe('auc', () => {
  it('is 1 for a perfect ranking, 0 for a reversed one, 0.5 for constant scores', () => {
    expect(auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
  });
  it('counts tied pairs as half', () => {
    // positives: 0.8, 0.5 — negatives: 0.5, 0.1 → pairs: 3 wins + 1 tie of 4
    expect(auc([0.8, 0.5, 0.5, 0.1], [1, 1, 0, 0])).toBeCloseTo(0.875);
  });
  it('is NaN when a class is missing', () => {
    expect(auc([0.1, 0.9], [0, 0])).toBeNaN();
  });
  it('agrees with the area under the ROC curve', () => {
    const scores = [0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.4, 0.3, 0.2, 0.1];
    const labels = [1, 1, 0, 1, 0, 1, 0, 0, 1, 0];
    const roc = rocCurve(scores, labels);
    let area = 0;
    for (let i = 1; i < roc.length; i++) {
      area += ((roc[i]!.fpr - roc[i - 1]!.fpr) * (roc[i]!.tpr + roc[i - 1]!.tpr)) / 2;
    }
    expect(area).toBeCloseTo(auc(scores, labels), 10);
    expect(roc[0]).toEqual({ fpr: 0, tpr: 0 });
    expect(roc[roc.length - 1]).toEqual({ fpr: 1, tpr: 1 });
  });
});

describe('apfd', () => {
  it('rewards finding failures early', () => {
    const failing = new Set([7]);
    const early = apfd([7, 1, 2, 3, 4, 5, 6, 8, 9, 10], failing);
    const late = apfd([1, 2, 3, 4, 5, 6, 8, 9, 10, 7], failing);
    expect(early).toBeCloseTo(0.95);
    expect(late).toBeCloseTo(0.05);
  });
  it('matches the textbook formula for several faults', () => {
    // n = 5, faults first revealed at positions 1 and 3 → 1 - 4/10 + 1/10
    expect(apfd([10, 11, 12, 13, 14], new Set([10, 12]))).toBeCloseTo(0.7);
  });
  it('is NaN when nothing fails', () => {
    expect(apfd([1, 2, 3], new Set())).toBeNaN();
  });
});
