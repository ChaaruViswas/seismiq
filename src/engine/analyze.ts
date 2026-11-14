/**
 * The analysis pipeline. One chronological walk over the CI history builds
 * selection decisions and model features exactly as they would have been
 * available at the time; everything else is derived from that walk.
 */
import { buildClusters } from './clusters';
import { detectSlowdowns } from './durations';
import { evaluate } from './evaluate';
import { analyzeTests, buildIncidents, failureLookup } from './flaky';
import { createHistory, N_FEATURES, updateHistory, writeFeatures } from './history';
import { heuristicScore, type LogisticModel, predict, trainLogistic } from './model';
import { type ChangeSet, Reason, RepoIndex, selectTests } from './repo';
import type {
  Analysis,
  HealthReport,
  Hotspot,
  Incident,
  ModelReport,
  RedCause,
  RunStats,
  SavingsReport,
  WeekBucket,
} from './results';
import { Rng } from './rng';
import { apfd, auc, median, rocCurve } from './stats';
import { type Dataset, Status } from './types';

const NEGATIVE_SAMPLE_RATE = 0.2;
const BUDGETS = [0.05, 0.1, 0.2, 0.3, 0.5];
const WEEK = 7 * 86_400_000;

export function analyze(dataset: Dataset): Analysis {
  const started = performance.now();
  const index = new RepoIndex(dataset);
  const { runs, tests } = dataset;
  const R = runs.length;
  const T = tests.length;
  const F = N_FEATURES;
  const hasChangeData = dataset.files.length > 0 && dataset.commits.some((c) => c.changes.length > 0);

  const { clusters, clusterOf, infra } = buildClusters(dataset);

  // ---- chronological walk ---------------------------------------------------------
  const history = createHistory(dataset.files.length, T);
  const selection = new Uint8Array(R * T);
  const features = new Float32Array(R * T * F);
  const changes: ChangeSet[] = [];
  // A run lost to an infrastructure incident proves nothing about its commits,
  // so they are carried into the next run and judged there.
  const runCommits: number[][] = [];
  let carried: number[] = [];
  for (let r = 0; r < R; r++) {
    const run = runs[r]!;
    const commitList = carried.concat(run.commits);
    runCommits.push(commitList);
    carried = infra[r] ? commitList : [];
    const change = index.changeSetOfCommits(commitList);
    changes.push(change);
    selection.set(selectTests(index, change, history), r * T);
    for (let t = 0; t < T; t++) {
      const s = run.statuses[t];
      if (s === Status.NotRun || s === Status.Skip) continue;
      writeFeatures(index, history, change, t, features, (r * T + t) * F);
    }
    updateHistory(history, index, run, change, infra[r] === 1);
  }

  // ---- tests, incidents -------------------------------------------------------------
  const { stats, episodes } = analyzeTests(dataset, infra, selection, hasChangeData);
  const { incidents, blamedFile } = buildIncidents(dataset, index, episodes, clusterOf, runCommits);

  // (run, test) pairs that are part of a real failing streak, and those where one starts.
  const inEpisode = new Uint8Array(R * T);
  const startsEpisode = new Uint8Array(R * T);
  for (const e of episodes) {
    startsEpisode[e.startRun * T + e.test] = 1;
    const end = e.endRun ?? R;
    for (let r = e.startRun; r < end; r++) inEpisode[r * T + e.test] = 1;
  }

  // Was the test hard-failing going into run r? (Infrastructure incidents do not count.)
  const prevFail = new Uint8Array(R * T);
  {
    const failing = new Uint8Array(T);
    for (let r = 0; r < R; r++) {
      prevFail.set(failing, r * T);
      if (infra[r]) continue;
      for (let t = 0; t < T; t++) {
        const s = runs[r]!.statuses[t];
        if (s !== Status.NotRun && s !== Status.Skip) failing[t] = s === Status.Fail ? 1 : 0;
      }
    }
  }

  // ---- model -------------------------------------------------------------------------
  const { report: model, probs, risk } = buildModel(dataset, features, infra, prevFail, selection, R, T, F);

  // ---- per-run statistics --------------------------------------------------------------
  const lookup = failureLookup(dataset);
  const runStats: RunStats[] = [];
  for (let r = 0; r < R; r++) {
    const run = runs[r]!;
    let executed = 0;
    let failed = 0;
    let flaky = 0;
    let skipped = 0;
    let testMs = 0;
    let retryMs = 0;
    let selected = 0;
    let selectedMs = 0;
    let regression = false;
    const newFailures: number[] = [];
    const escaped: number[] = [];
    for (let t = 0; t < T; t++) {
      const s = run.statuses[t];
      if (s === Status.NotRun) continue;
      if (s === Status.Skip) {
        skipped++;
        continue;
      }
      const k = r * T + t;
      const d = run.durations[t]!;
      executed++;
      testMs += d;
      if (s !== Status.Pass) {
        const fi = lookup.get(k);
        const attempts = fi === undefined ? 1 : dataset.failures[fi]!.failedAttempts;
        if (s === Status.Fail) {
          failed++;
          retryMs += (d * (attempts - 1)) / attempts;
          if (inEpisode[k]) regression = true;
        } else {
          flaky++;
          retryMs += (d * attempts) / (attempts + 1);
        }
      }
      if (selection[k] !== Reason.None) {
        selected++;
        selectedMs += d;
      }
      if (startsEpisode[k]) {
        newFailures.push(t);
        if (selection[k] === Reason.None) escaped.push(t);
      }
    }
    const outcome = failed > 0 ? 'red' : flaky > 0 ? 'flaky' : 'green';
    const cause: RedCause | null =
      outcome !== 'red' ? null : infra[r] ? 'infrastructure' : regression ? 'regression' : 'flaky';
    runStats.push({
      run: r,
      outcome,
      cause,
      executed,
      failed,
      flaky,
      skipped,
      testMs,
      retryMs,
      selected,
      selectedMs,
      newFailures,
      escaped,
      risk: risk[r]!,
    });
  }

  const health = buildHealth(dataset, runStats, incidents, changes);
  const savings = hasChangeData ? buildSavings(runStats, changes) : null;
  const slowdowns = detectSlowdowns(dataset, index, infra);
  const hotspots = hasChangeData ? buildHotspots(dataset, index, blamedFile) : [];

  const analysis: Analysis = {
    nRuns: R,
    nTests: T,
    nFeatures: F,
    hasChangeData,
    infraRuns: Array.from(infra.keys()).filter((r) => infra[r] === 1),
    runCommits,
    selection,
    features,
    probs,
    history,
    tests: stats,
    clusters,
    clusterOf,
    incidents,
    runs: runStats,
    model,
    health,
    savings,
    slowdowns,
    hotspots,
    evaluation: null,
    elapsedMs: 0,
  };
  if (dataset.truth) analysis.evaluation = evaluate(dataset, analysis);
  analysis.elapsedMs = performance.now() - started;
  return analysis;
}

