/** Small deterministic PRNG (mulberry32) with the sampling helpers the simulator needs. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Pick an index proportionally to `weights`. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let x = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i]!;
      if (x < 0) return i;
    }
    return weights.length - 1;
  }

  /** `n` distinct items (or all of them if there are fewer). */
  sample<T>(items: readonly T[], n: number): T[] {
    const copy = items.slice();
    const k = Math.min(n, copy.length);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(this.next() * (copy.length - i));
      const tmp = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = tmp;
    }
    return copy.slice(0, k);
  }

  /** Standard normal via Box–Muller. */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  logNormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  hex(len: number): string {
    let out = '';
    while (out.length < len)
      out += Math.floor(this.next() * 0x100000000)
        .toString(16)
        .padStart(8, '0');
    return out.slice(0, len);
  }
}
