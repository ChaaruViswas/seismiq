/**
 * Deterministic generator of a realistic CI history for a mid-sized monorepo.
 *
 * It plants known causes — regressions, flaky tests, infrastructure incidents,
 * slowdowns, couplings invisible to static analysis — and records them as
 * ground truth. The engine never reads that truth; it is used only to score
 * how well the engine recovers what was planted (see `evaluate.ts`).
 */
import { Rng } from './rng';
import {
  type Commit,
  type Dataset,
  type FailureRecord,
  type FileChange,
  type FlakeCategory,
  type GroundTruth,
  type Run,
  type SourceFile,
  Status,
  type TestCase,
  type TestKind,
} from './types';

export interface SimOptions {
  seed?: number;
  /** Timestamp of the most recent run (defaults to now). */
  endTime?: number;
  days?: number;
  runs?: number;
}

interface ModuleSpec {
  name: string;
  team: string;
  deps: string[];
}

// Listed in dependency order: a module only depends on modules above it.
const MODULES: ModuleSpec[] = [
  { name: 'core', team: 'platform', deps: [] },
  { name: 'db', team: 'platform', deps: ['core'] },
  { name: 'cache', team: 'platform', deps: ['core'] },
  { name: 'http', team: 'platform', deps: ['core'] },
  { name: 'events', team: 'platform', deps: ['core'] },
  { name: 'auth', team: 'identity', deps: ['core', 'db', 'cache', 'http'] },
  { name: 'users', team: 'identity', deps: ['core', 'db', 'events'] },
  { name: 'catalog', team: 'storefront', deps: ['core', 'db', 'cache'] },
  { name: 'inventory', team: 'fulfilment', deps: ['core', 'db', 'events'] },
  { name: 'pricing', team: 'payments', deps: ['core', 'db', 'cache'] },
  { name: 'payments', team: 'payments', deps: ['core', 'http', 'events', 'db'] },
  { name: 'notifications', team: 'fulfilment', deps: ['core', 'http', 'events'] },
  { name: 'search', team: 'storefront', deps: ['core', 'http', 'cache', 'catalog'] },
  { name: 'cart', team: 'storefront', deps: ['core', 'catalog', 'pricing', 'inventory', 'cache'] },
  { name: 'checkout', team: 'payments', deps: ['core', 'cart', 'payments', 'pricing', 'users'] },
  { name: 'orders', team: 'fulfilment', deps: ['core', 'db', 'checkout', 'inventory', 'notifications'] },
  { name: 'shipping', team: 'fulfilment', deps: ['core', 'orders', 'inventory', 'http'] },
  { name: 'billing', team: 'payments', deps: ['core', 'orders', 'payments', 'db'] },
  { name: 'analytics', team: 'insights', deps: ['core', 'events', 'db'] },
  {
    name: 'gateway',
    team: 'platform',
    deps: ['core', 'http', 'auth', 'users', 'catalog', 'cart', 'checkout', 'orders', 'search'],
  },
  { name: 'admin', team: 'insights', deps: ['core', 'http', 'auth', 'analytics', 'billing'] },
  { name: 'web', team: 'storefront', deps: ['core', 'http', 'auth', 'gateway'] },
];

const CORE_FILES = [
  'logger',
  'config',
  'errors',
  'result',
  'dates',
  'money',
  'validation',
  'retry',
  'ids',
  'env',
];
const FILE_POOL = [
  'model',
  'schema',
  'validators',
  'mapper',
  'repository',
  'queries',
  'client',
  'policy',
  'service',
  'events',
  'handlers',
  'controller',
  'routes',
];

const AUTHORS: { name: string; team: string; care: number }[] = [
  { name: 'Aisha Rahman', team: 'platform', care: 0.7 },
  { name: 'Mateo Alvarez', team: 'platform', care: 1.0 },
  { name: 'Priya Natarajan', team: 'identity', care: 0.8 },
  { name: 'Jonas Lindqvist', team: 'identity', care: 1.3 },
  { name: 'Chen Wei', team: 'storefront', care: 0.9 },
  { name: 'Sofia Marchetti', team: 'storefront', care: 1.1 },
  { name: 'Kwame Mensah', team: 'payments', care: 0.8 },
  { name: 'Hana Kobayashi', team: 'payments', care: 1.4 },
  { name: 'Lucas Oliveira', team: 'fulfilment', care: 1.0 },
  { name: 'Emma Novak', team: 'fulfilment', care: 1.2 },
  { name: 'Daniel Okafor', team: 'insights', care: 1.0 },
];

