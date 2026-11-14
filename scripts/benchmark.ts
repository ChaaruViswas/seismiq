/**
 * Score the engine on many independently simulated repositories and print the
 * mean, worst and best of every metric. `npm run benchmark [count]`.
 */
import { analyze } from '../src/engine/analyze';
import { simulate } from '../src/engine/simulator';

const count = Number(process.argv[2] ?? 30);
const rows: Record<string, number[]> = {};
const add = (k: string, v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return;
  rows[k] ??= [];
  rows[k].push(v);
};
const started = performance.now();
for (let seed = 1; seed <= count; seed++) {
  const a = analyze(simulate({ seed, endTime: Date.UTC(2026, 0, 1) }));
  const e = a.evaluation!;
  add('Flaky-test precision', e.flaky.precision);
  add('Flaky-test recall', e.flaky.recall);
  add('Flaky root cause accuracy', e.category.accuracy);
  add('Culprit commit ranked first', e.culprit.accuracy);
  add('…when the run built 2+ commits', e.culprit.ambiguousAccuracy);
  add('Selection safety (regressions caught)', e.selection.safety);
  add('Test time saved by selection', a.savings!.savedShare);
  add('Slowdown recall', e.slowdowns.recall);
  add('Infrastructure incidents found', e.infra.planted > 0 ? e.infra.found / e.infra.planted : 1);
  add('Held-out ROC AUC', a.model.auc);
  add('APFD, ordered by risk', a.model.apfdModel);
  add('APFD, default order', a.model.apfdBaseline);
  add('New failures in top 20% of tests', a.model.recallAtBudget.find((b) => b.budget === 0.2)?.model);
  add('Analysis time (ms)', a.elapsedMs);
}
const pct = (k: string) => !k.includes('APFD') && !k.includes('AUC') && !k.includes('ms');
const fmt = (k: string, v: number) =>
  k.includes('ms') ? v.toFixed(0) : pct(k) ? `${(v * 100).toFixed(1)}%` : v.toFixed(3);
console.log(`| Metric (${count} simulated repositories) | Mean | Worst | Best |`);
console.log('| --- | --- | --- | --- |');
for (const [k, vs] of Object.entries(rows)) {
  const mean = vs.reduce((s, v) => s + v, 0) / vs.length;
  const lowIsGood = k.includes('ms') || k.includes('default');
  const worst = lowIsGood ? Math.max(...vs) : Math.min(...vs);
  const best = lowIsGood ? Math.min(...vs) : Math.max(...vs);
  console.log(`| ${k} | ${fmt(k, mean)} | ${fmt(k, worst)} | ${fmt(k, best)} |`);
}
console.error(
  `\n${count} repositories simulated and analysed in ${((performance.now() - started) / 1000).toFixed(1)} s`,
);
