import { Download, FileUp, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Card, CardHeader, Code, PageHeader } from '../components/ui';
import { plural } from '../engine/format';
import { toJUnitXml } from '../engine/junit';
import { useApp, useProject } from '../store';

const MAX_BYTES = 200 * 1024 * 1024;

export function ImportPage() {
  const { dataset } = useProject();
  const importReports = useApp((s) => s.importReports);
  const clearImport = useApp((s) => s.clearImport);
  const hasSavedImport = useApp((s) => s.hasSavedImport);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('My project');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handle = async (list: FileList | File[]) => {
    const files = [...list].filter((f) => f.name.toLowerCase().endsWith('.xml'));
    setError(null);
    if (files.length === 0) {
      setError('Choose one or more JUnit .xml files.');
      return;
    }
    const size = files.reduce((s, f) => s + f.size, 0);
    if (size > MAX_BYTES) {
      setError('That is more than 200 MB of XML. Import a recent subset of runs instead.');
      return;
    }
    setBusy(true);
    try {
      const reports = await Promise.all(
        files.map(async (f) => ({ name: f.webkitRelativePath || f.name, xml: await f.text() })),
      );
      await importReports(reports, name.trim() || 'My project');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadSample = () => {
    // A handful of demo runs as real JUnit files, so the import path can be tried end to end.
    const runs = dataset.runs.slice(-12);
    const first = dataset.runs.length - runs.length;
    for (let i = 0; i < runs.length; i++) {
      const blob = new Blob([toJUnitXml(dataset, first + i)], { type: 'application/xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `run-${runs[i]!.number}.xml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };

  return (
    <>
      <PageHeader
        title="Import data"
        lead="Analyse your own CI history. Files are read and analysed in this tab only — nothing is uploaded anywhere."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="JUnit XML reports"
            subtitle="One report per CI run. Every major test runner can write this format."
          />
          <div className="grid gap-4 border-t border-line px-5 py-4">
            <label className="grid gap-1 text-[13px] text-ink-2">
              Project name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] text-ink outline-none focus:border-s1"
              />
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void handle(e.dataTransfer.files);
              }}
              className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? 'border-s1 bg-surface-2' : 'border-line-strong'}`}
            >
              <FileUp size={28} className="text-muted" aria-hidden />
              <div>
                <p className="text-[14px] font-medium text-ink">
                  {busy ? 'Analysing…' : 'Drop .xml reports here'}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-2">
                  Ordered by their timestamps, or by file name (run-2 before run-10).
                </p>
              </div>
              <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
                Choose files
              </Button>
              <input
                ref={input}
                type="file"
                accept=".xml,application/xml,text/xml"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void handle(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg px-3 py-2 text-[13px] tone-crit">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={downloadSample}>
                <Download size={14} aria-hidden /> Download 12 sample reports
              </Button>
              {hasSavedImport && (
                <Button
                  onClick={() => {
                    void clearImport().then(() => navigate('/'));
                  }}
                >
                  <RotateCcw size={14} aria-hidden /> Back to the demo
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">
              The last import is kept in this browser (IndexedDB) and reopens on your next visit.
            </p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Producing reports" />
          <ul className="grid gap-3 border-t border-line px-5 py-4 text-[13px] text-ink-2">
            <Runner name="Vitest" cmd="vitest run --reporter=junit --outputFile=report.xml" />
            <Runner name="Jest" cmd="jest --reporters=default --reporters=jest-junit" />
            <Runner name="Playwright" cmd="playwright test --reporter=junit" />
            <Runner name="pytest" cmd="pytest --junitxml=report.xml" />
            <Runner name="Maven / Gradle" cmd="target/surefire-reports/*.xml" />
            <Runner name="Go" cmd="gotestsum --junitfile report.xml" />
          </ul>
          <div className="border-t border-line px-5 py-3.5 text-[13px] text-ink-2">
            <p className="font-medium text-ink">What you get from JUnit alone</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="good">Flaky tests</Badge>
              <Badge tone="good">Failure clusters</Badge>
              <Badge tone="good">Incidents</Badge>
              <Badge tone="good">Slowdowns</Badge>
              <Badge tone="good">Shard planner</Badge>
              <Badge tone="good">Pipeline health</Badge>
            </div>
            <p className="mt-3">
              Change impact and culprit ranking also need the import graph and which files each commit
              touched. For that, run the CLI in CI: <Code>seismiq select</Code>.
            </p>
            <p className="mt-2 text-xs text-muted">
              Retries are understood in both forms: Surefire&apos;s <Code>flakyFailure</Code> and one{' '}
              <Code>testcase</Code> per attempt.
            </p>
          </div>
        </Card>
      </div>
      <p className="mt-3 text-xs text-muted">
        Currently loaded: {dataset.meta.name} — {plural(dataset.runs.length, 'run')},{' '}
        {plural(dataset.tests.length, 'test')}.
      </p>
    </>
  );
}

function Runner({ name, cmd }: { name: string; cmd: string }) {
  return (
    <li>
      <span className="font-medium text-ink">{name}</span>
      <code className="mt-1 block overflow-x-auto rounded bg-surface-2 px-2 py-1 font-mono text-[11.5px] whitespace-nowrap text-ink-2">
        {cmd}
      </code>
    </li>
  );
}
