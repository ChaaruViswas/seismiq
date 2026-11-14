/**
 * Rolling history the engine carries from run to run, and the feature vector
 * derived from it. The model answers one question: will this change break a
 * test that is currently passing? Features for run `r` only ever use runs `< r`, so the
 * predictor is never trained or scored on information from the future.
 */
import type { ChangeSet, RepoIndex } from './repo';
import { type Run, Status } from './types';

export interface History {
  nTests: number;
  /** Exponentially weighted rate of hard failures per test. */
  ewFail: Float32Array;
  /** Exponentially weighted rate of fail-then-pass retries per test. */
  ewFlake: Float32Array;
  /** Last executed status per test. */
  lastStatus: Uint8Array;
  executed: Int32Array;
  /** `file * nTests + test` → times the test newly failed in a run that changed the file. */
  coFail: Map<number, number>;
  fileChanged: Int32Array;
  /** Exponentially weighted share of a file's changes that came with a new failure. */
  fileBroke: Float32Array;
}

const ALPHA_TEST = 0.12;
const ALPHA_FILE = 0.25;

export function createHistory(nFiles: number, nTests: number): History {
  return {
    nTests,
    ewFail: new Float32Array(nTests),
    ewFlake: new Float32Array(nTests),
    lastStatus: new Uint8Array(nTests),
    executed: new Int32Array(nTests),
    coFail: new Map(),
    fileChanged: new Int32Array(nFiles),
    fileBroke: new Float32Array(nFiles),
  };
}

/**
 * Fold one finished run into the history. Infrastructure incidents are ignored entirely.
 *
 * Co-failure learning is deliberately picky. When a test newly fails and the
 * change contains a file the test is already linked to, that link explains the
 * failure, so only linked files are credited. Unlinked files are credited only
 * when nothing else explains the failure — which is exactly the hidden-coupling
 * case the history exists to catch. Without this, every unrelated commit that
 * happened to share a CI run with a regression would look guilty.
 */
export function updateHistory(
  h: History,
  index: RepoIndex,
  run: Run,
  change: ChangeSet,
  isInfra: boolean,
): void {
  if (isInfra) return;
  const newFailures: number[] = [];
  for (let t = 0; t < h.nTests; t++) {
    const s = run.statuses[t]!;
    if (s === Status.NotRun || s === Status.Skip) continue;
    h.executed[t]!++;
    h.ewFail[t] = (1 - ALPHA_TEST) * h.ewFail[t]! + (s === Status.Fail ? ALPHA_TEST : 0);
    h.ewFlake[t] = (1 - ALPHA_TEST) * h.ewFlake[t]! + (s === Status.Flaky ? ALPHA_TEST : 0);
    if (s === Status.Fail && h.lastStatus[t] !== Status.Fail) newFailures.push(t);
    h.lastStatus[t] = s;
  }
  const changed = [...change.files.keys()];
  const linked = (t: number, f: number) => index.dist[t]![f]! > 0 || index.cov[t]![f] === 1;
  for (const f of changed) {
    h.fileChanged[f]!++;
    h.fileBroke[f] = (1 - ALPHA_FILE) * h.fileBroke[f]! + (newFailures.length > 0 ? ALPHA_FILE : 0);
  }
  for (const t of newFailures) {
    const explained = changed.some((f) => linked(t, f));
    for (const f of changed) {
      if (explained && !linked(t, f)) continue;
      const key = f * h.nTests + t;
      h.coFail.set(key, (h.coFail.get(key) ?? 0) + 1);
    }
  }
}

export interface FeatureDef {
  key: string;
  label: string;
  help: string;
}

export const FEATURES: FeatureDef[] = [
  {
    key: 'target',
    label: 'Imports a changed file',
    help: 'The test file directly imports a file in the change.',
  },
  { key: 'coverage', label: 'Covers a changed file', help: 'Recorded coverage includes a changed file.' },
  {
    key: 'proximity',
    label: 'Graph proximity',
    help: 'Inverse import-graph distance from the test to the nearest changed file.',
  },
  { key: 'overlap', label: 'Change overlap', help: 'Share of the changed files that the test can reach.' },
  { key: 'churn', label: 'Churn in reach', help: 'Lines changed in files the test can reach (log scale).' },
  {
    key: 'cofail',
    label: 'Co-failure history',
    help: 'How often this test newly failed when one of these files changed before.',
  },
  {
    key: 'failRate',
    label: 'Recent failure rate',
    help: 'Exponentially weighted hard-failure rate of the test.',
  },
  {
    key: 'flakeRate',
    label: 'Recent flake rate',
    help: 'Exponentially weighted retry-pass rate of the test.',
  },
  {
    key: 'fileRisk',
    label: 'File break history',
    help: 'How often changes to these files came with new failures.',
  },
  { key: 'global', label: 'Global change', help: 'A manifest, build or CI configuration file changed.' },
  { key: 'e2e', label: 'End-to-end test', help: 'The test is an end-to-end test.' },
  { key: 'integration', label: 'Integration test', help: 'The test is an integration test.' },
];
export const N_FEATURES = FEATURES.length;

const LOG_500 = Math.log1p(500);

/** Write the feature vector of (`change`, `test`) into `out` at `offset`. */
export function writeFeatures(
  index: RepoIndex,
  history: History,
  change: ChangeSet,
  test: number,
  out: Float32Array,
  offset: number,
): void {
  const dist = index.dist[test]!;
  const cov = index.cov[test]!;
  let target = 0;
  let coverage = 0;
  let proximity = 0;
  let reached = 0;
  let churn = 0;
  let cofail = 0;
  let fileRisk = 0;
  for (const [f, lines] of change.files) {
    const d = dist[f]!;
    const linked = d > 0 || cov[f] === 1;
    if (d === 1) target = 1;
    if (cov[f] === 1) coverage = 1;
    if (d > 0) proximity = Math.max(proximity, 1 / d);
    else if (cov[f] === 1) proximity = Math.max(proximity, 0.5);
    const co = history.coFail.get(f * history.nTests + test);
    if (co !== undefined) cofail = Math.max(cofail, co / (history.fileChanged[f]! + 2));
    if (linked) {
      reached++;
      churn += lines;
      fileRisk = Math.max(fileRisk, history.fileBroke[f]!);
    }
  }
  const kind = index.dataset.tests[test]!.kind;
  out[offset] = target;
  out[offset + 1] = coverage;
  out[offset + 2] = proximity;
  out[offset + 3] = change.files.size > 0 ? reached / change.files.size : 0;
  out[offset + 4] = Math.min(1, Math.log1p(churn) / LOG_500);
  out[offset + 5] = cofail;
  out[offset + 6] = history.ewFail[test]!;
  out[offset + 7] = history.ewFlake[test]!;
  out[offset + 8] = fileRisk;
  out[offset + 9] = change.globalPath !== null ? 1 : 0;
  out[offset + 10] = kind === 'e2e' ? 1 : 0;
  out[offset + 11] = kind === 'integration' ? 1 : 0;
}
