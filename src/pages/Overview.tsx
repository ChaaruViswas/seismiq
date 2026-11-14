import { ArrowRight, Flame, Info, Timer, Waves } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { BarList, Legend, Seismograph, StackedColumns, type Tremor } from '../components/charts';
import { commitSubject, testTitle } from '../components/common';
import { Card, CardHeader, Meter, PageHeader, Stat } from '../components/ui';
import { fmtDate, fmtDateTime, fmtMs, fmtPct, plural } from '../engine/format';
import { useProject } from '../store';

export function Overview() {
  const { dataset, analysis } = useProject();
  const navigate = useNavigate();
  const { health, savings, evaluation } = analysis;
  const isDemo = dataset.meta.source === 'demo';

  const tremors = useMemo<Tremor[]>(
    () =>
      analysis.runs.map((rs) => {
        const run = dataset.runs[rs.run]!;
        const first = run.commits.length > 0 ? dataset.commits[run.commits[0]!] : undefined;
        return {
          failed: rs.failed,
          flaky: rs.flaky,
          label: `Run #${run.number} · ${fmtDateTime(run.timestamp)}`,
          detail: first ? commitSubject(first) : `${rs.executed} tests`,
        };
      }),
    [analysis, dataset],
  );

  const weeks = useMemo(
    () =>
      health.weeks.map((w) => ({
        label: fmtDate(w.start),
        values: { green: w.green, flaky: w.flaky, red: w.red },
      })),
    [health],
  );

  const flakyTests = useMemo(
    () => analysis.tests.filter((s) => s.state === 'flaky').sort((a, b) => b.flakeScore - a.flakeScore),
    [analysis],
  );
  const openIncidents = analysis.incidents.filter((i) => i.endRun === null);
  const disturbed = health.flakyGreen + health.redByCause.flaky + health.redByCause.infrastructure;

  return (
    <>
      <PageHeader
        title="Overview"
        lead={
          <>
            {plural(dataset.runs.length, 'CI run')} and {plural(dataset.tests.length, 'test')}
            {dataset.runs.length > 0 && (
              <>
                {' '}
                from {fmtDate(dataset.runs[0]!.timestamp)} to{' '}
                {fmtDate(dataset.runs[dataset.runs.length - 1]!.timestamp)}
              </>
            )}
            .
          </>
        }
      />

      {isDemo && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0 text-s1" aria-hidden />
          <p>
            You are looking at a <strong className="font-medium text-ink">simulated repository</strong> with
            regressions, flaky tests, outages and slowdowns planted at known places — so the engine&apos;s
            findings can be scored against the truth. Nothing here is hard-coded: every number is computed in
            your browser.{' '}
            <Link to="/import" className="font-medium text-accent-ink underline underline-offset-2">
              Analyse your own JUnit reports
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Runs that ended green"
          value={fmtPct(health.passRate)}
          hint={`${health.red} of ${health.runs} runs failed`}
          help="Share of runs with no failing test after retries."
        />
        <Stat
          label="Green on first attempt"
          value={fmtPct(health.firstTryRate)}
          hint={`${plural(health.flakyGreen, 'run')} needed a retry`}
          tone={health.flakyGreen > 0 ? 'warn' : undefined}
          help="Share of runs where every test passed without any retry. The gap to the first tile is what flakiness costs."
        />
        <Stat
          label="Flaky tests"
          value={flakyTests.length}
          hint={`${fmtMs(health.retryMs)} spent on retries`}
          help="Tests that failed and passed on the same code at least three times and are still doing it."
        />
        <Stat
          label="Median time to restore"
          value={health.mttrMs === null ? '–' : fmtMs(health.mttrMs)}
          hint={`${plural(health.incidents, 'incident')}, ${health.openIncidents} open`}
          tone={health.openIncidents > 0 ? 'crit' : undefined}
          help="From the run that introduced a regression to the first run where every affected test passes again."
        />
        {savings ? (
          <Stat
            label="Test time saved"
            value={fmtPct(savings.savedShare)}
            hint={`${fmtPct(savings.safety, 1)} of regressions still caught`}
            help="Replay of history: running only the tests each change can affect, instead of the full suite."
          />
        ) : (
          <Stat
            label="Failure clusters"
            value={analysis.clusters.length}
            hint={`${plural(dataset.failures.length, 'failure')} grouped`}
          />
        )}
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Pipeline seismograph"
          subtitle="Every run, oldest to newest. A quiet line is a calm pipeline. Select a run to see what changed."
          action={
            <Legend
              items={[
                { label: 'Tests that failed (up)', color: 'bg-crit' },
                { label: 'Tests that passed on retry (down)', color: 'bg-warn' },
              ]}
            />
          }
        />
        <div className="px-5 pb-4">
          <Seismograph
            runs={tremors}
            onSelect={(i) => navigate(`/changes/${i}`)}
            ariaLabel={`Failed and retried tests per run across ${tremors.length} runs. ${health.red} runs failed, ${health.flakyGreen} passed only after retries.`}
          />
          <p className="mt-1 text-xs text-muted">
            Amplitude uses a square-root scale so a single retry stays visible beside a large outage.
          </p>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Outcomes by week" subtitle="Runs per week, by how they ended." />
          <div className="px-5 pb-4">
            <StackedColumns
              data={weeks}
              keys={[
                { key: 'green', label: 'Passed first time', fill: 'fill-good', bg: 'bg-good' },
                { key: 'flaky', label: 'Passed after retries', fill: 'fill-warn', bg: 'bg-warn' },
                { key: 'red', label: 'Failed', fill: 'fill-crit', bg: 'bg-crit' },
              ]}
              ariaLabel="Weekly run outcomes"
            />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Can you trust a red build?" subtitle="What actually caused each failed run." />
          <div className="px-5 pb-5">
            <BarList
              rows={[
                { key: 'regression', label: 'Real regression', value: health.redByCause.regression },
                { key: 'flaky', label: 'Flaky test', value: health.redByCause.flaky },
                { key: 'infrastructure', label: 'Infrastructure', value: health.redByCause.infrastructure },
              ]}
              format={(v) => plural(v, 'run')}
            />
            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink-2">Runs whose verdict reflected the code</span>
                <span className="text-[15px] font-semibold text-ink">{fmtPct(health.trustRate)}</span>
              </div>
              <div className="mt-2">
                <Meter value={health.trustRate} label="Share of trustworthy runs" />
              </div>
              <p className="mt-2 text-xs text-muted">
                {plural(disturbed, 'run')} ({fmtPct(health.runs > 0 ? disturbed / health.runs : 0)}) were
                disturbed by retries, flaky failures or infrastructure.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Needs attention" />
          <ul className="divide-y divide-line border-t border-line">
            {openIncidents.map((i) => {
              const top = i.culprits[0];
              return (
                <AttentionRow
                  key={`i${i.id}`}
                  icon={<Flame size={16} className="text-crit" aria-hidden />}
                  to={`/changes/${i.startRun}`}
                  title={`${plural(i.tests.length, 'test')} failing since run #${dataset.runs[i.startRun]!.number}`}
                  detail={
                    top
                      ? `Prime suspect (${fmtPct(top.probability)}): ${commitSubject(dataset.commits[top.commit]!)}`
                      : 'No commit data for this run'
                  }
                />
              );
            })}
            {flakyTests.slice(0, 3).map((s) => (
              <AttentionRow
                key={`f${s.test}`}
                icon={<Waves size={16} className="text-warn-ink" aria-hidden />}
                to={`/tests/${s.test}`}
                title={testTitle(dataset.tests[s.test]!)}
                detail={`Flaky in ${fmtPct(s.flakeRate, 1)} of runs · ${fmtMs(s.retryMs)} lost to retries`}
              />
            ))}
            {analysis.slowdowns.slice(0, 2).map((d) => (
              <AttentionRow
                key={`s${d.test}`}
                icon={<Timer size={16} className="text-ink-2" aria-hidden />}
                to={`/tests/${d.test}`}
                title={testTitle(dataset.tests[d.test]!)}
                detail={`Got ×${d.ratio.toFixed(1)} slower at run #${dataset.runs[d.run]!.number}: ${fmtMs(d.beforeMs)} → ${fmtMs(d.afterMs)}`}
              />
            ))}
            {openIncidents.length === 0 && flakyTests.length === 0 && analysis.slowdowns.length === 0 && (
              <li className="px-5 py-8 text-center text-[13px] text-ink-2">
                Nothing needs attention. The pipeline is healthy.
              </li>
            )}
          </ul>
        </Card>

        {evaluation ? (
          <Card>
            <CardHeader
              title="How accurate is the engine?"
              subtitle="Scored against what the simulator planted. The engine never sees these answers."
            />
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="px-5 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 text-right font-medium">Found</th>
                    <th className="px-5 py-2 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <ScoreRow
                    task="Flaky tests detected"
                    found={`${evaluation.flaky.truePositives} of ${evaluation.flaky.planted}`}
                    score={`${fmtPct(evaluation.flaky.precision)} precision`}
                  />
                  <ScoreRow
                    task="Flaky root cause named correctly"
                    found={`${evaluation.category.correct} of ${evaluation.category.total}`}
                    score={fmtPct(evaluation.category.accuracy)}
                  />
                  <ScoreRow
                    task="Culprit commit ranked first"
                    found={`${evaluation.culprit.top1} of ${evaluation.culprit.incidents}`}
                    score={fmtPct(evaluation.culprit.accuracy)}
                  />
                  <ScoreRow
                    task="Regression failures the selection would run"
                    found={`${evaluation.selection.caught} of ${evaluation.selection.regressionFailures}`}
                    score={fmtPct(evaluation.selection.safety, 1)}
                  />
                  <ScoreRow
                    task="Slowdowns located"
                    found={`${evaluation.slowdowns.found} of ${evaluation.slowdowns.planted}`}
                    score={`${evaluation.slowdowns.falsePositives} false alarms`}
                  />
                  <ScoreRow
                    task="Infrastructure incidents recognised"
                    found={`${evaluation.infra.found} of ${evaluation.infra.planted}`}
                    score={`${evaluation.infra.falsePositives} false alarms`}
                  />
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 text-xs text-muted">
              Analysed in {Math.round(analysis.elapsedMs)} ms.{' '}
              <Link to="/model" className="text-accent-ink underline underline-offset-2">
                See the model card
              </Link>
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader title="About this data" />
            <div className="border-t border-line px-5 py-4 text-[13px] leading-relaxed text-ink-2">
              <p>{dataset.meta.description}</p>
              <p className="mt-2">
                JUnit reports carry test results but not which files each commit changed, so change-impact
                analysis is limited here. Flaky-test detection, failure clustering, duration analysis and
                pipeline health work in full.
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function AttentionRow({
  icon,
  to,
  title,
  detail,
}: {
  icon: React.ReactNode;
  to: string;
  title: string;
  detail: string;
}) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
          <span className="block truncate text-xs text-ink-2">{detail}</span>
        </span>
        <ArrowRight size={14} className="shrink-0 text-muted group-hover:text-ink" aria-hidden />
      </Link>
    </li>
  );
}

function ScoreRow({ task, found, score }: { task: string; found: string; score: string }) {
  return (
    <tr>
      <td className="px-5 py-2.5 text-ink">{task}</td>
      <td className="num px-3 py-2.5 text-right whitespace-nowrap text-ink">{found}</td>
      <td className="num px-5 py-2.5 text-right whitespace-nowrap text-ink-2">{score}</td>
    </tr>
  );
}