const UNIT_PHRASES = [
  'returns the expected shape',
  'rejects an invalid payload',
  'handles empty input',
  'retries on a transient error',
  'maps every field',
  'emits an event on success',
  'respects pagination limits',
  'caches repeated lookups',
  'throws when the id is missing',
  'normalises whitespace and casing',
  'is idempotent for duplicate requests',
  'rounds currency half-even',
];
const INTEGRATION_PHRASES = [
  'persists and reloads an aggregate',
  'rolls back on a failed write',
  'publishes domain events in order',
  'enforces tenant isolation',
  'serves a warm cache hit',
  'recovers after a dependency timeout',
  'applies migrations cleanly',
];
const E2E_FLOWS: [flow: string, title: string, modules: string[]][] = [
  ['signup', 'new visitor can create an account', ['web', 'gateway', 'auth', 'users']],
  ['login', 'returning user signs in with password', ['web', 'gateway', 'auth']],
  ['login', 'locked account shows a recovery prompt', ['web', 'gateway', 'auth']],
  ['browse', 'catalog lists products by category', ['web', 'gateway', 'catalog']],
  ['browse', 'product page shows live stock', ['web', 'gateway', 'catalog', 'inventory']],
  ['search', 'search returns ranked results', ['web', 'gateway', 'search']],
  ['search', 'search suggests corrections for typos', ['web', 'gateway', 'search']],
  ['cart', 'adds and removes items from the cart', ['web', 'gateway', 'cart']],
  ['cart', 'cart total applies a promo code', ['web', 'gateway', 'cart', 'pricing']],
  ['checkout', 'completes a purchase with a saved card', ['web', 'gateway', 'checkout', 'payments']],
  ['checkout', 'declined card shows a retry option', ['web', 'gateway', 'checkout', 'payments']],
  ['checkout', 'guest checkout collects an address', ['web', 'gateway', 'checkout', 'users']],
  ['orders', 'order history lists past purchases', ['web', 'gateway', 'orders']],
  ['orders', 'customer cancels a pending order', ['web', 'gateway', 'orders', 'inventory']],
  ['shipping', 'tracking page shows carrier updates', ['web', 'gateway', 'shipping']],
  ['billing', 'invoice downloads as a PDF', ['web', 'gateway', 'billing']],
  ['billing', 'refund reaches the original payment method', ['admin', 'billing', 'payments']],
  ['admin', 'admin edits a product price', ['admin', 'auth', 'pricing']],
  ['admin', 'admin dashboard renders revenue charts', ['admin', 'analytics']],
  ['notifications', 'order confirmation email is queued', ['gateway', 'orders', 'notifications']],
  ['profile', 'user updates a shipping address', ['web', 'gateway', 'users']],
  ['profile', 'user enables two-factor authentication', ['web', 'gateway', 'auth', 'users']],
];

const COMMIT_SUBJECTS: Record<string, string[]> = {
  feat: [
    'add bulk endpoint',
    'support partial updates',
    'expose filtering by status',
    'add idempotency keys',
    'introduce soft delete',
    'add audit trail',
    'support cursor pagination',
    'add rate limit headers',
  ],
  fix: [
    'handle null response',
    'guard against empty list',
    'correct off-by-one in paging',
    'restore default timeout',
    'await pending writes before returning',
    'use stable sort for results',
  ],
  refactor: [
    'extract shared helper',
    'simplify error mapping',
    'split large handler',
    'replace callbacks with async/await',
    'inline single-use wrapper',
  ],
  perf: ['batch lookups', 'memoise expensive selector', 'avoid N+1 query', 'stream large responses'],
  chore: ['tidy types', 'rename internal symbols', 'update fixtures'],
};

