import { describe, expect, it } from 'vitest';
import { detectSlowdowns, planShards } from '../src/engine/durations';
import { RepoIndex } from '../src/engine/repo';
import { Rng } from '../src/engine/rng';
import { CART, SEARCH, T_CART, tinyDataset } from './fixtures';

describe('detectSlowdowns', () => {
  const rng = new Rng(11);
  const noisy = (ms: number) => ms * Math.exp(0.08 * rng.normal());
  const specs = Array.from({ length: 80 }, (_, r) => ({
    commits: [r === 50 ? [CART] : [SEARCH]],
    // cart test doubles at run 50; checkout drifts randomly; search is stable; smoke has one outlier.
    durations: [noisy(r >= 50 ? 420 : 200), noisy(300), noisy(150), r === 30 ? 9000 : noisy(2000)],
  }));
  const ds = tinyDataset(specs);
  const found = detectSlowdowns(ds, new RepoIndex(ds), new Uint8Array(ds.runs.length));

  it('finds the step change, its run and the commit that caused it', () => {
    expect(found).toHaveLength(1);
    expect(found[0]!.test).toBe(T_CART);
    expect(Math.abs(found[0]!.run - 50)).toBeLessThanOrEqual(1);
    expect(found[0]!.ratio).toBeGreaterThan(1.8);
    expect(found[0]!.ratio).toBeLessThan(2.4);
    expect(found[0]!.suspects).toEqual(ds.runs[found[0]!.run]!.commits);
  });
  it('ignores noise, single outliers and short histories', () => {
    expect(found.some((d) => d.test !== T_CART)).toBe(false);
    const short = tinyDataset(specs.slice(40, 60));
    expect(detectSlowdowns(short, new RepoIndex(short), new Uint8Array(20))).toEqual([]);
  });
});

describe('planShards', () => {
  const items = [
    { key: 'a', ms: 90, tests: 1 },
    { key: 'b', ms: 80, tests: 1 },
    { key: 'c', ms: 30, tests: 1 },
    { key: 'd', ms: 30, tests: 1 },
    { key: 'e', ms: 20, tests: 1 },
    { key: 'f', ms: 10, tests: 1 },
  ];
  it('balances by duration with the LPT rule', () => {
    const plan = planShards(items, 2, 'balanced');
    expect(plan.shards.map((s) => s.ms)).toEqual([130, 130]);
    expect(plan.makespanMs).toBe(130);
    expect(plan.idealMs).toBe(130);
  });
  it('shows how count-based splitting goes wrong', () => {
    const plan = planShards(items, 2, 'alphabetical');
    expect(plan.shards.map((s) => s.items.map((i) => i.key).join(''))).toEqual(['abc', 'def']);
    expect(plan.makespanMs).toBe(200);
  });
  it('keeps every item exactly once and never beats the lower bound', () => {
    const rng = new Rng(3);
    const many = Array.from({ length: 57 }, (_, i) => ({
      key: `f${i}`,
      ms: rng.logNormal(1000, 1),
      tests: 1,
    }));
    for (const k of [1, 3, 8, 100]) {
      for (const strategy of ['balanced', 'alphabetical'] as const) {
        const plan = planShards(many, k, strategy);
        expect(plan.shards).toHaveLength(k);
        expect(plan.shards.flatMap((s) => s.items.map((i) => i.key)).sort()).toEqual(
          many.map((i) => i.key).sort(),
        );
        expect(plan.makespanMs).toBeGreaterThanOrEqual(plan.idealMs - 1e-6);
      }
      const balanced = planShards(many, k, 'balanced');
      expect(balanced.makespanMs).toBeLessThanOrEqual((4 / 3) * balanced.idealMs + 1e-6);
    }
  });
  it('tolerates an empty suite and nonsensical shard counts', () => {
    expect(planShards([], 4, 'balanced').makespanMs).toBe(0);
    expect(planShards(items, 0, 'balanced').shards).toHaveLength(1);
  });
});
