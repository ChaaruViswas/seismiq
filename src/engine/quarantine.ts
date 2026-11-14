/** What-if analysis: what would the pipeline have looked like with some tests quarantined? */
import type { Analysis } from './results';
import { type Dataset, Status } from './types';

export interface QuarantineResult {
  tests: number[];
  runs: number;
  /** Share of runs green on the first attempt, before and after. */
  firstTryBefore: number;
  firstTryAfter: number;
  /** Share of runs that ended green, before and after. */
  passBefore: number;
  passAfter: number;
  /** Red runs that would have been green. */
  runsUnblocked: number;
  /** Retry time that would not have been spent, ms. */
  retryMsSaved: number;
  /**
   * The cost: real incidents that only quarantined tests detected. Quarantine
   * trades signal for stability, and this is the signal given up.
   */
  blindIncidents: number[];
}

/**
 * Replay history with `quarantined` tests still running but no longer able to
 * fail the pipeline or trigger retries.
 */
export function simulateQuarantine(
  dataset: Dataset,
  analysis: Analysis,
  quarantined: ReadonlySet<number>,
): QuarantineResult {
  const n = dataset.runs.length;
  let greenBefore = 0;
  let greenAfter = 0;
  let passBefore = 0;
  let passAfter = 0;
  let runsUnblocked = 0;
  for (const run of dataset.runs) {
    let failed = 0;
    let flaky = 0;
    let failedAfter = 0;
    let flakyAfter = 0;
    for (let t = 0; t < run.statuses.length; t++) {
      const s = run.statuses[t];
      if (s === Status.Fail) {
        failed++;
        if (!quarantined.has(t)) failedAfter++;
      } else if (s === Status.Flaky) {
        flaky++;
        if (!quarantined.has(t)) flakyAfter++;
      }
    }
    if (failed === 0) passBefore++;
    if (failed === 0 && flaky === 0) greenBefore++;
    if (failedAfter === 0) passAfter++;
    if (failedAfter === 0 && flakyAfter === 0) greenAfter++;
    if (failed > 0 && failedAfter === 0) runsUnblocked++;
  }
  let retryMsSaved = 0;
  for (const t of quarantined) retryMsSaved += analysis.tests[t]?.retryMs ?? 0;
  const blindIncidents = analysis.incidents
    .filter((i) => i.tests.length > 0 && i.tests.every((t) => quarantined.has(t)))
    .map((i) => i.id);
  const share = (x: number) => (n > 0 ? x / n : 0);
  return {
    tests: [...quarantined].sort((a, b) => a - b),
    runs: n,
    firstTryBefore: share(greenBefore),
    firstTryAfter: share(greenAfter),
    passBefore: share(passBefore),
    passAfter: share(passAfter),
    runsUnblocked,
    retryMsSaved,
    blindIncidents,
  };
}

/** Tests worth quarantining: currently flaky, at or above the score threshold, worst first. */
export function quarantineCandidates(analysis: Analysis, minScore: number): number[] {
  return analysis.tests
    .filter((s) => s.state === 'flaky' && s.flakeScore >= minScore)
    .sort((a, b) => b.flakeScore - a.flakeScore || a.test - b.test)
    .map((s) => s.test);
}
