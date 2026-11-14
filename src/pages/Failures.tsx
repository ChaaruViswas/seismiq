import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { HeatStrip } from '../components/charts';
import { TestLink } from '../components/common';
import { Badge, Card, cx, EmptyState, KindBadge, PageHeader, Stat, Tabs } from '../components/ui';
import { fmtDateTime, plural } from '../engine/format';
import type { ClusterKind } from '../engine/results';
import { CATEGORY_ADVICE, CATEGORY_LABEL } from '../engine/text';
import { useProject } from '../store';

export function Failures() {
  const { dataset, analysis } = useProject();
  const [kind, setKind] = useState<ClusterKind | 'all'>('all');
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(30);

  const counts = useMemo(() => {
    const c: Record<ClusterKind, number> = { regression: 0, flaky: 0, infrastructure: 0 };
    for (const cl of analysis.clusters) c[cl.kind]++;
    return c;
  }, [analysis]);
  const clusters = analysis.clusters.filter((c) => kind === 'all' || c.kind === kind);
  const occurrences = dataset.failures.length;

  return (
    <>
      <PageHeader
        title="Failures"
        lead={`${plural(occurrences, 'failure')} collapsed into ${plural(analysis.clusters.length, 'distinct problem')}. Messages are normalised (numbers, ids, addresses stripped) and grouped by TF-IDF similarity, so one root cause reads as one row.`}
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Failure messages" value={occurrences.toLocaleString('en-US')} />
        <Stat
          label="Distinct problems"
          value={analysis.clusters.length}
          hint={
            occurrences > 0
              ? `${(occurrences / Math.max(1, analysis.clusters.length)).toFixed(1)}× less to read`
              : undefined
          }
        />
        <Stat label="Regressions" value={counts.regression} hint="Fail on every attempt" />
        <Stat
          label="Infrastructure incidents"
          value={analysis.infraRuns.length}
          hint="Runs with a shared environment failure"
        />
      </div>

      <div className="mt-4 mb-3">
        <Tabs
          label="Kind"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setOpen(null);
          }}
          options={[
            { value: 'all', label: 'All', count: analysis.clusters.length },
            { value: 'regression', label: 'Regressions', count: counts.regression },
            { value: 'flaky', label: 'Flaky', count: counts.flaky },
            { value: 'infrastructure', label: 'Infrastructure', count: counts.infrastructure },
          ]}
        />
      </div>

      <Card className="overflow-hidden">
        {clusters.length === 0 ? (
          <EmptyState title="No failures of this kind" />
        ) : (
          <ul className="divide-y divide-line">
            {clusters.slice(0, limit).map((c) => {
              const expanded = open === c.id;
              const strip = dataset.runs.map((_, r) => (c.runs.includes(r) ? 2 : 0));
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : c.id)}
                    className={cx(
                      'flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-surface-2',
                      expanded && 'bg-surface-2',
                    )}
                  >
                    <span className="mt-0.5 text-muted">
                      {expanded ? (
                        <ChevronDown size={15} aria-hidden />
                      ) : (
                        <ChevronRight size={15} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-ink" title={c.title}>
                        {c.title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <KindBadge kind={c.kind} />
                        <Badge title={CATEGORY_ADVICE[c.category]}>{CATEGORY_LABEL[c.category]}</Badge>
                        <span className="num">
                          {plural(c.count, 'occurrence')} · {plural(c.tests.length, 'test')} ·{' '}
                          {plural(c.runs.length, 'run')}
                        </span>
                        <span className="num">· last seen run #{dataset.runs[c.lastRun]!.number}</span>
                      </span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="grid gap-4 bg-surface-2 px-5 pt-1 pb-5 md:pl-12">
                      <div>
                        <p className="mb-1.5 text-xs text-muted">Representative message</p>
                        <pre className="scroll-thin max-h-56 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
                          {c.sample}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs text-muted">
                          When it happened — first {fmtDateTime(dataset.runs[c.firstRun]!.timestamp)}, last{' '}
                          {fmtDateTime(dataset.runs[c.lastRun]!.timestamp)} (UTC)
                        </p>
                        <HeatStrip
                          statuses={strip}
                          height={16}
                          describeCell={(r) =>
                            `Run #${dataset.runs[r]!.number}${c.runs.includes(r) ? ' — occurred' : ''}`
                          }
                          ariaLabel="Runs in which this failure occurred"
                        />
                      </div>
                      <div className="text-[13px] text-ink-2">
                        <p className="font-medium text-ink">What to do</p>
                        <p className="mt-0.5">{CATEGORY_ADVICE[c.category]}</p>
                        {c.kind === 'regression' && (
                          <p className="mt-1">
                            <Link
                              to={`/changes/${c.firstRun}`}
                              className="font-medium text-accent-ink underline underline-offset-2"
                            >
                              See the suspected commit for run #{dataset.runs[c.firstRun]!.number}
                            </Link>
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs text-muted">Affected tests</p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {c.tests.slice(0, 12).map((t) => (
                            <li key={t} className="min-w-0">
                              <TestLink test={dataset.tests[t]!} />
                            </li>
                          ))}
                        </ul>
                        {c.tests.length > 12 && (
                          <p className="mt-2 text-xs text-muted">+{c.tests.length - 12} more</p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {clusters.length > limit && (
          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={() => setLimit(limit + 30)}
              className="w-full rounded-lg py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
            >
              Show more ({clusters.length - limit} remaining)
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
