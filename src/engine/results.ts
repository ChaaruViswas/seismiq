/** Result types produced by the analysis engine. All plain data. */
import type { History } from './history';
import type { LogisticModel } from './model';
import type { FlakeCategory, StatusCode } from './types';

export type TestState = 'healthy' | 'flaky' | 'suspect' | 'failing' | 'stabilized' | 'skipped' | 'new';

export interface TestStats {
  test: number;
  executed: number;
  passes: number;
  fails: number;
  flakyPasses: number;
  skips: number;
  /** Retry-passes plus isolated hard failures that no code change explains. */
  flakeEvents: number;
  flakeRate: number;
  /** 95% Wilson interval of the flake rate. */
  flakeLower: number;
  flakeUpper: number;
  recentFlakeRate: number;
  /** 0–100. Blends recent and overall flake rate; what the UI ranks by. */
  flakeScore: number;
  state: TestState;
  category: FlakeCategory | null;
  firstFlakeRun: number;
  lastFlakeRun: number;
  /** Executed runs since the last flake event. */
  quietRuns: number;
  /** Probability of a quiet streak this long if the test were still flaky at its old rate. */
  quietChance: number;
  /** Run index where the current failing streak started, or -1. */
  failingSince: number;
  lastStatus: StatusCode;
  p50Ms: number;
  p95Ms: number;
  /** Time spent on attempts that were thrown away because a retry passed. */
  retryMs: number;
}

export type ClusterKind = 'regression' | 'flaky' | 'infrastructure';

export interface FailureCluster {
  id: number;
  title: string;
  sample: string;
  category: FlakeCategory;
  kind: ClusterKind;
  count: number;
  finalCount: number;
  tests: number[];
  runs: number[];
  firstRun: number;
  lastRun: number;
}

export interface CulpritCandidate {
  commit: number;
  score: number;
  probability: number;
  evidence: string[];
}

/** A group of tests that started failing in the same run and stayed red until fixed. */
export interface Incident {
  id: number;
  startRun: number;
  /** First run in which every affected test passed again; null while ongoing. */
  endRun: number | null;
  tests: number[];
  clusters: number[];
  culprits: CulpritCandidate[];
  fixCommit: number | null;
  /** Time to restore in ms; null while ongoing. */
  ttrMs: number | null;
}

export type RunOutcome = 'green' | 'flaky' | 'red';
export type RedCause = 'regression' | 'flaky' | 'infrastructure';

export interface RunStats {
  run: number;
  outcome: RunOutcome;
  cause: RedCause | null;
  executed: number;
  failed: number;
  flaky: number;
  skipped: number;
  /** Total test time in ms, retries included. */
  testMs: number;
  retryMs: number;
  /** Tests the change-aware selection would have run, and their time. */
  selected: number;
  selectedMs: number;
  /** Tests that newly failed in this run. */
  newFailures: number[];
  /** New failures the selection would have skipped. */
  escaped: number[];
  /** Predicted probability that the change breaks at least one passing test. */
  risk: number;
}

export interface ModelReport {
  /** Per-test model: P(a passing test newly fails | change). Null when history is too thin. */
  model: LogisticModel | null;
  /** Run-level calibrator: expected new failures → P(the run has at least one). */
  riskModel: LogisticModel | null;
  /** Run index ranges `[from, to)`. */
  trainRuns: [number, number];
  testRuns: [number, number];
  trainRows: number;
  trainPositives: number;
  testRows: number;
  testPositives: number;
  /** Held-out AUC over every (run, passing test) pair. */
  auc: number | null;
  roc: { fpr: number; tpr: number }[];
  /** Share of new failures found after running the top `budget` share of tests. */
  recallAtBudget: { budget: number; model: number; baseline: number }[];
  apfdModel: number | null;
  apfdBaseline: number | null;
  /** Held-out runs with at least one new failure. */
  failingRuns: number;
  /** Median seconds of test time until the first new failure appears. */
  ttffModelSec: number | null;
  ttffBaselineSec: number | null;
  calibration: { label: string; predicted: number; observed: number; runs: number }[];
}

export interface WeekBucket {
  start: number;
  runs: number;
  green: number;
  flaky: number;
  red: number;
  avgWallSec: number;
  retryMs: number;
}

export interface HealthReport {
  runs: number;
  green: number;
  flakyGreen: number;
  red: number;
  redByCause: Record<RedCause, number>;
  /** Share of runs that ended green (with or without retries). */
  passRate: number;
  /** Share of runs that were green on the first attempt of every test. */
  firstTryRate: number;
  /** Share of runs whose verdict reflected the code: clean green, or red for a real regression. */
  trustRate: number;
  incidents: number;
  openIncidents: number;
  /** Median time to restore, ms. */
  mttrMs: number | null;
  /** Share of code-changing runs that introduced a regression. */
  changeFailureRate: number;
  totalTestMs: number;
  retryMs: number;
  avgWallSec: number;
  weeks: WeekBucket[];
}

export interface SavingsReport {
  /** Runs that carried usable change information. */
  runs: number;
  fullMs: number;
  selectedMs: number;
  savedShare: number;
  /** Median share of the suite selected per run. */
  medianSelectedShare: number;
  fullRuns: number;
  docsOnlyRuns: number;
  newFailures: number;
  escapes: number;
  /** Share of new failures the selection would still have caught. */
  safety: number;
}

export interface DurationRegression {
  test: number;
  run: number;
  beforeMs: number;
  afterMs: number;
  ratio: number;
  /** Commits in that run that touch code the test reaches. */
  suspects: number[];
}

export interface Hotspot {
  file: number;
  changes: number;
  churn: number;
  incidents: number;
  dependents: number;
  tests: number;
  score: number;
}

export interface Evaluation {
  flaky: {
    planted: number;
    detected: number;
    truePositives: number;
    precision: number;
    recall: number;
    missed: number[];
  };
  category: { correct: number; total: number; accuracy: number };
  culprit: {
    incidents: number;
    ambiguous: number;
    top1: number;
    accuracy: number;
    ambiguousAccuracy: number;
  };
  selection: { regressionFailures: number; caught: number; safety: number };
  slowdowns: { planted: number; found: number; recall: number; falsePositives: number };
  infra: { planted: number; found: number; falsePositives: number };
}

export interface Analysis {
  nRuns: number;
  nTests: number;
  nFeatures: number;
  /** False when the dataset has no source graph or commits (plain JUnit imports). */
  hasChangeData: boolean;
  infraRuns: number[];
  /**
   * Commits judged by each run: its own, plus any carried over from preceding
   * runs that were lost to infrastructure incidents.
   */
  runCommits: number[][];
  /** `nRuns × nTests` reason codes (see `Reason`). */
  selection: Uint8Array;
  /** `nRuns × nTests × nFeatures`. */
  features: Float32Array;
  /** `nRuns × nTests` predicted failure probabilities. */
  probs: Float32Array;
  /** History after the last run — the state used to analyse a new change. */
  history: History;
  tests: TestStats[];
  clusters: FailureCluster[];
  /** Cluster id for each entry of `Dataset.failures`. */
  clusterOf: Int32Array;
  incidents: Incident[];
  runs: RunStats[];
  model: ModelReport;
  health: HealthReport;
  savings: SavingsReport | null;
  slowdowns: DurationRegression[];
  hotspots: Hotspot[];
  evaluation: Evaluation | null;
  elapsedMs: number;
}
