import { describe, expect, it } from 'vitest';
import { analyze } from '../src/engine/analyze';
import { datasetFromReports, parseJUnit, toJUnitXml } from '../src/engine/junit';
import { simulate } from '../src/engine/simulator';
import { Status } from '../src/engine/types';

describe('parseJUnit', () => {
  it('reads passes, failures, errors and skips', () => {
    const xml = `<?xml version="1.0"?>
      <testsuites>
        <testsuite name="cart" timestamp="2026-11-01T10:00:00Z" file="src/cart.test.ts">
          <properties><property name="commit" value="abc1234"/></properties>
          <testcase classname="cart" name="adds an item" time="0.012"/>
          <testcase classname="cart" name="removes an item" time="1.5">
            <failure message="expected 1 to equal 2" type="AssertionError">AssertionError: expected 1 to equal 2
    at src/cart.test.ts:10:5</failure>
          </testcase>
          <testcase classname="cart" name="crashes" time="0.1"><error type="TypeError">x is undefined</error></testcase>
          <testcase classname="cart" name="later" time="0"><skipped/></testcase>
        </testsuite>
      </testsuites>`;
    const report = parseJUnit(xml);
    expect(report.timestamp).toBe(Date.parse('2026-11-01T10:00:00Z'));
    expect(report.commit).toBe('abc1234');
    expect(report.cases.map((c) => c.status)).toEqual([Status.Pass, Status.Fail, Status.Fail, Status.Skip]);
    expect(report.cases[0]).toMatchObject({
      suite: 'cart',
      name: 'adds an item',
      ms: 12,
      file: 'src/cart.test.ts',
    });
    expect(report.cases[1]!.message).toContain('AssertionError: expected 1 to equal 2');
    expect(report.cases[1]!.message).toContain('at src/cart.test.ts:10:5');
    expect(report.cases[2]!.message).toBe('TypeError: x is undefined');
  });

  it('accepts a bare <testsuite> root and nested suites', () => {
    const xml = `<testsuite name="outer"><testsuite name="inner"><testcase name="t" time="1"/></testsuite><testcase name="u"/></testsuite>`;
    const report = parseJUnit(xml);
    expect(report.cases.map((c) => `${c.suite}/${c.name}`).sort()).toEqual(['inner/t', 'outer/u']);
  });

  it('treats Surefire flakyFailure as passed-on-retry and counts rerun failures', () => {
    const xml = `<testsuite name="s">
      <testcase name="flaky" time="2"><flakyFailure message="timeout">t1</flakyFailure><flakyFailure message="timeout">t2</flakyFailure></testcase>
      <testcase name="broken" time="3"><failure message="boom"/><rerunFailure message="boom"/><rerunFailure message="boom"/></testcase>
    </testsuite>`;
    const [flaky, broken] = parseJUnit(xml).cases;
    expect(flaky).toMatchObject({ status: Status.Flaky, failedAttempts: 2 });
    expect(broken).toMatchObject({ status: Status.Fail, failedAttempts: 3 });
  });

  it('folds one <testcase> per attempt into a single result', () => {
    const xml = `<testsuite name="s">
      <testcase name="retry-pass" time="1"><failure message="first attempt"/></testcase>
      <testcase name="retry-pass" time="1"/>
      <testcase name="retry-fail" time="1"><failure message="a"/></testcase>
      <testcase name="retry-fail" time="1"><failure message="a"/></testcase>
      <testcase name="ok" time="1"/>
    </testsuite>`;
    const byName = new Map(parseJUnit(xml).cases.map((c) => [c.name, c]));
    expect(byName.get('retry-pass')).toMatchObject({
      status: Status.Flaky,
      failedAttempts: 1,
      ms: 2000,
      message: 'first attempt',
    });
    expect(byName.get('retry-fail')).toMatchObject({ status: Status.Fail, failedAttempts: 2 });
    expect(byName.get('ok')).toMatchObject({ status: Status.Pass });
  });

  it('decodes XML entities and handles empty suites', () => {
    const report = parseJUnit(
      `<testsuites><testsuite name="a &amp; b"><testcase name="x &lt; y"/></testsuite></testsuites>`,
    );
    expect(report.cases[0]).toMatchObject({ suite: 'a & b', name: 'x < y' });
    expect(parseJUnit('<testsuites></testsuites>').cases).toEqual([]);
  });

  it('rejects documents that are not JUnit reports', () => {
    expect(() => parseJUnit('<html><body>nope</body></html>')).toThrow(/Not a JUnit XML report/);
    expect(() => datasetFromReports([{ name: 'bad.xml', xml: '<html/>' }])).toThrow(/bad\.xml/);
  });
});