/**
 * Turn the per-test probabilities of a change into one number: the chance
 * that it breaks at least one passing test. Failures are strongly correlated
 * (one bug breaks many tests), so multiplying probabilities as if they were
 * independent overshoots badly; instead the expected number of new failures
 * is passed through a one-feature logistic model fitted on past runs.
 */
export function runRisk(riskModel: LogisticModel | null, expectedFailures: number, selected: number): number {
  if (selected === 0) return 0;
  if (riskModel) return predict(riskModel, [Math.log1p(expectedFailures)]);
  return 1 - Math.exp(-expectedFailures);
}

/**
 * Train on the first 70% of runs, score on the last 30%. The split is by time,
 * never random: shuffling would let the model learn from the future.
 *
 * The target is a *new* failure — a test that was passing and hard-fails on
 * this run. Tests already failing need no prediction: they always run first.
 */
function buildModel(
  dataset: Dataset,
  features: Float32Array,
  infra: Uint8Array,
  prevFail: Uint8Array,
  selection: Uint8Array,
  R: number,
  T: number,
  F: number,
): { report: ModelReport; probs: Float32Array; risk: Float32Array } {
  const { runs } = dataset;
  const warmup = Math.min(20, Math.floor(R * 0.1));
  const split = Math.floor(R * 0.7);
  const executedAt = (r: number, t: number) => {
    const s = runs[r]!.statuses[t];
    return s !== Status.NotRun && s !== Status.Skip;
  };
  const isNewFailure = (r: number, t: number) => runs[r]!.statuses[t] === Status.Fail && !prevFail[r * T + t];

  let model: LogisticModel | null = null;
  let trainRows = 0;
  let trainPositives = 0;
  if (R >= 30) {
    const rng = new Rng(7919);
    const rowIdx: number[] = [];
    const rowWeight: number[] = [];
    for (let r = warmup; r < split; r++) {
      if (infra[r]) continue;
      for (let t = 0; t < T; t++) {
        if (!executedAt(r, t) || prevFail[r * T + t]) continue;
        if (isNewFailure(r, t)) {
          rowIdx.push(r * T + t);
          rowWeight.push(1);
          trainPositives++;
        } else if (rng.chance(NEGATIVE_SAMPLE_RATE)) {
          rowIdx.push(r * T + t);
          rowWeight.push(1 / NEGATIVE_SAMPLE_RATE);
        }
      }
    }
    trainRows = rowIdx.length;
    if (trainPositives >= 5) {
      const X = new Float32Array(trainRows * F);
      const y = new Uint8Array(trainRows);
      rowIdx.forEach((k, i) => {
        X.set(features.subarray(k * F, (k + 1) * F), i * F);
        y[i] = isNewFailure(Math.floor(k / T), k % T) ? 1 : 0;
      });
      model = trainLogistic(X, y, Float32Array.from(rowWeight), F, 1);
    }
  }

  // Per-test probabilities, and per-run expected number of new failures among selected tests.
  const probs = new Float32Array(R * T);
  const expected = new Float64Array(R);
  const selectedCount = new Int32Array(R);
  const hasNew = new Uint8Array(R);
  for (let r = 0; r < R; r++) {
    for (let t = 0; t < T; t++) {
      if (!executedAt(r, t)) continue;
      const k = r * T + t;
      if (selection[k] !== Reason.None) selectedCount[r]!++;
      if (prevFail[k]) {
        probs[k] = 1;
        continue;
      }
      probs[k] = model ? predict(model, features, k * F) : heuristicScore(features, k * F);
      if (selection[k] !== Reason.None) expected[r]! += probs[k]!;
      if (isNewFailure(r, t)) hasNew[r] = 1;
    }
  }

  let riskModel: LogisticModel | null = null;
  if (model) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let r = warmup; r < split; r++) {
      if (infra[r] || selectedCount[r] === 0) continue;
      xs.push(Math.log1p(expected[r]!));
      ys.push(hasNew[r]!);
    }
    if (ys.reduce((a, b) => a + b, 0) >= 3) {
      riskModel = trainLogistic(Float32Array.from(xs), Uint8Array.from(ys), null, 1, 0.01);
    }
  }
  const risk = new Float32Array(R);
  for (let r = 0; r < R; r++) risk[r] = runRisk(riskModel, expected[r]!, selectedCount[r]!);

  // ---- held-out evaluation ------------------------------------------------------------
  const scores: number[] = [];
  const labels: number[] = [];
  const found = BUDGETS.map(() => 0);
  const foundBaseline = BUDGETS.map(() => 0);
  let totalNew = 0;
  const apfdModel: number[] = [];
  const apfdBaseline: number[] = [];
  const ttffModel: number[] = [];
  const ttffBaseline: number[] = [];
  const buckets = [
    { label: 'under 5%', max: 0.05 },
    { label: '5–15%', max: 0.15 },
    { label: '15–40%', max: 0.4 },
    { label: 'over 40%', max: 1.01 },
  ].map((b) => ({ ...b, predicted: 0, observed: 0, runs: 0 }));

  for (let r = split; r < R && model; r++) {
    if (infra[r]) continue;
    const run = runs[r]!;
    const candidates: number[] = [];
    const failing = new Set<number>();
    for (let t = 0; t < T; t++) {
      const k = r * T + t;
      if (!executedAt(r, t) || prevFail[k]) continue;
      candidates.push(t);
      scores.push(probs[k]!);
      labels.push(isNewFailure(r, t) ? 1 : 0);
      if (isNewFailure(r, t)) failing.add(t);
    }
    const bucket = buckets.find((b) => risk[r]! < b.max)!;
    bucket.predicted += risk[r]!;
    bucket.observed += failing.size > 0 ? 1 : 0;
    bucket.runs++;
    if (failing.size === 0) continue;

    const byModel = candidates.slice().sort((a, b) => probs[r * T + b]! - probs[r * T + a]! || a - b);
    apfdModel.push(apfd(byModel, failing));
    apfdBaseline.push(apfd(candidates, failing));
    totalNew += failing.size;
    BUDGETS.forEach((budget, i) => {
      const top = Math.ceil(budget * candidates.length);
      for (let j = 0; j < top; j++) {
        if (failing.has(byModel[j]!)) found[i]!++;
        if (failing.has(candidates[j]!)) foundBaseline[i]!++;
      }
    });
    const timeToFirst = (order: number[]) => {
      let ms = 0;
      for (const t of order) {
        ms += run.durations[t]!;
        if (failing.has(t)) break;
      }
      return ms / 1000;
    };
    ttffModel.push(timeToFirst(byModel));
    ttffBaseline.push(timeToFirst(candidates));
  }

  const finite = (x: number): number | null => (Number.isFinite(x) ? x : null);
  const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
  const report: ModelReport = {
    model,
    riskModel,
    trainRuns: [warmup, split],
    testRuns: [split, R],
    trainRows,
    trainPositives,
    testRows: scores.length,
    testPositives: labels.reduce((a, b) => a + b, 0),
    auc: scores.length > 0 ? finite(auc(scores, labels)) : null,
    roc: rocCurve(scores, labels),
    recallAtBudget: BUDGETS.map((budget, i) => ({
      budget,
      model: totalNew > 0 ? found[i]! / totalNew : 0,
      baseline: totalNew > 0 ? foundBaseline[i]! / totalNew : 0,
    })),
    apfdModel: finite(avg(apfdModel)),
    apfdBaseline: finite(avg(apfdBaseline)),
    failingRuns: apfdModel.length,
    ttffModelSec: ttffModel.length > 0 ? median(ttffModel) : null,
    ttffBaselineSec: ttffBaseline.length > 0 ? median(ttffBaseline) : null,
    calibration: buckets
      .filter((b) => b.runs > 0)
      .map((b) => ({
        label: b.label,
        predicted: b.predicted / b.runs,
        observed: b.observed / b.runs,
        runs: b.runs,
      })),
  };
  return { report, probs, risk };
}

