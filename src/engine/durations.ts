/** Duration intelligence: change-point detection for slowdowns, and shard balancing. */
import type { RepoIndex } from './repo';
import type { DurationRegression, TestStats } from './results';
import { median } from './stats';
import { type Dataset, Status } from './types';

const MIN_SEGMENT = 10;

/**
 * Find tests whose duration stepped up and stayed up.
 *
 * For each test, every split of its (log) duration series into before/after is
 * scored with a two-sample t statistic; the best split wins. Working in log
 * space makes the test scale-free, so a 40 ms test and a 40 s test are judged
 * by the same ratio. Only passing attempts are used — retries would inflate times.
 */
export function detectSlowdowns(
  dataset: Dataset,
  index: RepoIndex,
  infra: Uint8Array,
  minRatio = 1.3,
  minT = 8,
): DurationRegression[] {
  const { runs, tests } = dataset;
  const found: DurationRegression[] = [];
  for (let t = 0; t < tests.length; t++) {
    const at: number[] = [];
    const logs: number[] = [];
    const raw: number[] = [];
    for (let r = 0; r < runs.length; r++) {
      if (infra[r] || runs[r]!.statuses[t] !== Status.Pass) continue;
      const d = runs[r]!.durations[t]!;
      if (d <= 0) continue;
      at.push(r);
      logs.push(Math.log(d));
      raw.push(d);
    }
    const n = logs.length;
    if (n < 2 * MIN_SEGMENT + 10) continue;

    const prefix = new Float64Array(n + 1);
    const prefixSq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      prefix[i + 1] = prefix[i]! + logs[i]!;
      prefixSq[i + 1] = prefixSq[i]! + logs[i]! * logs[i]!;
    }
    let bestK = -1;
    let bestT = 0;
    let bestDiff = 0;
    for (let k = MIN_SEGMENT; k <= n - MIN_SEGMENT; k++) {
      const m1 = prefix[k]! / k;
      const m2 = (prefix[n]! - prefix[k]!) / (n - k);
      const ss1 = prefixSq[k]! - k * m1 * m1;
      const ss2 = prefixSq[n]! - prefixSq[k]! - (n - k) * m2 * m2;
      const pooled = Math.max((ss1 + ss2) / (n - 2), 1e-6);
      const tStat = (m2 - m1) / Math.sqrt(pooled * (1 / k + 1 / (n - k)));
      if (tStat > bestT) {
        bestT = tStat;
        bestK = k;
        bestDiff = m2 - m1;
      }
    }
    if (bestK < 0 || bestT < minT || Math.exp(bestDiff) < minRatio) continue;

    const run = at[bestK]!;
    const beforeMs = median(raw.slice(0, bestK));
    const afterMs = median(raw.slice(bestK));
    const suspects = runs[run]!.commits.filter((ci) =>
      dataset.commits[ci]!.changes.some((c) => index.dist[t]![c.file]! > 0 || index.cov[t]![c.file] === 1),
    );
    found.push({ test: t, run, beforeMs, afterMs, ratio: afterMs / beforeMs, suspects });
  }
  return found.sort((a, b) => b.afterMs - b.beforeMs - (a.afterMs - a.beforeMs));
}

export interface ShardItem {
  key: string;
  ms: number;
  tests: number;
}

export interface ShardPlan {
  shards: { items: ShardItem[]; ms: number }[];
  /** Duration of the slowest shard — what the pipeline actually waits for. */
  makespanMs: number;
  /** Lower bound: total work divided evenly (or the single largest item). */
  idealMs: number;
}

/** One item per test file, weighted by the median duration of its tests. */
export function shardItems(dataset: Dataset, stats: readonly TestStats[]): ShardItem[] {
  const byFile = new Map<string, ShardItem>();
  for (const t of dataset.tests) {
    const s = stats[t.id]!;
    if (s.executed === 0 || s.state === 'skipped') continue;
    const item = byFile.get(t.file);
    if (item) {
      item.ms += s.p50Ms;
      item.tests++;
    } else byFile.set(t.file, { key: t.file, ms: s.p50Ms, tests: 1 });
  }
  return [...byFile.values()];
}

/**
 * Split test files across `k` parallel shards.
 *
 * - `balanced`: longest-processing-time-first greedy — sort by duration, always
 *   give the next file to the lightest shard. Guaranteed within 4/3 of optimal.
 * - `alphabetical`: equal-sized slices of the sorted file list, which is what
 *   count-based splitting does and why one shard usually ends up with all the e2e tests.
 */
export function planShards(
  items: readonly ShardItem[],
  k: number,
  strategy: 'balanced' | 'alphabetical',
): ShardPlan {
  const count = Math.max(1, Math.floor(k));
  const shards: { items: ShardItem[]; ms: number }[] = Array.from({ length: count }, () => ({
    items: [],
    ms: 0,
  }));
  if (strategy === 'balanced') {
    const sorted = items.slice().sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
    for (const item of sorted) {
      let lightest = shards[0]!;
      for (const s of shards) if (s.ms < lightest.ms) lightest = s;
      lightest.items.push(item);
      lightest.ms += item.ms;
    }
  } else {
    const sorted = items.slice().sort((a, b) => a.key.localeCompare(b.key));
    sorted.forEach((item, i) => {
      const s = shards[Math.min(count - 1, Math.floor((i * count) / sorted.length))]!;
      s.items.push(item);
      s.ms += item.ms;
    });
  }
  const total = items.reduce((s, i) => s + i.ms, 0);
  const largest = items.reduce((m, i) => Math.max(m, i.ms), 0);
  return {
    shards,
    makespanMs: shards.reduce((m, s) => Math.max(m, s.ms), 0),
    idealMs: Math.max(total / count, largest),
  };
}