describe('datasetFromReports', () => {
  const report = (name: string, body: string, ts?: string) => ({
    name,
    xml: `<testsuite name="s"${ts ? ` timestamp="${ts}"` : ''}>${body}</testsuite>`,
  });

  it('orders reports by timestamp when available', () => {
    const ds = datasetFromReports([
      report('b.xml', '<testcase name="t"><failure message="x"/></testcase>', '2026-11-02T00:00:00Z'),
      report('a.xml', '<testcase name="t"/>', '2026-11-03T00:00:00Z'),
    ]);
    expect(Array.from(ds.runs, (r) => r.statuses[0])).toEqual([Status.Fail, Status.Pass]);
  });

  it('falls back to natural file-name order', () => {
    const ds = datasetFromReports([
      report('run-10.xml', '<testcase name="t"/>'),
      report('run-2.xml', '<testcase name="t"><failure message="x"/></testcase>'),
    ]);
    expect(Array.from(ds.runs, (r) => r.statuses[0])).toEqual([Status.Fail, Status.Pass]);
  });

  it('marks tests missing from a report as not run', () => {
    const ds = datasetFromReports([
      report('1.xml', '<testcase name="old"/>'),
      report('2.xml', '<testcase name="old"/><testcase name="new"/>'),
    ]);
    expect(ds.tests.map((t) => t.name)).toEqual(['old', 'new']);
    expect(ds.runs[0]!.statuses[1]).toBe(Status.NotRun);
    expect(ds.runs[1]!.statuses[1]).toBe(Status.Pass);
  });

  it('guesses the kind and module of a test from its path', () => {
    const ds = datasetFromReports([
      {
        name: 'r.xml',
        xml: `<testsuites>
          <testsuite name="a" file="src/cart/total.test.ts"><testcase name="x"/></testsuite>
          <testsuite name="b" file="e2e/checkout.spec.ts"><testcase name="x"/></testsuite>
          <testsuite name="com.acme.billing.InvoiceIT"><testcase classname="com.acme.billing.InvoiceIT" name="x"/></testsuite>
        </testsuites>`,
      },
    ]);
    expect(ds.tests.map((t) => [t.kind, t.module])).toEqual([
      ['unit', 'cart'],
      ['e2e', 'checkout'],
      ['integration', 'acme'],
    ]);
  });

  it('survives a single report with no failures', () => {
    const ds = datasetFromReports([
      report('only.xml', '<testcase name="a" time="0.5"/><testcase name="b" time="1"/>'),
    ]);
    const analysis = analyze(ds);
    expect(analysis.health).toMatchObject({ runs: 1, green: 1, red: 0, passRate: 1 });
    expect(analysis.model.model).toBeNull();
    expect(analysis.savings).toBeNull();
    expect(analysis.clusters).toEqual([]);
    expect(analysis.tests.map((s) => s.state)).toEqual(['new', 'new']);
  });

  it('detects flakiness from retries and from repeated flips without commit data', () => {
    const pass = '<testcase name="flip"/><testcase name="retry"/><testcase name="solid"/>';
    const fail =
      '<testcase name="flip"><failure message="Error: Test timed out in 5000ms."/></testcase><testcase name="retry"><flakyFailure message="Error: read ECONNRESET"/></testcase><testcase name="solid"/>';
    const reports = Array.from({ length: 24 }, (_, i) =>
      report(`run-${i + 1}.xml`, i % 4 === 1 ? fail : pass),
    );
    const analysis = analyze(datasetFromReports(reports));
    const byName = new Map(analysis.tests.map((s, i) => [['flip', 'retry', 'solid'][i], s]));
    expect(byName.get('flip')).toMatchObject({ state: 'flaky', category: 'timeout', flakeEvents: 6 });
    expect(byName.get('retry')).toMatchObject({ state: 'flaky', category: 'network', flakeEvents: 6 });
    expect(byName.get('solid')).toMatchObject({ state: 'healthy', flakeEvents: 0, flakeScore: 0 });
    expect(analysis.incidents).toEqual([]);
  });
});

describe('toJUnitXml', () => {
  it('round-trips a simulated history through XML', () => {
    const ds = simulate({ seed: 5, runs: 40, days: 10, endTime: Date.UTC(2026, 10, 1) });
    const reports = ds.runs.map((_, r) => ({ name: `run-${r}.xml`, xml: toJUnitXml(ds, r) }));
    const back = datasetFromReports(reports, ds.meta.name);

    expect(back.runs).toHaveLength(ds.runs.length);
    // Tests are discovered in order of first appearance, so map by identity.
    const idOf = new Map(back.tests.map((t) => [`${t.suite}\u0000${t.name}`, t.id]));
    const executed = ds.tests.filter((t) => ds.runs.some((r) => r.statuses[t.id] !== Status.NotRun));
    expect(back.tests).toHaveLength(executed.length);
    for (const t of executed) {
      const id = idOf.get(`${t.suite}\u0000${t.name}`)!;
      expect(back.tests[id]).toMatchObject({ file: t.file, kind: t.kind });
      for (let r = 0; r < ds.runs.length; r++) {
        expect(back.runs[r]!.statuses[id]).toBe(ds.runs[r]!.statuses[t.id]);
        expect(back.runs[r]!.durations[id]!).toBeCloseTo(ds.runs[r]!.durations[t.id]!, -1);
      }
    }
    expect(back.failures).toHaveLength(ds.failures.length);
    const original = ds.failures.map((f) => `${f.run}|${f.final}|${f.failedAttempts}|${f.message}`).sort();
    const restored = back.failures.map((f) => `${f.run}|${f.final}|${f.failedAttempts}|${f.message}`).sort();
    expect(restored).toEqual(original);
    expect(back.runs.map((r) => r.timestamp)).toEqual(ds.runs.map((r) => r.timestamp));
  });
});
