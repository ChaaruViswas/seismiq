import { del, get, set } from 'idb-keyval';
import { create } from 'zustand';
import { DEMO_SEED } from './config';
import { RepoIndex } from './engine/repo';
import type { Analysis } from './engine/results';
import type { Dataset } from './engine/types';
import type { WorkerRequest, WorkerResponse } from './worker/protocol';

type Job =
  | { type: 'demo'; seed: number; endTime: number }
  | { type: 'reports'; reports: { name: string; xml: string }[]; name: string }
  | { type: 'dataset'; dataset: Dataset };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: WorkerResponse) => void>();

/** Main-thread fallback. Loaded on demand, so the engine is not duplicated in the main bundle. */
async function runInline(job: Job): Promise<{ dataset: Dataset; analysis: Analysis }> {
  const [{ analyze }, { datasetFromReports }, { simulate }] = await Promise.all([
    import('./engine/analyze'),
    import('./engine/junit'),
    import('./engine/simulator'),
  ]);
  const dataset =
    job.type === 'demo'
      ? simulate({ seed: job.seed, endTime: job.endTime })
      : job.type === 'reports'
        ? datasetFromReports(job.reports, job.name)
        : job.dataset;
  return { dataset, analysis: analyze(dataset) };
}

/** Run a job in the worker; fall back to the main thread where workers are unavailable. */
function run(job: Job): Promise<{ dataset: Dataset; analysis: Analysis }> {
  return new Promise((resolve, reject) => {
    const inline = () => {
      runInline(job).then(resolve, (err: unknown) =>
        reject(err instanceof Error ? err : new Error(String(err))),
      );
    };
    try {
      if (!worker) {
        worker = new Worker(new URL('./worker/analysis.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          pending.get(e.data.id)?.(e.data);
          pending.delete(e.data.id);
        };
        worker.onerror = () => {
          // The worker failed to load or crashed: finish every waiting job on the main thread.
          worker = null;
          const waiting = [...pending.values()];
          pending.clear();
          for (const settle of waiting) settle({ id: 0, ok: false, error: '__worker_failed__' });
        };
      }
      const id = nextId++;
      pending.set(id, (r) => {
        if (r.ok) resolve({ dataset: r.dataset, analysis: r.analysis });
        else if (r.error === '__worker_failed__') inline();
        else reject(new Error(r.error));
      });
      worker.postMessage({ id, ...job } as WorkerRequest);
    } catch {
      inline();
    }
  });
}

const IMPORT_KEY = 'seismiq:imported-dataset';

export interface AppState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  dataset: Dataset | null;
  analysis: Analysis | null;
  index: RepoIndex | null;
  /** True while a saved import exists that the user can switch back to. */
  hasSavedImport: boolean;
  init: () => Promise<void>;
  loadDemo: () => Promise<void>;
  importReports: (reports: { name: string; xml: string }[], name: string) => Promise<void>;
  clearImport: () => Promise<void>;
}

/** The demo always ends "now", rounded to the hour so a reload shows the same timestamps. */
const demoEnd = () => Math.floor(Date.now() / 3_600_000) * 3_600_000;

export const useApp = create<AppState>((setState, getState) => {
  const apply = ({ dataset, analysis }: { dataset: Dataset; analysis: Analysis }) =>
    setState({ status: 'ready', error: null, dataset, analysis, index: new RepoIndex(dataset) });

  return {
    status: 'loading',
    error: null,
    dataset: null,
    analysis: null,
    index: null,
    hasSavedImport: false,

    init: async () => {
      let saved: Dataset | undefined;
      try {
        saved = await get<Dataset>(IMPORT_KEY);
      } catch {
        // IndexedDB can be unavailable (private windows); the demo still works.
      }
      if (saved) {
        try {
          apply(await run({ type: 'dataset', dataset: saved }));
          setState({ hasSavedImport: true });
          return;
        } catch {
          // A stale or corrupt saved import must never block the app.
        }
      }
      await getState().loadDemo();
    },

    loadDemo: async () => {
      setState({ status: 'loading', error: null });
      try {
        apply(await run({ type: 'demo', seed: DEMO_SEED, endTime: demoEnd() }));
      } catch (err) {
        setState({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    importReports: async (reports, name) => {
      // Keep the current view on screen until the import succeeds; errors are thrown to the caller.
      const result = await run({ type: 'reports', reports, name });
      apply(result);
      try {
        await set(IMPORT_KEY, result.dataset);
        setState({ hasSavedImport: true });
      } catch {
        setState({ hasSavedImport: false });
      }
    },

    clearImport: async () => {
      try {
        await del(IMPORT_KEY);
      } catch {
        // nothing to clean up
      }
      setState({ hasSavedImport: false });
      await getState().loadDemo();
    },
  };
});

/** The loaded project. Only call inside the ready-state part of the tree. */
export function useProject(): { dataset: Dataset; analysis: Analysis; index: RepoIndex } {
  const dataset = useApp((s) => s.dataset);
  const analysis = useApp((s) => s.analysis);
  const index = useApp((s) => s.index);
  if (!dataset || !analysis || !index) throw new Error('Project is not loaded yet.');
  return { dataset, analysis, index };
}
