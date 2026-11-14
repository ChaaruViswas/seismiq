/**
 * JUnit XML in and out. JUnit XML is the one report format every test runner
 * can emit (Vitest, Jest, Playwright, pytest, Maven Surefire, Gradle, Go via
 * gotestsum, ...), so it is the import format for real projects.
 */
import { XMLParser } from 'fast-xml-parser';
import {
  type Dataset,
  type FailureRecord,
  type Run,
  Status,
  type StatusCode,
  type TestCase,
  type TestKind,
} from './types';

export interface ParsedCase {
  suite: string;
  name: string;
  file: string;
  ms: number;
  status: StatusCode;
  message: string;
  failedAttempts: number;
}

export interface ParsedReport {
  timestamp: number | null;
  commit: string | null;
  cases: ParsedCase[];
}

type Node = Record<string, unknown>;

const LIST_TAGS = new Set([
  'testsuite',
  'testcase',
  'failure',
  'error',
  'skipped',
  'flakyFailure',
  'flakyError',
  'rerunFailure',
  'rerunError',
  'property',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => LIST_TAGS.has(name),
});

const attr = (node: Node, name: string): string => {
  const v = node[`@_${name}`];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
};

const list = (node: Node, tag: string): Node[] => {
  const v = node[tag];
  if (!Array.isArray(v)) return [];
  // A childless element such as <skipped/> parses to an empty string.
  return v.map((item) =>
    typeof item === 'object' && item !== null ? (item as Node) : { '#text': String(item) },
  );
};

/**
 * One readable message from a <failure>/<error> element. Runners disagree on
 * where the text lives: some put it in the `message` attribute, some in the
 * element body, most in both (the body repeating the message above a stack).
 */
function failureText(node: Node): string {
  const message = attr(node, 'message').trim();
  const type = attr(node, 'type').trim();
  const body = (typeof node['#text'] === 'string' ? (node['#text'] as string) : '').trim();
  const bodyLines = body ? body.split('\n') : [];
  const withType = (line: string) =>
    type && !line.startsWith(type) && !/^[\w.$]*(Error|Exception|Failure)\b/.test(line)
      ? `${type}: ${line}`
      : line;
  let lines: string[];
  if (!message)
    lines = bodyLines.length > 0 ? [withType(bodyLines[0]!), ...bodyLines.slice(1)] : [type || 'Test failed'];
  else if (bodyLines.length > 0 && bodyLines[0]!.includes(message))
    lines = [withType(bodyLines[0]!), ...bodyLines.slice(1)];
  else lines = [withType(message), ...bodyLines];
  return lines.join('\n').slice(0, 4000);
}

const COMMIT_KEYS = /^(commit|sha|git[._-]?(commit|sha)|github[._-]?sha|ci[._-]?commit[._-]?sha|revision)$/i;

/** Parse one JUnit XML document. Throws on input that is not a JUnit report. */
export function parseJUnit(xml: string): ParsedReport {
  const doc = parser.parse(xml) as Node;
  const roots: Node[] = [];
  const wrapper = doc.testsuites;
  if (typeof wrapper === 'object' && wrapper !== null) roots.push(...list(wrapper as Node, 'testsuite'));
  roots.push(...list(doc, 'testsuite'));
  if (roots.length === 0) {
    if (wrapper !== undefined) return { timestamp: null, commit: null, cases: [] };
    throw new Error('Not a JUnit XML report: no <testsuite> element found.');
  }

  let timestamp: number | null = null;
  let commit: string | null = null;
  const raw: ParsedCase[] = [];

  const visit = (suite: Node, parentName: string, parentFile: string) => {
    const suiteName = attr(suite, 'name') || parentName;
    const suiteFile = attr(suite, 'file') || attr(suite, 'filepath') || parentFile;
    const ts = Date.parse(attr(suite, 'timestamp'));
    if (Number.isFinite(ts) && (timestamp === null || ts < timestamp)) timestamp = ts;
    const props = suite.properties;
    if (typeof props === 'object' && props !== null && !Array.isArray(props)) {
      for (const p of list(props as Node, 'property')) {
        if (commit === null && COMMIT_KEYS.test(attr(p, 'name')) && attr(p, 'value'))
          commit = attr(p, 'value');
      }
    }
    for (const tc of list(suite, 'testcase')) {
      const failures = [...list(tc, 'failure'), ...list(tc, 'error')];
      const flaky = [...list(tc, 'flakyFailure'), ...list(tc, 'flakyError')];
      const reruns = [...list(tc, 'rerunFailure'), ...list(tc, 'rerunError')];
      let status: StatusCode = Status.Pass;
      let message = '';
      let failedAttempts = 0;
      if (failures.length > 0) {
        status = Status.Fail;
        message = failureText(failures[0]!);
        failedAttempts = failures.length + reruns.length;
      } else if (flaky.length > 0) {
        status = Status.Flaky;
        message = failureText(flaky[0]!);
        failedAttempts = flaky.length;
      } else if (tc.skipped !== undefined) status = Status.Skip;
      const seconds = Number.parseFloat(attr(tc, 'time').replace(/,/g, ''));
      raw.push({
        suite: attr(tc, 'classname') || suiteName || 'default',
        name: attr(tc, 'name') || '(unnamed test)',
        file: attr(tc, 'file') || suiteFile,
        ms: Number.isFinite(seconds) ? seconds * 1000 : 0,
        status,
        message,
        failedAttempts,
      });
    }
    for (const child of list(suite, 'testsuite')) visit(child, suiteName, suiteFile);
  };
  for (const root of roots) visit(root, '', '');

  // Runners that retry write one <testcase> per attempt: fold attempts into one result.
  const merged = new Map<string, ParsedCase[]>();
  for (const c of raw) {
    const key = `${c.suite}\u0000${c.name}`;
    const group = merged.get(key);
    if (group) group.push(c);
    else merged.set(key, [c]);
  }
  const cases: ParsedCase[] = [];
  for (const group of merged.values()) {
    if (group.length === 1) {
      cases.push(group[0]!);
      continue;
    }
    const failed = group.filter((c) => c.status === Status.Fail || c.status === Status.Flaky);
    const passed = group.some((c) => c.status === Status.Pass || c.status === Status.Flaky);
    const ms = group.reduce((s, c) => s + c.ms, 0);
    const first = failed[0] ?? group[0]!;
    if (failed.length === 0) cases.push({ ...group[0]!, ms });
    else
      cases.push({
        ...first,
        ms,
        status: passed ? Status.Flaky : Status.Fail,
        failedAttempts: failed.reduce((s, c) => s + Math.max(1, c.failedAttempts), 0),
      });
  }
  return { timestamp, commit, cases };
}

