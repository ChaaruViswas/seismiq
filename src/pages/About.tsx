import { Card, CardHeader, Code, PageHeader } from '../components/ui';
import { APP_VERSION, REPO_URL } from '../config';

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Change-aware test selection',
    body: (
      <>
        <p>
          Each test is linked to source files three ways: the files it imports, the transitive import graph,
          and recorded per-test coverage (which catches links the graph misses, such as an end-to-end test
          reaching code over HTTP). History adds a fourth: if a test newly failed when a file changed and
          nothing static explains it, that coupling is learned.
        </p>
        <p className="mt-2">
          A test is skipped only when none of these link it to the change and it is not already failing.
          Manifests, lockfiles, build and CI configuration force a full run; documentation-only changes run
          nothing. The replay of history measures both sides of the trade: time saved, and the share of real
          regressions the selection would still have caught.
        </p>
      </>
    ),
  },
  {
    title: 'Failure prediction and ordering',
    body: (
      <p>
        Twelve signals per (change, test) — graph proximity, coverage, churn in reach, co-failure history,
        recent failure and flake rates, test kind — feed an L2-regularised logistic regression fitted by
        Newton&apos;s method. The target is a <em>new</em> failure: a passing test that starts failing.
        Features use only earlier runs; the model trains on the first 70% of history and is scored on the last
        30%. A linear model was chosen on purpose: each prediction splits exactly into per-signal
        contributions, shown under every recommended test. Run-level break risk is the expected number of new
        failures passed through a second, one-feature logistic model, because failures are correlated and
        multiplying per-test probabilities would overstate it.
      </p>
    ),
  },
  {
    title: 'Flaky-test detection',
    body: (
      <p>
        A flake event is a retry that passed, or an isolated one-run failure that recovered on its own with
        nothing in the change to explain it. Runs recognised as infrastructure incidents are excluded. Three
        events make a test flaky; two make it a suspect. The flake rate carries a 95% Wilson interval. A flaky
        test that has been quiet long enough that the quiet streak would happen by chance less than 2% of the
        time at its earlier rate is marked stabilized. The cause family (timeout, network, async race, order
        dependency, time, resource exhaustion) comes from its failure messages.
      </p>
    ),
  },
  {
    title: 'Failure clustering and infrastructure incidents',
    body: (
      <p>
        Messages are normalised — numbers, UUIDs, addresses, dates and line numbers stripped, stack frames
        inside test files dropped — then exact duplicates collapse and the remaining fingerprints are merged
        by TF-IDF cosine similarity. A run is an infrastructure incident when one message accounts for most of
        a large burst of failures and either looks like an environment problem or mostly disappears on retry.
        A real regression can also break many tests at once, but it fails every attempt. Commits built by an
        incident run are carried into the next run and judged there.
      </p>
    ),
  },
  {
    title: 'Culprit ranking',
    body: (
      <p>
        When tests start failing in a run that built several commits, each commit is scored by how well it
        explains each failing test: its files named in the stack trace (strongest), imported directly,
        covered, or reached through the graph (weakest, decaying with distance). Scores are normalised into
        the percentages shown, and the evidence behind each is listed. The fix is found as the commit in the
        recovery run that touches the same files.
      </p>
    ),
  },
  {
    title: 'Durations and sharding',
    body: (
      <p>
        Slowdowns are found by testing every split of a test&apos;s log-duration series with a two-sample t
        statistic; the best split must be both significant and at least 30% slower. Log space makes the test
        scale-free. The shard planner assigns test files longest-first to the lightest shard, which is
        guaranteed to finish within 4/3 of the optimal split.
      </p>
    ),
  },
  {
    title: 'The demo data, and why it is honest',
    body: (
      <p>
        The demo is a deterministic simulation of a 22-module monorepo: a real import graph, coverage maps
        that are slightly stale, hidden couplings static analysis cannot see, authors with different care
        levels, regressions that wait a few runs to be fixed or reverted, flaky tests with realistic messages,
        outages and slowdowns. The simulator records what it planted; the engine never reads it. The overview
        scores the engine against that record — the numbers are measured, not claimed. The suite runs the same
        check across several seeds.
      </p>
    ),
  },
];

export function About() {
  return (
    <>
      <PageHeader
        title="How it works"
        lead="Seismiq is a static web app plus a CLI. There is no server: the analysis engine is plain TypeScript running in a Web Worker in your browser, or in Node in your CI."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader title={s.title} />
            <div className="border-t border-line px-5 py-4 text-[13.5px] leading-relaxed text-ink-2">
              {s.body}
            </div>
          </Card>
        ))}
        <Card className="lg:col-span-2">
          <CardHeader title="In your CI" subtitle="The CLI is one dependency-free file. Two commands." />
          <div className="grid gap-4 border-t border-line px-5 py-4 text-[13.5px] text-ink-2 md:grid-cols-2">
            <div>
              <p className="font-medium text-ink">Run only the tests a pull request can affect</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] text-ink-2">
                npx vitest run $(node seismiq.mjs select --base origin/main)
              </pre>
              <p className="mt-2">
                Builds the import graph of a JS/TS project, diffs against the merge base and prints the
                affected test files. <Code>--format md</Code> explains every choice for a PR comment.
              </p>
            </div>
            <div>
              <p className="font-medium text-ink">Summarise reliability in the job summary</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] text-ink-2">
                node seismiq.mjs report reports/ --out &quot;$GITHUB_STEP_SUMMARY&quot;
              </pre>
              <p className="mt-2">
                Flaky tests, failure clusters, open incidents and slowdowns from a folder of JUnit reports.{' '}
                <Code>--format json</Code> for dashboards and bots.
              </p>
            </div>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[13px] text-ink-2">
            <span>
              Built with React 19, TypeScript 7, Vite 8, Tailwind CSS 4, Zustand, Web Workers and IndexedDB.
              Tested with Vitest and Playwright. Version {APP_VERSION}.
            </span>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent-ink underline underline-offset-2"
            >
              Source code
            </a>
          </div>
        </Card>
      </div>
    </>
  );
}
