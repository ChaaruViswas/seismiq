import { ArrowLeft, ChevronDown, ChevronRight, FileCode2, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DivergingBars, RibbonGraph, type RibbonNode } from '../components/charts';
import { CommitLine, commitSubject, KindTag, ProbBar, RiskBadge, TestLink } from '../components/common';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Code,
  cx,
  EmptyState,
  OutcomeBadge,
  PageHeader,
  Stat,
  StatusBadge,
  Tabs,
} from '../components/ui';
import { parseDiff } from '../engine/diff';
import { fmtAgo, fmtDateTime, fmtMs, fmtPct, plural, shortSha } from '../engine/format';
import { FEATURES } from '../engine/history';
import { type ChangeImpact, explainTest, impactOfChange, impactOfRun } from '../engine/impact';
import { classifyPath, REASON_HELP, REASON_LABEL, Reason, type ReasonCode } from '../engine/repo';
import type { StatusCode } from '../engine/types';
import { useProject } from '../store';

const PAGE = 40;

export function Changes() {
  const { dataset, analysis } = useProject();
  const params = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'runs' | 'diff'>('runs');
  const [shown, setShown] = useState(PAGE);

  const nRuns = dataset.runs.length;
  const parsed = params.run === undefined ? Number.NaN : Number(params.run);
  const hasParam = Number.isInteger(parsed) && parsed >= 0 && parsed < nRuns;
  const selected = hasParam ? parsed : nRuns - 1;
  // Make sure a run opened from elsewhere (search, the seismograph) is in the list.
  const visible = Math.max(shown, nRuns - selected);

  return (
    <>
      <PageHeader
        title="Change impact"
        lead="For every change: which tests it can affect, the order that finds failures fastest, how risky it is — and, when something breaks, which commit did it."
        action={
          <Tabs
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'runs', label: 'Recent pushes' },
              { value: 'diff', label: 'Analyse a diff' },
            ]}
          />
        }
      />

      {tab === 'diff' ? (
        <DiffTab />
      ) : nRuns === 0 ? (
        <Card>
          <EmptyState title="No runs yet" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className={cx('self-start overflow-hidden', hasParam && 'hidden lg:block')}>
            <ul className="divide-y divide-line" aria-label="CI runs, newest first">
              {Array.from({ length: Math.min(visible, nRuns) }, (_, i) => nRuns - 1 - i).map((r) => {
                const run = dataset.runs[r]!;
                const rs = analysis.runs[r]!;
                const commits = analysis.runCommits[r]!;
                const first = commits.length > 0 ? dataset.commits[commits[0]!] : undefined;
                return (
                  <li key={r}>
                    <Link
                      to={`/changes/${r}`}
                      aria-current={r === selected ? 'true' : undefined}
                      className={cx(
                        'flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-surface-2',
                        r === selected && 'bg-surface-2',
                      )}
                    >
                      <span className="mt-0.5">
                        <OutcomeBadge outcome={rs.outcome} compact />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {first ? commitSubject(first) : `Run #${run.number}`}
                        </span>
                        <span className="num mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          #{run.number} · {fmtAgo(run.timestamp, dataset.meta.createdAt)}
                          {commits.length > 1 && <span>· {commits.length} commits</span>}
                        </span>
                      </span>
                      {analysis.hasChangeData && <RiskBadge risk={rs.risk} showValue={false} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {visible < nRuns && (
              <div className="border-t border-line p-2">
                <button
                  type="button"
                  onClick={() => setShown(visible + PAGE)}
                  className="w-full rounded-lg py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
                >
                  Show older runs
                </button>
              </div>
            )}
          </Card>

          <div className={cx('min-w-0', !hasParam && 'hidden lg:block')}>
            <button
              type="button"
              onClick={() => navigate('/changes')}
              className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink lg:hidden"
            >
              <ArrowLeft size={14} aria-hidden /> All runs
            </button>
            <RunDetail key={selected} run={selected} />
          </div>
        </div>
      )}
    </>
  );
}

function RunDetail({ run: r }: { run: number }) {
  const { dataset, analysis, index } = useProject();
  const run = dataset.runs[r]!;
  const rs = analysis.runs[r]!;
  const impact = useMemo(() => impactOfRun(dataset, index, analysis, r), [dataset, index, analysis, r]);
  const commits = analysis.runCommits[r]!;
  const carried = commits.length - run.commits.length;
  const incidents = analysis.incidents.filter((i) => i.startRun === r);
  const isInfra = analysis.infraRuns.includes(r);

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-4">
          <h2 className="text-[16px] font-semibold text-ink">Run #{run.number}</h2>
          <OutcomeBadge outcome={rs.outcome} />
          {rs.cause && (
            <Badge tone={rs.cause === 'regression' ? 'crit' : rs.cause === 'flaky' ? 'warn' : 'serious'}>
              Cause: {rs.cause === 'flaky' ? 'flaky test' : rs.cause}
            </Badge>
          )}
          <span className="num text-[13px] text-muted">
            {fmtDateTime(run.timestamp)} UTC · pipeline took {fmtMs(run.wallSec * 1000)}
          </span>
        </div>
        {commits.length > 0 ? (
          <ul className="mt-3 grid gap-2.5 border-t border-line px-5 py-3.5">
            {commits.map((ci) => (
              <li key={ci}>
                <CommitLine commit={dataset.commits[ci]!} dataset={dataset} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-t border-line px-5 py-3.5 text-[13px] text-ink-2">
            This report carries no commit information.
          </p>
        )}
        {carried > 0 && (
          <p className="border-t border-line px-5 py-2.5 text-xs text-ink-2">
            {plural(carried, 'commit')} carried over from the previous run, which was lost to an
            infrastructure incident and proved nothing about them.
          </p>
        )}
        {isInfra && (
          <p className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-serious-ink">
            <ShieldAlert size={14} aria-hidden /> Recognised as an infrastructure incident: its failures are
            excluded from flakiness and model statistics.
          </p>
        )}
      </Card>

      {incidents.map((incident) => (
        <Card key={incident.id}>
          <CardHeader
            title={`Which commit broke ${plural(incident.tests.length, 'test')}?`}
            subtitle={
              incident.endRun === null
                ? 'Still failing. Commits ranked by how well each explains the failing tests.'
                : `Restored ${fmtMs(incident.ttrMs!)} later in run #${dataset.runs[incident.endRun]!.number}${incident.fixCommit !== null ? ` by ${shortSha(dataset.commits[incident.fixCommit]!.sha)}` : ''}.`
            }
          />
          <ol className="grid gap-3 border-t border-line px-5 py-4">
            {incident.culprits.map((c, rank) => (
              <li key={c.commit} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3">
                <span
                  className={cx(
                    'num mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                    rank === 0 ? 'bg-crit text-white' : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {rank + 1}
                </span>
                <div className="min-w-0">
                  <CommitLine commit={dataset.commits[c.commit]!} dataset={dataset} />
                  <ul className="mt-1 text-xs text-ink-2">
                    {c.evidence.map((e) => (
                      <li key={e}>· {e}</li>
                    ))}
                  </ul>
                </div>
                <span className="num text-[15px] font-semibold text-ink">{fmtPct(c.probability)}</span>
              </li>
            ))}
            {incident.culprits.length === 0 && (
              <li className="text-[13px] text-ink-2">No commit data for this run.</li>
            )}
          </ol>
        </Card>
      ))}

      <ImpactPanel
        impact={impact}
        statuses={run.statuses}
        newFailures={rs.newFailures.length}
        escaped={rs.escaped.length}
      />
    </div>
  );
}

const REASON_ORDER: ReasonCode[] = [
  Reason.Global,
  Reason.TestChanged,
  Reason.Target,
  Reason.Coverage,
  Reason.Static,
  Reason.History,
  Reason.Failing,
  Reason.NameMatch,
];

function ImpactPanel({
  impact,
  statuses,
  newFailures,
  escaped,
}: {
  impact: ChangeImpact;
  statuses?: ArrayLike<number>;
  newFailures?: number;
  escaped?: number;
}) {
  const { dataset, analysis, index } = useProject();
  const [limit, setLimit] = useState(15);
  const [open, setOpen] = useState<number | null>(null);
  const { change, tests } = impact;
  const share = impact.total > 0 ? tests.length / impact.total : 0;
  const saved = impact.fullMs > 0 ? 1 - impact.selectedMs / impact.fullMs : 0;
  const maxP = Math.max(0.01, ...tests.filter((t) => !t.failingOnBase).map((t) => t.probability));

  const reasons = useMemo(() => {
    const counts = new Map<ReasonCode, number>();
    for (const t of tests) counts.set(t.reason, (counts.get(t.reason) ?? 0) + 1);
    return REASON_ORDER.filter((r) => counts.has(r)).map((r) => ({ reason: r, count: counts.get(r)! }));
  }, [tests]);

  const graph = useMemo(() => {
    const linkCount = new Map<string, number>();
    const fileWeight = new Map<number, number>();
    const moduleWeight = new Map<string, number>();
    for (const t of tests) {
      const mod = dataset.tests[t.test]!.module;
      for (const f of change.files.keys()) {
        if (index.dist[t.test]![f]! > 0 || index.cov[t.test]![f] === 1) {
          const key = `${f}|${mod}`;
          linkCount.set(key, (linkCount.get(key) ?? 0) + 1);
          fileWeight.set(f, (fileWeight.get(f) ?? 0) + 1);
          moduleWeight.set(mod, (moduleWeight.get(mod) ?? 0) + 1);
        }
      }
    }
    const files = [...fileWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const modules = [...moduleWeight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const keepFile = new Set(files.map(([f]) => f));
    const keepModule = new Set(modules.map(([m]) => m));
    const left: RibbonNode[] = files.map(([f, w]) => ({
      key: `f${f}`,
      label: dataset.files[f]!.path,
      weight: w,
    }));
    const right: RibbonNode[] = modules.map(([m, w]) => ({
      key: `m${m}`,
      label: m,
      sub: plural(w, 'link'),
      weight: w,
    }));
    const links = [...linkCount.entries()]
      .map(([key, weight]) => {
        const [f, m] = key.split('|') as [string, string];
        return { f: Number(f), m, weight };
      })
      .filter((l) => keepFile.has(l.f) && keepModule.has(l.m))
      .map((l) => ({ from: `f${l.f}`, to: `m${l.m}`, weight: l.weight }));
    // Node weights must equal the sum of their visible ribbons.
    for (const n of left) n.weight = links.filter((l) => l.from === n.key).reduce((s, l) => s + l.weight, 0);
    for (const n of right) {
      n.weight = links.filter((l) => l.to === n.key).reduce((s, l) => s + l.weight, 0);
      n.sub = plural(n.weight, 'link');
    }
    return {
      left: left.filter((n) => n.weight > 0),
      right: right.filter((n) => n.weight > 0),
      links,
      hiddenFiles: fileWeight.size - files.length,
    };
  }, [tests, change, dataset, index]);

  const unknown = change.otherPaths.filter((p) => classifyPath(p) === 'other');

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="Break risk"
          value={analysis.hasChangeData ? fmtPct(impact.risk) : '–'}
          hint={
            analysis.hasChangeData ? <RiskBadge risk={impact.risk} showValue={false} /> : 'Needs commit data'
          }
          help="Predicted chance that this change makes at least one currently passing test fail. Calibrated on past runs."
        />
        <Stat
          label="Tests to run"
          value={
            <>
              {tests.length}
              <span className="text-[15px] font-normal text-muted"> of {impact.total}</span>
            </>
          }
          hint={`${fmtPct(share)} of the suite`}
          help="Tests linked to the change by imports, coverage or failure history, plus anything already failing."
        />
        <Stat
          label="Test time"
          value={fmtMs(impact.selectedMs)}
          hint={`${fmtPct(saved)} less than the full ${fmtMs(impact.fullMs)}`}
        />
        {newFailures !== undefined ? (
          <Stat
            label="New failures in this run"
            value={newFailures}
            hint={
              newFailures === 0
                ? 'Nothing broke'
                : escaped
                  ? `${escaped} would have been skipped`
                  : 'All inside the selection'
            }
            tone={newFailures === 0 ? undefined : escaped ? 'crit' : 'good'}
            help="Tests that were passing before and started a real failing streak here. A good selection contains all of them."
          />
        ) : (
          <Stat
            label="Files in the change"
            value={change.files.size + change.testFiles.length + change.otherPaths.length}
            hint={`${change.files.size} in the import graph`}
          />
        )}
      </div>

      {change.globalPath !== null && (
        <Banner>
          <Code>{change.globalPath}</Code> can affect any test (dependencies, build or CI configuration), so
          the whole suite runs. Ordering by risk still applies.
        </Banner>
      )}
      {change.docsOnly && (
        <Banner>
          Documentation only. Nothing in this change can influence a test, so nothing needs to run.
        </Banner>
      )}
      {unknown.length > 0 && (
        <Banner>
          Not in the import graph:{' '}
          {unknown.slice(0, 4).map((p) => (
            <span key={p} className="mr-1">
              <Code>{p}</Code>
            </span>
          ))}
          {unknown.length > 4 && `+${unknown.length - 4} more`} — matched to tests by file name only.
        </Banner>
      )}

      {graph.links.length > 0 && (
        <Card>
          <CardHeader
            title="Blast radius"
            subtitle="Changed files and the modules whose tests they reach. Ribbon width is the number of selected tests linking the two."
          />
          <div className="px-5 pb-4">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Changed files</span>
              <span>Modules with affected tests</span>
            </div>
            <RibbonGraph
              left={graph.left}
              right={graph.right}
              links={graph.links}
              ariaLabel="Links between changed files and modules with affected tests"
            />
            {graph.hiddenFiles > 0 && (
              <p className="mt-2 text-xs text-muted">
                {plural(graph.hiddenFiles, 'more changed file')} not shown.
              </p>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Recommended test order"
          subtitle="Already-failing tests first, then by predicted chance of a new failure. Select a row to see why."
          action={
            <div className="flex flex-wrap gap-1.5">
              {reasons.map(({ reason, count }) => (
                <Badge key={reason} title={REASON_HELP[reason]}>
                  {REASON_LABEL[reason]} <span className="num text-muted">{count}</span>
                </Badge>
              ))}
            </div>
          }
        />
        {tests.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState title="No tests selected" icon={<FileCode2 size={28} aria-hidden />}>
              Nothing links this change to any test.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="w-10 py-2 pl-5 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Test</th>
                  <th className="px-2 py-2 font-medium">Why selected</th>
                  <th className="px-2 py-2 text-right font-medium">Fail risk</th>
                  <th className="px-2 py-2 text-right font-medium">Time</th>
                  {statuses && <th className="py-2 pr-5 pl-2 font-medium">Actual result</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tests.slice(0, limit).map((t, i) => {
                  const test = dataset.tests[t.test]!;
                  const expanded = open === t.test;
                  return (
                    <Row key={t.test}>
                      <tr
                        className={cx('cursor-pointer hover:bg-surface-2', expanded && 'bg-surface-2')}
                        onClick={() => setOpen(expanded ? null : t.test)}
                      >
                        <td className="num py-2 pl-5 align-top text-muted">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`Explain ${test.name}`}
                            className="flex items-center gap-0.5"
                          >
                            {expanded ? (
                              <ChevronDown size={13} aria-hidden />
                            ) : (
                              <ChevronRight size={13} aria-hidden />
                            )}
                            {i + 1}
                          </button>
                        </td>
                        <td className="max-w-[320px] px-2 py-2">
                          <span className="block truncate font-medium text-ink" title={test.name}>
                            {test.name}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted">
                            {test.suite} · <KindTag kind={test.kind} />
                          </span>
                        </td>
                        <td className="px-2 py-2 align-top whitespace-nowrap text-ink-2">
                          {REASON_LABEL[t.reason]}
                        </td>
                        <td className="px-2 py-2 align-top">
                          {t.failingOnBase ? (
                            <span className="block text-right text-xs text-crit-ink">already failing</span>
                          ) : (
                            <ProbBar value={t.probability} max={maxP} />
                          )}
                        </td>
                        <td className="num px-2 py-2 text-right align-top whitespace-nowrap text-ink-2">
                          {fmtMs(t.ms)}
                        </td>
                        {statuses && (
                          <td className="py-2 pr-5 pl-2 align-top">
                            <StatusBadge status={statuses[t.test] as StatusCode} />
                          </td>
                        )}
                      </tr>
                      {expanded && (
                        <tr className="bg-surface-2">
                          <td colSpan={statuses ? 6 : 5} className="px-5 pt-1 pb-4">
                            <Explanation
                              impact={impact}
                              test={t.test}
                              failingOnBase={t.failingOnBase}
                              reason={t.reason}
                            />
                          </td>
                        </tr>
                      )}
                    </Row>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tests.length > limit && (
          <div className="border-t border-line p-2">
            <button
              type="button"
              onClick={() => setLimit(limit + 50)}
              className="w-full rounded-lg py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2"
            >
              Show more ({tests.length - limit} remaining)
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

/** Fragment wrapper so a data row and its detail row can share one key. */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
      {children}
    </div>
  );
}

function Explanation({
  impact,
  test,
  failingOnBase,
  reason,
}: {
  impact: ChangeImpact;
  test: number;
  failingOnBase: boolean;
  reason: ReasonCode;
}) {
  const { dataset, analysis } = useProject();
  const parts = useMemo(
    () => explainTest(analysis, impact.features, test).slice(0, 6),
    [analysis, impact, test],
  );
  const t = dataset.tests[test]!;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="text-[13px] text-ink-2">
        <p>
          <span className="font-medium text-ink">{REASON_LABEL[reason]}.</span> {REASON_HELP[reason]}
        </p>
        {failingOnBase && (
          <p className="mt-2">
            It was failing before this change, so it runs first: the only open question is whether this change
            fixes it.
          </p>
        )}
        <div className="mt-2">
          <TestLink test={t} />
        </div>
      </div>
      <div>
        {failingOnBase ? null : parts.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            There is not enough failure history to train a model yet, so tests are ordered by simple rules.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted">
              What moved this test&apos;s risk away from the average test (log-odds). Red raises, blue lowers.
            </p>
            <DivergingBars
              rows={parts.map((p) => ({
                key: FEATURES[p.feature]!.key,
                label: FEATURES[p.feature]!.label,
                value: p.contribution,
                title: FEATURES[p.feature]!.help,
              }))}
              format={(v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`}
            />
          </>
        )}
      </div>
    </div>
  );
}

function DiffTab() {
  const { dataset, analysis, index } = useProject();
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const sample = useMemo(() => {
    const picks = analysis.hotspots.slice(0, 2).map((h) => dataset.files[h.file]!.path);
    if (picks.length === 0) {
      const files = [...new Set(dataset.tests.map((t) => t.file))].slice(0, 2);
      return files.join('\n');
    }
    return picks
      .map(
        (path) =>
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -41,7 +41,9 @@ export async function handle(input) {\n   const parsed = schema.parse(input);\n-  const total = sum(parsed.items);\n+  const total = sum(parsed.items.filter(Boolean));\n+  if (total < 0) throw new RangeError('negative total');\n   return { ...parsed, total };\n`,
      )
      .join('');
  }, [analysis, dataset]);

  const entries = useMemo(() => (submitted === null ? [] : parseDiff(submitted)), [submitted]);
  const impact = useMemo(
    () =>
      submitted === null || entries.length === 0
        ? null
        : impactOfChange(
            dataset,
            index,
            analysis,
            index.changeSetOfPaths(entries.map((e) => ({ path: e.path, lines: e.added + e.deleted || 1 }))),
          ),
    [submitted, entries, dataset, index, analysis],
  );

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader
          title="Paste a change"
          subtitle={
            <>
              A unified diff, <Code>git diff --numstat</Code>, <Code>git diff --name-status</Code>, or one
              path per line. Analysed against the latest state of this project.
            </>
          }
        />
        <form
          className="px-5 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(text);
          }}
        >
          <label htmlFor="diff-input" className="sr-only">
            Diff or list of changed paths
          </label>
          <textarea
            id="diff-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={9}
            placeholder={'diff --git a/src/cart/service.ts b/src/cart/service.ts\n…'}
            className="scroll-thin w-full resize-y rounded-lg border border-line-strong bg-bg p-3 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-muted focus:border-s1"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={text.trim() === ''}>
              Analyse change
            </Button>
            <Button
              onClick={() => {
                setText(sample);
                setSubmitted(sample);
              }}
            >
              Use a sample diff
            </Button>
          </div>
        </form>
      </Card>

      {submitted !== null && entries.length === 0 && (
        <Card>
          <EmptyState title="No changed files found">
            The text does not look like a diff or a list of paths.
          </EmptyState>
        </Card>
      )}

      {impact && (
        <>
          <Card>
            <CardHeader title={`${plural(entries.length, 'changed file')}`} />
            <ul className="grid gap-1.5 border-t border-line px-5 py-3.5">
              {entries.map((e) => {
                const known = index.fileByPath(e.path) !== undefined;
                const isTest = index.testsInFile(e.path).length > 0;
                const kind = classifyPath(e.path);
                return (
                  <li key={e.path} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Code>{e.path}</Code>
                    <span className="num text-xs text-muted">
                      +{e.added} −{e.deleted}
                    </span>
                    <Badge tone={known || isTest ? 'accent' : kind === 'global' ? 'warn' : 'neutral'}>
                      {known
                        ? 'Source file'
                        : isTest
                          ? 'Test file'
                          : kind === 'global'
                            ? 'Forces a full run'
                            : kind === 'docs'
                              ? 'Documentation'
                              : 'Not in the graph'}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
          <ImpactPanel impact={impact} />
        </>
      )}
    </div>
  );
}
