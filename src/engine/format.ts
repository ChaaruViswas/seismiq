/** Formatting helpers shared by the UI, the CLI and the Markdown report. */

/** `850 ms`, `4.2 s`, `3m 05s`, `2h 14m`. */
export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const totalMin = Math.floor(s / 60);
  if (totalMin < 60) return `${totalMin}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(totalMin / 60);
  if (h < 48) return `${h}h ${String(totalMin % 60).padStart(2, '0')}m`;
  return `${Math.round(h / 24)}d`;
}

export function fmtPct(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '–';
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return '–';
  if (Math.abs(x) >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`;
  if (Math.abs(x) >= 10_000) return `${(x / 1000).toFixed(1)}K`;
  return Math.round(x).toLocaleString('en-US');
}

export const shortSha = (sha: string) => sha.slice(0, 7);

/** `Nov 13, 14:05` in UTC — the same on every machine, so screenshots and reports agree. */
export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** `5 min ago`, `3 h ago`, `12 d ago`. */
export function fmtAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