function buildHealth(
  dataset: Dataset,
  runStats: RunStats[],
  incidents: Incident[],
  changes: ChangeSet[],
): HealthReport {
  const n = runStats.length;
  const redByCause: Record<RedCause, number> = { regression: 0, flaky: 0, infrastructure: 0 };
  let green = 0;
  let flakyGreen = 0;
  let red = 0;
  let totalTestMs = 0;
  let retryMs = 0;
  let wall = 0;
  const weeks = new Map<number, WeekBucket>();
  // Weeks start on Monday (1970-01-01 was a Thursday, hence the 3-day shift).
  const weekOf = (ts: number) => Math.floor((ts - 4 * 86_400_000) / WEEK) * WEEK + 4 * 86_400_000;
  for (const rs of runStats) {
    const run = dataset.runs[rs.run]!;
    if (rs.outcome === 'green') green++;
    else if (rs.outcome === 'flaky') flakyGreen++;
    else {
      red++;
      redByCause[rs.cause!]++;
    }
    totalTestMs += rs.testMs;
    retryMs += rs.retryMs;
    wall += run.wallSec;
    const start = weekOf(run.timestamp);
    let w = weeks.get(start);
    if (!w) {
      w = { start, runs: 0, green: 0, flaky: 0, red: 0, avgWallSec: 0, retryMs: 0 };
      weeks.set(start, w);
    }
    w.runs++;
    w[rs.outcome]++;
    w.avgWallSec += run.wallSec;
    w.retryMs += rs.retryMs;
  }
  const weekList = [...weeks.values()].sort((a, b) => a.start - b.start);
  for (const w of weekList) w.avgWallSec /= w.runs;

  const closed = incidents.filter((i) => i.ttrMs !== null).map((i) => i.ttrMs!);
  const codeRuns = changes.filter((c) => c.files.size > 0 || c.globalPath !== null).length;
  return {
    runs: n,
    green,
    flakyGreen,
    red,
    redByCause,
    passRate: n > 0 ? (green + flakyGreen) / n : 0,
    firstTryRate: n > 0 ? green / n : 0,
    trustRate: n > 0 ? (green + redByCause.regression) / n : 0,
    incidents: incidents.length,
    openIncidents: incidents.filter((i) => i.endRun === null).length,
    mttrMs: closed.length > 0 ? median(closed) : null,
    changeFailureRate: incidents.length / Math.max(1, codeRuns > 0 ? codeRuns : n),
    totalTestMs,
    retryMs,
    avgWallSec: n > 0 ? wall / n : 0,
    weeks: weekList,
  };
}

