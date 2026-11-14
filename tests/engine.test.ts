import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/analyze';
import { explainTest, impactOfChange, impactOfRun } from '../src/engine/impact';
import { predict } from '../src/engine/model';
import { quarantineCandidates, simulateQuarantine } from '../src/engine/quarantine';
import { Reason, RepoIndex } from '../src/engine/repo';
import { markdownReport } from '../src/engine/report';
import { simulate } from '../src/engine/simulator';
import { Status } from '../src/engine/types';
import { CART, CHECKOUT, CORE, SEARCH, T_CART, T_CHECKOUT, T_SEARCH, T_SMOKE, tinyDataset } from './fixtures';

const END = Date.UTC(2026, 10, 13, 12);

describe('simulator', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = simulate({ seed: 1, endTime: END, runs: 60 });
    const b = simulate({ seed: 1, endTime: END, runs: 60 });
    const c = simulate({ seed: 2, endTime: END, runs: 60 });
    expect(a.commits.map((x) => x.sha)).toEqual(b.commits.map((x) => x.sha));
    expect(a.runs.map((r) => Array.from(r.statuses))).toEqual(b.runs.map((r) => Array.from(r.statuses)));
    expect(a.commits[0]!.sha).not.toBe(c.commits[0]!.sha);
  });

  it('produces a structurally valid dataset', () => {
    const ds = simulate({ seed: 3, endTime: END });
    expect(ds.runs).toHaveLength(380);
    for (const [from, to] of ds.deps) {
      expect(to).toBeLessThan(from); // imports only point at earlier files, so the graph is acyclic
    }
    const seen = new Set<number>();
    let last = 0;
    for (const run of ds.runs) {
      expect(run.timestamp).toBeGreaterThanOrEqual(last);
      expect(run.timestamp).toBeLessThanOrEqual(END);
      last = run.timestamp;
      expect(run.statuses).toHaveLength(ds.tests.length);
      for (const c of run.commits) {
        expect(seen.has(c)).toBe(false); // every commit belongs to exactly one run
        seen.add(c);
      }
    }
    expect(seen.size).toBe(ds.commits.length);
    for (const f of ds.failures) {
      const status = ds.runs[f.run]!.statuses[f.test];
      expect(status).toBe(f.final ? Status.Fail : Status.Flaky);
    }
    const names = new Set(ds.tests.map((t) => `${t.suite}|${t.name}`));
    expect(names.size).toBe(ds.tests.length);
  });
});

