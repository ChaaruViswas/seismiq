import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { HeatStrip, StatusLegend, XYChart } from '../components/charts';
import { CommitLine, kindLabel, MiniStrip, testTitle } from '../components/common';
import {
  Badge,
  Card,
  Code,
  cx,
  Drawer,
  EmptyState,
  PageHeader,
  StateBadge,
  StatusBadge,
  stateLabel,
  statusLabel,
} from '../components/ui';
import { fmtDateTime, fmtMs, fmtPct, plural } from '../engine/format';
import type { TestState } from '../engine/results';
import { CATEGORY_ADVICE, CATEGORY_LABEL } from '../engine/text';
import { Status, type StatusCode, type TestKind } from '../engine/types';
import { useProject } from '../store';

type SortKey = 'name' | 'state' | 'score' | 'pass' | 'time';
const STATE_RANK: Record<TestState, number> = {
  failing: 0,
  flaky: 1,
  suspect: 2,
  stabilized: 3,
  new: 4,
  skipped: 5,
  healthy: 6,
};
const PAGE_SIZE = 50;
const STRIP = 40;

export function Tests() {
  const { dataset, analysis } = useProject();
  const params = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<TestState | 'all'>('all');
  const [kind, setKind] = useState<TestKind | 'all'>('all');
  const [module, setModule] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'state', dir: 1 });
  const [page, setPage] = useState(0);

  const modules = useMemo(() => [...new Set(dataset.tests.map((t) => t.module))].sort(), [dataset]);
  const stateCounts = useMemo(() => {
    const counts = new Map<TestState, number>();
    for (const s of analysis.tests) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
    return counts;
  }, [analysis]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = dataset.tests.filter((t) => {
      const s = analysis.tests[t.id]!;
      if (state !== 'all' && s.state !== state) return false;
      if (kind !== 'all' && t.kind !== kind) return false;
      if (module !== 'all' && t.module !== module) return false;
      return q === '' || testTitle(t).toLowerCase().includes(q) || t.file.toLowerCase().includes(q);
    });
    const passRate = (id: number) => {
      const s = analysis.tests[id]!;
      return s.executed > 0 ? s.passes / s.executed : 1;
    };
    const cmp: Record<SortKey, (a: number, b: number) => number> = {
      name: (a, b) => testTitle(dataset.tests[a]!).localeCompare(testTitle(dataset.tests[b]!)),
      state: (a, b) =>
        STATE_RANK[analysis.tests[a]!.state] - STATE_RANK[analysis.tests[b]!.state] ||
        analysis.tests[b]!.flakeScore - analysis.tests[a]!.flakeScore,
      score: (a, b) => analysis.tests[a]!.flakeScore - analysis.tests[b]!.flakeScore,
      pass: (a, b) => passRate(a) - passRate(b),
      time: (a, b) => analysis.tests[a]!.p50Ms - analysis.tests[b]!.p50Ms,
    };
    return filtered.map((t) => t.id).sort((a, b) => sort.dir * cmp[sort.key](a, b) || a - b);
  }, [dataset, analysis, query, state, kind, module, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const lastRuns = Math.min(STRIP, dataset.runs.length);

  const parsed = params.id === undefined ? Number.NaN : Number(params.id);
  const openId = Number.isInteger(parsed) && parsed >= 0 && parsed < dataset.tests.length ? parsed : null;
  const close = useCallback(() => navigate('/tests'), [navigate]);

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'left') => (
    <th
      className={cx('px-2 py-2 font-medium', align === 'right' && 'text-right')}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => {
          setSort((s) =>
            s.key === key
              ? { key, dir: s.dir === 1 ? -1 : 1 }
              : { key, dir: key === 'name' || key === 'state' ? 1 : -1 },
          );
          setPage(0);
        }}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        {sort.key === key &&
          (sort.dir === 1 ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
      </button>
    </th>
  );

  const select =
    'rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-s1';

  return (
    <>
      <PageHeader
        title="Tests"
        lead="Every test with its reliability, speed and recent history. Select a test for the full picture."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter by name or file"
            aria-label="Filter tests by name or file"
            className="w-full rounded-lg border border-line-strong bg-surface py-1.5 pr-2.5 pl-8 text-[13px] text-ink outline-none placeholder:text-muted focus:border-s1"
          />
        </div>
        <select
          aria-label="State"
          value={state}
          onChange={(e) => {
            setState(e.target.value as TestState | 'all');
            setPage(0);
          }}
          className={select}
        >
          <option value="all">All states</option>
          {(Object.keys(STATE_RANK) as TestState[]).map((s) => (
            <option key={s} value={s}>
              {stateLabel(s)} ({stateCounts.get(s) ?? 0})
            </option>
          ))}
        </select>
        <select
          aria-label="Kind"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as TestKind | 'all');
            setPage(0);
          }}
          className={select}
        >
          <option value="all">All kinds</option>
          {(['unit', 'integration', 'e2e'] as const).map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <select
          aria-label="Module"
          value={module}
          onChange={(e) => {
            setModule(e.target.value);
            setPage(0);
          }}
          className={select}
        >
          <option value="all">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="num ml-auto text-[13px] text-muted">{plural(rows.length, 'test')}</span>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No tests match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-2 pl-5 font-medium">
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s.key === 'name'
                            ? { key: 'name', dir: s.dir === 1 ? -1 : 1 }
                            : { key: 'name', dir: 1 },
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      Test
                      {sort.key === 'name' &&
                        (sort.dir === 1 ? (
                          <ArrowUp size={11} aria-hidden />
                        ) : (
                          <ArrowDown size={11} aria-hidden />
                        ))}
                    </button>
                  </th>
                  {header('state', 'State')}
                  {header('score', 'Flake score', 'right')}
                  {header('pass', 'Pass rate', 'right')}
                  {header('time', 'Median time', 'right')}
                  <th className="py-2 pr-5 pl-3 font-medium">Last {lastRuns} runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((id) => {
                  const t = dataset.tests[id]!;
                  const s = analysis.tests[id]!;
                  const strip = dataset.runs.slice(-lastRuns).map((r) => r.statuses[id]!);
                  return (
                    <tr
                      key={id}
                      className="cursor-pointer hover:bg-surface-2"
                      onClick={() => navigate(`/tests/${id}`)}
                    >
                      <td className="max-w-[340px] py-2 pr-2 pl-5">
                        <Link
                          to={`/tests/${id}`}
                          className="block truncate font-medium text-ink hover:underline"
                          title={t.name}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t.name}
                        </Link>
                        <span className="block truncate font-mono text-[11px] text-muted">
                          {t.suite} · {kindLabel(t.kind)}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <StateBadge state={s.state} />
                      </td>
                      <td className="num px-2 py-2 text-right text-ink">
                        {s.flakeScore > 0 ? s.flakeScore : <span className="text-muted">–</span>}
                      </td>
                      <td className="num px-2 py-2 text-right text-ink">
                        {s.executed > 0 ? fmtPct(s.passes / s.executed, 1) : '–'}
                      </td>
                      <td className="num px-2 py-2 text-right text-ink-2">
                        {s.executed > 0 ? fmtMs(s.p50Ms) : '–'}
                      </td>
                      <td className="py-2 pr-5 pl-3">
                        <MiniStrip statuses={strip} label={`Last ${lastRuns} results of ${t.name}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[13px] text-ink-2">
            <span className="num">
              Page {current + 1} of {pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                className="rounded-lg border border-line-strong px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
                className="rounded-lg border border-line-strong px-2.5 py-1 hover:bg-surface-2 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
        <div className="border-t border-line px-5 py-2.5">
          <StatusLegend />
        </div>
      </Card>

      <Drawer
        open={openId !== null}
        onClose={close}
        title={openId !== null ? dataset.tests[openId]!.name : 'Test'}
      >
        {openId !== null && <TestDetail key={openId} id={openId} onClose={close} />}
      </Drawer>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function TestDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { dataset, analysis } = useProject();
  const navigate = useNavigate();
  const t = dataset.tests[id]!;
  const s = analysis.tests[id]!;

  const history = useMemo(() => dataset.runs.map((r) => r.statuses[id]!), [dataset, id]);
  const durations = useMemo(
    () =>
      dataset.runs
        .map((r, i) => ({ x: i, y: r.durations[id]! / 1000, status: r.statuses[id] }))
        .filter((p) => p.status === Status.Pass)
        .map(({ x, y }) => ({ x, y })),
    [dataset, id],
  );
  const failures = useMemo(
    () =>
      dataset.failures
        .filter((f) => f.test === id)
        .slice(-5)
        .reverse(),
    [dataset, id],
  );
  const incidents = analysis.incidents.filter((i) => i.tests.includes(id));
  const slowdown = analysis.slowdowns.find((d) => d.test === id);
  const describe = (i: number) =>
    `Run #${dataset.runs[i]!.number} · ${fmtDateTime(dataset.runs[i]!.timestamp)} · ${statusLabel(history[i] as StatusCode)}`;

  return (
    <>
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-bg px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[16px] leading-snug font-semibold text-ink">{t.name}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted" title={t.file}>
            {t.file}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StateBadge state={s.state} />
            <Badge>{kindLabel(t.kind)}</Badge>
            <Badge>{t.module}</Badge>
            {t.owner && <Badge>Team {t.owner}</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div className="grid gap-4 p-5">
        <Card>
          <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Fact label="Runs">{s.executed}</Fact>
            <Fact label="Pass rate">{s.executed > 0 ? fmtPct(s.passes / s.executed, 1) : '–'}</Fact>
            <Fact label="Median time">{s.executed > 0 ? fmtMs(s.p50Ms) : '–'}</Fact>
            <Fact label="95th percentile">{s.executed > 0 ? fmtMs(s.p95Ms) : '–'}</Fact>
          </dl>
        </Card>

        <Card>
          <div className="px-4 pt-3.5 pb-1 text-[13px] font-semibold text-ink">History</div>
          <div className="px-4 pb-3.5">
            <p className="mb-2 text-xs text-muted">
              All {history.length} runs, oldest to newest. Select a cell to open that run.
            </p>
            <HeatStrip
              statuses={history}
              describeCell={describe}
              onSelect={(i) => navigate(`/changes/${i}`)}
              height={26}
              ariaLabel={`Result of ${t.name} in each run`}
            />
            <div className="mt-3">
              <StatusLegend />
            </div>
          </div>
        </Card>

        {s.state === 'failing' && s.failingSince >= 0 && (
          <Card>
            <div className="p-4 text-[13px] text-ink-2">
              <p className="font-semibold text-crit-ink">
                Failing since run #{dataset.runs[s.failingSince]!.number}
              </p>
              <p className="mt-1">
                It fails on every attempt, so this is a real break rather than flakiness.{' '}
                <Link
                  to={`/changes/${s.failingSince}`}
                  className="font-medium text-accent-ink underline underline-offset-2"
                >
                  See which commit is suspected
                </Link>
                .
              </p>
            </div>
          </Card>
        )}

        {s.flakeEvents > 0 && (
          <Card>
            <div className="px-4 pt-3.5 pb-1 text-[13px] font-semibold text-ink">Flakiness</div>
            <div className="px-4 pb-4 text-[13px] text-ink-2">
              <dl className="mt-1 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Fact label="Flake score">{s.flakeScore}</Fact>
                <Fact label="Flake rate">{fmtPct(s.flakeRate, 1)}</Fact>
                <Fact label="95% interval">
                  {fmtPct(s.flakeLower, 1)}–{fmtPct(s.flakeUpper, 1)}
                </Fact>
                <Fact label="Events">{s.flakeEvents}</Fact>
              </dl>
              <p className="mt-3">
                {s.flakeEvents} of {s.executed} runs failed and then passed without any related code change
                {s.firstFlakeRun >= 0 && (
                  <>
                    {' '}
                    — first in run #{dataset.runs[s.firstFlakeRun]!.number}, last in run #
                    {dataset.runs[s.lastFlakeRun]!.number}
                  </>
                )}
                .
              </p>
              {s.state === 'stabilized' && (
                <p className="mt-2">
                  <span className="font-medium text-ink">Looks fixed.</span> Quiet for {s.quietRuns} runs; at
                  its earlier rate, a streak that long would happen by chance{' '}
                  {s.quietChance < 0.001 ? 'less than 0.1%' : fmtPct(s.quietChance, 1)} of the time.
                </p>
              )}
              {s.state === 'suspect' && (
                <p className="mt-2">Two events are not enough to call it flaky. A third will.</p>
              )}
              {s.category && (
                <div className="mt-3 rounded-lg bg-surface-2 p-3">
                  <p className="font-medium text-ink">Likely cause: {CATEGORY_LABEL[s.category]}</p>
                  <p className="mt-1">{CATEGORY_ADVICE[s.category]}</p>
                </div>
              )}
              {s.retryMs > 0 && (
                <p className="mt-3 text-xs text-muted">
                  {fmtMs(s.retryMs)} of CI time went into attempts that were thrown away.
                </p>
              )}
            </div>
          </Card>
        )}

        {durations.length > 1 && (
          <Card>
            <div className="px-4 pt-3.5 pb-1 text-[13px] font-semibold text-ink">
              Duration of passing runs
            </div>
            <div className="px-4 pb-3">
              {slowdown && (
                <p className="mb-2 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">
                    Got ×{slowdown.ratio.toFixed(1)} slower at run #{dataset.runs[slowdown.run]!.number}
                  </span>
                  : {fmtMs(slowdown.beforeMs)} → {fmtMs(slowdown.afterMs)}.
                </p>
              )}
              <XYChart
                series={[{ name: 'Duration', color: 's1', points: durations }]}
                height={170}
                xFormat={(x) => `#${dataset.runs[Math.round(x)]?.number ?? ''}`}
                yFormat={(y) => fmtMs(y * 1000)}
                ariaLabel={`Duration of ${t.name} over time`}
              />
              {slowdown && slowdown.suspects.length > 0 && (
                <div className="mt-2 border-t border-line pt-3">
                  <p className="mb-1.5 text-xs text-muted">Changed code this test reaches in that run:</p>
                  {slowdown.suspects.map((ci) => (
                    <CommitLine key={ci} commit={dataset.commits[ci]!} dataset={dataset} />
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

        {failures.length > 0 && (
          <Card>
            <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold text-ink">Most recent failures</div>
            <ul className="divide-y divide-line border-t border-line">
              {failures.map((f) => (
                <li key={f.run} className="px-4 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <Link
                      to={`/changes/${f.run}`}
                      className="num font-medium text-accent-ink underline underline-offset-2"
                    >
                      Run #{dataset.runs[f.run]!.number}
                    </Link>
                    <StatusBadge status={f.final ? Status.Fail : Status.Flaky} />
                    <span className="text-muted">
                      {plural(f.failedAttempts, 'failed attempt')} ·{' '}
                      {fmtDateTime(dataset.runs[f.run]!.timestamp)}
                    </span>
                  </div>
                  <pre className="scroll-thin overflow-x-auto rounded-lg bg-surface-2 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
                    {f.message}
                  </pre>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {incidents.length > 0 && (
          <Card>
            <div className="px-4 pt-3.5 pb-2 text-[13px] font-semibold text-ink">
              Regressions this test caught
            </div>
            <ul className="divide-y divide-line border-t border-line text-[13px]">
              {incidents
                .slice()
                .reverse()
                .slice(0, 6)
                .map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link
                      to={`/changes/${i.startRun}`}
                      className="num font-medium text-accent-ink underline underline-offset-2"
                    >
                      Run #{dataset.runs[i.startRun]!.number}
                    </Link>
                    <span className="text-ink-2">
                      with {plural(i.tests.length - 1, 'other test')} ·{' '}
                      {i.ttrMs === null ? 'still open' : `restored in ${fmtMs(i.ttrMs)}`}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        )}

        {t.targets.length > 0 && (
          <Card>
            <div className="px-4 pt-3.5 pb-1 text-[13px] font-semibold text-ink">Code under test</div>
            <div className="px-4 pb-4 text-[13px] text-ink-2">
              <p className="mb-2">
                Imports {plural(t.targets.length, 'file')} directly; coverage records{' '}
                {plural(t.coverage.length, 'file')} in total.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {t.targets.map((f) => (
                  <Code key={f}>{dataset.files[f]!.path}</Code>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