function buildSavings(runStats: RunStats[], changes: ChangeSet[]): SavingsReport {
  let fullMs = 0;
  let selectedMs = 0;
  let fullRuns = 0;
  let docsOnlyRuns = 0;
  let newFailures = 0;
  let escapes = 0;
  const shares: number[] = [];
  runStats.forEach((rs, r) => {
    fullMs += rs.testMs;
    selectedMs += rs.selectedMs;
    if (rs.executed > 0) shares.push(rs.selected / rs.executed);
    if (changes[r]!.globalPath !== null) fullRuns++;
    else if (changes[r]!.docsOnly) docsOnlyRuns++;
    newFailures += rs.newFailures.length;
    escapes += rs.escaped.length;
  });
  return {
    runs: runStats.length,
    fullMs,
    selectedMs,
    savedShare: fullMs > 0 ? 1 - selectedMs / fullMs : 0,
    medianSelectedShare: median(shares),
    fullRuns,
    docsOnlyRuns,
    newFailures,
    escapes,
    safety: newFailures > 0 ? 1 - escapes / newFailures : 1,
  };
}

/** Files ranked by how much risk they concentrate: churn, blamed incidents, and blast radius. */
function buildHotspots(dataset: Dataset, index: RepoIndex, blamedFile: (number | null)[]): Hotspot[] {
  const nFiles = dataset.files.length;
  const changes = new Int32Array(nFiles);
  const churn = new Int32Array(nFiles);
  const blamed = new Int32Array(nFiles);
  for (const c of dataset.commits) {
    for (const ch of c.changes) {
      changes[ch.file]!++;
      churn[ch.file]! += ch.added + ch.deleted;
    }
  }
  for (const f of blamedFile) if (f !== null) blamed[f]!++;
  const reach = new Int32Array(nFiles);
  for (let t = 0; t < index.nTests; t++) {
    for (let f = 0; f < nFiles; f++) if (index.dist[t]![f]! > 0 || index.cov[t]![f] === 1) reach[f]!++;
  }
  const dependents = dataset.files.map((f) => index.dependents(f.id).length);
  const maxChanges = Math.max(1, ...changes);
  const maxBlamed = Math.max(1, ...blamed);
  const maxDependents = Math.max(1, ...dependents);
  return dataset.files
    .map((f) => ({
      file: f.id,
      changes: changes[f.id]!,
      churn: churn[f.id]!,
      incidents: blamed[f.id]!,
      dependents: dependents[f.id]!,
      tests: reach[f.id]!,
      score: Math.round(
        100 *
          (0.4 * (changes[f.id]! / maxChanges) +
            0.4 * (blamed[f.id]! / maxBlamed) +
            0.2 * (dependents[f.id]! / maxDependents)),
      ),
    }))
    .filter((h) => h.changes > 0)
    .sort((a, b) => b.score - a.score || a.file - b.file);
}
