import {
  Activity,
  BookOpen,
  BrainCircuit,
  Bug,
  CodeXml,
  FlaskConical,
  GitPullRequest,
  LayoutDashboard,
  Menu,
  Moon,
  Search,
  Sun,
  Timer,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { REPO_URL } from '../config';
import { shortSha } from '../engine/format';
import { useApp, useProject } from '../store';
import { commitSubject, testTitle } from './common';
import { Badge, cx } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/changes', label: 'Change impact', icon: GitPullRequest },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
  { to: '/flaky', label: 'Flaky tests', icon: Waves },
  { to: '/failures', label: 'Failures', icon: Bug },
  { to: '/pipeline', label: 'Pipeline', icon: Timer },
  { to: '/model', label: 'Model', icon: BrainCircuit },
  { to: '/import', label: 'Import data', icon: Upload },
  { to: '/about', label: 'How it works', icon: BookOpen },
];

function useTheme(): ['light' | 'dark', () => void] {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stamped = document.documentElement.dataset.theme;
    if (stamped === 'light' || stamped === 'dark') return stamped;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('seismiq:theme', next);
      } catch {
        // storage can be blocked; the toggle still works for this visit
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-bg">
        <Activity size={18} aria-hidden />
      </span>
      <span className="text-[16px] font-semibold tracking-tight text-ink">Seismiq</span>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
              isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )
          }
        >
          <Icon size={16} aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

interface PaletteItem {
  key: string;
  label: string;
  hint: string;
  to: string;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { dataset } = useProject();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const pages = NAV.map((n) => ({ key: `p${n.to}`, label: n.label, hint: 'Page', to: n.to }));
    if (!q) return pages;
    const out: PaletteItem[] = pages.filter((p) => p.label.toLowerCase().includes(q));
    for (const t of dataset.tests) {
      if (out.length >= 12) break;
      if (testTitle(t).toLowerCase().includes(q))
        out.push({ key: `t${t.id}`, label: testTitle(t), hint: 'Test', to: `/tests/${t.id}` });
    }
    const bare = q.replace(/^#/, '');
    for (let r = dataset.runs.length - 1; r >= 0 && out.length < 16; r--) {
      const run = dataset.runs[r]!;
      const commits = run.commits.map((c) => dataset.commits[c]!);
      const hit =
        String(run.number) === bare ||
        commits.some(
          (c) => (bare.length >= 4 && c.sha.startsWith(bare)) || c.message.toLowerCase().includes(q),
        );
      if (hit) {
        const first = commits[0];
        out.push({
          key: `r${r}`,
          label: `Run #${run.number}${first ? ` — ${commitSubject(first)}` : ''}`,
          hint: first ? shortSha(first.sha) : 'Run',
          to: `/changes/${r}`,
        });
      }
    }
    return out;
  }, [query, dataset]);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    navigate(item.to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-surface shadow-pop"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          <Search size={16} className="text-muted" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(items.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') go(items[cursor]);
              else if (e.key === 'Escape') onClose();
            }}
            placeholder="Search tests, runs, commits, pages…"
            aria-label="Search tests, runs, commits and pages"
            className="w-full bg-transparent py-3 text-[14px] text-ink outline-none placeholder:text-muted"
          />
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto p-1.5" aria-label="Results">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-muted">Nothing matches “{query}”.</li>
          )}
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => go(item)}
                aria-current={i === cursor ? 'true' : undefined}
                onPointerMove={() => setCursor(i)}
                className={cx(
                  'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px]',
                  i === cursor ? 'bg-surface-2 text-ink' : 'text-ink-2',
                )}
              >
                <span className="min-w-0 truncate">{item.label}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Layout() {
  const { dataset } = useProject();
  const busy = useApp((s) => s.status === 'loading');
  const [theme, toggleTheme] = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const main = useRef<HTMLElement>(null);

  // New page: back to the top, and move focus to the content for keyboard and screen-reader users.
  const section = location.pathname.split('/')[1] ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on section change only
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isDemo = dataset.meta.source === 'demo';

  return (
    <div className="min-h-dvh lg:pl-[232px]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow-pop"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-[232px] flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className="px-2 pb-5">
          <Logo />
        </div>
        <NavItems />
        <div className="mt-auto px-2 text-xs leading-relaxed text-muted">
          Everything runs in your browser.
          <br />
          No data leaves this page.
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 flex w-[264px] flex-col bg-surface px-3 py-4 shadow-pop"
          >
            <div className="flex items-center justify-between px-2 pb-5">
              <Logo />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <NavItems onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
          className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden"
        >
          <Menu size={18} aria-hidden />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-ink">{dataset.meta.name}</span>
          <Badge tone={isDemo ? 'accent' : 'good'} title={dataset.meta.description}>
            {isDemo ? 'Demo data' : 'Imported'}
          </Badge>
          {busy && <span className="text-xs text-muted">Updating…</span>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink-2"
          >
            <Search size={14} aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] sm:inline">
              Ctrl K
            </kbd>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
            className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <CodeXml size={16} aria-hidden />
          </a>
        </div>
      </header>

      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className="mx-auto w-full max-w-[1320px] px-4 py-6 outline-none sm:px-6"
      >
        <Suspense
          fallback={
            <div className="py-20 text-center text-[13px] text-muted" role="status">
              Loading…
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