describe('analysis of simulated history — scored against planted ground truth', () => {
  const seeds = [7, 17, 42, 2026];
  const results = seeds.map((seed) => {
    const ds = simulate({ seed, endTime: END });
    return { seed, ds, analysis: analyze(ds) };
  });

  it.each(results)('seed $seed: finds the planted flaky tests without false alarms', ({ analysis }) => {
    const e = analysis.evaluation!;
    expect(e.flaky.precision).toBeGreaterThanOrEqual(0.9);
    expect(e.flaky.recall).toBeGreaterThanOrEqual(0.8);
    expect(e.category.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it.each(results)('seed $seed: ranks the culprit commit first', ({ analysis }) => {
    const e = analysis.evaluation!;
    expect(e.culprit.incidents).toBeGreaterThan(10);
    expect(e.culprit.accuracy).toBeGreaterThanOrEqual(0.85);
    expect(e.culprit.ambiguousAccuracy).toBeGreaterThanOrEqual(0.8);
  });

  it.each(results)('seed $seed: selection skips a real share of the suite and stays safe', ({ analysis }) => {
    expect(analysis.evaluation!.selection.safety).toBeGreaterThanOrEqual(0.97);
    expect(analysis.savings!.savedShare).toBeGreaterThan(0.25);
    expect(analysis.savings!.safety).toBeGreaterThanOrEqual(0.97);
  });

  it.each(results)('seed $seed: detects slowdowns and infrastructure incidents', ({ analysis }) => {
    const e = analysis.evaluation!;
    expect(e.slowdowns.recall).toBeGreaterThanOrEqual(0.8);
    expect(e.slowdowns.falsePositives).toBeLessThanOrEqual(1);
    expect(e.infra.found).toBe(e.infra.planted);
    expect(e.infra.falsePositives).toBe(0);
  });

  it.each(results)('seed $seed: the model beats the default order on held-out runs', ({ analysis }) => {
    const m = analysis.model;
    expect(m.model).not.toBeNull();
    expect(m.auc!).toBeGreaterThan(0.85);
    expect(m.apfdModel!).toBeGreaterThan(m.apfdBaseline! + 0.25);
    expect(m.ttffModelSec!).toBeLessThan(m.ttffBaselineSec!);
    const at20 = m.recallAtBudget.find((b) => b.budget === 0.2)!;
    expect(at20.model).toBeGreaterThan(0.6);
    expect(at20.model).toBeGreaterThan(at20.baseline);
    for (let i = 1; i < m.recallAtBudget.length; i++) {
      expect(m.recallAtBudget[i]!.model).toBeGreaterThanOrEqual(m.recallAtBudget[i - 1]!.model);
    }
  });

  it('keeps run-level risk between 0 and 1 and higher for runs that broke something', () => {
    const { analysis } = results[0]!;
    const [from, to] = analysis.model.testRuns;
    const heldOut = analysis.runs.slice(from, to).filter((r) => !analysis.infraRuns.includes(r.run));
    for (const r of analysis.runs) {
      expect(r.risk).toBeGreaterThanOrEqual(0);
      expect(r.risk).toBeLessThanOrEqual(1);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const broke = heldOut.filter((r) => r.newFailures.length > 0).map((r) => r.risk);
    const clean = heldOut.filter((r) => r.newFailures.length === 0).map((r) => r.risk);
    expect(mean(broke)).toBeGreaterThan(mean(clean));
  });

  it('never uses the future: analysing a prefix of history gives the same decisions for that prefix', () => {
    const { ds, analysis } = results[0]!;
    const cut = 150;
    const prefix = {
      ...ds,
      runs: ds.runs.slice(0, cut),
      failures: ds.failures.filter((f) => f.run < cut),
      truth: undefined,
    };
    const partial = analyze(prefix);
    const T = ds.tests.length;
    const F = analysis.nFeatures;
    // Infrastructure verdicts for runs < cut depend only on those runs.
    expect(partial.infraRuns).toEqual(analysis.infraRuns.filter((r) => r < cut));
    expect(Array.from(partial.selection)).toEqual(Array.from(analysis.selection.subarray(0, cut * T)));
    expect(Array.from(partial.features)).toEqual(Array.from(analysis.features.subarray(0, cut * T * F)));
  });

  it('accounts for every run and every failure exactly once', () => {
    for (const { ds, analysis } of results) {
      const h = analysis.health;
      expect(h.green + h.flakyGreen + h.red).toBe(ds.runs.length);
      expect(h.redByCause.regression + h.redByCause.flaky + h.redByCause.infrastructure).toBe(h.red);
      expect(h.weeks.reduce((s, w) => s + w.runs, 0)).toBe(ds.runs.length);
      expect(analysis.clusters.reduce((s, c) => s + c.count, 0)).toBe(ds.failures.length);
      expect(Array.from(analysis.clusterOf).every((c) => c >= 0 && c < analysis.clusters.length)).toBe(true);
      expect(analysis.clusters.map((c) => c.id)).toEqual(analysis.clusters.map((_, i) => i));
      for (const s of analysis.tests) {
        expect(s.passes + s.fails + s.flakyPasses).toBe(s.executed);
        expect(s.flakeLower).toBeLessThanOrEqual(s.flakeRate + 1e-12);
        expect(s.flakeUpper).toBeGreaterThanOrEqual(s.flakeRate - 1e-12);
        expect(s.flakeScore).toBeGreaterThanOrEqual(0);
        expect(s.flakeScore).toBeLessThanOrEqual(100);
      }
      for (const i of analysis.incidents) {
        const total = i.culprits.reduce((s, c) => s + c.probability, 0);
        if (i.culprits.length > 0) expect(total).toBeCloseTo(1, 6);
        expect(i.culprits.map((c) => c.commit).sort()).toEqual([...analysis.runCommits[i.startRun]!].sort());
      }
    }
  });
});

describe('analysis of a hand-built history', () => {
  // Run 3 builds two commits; the cart one breaks cart.test and checkout.test for two runs.
  const specs = [
    { commits: [[SEARCH]] },
    { commits: [[CORE]] },
    { commits: [[SEARCH]], results: 'PPRP', messages: { [T_SEARCH]: 'Error: Test timed out in 5000ms.' } },
    {
      commits: [[SEARCH], [CART]],
      results: 'FFPP',
      messages: {
        [T_CART]: 'TypeError: total is undefined\n    at sum (src/cart.ts:12:3)',
        [T_CHECKOUT]: 'TypeError: total is undefined\n    at sum (src/cart.ts:12:3)',
      },
    },
    {
      commits: ['README.md'],
      results: 'FFPP',
      messages: {
        [T_CART]: 'TypeError: total is undefined\n    at sum (src/cart.ts:14:3)',
        [T_CHECKOUT]: 'TypeError: total is undefined\n    at sum (src/cart.ts:14:3)',
      },
    },
    { commits: [[CART]] },
    { commits: [[CHECKOUT]], results: 'PPPF' },
    { commits: [[SEARCH]] },
  ];
  const ds = tinyDataset(specs);
  const analysis = analyze(ds);
  const index = new RepoIndex(ds);

  it('groups the two broken tests into one incident and blames the right commit', () => {
    expect(analysis.incidents).toHaveLength(2);
    const incident = analysis.incidents[0]!;
    expect(incident).toMatchObject({ startRun: 3, endRun: 5, tests: [T_CART, T_CHECKOUT] });
    expect(incident.ttrMs).toBe(2 * 3_600_000);
    const [first, second] = incident.culprits;
    expect(ds.commits[first!.commit]!.changes[0]!.file).toBe(CART);
    expect(first!.probability).toBeGreaterThan(0.9);
    expect(second!.probability).toBeLessThan(0.1);
    expect(first!.evidence[0]).toMatch(/2 failing stack traces/);
    expect(incident.fixCommit).toBe(ds.runs[5]!.commits[0]);
    expect(incident.clusters).toHaveLength(1);
  });

  it('clusters the same failure across tests and runs despite different line numbers', () => {
    const cluster = analysis.clusters.find((c) => c.title.startsWith('TypeError'))!;
    expect(cluster).toMatchObject({
      count: 4,
      tests: [T_CART, T_CHECKOUT],
      runs: [3, 4],
      kind: 'regression',
    });
  });

  it('classifies runs by outcome and cause', () => {
    expect(analysis.runs.map((r) => r.outcome)).toEqual([
      'green',
      'green',
      'flaky',
      'red',
      'red',
      'green',
      'red',
      'green',
    ]);
    expect(analysis.runs.map((r) => r.cause)).toEqual([
      null,
      null,
      null,
      'regression',
      'regression',
      null,
      'regression',
      null,
    ]);
    expect(analysis.health).toMatchObject({
      green: 4,
      flakyGreen: 1,
      red: 3,
      incidents: 2,
      openIncidents: 0,
    });
    expect(analysis.health.passRate).toBe(5 / 8);
    expect(analysis.health.firstTryRate).toBe(4 / 8);
  });

  it('records why each test was selected, including already-failing tests on a docs-only change', () => {
    const T = ds.tests.length;
    const row = (r: number) => Array.from(analysis.selection.subarray(r * T, (r + 1) * T));
    expect(row(0)).toEqual([Reason.None, Reason.None, Reason.Target, Reason.Coverage]);
    expect(row(3)).toEqual([Reason.Target, Reason.Coverage, Reason.Target, Reason.Coverage]);
    expect(row(4)).toEqual([Reason.Failing, Reason.Failing, Reason.None, Reason.None]);
    expect(analysis.runs[3]!.newFailures).toEqual([T_CART, T_CHECKOUT]);
    expect(analysis.runs[3]!.escaped).toEqual([]);
  });

  it('computes the impact of a historical run and of a new change', () => {
    const past = impactOfRun(ds, index, analysis, 4);
    expect(past.tests.map((t) => t.test)).toEqual([T_CART, T_CHECKOUT]);
    expect(past.tests.every((t) => t.failingOnBase)).toBe(true);
    expect(past.total).toBe(4);
    expect(past.selectedMs).toBe(200);
    expect(past.fullMs).toBe(400);

    const next = impactOfChange(
      ds,
      index,
      analysis,
      index.changeSetOfPaths([{ path: 'src/search.ts', lines: 3 }]),
    );
    expect(next.tests.map((t) => t.test).sort()).toEqual([T_SEARCH, T_SMOKE]);
    expect(next.total).toBe(4);
    expect(next.risk).toBeGreaterThanOrEqual(0);
    const docs = impactOfChange(
      ds,
      index,
      analysis,
      index.changeSetOfPaths([{ path: 'README.md', lines: 1 }]),
    );
    expect(docs.tests).toEqual([]);
    expect(docs.risk).toBe(0);
  });

  it('renders a Markdown report', () => {
    const md = markdownReport(ds, analysis);
    expect(md).toContain('## Seismiq report — tiny');
    expect(md).toContain('| Runs that ended green | 63% |');
    expect(md).toContain('All tests passed on the first attempt.');
    expect(md).toContain('### Slowest tests');
  });
});

describe('impact and explanations on simulated history', () => {
  const ds = simulate({ seed: 7, endTime: END });
  const analysis = analyze(ds);
  const index = new RepoIndex(ds);

  it('replays a run with exactly the stored selection, ordered by risk', () => {
    const r = ds.runs.length - 5;
    const impact = impactOfRun(ds, index, analysis, r);
    expect(impact.tests).toHaveLength(analysis.runs[r]!.selected);
    expect(impact.selectedMs).toBeCloseTo(analysis.runs[r]!.selectedMs, 3);
    expect(impact.fullMs).toBeCloseTo(analysis.runs[r]!.testMs, 3);
    for (let i = 1; i < impact.tests.length; i++) {
      const a = impact.tests[i - 1]!;
      const b = impact.tests[i]!;
      expect(Number(a.failingOnBase) > Number(b.failingOnBase) || a.probability >= b.probability).toBe(true);
    }
  });

  it('explains a prediction with contributions that add up to the model output', () => {
    const r = ds.runs.length - 5;
    const impact = impactOfRun(ds, index, analysis, r);
    const subject = impact.tests.find((t) => !t.failingOnBase)!;
    const parts = explainTest(analysis, impact.features, subject.test);
    expect(parts).toHaveLength(analysis.nFeatures);
    const model = analysis.model.model!;
    const z = model.bias + parts.reduce((s, p) => s + p.contribution, 0);
    expect(1 / (1 + Math.exp(-z))).toBeCloseTo(
      predict(model, impact.features, subject.test * analysis.nFeatures),
      10,
    );
    expect(subject.probability).toBeCloseTo(1 / (1 + Math.exp(-z)), 5);
  });

  it('forces a full run for a lockfile change and ranks a risky file above a quiet one', () => {
    const full = impactOfChange(
      ds,
      index,
      analysis,
      index.changeSetOfPaths([{ path: 'package-lock.json', lines: 400 }]),
    );
    expect(full.tests).toHaveLength(full.total);
    expect(full.tests.every((t) => t.reason === Reason.Global || t.failingOnBase)).toBe(true);
    const core = impactOfChange(
      ds,
      index,
      analysis,
      index.changeSetOfPaths([{ path: 'src/core/logger.ts', lines: 40 }]),
    );
    const leaf = impactOfChange(
      ds,
      index,
      analysis,
      index.changeSetOfPaths([{ path: 'src/web/routes.tsx', lines: 40 }]),
    );
    expect(core.tests.length).toBeGreaterThan(leaf.tests.length);
    expect(core.selectedMs).toBeLessThanOrEqual(core.fullMs);
  });

  it('quarantine replay: more green runs, less retry time, and it reports what it would hide', () => {
    const none = simulateQuarantine(ds, analysis, new Set());
    expect(none.firstTryAfter).toBe(none.firstTryBefore);
    expect(none.firstTryBefore).toBeCloseTo(analysis.health.firstTryRate, 12);
    expect(none.passBefore).toBeCloseTo(analysis.health.passRate, 12);
    expect(none.blindIncidents).toEqual([]);

    const candidates = quarantineCandidates(analysis, 0);
    expect(candidates.length).toBeGreaterThan(5);
    expect(candidates.every((t) => analysis.tests[t]!.state === 'flaky')).toBe(true);
    const all = simulateQuarantine(ds, analysis, new Set(candidates));
    expect(all.firstTryAfter).toBeGreaterThan(all.firstTryBefore + 0.1);
    expect(all.passAfter).toBeGreaterThanOrEqual(all.passBefore);
    expect(all.retryMsSaved).toBeGreaterThan(0);
    expect(quarantineCandidates(analysis, 50).length).toBeLessThan(candidates.length);

    const everything = simulateQuarantine(ds, analysis, new Set(ds.tests.map((t) => t.id)));
    expect(everything.passAfter).toBe(1);
    expect(everything.blindIncidents).toHaveLength(analysis.incidents.length);
  });
});
