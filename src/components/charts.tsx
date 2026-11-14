/**
 * Hand-written SVG charts. No chart library: every mark follows the same
 * small spec (2px lines, thin bars with a rounded data end, hairline grid,
 * a hover layer on everything), and the bundle stays small.
 */
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cx } from './ui';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => setWidth(Math.round(entries[0]!.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export type SeriesColor = 's1' | 's2' | 's3' | 'neutral';
const STROKE: Record<SeriesColor, string> = {
  s1: 'stroke-s1',
  s2: 'stroke-s2',
  s3: 'stroke-s3',
  neutral: 'stroke-neutral',
};
const FILL: Record<SeriesColor, string> = {
  s1: 'fill-s1',
  s2: 'fill-s2',
  s3: 'fill-s3',
  neutral: 'fill-neutral',
};
const BG: Record<SeriesColor, string> = { s1: 'bg-s1', s2: 'bg-s2', s3: 'bg-s3', neutral: 'bg-neutral' };

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function TooltipBox({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(160);
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  });
  const left = Math.max(0, Math.min(width - w, x + 12 + w > width ? x - 12 - w : x + 12));
  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-none absolute z-20 max-w-[280px] rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-xs shadow-pop"
      style={{ left, top: Math.max(0, y) }}
    >
      {children}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { label: string; color: SeriesColor | string; shape?: 'line' | 'rect' }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cx(
              item.shape === 'line' ? 'h-0.5 w-3.5 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]',
              item.color in BG ? BG[item.color as SeriesColor] : item.color,
            )}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface XYSeries {
  name: string;
  color: SeriesColor;
  points: { x: number; y: number }[];
  area?: boolean;
}

/** Line chart over a numeric x axis with a snapping crosshair and one tooltip for all series. */
export function XYChart({
  series,
  height = 220,
  xFormat = String,
  yFormat = String,
  yDomain,
  xTicks,
  ariaLabel,
  reference,
}: {
  series: XYSeries[];
  height?: number;
  xFormat?: (x: number) => string;
  yFormat?: (y: number) => string;
  yDomain?: [number, number];
  xTicks?: number[];
  ariaLabel: string;
  /** Optional straight reference line (e.g. the chance diagonal of a ROC plot). */
  reference?: { from: [number, number]; to: [number, number]; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 44, r: 14, t: 10, b: 26 };
  const xs = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
    [series],
  );
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const yMin = yDomain ? yDomain[0] : Math.min(0, ...allY);
  const yMaxRaw = yDomain ? yDomain[1] : Math.max(...allY, 0);
  const yTicks = niceTicks(yMin, yMaxRaw > yMin ? yMaxRaw : yMin + 1);
  const yMax = yDomain ? yDomain[1] : Math.max(yMaxRaw, yTicks[yTicks.length - 1]!);
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? 1;
  const plotW = Math.max(10, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + (x1 === x0 ? plotW / 2 : ((x - x0) / (x1 - x0)) * plotW);
  const sy = (y: number) => pad.t + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  const ticksX = xTicks ?? (xs.length <= 6 ? xs : niceTicks(x0, x1, 5).filter((t) => t >= x0 && t <= x1));

  const onMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < xs.length; i++)
      if (Math.abs(sx(xs[i]!) - px) < Math.abs(sx(xs[best]!) - px)) best = i;
    setHover(xs.length > 0 ? best : null);
  };
  const hx = hover !== null ? xs[hover]! : null;

  return (
    <div ref={ref} className="relative w-full">
      {series.length > 1 && (
        <div className="mb-2">
          <Legend items={series.map((s) => ({ label: s.name, color: s.color, shape: 'line' as const }))} />
        </div>
      )}
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block touch-pan-y"
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={sy(t)}
                y2={sy(t)}
                className="stroke-grid"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={sy(t)}
                dy="0.32em"
                textAnchor="end"
                className="num fill-muted text-[11px]"
              >
                {yFormat(t)}
              </text>
            </g>
          ))}
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={sy(yMin)}
            y2={sy(yMin)}
            className="stroke-axis"
            strokeWidth={1}
          />
          {ticksX.map((t) => (
            <text key={t} x={sx(t)} y={height - 8} textAnchor="middle" className="num fill-muted text-[11px]">
              {xFormat(t)}
            </text>
          ))}
          {reference && (
            <line
              x1={sx(reference.from[0])}
              y1={sy(reference.from[1])}
              x2={sx(reference.to[0])}
              y2={sy(reference.to[1])}
              className="stroke-axis"
              strokeWidth={1}
            />
          )}
          {series.map((s) => {
            if (s.points.length === 0) return null;
            const d = s.points
              .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
              .join('');
            const last = s.points[s.points.length - 1]!;
            return (
              <g key={s.name}>
                {s.area && (
                  <path
                    d={`${d}L${sx(last.x).toFixed(1)},${sy(yMin)}L${sx(s.points[0]!.x).toFixed(1)},${sy(yMin)}Z`}
                    className={FILL[s.color]}
                    opacity={0.1}
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  className={STROKE[s.color]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                <circle
                  cx={sx(last.x)}
                  cy={sy(last.y)}
                  r={4}
                  className={cx(FILL[s.color], 'stroke-surface')}
                  strokeWidth={2}
                />
              </g>
            );
          })}
          {hx !== null && (
            <g>
              <line
                x1={sx(hx)}
                x2={sx(hx)}
                y1={pad.t}
                y2={pad.t + plotH}
                className="stroke-axis"
                strokeWidth={1}
              />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hx);
                return p ? (
                  <circle
                    key={s.name}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={4}
                    className={cx(FILL[s.color], 'stroke-surface')}
                    strokeWidth={2}
                  />
                ) : null;
              })}
            </g>
          )}
        </svg>
      )}
      {hx !== null && (
        <TooltipBox x={sx(hx)} y={pad.t} width={width}>
          <div className="mb-1 text-muted">{xFormat(hx)}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hx);
            return p ? (
              <div key={s.name} className="flex items-center gap-2">
                <span aria-hidden className={cx('h-0.5 w-3 rounded-full', BG[s.color])} />
                <span className="num font-semibold text-ink">{yFormat(p.y)}</span>
                <span className="text-ink-2">{s.name}</span>
              </div>
            ) : null;
          })}
        </TooltipBox>
      )}
    </div>
  );
}

