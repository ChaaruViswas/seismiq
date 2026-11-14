/**
 * Seismiq CLI.
 *
 *   seismiq select  — print the test files a change can affect
 *   seismiq report  — analyse JUnit XML reports and print a summary
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { analyze } from '../src/engine/analyze';
import { parseDiff } from '../src/engine/diff';
import { fmtPct, plural } from '../src/engine/format';
import { buildImportGraph, isSourceFile, selectTestFiles } from '../src/engine/importGraph';
import { datasetFromReports } from '../src/engine/junit';
import { markdownReport } from '../src/engine/report';

const VERSION = '1.0.0';
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-cli',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'playwright-report',
  'test-results',
]);

const HELP = `Seismiq ${VERSION} — change-aware test intelligence

Usage:
  seismiq select [options]            Print the test files affected by a change
  seismiq report <path...> [options]  Analyse JUnit XML reports (files or directories)

select options:
  --base <ref>      Compare against this git ref (default: origin/main, else HEAD~1)
  --head <ref>      Head ref (default: HEAD)
  --diff <file>     Read the change from a file instead of git ("-" for stdin).
                    Accepts a unified diff, --numstat, --name-status or a list of paths.
  --root <dir>      Project root (default: current directory)
  --format <fmt>    list (default) | json | md

report options:
  --name <name>     Project name shown in the report
  --format <fmt>    md (default) | json
  --out <file>      Write to a file instead of stdout

Examples:
  npx vitest run $(seismiq select --base origin/main)
  seismiq report reports/ --out "$GITHUB_STEP_SUMMARY"
`;

interface Args {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) flags.set(a.slice(2), argv[++i]!);
      else flags.set(a.slice(2), 'true');
    } else positional.push(a);
  }
  return { command: positional.shift() ?? 'help', positional, flags };
}

class UsageError extends Error {}

const toPosix = (p: string) => p.split(sep).join('/');

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.'))
        walk(root, join(dir, entry.name), out);
    } else if (entry.isFile()) out.push(toPosix(relative(root, join(dir, entry.name))));
  }
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function refExists(root: string, ref: string): boolean {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function changedPaths(root: string, flags: Map<string, string>): { paths: string[]; source: string } {
  const diffFile = flags.get('diff');
  if (diffFile) {
    const text = diffFile === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(diffFile), 'utf8');
    return { paths: parseDiff(text).map((e) => e.path), source: diffFile === '-' ? 'stdin' : diffFile };
  }
  const head = flags.get('head') ?? 'HEAD';
  let base = flags.get('base');
  if (!base)
    base = refExists(root, 'origin/main')
      ? 'origin/main'
      : refExists(root, 'origin/master')
        ? 'origin/master'
        : 'HEAD~1';
  if (!refExists(root, base))
    throw new UsageError(`Base ref "${base}" does not exist. Pass --base <ref> or --diff <file>.`);
  // Three dots: compare against the merge base, i.e. only what this branch changed.
  let range = `${base}...${head}`;
  let text: string;
  try {
    text = git(root, ['diff', '--name-status', '--no-renames', range]);
  } catch {
    range = `${base}..${head}`;
    text = git(root, ['diff', '--name-status', '--no-renames', range]);
  }
  // Paths are relative to the repository top level; re-base them onto --root.
  const top = git(root, ['rev-parse', '--show-toplevel']).trim();
  const prefix = toPosix(relative(top, root));
  const paths = parseDiff(text)
    .map((e) => e.path)
    .filter((p) => !prefix || p.startsWith(`${prefix}/`))
    .map((p) => (prefix ? p.slice(prefix.length + 1) : p));
  return { paths, source: range };
}

function select(args: Args): string {
  const root = resolve(args.flags.get('root') ?? '.');
  if (!existsSync(root)) throw new UsageError(`Root directory not found: ${root}`);
  const format = args.flags.get('format') ?? 'list';
  if (!['list', 'json', 'md'].includes(format))
    throw new UsageError(`Unknown format "${format}". Use list, json or md.`);

  const all: string[] = [];
  walk(root, root, all);
  const sources = new Map<string, string>();
  for (const path of all) if (isSourceFile(path)) sources.set(path, readFileSync(join(root, path), 'utf8'));
  const graph = buildImportGraph(sources);
  const { paths, source } = changedPaths(root, args.flags);
  const result = selectTestFiles(graph, paths);
  const selected = result.tests.length;
  const total = result.allTests.length;

  console.error(
    `seismiq: ${plural(paths.length, 'changed file')} (${source}) → ${selected} of ${plural(total, 'test file')} selected` +
      (result.globalPath
        ? ` — full run forced by ${result.globalPath}`
        : total > 0
          ? `, ${fmtPct(1 - selected / total)} skipped`
          : ''),
  );

  if (format === 'json') {
    return JSON.stringify(
      {
        changed: paths,
        globalPath: result.globalPath,
        total,
        selected: result.tests,
        skipped: total - selected,
        unreached: result.unreached,
      },
      null,
      2,
    );
  }
  if (format === 'md') {
    const lines = ['## Seismiq — change-aware test selection', ''];
    lines.push(
      `**${selected} of ${plural(total, 'test file')}** selected for ${plural(paths.length, 'changed file')} (\`${source}\`).`,
    );
    if (result.globalPath)
      lines.push('', `Full run forced by \`${result.globalPath}\`, which can affect any test.`);
    if (selected > 0 && !result.globalPath) {
      lines.push('', '| Test file | Why |', '| --- | --- |');
      for (const t of result.tests) {
        lines.push(
          `| \`${t.test}\` | ${t.reason === 'changed' ? 'changed itself' : `imports \`${t.chain[t.chain.length - 1]}\`${t.chain.length > 2 ? ` via ${t.chain.length - 2} file${t.chain.length === 3 ? '' : 's'}` : ''}`} |`,
        );
      }
    }
    if (result.unreached.length > 0) {
      lines.push('', `**Not reached by any test:** ${result.unreached.map((p) => `\`${p}\``).join(', ')}`);
    }
    return lines.join('\n');
  }
  return result.tests.map((t) => t.test).join('\n');
}

function collectXml(path: string, out: string[]): void {
  const full = resolve(path);
  if (!existsSync(full)) throw new UsageError(`Path not found: ${path}`);
  if (statSync(full).isDirectory()) {
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.isDirectory()) collectXml(join(full, entry.name), out);
      else if (entry.name.toLowerCase().endsWith('.xml')) out.push(join(full, entry.name));
    }
  } else out.push(full);
}

function report(args: Args): string {
  if (args.positional.length === 0)
    throw new UsageError('report needs at least one JUnit XML file or directory.');
  const format = args.flags.get('format') ?? 'md';
  if (!['md', 'json'].includes(format)) throw new UsageError(`Unknown format "${format}". Use md or json.`);
  const files: string[] = [];
  for (const p of args.positional) collectXml(p, files);
  if (files.length === 0) throw new UsageError('No .xml files found.');
  const dataset = datasetFromReports(
    files.map((f) => ({ name: toPosix(relative(process.cwd(), f)), xml: readFileSync(f, 'utf8') })),
    args.flags.get('name') ?? 'CI test report',
  );
  const analysis = analyze(dataset);
  console.error(
    `seismiq: analysed ${plural(dataset.runs.length, 'report')}, ${plural(dataset.tests.length, 'test')} in ${Math.round(analysis.elapsedMs)} ms`,
  );
  if (format === 'md') return markdownReport(dataset, analysis);
  const name = (t: number) => `${dataset.tests[t]!.suite} › ${dataset.tests[t]!.name}`;
  return JSON.stringify(
    {
      project: dataset.meta.name,
      runs: dataset.runs.length,
      tests: dataset.tests.length,
      health: { ...analysis.health, weeks: undefined },
      flaky: analysis.tests
        .filter((s) => s.state === 'flaky' || s.state === 'suspect')
        .sort((a, b) => b.flakeScore - a.flakeScore)
        .map((s) => ({
          test: name(s.test),
          state: s.state,
          flakeRate: s.flakeRate,
          score: s.flakeScore,
          category: s.category,
        })),
      failing: analysis.tests.filter((s) => s.state === 'failing').map((s) => name(s.test)),
      clusters: analysis.clusters.map((c) => ({
        title: c.title,
        kind: c.kind,
        category: c.category,
        count: c.count,
        tests: c.tests.length,
      })),
      slowdowns: analysis.slowdowns.map((d) => ({
        test: name(d.test),
        beforeMs: d.beforeMs,
        afterMs: d.afterMs,
        ratio: d.ratio,
      })),
    },
    null,
    2,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('version') || args.command === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.flags.has('help') || args.command === 'help') {
    console.log(HELP);
    return;
  }
  let output: string;
  if (args.command === 'select') output = select(args);
  else if (args.command === 'report') output = report(args);
  else throw new UsageError(`Unknown command "${args.command}". Run "seismiq help".`);
  const outFile = args.flags.get('out');
  if (outFile) writeFileSync(resolve(outFile), `${output}\n`, { flag: 'a' });
  else if (output) console.log(output);
}

try {
  main();
} catch (err) {
  console.error(`seismiq: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(err instanceof UsageError ? 2 : 1);
}
