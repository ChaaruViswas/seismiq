/**
 * Repository index: the import graph, per-test reachability and coverage, and
 * change-aware test selection built on top of them.
 */
import type { History } from './history';
import { type Dataset, type Run, Status } from './types';

export type PathKind = 'global' | 'docs' | 'other';

const GLOBAL_PATTERNS = [
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json)$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)(vite|vitest|jest|playwright|babel|webpack|rollup|eslint|biome)\.config\.[cm]?[jt]s$/,
  /(^|\/)(biome|babel\.config|\.babelrc|\.eslintrc)(\.json)?$/,
  /^\.github\/workflows\//,
  /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|Makefile|\.nvmrc|\.node-version|\.tool-versions)$/,
  /(^|\/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|go\.(mod|sum)|Cargo\.(toml|lock)|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Gemfile(\.lock)?)$/,
];
const DOCS_PATTERNS = [
  /\.(md|mdx|rst|adoc)$/i,
  /^docs\//,
  /(^|\/)(LICENSE|NOTICE|AUTHORS|CODEOWNERS|\.gitignore|\.editorconfig)$/,
  /\.(png|jpe?g|gif|svg|webp|ico)$/i,
];

/**
 * `global` paths can affect any test (dependencies, build and CI config), so
 * they force a full run. `docs` paths cannot affect tests at all.
 */
export function classifyPath(path: string): PathKind {
  if (GLOBAL_PATTERNS.some((p) => p.test(path))) return 'global';
  if (DOCS_PATTERNS.some((p) => p.test(path))) return 'docs';
  return 'other';
}

export interface ChangeSet {
  /** Known source file id → lines added + deleted. */
  files: Map<number, number>;
  otherPaths: string[];
  /** A path that forces a full run, if any. */
  globalPath: string | null;
  /** True when nothing that can influence a test was touched. */
  docsOnly: boolean;
  /** Test files touched directly (custom diffs only). */
  testFiles: string[];
}

/** Why a test was selected. Lower codes are stronger evidence; 0 means "not selected". */
export const Reason = {
  None: 0,
  Global: 1,
  TestChanged: 2,
  Target: 3,
  Coverage: 4,
  Static: 5,
  History: 6,
  Failing: 7,
  NameMatch: 8,
} as const;
export type ReasonCode = (typeof Reason)[keyof typeof Reason];

export const REASON_LABEL: Record<ReasonCode, string> = {
  0: 'Not selected',
  1: 'Global change',
  2: 'Test file changed',
  3: 'Imports a changed file',
  4: 'Covers a changed file',
  5: 'Reaches a changed file',
  6: 'Failed with this file before',
  7: 'Failing on the base commit',
  8: 'Name matches a changed file',
};

export const REASON_HELP: Record<ReasonCode, string> = {
  0: '',
  1: 'A dependency manifest, build or CI configuration file changed, so every test must run.',
  2: 'The test file itself was modified.',
  3: 'The test file directly imports a file in this change.',
  4: 'Recorded per-test coverage shows the test executes a changed file.',
  5: 'The import graph connects the test to a changed file, even though coverage did not record it.',
  6: 'History shows this test newly failing when this file changed, despite no static link.',
  7: 'The test was failing before this change, so it must run again to detect the fix.',
  8: 'No graph data for this path — matched by file-name convention.',
};

export class RepoIndex {
  readonly nFiles: number;
  readonly nTests: number;
  readonly importsOf: number[][];
  readonly importedBy: number[][];
  /** Per test: distance + 1 to each file through the import graph (1 = direct import, 0 = unreachable). */
  readonly dist: Uint8Array[];
  /** Per test: 1 when recorded coverage includes the file. */
  readonly cov: Uint8Array[];
  readonly isTarget: Uint8Array[];
  private readonly pathToFile = new Map<string, number>();
  private readonly testsByFile = new Map<string, number[]>();

  constructor(readonly dataset: Dataset) {
    const { files, tests, deps } = dataset;
    this.nFiles = files.length;
    this.nTests = tests.length;
    this.importsOf = files.map(() => []);
    this.importedBy = files.map(() => []);
    for (const [from, to] of deps) {
      this.importsOf[from]!.push(to);
      this.importedBy[to]!.push(from);
    }
    for (const f of files) this.pathToFile.set(f.path, f.id);

    this.dist = [];
    this.cov = [];
    this.isTarget = [];
    for (const t of tests) {
      const dist = new Uint8Array(this.nFiles);
      const target = new Uint8Array(this.nFiles);
      let frontier = t.targets.filter((f) => f < this.nFiles);
      for (const f of frontier) {
        dist[f] = 1;
        target[f] = 1;
      }
      for (let depth = 2; frontier.length > 0 && depth < 255; depth++) {
        const next: number[] = [];
        for (const f of frontier) {
          for (const d of this.importsOf[f]!) {
            if (dist[d] === 0) {
              dist[d] = depth;
              next.push(d);
            }
          }
        }
        frontier = next;
      }
      const cov = new Uint8Array(this.nFiles);
      for (const f of t.coverage) if (f < this.nFiles) cov[f] = 1;
      this.dist.push(dist);
      this.cov.push(cov);
      this.isTarget.push(target);
      const list = this.testsByFile.get(t.file);
      if (list) list.push(t.id);
      else this.testsByFile.set(t.file, [t.id]);
    }
  }

