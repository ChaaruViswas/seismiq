/**
 * Per-test reliability statistics, flaky-test detection, and grouping of real
 * failures into incidents with a ranked list of culprit commits.
 */
import { Reason, type RepoIndex } from './repo';
import type { CulpritCandidate, Incident, TestState, TestStats } from './results';
import { quantile, wilson } from './stats';
import { classifyMessage } from './text';
import { type Dataset, type FlakeCategory, Status, type StatusCode } from './types';

export interface Episode {
  test: number;
  startRun: number;
  /** First run where the test passed again; null if still failing. */
  endRun: number | null;
}

const RECENT_WINDOW = 60;

/** Index of the failure record for (run, test), or undefined. */
export function failureLookup(dataset: Dataset): Map<number, number> {
  const nTests = dataset.tests.length;
  const map = new Map<number, number>();
  dataset.failures.forEach((f, i) => {
    map.set(f.run * nTests + f.test, i);
  });
  return map;
}

export function analyzeTests(
  dataset: Dataset,
  infra: Uint8Array,
  selection: Uint8Array,
  hasChangeData: boolean,
): { stats: TestStats[]; episodes: Episode[] } {
  const { runs, tests } = dataset;
  const nTests = tests.length;
  const lookup = failureLookup(dataset);
  const stats: TestStats[] = [];
  const episodes: Episode[] = [];

  for (let t = 0; t < nTests; t++) {
    // Executed, non-incident runs in order.
    const seqRun: number[] = [];
    const seqStatus: number[] = [];
    let skips = 0;
    let latest: StatusCode = Status.NotRun;
    for (let r = 0; r < runs.length; r++) {
      const s = runs[r]!.statuses[t] as StatusCode;
      if (s === Status.NotRun) continue;
      latest = s;
      if (s === Status.Skip) {
        skips++;
        continue;
      }
      if (infra[r]) continue;
      seqRun.push(r);
      seqStatus.push(s);
    }
    const n = seqRun.length;

    let passes = 0;
    let fails = 0;
    let flakyPasses = 0;
    for (const s of seqStatus) {
      if (s === Status.Pass) passes++;
      else if (s === Status.Fail) fails++;
      else flakyPasses++;
    }

    // Maximal streaks of hard failures.
    const streaks: { from: number; to: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (seqStatus[i] !== Status.Fail) continue;
      let j = i;
      while (j + 1 < n && seqStatus[j + 1] === Status.Fail) j++;
      streaks.push({ from: i, to: j });
      i = j;
    }
    const flips = streaks.filter((s) => s.from === s.to && s.to < n - 1).length;

    const eventIdx: number[] = [];
    for (let i = 0; i < n; i++) if (seqStatus[i] === Status.Flaky) eventIdx.push(i);
    let failingSince = -1;
    for (const s of streaks) {
      const recovered = s.to < n - 1;
      const unrelated = hasChangeData && selection[seqRun[s.from]! * nTests + t] === Reason.None;
      // A one-run failure that fixed itself, with nothing in the change to explain it
      // (or on a test already known to pass on retry), is noise rather than a regression.
      const blip =
        s.from === s.to && recovered && (unrelated || flakyPasses >= 2 || (!hasChangeData && flips >= 3));
      if (blip) {
        eventIdx.push(s.from);
        continue;
      }
      episodes.push({ test: t, startRun: seqRun[s.from]!, endRun: recovered ? seqRun[s.to + 1]! : null });
      if (!recovered) failingSince = seqRun[s.from]!;
    }
    eventIdx.sort((a, b) => a - b);

    const events = eventIdx.length;
    const flakeRate = n > 0 ? events / n : 0;
    const ci = wilson(events, n);
    const recentStart = Math.max(0, n - RECENT_WINDOW);
    const recentEvents = eventIdx.filter((i) => i >= recentStart).length;
    const recentFlakeRate = n > recentStart ? recentEvents / (n - recentStart) : 0;
    const blended = 0.6 * recentFlakeRate + 0.4 * flakeRate;
    const flakeScore = events === 0 ? 0 : Math.round(100 * (1 - Math.exp(-12 * blended)));

    const firstIdx = events > 0 ? eventIdx[0]! : -1;
    const lastIdx = events > 0 ? eventIdx[events - 1]! : -1;
    const quietRuns = events > 0 ? n - 1 - lastIdx : n;
    const activeRate = events > 1 ? events / (lastIdx - firstIdx + 1) : flakeRate;
    const quietChance = events > 0 ? (1 - Math.min(0.99, activeRate)) ** quietRuns : 1;

    // Dominant root-cause family across this test's flake events.
    let category: FlakeCategory | null = null;
    if (events > 0) {
      const votes = new Map<FlakeCategory, number>();
      for (const i of eventIdx) {
        const fi = lookup.get(seqRun[i]! * nTests + t);
        if (fi === undefined) continue;
        const c = classifyMessage(dataset.failures[fi]!.message);
        votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      let best = 0;
      for (const [c, v] of votes) {
        if (v > best) {
          best = v;
          category = c;
        }
      }
    }

    let state: TestState;
    if (latest === Status.Skip) state = 'skipped';
    else if (failingSince >= 0) state = 'failing';
    else if (events >= 3) state = quietRuns >= 30 && quietChance < 0.02 ? 'stabilized' : 'flaky';
    else if (events === 2) state = 'suspect';
    else if (n < 10) state = 'new';
    else state = 'healthy';

    const passMs: number[] = [];
    let retryMs = 0;
    for (let i = 0; i < n; i++) {
      const r = seqRun[i]!;
      const d = runs[r]!.durations[t]!;
      if (seqStatus[i] === Status.Pass) passMs.push(d);
      else if (seqStatus[i] === Status.Flaky) {
        const fi = lookup.get(r * nTests + t);
        const failed = fi === undefined ? 1 : dataset.failures[fi]!.failedAttempts;
        retryMs += (d * failed) / (failed + 1);
      }
    }

    stats.push({
      test: t,
      executed: n,
      passes,
      fails,
      flakyPasses,
      skips,
      flakeEvents: events,
      flakeRate,
      flakeLower: ci.lower,
      flakeUpper: ci.upper,
      recentFlakeRate,
      flakeScore,
      state,
      category,
      firstFlakeRun: firstIdx >= 0 ? seqRun[firstIdx]! : -1,
      lastFlakeRun: lastIdx >= 0 ? seqRun[lastIdx]! : -1,
      quietRuns,
      quietChance,
      failingSince,
      lastStatus: n > 0 ? (seqStatus[n - 1] as StatusCode) : latest,
      p50Ms: quantile(passMs, 0.5),
      p95Ms: quantile(passMs, 0.95),
      retryMs,
    });
  }
  return { stats, episodes };
}

/** How strongly a changed file is linked to a test: direct import > coverage > graph distance. */
function linkWeight(index: RepoIndex, test: number, file: number): number {
  const d = index.dist[test]![file]!;
  if (d === 1) return 1;
  if (index.cov[test]![file]) return 0.7;
  if (d > 1) return 0.5 / (d - 1);
  return 0;
}

/**
 * Rank the commits judged by the run where an incident started by how well each one
 * explains the failing tests. Evidence, strongest first: the commit's files
 * are named in the stack traces; the failing tests import them; cover them;
 * reach them through the import graph.
 */
export function rankCulprits(
  dataset: Dataset,
  index: RepoIndex,
  run: number,
  candidates: readonly number[],
  failing: readonly number[],
  lookup: Map<number, number>,
): { culprits: CulpritCandidate[]; fileScores: Map<number, number> } {
  const nTests = dataset.tests.length;
  const fileScores = new Map<number, number>();
  const scored = candidates.map((ci) => {
    const commit = dataset.commits[ci]!;
    let score = 0;
    let named = 0;
    let direct = 0;
    let linked = 0;
    const perFile = new Map<number, number>();
    for (const t of failing) {
      const fi = lookup.get(run * nTests + t);
      const message = fi === undefined ? '' : dataset.failures[fi]!.message;
      let best = 0;
      let bestFile = -1;
      let mention = false;
      for (const ch of commit.changes) {
        let w = linkWeight(index, t, ch.file);
        if (message.includes(dataset.files[ch.file]!.path)) {
          mention = true;
          w += 2;
        }
        if (w > best) {
          best = w;
          bestFile = ch.file;
        }
      }
      if (best > 0) {
        linked++;
        if (best >= 1 && !mention) direct++;
        if (mention) named++;
        score += best;
        perFile.set(bestFile, (perFile.get(bestFile) ?? 0) + best);
      }
    }
    const evidence: string[] = [];
    if (named > 0) evidence.push(`Its files appear in ${named} failing stack trace${named === 1 ? '' : 's'}`);
    if (direct > 0)
      evidence.push(`${direct} failing test${direct === 1 ? '' : 's'} import its files directly`);
    if (linked > 0) evidence.push(`Linked to ${linked} of ${failing.length} failing tests`);
    if (commit.changes.length === 0 && commit.otherPaths.length > 0) {
      const isGlobal = index.changeSetOfCommits([ci]).globalPath !== null;
      if (isGlobal) {
        score = 0.1 * failing.length;
        evidence.push('Changes build or dependency configuration, which can affect any test');
      } else evidence.push('Touches no code that tests can reach');
    } else if (linked === 0) evidence.push('No link between its files and the failing tests');
    const lines = commit.changes.reduce((s, c) => s + c.added + c.deleted, 0);
    score *= 1 + 0.1 * Math.min(1, Math.log1p(lines) / Math.log(500));
    return { commit: ci, score, evidence, perFile };
  });

  const total = scored.reduce((s, c) => s + c.score, 0);
  const culprits = scored
    .map((c) => ({
      commit: c.commit,
      score: c.score,
      probability: total > 0 ? c.score / total : 1 / Math.max(1, scored.length),
      evidence: c.evidence,
    }))
    .sort((a, b) => b.score - a.score || a.commit - b.commit);
  const top = scored.find((c) => c.commit === culprits[0]?.commit);
  if (top && total > 0) for (const [f, s] of top.perFile) fileScores.set(f, s);
  return { culprits, fileScores };
}

export function buildIncidents(
  dataset: Dataset,
  index: RepoIndex,
  episodes: readonly Episode[],
  clusterOf: Int32Array,
  runCommits: readonly number[][],
): { incidents: Incident[]; blamedFile: (number | null)[] } {
  const nTests = dataset.tests.length;
  const lookup = failureLookup(dataset);
  const byStart = new Map<number, Episode[]>();
  for (const e of episodes) {
    const list = byStart.get(e.startRun);
    if (list) list.push(e);
    else byStart.set(e.startRun, [e]);
  }
  const incidents: Incident[] = [];
  const blamedFile: (number | null)[] = [];
  for (const startRun of [...byStart.keys()].sort((a, b) => a - b)) {
    const group = byStart.get(startRun)!;
    const tests = group.map((e) => e.test).sort((a, b) => a - b);
    const open = group.some((e) => e.endRun === null);
    const endRun = open ? null : Math.max(...group.map((e) => e.endRun!));
    const clusters = new Set<number>();
    for (const t of tests) {
      const fi = lookup.get(startRun * nTests + t);
      if (fi !== undefined && clusterOf[fi]! >= 0) clusters.add(clusterOf[fi]!);
    }
    const { culprits, fileScores } = rankCulprits(
      dataset,
      index,
      startRun,
      runCommits[startRun]!,
      tests,
      lookup,
    );

    let fixCommit: number | null = null;
    if (endRun !== null && culprits.length > 0) {
      const suspectFiles = new Set(dataset.commits[culprits[0]!.commit]!.changes.map((c) => c.file));
      let bestOverlap = 0;
      for (const ci of dataset.runs[endRun]!.commits) {
        const overlap = dataset.commits[ci]!.changes.filter((c) => suspectFiles.has(c.file)).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          fixCommit = ci;
        }
      }
    }
    let blamed: number | null = null;
    let bestScore = 0;
    for (const [f, s] of fileScores) {
      if (s > bestScore) {
        bestScore = s;
        blamed = f;
      }
    }
    blamedFile.push(blamed);
    incidents.push({
      id: incidents.length,
      startRun,
      endRun,
      tests,
      clusters: [...clusters].sort((a, b) => a - b),
      culprits,
      fixCommit,
      ttrMs: endRun === null ? null : dataset.runs[endRun]!.timestamp - dataset.runs[startRun]!.timestamp,
    });
  }
  return { incidents, blamedFile };
}