function guessKind(text: string): TestKind {
  if (/(^|[\\/._-])(e2e|end-to-end|playwright|cypress|selenium|acceptance|browser)([\\/._-]|$)/i.test(text))
    return 'e2e';
  if (/(^|[\\/._-])(integration|integ|it|api|contract|functional)([\\/._-]|$)/i.test(text))
    return 'integration';
  // Java convention: FooIT, FooITCase, FooIntegrationTest.
  if (/[a-z](IT|ITCase|IntegrationTests?)\b/.test(text)) return 'integration';
  return 'unit';
}

function guessModule(file: string, suite: string): string {
  const source = file || suite;
  const parts = source
    .replace(/\\/g, '/')
    .split(file ? '/' : /[/.]/)
    .filter((p) => p && p !== '.' && p !== '..');
  const skip = new Set([
    'src',
    'test',
    'tests',
    'spec',
    'specs',
    'lib',
    'app',
    'packages',
    'apps',
    'e2e',
    'integration',
    'unit',
    '__tests__',
    'com',
    'org',
    'io',
    'net',
    'main',
    'java',
    'kotlin',
  ]);
  const meaningful = parts.slice(0, -1).filter((p) => !skip.has(p.toLowerCase()));
  if (meaningful.length > 0) return meaningful[0]!;
  // Nothing but generic folders: fall back to the file's own name (`e2e/checkout.spec.ts` → `checkout`).
  const leaf = (parts[parts.length - 1] ?? '').replace(/\.[^.]+$/, '').replace(/[._-](test|spec)$/i, '');
  return leaf || 'root';
}

const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

/**
 * Build a dataset from JUnit reports, one report per CI run. Reports are
 * ordered by their embedded timestamp when every report has one, otherwise by
 * natural file-name order (`run-2.xml` before `run-10.xml`).
 */
