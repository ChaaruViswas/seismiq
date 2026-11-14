import { Copy, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { BarList } from '../components/charts';
import { kindLabel, MiniStrip, TestLink } from '../components/common';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Help,
  PageHeader,
  Stat,
  StateBadge,
} from '../components/ui';
import { fmtMs, fmtPct, plural } from '../engine/format';
import { quarantineCandidates, simulateQuarantine } from '../engine/quarantine';
import { CATEGORY_ADVICE, CATEGORY_LABEL } from '../engine/text';
import type { FlakeCategory } from '../engine/types';
import { useProject } from '../store';

export function Flaky() {
  const { dataset, analysis } = useProject();
  const [threshold, setThreshold] = useState(30);
  const [copied, setCopied] = useState(false);

  const flaky = useMemo(
    () =>
      analysis.tests
        .filter((s) => s.state === 'flaky' || s.state === 'suspect' || s.state === 'stabilized')
        .sort((a, b) => b.flakeScore - a.flakeScore || a.test - b.test),
    [analysis],
  );
  const active = flaky.filter((s) => s.state === 'flaky');
  const byCategory = useMemo(() => {
    const counts = new Map<FlakeCategory, number>();
    for (const s of active) if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const candidates = useMemo(() => quarantineCandidates(analysis, threshold), [analysis, threshold]);
  const what = useMemo(
    () => simulateQuarantine(dataset, analysis, new Set(candidates)),
    [dataset, analysis, candidates],
  );
  const totalRetry = active.reduce((s, t) => s + t.retryMs, 0);
  const lastRuns = Math.min(40, dataset.runs.length);

  const exportList = () => {
    const text = candidates
      .map((t) => `${dataset.tests[t]!.file} :: ${dataset.tests[t]!.suite} › ${dataset.tests[t]!.name}`)
      .join('\n');
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <>
      <PageHeader
        title="Flaky tests"
        lead="Tests that fail and pass on the same code. Detected from retries and from failures no code change explains, with a confidence interval, a likely cause and a fix-it hint."
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="Flaky now"
          value={active.length}
          hint={`${flaky.filter((s) => s.state === 'suspect').length} more suspected`}
        />
        <Stat
          label="Stabilized"
          value={flaky.filter((s) => s.state === 'stabilized').length}
          hint="Quiet long enough to call fixed"
        />
        <Stat
          label="Retry time on flaky tests"
          value={fmtMs(totalRetry)}
          hint="Failed attempts thrown away"
        />
        <Stat
          label="Runs disturbed by flakiness"
          value={fmtPct(
            analysis.health.runs > 0
              ? (analysis.health.flakyGreen + analysis.health.redByCause.flaky) / analysis.health.runs
              : 0,
          )}
          hint={`${analysis.health.redByCause.flaky} runs turned red by a flaky test`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Quarantine simulator"
            subtitle="Replay history as if the worst flaky tests could no longer fail the build. They keep running; they just stop blocking."
          />
          <div className="border-t border-line px-5 py-4">
            <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
              <span>Quarantine flaky tests with a score of at least</span>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                aria-label="Minimum flake score to quarantine"
                className="w-40"
              />
              <span className="num w-8 font-semibold text-ink">{threshold}</span>
              <span className="text-muted">→ {plural(candidates.length, 'test')}</span>
            </label>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Delta label="Green on first attempt" before={what.firstTryBefore} after={what.firstTryAfter} />
              <Delta label="Runs that ended green" before={what.passBefore} after={what.passAfter} />
              <div>
                <div className="text-xs text-muted">Red runs unblocked</div>
                <div className="num mt-0.5 text-[18px] font-semibold text-ink">{what.runsUnblocked}</div>
              </div>
              <div>
                <div className="text-xs text-muted">Retry time saved</div>
                <div className="num mt-0.5 text-[18px] font-semibold text-ink">
                  {fmtMs(what.retryMsSaved)}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px]">
              {what.blindIncidents.length === 0 ? (
                <span className="text-ink-2">
                  <span className="font-medium text-good-ink">No signal lost:</span> every real regression in
                  history was also caught by a test that stays active.
                </span>
              ) : (
                <span className="flex items-center gap-2 text-ink-2">
                  <ShieldOff size={15} className="shrink-0 text-crit-ink" aria-hidden />
                  <span>
                    <span className="font-medium text-crit-ink">Cost:</span>{' '}
                    {plural(what.blindIncidents.length, 'real regression')} would have been caught only by
                    quarantined tests.
                  </span>
                </span>
              )}
              <Button onClick={exportList} disabled={candidates.length === 0}>
                <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy quarantine list'}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Likely causes"
            subtitle="Root-cause family of each flaky test, classified from its failure messages."
          />
          <div className="border-t border-line px-5 py-4">
            {byCategory.length === 0 ? (
              <p className="text-[13px] text-ink-2">No flaky tests.</p>
            ) : (
              <BarList
                rows={byCategory.map(([c, n]) => ({
                  key: c,
                  label: CATEGORY_LABEL[c],
                  value: n,
                  title: CATEGORY_ADVICE[c],
                }))}
                format={(v) => plural(v, 'test')}
              />
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Ranked by flake score"
          subtitle="Score blends the recent and the all-time flake rate (0–100). The interval shows how sure we are."
        />
        {flaky.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState title="No flaky tests detected">
              Every failure in history is explained by a code change or an infrastructure incident.
            </EmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2 pr-2 pl-5 font-medium">Test</th>
                  <th className="px-2 py-2 font-medium">State</th>
                  <th className="px-2 py-2 text-right font-medium">Score</th>
                  <th className="px-2 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Flake rate{' '}
                      <Help text="Share of runs with a flake event, with its 95% Wilson confidence interval." />
                    </span>
                  </th>
                  <th className="px-2 py-2 font-medium">Likely cause</th>
                  <th className="px-2 py-2 text-right font-medium">Retry cost</th>
                  <th className="py-2 pr-5 pl-3 font-medium">Last {lastRuns} runs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {flaky.map((s) => {
                  const t = dataset.tests[s.test]!;
                  return (
                    <tr key={s.test} className="hover:bg-surface-2">
                      <td className="max-w-[320px] py-2 pr-2 pl-5">
                        <TestLink test={t} />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col items-start gap-1">
                          <StateBadge state={s.state} />
                          <span className="text-[11px] text-muted">{kindLabel(t.kind)}</span>
                        </div>
                      </td>
                      <td className="num px-2 py-2 text-right font-semibold text-ink">{s.flakeScore}</td>
                      <td className="num px-2 py-2 text-right whitespace-nowrap">
                        <span className="text-ink">{fmtPct(s.flakeRate, 1)}</span>
                        <span className="block text-[11px] text-muted">
                          {fmtPct(s.flakeLower, 1)}–{fmtPct(s.flakeUpper, 1)}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {s.category ? (
                          <Badge title={CATEGORY_ADVICE[s.category]}>{CATEGORY_LABEL[s.category]}</Badge>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className="num px-2 py-2 text-right text-ink-2">{fmtMs(s.retryMs)}</td>
                      <td className="py-2 pr-5 pl-3">
                        <MiniStrip
                          statuses={dataset.runs.slice(-lastRuns).map((r) => r.statuses[s.test]!)}
                          label={`Last ${lastRuns} results of ${t.name}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-5 py-2.5 text-xs text-muted">
          A test is flaky after three events; quiet for 30+ runs with under 2% chance of that by luck, it is
          marked stabilized.{' '}
          <Link to="/about" className="text-accent-ink underline underline-offset-2">
            Method
          </Link>
        </div>
      </Card>
    </>
  );
}

function Delta({ label, before, after }: { label: string; before: number; after: number }) {
  const diff = after - before;
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 text-[18px] font-semibold text-ink">
        {fmtPct(before)} → {fmtPct(after)}
      </div>
      <div className={diff > 0.0005 ? 'num text-xs text-good-ink' : 'num text-xs text-muted'}>
        {diff > 0.0005 ? `+${(diff * 100).toFixed(1)} points` : 'no change'}
      </div>
    </div>
  );
}
