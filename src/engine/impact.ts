/**
 * Impact of one change: which tests to run, in what order, why, and how risky
 * the change is. Works both for a historical run (replayed from the analysis)
 * and for a brand-new change such as a pasted diff.
 */
import { runRisk } from './analyze';
import { N_FEATURES, writeFeatures } from './history';
import { contributions, heuristicScore, predict } from './model';
import { type ChangeSet, Reason, type ReasonCode, type RepoIndex, selectTests } from './repo';
import type { Analysis } from './results';
import { type Dataset, Status } from './types';

export interface ImpactedTest {
  test: number;
  reason: ReasonCode;
  /** Predicted probability of a new failure; 1 for tests already failing. */
  probability: number;
  failingOnBase: boolean;
  ms: number;
}

export interface ChangeImpact {
  change: ChangeSet;
  /** Selected tests in recommended execution order. */
  tests: ImpactedTest[];
  /** Tests that exist for this change (the denominator). */
  total: number;
  selectedMs: number;
  fullMs: number;
  risk: number;
  /** Feature rows for every test, `nTests × nFeatures`, for explanations. */
  features: Float32Array;
}

function order(tests: ImpactedTest[]): ImpactedTest[] {
  return tests.sort(
    (a, b) =>
      Number(b.failingOnBase) - Number(a.failingOnBase) || b.probability - a.probability || a.test - b.test,
  );
}

/** Impact of the change a historical run built, exactly as it was computed at the time. */
export function impactOfRun(dataset: Dataset, index: RepoIndex, analysis: Analysis, r: number): ChangeImpact {
  const T = analysis.nTests;
  const F = analysis.nFeatures;
  const run = dataset.runs[r]!;
  const tests: ImpactedTest[] = [];
  let total = 0;
  let selectedMs = 0;
  let fullMs = 0;
  for (let t = 0; t < T; t++) {
    const s = run.statuses[t];
    if (s === Status.NotRun || s === Status.Skip) continue;
    total++;
    const k = r * T + t;
    const ms = run.durations[t]!;
    fullMs += ms;
    const reason = analysis.selection[k] as ReasonCode;
    if (reason === Reason.None) continue;
    selectedMs += ms;
    tests.push({
      test: t,
      reason,
      probability: analysis.probs[k]!,
      failingOnBase: reason === Reason.Failing || analysis.probs[k] === 1,
      ms,
    });
  }
  return {
    change: index.changeSetOfCommits(analysis.runCommits[r]!),
    tests: order(tests),
    total,
    selectedMs,
    fullMs,
    risk: analysis.runs[r]!.risk,
    features: analysis.features.subarray(r * T * F, (r + 1) * T * F),
  };
}

/** Impact of a new change on top of the latest analysed state. */
export function impactOfChange(
  dataset: Dataset,
  index: RepoIndex,
  analysis: Analysis,
  change: ChangeSet,
): ChangeImpact {
  const T = analysis.nTests;
  const F = N_FEATURES;
  const { history, model } = analysis;
  const selection = selectTests(index, change, history);
  const features = new Float32Array(T * F);
  const tests: ImpactedTest[] = [];
  const last = dataset.runs[dataset.runs.length - 1];
  let total = 0;
  let selectedMs = 0;
  let fullMs = 0;
  let expected = 0;
  for (let t = 0; t < T; t++) {
    // Only tests that are part of the suite today.
    const s = last?.statuses[t];
    if (s === undefined || s === Status.NotRun || s === Status.Skip) continue;
    total++;
    const ms = analysis.tests[t]!.p50Ms;
    fullMs += ms;
    writeFeatures(index, history, change, t, features, t * F);
    const reason = selection[t] as ReasonCode;
    if (reason === Reason.None) continue;
    selectedMs += ms;
    const failingOnBase = history.lastStatus[t] === Status.Fail;
    const probability = failingOnBase
      ? 1
      : model.model
        ? predict(model.model, features, t * F)
        : heuristicScore(features, t * F);
    if (!failingOnBase) expected += probability;
    tests.push({ test: t, reason, probability, failingOnBase, ms });
  }
  return {
    change,
    tests: order(tests),
    total,
    selectedMs,
    fullMs,
    risk: runRisk(model.riskModel, expected, tests.length),
    features,
  };
}

export interface Explanation {
  feature: number;
  value: number;
  /** Signed contribution to the log-odds of failure. */
  contribution: number;
}

/** Per-feature contributions for one test, largest effect first. Empty without a trained model. */
export function explainTest(analysis: Analysis, features: Float32Array, test: number): Explanation[] {
  const model = analysis.model.model;
  if (!model) return [];
  const offset = test * analysis.nFeatures;
  return contributions(model, features, offset)
    .map((contribution, feature) => ({ feature, value: features[offset + feature]!, contribution }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

/** Named bands for a run-level risk, used for colour and copy. */
export function riskBand(risk: number): 'low' | 'moderate' | 'elevated' | 'high' {
  if (risk < 0.05) return 'low';
  if (risk < 0.12) return 'moderate';
  if (risk < 0.25) return 'elevated';
  return 'high';
}