export function datasetFromReports(
  reports: { name: string; xml: string }[],
  projectName = 'Imported project',
): Dataset {
  const parsed = reports.map((r) => {
    try {
      return { name: r.name, report: parseJUnit(r.xml) };
    } catch (err) {
      throw new Error(`${r.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  const usable = parsed.filter((p) => p.report.cases.length > 0);
  if (usable.length === 0) throw new Error('No test cases found in the uploaded reports.');
  const allStamped = usable.every((p) => p.report.timestamp !== null);
  const distinct = new Set(usable.map((p) => p.report.timestamp)).size === usable.length;
  usable.sort((a, b) =>
    allStamped && distinct ? a.report.timestamp! - b.report.timestamp! : naturalCompare(a.name, b.name),
  );

  const tests: TestCase[] = [];
  const idOf = new Map<string, number>();
  for (const { report } of usable) {
    for (const c of report.cases) {
      const key = `${c.suite}\u0000${c.name}`;
      if (idOf.has(key)) continue;
      idOf.set(key, tests.length);
      tests.push({
        id: tests.length,
        name: c.name,
        suite: c.suite,
        file: c.file || c.suite,
        module: guessModule(c.file, c.suite),
        kind: guessKind(`${c.file} ${c.suite}`),
        owner: '',
        targets: [],
        coverage: [],
      });
    }
  }

  const base = Date.now() - usable.length * 3_600_000;
  const runs: Run[] = [];
  const failures: FailureRecord[] = [];
  const commits: Dataset['commits'] = [];
  usable.forEach(({ name, report }, r) => {
    const statuses = new Uint8Array(tests.length);
    const durations = new Float32Array(tests.length);
    let totalMs = 0;
    for (const c of report.cases) {
      const t = idOf.get(`${c.suite}\u0000${c.name}`)!;
      statuses[t] = c.status;
      durations[t] = c.ms;
      totalMs += c.ms;
      if (c.status === Status.Fail || c.status === Status.Flaky) {
        failures.push({
          run: r,
          test: t,
          message: c.message || 'Test failed',
          failedAttempts: Math.max(1, c.failedAttempts),
          final: c.status === Status.Fail,
        });
      }
    }
    const timestamp = allStamped && distinct ? report.timestamp! : base + r * 3_600_000;
    const runCommits: number[] = [];
    if (report.commit) {
      runCommits.push(commits.length);
      commits.push({ sha: report.commit, author: '', message: name, timestamp, changes: [], otherPaths: [] });
    }
    runs.push({
      id: r,
      number: r + 1,
      timestamp,
      branch: '',
      commits: runCommits,
      statuses,
      durations,
      wallSec: Math.round(totalMs / 1000),
    });
  });

  return {
    meta: {
      name: projectName,
      source: 'import',
      description: `${usable.length} JUnit report${usable.length === 1 ? '' : 's'}, ${tests.length} tests.`,
      createdAt: Date.now(),
      parallelism: 1,
      overheadSec: 0,
    },
    files: [],
    deps: [],
    tests,
    commits,
    runs,
    failures,
  };
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not legal in XML 1.0.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Serialise one run as JUnit XML (Surefire dialect: retries that passed become `<flakyFailure>`). */
export function toJUnitXml(dataset: Dataset, runIndex: number): string {
  const run = dataset.runs[runIndex]!;
  const messages = new Map<number, FailureRecord>();
  for (const f of dataset.failures) if (f.run === runIndex) messages.set(f.test, f);
  const bySuite = new Map<string, TestCase[]>();
  for (const t of dataset.tests) {
    if (run.statuses[t.id] === Status.NotRun) continue;
    const group = bySuite.get(t.suite);
    if (group) group.push(t);
    else bySuite.set(t.suite, [t]);
  }
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const sha = run.commits.length > 0 ? dataset.commits[run.commits[run.commits.length - 1]!]!.sha : '';
  out.push(`<testsuites name="${escapeXml(dataset.meta.name)}">`);
  for (const [suite, cases] of bySuite) {
    const count = (s: StatusCode) => cases.filter((t) => run.statuses[t.id] === s).length;
    const seconds = cases.reduce((s, t) => s + run.durations[t.id]!, 0) / 1000;
    out.push(
      `  <testsuite name="${escapeXml(suite)}" file="${escapeXml(cases[0]!.file)}" tests="${cases.length}" failures="${count(Status.Fail)}" skipped="${count(Status.Skip)}" time="${seconds.toFixed(3)}" timestamp="${new Date(run.timestamp).toISOString()}">`,
    );
    if (sha) out.push(`    <properties><property name="commit" value="${sha}"/></properties>`);
    for (const t of cases) {
      const status = run.statuses[t.id];
      const open = `    <testcase classname="${escapeXml(suite)}" name="${escapeXml(t.name)}" file="${escapeXml(t.file)}" time="${(run.durations[t.id]! / 1000).toFixed(3)}"`;
      const f = messages.get(t.id);
      const head = escapeXml((f?.message ?? 'Test failed').split('\n', 1)[0]!);
      const body = escapeXml(f?.message ?? 'Test failed');
      if (status === Status.Pass) out.push(`${open}/>`);
      else if (status === Status.Skip) out.push(`${open}><skipped/></testcase>`);
      else if (status === Status.Fail) {
        const reruns = `<rerunFailure message="${head}">${body}</rerunFailure>`.repeat(
          Math.max(0, (f?.failedAttempts ?? 1) - 1),
        );
        out.push(`${open}><failure message="${head}">${body}</failure>${reruns}</testcase>`);
      } else {
        const attempts = Math.max(1, f?.failedAttempts ?? 1);
        const one = `<flakyFailure message="${head}">${body}</flakyFailure>`;
        out.push(`${open}>${one.repeat(attempts)}</testcase>`);
      }
    }
    out.push('  </testsuite>');
  }
  out.push('</testsuites>');
  return out.join('\n');
}
