import { Activity, AlertOctagon } from 'lucide-react';
import { lazy, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Button } from './components/ui';
import { useApp } from './store';

const About = lazy(() => import('./pages/About').then((m) => ({ default: m.About })));
const Changes = lazy(() => import('./pages/Changes').then((m) => ({ default: m.Changes })));
const Failures = lazy(() => import('./pages/Failures').then((m) => ({ default: m.Failures })));
const Flaky = lazy(() => import('./pages/Flaky').then((m) => ({ default: m.Flaky })));
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })));
const ModelPage = lazy(() => import('./pages/Model').then((m) => ({ default: m.ModelPage })));
const Overview = lazy(() => import('./pages/Overview').then((m) => ({ default: m.Overview })));
const Pipeline = lazy(() => import('./pages/Pipeline').then((m) => ({ default: m.Pipeline })));
const Tests = lazy(() => import('./pages/Tests').then((m) => ({ default: m.Tests })));

function Splash() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <Activity size={36} className="animate-pulse text-s1" aria-hidden />
      <div>
        <p className="text-[15px] font-medium text-ink">Analysing CI history…</p>
        <p className="mt-1 text-[13px] text-ink-2">
          Replaying every run, training the failure model and scoring it — all in your browser.
        </p>
      </div>
    </div>
  );
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
      <AlertOctagon size={36} className="text-crit" aria-hidden />
      <div>
        <p className="text-[15px] font-medium text-ink">The analysis could not be completed</p>
        <p className="mt-1 max-w-md text-[13px] text-ink-2">{message}</p>
      </div>
      <Button variant="primary" onClick={retry}>
        Load the demo data
      </Button>
    </div>
  );
}

export function App() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const ready = useApp((s) => s.dataset !== null && s.analysis !== null);
  const init = useApp((s) => s.init);
  const loadDemo = useApp((s) => s.loadDemo);

  useEffect(() => {
    void init();
  }, [init]);

  if (status === 'error') return <Failure message={error ?? 'Unknown error'} retry={() => void loadDemo()} />;
  if (!ready) return <Splash />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="changes/:run?" element={<Changes />} />
          <Route path="tests/:id?" element={<Tests />} />
          <Route path="flaky" element={<Flaky />} />
          <Route path="failures" element={<Failures />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="model" element={<ModelPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="about" element={<About />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
