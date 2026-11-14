import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  HelpCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import type { ClusterKind, RunOutcome, TestState } from '../engine/results';
import { Status, type StatusCode } from '../engine/types';

export type Tone = 'good' | 'warn' | 'serious' | 'crit' | 'accent' | 'neutral';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-line bg-surface', className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        `tone-${tone}`,
      )}
    >
      {children}
    </span>
  );
}

/** A headline number with its label and optional context line. */
export function Stat({
  label,
  value,
  hint,
  tone,
  help,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  help?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-2">
        {label}
        {help && <Help text={help} />}
      </div>
      <div className="mt-1 text-[26px] leading-tight font-semibold tracking-tight text-ink">{value}</div>
      {hint && (
        <div
          className={cx(
            'mt-1 text-xs',
            tone ? `inline-block rounded px-1.5 py-0.5 tone-${tone}` : 'text-muted',
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

/** Small "?" with an accessible tooltip. */
export function Help({ text }: { text: string }) {
  const id = useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={id}
        aria-label="More information"
        className="inline-flex rounded-full text-muted hover:text-ink-2"
      >
        <HelpCircle size={13} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 hidden w-60 -translate-x-1/2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs leading-relaxed font-normal text-ink-2 shadow-pop group-focus-within:block group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}

const STATE_META: Record<TestState, { label: string; tone: Tone; icon: typeof CheckCircle2; help: string }> =
  {
    healthy: { label: 'Healthy', tone: 'good', icon: CheckCircle2, help: 'Passes consistently.' },
    flaky: {
      label: 'Flaky',
      tone: 'warn',
      icon: AlertTriangle,
      help: 'Fails and passes on the same code, three or more times.',
    },
    suspect: {
      label: 'Suspect',
      tone: 'neutral',
      icon: HelpCircle,
      help: 'Two unexplained failures — not enough evidence yet.',
    },
    failing: { label: 'Failing', tone: 'crit', icon: XCircle, help: 'Failing on every attempt right now.' },
    stabilized: {
      label: 'Stabilized',
      tone: 'accent',
      icon: ShieldCheck,
      help: 'Was flaky; quiet for long enough that chance is unlikely.',
    },
    skipped: { label: 'Skipped', tone: 'neutral', icon: CircleSlash, help: 'Currently skipped.' },
    new: { label: 'New', tone: 'neutral', icon: Sparkles, help: 'Too few runs to judge.' },
  };

export function StateBadge({ state }: { state: TestState }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} title={meta.help}>
      <Icon size={12} aria-hidden />
      {meta.label}
    </Badge>
  );
}
export const stateLabel = (state: TestState) => STATE_META[state].label;

const OUTCOME_META: Record<RunOutcome, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  green: { label: 'Passed', tone: 'good', icon: CheckCircle2 },
  flaky: { label: 'Passed after retries', tone: 'warn', icon: RefreshCw },
  red: { label: 'Failed', tone: 'crit', icon: XCircle },
};

export function OutcomeBadge({ outcome, compact }: { outcome: RunOutcome; compact?: boolean }) {
  const meta = OUTCOME_META[outcome];
  const Icon = meta.icon;
  if (compact) {
    return (
      <span title={meta.label} className={cx('inline-flex rounded-full p-0.5', `tone-${meta.tone}`)}>
        <Icon size={14} aria-label={meta.label} />
      </span>
    );
  }
  return (
    <Badge tone={meta.tone}>
      <Icon size={12} aria-hidden />
      {meta.label}
    </Badge>
  );
}

const STATUS_META: Record<StatusCode, { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  [Status.NotRun]: { label: 'Not run', tone: 'neutral', icon: CircleDashed },
  [Status.Pass]: { label: 'Passed', tone: 'good', icon: CheckCircle2 },
  [Status.Fail]: { label: 'Failed', tone: 'crit', icon: XCircle },
  [Status.Skip]: { label: 'Skipped', tone: 'neutral', icon: CircleSlash },
  [Status.Flaky]: { label: 'Passed on retry', tone: 'warn', icon: RefreshCw },
};
export const statusLabel = (s: StatusCode) => STATUS_META[s].label;

export function StatusBadge({ status }: { status: StatusCode }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone}>
      <Icon size={12} aria-hidden />
      {meta.label}
    </Badge>
  );
}

const KIND_META: Record<ClusterKind, { label: string; tone: Tone }> = {
  regression: { label: 'Regression', tone: 'crit' },
  flaky: { label: 'Flaky', tone: 'warn' },
  infrastructure: { label: 'Infrastructure', tone: 'serious' },
};
export function KindBadge({ kind }: { kind: ClusterKind }) {
  return <Badge tone={KIND_META[kind].tone}>{KIND_META[kind].label}</Badge>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="num ml-1.5 text-xs text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-s1 text-white hover:brightness-110',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="mt-1 max-w-md text-[13px] text-ink-2">{children}</p>}
    </div>
  );
}

export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        {lead && <p className="mt-1 max-w-3xl text-[14px] text-ink-2">{lead}</p>}
      </div>
      {action}
    </div>
  );
}

/** Monospace chip for paths, SHAs and test ids. */
export function Code({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <code title={title} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ink-2">
      {children}
    </code>
  );
}

/** Slide-over panel with focus management and Escape to close. */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="scroll-thin absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-bg shadow-pop outline-none"
      >
        {children}
      </div>
    </div>
  );
}

/** A labelled meter: a ratio against its whole. The track is a lighter step of the fill. */
export function Meter({
  value,
  tone = 'accent',
  label,
}: {
  value: number;
  tone?: 'accent' | 'warn' | 'crit';
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = tone === 'accent' ? 'bg-s1' : tone === 'warn' ? 'bg-warn' : 'bg-crit';
  return (
    // A native <meter> cannot be styled consistently across browsers; this is its ARIA equivalent.
    // biome-ignore lint/a11y/useSemanticElements: styled meter with full ARIA semantics
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className={cx('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}
