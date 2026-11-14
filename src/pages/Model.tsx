import { useMemo } from 'react';
import { XYChart } from '../components/charts';
import { Card, CardHeader, EmptyState, PageHeader, Stat } from '../components/ui';
import { fmtMs, fmtNum, fmtPct, plural } from '../engine/format';
import { FEATURES } from '../engine/history';
import { useProject } from '../store';

export function ModelPage() {
  const { dataset, analysis } = useProject();
  const m = analysis.model;
  const model = m.model;

  const weights = useMemo(
    () =>
      model
        ? FEATURES.map((f, i) => ({ feature: f, w: model.weights[i]! })).sort(
            (a, b) => Math.abs(b.w) - Math.abs(a.w),
          )
        : [],
    [model],
  );
  const maxW = Math.max(1e-9, ...weights.map((x) => Math.abs(x.w)));
  const run = (i: number) => (dataset.runs[i] ? `#${dataset.runs[i].number}` : '–');

  if (!model) {
    return (
      <>
        <PageHeader title="Model" />
        <Card>
          <EmptyState title="Not enough failure history to train a model">
            The model needs at least 30 runs with a handful of new failures. Until then, tests are ordered by
            simple rules: already failing first, then direct imports, coverage and recent failure rate.
          </EmptyState>
        </Card>
      </>
    );
  }

  const at = (b: number) => m.recallAtBudget.find((x) => x.budget === b);
  const r20 = at(0.2);

  return (
    <>
      <PageHeader
        title="Model card"
        lead="A logistic-regression model predicts, for each test and change, the chance that a passing test starts failing. Trained on older runs, judged only on newer ones it never saw."
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          label="Held-out ROC AUC"
          value={m.auc === null ? '–' : m.auc.toFixed(3)}
          hint="1.0 is perfect, 0.5 is a coin"
          help="Probability that a test that newly failed was ranked above one that did not, over every held-out (run, test) pair."
        />
        <Stat
          label="Failures found in top 20%"
          value={r20 ? fmtPct(r20.model) : '–'}
          hint={r20 ? `Default order: ${fmtPct(r20.baseline)}` : undefined}
          help="Run only the riskiest fifth of the suite: what share of new failures does it contain?"
        />
        <Stat
          label="APFD"
          value={m.apfdModel === null ? '–' : m.apfdModel.toFixed(2)}
          hint={m.apfdBaseline === null ? undefined : `Default order: ${m.apfdBaseline.toFixed(2)}`}
          help="Average Percentage of Faults Detected — the standard metric for test prioritisation. 1.0 means every failure is found immediately."
        />
        <Stat
          label="Time to first failure"
          value={m.ttffModelSec === null ? '–' : fmtMs(m.ttffModelSec * 1000)}
          hint={m.ttffBaselineSec === null ? undefined : `Default order: ${fmtMs(m.ttffBaselineSec * 1000)}`}
          help="Median test time before the first new failure surfaces, in runs that broke something."
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Failures found vs. share of suite run"
            subtitle="Held-out runs. Ordering by predicted risk against the default order."
          />
          <div className="px-5 pb-4">
            <XYChart
              series={[
                {
                  name: 'Ordered by risk',
                  color: 's1',
                  points: [{ x: 0, y: 0 }, ...m.recallAtBudget.map((b) => ({ x: b.budget, y: b.model }))],
                },
                {
                  name: 'Default order',
                  color: 's2',
                  points: [{ x: 0, y: 0 }, ...m.recallAtBudget.map((b) => ({ x: b.budget, y: b.baseline }))],
                },
              ]}
              yDomain={[0, 1]}
              xFormat={(x) => fmtPct(x)}
              yFormat={(y) => fmtPct(y)}
              xTicks={[0, 0.1, 0.2, 0.3, 0.5]}
              ariaLabel="Share of new failures found against share of the suite run"
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="ROC curve"
            subtitle="True-positive rate against false-positive rate. The diagonal is chance."
          />
          <div className="px-5 pb-4">
            <XYChart
              series={[{ name: 'Model', color: 's1', points: m.roc.map((p) => ({ x: p.fpr, y: p.tpr })) }]}
              yDomain={[0, 1]}
              xFormat={(x) => x.toFixed(1)}
              yFormat={(y) => y.toFixed(1)}
              xTicks={[0, 0.2, 0.4, 0.6, 0.8, 1]}
              reference={{ from: [0, 0], to: [1, 1], label: 'Chance' }}
              ariaLabel={`ROC curve, area ${m.auc?.toFixed(3) ?? 'unknown'}`}
            />
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="What the model learned"
            subtitle="Standardised weights: how much one standard deviation of each signal moves the log-odds of a new failure."
          />
          <ul className="grid gap-2 border-t border-line px-5 py-4">
            {weights.map(({ feature, w }) => (
              <li
                key={feature.key}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(80px,1fr)_48px] items-center gap-3"
                title={feature.help}
              >
                <span className="truncate text-[13px] text-ink">{feature.label}</span>
                <span className="relative h-2" aria-hidden>
                  <span className="absolute inset-y-[-3px] left-1/2 w-px bg-axis" />
                  <span
                    className={
                      w >= 0
                        ? 'absolute inset-y-0 rounded-r-[4px] bg-[var(--pole-warm)]'
                        : 'absolute inset-y-0 rounded-l-[4px] bg-s1'
                    }
                    style={
                      w >= 0
                        ? { left: '50%', width: `${(Math.abs(w) / maxW) * 50}%` }
                        : { right: '50%', width: `${(Math.abs(w) / maxW) * 50}%` }
                    }
                  />
                </span>
                <span className="num text-right text-[13px] text-ink-2">
                  {w >= 0 ? '+' : '−'}
                  {Math.abs(w).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
            Red raises the predicted risk, blue lowers it. Hover a row for what the signal means.
          </p>
        </Card>

        <Card>
          <CardHeader
            title="Is the break risk honest?"
            subtitle="Held-out runs grouped by predicted break risk, against how often they actually broke something."
          />
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="px-5 py-2 font-medium">Predicted risk</th>
                  <th className="px-3 py-2 text-right font-medium">Runs</th>
                  <th className="px-3 py-2 text-right font-medium">Average predicted</th>
                  <th className="px-5 py-2 text-right font-medium">Actually broke</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {m.calibration.map((b) => (
                  <tr key={b.label}>
                    <td className="px-5 py-2 text-ink">{b.label}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{b.runs}</td>
                    <td className="num px-3 py-2 text-right text-ink">{fmtPct(b.predicted, 1)}</td>
                    <td className="num px-5 py-2 text-right text-ink">{fmtPct(b.observed, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
            Small groups are noisy: with a few runs in a bucket, one run moves the observed rate a lot.
          </p>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Training and evaluation" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line px-5 py-4 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
          <Item label="Training runs">
            {run(m.trainRuns[0])}–{run(m.trainRuns[1] - 1)}
          </Item>
          <Item label="Held-out runs">
            {run(m.testRuns[0])}–{run(m.testRuns[1] - 1)}
          </Item>
          <Item label="Training rows">{fmtNum(m.trainRows)}</Item>
          <Item label="New failures in training">{fmtNum(m.trainPositives)}</Item>
          <Item label="Held-out rows">{fmtNum(m.testRows)}</Item>
          <Item label="New failures held out">{fmtNum(m.testPositives)}</Item>
        </dl>
        <div className="border-t border-line px-5 py-3.5 text-[13px] leading-relaxed text-ink-2">
          <p>
            Split by time, never at random — shuffling would let the model learn from the future. Every
            feature for a run is computed from earlier runs only, and a test proves it: analysing a prefix of
            history gives bit-identical features. Passing rows are subsampled 1 in 5 and re-weighted ×5, which
            keeps probabilities calibrated. Fitted by Newton&apos;s method with L2 regularisation in{' '}
            {model.iterations} iterations; {plural(m.failingRuns, 'held-out run')} broke at least one test.
            Infrastructure-incident runs are excluded from training and scoring.
          </p>
        </div>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num mt-0.5 font-semibold text-ink">{children}</dd>
    </div>
  );
}
