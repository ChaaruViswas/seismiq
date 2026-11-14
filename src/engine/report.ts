/** Markdown summary for CI job summaries and pull-request comments. */
import { fmtMs, fmtPct, plural } from './format';
import type { Analysis } from './results';
import { CATEGORY_LABEL, headline } from './text';
import { type Dataset, Status } from './types';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdownReport(dataset: Dataset, analysis: Analysis, limit = 10): string {
  const { health } = analysis;
  const testName = (t: number) => `${dataset.tests[t]!.suite} › ${dataset.tests[t]!.name}`;
  const out: string[] = [];
  out.push(`## Seismiq report — ${dataset.meta.name}`);
  out.push('');
  out.push(`${plural(dataset.runs.length, 'run')} · ${plural(dataset.tests.length, 'test')} analysed`);
  out.push('');
  out.push('| Metric | Value |');
  out.push('| --- | --- |');
  out.push(`| Runs that ended green | ${fmtPct(health.passRate)} |`);
  out.push(`| Green on the first attempt | ${fmtPct(health.firstTryRate)} |`);
  out.push(
    `| Red runs by cause | ${health.redByCause.regression} regression · ${health.redByCause.flaky} flaky · ${health.redByCause.infrastructure} infrastructure |`,
  );
  out.push(
    `| Time spent on retries | ${fmtMs(health.retryMs)} (${fmtPct(health.totalTestMs > 0 ? health.retryMs / health.totalTestMs : 0, 1)} of test time) |`,
  );
  if (health.mttrMs !== null) out.push(`| Median time to restore | ${fmtMs(health.mttrMs)} |`);
  if (analysis.savings) {
    out.push(
      `| Test time change-aware selection would save | ${fmtPct(analysis.savings.savedShare)} at ${fmtPct(analysis.savings.safety, 1)} safety |`,
    );
  }
  out.push('');

  const last = dataset.runs[dataset.runs.length - 1];
  if (last) {
    const failed: number[] = [];
    const flaky: number[] = [];
    last.statuses.forEach((s, t) => {
      if (s === Status.Fail) failed.push(t);
      else if (s === Status.Flaky) flaky.push(t);
    });
    out.push('### Latest run');
    out.push('');
    if (failed.length === 0 && flaky.length === 0) out.push('All tests passed on the first attempt.');
    else {
      if (failed.length > 0) out.push(`**${plural(failed.length, 'test')} failed**`);
      if (flaky.length > 0) out.push(`**${plural(flaky.length, 'test')} passed only after a retry**`);
      out.push('');
      const messages = new Map(
        dataset.failures.filter((f) => f.run === last.id).map((f) => [f.test, f.message]),
      );
      for (const t of [...failed, ...flaky].slice(0, limit)) {
        out.push(
          `- ${failed.includes(t) ? '❌' : '⚠️'} \`${testName(t)}\` — ${cell(headline(messages.get(t) ?? '', 110))}`,
        );
      }
      const more = failed.length + flaky.length - limit;
      if (more > 0) out.push(`- …and ${more} more`);
    }
    out.push('');
  }

  const open = analysis.incidents.filter((i) => i.endRun === null);
  if (open.length > 0) {
    out.push('### Open incidents');
    out.push('');
    for (const i of open) {
      const top = i.culprits[0];
      const suspect = top
        ? ` — prime suspect \`${dataset.commits[top.commit]!.sha.slice(0, 7)}\` (${fmtPct(top.probability)})`
        : '';
      out.push(
        `- ${plural(i.tests.length, 'test')} failing since run #${dataset.runs[i.startRun]!.number}${suspect}`,
      );
    }
    out.push('');
  }

  const flakyTests = analysis.tests
    .filter((s) => s.state === 'flaky')
    .sort((a, b) => b.flakeScore - a.flakeScore);
  out.push(`### Flaky tests (${flakyTests.length})`);
  out.push('');
  if (flakyTests.length === 0) out.push('No flaky tests detected.');
  else {
    out.push('| Test | Flake rate | Score | Likely cause |');
    out.push('| --- | --- | --- | --- |');
    for (const s of flakyTests.slice(0, limit)) {
      out.push(
        `| \`${cell(testName(s.test))}\` | ${fmtPct(s.flakeRate, 1)} | ${s.flakeScore} | ${s.category ? CATEGORY_LABEL[s.category] : '–'} |`,
      );
    }
  }
  out.push('');

  if (analysis.clusters.length > 0) {
    out.push('### Top failure clusters');
    out.push('');
    out.push('| Failure | Kind | Occurrences | Tests |');
    out.push('| --- | --- | --- | --- |');
    for (const c of analysis.clusters
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.min(limit, 5))) {
      out.push(`| ${cell(c.title)} | ${c.kind} | ${c.count} | ${c.tests.length} |`);
    }
    out.push('');
  }

  if (analysis.slowdowns.length > 0) {
    out.push('### Tests that got slower');
    out.push('');
    for (const d of analysis.slowdowns.slice(0, 5)) {
      out.push(
        `- \`${testName(d.test)}\`: ${fmtMs(d.beforeMs)} → ${fmtMs(d.afterMs)} (×${d.ratio.toFixed(1)}) since run #${dataset.runs[d.run]!.number}`,
      );
    }
    out.push('');
  }

  const slowest = analysis.tests
    .filter((s) => s.executed > 0)
    .sort((a, b) => b.p50Ms - a.p50Ms)
    .slice(0, 5);
  out.push('### Slowest tests');
  out.push('');
  for (const s of slowest) out.push(`- \`${testName(s.test)}\` — ${fmtMs(s.p50Ms)} median`);
  out.push('');
  return out.join('\n');
}