export interface StackKey {
  key: string;
  label: string;
  /** Tailwind fill class, e.g. `fill-good`. */
  fill: string;
  bg: string;
}

/** Stacked columns with a 2px surface gap between segments and a per-column tooltip. */
export function StackedColumns({
  data,
  keys,
  height = 200,
  ariaLabel,
  yFormat = String,
}: {
  data: { label: string; values: Record<string, number> }[];
  keys: StackKey[];
  height?: number;
  ariaLabel: string;
  yFormat?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 8, t: 8, b: 24 };
  const totals = data.map((d) => keys.reduce((s, k) => s + (d.values[k.key] ?? 0), 0));
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const yMax = Math.max(ticks[ticks.length - 1]!, ...totals);
  const plotW = Math.max(10, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const band = data.length > 0 ? plotW / data.length : plotW;
  const barW = Math.min(24, Math.max(4, band - 6));
  const sy = (v: number) => (v / yMax) * plotH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56))));
  return (
    <div ref={ref} className="relative w-full">
      <div className="mb-2">
        <Legend items={keys.map((k) => ({ label: k.label, color: k.bg }))} />
      </div>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setHover(null)}
          className="block"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={pad.t + plotH - sy(t)}
                y2={pad.t + plotH - sy(t)}
                className={t === 0 ? 'stroke-axis' : 'stroke-grid'}
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={pad.t + plotH - sy(t)}
                dy="0.32em"
                textAnchor="end"
                className="num fill-muted text-[11px]"
              >
                {yFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx0 = pad.l + band * i + band / 2;
            let acc = 0;
            const present = keys.filter((k) => (d.values[k.key] ?? 0) > 0);
            return (
              <g
                key={d.label}
                onPointerEnter={() => setHover(i)}
                opacity={hover === null || hover === i ? 1 : 0.55}
              >
                <rect x={pad.l + band * i} y={pad.t} width={band} height={plotH + pad.b} fill="transparent" />
                {present.map((k, j) => {
                  const h = sy(d.values[k.key]!);
                  const y = pad.t + plotH - acc - h;
                  acc += h;
                  const top = j === present.length - 1;
                  const gap = j === 0 ? 0 : 2;
                  const hh = Math.max(0.5, h - gap);
                  const r = top ? Math.min(4, hh, barW / 2) : 0;
                  return (
                    <path
                      key={k.key}
                      className={k.fill}
                      d={`M${cx0 - barW / 2},${y + hh}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${cx0 + barW / 2 - r}a${r},${r} 0 0 1 ${r},${r}V${y + hh}Z`}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={cx0} y={height - 7} textAnchor="middle" className="num fill-muted text-[11px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <TooltipBox x={pad.l + band * hover + band / 2} y={pad.t} width={width}>
          <div className="mb-1 text-muted">{data[hover].label}</div>
          {keys.map((k) => (
            <div key={k.key} className="flex items-center gap-2">
              <span aria-hidden className={cx('h-2 w-2 rounded-[2px]', k.bg)} />
              <span className="num font-semibold text-ink">{yFormat(data[hover]!.values[k.key] ?? 0)}</span>
              <span className="text-ink-2">{k.label}</span>
            </div>
          ))}
        </TooltipBox>
      )}
    </div>
  );
}

/** Ranked horizontal bars: one hue, value at the end, label on the left. */
export function BarList({
  rows,
  format = String,
  max,
  labelWidth = 'minmax(0,1.2fr)',
}: {
  rows: { key: string; label: ReactNode; value: number; title?: string; onClick?: () => void }[];
  format?: (v: number) => string;
  max?: number;
  labelWidth?: string;
}) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <ul
      className="grid gap-y-2"
      style={{ gridTemplateColumns: `${labelWidth} minmax(60px,1fr) auto`, columnGap: 12 }}
    >
      {rows.map((r) => {
        const body = (
          <>
            <span className="min-w-0 truncate text-[13px] text-ink" title={r.title}>
              {r.label}
            </span>
            <span className="flex items-center" aria-hidden>
              <span
                className="h-2 rounded-r-[4px] bg-s1"
                style={{
                  width: `${Math.max(0, Math.min(1, r.value / top)) * 100}%`,
                  minWidth: r.value > 0 ? 2 : 0,
                }}
              />
            </span>
            <span className="num text-right text-[13px] text-ink-2">{format(r.value)}</span>
          </>
        );
        return (
          <li key={r.key} className="col-span-3 grid grid-cols-subgrid items-center">
            {r.onClick ? (
              <button
                type="button"
                onClick={r.onClick}
                className="col-span-3 grid grid-cols-subgrid items-center rounded text-left hover:bg-surface-2"
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Bars growing left or right from a zero line. Blue lowers, red raises. */
export function DivergingBars({
  rows,
  format,
}: {
  rows: { key: string; label: string; value: number; detail?: string; title?: string }[];
  format: (v: number) => string;
}) {
  const top = Math.max(1e-9, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul
      className="grid gap-y-2"
      style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(80px,1fr) auto', columnGap: 12 }}
    >
      {rows.map((r) => {
        const share = (Math.abs(r.value) / top) * 50;
        return (
          <li key={r.key} className="col-span-3 grid grid-cols-subgrid items-center" title={r.title}>
            <span className="min-w-0 truncate text-[13px] text-ink">
              {r.label}
              {r.detail && <span className="ml-1.5 text-xs text-muted">{r.detail}</span>}
            </span>
            <span className="relative h-2" aria-hidden>
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-axis" />
              <span
                className={cx(
                  'absolute inset-y-0',
                  r.value >= 0 ? 'rounded-r-[4px] bg-[var(--pole-warm)]' : 'rounded-l-[4px] bg-s1',
                )}
                style={
                  r.value >= 0 ? { left: '50%', width: `${share}%` } : { right: '50%', width: `${share}%` }
                }
              />
            </span>
            <span className="num text-right text-[13px] text-ink-2">{format(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Tiny trend line for table rows and stat tiles. Decorative: the numbers beside it carry the values. */
export function Sparkline({
  values,
  width = 96,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sx = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const sy = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} aria-hidden className="block">
      <path
        d={d}
        fill="none"
        className="stroke-s1"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={sx(values.length - 1)} cy={sy(values[values.length - 1]!)} r={2.5} className="fill-s1" />
    </svg>
  );
}

const CELL_CLASS = [
  'fill-surface-2',
  'fill-[color-mix(in_oklab,var(--good)_45%,var(--surface))]',
  'fill-crit',
  'fill-neutral',
  'fill-warn',
];

/**
 * One cell per run, coloured by status. A legend and the hover readout carry
 * the meaning, so colour is never the only channel.
 */
export function HeatStrip({
  statuses,
  describeCell,
  onSelect,
  height = 22,
  ariaLabel,
}: {
  statuses: ArrayLike<number>;
  describeCell: (i: number) => string;
  onSelect?: (i: number) => void;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = statuses.length;
  const cell = n > 0 ? width / n : 0;
  const gap = cell >= 4 ? 1 : 0;
  const at = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - rect.left) / rect.width) * n)));
  };
  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className={cx('block', onSelect && 'cursor-pointer')}
          onPointerMove={(e) => setHover(at(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSelect?.(at(e as unknown as React.PointerEvent))}
        >
          {Array.from({ length: n }, (_, i) => (
            <rect
              key={i}
              x={i * cell}
              y={0}
              width={Math.max(0.5, cell - gap)}
              height={height}
              rx={cell >= 6 ? 2 : 0}
              className={CELL_CLASS[statuses[i]!]}
            />
          ))}
          {hover !== null && (
            <rect
              x={hover * cell - 1}
              y={0}
              width={Math.max(2, cell - gap + 2)}
              height={height}
              fill="none"
              className="stroke-ink"
              strokeWidth={1.5}
              rx={2}
            />
          )}
        </svg>
      )}
      {hover !== null && (
        <TooltipBox x={hover * cell} y={height + 6} width={width}>
          <span className="text-ink">{describeCell(hover)}</span>
        </TooltipBox>
      )}
    </div>
  );
}

export function StatusLegend() {
  return (
    <Legend
      items={[
        { label: 'Passed', color: 'bg-[color-mix(in_oklab,var(--good)_45%,var(--surface))]' },
        { label: 'Passed on retry', color: 'bg-warn' },
        { label: 'Failed', color: 'bg-crit' },
        { label: 'Skipped', color: 'bg-neutral' },
        { label: 'Not run', color: 'bg-surface-2' },
      ]}
    />
  );
}

export interface Tremor {
  failed: number;
  flaky: number;
  label: string;
  detail: string;
}

/**
 * The signature chart: every CI run as one trace on a seismogram. Hard
 * failures swing up, retried tests swing down, a quiet line means a calm
 * pipeline. Amplitude is on a square-root scale so that a single flaky retry
 * stays visible next to a 100-test outage; the axis is labelled accordingly.
 */
export function Seismograph({
  runs,
  height = 180,
  onSelect,
  ariaLabel,
}: {
  runs: Tremor[];
  height?: number;
  onSelect?: (i: number) => void;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 8, t: 10, b: 10 };
  const n = runs.length;
  const maxUp = Math.max(4, ...runs.map((r) => r.failed));
  const maxDown = Math.max(4, ...runs.map((r) => r.flaky));
  const plotW = Math.max(10, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  // Share the vertical space in proportion to each side's square-root range.
  const upH = (plotH * Math.sqrt(maxUp)) / (Math.sqrt(maxUp) + Math.sqrt(maxDown));
  const base = pad.t + upH;
  const unit = upH / Math.sqrt(maxUp);
  const step = n > 0 ? plotW / n : plotW;
  const barW = Math.max(1, Math.min(6, step - 1));
  const ticksUp = [1, 5, 20, 50, 100, 200].filter((t) => t <= maxUp);
  const ticksDown = [1, 5, 20].filter((t) => t <= maxDown);
  const at = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor((e.clientX - rect.left - pad.l) / step)));
  };
  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className={cx('block touch-pan-y', onSelect && 'cursor-pointer')}
          onPointerMove={(e) => setHover(n > 0 ? at(e) : null)}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => n > 0 && onSelect?.(at(e as unknown as React.PointerEvent))}
        >
          {ticksUp.map((t) => (
            <g key={`u${t}`}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={base - Math.sqrt(t) * unit}
                y2={base - Math.sqrt(t) * unit}
                className="stroke-grid"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={base - Math.sqrt(t) * unit}
                dy="0.32em"
                textAnchor="end"
                className="num fill-muted text-[11px]"
              >
                {t}
              </text>
            </g>
          ))}
          {ticksDown.map((t) => (
            <g key={`d${t}`}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={base + Math.sqrt(t) * unit}
                y2={base + Math.sqrt(t) * unit}
                className="stroke-grid"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={base + Math.sqrt(t) * unit}
                dy="0.32em"
                textAnchor="end"
                className="num fill-muted text-[11px]"
              >
                {t}
              </text>
            </g>
          ))}
          <line x1={pad.l} x2={width - pad.r} y1={base} y2={base} className="stroke-axis" strokeWidth={1} />
          {runs.map((r, i) => {
            const x = pad.l + step * i + (step - barW) / 2;
            const up = Math.sqrt(r.failed) * unit;
            const down = Math.sqrt(r.flaky) * unit;
            return (
              <g key={i}>
                {r.failed > 0 && (
                  <rect
                    x={x}
                    y={base - up}
                    width={barW}
                    height={up}
                    className="fill-crit"
                    rx={Math.min(1.5, barW / 2)}
                  />
                )}
                {r.flaky > 0 && (
                  <rect
                    x={x}
                    y={base + 1}
                    width={barW}
                    height={down}
                    className="fill-warn"
                    rx={Math.min(1.5, barW / 2)}
                  />
                )}
              </g>
            );
          })}
          {hover !== null && (
            <line
              x1={pad.l + step * hover + step / 2}
              x2={pad.l + step * hover + step / 2}
              y1={pad.t}
              y2={height - pad.b}
              className="stroke-ink"
              strokeWidth={1}
              opacity={0.5}
            />
          )}
        </svg>
      )}
      {hover !== null && runs[hover] && (
        <TooltipBox x={pad.l + step * hover + step / 2} y={pad.t} width={width}>
          <div className="font-medium text-ink">{runs[hover].label}</div>
          <div className="mt-0.5 flex gap-3">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-crit" />
              <span className="num font-semibold text-ink">{runs[hover].failed}</span>
              <span className="text-ink-2">failed</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-warn" />
              <span className="num font-semibold text-ink">{runs[hover].flaky}</span>
              <span className="text-ink-2">retried</span>
            </span>
          </div>
          <div className="mt-1 max-w-[240px] truncate text-ink-2">{runs[hover].detail}</div>
        </TooltipBox>
      )}
    </div>
  );
}

export interface RibbonNode {
  key: string;
  label: string;
  sub?: string;
  weight: number;
}

/**
 * Blast radius of a change: changed files on the left, the modules whose tests
 * they reach on the right, ribbons sized by the number of affected tests.
 */
export function RibbonGraph({
  left,
  right,
  links,
  ariaLabel,
}: {
  left: RibbonNode[];
  right: RibbonNode[];
  links: { from: string; to: string; weight: number }[];
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<string | null>(null);
  const rowGap = 6;
  const minH = 18;
  const layout = (nodes: RibbonNode[], scale: number) => {
    let y = 0;
    return nodes.map((n) => {
      const h = Math.max(minH, n.weight * scale);
      const box = { ...n, y, h };
      y += h + rowGap;
      return box;
    });
  };
  const totalL = left.reduce((s, n) => s + n.weight, 0);
  const totalR = right.reduce((s, n) => s + n.weight, 0);
  const targetH = Math.max(140, Math.min(420, Math.max(left.length, right.length) * 30));
  const scale = Math.min(targetH / Math.max(1, totalL), targetH / Math.max(1, totalR));
  const L = layout(left, scale);
  const R = layout(right, scale);
  const height =
    Math.max(
      L.length > 0 ? L[L.length - 1]!.y + L[L.length - 1]!.h : 0,
      R.length > 0 ? R[R.length - 1]!.y + R[R.length - 1]!.h : 0,
    ) + 2;
  const narrow = width < 520;
  const labelW = narrow ? 104 : 190;
  const nodeW = 6;
  const xL = labelW + 8;
  const xR = width - labelW - 8 - nodeW;
  const offsetL = new Map(L.map((n) => [n.key, 0]));
  const offsetR = new Map(R.map((n) => [n.key, 0]));
  const byL = new Map(L.map((n) => [n.key, n]));
  const byR = new Map(R.map((n) => [n.key, n]));
  const ribbons = links
    .filter((l) => byL.has(l.from) && byR.has(l.to))
    .map((l) => {
      const a = byL.get(l.from)!;
      const b = byR.get(l.to)!;
      const hA = (l.weight / Math.max(1e-9, a.weight)) * a.h;
      const hB = (l.weight / Math.max(1e-9, b.weight)) * b.h;
      const yA = a.y + offsetL.get(a.key)!;
      const yB = b.y + offsetR.get(b.key)!;
      offsetL.set(a.key, offsetL.get(a.key)! + hA);
      offsetR.set(b.key, offsetR.get(b.key)! + hB);
      const x0 = xL + nodeW;
      const mid = (x0 + xR) / 2;
      return {
        ...l,
        d: `M${x0},${yA}C${mid},${yA} ${mid},${yB} ${xR},${yB}L${xR},${yB + hB}C${mid},${yB + hB} ${mid},${yA + hA} ${x0},${yA + hA}Z`,
      };
    });
  const active = (l: { from: string; to: string }) => focus === null || l.from === focus || l.to === focus;
  const trim = (s: string, n: number) => (s.length > n ? `…${s.slice(s.length - n + 1)}` : s);
  const chars = narrow ? 15 : 28;
  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block"
          onPointerLeave={() => setFocus(null)}
        >
          {ribbons.map((l) => (
            <path
              key={`${l.from}>${l.to}`}
              d={l.d}
              className="fill-s1"
              opacity={active(l) ? (focus ? 0.45 : 0.22) : 0.05}
            >
              <title>{`${l.weight} test${l.weight === 1 ? '' : 's'}`}</title>
            </path>
          ))}
          {L.map((n) => (
            <g
              key={n.key}
              onPointerEnter={() => setFocus(n.key)}
              opacity={
                focus === null || focus === n.key || links.some((l) => l.from === n.key && l.to === focus)
                  ? 1
                  : 0.4
              }
            >
              <rect x={0} y={n.y} width={xL + nodeW} height={n.h} fill="transparent" />
              <rect x={xL} y={n.y} width={nodeW} height={n.h} rx={2} className="fill-s1" />
              <text
                x={xL - 8}
                y={n.y + n.h / 2}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink font-mono text-[11px]"
              >
                <title>{n.label}</title>
                {trim(n.label, chars)}
              </text>
            </g>
          ))}
          {R.map((n) => (
            <g
              key={n.key}
              onPointerEnter={() => setFocus(n.key)}
              opacity={
                focus === null || focus === n.key || links.some((l) => l.to === n.key && l.from === focus)
                  ? 1
                  : 0.4
              }
            >
              <rect x={xR} y={n.y} width={width - xR} height={n.h} fill="transparent" />
              <rect x={xR} y={n.y} width={nodeW} height={n.h} rx={2} className="fill-s1" />
              <text x={xR + nodeW + 8} y={n.y + n.h / 2} dy="0.32em" className="fill-ink text-[12px]">
                {trim(n.label, chars - 8)}
                {n.sub && <tspan className="num fill-muted text-[11px]">{`  ${n.sub}`}</tspan>}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}
