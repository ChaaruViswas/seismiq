import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BarList, Legend, XYChart } from '../components/charts';
import { testTitle } from '../components/common';
import { Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import { planShards, shardItems } from '../engine/durations';
import { fmtDate, fmtMs, fmtPct, plural } from '../engine/format';
import { useProject } from '../store';

export function Pipeline() {
  const { dataset, analysis } = useProject();
  const [shards, setShards] = useState(4);
  const { health } = analysis;

  const items = useMemo(() => shardItems(dataset, analysis.tests), [dataset, analysis]);
  const balanced = useMemo(() => planShards(items, shards, 'balanced'), [items, shards]);
  const naive = useMemo(() => planShards(items, shards, 'alphabetical'), [items, shards]);
  const slowest = useMemo(
    () =>
      analysis.tests
        .filter((s) => s.executed > 0)
        .sort((a, b) => b.p50Ms - a.p50Ms)
        .slice(0, 10),
    [analysis],
  );
  const wall = health.weeks.map((w) => ({ x: w.start, y: w.avgWallSec / 60 }));
  const retry = health.weeks.map((w) => ({ x: w.start, y: w.retryMs / 60_000 }));
  const total = items.reduce((s, i) => s + i.ms, 0);

  return (
    <>
      <PageHeader
        title="Pipeline"
        lead="Where CI time goes, which tests got slower and why, and how to split the suite so parallel jobs finish together."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Average pipeline" value={fmtMs(health.avgWallSec * 1000)} hint="Wall clock per run" />
        <Stat
          label="Total test time"
          value={fmtMs(health.totalTestMs)}
          hint={`Across ${plural(health.runs, 'run')}`}
        />
        <Stat
          label="Spent on retries"
          value={fmtMs(health.retryMs)}
          hint={`${fmtPct(health.totalTestMs > 0 ? health.retryMs / health.totalTestMs : 0, 1)} of all test time`}
        />
        <Stat label="Tests that got slower" value={analysis.slowdowns.length} hint="Detected change points" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Average pipeline duration" subtitle="Minutes per run, weekly." />
          <div className="px-5 pb-4">
            {wall.length > 1 ? (
              <XYChart
                series={[{ name: 'Pipeline', color: 's1', points: wall, area: true }]}
                xFormat={fmtDate}
                yFormat={(v) => `${v.toFixed(v < 10 ? 1 : 0)}m`}
                ariaLabel="Average pipeline duration per week"
              />
            ) : (
              <EmptyState title="Not enough weeks of data" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Time lost to retries"
            subtitle="Minutes per week spent on attempts that were thrown away."
          />
          <div className="px-5 pb-4">
            {retry.length > 1 ? (
              <XYChart
                series={[{ name: 'Retry time', color: 's1', points: retry, area: true }]}
                xFormat={fmtDate}
                yFormat={(v) => `${v.toFixed(v < 10 ? 1 : 0)}m`}
                ariaLabel="Retry time per week"
              />
            ) : (
              <EmptyState title="Not enough weeks of data" />
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Shard planner"
          subtitle="Split test files across parallel jobs. The pipeline waits for the slowest shard, so balance by measured duration, not by file count."
          action={
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Shards
              <input
                type="range"
                min={2}
                max={16}
                value={shards}
                onChange={(e) => setShards(Number(e.target.value))}
                aria-label="Number of shards"
                className="w-32"
              />
              <span className="num w-6 font-semibold text-ink">{shards}</span>
            </label>
          }
        />
        <div className="grid gap-5 border-t border-line px-5 py-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="grid gap-5">
            <ShardRow title="Balanced by duration" plan={balanced} scale={naive.makespanMs} color="bg-s1" />
            <ShardRow
              title="Split by file count (typical default)"
              plan={naive}
              scale={naive.makespanMs}
              color="bg-neutral"
            />
            <Legend
              items={[
                { label: 'Balanced shard', color: 'bg-s1' },
                { label: 'Count-based shard', color: 'bg-neutral' },
              ]}
            />
          </div>
          <div className="grid content-start gap-3 rounded-lg bg-surface-2 p-4 text-[13px]">
            <div>
              <div className="text-xs text-muted">Slowest shard, balanced</div>
              <div className="num text-[20px] font-semibold text-ink">{fmtMs(balanced.makespanMs)}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Slowest shard, by count</div>
              <div className="num text-[20px] font-semibold text-ink">{fmtMs(naive.makespanMs)}</div>
            </div>
            <div className="border-t border-line pt-3 text-ink-2">
              {naive.makespanMs > 0 && (
                <p>
                  Balancing finishes{' '}
                  <span className="font-semibold text-ink">
                    {fmtPct(1 - balanced.makespanMs / naive.makespanMs)} sooner
                  </span>
                  , within {fmtPct(balanced.makespanMs / Math.max(1, balanced.idealMs) - 1, 1)} of the
                  theoretical best ({fmtMs(balanced.idealMs)}).
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                {plural(items.length, 'test file')}, {fmtMs(total)} of work. Greedy longest-first assignment,
                guaranteed within 4/3 of optimal.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Tests that got slower"
            subtitle="A duration step that stayed — found by change-point detection on log durations."
          />
          {analysis.slowdowns.length === 0 ? (
            <div className="border-t border-line">
              <EmptyState title="No slowdowns detected" />
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {analysis.slowdowns.slice(0, 8).map((d) => {
                const t = dataset.tests[d.test]!;
                return (
                  <li key={d.test} className="px-5 py-2.5">
                    <Link
                      to={`/tests/${d.test}`}
                      className="block truncate text-[13px] font-medium text-ink hover:underline"
                      title={testTitle(t)}
                    >
                      {t.name}
                    </Link>
                    <span className="num block text-xs text-ink-2">
                      {fmtMs(d.beforeMs)} → {fmtMs(d.afterMs)} (×{d.ratio.toFixed(1)}) at run #
                      {dataset.runs[d.run]!.number}
                      {d.suspects.length > 0 && <> · {plural(d.suspects.length, 'suspect commit')}</>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Slowest tests" subtitle="Median duration of passing runs." />
          <div className="border-t border-line px-5 py-4">
            <BarList
              rows={slowest.map((s) => ({
                key: String(s.test),
                label: dataset.tests[s.test]!.name,
                title: testTitle(dataset.tests[s.test]!),
                value: s.p50Ms,
              }))}
              format={fmtMs}
            />
          </div>
        </Card>
      </div>
    </>
  );
}

function ShardRow({
  title,
  plan,
  scale,
  color,
}: {
  title: string;
  plan: ReturnType<typeof planShards>;
  scale: number;
  color: string;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-ink">{title}</p>
      <ul className="grid gap-1.5">
        {plan.shards.map((s, i) => (
          <li key={i} className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-3 text-xs">
            <span className="num text-muted">Shard {i + 1}</span>
            <span className="h-2.5 rounded-r-[4px] bg-surface-2" aria-hidden>
              <span
                className={`block h-full rounded-r-[4px] ${color}`}
                style={{ width: `${scale > 0 ? (s.ms / scale) * 100 : 0}%` }}
              />
            </span>
            <span className="num text-right text-ink-2" title={`${s.items.length} files`}>
              {fmtMs(s.ms)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
