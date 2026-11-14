import { describe, expect, it } from 'vitest';
import { createHistory, updateHistory } from '../src/engine/history';
import { classifyPath, Reason, RepoIndex, selectTests, stem } from '../src/engine/repo';
import { CART, CHECKOUT, CORE, SEARCH, T_CART, T_CHECKOUT, T_SEARCH, T_SMOKE, tinyDataset } from './fixtures';

describe('classifyPath', () => {
  it.each([
    ['package.json', 'global'],
    ['packages/web/package-lock.json', 'global'],
    ['pnpm-lock.yaml', 'global'],
    ['tsconfig.build.json', 'global'],
    ['vite.config.ts', 'global'],
    ['.github/workflows/ci.yml', 'global'],
    ['Dockerfile', 'global'],
    ['go.mod', 'global'],
    ['README.md', 'docs'],
    ['docs/guide/setup.txt', 'docs'],
    ['assets/logo.svg', 'docs'],
    ['LICENSE', 'docs'],
    ['src/cart.ts', 'other'],
    ['src/package.json.ts', 'other'],
    ['config/app.yaml', 'other'],
  ])('%s → %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
});

describe('stem', () => {
  it('strips directories, extensions and test suffixes', () => {
    expect(stem('src/cart/total.test.ts')).toBe('total');
    expect(stem('src/cart/total.ts')).toBe('total');
    expect(stem('e2e/checkout.spec.tsx')).toBe('checkout');
    expect(stem('tests/test_orders.py')).toBe('orders');
  });
});

describe('RepoIndex', () => {
  const ds = tinyDataset([{ commits: [[CART]] }]);
  const index = new RepoIndex(ds);

  it('computes import-graph distance from each test', () => {
    expect(Array.from(index.dist[T_CHECKOUT]!)).toEqual([3, 2, 1, 0]); // core, cart, checkout, search
    expect(Array.from(index.dist[T_CART]!)).toEqual([2, 1, 0, 0]);
    expect(Array.from(index.dist[T_SEARCH]!)).toEqual([0, 0, 0, 1]);
  });
  it('finds transitive dependents', () => {
    expect(index.dependents(CORE).sort()).toEqual([CART, CHECKOUT]);
    expect(index.dependents(SEARCH)).toEqual([]);
  });
  it('builds change sets from commits and from raw paths', () => {
    const fromRun = index.changeSetOfRun(ds.runs[0]!);
    expect([...fromRun.files]).toEqual([[CART, 12]]);
    expect(fromRun.globalPath).toBeNull();
    const fromPaths = index.changeSetOfPaths([
      { path: 'src/cart.ts', lines: 5 },
      { path: 'src/search.test.ts', lines: 1 },
      { path: 'src/unknown.ts', lines: 1 },
      { path: 'README.md', lines: 1 },
    ]);
    expect([...fromPaths.files]).toEqual([[CART, 5]]);
    expect(fromPaths.testFiles).toEqual(['src/search.test.ts']);
    expect(fromPaths.otherPaths).toEqual(['src/unknown.ts', 'README.md']);
    expect(fromPaths.docsOnly).toBe(false);
    expect(index.changeSetOfPaths([{ path: 'README.md', lines: 1 }]).docsOnly).toBe(true);
  });
});

describe('selectTests', () => {
  const ds = tinyDataset([{ commits: [[CART]] }]);
  const index = new RepoIndex(ds);
  const select = (paths: string[], history = null as ReturnType<typeof createHistory> | null) =>
    Array.from(
      selectTests(index, index.changeSetOfPaths(paths.map((path) => ({ path, lines: 1 }))), history),
    );

  it('picks the strongest reason per test and skips unrelated tests', () => {
    // cart.ts: cart.test imports it; checkout.test and smoke cover it; search.test is unrelated.
    expect(select(['src/cart.ts'])).toEqual([Reason.Target, Reason.Coverage, Reason.None, Reason.Coverage]);
  });
  it('falls back to the import graph when coverage is missing', () => {
    // checkout.test reaches core only through the graph — its recorded coverage does not list core.
    expect(select(['src/core.ts'])).toEqual([Reason.Coverage, Reason.Static, Reason.None, Reason.Coverage]);
  });
  it('trusts coverage for links the import graph cannot see', () => {
    expect(select(['src/search.ts'])).toEqual([Reason.None, Reason.None, Reason.Target, Reason.Coverage]);
  });
  it('runs everything for a global change and nothing for documentation', () => {
    expect(select(['package-lock.json', 'src/search.ts'])).toEqual([1, 1, 1, 1]);
    expect(select(['README.md', 'docs/a.md'])).toEqual([0, 0, 0, 0]);
  });
  it('selects tests whose own file changed, and name-matches unknown paths', () => {
    expect(select(['src/search.test.ts'])).toEqual([
      Reason.None,
      Reason.None,
      Reason.TestChanged,
      Reason.None,
    ]);
    expect(select(['lib/legacy/checkout.js'])).toEqual([
      Reason.None,
      Reason.NameMatch,
      Reason.None,
      Reason.None,
    ]);
  });
  it('always re-runs a test that is failing on the base commit', () => {
    const failing = tinyDataset([{ commits: [[SEARCH]], results: 'PPFP' }]);
    const idx = new RepoIndex(failing);
    const history = createHistory(4, 4);
    updateHistory(history, idx, failing.runs[0]!, idx.changeSetOfRun(failing.runs[0]!), false);
    const docs = idx.changeSetOfPaths([{ path: 'README.md', lines: 1 }]);
    expect(Array.from(selectTests(idx, docs, history))).toEqual([0, 0, Reason.Failing, 0]);
  });
  it('learns couplings that static analysis cannot see', () => {
    // search.test newly fails whenever cart.ts changes, although nothing links them.
    const ds2 = tinyDataset([
      { commits: [[CART]], results: 'PPFP' },
      { commits: [[SEARCH]], results: 'PPPP' },
    ]);
    const idx = new RepoIndex(ds2);
    const history = createHistory(4, 4);
    for (const run of ds2.runs) updateHistory(history, idx, run, idx.changeSetOfRun(run), false);
    const change = idx.changeSetOfPaths([{ path: 'src/cart.ts', lines: 1 }]);
    expect(selectTests(idx, change, history)[T_SEARCH]).toBe(Reason.History);
    expect(selectTests(idx, change, null)[T_SEARCH]).toBe(Reason.None);
    expect(selectTests(idx, change, history)[T_SMOKE]).toBe(Reason.Coverage);
  });
  it('does not blame an unrelated file that merely shared a run with the real cause', () => {
    // cart.test breaks in a run that changed both cart.ts (linked) and search.ts (not linked).
    const ds3 = tinyDataset([{ commits: [[CART], [SEARCH]], results: 'FPPP' }, { commits: [[CART]] }]);
    const idx = new RepoIndex(ds3);
    const history = createHistory(4, 4);
    for (const run of ds3.runs) updateHistory(history, idx, run, idx.changeSetOfRun(run), false);
    expect(history.coFail.get(CART * 4 + T_CART)).toBe(1);
    expect(history.coFail.has(SEARCH * 4 + T_CART)).toBe(false);
    const change = idx.changeSetOfPaths([{ path: 'src/search.ts', lines: 1 }]);
    expect(selectTests(idx, change, history)[T_CART]).toBe(Reason.None);
  });
});