  fileByPath(path: string): number | undefined {
    return this.pathToFile.get(path);
  }

  testsInFile(path: string): number[] {
    return this.testsByFile.get(path) ?? [];
  }

  /** Every file that transitively imports `file` (excluding itself). */
  dependents(file: number): number[] {
    const seen = new Set<number>([file]);
    const stack = [file];
    while (stack.length > 0) {
      for (const d of this.importedBy[stack.pop()!]!) {
        if (!seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
      }
    }
    seen.delete(file);
    return [...seen];
  }

  changeSetOfCommits(commitIdxs: readonly number[]): ChangeSet {
    const files = new Map<number, number>();
    const otherPaths: string[] = [];
    for (const idx of commitIdxs) {
      const c = this.dataset.commits[idx];
      if (!c) continue;
      for (const ch of c.changes) files.set(ch.file, (files.get(ch.file) ?? 0) + ch.added + ch.deleted);
      for (const p of c.otherPaths) if (!otherPaths.includes(p)) otherPaths.push(p);
    }
    return finishChangeSet(files, otherPaths, []);
  }

  changeSetOfRun(run: Run): ChangeSet {
    return this.changeSetOfCommits(run.commits);
  }

  /**
   * Build a change set from arbitrary paths (a pasted diff, `git diff --numstat`).
   * Paths that are neither known source files nor test files stay in `otherPaths`.
   */
  changeSetOfPaths(entries: readonly { path: string; lines: number }[]): ChangeSet {
    const files = new Map<number, number>();
    const otherPaths: string[] = [];
    const testFiles: string[] = [];
    for (const { path, lines } of entries) {
      const id = this.pathToFile.get(path);
      if (id !== undefined) files.set(id, (files.get(id) ?? 0) + lines);
      else if (this.testsByFile.has(path)) testFiles.push(path);
      else otherPaths.push(path);
    }
    return finishChangeSet(files, otherPaths, testFiles);
  }
}

function finishChangeSet(files: Map<number, number>, otherPaths: string[], testFiles: string[]): ChangeSet {
  const globalPath = otherPaths.find((p) => classifyPath(p) === 'global') ?? null;
  const docsOnly =
    files.size === 0 && testFiles.length === 0 && otherPaths.every((p) => classifyPath(p) === 'docs');
  return { files, otherPaths, globalPath, docsOnly, testFiles };
}

/** File name without directories, extension or test suffix: `src/a/cart.service.test.ts` → `cart.service`. */
export function stem(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base
    .replace(/\.[cm]?[jt]sx?$|\.py$|\.java$|\.kt$|\.go$|\.rb$|\.cs$/i, '')
    .replace(/[._-](test|spec)$/i, '')
    .replace(/^test_|_test$|Tests?$/, '');
}

/**
 * Safe test selection for a change: the primary reason code for every test,
 * 0 for tests that can be skipped.
 *
 * The rule is deliberately conservative — a test is skipped only when nothing
 * links it to the change: not the import graph, not recorded coverage, not
 * failure history, and it is not already failing.
 */
export function selectTests(index: RepoIndex, change: ChangeSet, history: History | null): Uint8Array {
  const { nTests } = index;
  const out = new Uint8Array(nTests);
  if (change.globalPath !== null) return out.fill(Reason.Global);

  const changed = [...change.files.keys()];
  const unknownStems = change.otherPaths
    .filter((p) => classifyPath(p) === 'other')
    .map(stem)
    .filter((s) => s.length >= 3);

  for (let t = 0; t < nTests; t++) {
    let reason: number = Reason.None;
    const dist = index.dist[t]!;
    const cov = index.cov[t]!;
    for (const f of changed) {
      let r: number = Reason.None;
      if (dist[f] === 1) r = Reason.Target;
      else if (cov[f]) r = Reason.Coverage;
      else if (dist[f]! > 1) r = Reason.Static;
      else if (history && learnedCoupling(history, f, t, nTests)) r = Reason.History;
      if (r !== Reason.None && (reason === Reason.None || r < reason)) reason = r;
    }
    if (reason === Reason.None && history && history.lastStatus[t] === Status.Fail) reason = Reason.Failing;
    if (reason === Reason.None && unknownStems.length > 0) {
      const s = stem(index.dataset.tests[t]!.file);
      if (unknownStems.includes(s)) reason = Reason.NameMatch;
    }
    out[t] = reason;
  }
  for (const path of change.testFiles) for (const t of index.testsInFile(path)) out[t] = Reason.TestChanged;
  return out;
}

/**
 * Has history taught us that `test` breaks when `file` changes, even though
 * nothing static connects them? Requires the co-failure to explain a
 * meaningful share of the file's changes, so hot files do not select everything.
 */
export function learnedCoupling(history: History, file: number, test: number, nTests: number): boolean {
  const count = history.coFail.get(file * nTests + test) ?? 0;
  if (count === 0) return false;
  const needed = history.ewFlake[test]! > 0.02 ? 3 : 1;
  return count >= needed && count / Math.max(1, history.fileChanged[file]!) >= 0.2;
}
