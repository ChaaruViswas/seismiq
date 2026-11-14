/**
 * Score the engine against what the simulator planted. This is the honest
 * part of the demo: the numbers shown in the UI are measured, not asserted.
 */
import { Reason } from './repo';
import type { Analysis, Evaluation } from './results';
import type { Dataset } from './types';

export function evaluate(dataset: Dataset, analysis: Analysis): Evaluation {
  const truth = dataset.truth!;
  const T = dataset.tests.length;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 1);

  // Flaky tests.
  const planted = new Map(truth.flaky.map((f) => [f.test, f]));
  const detected = analysis.tests.filter((s) => s.flakeEvents >= 3).map((s) => s.test);
  const truePositives = detected.filter((t) => planted.has(t));
  const detectedSet = new Set(detected);
  const missed = [...planted.keys()].filter((t) => !detectedSet.has(t));
  const categoryCorrect = truePositives.filter(
    (t) => analysis.tests[t]!.category === planted.get(t)!.category,
  ).length;

  // Culprit commits.
  let matched = 0;
  let ambiguous = 0;
  let top1 = 0;
  let ambiguousTop1 = 0;
  for (const reg of truth.regressions) {
    // An incident normally starts in the run that built the bad commit — or in the
    // next usable run when that one was lost to an infrastructure incident.
    const incident = analysis.incidents.find(
      (i) => i.startRun >= reg.run && i.startRun <= reg.run + 2 && i.tests.some((t) => reg.tests.includes(t)),
    );
    if (!incident) continue;
    matched++;
    const many = analysis.runCommits[incident.startRun]!.length > 1;
    const hit = incident.culprits[0]?.commit === reg.commit;
    if (many) ambiguous++;
    if (hit) {
      top1++;
      if (many) ambiguousTop1++;
    }
  }

  // Would change-aware selection have run the tests each regression broke?
  let regressionFailures = 0;
  let caught = 0;
  for (const reg of truth.regressions) {
    // Judge the first run that produced usable results for the bad commit.
    let run = reg.run;
    while (run < dataset.runs.length - 1 && analysis.infraRuns.includes(run)) run++;
    for (const t of reg.tests) {
      regressionFailures++;
      if (analysis.selection[run * T + t] !== Reason.None) caught++;
    }
  }

  // Slowdowns: right test, change point within a few runs.
  const slowHits = truth.slowdowns.filter((s) =>
    analysis.slowdowns.some((d) => d.test === s.test && Math.abs(d.run - s.run) <= 5),
  ).length;
  const slowFalse = analysis.slowdowns.filter((d) => !truth.slowdowns.some((s) => s.test === d.test)).length;

  const infraFound = truth.infraRuns.filter((r) => analysis.infraRuns.includes(r)).length;

  return {
    flaky: {
      planted: planted.size,
      detected: detected.length,
      truePositives: truePositives.length,
      precision: ratio(truePositives.length, detected.length),
      recall: ratio(truePositives.length, planted.size),
      missed,
    },
    category: {
      correct: categoryCorrect,
      total: truePositives.length,
      accuracy: ratio(categoryCorrect, truePositives.length),
    },
    culprit: {
      incidents: matched,
      ambiguous,
      top1,
      accuracy: ratio(top1, matched),
      ambiguousAccuracy: ratio(ambiguousTop1, ambiguous),
    },
    selection: { regressionFailures, caught, safety: ratio(caught, regressionFailures) },
    slowdowns: {
      planted: truth.slowdowns.length,
      found: slowHits,
      recall: ratio(slowHits, truth.slowdowns.length),
      falsePositives: slowFalse,
    },
    infra: {
      planted: truth.infraRuns.length,
      found: infraFound,
      falsePositives: analysis.infraRuns.length - infraFound,
    },
  };
}
