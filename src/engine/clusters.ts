/** Failure clustering and infrastructure-incident detection. */
import type { ClusterKind, FailureCluster } from './results';
import { classifyMessage, clusterDocuments, headline, normalizeMessage } from './text';
import { type Dataset, Status } from './types';

/**
 * Drop stack frames that point into test files: the same root cause surfaces
 * in many tests, and their own file names should not split the cluster.
 */
function fingerprint(message: string): string {
  const lines = normalizeMessage(message).split('\n');
  const kept = lines.filter(
    (line, i) => i === 0 || !/^at .*(\.(test|spec)\.|__tests__|(^|\/)(tests?|e2e)\/)/.test(line),
  );
  return kept.join('\n');
}

export interface ClusterResult {
  clusters: FailureCluster[];
  clusterOf: Int32Array;
  /** 1 for runs judged to be infrastructure incidents. */
  infra: Uint8Array;
}

/**
 * A run is an infrastructure incident when a large share of the suite fails
 * with one and the same message *and* that message either looks like an
 * environment problem or mostly disappears on retry. A real regression can
 * also break many tests at once, but it fails every attempt.
 */
function detectInfraRuns(dataset: Dataset, prints: string[]): Uint8Array {
  const infra = new Uint8Array(dataset.runs.length);
  const byRun = new Map<number, number[]>();
  dataset.failures.forEach((f, i) => {
    const list = byRun.get(f.run);
    if (list) list.push(i);
    else byRun.set(f.run, [i]);
  });
  for (const [r, idxs] of byRun) {
    const run = dataset.runs[r]!;
    let executed = 0;
    for (let t = 0; t < run.statuses.length; t++) {
      const s = run.statuses[t];
      if (s !== Status.NotRun && s !== Status.Skip) executed++;
    }
    if (idxs.length < Math.max(8, 0.04 * executed)) continue;
    const counts = new Map<string, number[]>();
    for (const i of idxs) {
      const list = counts.get(prints[i]!);
      if (list) list.push(i);
      else counts.set(prints[i]!, [i]);
    }
    let top: number[] = [];
    for (const list of counts.values()) if (list.length > top.length) top = list;
    if (top.length < 0.5 * idxs.length) continue;
    const recovered = top.filter((i) => !dataset.failures[i]!.final).length / top.length;
    const looksInfra = classifyMessage(dataset.failures[top[0]!]!.message) === 'infrastructure';
    if (looksInfra || recovered >= 0.3) infra[r] = 1;
  }
  return infra;
}

export function buildClusters(dataset: Dataset): ClusterResult {
  const { failures } = dataset;
  const prints = failures.map((f) => fingerprint(f.message));
  const infra = detectInfraRuns(dataset, prints);
  const groups = clusterDocuments(prints, 0.62);
  const clusterOf = new Int32Array(failures.length).fill(-1);

  const clusters: FailureCluster[] = groups
    .map((g) => {
      const tests = new Set<number>();
      const runs = new Set<number>();
      let finalCount = 0;
      let infraCount = 0;
      for (const i of g.members) {
        const f = failures[i]!;
        tests.add(f.test);
        runs.add(f.run);
        if (f.final) finalCount++;
        if (infra[f.run]) infraCount++;
      }
      const sample = failures[g.leader]!.message;
      const category = classifyMessage(sample);
      const count = g.members.length;
      let kind: ClusterKind = finalCount / count >= 0.5 ? 'regression' : 'flaky';
      if (infraCount / count >= 0.5 || category === 'infrastructure') kind = 'infrastructure';
      const sortedRuns = [...runs].sort((a, b) => a - b);
      return {
        id: 0,
        title: headline(sample),
        sample,
        category: kind === 'infrastructure' ? ('infrastructure' as const) : category,
        kind,
        count,
        finalCount,
        tests: [...tests].sort((a, b) => a - b),
        runs: sortedRuns,
        firstRun: sortedRuns[0]!,
        lastRun: sortedRuns[sortedRuns.length - 1]!,
        members: g.members,
      };
    })
    .sort((a, b) => b.lastRun - a.lastRun || b.count - a.count)
    .map(({ members, ...cluster }, id) => {
      for (const i of members) clusterOf[i] = id;
      return { ...cluster, id };
    });

  return { clusters, clusterOf, infra };
}