const PROPS = ['id', 'price', 'items', 'status', 'email', 'total', 'currency', 'sku', 'address', 'token'];

const FLAKY_TEMPLATES: Record<
  Exclude<FlakeCategory, 'infrastructure' | 'assertion' | 'unknown'>,
  string[]
> = {
  timeout: [
    'Error: Test timed out in 5000ms.\nIf this is a long-running test, pass a timeout value as the last argument.',
    'TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole("button", { name: "Continue" })',
    'Error: waitFor timed out after 1000ms waiting for the element to appear',
  ],
  network: [
    'FetchError: request to http://localhost:4010/api/v1/resource failed, reason: socket hang up',
    'Error: connect ECONNREFUSED 127.0.0.1:5432',
    'Error: read ECONNRESET\n    at TLSWrap.onStreamRead (node:internal/stream_base_commons:216:20)',
  ],
  concurrency: [
    'AssertionError: expected "spy" to be called 2 times, but got 1 times',
    'Error: Cannot log after tests are done. Did you forget to wait for something async in your test?',
    'AssertionError: expected promise to be settled before assertion — unhandled race between writers',
  ],
  'order-dependency': [
    'Error: duplicate key value violates unique constraint "users_email_key"',
    'AssertionError: expected store to be empty but found 3 leftover records from a previous test',
  ],
  time: [
    "AssertionError: expected '2026-03-01' to equal '2026-02-28'",
    'AssertionError: expected token to be expired at 23:59:59.999 but clock read 00:00:00.004',
  ],
  resource: [
    'Error: listen EADDRINUSE: address already in use :::3000',
    'Error: EMFILE: too many open files, open "/tmp/fixtures/large.json"',
    'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
  ],
};

const INFRA_TEMPLATES = [
  'Error: connect ETIMEDOUT 10.0.3.17:5432 — database service container is not healthy',
  'Error: ENOSPC: no space left on device, write',
  'Error: Failed to launch browser: spawn /ms-playwright/chromium/chrome ENOENT',
  'Error: getaddrinfo EAI_AGAIN registry.internal.example.com',
];

const GLOBAL_PATHS = [
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  '.github/workflows/ci.yml',
  'Dockerfile',
];
const DOC_PATHS = ['README.md', 'docs/architecture.md', 'docs/runbook.md', 'CHANGELOG.md'];

interface ActiveBug {
  commit: number;
  file: number;
  tests: number[];
  message: string;
  fixRun: number;
  truthIndex: number;
}

