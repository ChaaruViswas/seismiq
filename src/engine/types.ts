/**
 * Core data model shared by the simulator, the importers, the analysis engine,
 * the CLI and the UI. Everything is plain data (structured-clone friendly) so
 * it can cross the Web Worker boundary and be persisted to IndexedDB as-is.
 */

/** Outcome of one test in one CI run, stored as a byte in `Run.statuses`. */
export const Status = {
  /** The test did not exist / was not executed in this run. */
  NotRun: 0,
  Pass: 1,
  /** Failed on every attempt. */
  Fail: 2,
  Skip: 3,
  /** Failed at least once, then passed on retry — hard evidence of non-determinism. */
  Flaky: 4,
} as const;
export type StatusCode = (typeof Status)[keyof typeof Status];

export type TestKind = 'unit' | 'integration' | 'e2e';

export interface SourceFile {
  id: number;
  path: string;
  module: string;
  loc: number;
}

export interface TestCase {
  id: number;
  name: string;
  suite: string;
  /** Path of the file that contains the test. */
  file: string;
  module: string;
  kind: TestKind;
  owner: string;
  /** Source files the test file imports directly. */
  targets: number[];
  /** Source files recorded by per-test coverage (may be stale or incomplete). */
  coverage: number[];
}

export interface FileChange {
  file: number;
  added: number;
  deleted: number;
}

export interface Commit {
  sha: string;
  author: string;
  message: string;
  timestamp: number;
  /** Changes to files known to the dependency graph. */
  changes: FileChange[];
  /** Other touched paths (lockfiles, CI config, docs, ...). */
  otherPaths: string[];
}

export interface Run {
  id: number;
  /** Human-facing CI run number. */
  number: number;
  timestamp: number;
  branch: string;
  /** Indices into `Dataset.commits` — the commits this run built for the first time. */
  commits: number[];
  /** One `StatusCode` per test. */
  statuses: Uint8Array;
  /** Total time spent on each test in ms, including retries. */
  durations: Float32Array;
  /** Wall-clock duration of the whole pipeline in seconds. */
  wallSec: number;
}

export interface FailureRecord {
  run: number;
  test: number;
  message: string;
  /** How many attempts failed (1..n). */
  failedAttempts: number;
  /** True when no attempt passed. */
  final: boolean;
}

export type FlakeCategory =
  | 'timeout'
  | 'network'
  | 'concurrency'
  | 'order-dependency'
  | 'time'
  | 'resource'
  | 'infrastructure'
  | 'assertion'
  | 'unknown';

/** What the simulator actually planted. Used only to score the engine. */
export interface GroundTruth {
  flaky: { test: number; rate: number; category: FlakeCategory; fromRun: number; toRun: number }[];
  regressions: {
    commit: number;
    run: number;
    file: number;
    tests: number[];
    fixedInRun: number | null;
  }[];
  slowdowns: { test: number; run: number; factor: number }[];
  infraRuns: number[];
  hiddenCouplings: [file: number, test: number][];
}

export interface DatasetMeta {
  name: string;
  source: 'demo' | 'import';
  description: string;
  createdAt: number;
  seed?: number;
  /** Parallel workers used by the pipeline (for wall-clock estimates). */
  parallelism: number;
  /** Fixed per-run overhead in seconds (checkout, install, build). */
  overheadSec: number;
}

export interface Dataset {
  meta: DatasetMeta;
  files: SourceFile[];
  /** Import edges `[from, to]`: file `from` imports file `to`. */
  deps: [number, number][];
  tests: TestCase[];
  commits: Commit[];
  runs: Run[];
  failures: FailureRecord[];
  truth?: GroundTruth;
}
