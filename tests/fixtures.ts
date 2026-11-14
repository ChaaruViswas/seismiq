import {
  type Commit,
  type Dataset,
  type FailureRecord,
  Status,
  type StatusCode,
  type TestCase,
} from '../src/engine/types';

/**
 * A tiny hand-built repository:
 *
 *   core.ts ← cart.ts ← checkout.ts        search.ts (independent)
 *
 * cart.test   imports cart      (reaches core)
 * checkout.test imports checkout (reaches cart, core)
 * search.test imports search
 * smoke.e2e   imports checkout; recorded coverage also lists search (stale graph)
 */
export const FILES = ['src/core.ts', 'src/cart.ts', 'src/checkout.ts', 'src/search.ts'];
export const [CORE, CART, CHECKOUT, SEARCH] = [0, 1, 2, 3];
export const [T_CART, T_CHECKOUT, T_SEARCH, T_SMOKE] = [0, 1, 2, 3];

const test = (
  id: number,
  name: string,
  file: string,
  targets: number[],
  coverage: number[],
  kind: TestCase['kind'] = 'unit',
): TestCase => ({
  id,
  name,
  suite: file,
  file,
  module: 'shop',
  kind,
  owner: 'team',
  targets,
  coverage,
});

export interface RunSpec {
  /** Changed file ids per commit, or a non-source path. */
  commits: (number[] | string)[];
  /** Status per test, defaults to Pass. `F` = fail, `R` = passed on retry, `-` = not run, `S` = skip. */
  results?: string;
  messages?: Record<number, string>;
  durations?: number[];
}

const CODE: Record<string, StatusCode> = {
  P: Status.Pass,
  F: Status.Fail,
  R: Status.Flaky,
  '-': Status.NotRun,
  S: Status.Skip,
};

export function tinyDataset(specs: RunSpec[]): Dataset {
  const tests = [
    test(T_CART, 'cart totals', 'src/cart.test.ts', [CART], [CART, CORE]),
    test(T_CHECKOUT, 'checkout flow', 'src/checkout.test.ts', [CHECKOUT], [CHECKOUT, CART]),
    test(T_SEARCH, 'search ranks', 'src/search.test.ts', [SEARCH], [SEARCH]),
    test(T_SMOKE, 'smoke', 'e2e/smoke.spec.ts', [CHECKOUT], [CHECKOUT, CART, CORE, SEARCH], 'e2e'),
  ];
  const commits: Commit[] = [];
  const failures: FailureRecord[] = [];
  const runs = specs.map((spec, r) => {
    const commitIdxs = spec.commits.map((c, i) => {
      commits.push({
        sha: `${r.toString(16).padStart(4, '0')}${i}`.padEnd(40, '0'),
        author: 'dev',
        message: `commit ${r}.${i}`,
        timestamp: 1_700_000_000_000 + r * 3_600_000,
        changes: typeof c === 'string' ? [] : c.map((file) => ({ file, added: 10, deleted: 2 })),
        otherPaths: typeof c === 'string' ? [c] : [],
      });
      return commits.length - 1;
    });
    const results = (spec.results ?? 'PPPP').padEnd(tests.length, 'P');
    const statuses = Uint8Array.from(results, (ch) => CODE[ch]!);
    const durations = Float32Array.from(tests, (_, t) =>
      statuses[t] === Status.NotRun ? 0 : (spec.durations?.[t] ?? 100),
    );
    statuses.forEach((s, t) => {
      if (s === Status.Fail || s === Status.Flaky) {
        failures.push({
          run: r,
          test: t,
          message: spec.messages?.[t] ?? `AssertionError: expected ${t} to equal ${t + 1}`,
          failedAttempts: s === Status.Fail ? 3 : 1,
          final: s === Status.Fail,
        });
      }
    });
    return {
      id: r,
      number: r + 1,
      timestamp: 1_700_000_000_000 + r * 3_600_000,
      branch: 'main',
      commits: commitIdxs,
      statuses,
      durations,
      wallSec: 60,
    };
  });
  return {
    meta: { name: 'tiny', source: 'demo', description: '', createdAt: 0, parallelism: 1, overheadSec: 0 },
    files: FILES.map((path, id) => ({ id, path, module: 'shop', loc: 100 })),
    deps: [
      [CART, CORE],
      [CHECKOUT, CART],
    ],
    tests,
    commits,
    runs,
    failures,
  };
}
