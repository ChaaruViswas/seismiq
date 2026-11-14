/** Small domain-aware building blocks shared by several pages. */
import { Link } from 'react-router';
import { fmtPct, shortSha } from '../engine/format';
import { riskBand } from '../engine/impact';
import type { Commit, Dataset, TestCase, TestKind } from '../engine/types';
import { Badge, Code, cx, type Tone } from './ui';

export const testTitle = (t: TestCase) => `${t.suite} › ${t.name}`;

export function TestLink({ test, className }: { test: TestCase; className?: string }) {
  return (
    <Link to={`/tests/${test.id}`} className={cx('group min-w-0', className)} title={testTitle(test)}>
      <span className="block truncate text-[13px] font-medium text-ink group-hover:text-accent-ink group-hover:underline">
        {test.name}
      </span>
      <span className="block truncate font-mono text-[11px] text-muted">{test.suite}</span>
    </Link>
  );
}

const KIND_LABEL: Record<TestKind, string> = { unit: 'Unit', integration: 'Integration', e2e: 'End-to-end' };
export const kindLabel = (k: TestKind) => KIND_LABEL[k];
export function KindTag({ kind }: { kind: TestKind }) {
  return <span className="text-xs text-ink-2">{KIND_LABEL[kind]}</span>;
}

/** Conventional-commit subject without the trailing PR reference. */
export const commitSubject = (c: Commit) => c.message.replace(/\s*\(#\d+\)$/, '');

export function CommitLine({ commit, dataset }: { commit: Commit; dataset: Dataset }) {
  const paths = [...commit.changes.map((c) => dataset.files[c.file]!.path), ...commit.otherPaths];
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <Code>{shortSha(commit.sha)}</Code>
        <span className="min-w-0 truncate text-[13px] text-ink" title={commit.message}>
          {commitSubject(commit)}
        </span>
      </div>
      <div className="mt-0.5 truncate text-xs text-muted" title={paths.join('\n')}>
        {commit.author && <span>{commit.author} · </span>}
        {paths.length === 0
          ? 'no files recorded'
          : paths.length === 1
            ? paths[0]
            : `${paths[0]} +${paths.length - 1} more`}
      </div>
    </div>
  );
}

const BAND: Record<ReturnType<typeof riskBand>, { tone: Tone; label: string }> = {
  low: { tone: 'good', label: 'Low' },
  moderate: { tone: 'accent', label: 'Moderate' },
  elevated: { tone: 'warn', label: 'Elevated' },
  high: { tone: 'crit', label: 'High' },
};

export function RiskBadge({ risk, showValue = true }: { risk: number; showValue?: boolean }) {
  const band = BAND[riskBand(risk)];
  return (
    <Badge
      tone={band.tone}
      title={`Predicted chance that this change breaks at least one passing test: ${fmtPct(risk)}`}
    >
      {band.label}
      {showValue && <span className="num">{fmtPct(risk)}</span>}
    </Badge>
  );
}
export const riskLabel = (risk: number) => BAND[riskBand(risk)].label;

/** Compact status strip for table rows. Static: the row's other cells and the detail view carry the values. */
const MINI = [
  'var(--surface-2)',
  'color-mix(in oklab, var(--good) 45%, var(--surface))',
  'var(--crit)',
  'var(--neutral)',
  'var(--warn)',
];
export function MiniStrip({ statuses, label }: { statuses: number[]; label: string }) {
  const w = 3;
  return (
    <svg width={statuses.length * w} height={14} role="img" aria-label={label} className="block">
      {statuses.map((s, i) => (
        <rect key={i} x={i * w} y={0} width={w - 0.5} height={14} style={{ fill: MINI[s] }} />
      ))}
    </svg>
  );
}

/** Probability as a number with a proportional bar scaled to the largest value in view. */
export function ProbBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-surface-2 sm:block" aria-hidden>
        <span
          className="block h-full rounded-full bg-s1"
          style={{ width: `${Math.min(1, value / Math.max(max, 1e-9)) * 100}%` }}
        />
      </span>
      <span className="num w-12 text-right text-[13px] text-ink">
        {value >= 0.0995 ? fmtPct(value) : fmtPct(value, 1)}
      </span>
    </div>
  );
}
