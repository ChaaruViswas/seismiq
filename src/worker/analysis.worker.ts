/// <reference lib="webworker" />
/**
 * All heavy lifting — simulation, XML parsing, model training — happens here,
 * off the main thread, so the UI never freezes.
 */
import { analyze } from '../engine/analyze';
import { datasetFromReports } from '../engine/junit';
import { simulate } from '../engine/simulator';
import type { Dataset } from '../engine/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  let response: WorkerResponse;
  try {
    let dataset: Dataset;
    if (req.type === 'demo') dataset = simulate({ seed: req.seed, endTime: req.endTime });
    else if (req.type === 'reports') dataset = datasetFromReports(req.reports, req.name);
    else dataset = req.dataset;
    response = { id: req.id, ok: true, dataset, analysis: analyze(dataset) };
  } catch (err) {
    response = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(response);
};