export function simulate(opts: SimOptions = {}): Dataset {
  const seed = opts.seed ?? 20260;
  const rng = new Rng(seed);
  const days = opts.days ?? 90;
  const nRuns = opts.runs ?? 380;
  const endTime = opts.endTime ?? Date.now();

  // ---- repository: files and import graph ----------------------------------
  const files: SourceFile[] = [];
  const deps: [number, number][] = [];
  const filesByModule = new Map<string, number[]>();
  const hotness: number[] = [];
  const bugProne: number[] = [];
  const moduleTeam = new Map(MODULES.map((m) => [m.name, m.team]));

  for (const mod of MODULES) {
    const names = mod.name === 'core' ? CORE_FILES : FILE_POOL.slice(0, rng.int(6, 10));
    const ext = mod.name === 'web' || mod.name === 'admin' ? 'tsx' : 'ts';
    const ids: number[] = [];
    for (const name of names) {
      const id = files.length;
      files.push({
        id,
        path: `src/${mod.name}/${name}.${ext}`,
        module: mod.name,
        loc: Math.round(rng.logNormal(160, 0.6)),
      });
      hotness.push(0.3 + 5 * rng.next() ** 3);
      bugProne.push(0.5 + 2.2 * rng.next() ** 2);
      // Imports inside the module only point "down" the list, keeping the graph acyclic.
      if (ids.length > 0) {
        for (const dep of rng.sample(ids, Math.min(ids.length, rng.int(1, 3)))) deps.push([id, dep]);
      }
      if (mod.deps.length > 0) {
        const depMods = rng.sample(mod.deps, rng.int(1, Math.min(3, mod.deps.length)));
        for (const dm of depMods) {
          const candidates = filesByModule.get(dm)!;
          deps.push([id, rng.pick(candidates)]);
        }
      }
      ids.push(id);
    }
    filesByModule.set(mod.name, ids);
  }

  const importsOf: number[][] = files.map(() => []);
  for (const [from, to] of deps) importsOf[from]!.push(to);

  // ---- tests ----------------------------------------------------------------
  const tests: TestCase[] = [];
  const trueCoverage: Set<number>[] = [];
  const baseDuration: number[] = [];
  const addedAt: number[] = [];

  const coverageFor = (targets: number[], kind: TestKind): Set<number> => {
    const maxDepth = kind === 'unit' ? 2 : kind === 'integration' ? 4 : 99;
    const follow = kind === 'unit' ? 0.6 : kind === 'integration' ? 0.8 : 0.9;
    const seen = new Set<number>(targets);
    let frontier = targets.slice();
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const f of frontier) {
        for (const d of importsOf[f]!) {
          if (!seen.has(d) && rng.chance(follow)) {
            seen.add(d);
            next.push(d);
          }
        }
      }
      frontier = next;
    }
    return seen;
  };

  const addTest = (t: Omit<TestCase, 'id' | 'coverage' | 'owner'>, medianMs: number, sigma: number) => {
    const id = tests.length;
    const truth = coverageFor(t.targets, t.kind);
    // The recorded coverage map is slightly stale: it misses a few files the test really executes.
    const recorded = [...truth].filter((f) => t.targets.includes(f) || !rng.chance(0.06));
    tests.push({
      ...t,
      id,
      owner: moduleTeam.get(t.module) ?? 'platform',
      coverage: recorded.sort((a, b) => a - b),
    });
    trueCoverage.push(truth);
    baseDuration.push(rng.logNormal(medianMs, sigma));
    addedAt.push(rng.chance(0.1) ? rng.int(Math.floor(nRuns * 0.1), Math.floor(nRuns * 0.85)) : 0);
  };

  for (const mod of MODULES) {
    const ids = filesByModule.get(mod.name)!;
    for (const fid of ids) {
      const file = files[fid]!;
      const base = file.path.replace(/^src\//, '').replace(/\.tsx?$/, '');
      const count = rng.weighted([0.08, 0.3, 0.42, 0.2]);
      for (const phrase of rng.sample(UNIT_PHRASES, count)) {
        addTest(
          {
            name: phrase,
            suite: base,
            file: file.path.replace(/\.(tsx?)$/, '.test.$1'),
            module: mod.name,
            kind: 'unit',
            targets: [fid],
          },
          320,
          0.7,
        );
      }
    }
    for (const phrase of rng.sample(INTEGRATION_PHRASES, rng.int(3, 5))) {
      addTest(
        {
          name: phrase,
          suite: `integration/${mod.name}`,
          file: `tests/integration/${mod.name}.spec.ts`,
          module: mod.name,
          kind: 'integration',
          targets: rng.sample(ids, rng.int(2, 4)).sort((a, b) => a - b),
        },
        4200,
        0.5,
      );
    }
  }
  for (const [flow, title, mods] of E2E_FLOWS) {
    const targets = new Set<number>();
    for (const m of mods) for (const f of rng.sample(filesByModule.get(m)!, rng.int(1, 2))) targets.add(f);
    addTest(
      {
        name: title,
        suite: `e2e/${flow}`,
        file: `e2e/${flow}.spec.ts`,
        module: mods[mods.length - 1]!,
        kind: 'e2e',
        targets: [...targets].sort((a, b) => a - b),
      },
      24000,
      0.35,
    );
  }
  const nTests = tests.length;

  // Static reachability (full transitive closure) — what an import-graph analysis would see.
  const staticReach: Set<number>[] = tests.map((t) => {
    const seen = new Set<number>(t.targets);
    const stack = t.targets.slice();
    while (stack.length > 0) {
      for (const d of importsOf[stack.pop()!]!) {
        if (!seen.has(d)) {
          seen.add(d);
          stack.push(d);
        }
      }
    }
    return seen;
  });

  // Couplings no static analysis can see (shared DB tables, HTTP contracts, feature flags).
  const hiddenCouplings: [number, number][] = [];
  const hiddenByFile = new Map<number, number[]>();
  const broadTests = tests.filter((t) => t.kind !== 'unit');
  for (let guard = 0; hiddenCouplings.length < 12 && guard < 500; guard++) {
    const t = rng.pick(broadTests);
    const f = rng.int(0, files.length - 1);
    if (staticReach[t.id]!.has(f) || files[f]!.module === 'core') continue;
    hiddenCouplings.push([f, t.id]);
    hiddenByFile.set(f, [...(hiddenByFile.get(f) ?? []), t.id]);
  }

  const testsCovering: number[][] = files.map(() => []);
  for (const t of tests) for (const f of trueCoverage[t.id]!) testsCovering[f]!.push(t.id);

  // ---- flaky tests, skipped stretches, infrastructure incidents ---------------
  const flakyRate = new Float64Array(nTests);
  const flakyFrom = new Int32Array(nTests);
  const flakyTo = new Int32Array(nTests).fill(nRuns);
  const flakyMessage: string[] = new Array(nTests).fill('');
  const truth: GroundTruth = { flaky: [], regressions: [], slowdowns: [], infraRuns: [], hiddenCouplings };
  const categories = Object.keys(FLAKY_TEMPLATES) as (keyof typeof FLAKY_TEMPLATES)[];
  for (const t of tests) {
    const p = t.kind === 'unit' ? 0.02 : t.kind === 'integration' ? 0.06 : 0.22;
    if (!rng.chance(p)) continue;
    const rate = Math.exp(rng.range(Math.log(0.015), Math.log(0.11)));
    const category =
      t.kind === 'e2e'
        ? rng.pick(['timeout', 'timeout', 'network', 'concurrency', 'resource'] as const)
        : rng.pick(categories);
    let from = addedAt[t.id]!;
    let to = nRuns;
    // A quarter of flaky tests start late; a quarter of the rest stop early.
    const startsLate = rng.chance(0.25);
    if (startsLate) from = Math.max(from, rng.int(Math.floor(nRuns * 0.15), Math.floor(nRuns * 0.5)));
    else if (rng.chance(0.25)) to = rng.int(Math.floor(nRuns * 0.55), Math.floor(nRuns * 0.85));
    if (to - from < nRuns * 0.3) to = Math.min(nRuns, from + Math.floor(nRuns * 0.3));
    flakyRate[t.id] = rate;
    flakyFrom[t.id] = from;
    flakyTo[t.id] = to;
    flakyMessage[t.id] = rng.pick(FLAKY_TEMPLATES[category]);
    truth.flaky.push({ test: t.id, rate, category, fromRun: from, toRun: to });
  }

  const skipFrom = new Int32Array(nTests).fill(-1);
  const skipTo = new Int32Array(nTests).fill(-1);
  for (const t of rng.sample(tests, 5)) {
    skipFrom[t.id] = rng.int(Math.floor(nRuns * 0.2), Math.floor(nRuns * 0.7));
    skipTo[t.id] = skipFrom[t.id]! + rng.int(10, 60);
  }

  const infra = new Map<number, { fraction: number; message: string }>();
  for (const message of rng.sample(INFRA_TEMPLATES, 4)) {
    const run = rng.int(20, nRuns - 5);
    if (infra.has(run)) continue;
    infra.set(run, { fraction: rng.range(0.1, 0.3), message });
    truth.infraRuns.push(run);
  }
  truth.infraRuns.sort((a, b) => a - b);

  // ---- timeline ---------------------------------------------------------------
  // The clock has its own generator: which timestamps are accepted depends on the
  // calendar (weekends, "now"), and that must not shift the random stream that
  // decides what happens in each run. Same seed → same story, whenever it is viewed.
  const clock = new Rng(seed ^ 0x5bd1e995);
  const DAY = 86_400_000;
  const startDay = Math.floor(endTime / DAY) * DAY - (days - 1) * DAY;
  const stamps: number[] = [];
  while (stamps.length < nRuns - 1) {
    const day = startDay + clock.int(0, days - 1) * DAY;
    const dow = new Date(day).getUTCDay();
    if ((dow === 0 || dow === 6) && !clock.chance(0.12)) continue;
    const hour = Math.min(21.5, Math.max(7, 13.5 + 3 * clock.normal()));
    const ts = day + Math.round(hour * 3_600_000);
    if (ts < endTime - 600_000) stamps.push(ts);
  }
  stamps.push(endTime - 25 * 60_000);
  stamps.sort((a, b) => a - b);

  // ---- commits and runs ----------------------------------------------------------
  const commits: Commit[] = [];
  const runs: Run[] = [];
  const failures: FailureRecord[] = [];
  const active: ActiveBug[] = [];
  const slowFrom = new Int32Array(nTests).fill(-1);
  const slowFactor = new Float32Array(nTests).fill(1);
  let pr = 2100;

  const modulesOfTeam = (team: string) => MODULES.filter((m) => m.team === team).map((m) => m.name);

  const pickFiles = (moduleName: string): number[] => {
    const ids = filesByModule.get(moduleName)!;
    const n = Math.min(ids.length, 1 + rng.weighted([0.42, 0.28, 0.16, 0.09, 0.05]));
    const chosen = new Set<number>();
    for (let guard = 0; chosen.size < n && guard < 40; guard++) {
      chosen.add(ids[rng.weighted(ids.map((f) => hotness[f]!))]!);
    }
    return [...chosen];
  };

  const regressionMessage = (file: SourceFile): string => {
    const line = rng.int(12, Math.max(20, file.loc));
    const site = `    at ${rng.pick(['handle', 'execute', 'resolve', 'apply', 'load'])} (${file.path}:${line}:${rng.int(3, 40)})`;
    const head = rng.pick([
      `TypeError: Cannot read properties of undefined (reading '${rng.pick(PROPS)}')`,
      `AssertionError: expected ${rng.int(2, 90)} to equal ${rng.int(2, 90)}`,
      `Error: expected status 200 but received ${rng.pick([400, 404, 409, 500])}`,
      `AssertionError: expected { ${rng.pick(PROPS)}: undefined } to deeply equal { ${rng.pick(PROPS)}: 'ok' }`,
      `RangeError: Invalid ${rng.pick(['time value', 'array length', 'currency code'])}`,
    ]);
    return `${head}\n${site}`;
  };

  for (let r = 0; r < nRuns; r++) {
    const runTime = stamps[r]!;
    const runCommits: number[] = [];

    // Fixes that are due land first.
    for (let i = active.length - 1; i >= 0; i--) {
      const bug = active[i]!;
      if (bug.fixRun > r) continue;
      const origin = commits[bug.commit]!;
      const file = files[bug.file]!;
      const sameAuthor = rng.chance(0.7);
      const isRevert = rng.chance(0.2);
      const idx = commits.length;
      commits.push({
        sha: rng.hex(40),
        author: sameAuthor ? origin.author : rng.pick(AUTHORS).name,
        message: isRevert
          ? `revert: "${origin.message.replace(/ \(#\d+\)$/, '')}" (#${pr++})`
          : `fix(${file.module}): ${rng.pick(COMMIT_SUBJECTS.fix!)} (#${pr++})`,
        timestamp: runTime - rng.int(3, 25) * 60_000,
        changes: isRevert
          ? origin.changes.map((c) => ({ file: c.file, added: c.deleted, deleted: c.added }))
          : [{ file: bug.file, added: rng.int(2, 30), deleted: rng.int(1, 18) }],
        otherPaths: [],
      });
      runCommits.push(idx);
      truth.regressions[bug.truthIndex]!.fixedInRun = r;
      active.splice(i, 1);
    }

    const fresh =
      runCommits.length > 0 ? rng.weighted([0.45, 0.4, 0.15]) : 1 + rng.weighted([0.55, 0.3, 0.15]);
    for (let k = 0; k < fresh; k++) {
      const author = rng.pick(AUTHORS);
      const idx = commits.length;
      const timestamp = runTime - rng.int(3, 55) * 60_000;
      const roll = rng.next();
      if (roll < 0.03) {
        const path = rng.pick(GLOBAL_PATHS);
        commits.push({
          sha: rng.hex(40),
          author: author.name,
          message:
            path === 'package-lock.json' || path === 'package.json'
              ? `chore(deps): bump ${rng.pick(['zod', 'undici', 'pg', 'vitest', 'typescript'])} (#${pr++})`
              : `ci: update ${path} (#${pr++})`,
          timestamp,
          changes: [],
          otherPaths: path === 'package.json' ? ['package.json', 'package-lock.json'] : [path],
        });
        runCommits.push(idx);
        continue;
      }
      if (roll < 0.07) {
        commits.push({
          sha: rng.hex(40),
          author: author.name,
          message: `docs: ${rng.pick(['clarify setup steps', 'document retry policy', 'update changelog', 'fix typos'])} (#${pr++})`,
          timestamp,
          changes: [],
          otherPaths: [rng.pick(DOC_PATHS)],
        });
        runCommits.push(idx);
        continue;
      }

      const home = modulesOfTeam(author.team);
      const moduleName = rng.chance(0.82) ? rng.pick(home) : rng.pick(MODULES).name;
      const touched = pickFiles(moduleName);
      const spec = MODULES.find((m) => m.name === moduleName)!;
      if (spec.deps.length > 0 && rng.chance(0.18)) {
        const extra = rng.pick(filesByModule.get(rng.pick(spec.deps))!);
        if (!touched.includes(extra)) touched.push(extra);
      }
      const changes: FileChange[] = touched.map((file) => ({
        file,
        added: Math.max(1, Math.round(rng.logNormal(22, 1.0))),
        deleted: Math.round(rng.logNormal(8, 1.1)),
      }));
      const type = (['feat', 'feat', 'refactor', 'fix', 'perf', 'chore'] as const)[rng.int(0, 5)]!;
      commits.push({
        sha: rng.hex(40),
        author: author.name,
        message: `${type}(${moduleName}): ${rng.pick(COMMIT_SUBJECTS[type]!)} (#${pr++})`,
        timestamp,
        changes,
        otherPaths: [],
      });
      runCommits.push(idx);

      // Does this commit introduce a regression?
      const lines = changes.reduce((s, c) => s + c.added + c.deleted, 0);
      const riskiest = changes.reduce((a, b) => (bugProne[b.file]! > bugProne[a.file]! ? b : a));
      const pBug =
        (0.022 + 0.012 * changes.length + (lines > 150 ? 0.02 : 0)) *
        (1 / author.care) *
        bugProne[riskiest.file]! *
        0.5;
      if (r > 3 && r < nRuns - 1 && active.length < 2 && rng.chance(Math.min(0.5, pBug))) {
        const buggy = rng.chance(0.7) ? riskiest.file : rng.pick(changes).file;
        const exists = (t: number) => addedAt[t]! <= r;
        const failing = testsCovering[buggy]!.filter(
          (t) => exists(t) && rng.chance(tests[t]!.targets.includes(buggy) ? 0.85 : 0.25),
        );
        for (const t of hiddenByFile.get(buggy) ?? []) if (exists(t) && rng.chance(0.9)) failing.push(t);
        if (failing.length === 0) {
          const pool = testsCovering[buggy]!.filter(exists);
          if (pool.length > 0) failing.push(rng.pick(pool));
        }
        if (failing.length > 0) {
          const capped = [...new Set(failing.length > 40 ? rng.sample(failing, 40) : failing)].sort(
            (a, b) => a - b,
          );
          const delay = 1 + rng.weighted([0.5, 0.25, 0.15, 0.07, 0.03]);
          truth.regressions.push({ commit: idx, run: r, file: buggy, tests: capped, fixedInRun: null });
          active.push({
            commit: idx,
            file: buggy,
            tests: capped,
            message: regressionMessage(files[buggy]!),
            fixRun: r + delay,
            truthIndex: truth.regressions.length - 1,
          });
        }
      }

      // Or an unnoticed slowdown in one of the tests that exercise the change?
      if (truth.slowdowns.length < 7 && r > 30 && r < nRuns - 30 && rng.chance(0.02)) {
        const pool = tests.filter(
          (t) => t.targets.includes(touched[0]!) && slowFrom[t.id]! < 0 && addedAt[t.id]! < r - 25,
        );
        if (pool.length > 0) {
          const t = rng.pick(pool);
          slowFrom[t.id] = r;
          slowFactor[t.id] = rng.range(1.7, 3.2);
          truth.slowdowns.push({ test: t.id, run: r, factor: slowFactor[t.id]! });
        }
      }
    }

    // ---- execute the suite ------------------------------------------------------
    const statuses = new Uint8Array(nTests);
    const durations = new Float32Array(nTests);
    const broken = new Map<number, ActiveBug>();
    for (const bug of active) for (const t of bug.tests) if (!broken.has(t)) broken.set(t, bug);
    const incident = infra.get(r);
    let totalMs = 0;

    for (let t = 0; t < nTests; t++) {
      if (addedAt[t]! > r) continue;
      if (r >= skipFrom[t]! && r < skipTo[t]!) {
        statuses[t] = Status.Skip;
        continue;
      }
      const slow = slowFrom[t]! >= 0 && r >= slowFrom[t]! ? slowFactor[t]! : 1;
      const once = baseDuration[t]! * slow * Math.exp(0.1 * rng.normal());
      const bug = broken.get(t);
      if (bug) {
        const test = tests[t]!;
        const direct = test.targets.includes(bug.file);
        // Most tests surface the propagated exception; some only see their own assertion trip.
        const frame = `    at ${test.file}:${rng.int(8, 140)}:${rng.int(3, 30)}`;
        const message =
          direct || rng.chance(0.75)
            ? `${bug.message}\n${frame}`
            : `AssertionError: expected ${test.suite.split('/').pop()} ${PROPS[t % PROPS.length]} to match the stored snapshot\n${frame}`;
        statuses[t] = Status.Fail;
        durations[t] = once * 2.4;
        failures.push({ run: r, test: t, message, failedAttempts: 3, final: true });
      } else if (flakyRate[t]! > 0 && r >= flakyFrom[t]! && r < flakyTo[t]! && rng.chance(flakyRate[t]!)) {
        // A flaky failure tends to repeat inside the same job (shared dirty state).
        const again = Math.min(0.6, flakyRate[t]! * 2.5);
        let failed = 1;
        while (failed < 3 && rng.chance(again)) failed++;
        statuses[t] = failed === 3 ? Status.Fail : Status.Flaky;
        durations[t] = once * (failed === 3 ? 3 : failed + 1);
        failures.push({
          run: r,
          test: t,
          message: flakyMessage[t]!,
          failedAttempts: failed,
          final: failed === 3,
        });
      } else if (incident && rng.chance(incident.fraction)) {
        const final = rng.chance(0.4);
        statuses[t] = final ? Status.Fail : Status.Flaky;
        durations[t] = once * (final ? 1.5 : 2);
        failures.push({ run: r, test: t, message: incident.message, failedAttempts: final ? 3 : 1, final });
      } else {
        statuses[t] = Status.Pass;
        durations[t] = once;
      }
      totalMs += durations[t]!;
    }

    runs.push({
      id: r,
      number: 4100 + r,
      timestamp: runTime,
      branch: 'main',
      commits: runCommits,
      statuses,
      durations,
      wallSec: Math.round(totalMs / 1000 / 4 + 95 + rng.range(-8, 14)),
    });
  }

  return {
    meta: {
      name: 'acme/storefront',
      source: 'demo',
      description: `Synthetic history of a ${files.length}-file, ${nTests}-test monorepo over ${days} days (seed ${seed}).`,
      createdAt: endTime,
      seed,
      parallelism: 4,
      overheadSec: 95,
    },
    files,
    deps,
    tests,
    commits,
    runs,
    failures,
    truth,
  };
}
