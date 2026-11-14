/** Small, dependency-free statistics helpers. */

export function sum(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s;
}

export function mean(xs: ArrayLike<number>): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

/** Linear-interpolated quantile of an unsorted sample; 0 for an empty one. */
export function quantile(xs: ArrayLike<number>, q: number): number {
  if (xs.length === 0) return 0;
  const sorted = Array.from(xs).sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(xs: ArrayLike<number>): number {
  return quantile(xs, 0.5);
}

/**
 * Wilson score interval for a binomial proportion. Unlike the naive
 * `k/n ± z·se`, it stays inside [0, 1] and behaves for small `n`.
 */
export function wilson(k: number, n: number, z = 1.96): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * Area under the ROC curve via the rank-sum (Mann–Whitney) formulation, with
 * average ranks for ties. Returns NaN when one class is missing.
 */
export function auc(scores: ArrayLike<number>, labels: ArrayLike<number>): number {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[a]! - scores[b]!);
  let pos = 0;
  let rankSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1]!] === scores[order[i]!]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) {
      if (labels[order[k]!]) {
        pos++;
        rankSum += avgRank;
      }
    }
    i = j + 1;
  }
  const neg = n - pos;
  if (pos === 0 || neg === 0) return Number.NaN;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** ROC curve points (false-positive rate, true-positive rate), thinned to at most `maxPoints`. */
export function rocCurve(
  scores: ArrayLike<number>,
  labels: ArrayLike<number>,
  maxPoints = 60,
): { fpr: number; tpr: number }[] {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
  let pos = 0;
  for (let i = 0; i < n; i++) if (labels[i]) pos++;
  const neg = n - pos;
  if (pos === 0 || neg === 0) return [];
  const pts: { fpr: number; tpr: number }[] = [{ fpr: 0, tpr: 0 }];
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < n; i++) {
    if (labels[order[i]!]) tp++;
    else fp++;
    if (i + 1 < n && scores[order[i + 1]!] === scores[order[i]!]) continue;
    pts.push({ fpr: fp / neg, tpr: tp / pos });
  }
  if (pts.length <= maxPoints) return pts;
  const step = (pts.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => pts[Math.round(i * step)]!);
}

/**
 * Average Percentage of Faults Detected for an execution order.
 * `order` lists test ids in execution order; `failing` is the set that fails.
 * 1.0 means every failure surfaced immediately; ~0.5 is what a random order gets.
 */
export function apfd(order: ArrayLike<number>, failing: ReadonlySet<number>): number {
  const n = order.length;
  const m = failing.size;
  if (n === 0 || m === 0) return Number.NaN;
  let positions = 0;
  let found = 0;
  for (let i = 0; i < n; i++) {
    if (failing.has(order[i]!)) {
      positions += i + 1;
      found++;
    }
  }
  if (found < m) positions += (m - found) * (n + 1);
  return 1 - positions / (n * m) + 1 / (2 * n);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}
